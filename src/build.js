const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { basename, dirname, join, relative, resolve, sep } = require('node:path');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { API } = require('typescript/unstable/sync');
const { SyntaxKind } = require('typescript/unstable/ast');
const { checkProject } = require('./check');
const { isNodeRequire } = require('./import-validation');

function relativeImportGuardPrefix(typescript = false, importValue = false) {
  const check = 'if (typeof name === "string" && /^file:/i.test(name)) throw new Error("GraphScript rule error: file: URL imports are not allowed"); if (typeof name === "string" && (name.startsWith("./") || name.startsWith("../"))) throw new Error("GraphScript rule error: relative runtime imports are not allowed"); return name;';
  if (importValue) return `(specifier => ({ [Symbol.toPrimitive]() { const name = \`\${specifier}\`; ${check} } }))(`;
  return `((specifier${typescript ? ': string' : ''}) => { const name = specifier; ${check} })(`;
}

function rewriteGraphImports(source, nodePaths, nodeNames, declarationPaths = {}, declarationFile = false) {
  const edits = [];
  const identifiers = new Set();
  let needsGraph = false;
  let needsGuard = false;
  const dynamicImports = [];
  function rewriteSpecifier(specifier, typeOnly = false) {
    return (declarationFile || typeOnly ? declarationPaths[specifier] : undefined) ?? nodePaths[specifier]
      ?? (specifier.startsWith('./') || specifier.startsWith('../') ? `./.graphscript-local/nodes/${specifier}` : specifier);
  }
  function visit(node) {
    if (node.kind === SyntaxKind.Identifier) identifiers.add(node.text);
    if (node.kind === SyntaxKind.ImportDeclaration && node.moduleSpecifier?.text === '@graph') {
      const bindings = node.importClause?.namedBindings;
      if (bindings?.kind === SyntaxKind.NamedImports && bindings.elements.length === 0 && !node.importClause.isTypeOnly) {
        edits.push({ start: node.getStart(source), end: node.end, replacement: 'import "./.graph.mjs";' });
        needsGraph = true;
      } else if (bindings?.kind === SyntaxKind.NamedImports) {
        const replacement = bindings.elements.map(specifier => {
          const name = (specifier.propertyName ?? specifier.name).text;
          return `import ${node.importClause.isTypeOnly ? 'type ' : ''}{ ${specifier.getText(source)} } from ${JSON.stringify(nodeNames[name])};`;
        }).join('\n');
        edits.push({ start: node.getStart(source), end: node.end, replacement });
      } else {
        edits.push({ start: node.moduleSpecifier.getStart(source), end: node.moduleSpecifier.end, replacement: '"./.graph.mjs"' });
        needsGraph = true;
      }
    } else if (node.kind === SyntaxKind.ImportDeclaration && node.moduleSpecifier?.kind === SyntaxKind.StringLiteral) {
      const specifier = node.moduleSpecifier;
      const rewritten = rewriteSpecifier(specifier.text, node.importClause?.isTypeOnly);
      if (rewritten !== specifier.text) edits.push({ start: specifier.getStart(source), end: specifier.end, replacement: JSON.stringify(rewritten) });
    } else if (node.kind === SyntaxKind.ImportType && node.argument?.literal?.kind === SyntaxKind.StringLiteral) {
      const specifier = node.argument.literal;
      const rewritten = specifier.text === '@graph' ? './.graph.mjs' : rewriteSpecifier(specifier.text, true);
      if (specifier.text === '@graph') needsGraph = true;
      if (rewritten !== specifier.text) edits.push({ start: specifier.getStart(source), end: specifier.end, replacement: JSON.stringify(rewritten) });
    } else if (node.kind === SyntaxKind.CallExpression && node.expression.kind === SyntaxKind.ImportKeyword && node.arguments[0]) {
      const specifier = node.arguments[0];
      if (specifier.kind === SyntaxKind.StringLiteral) {
        if (specifier.text === '@graph') {
          edits.push({ start: specifier.getStart(source), end: specifier.end, replacement: '"./.graph.mjs"' });
          needsGraph = true;
        } else {
          const rewritten = rewriteSpecifier(specifier.text);
          if (rewritten !== specifier.text) edits.push({ start: specifier.getStart(source), end: specifier.end, replacement: JSON.stringify(rewritten) });
        }
      } else {
        dynamicImports.push(specifier);
        needsGraph = true;
      }
    }
    node.forEachChild(visit);
  }
  visit(source);
  const ambientRequire = source.statements.flatMap(statement => {
    if (!statement.modifiers?.some(modifier => modifier.kind === SyntaxKind.DeclareKeyword)) return [];
    if (statement.name?.text === 'require') return [statement.name];
    return statement.declarationList?.declarations.filter(declaration => declaration.name?.text === 'require')
      .map(declaration => declaration.name) ?? [];
  });
  const hasRequireBinding = source.statements.some(statement => {
    if (statement.modifiers?.some(modifier => modifier.kind === SyntaxKind.DeclareKeyword)) return false;
    if (statement.name?.text === 'require') return true;
    if (statement.declarationList?.declarations.some(declaration => declaration.name?.text === 'require')) return true;
    const clause = statement.importClause;
    return clause?.name?.text === 'require' || clause?.namedBindings?.name?.text === 'require'
      || clause?.namedBindings?.elements?.some(specifier => specifier.name.text === 'require');
  });
  let guard = '__graphscriptLocalSpecifier';
  while (identifiers.has(guard)) guard += '_';
  let importGuard = '__graphscriptImportSpecifier';
  while (identifiers.has(importGuard)) importGuard += '_';
  let parsed;
  try {
    parsed = parse(source.text, { sourceType: 'module', plugins: ['typescript', 'decorators', 'decoratorAutoAccessors'], errorRecovery: true });
  } catch {}
  if (parsed) traverse(parsed, { 'CallExpression|OptionalCallExpression'(path) {
    if (path.node.callee.type === 'Import') return;
    if (!isNodeRequire(path, path.node.callee)) return;
    const specifier = path.node.arguments[0];
    if (!specifier || specifier.type === 'StringLiteral') return;
    needsGuard = true;
    edits.push({ start: specifier.start, end: specifier.start, replacement: `${guard}(` });
    edits.push({ start: specifier.end, end: specifier.end, replacement: ')' });
  } });
  for (const specifier of dynamicImports) {
    needsGuard = true;
    edits.push({ start: specifier.getStart(source), end: specifier.getStart(source),
      replacement: `${importGuard}(` });
    edits.push({ start: specifier.end, end: specifier.end, replacement: ')' });
  }
  if (identifiers.has('require') && !hasRequireBinding) {
    needsGuard = true;
    let helper = '__graphscriptCreateRequire';
    while (identifiers.has(helper)) helper += '_';
    let urlHelper = '__graphscriptURL';
    while (identifiers.has(urlHelper)) urlHelper += '_';
    let requireType = '__graphscriptRequireType';
    while (identifiers.has(requireType)) requireType += '_';
    for (const name of ambientRequire) edits.push({ start: name.getStart(source), end: name.end, replacement: requireType });
    let position = 0;
    for (const statement of source.statements) {
      if (statement.kind !== SyntaxKind.ExpressionStatement || statement.expression.kind !== SyntaxKind.StringLiteral) break;
      position = statement.end;
    }
    edits.push({ start: position, end: position,
        replacement: `\nimport { createRequire as ${helper} } from "node:module";\nimport { URL as ${urlHelper} } from "node:url";\nconst require = new Proxy(${helper}(new ${urlHelper}(${JSON.stringify(`./.graphscript-local/nodes/${basename(source.fileName)}`)}, import.meta.url)), { apply(target, receiver, args) { args[0] = ${guard}(args[0]); return Reflect.apply(target, receiver, args); } })${ambientRequire.length ? ` as typeof ${requireType}` : ''};\n` });
  }
      if (needsGuard) edits.push({ start: 0, end: 0, replacement: `import { localSpecifier as ${guard}${dynamicImports.length ? `, importSpecifier as ${importGuard}` : ''} } from "./.graphscript-resolve.mjs";\n` });
  let text = source.text;
  for (const edit of edits.sort((left, right) => right.start - left.start)) text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
  return { text, needsGraph, needsGuard };
}

function existingFile(file) {
  try {
    return lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

function localDependencies(project, files, nodePaths, runtimeDirectory) {
  const pending = files.flatMap(file => {
    const source = join(project, 'nodes', file);
    return [{ file: source, typeOnly: true }, { file: source, typeOnly: false,
      text: readFileSync(join(runtimeDirectory, `${file.slice(0, -3)}.js`), 'utf8') }];
  });
  const visited = new Set();
  const modules = new Map();
  const declarationPaths = new Map();
  const nodeFiles = new Set(files.map(file => join(project, 'nodes', file)));
  const root = resolve(project);
  function add(file) {
    const name = relative(root, file);
    if (!name || name.startsWith(`..${sep}`) || name === '..') throw new Error(`Local dependency is outside the project: ${file}`);
    if (!existingFile(file)?.isFile()) throw new Error(`Local dependency is not a regular file: ${file}`);
    const realName = relative(realpathSync(root), realpathSync(file));
    if (realName === '..' || realName.startsWith(`..${sep}`)) throw new Error(`Local dependency is outside the project: ${file}`);
    if (!nodeFiles.has(file)) pending.push({ file, typeOnly: /\.d\.(?:ts|mts|cts)$/.test(file) });
  }
  function resolveDependency(source, specifier, typeOnly) {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) return;
    if (nodeFiles.has(source) && nodePaths[specifier]) return;
    const target = resolve(dirname(source), specifier);
    function findFile(file) {
      return [file, `${file}.js`, `${file}.json`, `${file}.cjs`, `${file}.mjs`, ...(typeOnly ? [`${file}.d.ts`] : [])]
        .filter(candidate => typeOnly || !/\.d\.(?:ts|mts|cts)$/.test(candidate))
        .find(candidate => existingFile(candidate)?.isFile());
    }
    let runtime = findFile(target);
    let packageDeclaration;
    if (!runtime && existingFile(target)?.isDirectory()) {
      const packageFile = join(target, 'package.json');
      const metadata = existingFile(packageFile)?.isFile() ? JSON.parse(readFileSync(packageFile, 'utf8')) : {};
      runtime = (typeof metadata.main === 'string' && findFile(resolve(target, metadata.main))) || findFile(join(target, 'index'));
      const types = metadata.types ?? metadata.typings;
      if (typeof types === 'string') {
        const typeFile = resolve(target, types);
        if (existingFile(typeFile)?.isFile()) {
          packageDeclaration = typeFile;
          add(typeFile);
          if (nodeFiles.has(source)) {
            if (!declarationPaths.has(source)) declarationPaths.set(source, {});
            declarationPaths.get(source)[specifier] = `./.graphscript-local/${relative(root, typeFile).split(sep).join('/')}`;
          }
        }
      }
    }
    const declarationBase = runtime ?? target;
    const declaration = declarationBase.replace(/\.(?:mjs|cjs|js)$/, match => ({ '.mjs': '.d.mts', '.cjs': '.d.cts', '.js': '.d.ts' })[match]);
    const hasDeclaration = declaration !== declarationBase && existingFile(declaration)?.isFile();
    if (runtime && (!typeOnly || (!hasDeclaration && !packageDeclaration))) add(runtime);
    if (hasDeclaration) add(declaration);
    if (!runtime && (!typeOnly || (!hasDeclaration && !packageDeclaration))) throw new Error(`Cannot resolve local dependency ${specifier} from ${source}`);
  }
  while (pending.length) {
    const { file, typeOnly, text: suppliedText } = pending.pop();
    const visitKey = `${file}:${typeOnly}`;
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);
    const text = suppliedText ?? readFileSync(file, 'utf8');
    if (!nodeFiles.has(file)) {
      if (!/\.(?:js|mjs|cjs|json|d\.ts|d\.mts|d\.cts)$/.test(file)) throw new Error(`Unsupported local dependency: ${file}`);
      modules.set(`.graphscript-local/${relative(root, file).split(sep).join('/')}`, text);
      let directory = dirname(file);
      while (directory.startsWith(root) && directory !== root) {
        const packageFile = join(directory, 'package.json');
        if (existingFile(packageFile)?.isFile()) {
          const metadata = JSON.parse(readFileSync(packageFile, 'utf8'));
          modules.set(`.graphscript-local/${relative(root, directory).split(sep).join('/')}/package.json`, JSON.stringify({
            type: metadata.type === 'module' ? 'module' : 'commonjs',
            ...(typeof metadata.main === 'string' && { main: metadata.main }),
            ...(typeof metadata.types === 'string' && { types: metadata.types }),
            ...(typeof metadata.typings === 'string' && { typings: metadata.typings }),
          }) + '\n');
        }
        directory = dirname(directory);
      }
    }
    if (file.endsWith('.json')) continue;
    const ast = parse(text, { sourceType: 'unambiguous', plugins: ['typescript', 'decorators', 'decoratorAutoAccessors'] });
    traverse(ast, { enter(path) {
      const node = path.node;
      let specifier;
      if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type)) specifier = node.source;
      else if (node.type === 'TSImportType') specifier = node.argument;
      else if (node.type === 'ImportExpression') specifier = node.source;
      else if (node.type === 'CallExpression' && (node.callee.type === 'Import'
        || isNodeRequire(path, node.callee))) specifier = node.arguments[0];
      if (specifier?.type === 'StringLiteral') resolveDependency(file, specifier.value,
        typeOnly || node.type === 'TSImportType' || node.importKind === 'type' || node.exportKind === 'type');
    } });
  }
  if (modules.size) {
    const packageFile = join(root, 'package.json');
    const packageType = existingFile(packageFile)?.isFile() ? JSON.parse(readFileSync(packageFile, 'utf8')).type : undefined;
    modules.set('.graphscript-local/package.json', JSON.stringify({ type: packageType === 'module' ? 'module' : 'commonjs' }) + '\n');
  }
  return { modules, declarationPaths };
}

function writeOutput(output, modules) {
  const directory = existingFile(output);
  if (directory && !directory.isDirectory()) throw new Error('Build output must be a directory, not a symbolic link');
  const manifestPath = join(output, '.graphscript-build.json');
  const manifestFile = existingFile(manifestPath);
  let previous = new Map();
  if (manifestFile) {
    if (!manifestFile.isFile()) throw new Error('Build manifest must be a regular file');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifestFile.nlink !== 1) throw new Error(`Build output was modified: ${manifestPath}`);
    if (manifest.version !== 1 || !Array.isArray(manifest.files)
      || manifest.files.some(entry => !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string'
        || !(basename(entry[0]) === entry[0] && (/\.(mjs|mts)$/.test(entry[0]) || entry[0] === 'package.json')
          || entry[0].startsWith('.graphscript-local/') && entry[0].split('/').every(part => part && part !== '.' && part !== '..' && !part.includes('\\')))
        || !/^[a-f0-9]{64}$/.test(entry[1]))) {
      throw new Error('Invalid build manifest');
    }
    previous = new Map(manifest.files);
    if (previous.size !== manifest.files.length) throw new Error('Invalid build manifest');
  }
  for (const name of new Set([...previous.keys(), ...modules.keys()])) {
    let directory = output;
    for (const part of name.split('/').slice(0, -1)) {
      directory = join(directory, part);
      const info = existingFile(directory);
      if (info && !info.isDirectory()) throw new Error(`Build output directory is not a directory: ${directory}`);
    }
  }
  for (const [name, hash] of previous) {
    const file = join(output, name);
    const info = existingFile(file);
    if (info && (!info.isFile() || info.nlink !== 1 || digest(readFileSync(file)) !== hash)) throw new Error(`Build output was modified: ${file}`);
  }
  for (const name of modules.keys()) {
    const file = join(output, name);
    if (!previous.has(name) && existingFile(file)) throw new Error(`Build output already exists: ${file}`);
  }
  mkdirSync(output, { recursive: true });
  const staging = mkdtempSync(join(output, '.graphscript-build-'));
  const backups = [];
  const installed = [];
  let keepStaging = false;
  try {
    const staged = new Map();
    for (const [name, content] of modules) {
      const file = join(staging, `new-${staged.size}`);
      writeFileSync(file, content, { flag: 'wx' });
      staged.set(name, file);
    }
    const manifest = { version: 1, files: [...modules].map(([name, content]) => [name, digest(content)]) };
    const stagedManifest = join(staging, 'manifest');
    writeFileSync(stagedManifest, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
    for (const name of [...previous.keys(), ...(manifestFile ? ['.graphscript-build.json'] : [])]) {
      const file = join(output, name);
      if (!existingFile(file)) continue;
      const backup = join(staging, `old-${backups.length}`);
      renameSync(file, backup);
      backups.push([file, backup]);
    }
    for (const [name, file] of staged) {
      const target = join(output, name);
      mkdirSync(dirname(target), { recursive: true });
      const info = lstatSync(file);
      const hash = digest(readFileSync(file));
      renameSync(file, target);
      installed.push({ file: target, dev: info.dev, ino: info.ino, hash });
    }
    const manifestInfo = lstatSync(stagedManifest);
    const manifestHash = digest(readFileSync(stagedManifest));
    renameSync(stagedManifest, manifestPath);
    installed.push({ file: manifestPath, dev: manifestInfo.dev, ino: manifestInfo.ino, hash: manifestHash });
  } catch (error) {
    const rollbackErrors = [];
    for (const { file, dev, ino, hash } of installed.reverse()) {
      try {
        const info = existingFile(file);
        if (!info) continue;
        if (!info.isFile() || info.nlink !== 1 || info.dev !== dev || info.ino !== ino || digest(readFileSync(file)) !== hash) {
          throw new Error(`Cannot remove modified output: ${file}`);
        }
        rmSync(file, { force: true });
      } catch (rollbackError) { rollbackErrors.push(rollbackError.message); }
    }
    for (const [file, backup] of backups.reverse()) {
      try {
        if (existingFile(file)) throw new Error(`Cannot restore over existing output: ${file}`);
        renameSync(backup, file);
      } catch (rollbackError) { rollbackErrors.push(rollbackError.message); }
    }
    if (rollbackErrors.length) {
      keepStaging = true;
      throw new Error(`${error.message}; rollback failed: ${rollbackErrors.join('; ')}; recovery files: ${staging}`);
    }
    throw error;
  } finally {
    if (!keepStaging) rmSync(staging, { recursive: true, force: true });
  }
}

function buildProject(project, options = {}) {
  const result = checkProject(project);
  if (!result.ok) return result;
  if (result.mode === 'program') return buildProgram(project, result, options);
  return buildLibrary(project, options);
}

function buildProgram(project, result, { language = 'javascript' } = {}) {
  if (!['javascript', 'typescript'].includes(language)) throw new Error(`Unsupported output language: ${language}`);
  if (language === 'javascript') return bundleJavaScriptProgram(project, result);
  return bundleTypeScriptProgram(project, result);
}

function emitProgramModules(project, result, nodePaths, language) {
  const modules = new Map();
  const extension = language === 'typescript' ? 'mts' : 'mjs';
  const pending = [{ file: result.programStart, output: `main.${extension}` }];
  const visited = new Set();
  let hasGraph = false;
  let needsImportGuard = false;
  let needsNativeRequire = false;
  let namespaceIndex = 0;
  function isTypeReference(reference) {
    return reference.findParent(parent => parent.isTSType() || parent.isTSTypeAliasDeclaration()
      || parent.isTSInterfaceDeclaration() || parent.isTSDeclareFunction());
  }
  function emitNamespace(names) {
    const target = `.graphscript-program-namespace-${namespaceIndex++}.${extension}`;
    const exports = [...names].sort().map(name => {
      const nodeTarget = `.graphscript-program-${name}.${extension}`;
      pending.push({ file: nodePaths[name], output: nodeTarget });
      return `export { ${name} } from ${JSON.stringify(`./${nodeTarget.replace(/\.mts$/, '.mjs')}`)};`;
    });
    modules.set(target, exports.join('\n') + '\n');
    return target;
  }
  while (pending.length) {
    const { file, output } = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    const text = readFileSync(file, 'utf8');
    const ast = parse(text, { sourceType: 'module', plugins: ['typescript', 'decorators', 'decoratorAutoAccessors'] });
    const edits = [];
    const typeBindings = new Map();
    traverse(ast, { 'TSTypeReference|TSTypeQuery'(path) {
      let reference = path.node.typeName ?? path.node.exprName;
      let member;
      while (reference?.type === 'TSQualifiedName') {
        member = reference.right.name;
        reference = reference.left;
      }
      if (reference?.type !== 'Identifier') return;
      const binding = path.scope.getBinding(reference.name);
      if (!binding) return;
      if (!typeBindings.has(binding)) typeBindings.set(binding, new Set());
      if (member) typeBindings.get(binding).add(member);
    } });
    let unsupported = false;
    let importGuard;
    let requireFactory;
    let requireType;
    let importEqualsFactory;
    let runtimeRequire = false;
    let memberRequire;
    let graphRequireTarget;
    let graphRequireType;
    function includeGraphRequire(scope) {
      graphRequireTarget ??= `./${emitNamespace(Object.keys(nodePaths)).replace(/\.mts$/, '.mjs')}`;
      graphRequireType ??= scope.generateUidIdentifier('graphscriptRequiredGraph').name;
    }
    function requireValueMayLoadGraph(path) {
      let value = path;
      const member = value.parentPath;
      if (member.isMemberExpression() && member.node.object === value.node && !member.node.computed
        && member.node.property.name === 'bind' && member.parentPath.isCallExpression()
        && member.parentPath.node.callee === member.node && member.parentPath.node.arguments.length <= 1) {
        value = member.parentPath;
      }
      const parent = value.parentPath;
      if ((parent.isCallExpression() || parent.isOptionalCallExpression()) && parent.node.callee === value.node) return false;
      if (parent.isVariableDeclarator() && parent.node.init === value.node && parent.node.id.type === 'Identifier') {
        const binding = parent.scope.getBinding(parent.node.id.name);
        if (binding?.constant && binding.referencePaths.every(reference => {
          const call = reference.parentPath;
          return (call.isCallExpression() || call.isOptionalCallExpression()) && call.node.callee === reference.node
            && call.node.arguments[0]?.type === 'StringLiteral' && call.node.arguments[0].value !== '@graph';
        })) return false;
      }
      return true;
    }
    traverse(ast, { enter(path) {
      const node = path.node;
      if (node.type === 'TSImportEqualsDeclaration' && node.moduleReference?.type === 'TSExternalModuleReference'
        && node.moduleReference.expression?.value === '@graph') {
        hasGraph = true;
        const target = emitNamespace(Object.keys(nodePaths)).replace(/\.mts$/, '.mjs');
        const specifier = JSON.stringify(`./${target}`);
        let replacement;
        if (node.importKind === 'type') {
          replacement = `import type * as ${node.id.name} from ${specifier};`;
        } else {
          importEqualsFactory ??= path.scope.getProgramParent().generateUidIdentifier('graphscriptImportRequire').name;
          const type = language === 'typescript' ? ` as typeof import(${specifier})` : '';
          replacement = `${node.isExport ? 'export ' : ''}const ${node.id.name} = ${importEqualsFactory}(import.meta.url)(${specifier})${type};`;
        }
        edits.push({ start: node.start, end: node.end, text: replacement });
      } else if (node.type === 'TSImportEqualsDeclaration' && node.moduleReference?.type === 'TSExternalModuleReference'
        && node.importKind !== 'type' && language === 'javascript') {
        importEqualsFactory ??= path.scope.getProgramParent().generateUidIdentifier('graphscriptImportRequire').name;
        const specifier = text.slice(node.moduleReference.expression.start, node.moduleReference.expression.end);
        edits.push({ start: node.start, end: node.end,
          text: `${node.isExport ? 'export ' : ''}const ${node.id.name} = ${importEqualsFactory}(import.meta.url)(${specifier});` });
      } else if (['ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source?.value === '@graph') {
        hasGraph = true;
        if (language === 'javascript' && node.exportKind === 'type') {
          edits.push({ start: node.start, end: node.end, text: '' });
        } else if (node.type === 'ExportAllDeclaration' || node.specifiers.some(specifier => specifier.type === 'ExportNamespaceSpecifier')) {
          const target = emitNamespace(Object.keys(nodePaths)).replace(/\.mts$/, '.mjs');
          edits.push({ start: node.source.start, end: node.source.end, text: JSON.stringify(`./${target}`) });
        } else {
          const exports = node.specifiers.map(specifier => {
            if (language === 'javascript' && specifier.exportKind === 'type') return '';
            const name = specifier.local.name ?? specifier.local.value;
            if (!nodePaths[name]) { unsupported = true; return ''; }
            const target = `.graphscript-program-${name}.${extension}`;
            pending.push({ file: nodePaths[name], output: target });
            const type = node.exportKind === 'type' ? 'type ' : '';
            return `export ${type}{ ${text.slice(specifier.start, specifier.end)} } from ${JSON.stringify(`./${target.replace(/\.mts$/, '.mjs')}`)};`;
          });
          edits.push({ start: node.start, end: node.end, text: exports.join('\n') });
        }
      } else if (node.type === 'ImportDeclaration' && node.source.value === '@graph') {
        hasGraph = true;
        if (!node.specifiers.length || node.specifiers.length === 1 && node.specifiers[0].type === 'ImportNamespaceSpecifier') {
          const names = new Set();
          if (!node.specifiers.length) {
            for (const graphName of Object.keys(nodePaths)) names.add(graphName);
          }
          const binding = node.specifiers.length ? path.scope.getBinding(node.specifiers[0].local.name) : undefined;
          if (language === 'typescript' && binding) {
            for (const name of typeBindings.get(binding) ?? []) names.add(name);
          }
          for (const reference of binding?.referencePaths ?? []) {
            if (language === 'javascript' && (node.importKind === 'type' || isTypeReference(reference))) continue;
            const member = reference.parentPath;
            const property = member.node.property;
            const name = member.isMemberExpression() && member.node.object === reference.node
              ? (!member.node.computed && property.type === 'Identifier' ? property.name
                : member.node.computed && property.type === 'StringLiteral' ? property.value : undefined)
              : member.isTSQualifiedName() && member.node.left === reference.node ? member.node.right.name : undefined;
            if (!name || !nodePaths[name]) {
              for (const graphName of Object.keys(nodePaths)) names.add(graphName);
              break;
            }
            names.add(name);
          }
          if (unsupported) return;
          const target = emitNamespace(names);
          edits.push({ start: node.source.start, end: node.source.end,
            text: JSON.stringify(`./${target.replace(/\.mts$/, '.mjs')}`) });
          return;
        }
        if (!node.specifiers.length || node.specifiers.some(specifier => specifier.type !== 'ImportSpecifier')) {
          unsupported = true;
          return;
        }
        const imports = node.specifiers.map(specifier => {
          const binding = path.scope.getBinding(specifier.local.name);
          if (!binding || !binding.referenced && !(language === 'typescript' && typeBindings.has(binding))) return '';
          if (language === 'javascript' && (node.importKind === 'type' || specifier.importKind === 'type'
            || binding.referencePaths.every(isTypeReference))) return '';
          const name = specifier.imported.name ?? specifier.imported.value;
          if (!nodePaths[name]) { unsupported = true; return ''; }
          const target = `.graphscript-program-${name}.${extension}`;
          pending.push({ file: nodePaths[name], output: target });
          const type = node.importKind === 'type' ? 'type ' : '';
          return `import ${type}{ ${text.slice(specifier.start, specifier.end)} } from ${JSON.stringify(`./${target.replace(/\.mts$/, '.mjs')}`)};`;
        });
        edits.push({ start: node.start, end: node.end, text: imports.join('\n') });
      } else if (node.type === 'TSImportType' && node.argument?.value === '@graph') {
        if (language === 'javascript') return;
        let qualifier = node.qualifier;
        while (qualifier?.type === 'TSQualifiedName') qualifier = qualifier.left;
        const name = qualifier?.type === 'Identifier' ? qualifier.name : undefined;
        if (node.qualifier && (!name || !nodePaths[name])) { unsupported = true; return; }
        let target;
        if (name) {
          target = `.graphscript-program-${name}.${extension}`;
          pending.push({ file: nodePaths[name], output: target });
        } else {
          target = emitNamespace(Object.keys(nodePaths));
        }
        edits.push({ start: node.argument.start, end: node.argument.end,
          text: JSON.stringify(`./${target.replace(/\.mts$/, '.mjs')}`) });
      } else if ((node.type === 'ImportExpression' && node.source?.value === '@graph')
        || (node.type === 'CallExpression' && node.callee.type === 'Import' && node.arguments[0]?.value === '@graph')) {
        unsupported = true;
      } else if (node.type === 'ImportExpression' || node.type === 'CallExpression' && node.callee.type === 'Import') {
        const specifier = node.type === 'ImportExpression' ? node.source : node.arguments[0];
        if (specifier && specifier.type !== 'StringLiteral') {
          importGuard ??= path.scope.getProgramParent().generateUidIdentifier('graphscriptImportSpecifier').name;
          needsImportGuard = true;
          edits.push({ start: specifier.start, end: specifier.start, text: `${importGuard}(` });
          edits.push({ start: specifier.end, end: specifier.end, text: ')' });
        }
      } else if (['MemberExpression', 'OptionalMemberExpression'].includes(node.type) && isNodeRequire(path, node)) {
        const scope = path.scope.getProgramParent();
        requireFactory ??= scope.generateUidIdentifier('graphscriptCreateRequire').name;
        memberRequire ??= scope.generateUidIdentifier('graphscriptRequire').name;
        needsNativeRequire = true;
        if (requireValueMayLoadGraph(path)) includeGraphRequire(scope);
        edits.push({ start: node.start, end: node.end, text: memberRequire });
      } else if (['CallExpression', 'OptionalCallExpression'].includes(node.type) && isNodeRequire(path, node.callee)) {
        const argument = node.arguments[0];
        if (argument && (argument.type !== 'StringLiteral' || argument.value === '@graph')) {
          includeGraphRequire(path.scope.getProgramParent());
        }
        let callee = node.callee;
        const aliases = new Set();
        while (callee.type === 'Identifier' && callee.name !== 'require') {
          const binding = path.scope.getBinding(callee.name);
          if (!binding?.constant || !binding.path.isVariableDeclarator() || aliases.has(binding)) break;
          aliases.add(binding);
          callee = binding.path.node.init;
          if (!callee) break;
        }
        if (['MemberExpression', 'OptionalMemberExpression'].includes(callee?.type)) return;
        if (callee?.type !== 'Identifier' || callee.name !== 'require') {
          unsupported = true;
          return;
        }
        const scope = path.scope.getProgramParent();
        requireFactory ??= scope.generateUidIdentifier('graphscriptCreateRequire').name;
        requireType ??= scope.generateUidIdentifier('graphscriptRequireType').name;
        runtimeRequire = true;
        needsNativeRequire = true;
      } else if (node.type === 'Identifier' && node.name === 'require' && path.isReferencedIdentifier()
        && !isTypeReference(path) && isNodeRequire(path, node)) {
        const scope = path.scope.getProgramParent();
        requireFactory ??= scope.generateUidIdentifier('graphscriptCreateRequire').name;
        requireType ??= scope.generateUidIdentifier('graphscriptRequireType').name;
        runtimeRequire = true;
        needsNativeRequire = true;
        if (requireValueMayLoadGraph(path)) includeGraphRequire(scope);
      }
    } });
    if (unsupported) return false;
    if (runtimeRequire) {
      for (const statement of ast.program.body) {
        if (!statement.declare) continue;
        if (statement.id?.name === 'require') edits.push({ start: statement.id.start, end: statement.id.end, text: requireType });
        for (const declaration of statement.declarations ?? []) {
          if (declaration.id.type === 'Identifier' && declaration.id.name === 'require') {
            edits.push({ start: declaration.id.start, end: declaration.id.end, text: requireType });
          }
        }
      }
    }
    let rewritten = text;
    for (const edit of edits.sort((left, right) => right.start - left.start)) {
      rewritten = rewritten.slice(0, edit.start) + edit.text + rewritten.slice(edit.end);
    }
    if (importGuard) rewritten = `import { importSpecifier as ${importGuard} } from "./.graphscript-program-import-guard.mjs";\n${rewritten}`;
    if (graphRequireTarget && language === 'typescript') {
      rewritten = `type ${graphRequireType} = typeof import(${JSON.stringify(graphRequireTarget)});\n${rewritten}`;
    }
    if (importEqualsFactory) rewritten = `import { createRequire as ${importEqualsFactory} } from "node:module";\n${rewritten}`;
    if (requireFactory) {
      const hasDeclaration = edits.some(edit => edit.text === requireType);
      const type = language === 'typescript' && hasDeclaration ? ` as typeof ${requireType}` : '';
      const name = runtimeRequire ? 'require' : memberRequire;
      const alias = runtimeRequire && memberRequire ? `const ${memberRequire} = require;\n` : '';
      const target = graphRequireTarget ? `args[0] === "@graph" ? ${JSON.stringify(graphRequireTarget)} : ` : '';
      rewritten = `import { createRequire as ${requireFactory} } from "node:module";\nconst ${name} = new Proxy(${requireFactory}(import.meta.url), { apply(target, receiver, args) { args[0] = ${target}${relativeImportGuardPrefix()}args[0]); return Reflect.apply(target, receiver, args); } })${type};\n${alias}${rewritten}`;
    }
    modules.set(output, language === 'typescript' ? rewritten
      : require('esbuild').transformSync(rewritten, { loader: 'ts', target: 'es2022', format: 'esm' }).code);
  }
  if (!hasGraph && !needsNativeRequire) return false;
  if (needsImportGuard) {
    const type = language === 'typescript' ? ': unknown' : '';
    const guard = relativeImportGuardPrefix(false, true).replace('(specifier =>', `((specifier${type}) =>`);
    modules.set(`.graphscript-program-import-guard.${extension}`,
      `export function importSpecifier(specifier${type}) { return ${guard}specifier)${type ? ' as unknown as string' : ''}; }\n`);
  }
  writeOutput(join(resolve(project), 'dist'), modules);
  return true;
}

function bundleTypeScriptProgram(project, result) {
  const nodesDirectory = join(resolve(project), 'nodes');
  const files = readdirSync(nodesDirectory).filter(file => file.endsWith('.ts') && join(nodesDirectory, file) !== result.programStart);
  const nodePaths = Object.fromEntries(files.map(file => [file.slice(0, -3), join(nodesDirectory, file)]));
  if (emitProgramModules(project, result, nodePaths, 'typescript')) return result;
  const entry = Symbol('entry');
  const sources = new Map([...Object.entries(nodePaths), [entry, result.programStart]].map(([name, file]) => [name, readFileSync(file, 'utf8')]));
  let prefix = '__graphscriptModule';
  while ([...sources.values()].some(text => text.includes(prefix))) prefix += '_';
  const moduleNames = Object.fromEntries(files.map((file, index) => [file.slice(0, -3), `${prefix}${index}`]));
  const emitted = new Set();
  const visiting = new Set();
  const evaluationStack = [];
  const modules = [];
  const packageImports = [];
  const evaluatedPackages = new Set();
  let evaluatedModule = false;
  let unsafeExternalImport;
  const typeOnlyNodes = new Set();
  const functionCycles = new Set();
  const cycleFunctions = [];
  const cycleStates = [];
  const cycleNamespace = `${prefix}Cycle`;
  const cycleFunctionNames = Object.fromEntries(files.map((file, index) => [file.slice(0, -3), `${prefix}Function${index}`]));
  const cycleStateNames = Object.fromEntries(files.map((file, index) => [file.slice(0, -3), `${prefix}State${index}`]));
  const cycleCandidates = new Map();
  const classCandidates = new Map();
  for (const [name, file] of Object.entries(nodePaths)) {
    const ast = parse(sources.get(name), { sourceType: 'module', plugins: ['typescript', 'decorators', 'decoratorAutoAccessors'] });
    const classDeclaration = ast.program.body.find(statement => statement.type === 'ExportNamedDeclaration'
      && statement.declaration?.type === 'ClassDeclaration' && statement.declaration.id?.name === name);
    if (classDeclaration) classCandidates.set(name, {
      declaration: classDeclaration,
      dependencies: ast.program.body.filter(statement => statement.type === 'ImportDeclaration' && statement.source.value === '@graph'
        && statement.importKind !== 'type').flatMap(statement => statement.specifiers
        .filter(specifier => specifier.type === 'ImportSpecifier' && specifier.importKind !== 'type')
        .map(specifier => specifier.imported.name ?? specifier.imported.value)),
    });
    const declaration = ast.program.body.find(statement => statement.type === 'ExportNamedDeclaration'
      && (statement.declaration?.type === 'FunctionDeclaration' && statement.declaration.id?.name === name
        || statement.declaration?.type === 'VariableDeclaration' && statement.declaration.kind === 'const'
          && statement.declaration.declarations.length === 1 && statement.declaration.declarations[0].id.name === name));
    if (!declaration || ast.program.body.some(statement => statement !== declaration
      && statement.type !== 'ExpressionStatement' && statement.type !== 'ImportDeclaration')) continue;
    const dependencies = [];
    let eligible = true;
    traverse(ast, { ImportDeclaration(path) {
      if (path.node.source.value !== '@graph' && !path.node.source.value.startsWith('.') && !path.node.source.value.startsWith('/')) return;
      if (path.node.source.value !== '@graph' || path.node.importKind === 'type'
        || !path.node.specifiers.length || path.node.specifiers.some(specifier => specifier.type !== 'ImportSpecifier' || specifier.importKind === 'type')) {
        eligible = false;
        return;
      }
      for (const specifier of path.node.specifiers) {
        const binding = path.scope.getBinding(specifier.local.name);
        let used = false;
        path.scope.path.traverse({ Identifier(reference) {
          if (!reference.isReferencedIdentifier() || reference.scope.getBinding(reference.node.name) !== binding) return;
          used = true;
          if (reference.findParent(parent => parent.isTSType()
            || parent.isTSTypeAliasDeclaration() || parent.isTSInterfaceDeclaration())) eligible = false;
        } });
        if (used) dependencies.push(specifier.imported.name ?? specifier.imported.value);
      }
    }, CallExpression(path) {
      if (path.node.callee.type === 'Identifier' && path.node.callee.name === 'eval' && !path.scope.getBinding('eval')) eligible = false;
    }, Program(path) {
      if (declaration.declaration.type !== 'VariableDeclaration') return;
      const binding = path.scope.getBinding(name);
      path.traverse({ Identifier(reference) {
        if (reference.node.name === name && reference.isReferencedIdentifier() && reference.scope.getBinding(name) === binding
          && reference.findParent(parent => parent.isTSType() || parent.isTSTypeAliasDeclaration() || parent.isTSInterfaceDeclaration())) eligible = false;
      } });
    } });
    if (eligible) cycleCandidates.set(name, { dependencies, declaration,
      state: declaration.declaration.type === 'VariableDeclaration' });
  }
  function findCycles(name, stack = [], visited = new Set()) {
    const index = stack.indexOf(name);
    if (index !== -1) {
      for (const member of stack.slice(index)) functionCycles.add(member);
      return;
    }
    if (visited.has(name) || !cycleCandidates.has(name)) return;
    visited.add(name);
    stack.push(name);
    for (const dependency of cycleCandidates.get(name).dependencies) findCycles(dependency, stack, visited);
    stack.pop();
  }
  for (const name of cycleCandidates.keys()) findCycles(name);
  const classCycles = new Set();
  function findClassCycles(name, stack = [], visited = new Set()) {
    const index = stack.indexOf(name);
    if (index !== -1) {
      for (const member of stack.slice(index)) classCycles.add(member);
      return;
    }
    if (visited.has(name) || !classCandidates.has(name)) return;
    visited.add(name);
    stack.push(name);
    for (const dependency of classCandidates.get(name).dependencies) findClassCycles(dependency, stack, visited);
    stack.pop();
  }
  for (const name of classCandidates.keys()) findClassCycles(name);
  function findMixedCycles(name, stack = [], visited = new Set()) {
    const index = stack.indexOf(name);
    if (index !== -1) {
      for (const member of stack.slice(index)) {
        if (classCandidates.has(member)) classCycles.add(member);
        else functionCycles.add(member);
      }
      return;
    }
    const candidate = classCandidates.get(name) ?? cycleCandidates.get(name);
    if (visited.has(name) || !candidate) return;
    visited.add(name);
    stack.push(name);
    for (const dependency of candidate.dependencies) findMixedCycles(dependency, stack, visited);
    stack.pop();
  }
  for (const name of [...classCandidates.keys(), ...cycleCandidates.keys()]) findMixedCycles(name);
  for (const name of classCycles) {
    cycleStates.push(`let ${cycleStateNames[name]}Ready = false;\nfunction ${cycleStateNames[name]}Read(): typeof ${moduleNames[name]}.${name} {\n  if (!${cycleStateNames[name]}Ready) throw new ReferenceError(${JSON.stringify(`Cannot access '${name}' before initialization`)});\n  return ${moduleNames[name]}.${name};\n}`);
  }
  const liftedFunctions = new Set([...functionCycles].filter(name => !cycleCandidates.get(name).state));
  const unsupportedLiftedFunctions = new Set();
  let unsupported = false;
  let unsupportedAwait = false;
  for (const name of liftedFunctions) {
    for (const dependency of cycleCandidates.get(name).dependencies) {
      const candidate = cycleCandidates.get(dependency);
      if (!candidate) {
        if (!classCycles.has(dependency)) unsupportedLiftedFunctions.add(name);
      } else if (!candidate.state) liftedFunctions.add(dependency);
    }
  }
  const guardedStates = new Set([...functionCycles, ...liftedFunctions]
    .flatMap(name => [name, ...cycleCandidates.get(name).dependencies])
    .filter(name => cycleCandidates.get(name)?.state));
  let packageBindingIndex = 0;
  let needsRequire = false;
  function cycleValue(name) {
    if (classCycles.has(name)) return `(${cycleStateNames[name]}Read())`;
    if (guardedStates.has(name)) return `${cycleStateNames[name]}Read()`;
    if (!liftedFunctions.has(name)) return `${moduleNames[name]}.${name}`;
    return `${cycleNamespace}.${cycleFunctionNames[name]}`;
  }
  function localModule(name, specifier) {
    const sourceFile = name === entry ? result.programStart : nodePaths[name] ?? name;
    const target = resolve(dirname(sourceFile), specifier);
    const candidates = [target.replace(/\.js$/, '.ts'), target.replace(/\.mjs$/, '.mts'),
      target.replace(/\.cjs$/, '.cts'), target, `${target}.ts`, join(target, 'index.ts')];
    const file = candidates.find(candidate => /\.(?:ts|mts|cts)$/.test(candidate) && existingFile(candidate)?.isFile());
    if (!file) return;
    const graphName = Object.keys(nodePaths).find(key => nodePaths[key] === file);
    if (graphName) return graphName;
    if (!sources.has(file)) {
      sources.set(file, readFileSync(file, 'utf8'));
      moduleNames[file] = `${prefix}Local${packageBindingIndex++}`;
    }
    return file;
  }
  const localCandidates = new Map();
  const localCycles = new Set();
  const localFunctionNames = new Map();
  const localStateNames = new Map();
  const scanned = new Set();
  function scanLocal(name) {
    if (scanned.has(name)) return;
    scanned.add(name);
    const ast = parse(sources.get(name), { sourceType: 'module', plugins: ['typescript', 'decorators', 'decoratorAutoAccessors'] });
    const imports = ast.program.body.filter(statement => statement.type === 'ImportDeclaration');
    const dependencies = [];
    for (const statement of imports) {
      if (statement.source.value === '@graph') {
        for (const specifier of statement.specifiers) {
          const target = specifier.imported?.name ?? specifier.imported?.value;
          if (nodePaths[target]) scanLocal(target);
        }
      } else if (statement.source.value.startsWith('.') || statement.source.value.startsWith('/')) {
        const target = localModule(name, statement.source.value);
        if (target) { dependencies.push(target); scanLocal(target); }
      }
    }
    if (typeof name !== 'string' || nodePaths[name]) return;
    const declaration = ast.program.body.find(statement => statement.type === 'ExportNamedDeclaration'
      && statement.declaration?.type === 'FunctionDeclaration' && statement.declaration.id);
    const state = ast.program.body.filter(statement => statement.type === 'VariableDeclaration' && ['const', 'let'].includes(statement.kind)
      && statement.declarations.length === 1 && statement.declarations[0].id.type === 'Identifier');
    if (!declaration || ast.program.body.some(statement => statement !== declaration
      && statement.type !== 'ExpressionStatement' && statement.type !== 'ImportDeclaration' && !state.includes(statement))
      || imports.some(statement => !statement.source.value.startsWith('.')
        || statement.importKind === 'type' || statement.specifiers.some(specifier => specifier.type !== 'ImportSpecifier' || specifier.importKind === 'type'))) return;
    localCandidates.set(name, { declaration, dependencies, state });
    localFunctionNames.set(name, `${prefix}LocalFunction${packageBindingIndex++}`);
    localStateNames.set(name, new Map(state.map(statement => [statement.declarations[0].id.name, `${prefix}LocalState${packageBindingIndex++}`])));
  }
  scanLocal(entry);
  function findLocalCycles(name, stack = [], visited = new Set()) {
    const index = stack.indexOf(name);
    if (index !== -1) {
      for (const member of stack.slice(index)) localCycles.add(member);
      return;
    }
    if (visited.has(name) || !localCandidates.has(name)) return;
    visited.add(name);
    stack.push(name);
    for (const dependency of localCandidates.get(name).dependencies) findLocalCycles(dependency, stack, visited);
    stack.pop();
  }
  for (const name of localCandidates.keys()) findLocalCycles(name);
  for (const name of localCycles) {
    if (localCandidates.get(name).dependencies.some(dependency => !localCycles.has(dependency))) unsupported = true;
    for (const [stateName, stateId] of localStateNames.get(name)) {
      cycleStates.push(`let ${stateId}Ready = false;\nfunction ${stateId}Read(): typeof ${moduleNames[name]}.${stateName} {\n  if (!${stateId}Ready) throw new ReferenceError(${JSON.stringify(`Cannot access '${stateName}' before initialization`)});\n  return ${moduleNames[name]}.${stateName};\n}`);
      const declaration = localCandidates.get(name).state.find(statement => statement.declarations[0].id.name === stateName);
      if (declaration.kind === 'let') cycleStates.push(`const ${stateId}Binding = {\n  get value(): typeof ${moduleNames[name]}.${stateName} { return ${stateId}Read(); },\n  set value(value: typeof ${moduleNames[name]}.${stateName}) {\n    if (!${stateId}Ready) throw new ReferenceError(${JSON.stringify(`Cannot access '${stateName}' before initialization`)});\n    ${moduleNames[name]}.${stateName} = value;\n  }\n};`);
    }
  }
  function emit(name) {
    if (emitted.has(name)) return;
    if (visiting.has(name)) {
      const current = evaluationStack[evaluationStack.length - 1];
      current.low = Math.min(current.low, evaluationStack.findIndex(frame => frame.name === name));
      if (!functionCycles.has(name) && !classCycles.has(name) && !localCycles.has(name)) unsupported = true;
      return;
    }
    if (unsupportedLiftedFunctions.has(name)) unsupported = true;
    visiting.add(name);
    const frame = { name, low: evaluationStack.length, effects: false };
    evaluationStack.push(frame);
    const text = sources.get(name);
    const ast = parse(text, { sourceType: 'module', plugins: ['typescript', 'decorators', 'decoratorAutoAccessors'] });
    const edits = [];
    const bindings = [];
    let usesRequire = false;
    const namespaceMembers = new Map();
    const graphReferences = new Map();
    const packageDeclarations = new Map();
    const packageBindings = new Map();
    const runtimePackages = new Set();
    const awaitedStatements = new Set();
    const awaitedInitializers = new Map();
    traverse(ast, { AwaitExpression(path) {
      if (name === entry || path.getFunctionParent()) return;
      if (!nodePaths[name]) { unsupportedAwait = true; return; }
      const statement = path.findParent(parent => parent.parentPath?.isProgram());
      if (statement?.isExpressionStatement() || statement?.isIfStatement()
        || statement?.isForOfStatement() && statement.node.await) awaitedStatements.add(statement.node);
      else if (nodePaths[name] && statement?.isExportNamedDeclaration()
        && statement.node.declaration?.type === 'VariableDeclaration'
        && statement.node.declaration.declarations.length === 1
        && statement.node.declaration.declarations[0].init
        && path.node.start >= statement.node.declaration.declarations[0].init.start) {
        awaitedInitializers.set(statement.node, statement.node.declaration.declarations[0].init);
      }
      else unsupportedAwait = true;
    }, ForOfStatement(path) {
      if (name === entry || !path.node.await || path.getFunctionParent()) return;
      if (!nodePaths[name]) { unsupportedAwait = true; return; }
      const statement = path.parentPath.isProgram() ? path : path.findParent(parent => parent.parentPath?.isProgram());
      if (statement?.isForOfStatement() || statement?.isIfStatement()) awaitedStatements.add(statement.node);
      else unsupportedAwait = true;
    } });
    traverse(ast, { ImportDeclaration(path) {
      if (path.node.source.value === '@graph' || path.node.source.value.startsWith('.') || path.node.source.value.startsWith('/')) {
        for (const specifier of path.node.specifiers) {
          if (!['ImportSpecifier', 'ImportDefaultSpecifier', 'ImportNamespaceSpecifier'].includes(specifier.type)) continue;
          const binding = path.scope.getBinding(specifier.local.name);
          const references = [];
          path.scope.path.traverse({ Identifier(reference) {
            if (reference.isReferencedIdentifier() && reference.scope.getBinding(reference.node.name) === binding) references.push(reference);
          } });
          const runtime = references.some(reference => !reference.findParent(parent => parent.isTSType()
            || parent.isTSTypeAliasDeclaration() || parent.isTSInterfaceDeclaration()));
          graphReferences.set(specifier, { used: references.length > 0, runtime, paths: references });
        }
      }
      if (path.node.source.value !== '@graph' && !path.node.source.value.startsWith('.') && !path.node.source.value.startsWith('/')) {
        if (!path.node.specifiers.length) runtimePackages.add(path.node);
        const importEdits = [];
        for (const specifier of path.node.specifiers) {
          const local = specifier.local.name;
          const replacement = `${prefix}Import${packageBindingIndex++}`;
          packageBindings.set(specifier, replacement);
          if (specifier.type === 'ImportSpecifier' && specifier.imported.start === specifier.local.start) {
            importEdits.push({ start: specifier.local.end, end: specifier.local.end, text: ` as ${replacement}` });
          } else {
            importEdits.push({ start: specifier.local.start, end: specifier.local.end, text: replacement });
          }
          const binding = path.scope.getBinding(local);
          path.scope.path.traverse({ Identifier(reference) {
            if (!reference.isReferencedIdentifier() || reference.scope.getBinding(reference.node.name) !== binding) return;
            if (path.node.importKind !== 'type' && specifier.importKind !== 'type'
              && !reference.findParent(parent => parent.isTSType() || parent.isTSTypeAliasDeclaration() || parent.isTSInterfaceDeclaration())) runtimePackages.add(path.node);
            const lifted = liftedFunctions.has(name) && cycleCandidates.get(name).declaration.declaration;
            if (lifted && reference.node.start >= lifted.start && reference.node.end <= lifted.end) return;
            const parent = reference.parentPath;
            const shorthand = parent.isObjectProperty() && parent.node.shorthand && parent.node.value === reference.node;
            const exported = parent.isExportSpecifier() && parent.node.local === reference.node && parent.node.exported.start === reference.node.start;
            edits.push({ start: reference.node.start, end: reference.node.end,
              text: shorthand ? `${local}: ${replacement}` : exported ? `${replacement} as ${local}` : replacement });
          } });
        }
        let declaration = text.slice(path.node.start, path.node.end);
        for (const edit of importEdits.sort((left, right) => right.start - left.start)) {
          const start = edit.start - path.node.start;
          const end = edit.end - path.node.start;
          declaration = declaration.slice(0, start) + edit.text + declaration.slice(end);
        }
        packageDeclarations.set(path.node, declaration);
      }
      const specifier = path.node.specifiers[0];
      if (path.node.source.value !== '@graph' || path.node.specifiers.length !== 1 || specifier?.type !== 'ImportNamespaceSpecifier') return;
      if (path.node.importKind === 'type') {
        const binding = path.scope.getBinding(specifier.local.name);
        path.scope.path.traverse({ Identifier(reference) {
          if (!reference.isReferencedIdentifier() || reference.scope.getBinding(reference.node.name) !== binding) return;
          const parent = reference.parentPath;
          const target = parent.isTSQualifiedName() && parent.node.left === reference.node ? parent.node.right.name : undefined;
          if (!target || !nodePaths[target]) { unsupported = true; return; }
          typeOnlyNodes.add(target);
          edits.push({ start: reference.node.start, end: reference.node.end, text: moduleNames[target] });
        } });
        namespaceMembers.set(path.node, null);
        return;
      }
      const names = new Set();
      for (const reference of path.scope.getBinding(specifier.local.name).referencePaths) {
        const member = reference.parentPath;
        if (!member.isMemberExpression() || member.node.object !== reference.node) { unsupported = true; return; }
        const property = member.node.property;
        const target = !member.node.computed && property.type === 'Identifier' ? property.name
          : member.node.computed && property.type === 'StringLiteral' ? property.value : undefined;
        if (!target || !nodePaths[target]) { unsupported = true; return; }
        names.add(target);
      }
      namespaceMembers.set(path.node, [...names]);
    } });
    for (const statement of ast.program.body) {
      if (localCycles.has(name) && statement.start === localCandidates.get(name).declaration.start) {
        const declaration = statement.declaration;
        const functionEdits = [];
        traverse(ast, { ImportDeclaration(path) {
          const target = localModule(name, path.node.source.value);
          for (const specifier of path.node.specifiers) {
            const imported = specifier.imported.name ?? specifier.imported.value;
            if (localCandidates.get(target)?.declaration.declaration.id.name !== imported) { unsupported = true; continue; }
            const binding = path.scope.getBinding(specifier.local.name);
            path.scope.path.traverse({ Identifier(reference) {
              if (!reference.isReferencedIdentifier() || reference.scope.getBinding(reference.node.name) !== binding) return;
              if (reference.node.start < declaration.start || reference.node.end > declaration.end) return;
              const parent = reference.parentPath;
              const shorthand = parent.isObjectProperty() && parent.node.shorthand && parent.node.value === reference.node;
              const member = `${cycleNamespace}.${localFunctionNames.get(target)}`;
              const type = reference.findParent(ancestor => ancestor.isTSType() || ancestor.isTSTypeAliasDeclaration() || ancestor.isTSInterfaceDeclaration());
              functionEdits.push({ start: reference.node.start - declaration.start, end: reference.node.end - declaration.start,
                text: type ? member : shorthand ? `${specifier.local.name}: ${member}` : `(void 0, ${member})` });
            } });
          }
        }, Program(path) {
          for (const [stateName, stateId] of localStateNames.get(name)) {
            const binding = path.scope.getBinding(stateName);
            const stateDeclaration = localCandidates.get(name).state.find(item => item.declarations[0].id.name === stateName);
            path.traverse({ Identifier(reference) {
              const assigned = reference.parentPath.isAssignmentExpression() && reference.parentPath.node.left === reference.node;
              if (!reference.isReferencedIdentifier() && !assigned || reference.scope.getBinding(reference.node.name) !== binding
                || reference.node.start < declaration.start || reference.node.end > declaration.end) return;
              const parent = reference.parentPath;
              const shorthand = parent.isObjectProperty() && parent.node.shorthand && parent.node.value === reference.node;
              const type = reference.findParent(ancestor => ancestor.isTSType() || ancestor.isTSTypeAliasDeclaration() || ancestor.isTSInterfaceDeclaration());
              const value = type ? `${moduleNames[name]}.${stateName}` : stateDeclaration.kind === 'let' ? `${stateId}Binding.value` : `(${stateId}Read())`;
              functionEdits.push({ start: reference.node.start - declaration.start, end: reference.node.end - declaration.start,
                text: shorthand ? `${stateName}: ${value}` : value });
            } });
          }
        } });
        let output = text.slice(declaration.start, declaration.end);
        for (const edit of functionEdits.sort((left, right) => right.start - left.start)) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
        cycleFunctions.push(`export const ${localFunctionNames.get(name)} = ${output};`);
        bindings.push(`export const ${declaration.id.name} = ${cycleNamespace}.${localFunctionNames.get(name)};`);
        edits.push({ start: statement.start, end: statement.end, text: '' });
      }
      if (localCycles.has(name) && localCandidates.get(name).state.some(item => item.start === statement.start)) {
        const stateId = localStateNames.get(name).get(statement.declarations[0].id.name);
        edits.push({ start: statement.start, end: statement.start, text: 'export ' });
        edits.push({ start: statement.end, end: statement.end, text: `\n${stateId}Ready = true;` });
      }
      if (classCycles.has(name) && statement.start === classCandidates.get(name).declaration.start) {
        edits.push({ start: statement.end, end: statement.end, text: `\n${cycleStateNames[name]}Ready = true;` });
      }
      if (statement.type === 'ExportDefaultDeclaration') {
        if (!['FunctionDeclaration', 'ClassDeclaration'].includes(statement.declaration.type) || !statement.declaration.id) unsupported = true;
        else edits.push({ start: statement.start, end: statement.declaration.start, text: 'export ' });
      }
      if (liftedFunctions.has(name) && statement.type === 'ExportNamedDeclaration'
        && statement.declaration?.type === 'FunctionDeclaration' && statement.declaration.id?.name === name) {
        const declaration = statement.declaration;
        const functionEdits = [];
        traverse(ast, { ImportDeclaration(path) {
          for (const specifier of path.node.specifiers) {
            const external = packageBindings.get(specifier);
            const target = external ? undefined : specifier.imported.name ?? specifier.imported.value;
            const binding = path.scope.getBinding(specifier.local.name);
            path.scope.path.traverse({ Identifier(reference) {
              if (!reference.isReferencedIdentifier() || reference.scope.getBinding(reference.node.name) !== binding
                || reference.node.start < declaration.start || reference.node.end > declaration.end) return;
              const parent = reference.parentPath;
              const shorthand = parent.isObjectProperty() && parent.node.shorthand && parent.node.value === reference.node;
              const member = external ?? cycleValue(target);
              functionEdits.push({ start: reference.node.start - declaration.start, end: reference.node.end - declaration.start,
                text: shorthand ? `${specifier.local.name}: ${member}` : external ? member : `(void 0, ${member})` });
            } });
          }
        } });
        let output = text.slice(declaration.start, declaration.end);
        for (const edit of functionEdits.sort((left, right) => right.start - left.start)) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
        cycleFunctions.push(`export const ${cycleFunctionNames[name]} = ${output};`);
        bindings.push(`export const ${name} = ${cycleNamespace}.${cycleFunctionNames[name]};`);
        edits.push({ start: statement.start, end: statement.end, text: '' });
      }
      if (guardedStates.has(name) && statement.start === cycleCandidates.get(name).declaration.start) {
        cycleStates.push(`let ${cycleStateNames[name]}Ready = false;\nfunction ${cycleStateNames[name]}Read(): typeof ${moduleNames[name]}.${name} {\n  if (!${cycleStateNames[name]}Ready) throw new ReferenceError(${JSON.stringify(`Cannot access '${name}' before initialization`)});\n  return ${moduleNames[name]}.${name};\n}`);
        edits.push({ start: statement.end, end: statement.end, text: `\n${cycleStateNames[name]}Ready = true;` });
        traverse(ast, { Program(path) {
          for (const reference of path.scope.getBinding(name).referencePaths) {
            if (!reference.isIdentifier()) continue;
            const parent = reference.parentPath;
            const shorthand = parent.isObjectProperty() && parent.node.shorthand && parent.node.value === reference.node;
            edits.push({ start: reference.node.start, end: reference.node.end,
              text: shorthand ? `${name}: ${cycleValue(name)}` : cycleValue(name) });
          }
          path.stop();
        } });
      }
      if (statement.type === 'ExportNamedDeclaration' && !statement.source && statement.specifiers.length) {
        const specifier = statement.specifiers[0];
        if (statement.specifiers.length !== 1 || specifier.exported.name !== 'default' || specifier.local.type !== 'Identifier') unsupported = true;
        else {
          const declaration = ast.program.body.find(item =>
            (item.type === 'VariableDeclaration' && item.declarations.some(declaration => declaration.id.type === 'Identifier' && declaration.id.name === specifier.local.name))
            || (['FunctionDeclaration', 'ClassDeclaration'].includes(item.type) && item.id?.name === specifier.local.name));
          if (!declaration) unsupported = true;
          else {
            edits.push({ start: declaration.start, end: declaration.start, text: 'export ' });
            edits.push({ start: statement.start, end: statement.end, text: '' });
          }
        }
      }
      if (statement.type !== 'ImportDeclaration') continue;
      if (statement.source.value !== '@graph') {
        if (statement.source.value.startsWith('.') || statement.source.value.startsWith('/')) {
          const target = localModule(name, statement.source.value);
          if (!target || statement.specifiers.some(specifier => !['ImportSpecifier', 'ImportDefaultSpecifier', 'ImportNamespaceSpecifier'].includes(specifier.type))) { unsupported = true; continue; }
          if (!statement.specifiers.length) emit(target);
          for (const specifier of statement.specifiers) {
            const references = graphReferences.get(specifier);
            const explicitType = statement.importKind === 'type' || specifier.importKind === 'type';
            if (!references.used && !explicitType) continue;
            if (explicitType || !references.runtime) typeOnlyNodes.add(target);
            else emit(target);
            if (specifier.type === 'ImportNamespaceSpecifier') {
              bindings.push(`import ${specifier.local.name} = ${moduleNames[target]};`);
              continue;
            }
            let imported = specifier.imported?.name ?? specifier.imported?.value;
            if (specifier.type === 'ImportDefaultSpecifier' || imported === 'default') {
              const targetAst = parse(sources.get(target), { sourceType: 'module', plugins: ['typescript', 'decorators', 'decoratorAutoAccessors'] });
              const declaration = targetAst.program.body.find(item => item.type === 'ExportDefaultDeclaration')?.declaration;
              const exported = targetAst.program.body.flatMap(item => item.type === 'ExportNamedDeclaration' && !item.source ? item.specifiers : [])
                .find(item => item.exported.name === 'default');
              if (declaration && ['FunctionDeclaration', 'ClassDeclaration'].includes(declaration.type) && declaration.id) imported = declaration.id.name;
              else if (exported?.local.type === 'Identifier') imported = exported.local.name;
              else { unsupported = true; continue; }
            }
            const member = localCycles.has(target) && localCandidates.get(target).declaration.declaration.id.name === imported
              ? `${cycleNamespace}.${localFunctionNames.get(target)}` : `${moduleNames[target]}.${imported}`;
            if (explicitType || !references.runtime) bindings.push(`import ${specifier.local.name} = ${member};`);
            else for (const reference of references.paths) {
              const lifted = localCycles.has(name) && localCandidates.get(name).declaration;
              if (lifted && reference.node.start >= lifted.start && reference.node.end <= lifted.end) continue;
              const parent = reference.parentPath;
              const shorthand = parent.isObjectProperty() && parent.node.shorthand && parent.node.value === reference.node;
              const call = (parent.isCallExpression() || parent.isOptionalCallExpression()) && parent.node.callee === reference.node;
              edits.push({ start: reference.node.start, end: reference.node.end,
                text: shorthand ? `${specifier.local.name}: ${member}` : call ? `(void 0, ${member})` : member });
            }
          }
          edits.push({ start: statement.start, end: statement.end, text: '' });
          continue;
        }
        if (runtimePackages.has(statement) && !evaluatedPackages.has(statement.source.value)) {
          if (evaluatedModule && !unsafeExternalImport) unsafeExternalImport = { name, statement };
          evaluatedPackages.add(statement.source.value);
        }
        packageImports.push(packageDeclarations.get(statement));
        edits.push({ start: statement.start, end: statement.end, text: '' });
        continue;
      }
      if (namespaceMembers.has(statement)) {
        const names = namespaceMembers.get(statement);
        if (names === null) {
          edits.push({ start: statement.start, end: statement.end, text: '' });
          continue;
        }
        for (const target of names) emit(target);
        const local = statement.specifiers[0].local.name;
        const getters = names.map(target => `get ${JSON.stringify(target)}() { return ${classCycles.has(target) ? `${cycleStateNames[target]}Read()` : `${moduleNames[target]}.${target}`}; }`);
        bindings.push(`const ${local} = { ${getters.join(', ')}${getters.length ? ', ' : ''}[Symbol.toStringTag]: "Module" };\nObject.setPrototypeOf(${local}, null);\nObject.freeze(${local});`);
        edits.push({ start: statement.start, end: statement.end, text: '' });
        continue;
      }
      if (!statement.specifiers.length || statement.specifiers.some(specifier => specifier.type !== 'ImportSpecifier')) { unsupported = true; continue; }
      const aliases = [];
      for (const specifier of statement.specifiers) {
        const references = graphReferences.get(specifier);
        const explicitType = statement.importKind === 'type' || specifier.importKind === 'type';
        if (!references.used && !explicitType) continue;
        const target = specifier.imported.name ?? specifier.imported.value;
        if (!nodePaths[target]) { unsupported = true; continue; }
        if (explicitType || !references.runtime) typeOnlyNodes.add(target);
        else emit(target);
        if ((guardedStates.has(target) || classCycles.has(target)) && !explicitType && references.runtime) {
          for (const reference of references.paths) {
            const lifted = liftedFunctions.has(name) && cycleCandidates.get(name).declaration;
            if (lifted && reference.node.start >= lifted.start && reference.node.end <= lifted.end) continue;
            const parent = reference.parentPath;
            const shorthand = parent.isObjectProperty() && parent.node.shorthand && parent.node.value === reference.node;
            const type = reference.findParent(ancestor => ancestor.isTSType() || ancestor.isTSTypeAliasDeclaration() || ancestor.isTSInterfaceDeclaration());
            const value = classCycles.has(target) ? `(${cycleStateNames[target]}Read())` : cycleValue(target);
            edits.push({ start: reference.node.start, end: reference.node.end,
              text: type ? `${moduleNames[target]}.${target}` : shorthand ? `${specifier.local.name}: ${value}` : value });
          }
        } else aliases.push(`import ${specifier.local.name} = ${liftedFunctions.has(target) ? `${cycleNamespace}.${cycleFunctionNames[target]}` : `${moduleNames[target]}.${target}`};`);
      }
      bindings.push(...aliases);
      edits.push({ start: statement.start, end: statement.end, text: '' });
    }
    traverse(ast, { enter(path) {
      const node = path.node;
      let specifier;
      if (node.type === 'ImportExpression') specifier = node.source;
      else if (node.type === 'TSImportType') specifier = node.argument;
      else if (node.type === 'CallExpression' && node.callee.type === 'Import') specifier = node.arguments[0];
      if (node.type === 'TSImportType' && specifier?.value === '@graph' && node.qualifier?.type === 'Identifier' && nodePaths[node.qualifier.name]) {
        typeOnlyNodes.add(node.qualifier.name);
        edits.push({ start: node.start, end: node.qualifier.end, text: `${moduleNames[node.qualifier.name]}.${node.qualifier.name}` });
        return;
      }
      if (specifier && (specifier.type !== 'StringLiteral' || specifier.value === '@graph'
        || specifier.value.startsWith('.') || specifier.value.startsWith('/'))) unsupported = true;
      if (['CallExpression', 'OptionalCallExpression'].includes(node.type) && node.callee.name === 'require') {
        const binding = path.scope.getBinding('require');
        const ambient = binding?.path.node.declare || binding?.path.parentPath.node.declare;
        if (!binding || ambient) {
          const argument = node.arguments[0];
          if (argument?.type !== 'StringLiteral' || argument.value === '@graph'
            || argument.value.startsWith('.') || argument.value.startsWith('/')) unsupported = true;
          else usesRequire = true;
        }
      }
      if (['CallExpression', 'OptionalCallExpression'].includes(node.type) && isNodeRequire(path, node.callee)
        && !(node.callee.type === 'Identifier' && node.callee.name === 'require')) {
        const argument = node.arguments[0];
        if (argument && argument.type !== 'StringLiteral') {
          edits.push({ start: argument.start, end: argument.start, text: relativeImportGuardPrefix(true) });
          edits.push({ start: argument.end, end: argument.end, text: ')' });
        }
      }
      if (['ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) unsupported = true;
    } });
    if (usesRequire) {
      needsRequire = true;
      const ambientNames = ast.program.body.flatMap(statement => {
        if (!statement.declare) return [];
        if (statement.id?.name === 'require') return [statement.id];
        return statement.declarations?.filter(declaration => declaration.id.type === 'Identifier' && declaration.id.name === 'require')
          .map(declaration => declaration.id) ?? [];
      });
      const typeName = `${prefix}RequireType${packageBindingIndex++}`;
      for (const identifier of ambientNames) edits.push({ start: identifier.start, end: identifier.end, text: typeName });
      bindings.push(`const require = ${prefix}Require${ambientNames.length ? ` as typeof ${typeName}` : ''};`);
    }
    for (const statement of awaitedStatements) {
      const initializer = `${prefix}Await${packageBindingIndex++}`;
      edits.push({ start: statement.start, end: statement.start, text: `export async function ${initializer}() {\n` });
      edits.push({ start: statement.end, end: statement.end,
        text: `\n}\n}\nawait ${moduleNames[name]}.${initializer}();\nnamespace ${moduleNames[name]} {\n${bindings.join('\n')}\n` });
    }
    for (const [statement, expression] of awaitedInitializers) {
      const initializer = `${prefix}Await${packageBindingIndex++}`;
      const value = `${initializer}Value`;
      let expressionText = text.slice(expression.start, expression.end);
      const expressionEdits = edits.filter(edit => edit.start >= expression.start && edit.end <= expression.end);
      for (const edit of expressionEdits.sort((left, right) => right.start - left.start)) {
        expressionText = expressionText.slice(0, edit.start - expression.start) + edit.text + expressionText.slice(edit.end - expression.start);
      }
      for (const edit of expressionEdits) edits.splice(edits.indexOf(edit), 1);
      edits.push({ start: statement.start, end: statement.start,
        text: `export async function ${initializer}() { return ${expressionText}; }\n}\nconst ${value} = await ${moduleNames[name]}.${initializer}();\nnamespace ${moduleNames[name]} {\n${bindings.join('\n')}\n` });
      edits.push({ start: expression.start, end: expression.end, text: value });
    }
    let hoisted = '';
    if (awaitedStatements.size && nodePaths[name] && !liftedFunctions.has(name)) {
      const declaration = ast.program.body.find(statement => statement.type === 'ExportNamedDeclaration'
        && statement.declaration?.type === 'FunctionDeclaration' && statement.declaration.id?.name === name);
      if (declaration && declaration.start > Math.min(...[...awaitedStatements].map(statement => statement.start))) {
        hoisted = text.slice(declaration.start, declaration.end);
        const declarationEdits = edits.filter(edit => edit.start >= declaration.start && edit.end <= declaration.end);
        for (const edit of declarationEdits.sort((left, right) => right.start - left.start)) {
          hoisted = hoisted.slice(0, edit.start - declaration.start) + edit.text + hoisted.slice(edit.end - declaration.start);
        }
        for (const edit of declarationEdits) edits.splice(edits.indexOf(edit), 1);
        edits.push({ start: declaration.start, end: declaration.end, text: '' });
      }
    }
    let output = text;
    for (const edit of edits.sort((left, right) => right.start - left.start)) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
    output = bindings.join('\n') + '\n' + hoisted + '\n' + output;
    visiting.delete(name);
    emitted.add(name);
    modules.push(name === entry ? output : `namespace ${moduleNames[name]} {\n${output}\n}`);
    frame.effects ||= name !== entry && ast.program.body.some(statement => {
      const declaration = statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration' ? statement.declaration : statement;
      return declaration && !['ImportDeclaration', 'FunctionDeclaration', 'TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSDeclareFunction'].includes(declaration.type)
        && !(declaration.type === 'ExpressionStatement' && declaration.directive) && !declaration.declare;
    });
    const index = evaluationStack.length - 1;
    evaluationStack.pop();
    if (frame.low < index) {
      const parent = evaluationStack[index - 1];
      parent.low = Math.min(parent.low, frame.low);
      parent.effects ||= frame.effects;
    } else if (frame.effects) evaluatedModule = true;
  }
  emit(entry);
  if (unsafeExternalImport) return { ...result, ok: false, diagnostics: [...result.diagnostics,
    { severity: 'error', source: 'graphscript', file: nodePaths[unsafeExternalImport.name] ?? (unsafeExternalImport.name === entry ? result.programStart : unsafeExternalImport.name),
      line: unsafeExternalImport.statement.loc.start.line, column: unsafeExternalImport.statement.loc.start.column + 1,
      message: 'TypeScript program bundling cannot preserve external import evaluation order after local module setup' }] };
  if ([...typeOnlyNodes].some(name => !emitted.has(name))) {
    const temporary = mkdtempSync(join(tmpdir(), 'graphscript-types-'));
    try {
      const index = join(temporary, 'index.ts');
      const config = join(temporary, 'tsconfig.json');
      const output = join(temporary, 'declarations');
      writeFileSync(index, files.map(file => `export { ${file.slice(0, -3)} } from ${JSON.stringify(nodePaths[file.slice(0, -3)].replace(/\.ts$/, '.js'))};`).join('\n'));
      writeFileSync(config, JSON.stringify({ compilerOptions: { noCheck: true, declaration: true, emitDeclarationOnly: true,
        target: 'esnext', module: 'nodenext', rootDir: '/', outDir: output, paths: { '@graph': [index] } }, files: [...sources.keys()].filter(name => name !== entry).map(name => nodePaths[name] ?? name) }));
      const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
      const generated = spawnSync(process.execPath, [compiler, '--project', config], { encoding: 'utf8' });
      if (generated.error) throw generated.error;
      if (generated.status !== 0) throw new Error(generated.stdout + generated.stderr);
      for (const name of typeOnlyNodes) {
        if (emitted.has(name)) continue;
        const declaration = readFileSync(join(output, relative('/', nodePaths[name] ?? name).replace(/\.(?:ts|mts|cts)$/, match => ({ '.ts': '.d.ts', '.mts': '.d.mts', '.cts': '.d.cts' })[match])), 'utf8');
        const ast = parse(declaration, { sourceType: 'module', plugins: ['typescript'] });
        const edits = [];
        traverse(ast, { enter(path) {
          const node = path.node;
          if (node.type === 'ImportDeclaration' && node.source.value === '@graph'
            && node.specifiers.every(specifier => specifier.type === 'ImportSpecifier')) {
            const aliases = node.specifiers.map(specifier => {
              const target = specifier.imported.name ?? specifier.imported.value;
              if (!nodePaths[target]) { unsupported = true; return ''; }
              typeOnlyNodes.add(target);
              return `import ${specifier.local.name} = ${moduleNames[target]}.${target};`;
            });
            edits.push({ start: node.start, end: node.end, text: aliases.join('\n') });
            return;
          }
          if (node.type === 'ImportDeclaration' && !node.source.value.startsWith('.') && !node.source.value.startsWith('/')) {
            for (const specifier of node.specifiers) {
              const replacement = `${prefix}Import${packageBindingIndex++}`;
              const imported = specifier.type === 'ImportNamespaceSpecifier' ? `* as ${replacement}`
                : specifier.type === 'ImportDefaultSpecifier' ? replacement
                  : `{ ${specifier.imported.name ?? JSON.stringify(specifier.imported.value)} as ${replacement} }`;
              packageImports.push(`import type ${imported} from ${JSON.stringify(node.source.value)};`);
              const binding = path.scope.getBinding(specifier.local.name);
              path.scope.path.traverse({ Identifier(reference) {
                if (reference.isReferencedIdentifier() && reference.scope.getBinding(reference.node.name) === binding) {
                  edits.push({ start: reference.node.start, end: reference.node.end, text: replacement });
                }
              } });
            }
            edits.push({ start: node.start, end: node.end, text: '' });
            return;
          }
          if (node.type === 'TSImportType' && node.argument.value === '@graph'
            && node.qualifier?.type === 'Identifier' && nodePaths[node.qualifier.name]) {
            typeOnlyNodes.add(node.qualifier.name);
            edits.push({ start: node.start, end: node.qualifier.end, text: `${moduleNames[node.qualifier.name]}.${node.qualifier.name}` });
            return;
          }
          if (node.type === 'ImportDeclaration' || node.type === 'TSImportType'
            || ['ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) unsupported = true;
          if (!node.declare) return;
          const position = declaration.indexOf('declare', node.start);
          if (position >= node.start && position < node.end) edits.push({ start: position, end: position + 'declare '.length });
        } });
        let text = declaration;
        for (const edit of edits.sort((left, right) => right.start - left.start)) text = text.slice(0, edit.start) + (edit.text ?? '') + text.slice(edit.end);
        modules.unshift(`declare namespace ${moduleNames[name]} {\n${text}\n}`);
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }
  if (unsupported || unsupportedAwait) return { ...result, ok: false, diagnostics: [...result.diagnostics,
    { severity: 'error', source: 'graphscript', file: result.programStart, line: 1, column: 1,
      message: unsupportedAwait ? 'TypeScript program bundling does not yet support this top-level await form'
        : 'TypeScript program bundling does not yet support this import or a cyclic graph' }] };
  const requireSetup = needsRequire ? [`import { createRequire as ${prefix}CreateRequire } from "node:module";`,
    `const ${prefix}Require = ${prefix}CreateRequire(import.meta.url);`] : [];
  const cycleSetup = cycleFunctions.length ? [`namespace ${cycleNamespace} {\n${cycleFunctions.join('\n')}\n}`] : [];
  writeOutput(join(resolve(project), 'dist'), new Map([['main.mts', [...requireSetup, ...packageImports, ...cycleStates, ...cycleSetup, ...modules].join('\n') + '\n']]));
  return result;
}

function bundleJavaScriptProgram(project, result) {
  const sourceNodes = join(resolve(project), 'nodes');
  const sourceNodePaths = Object.fromEntries(readdirSync(sourceNodes)
    .filter(file => file.endsWith('.ts') && join(sourceNodes, file) !== result.programStart)
    .map(file => [file.slice(0, -3), join(sourceNodes, file)]));
  if (emitProgramModules(project, result, sourceNodePaths, 'javascript')) return result;
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'graphscript-program-')));
  try {
    const nodesDirectory = join(resolve(project), 'nodes');
    const files = readdirSync(nodesDirectory).filter(file => file.endsWith('.ts') && join(nodesDirectory, file) !== result.programStart);
    const stagedNodes = join(temporary, 'nodes');
    mkdirSync(stagedNodes);
    const nodePaths = Object.fromEntries(files.map(file => [file.slice(0, -3), join(stagedNodes, file)]));
    const graphPath = join(temporary, 'graph.ts');
    const importGuardPath = join(temporary, 'import-guard.mjs');
    const dynamicGraphImports = new Map();
    writeFileSync(graphPath, files.map(file => `export { ${file.slice(0, -3)} } from ${JSON.stringify(nodePaths[file.slice(0, -3)])};`).join('\n'));
    writeFileSync(importGuardPath, `export function importSpecifier(specifier) { return ${relativeImportGuardPrefix(false, true)}specifier); }\n`);
    function stage(file, output) {
      const text = readFileSync(file, 'utf8');
      const ast = parse(text, { sourceType: 'module', plugins: ['typescript', 'decorators', 'decoratorAutoAccessors'] });
      const edits = [];
      let importGuard;
      traverse(ast, { enter(path) {
        const node = path.node;
        if (node.type === 'ImportDeclaration' && node.source.value === '@graph') {
          if (node.specifiers.length && node.specifiers.every(specifier => specifier.type === 'ImportSpecifier')) {
            edits.push({ start: node.start, end: node.end, text: node.specifiers.map(specifier => {
              const name = specifier.imported.name ?? specifier.imported.value;
              const type = node.importKind === 'type' || specifier.importKind === 'type' ? 'type ' : '';
              return `import ${type}{ ${name} as ${specifier.local.name} } from ${JSON.stringify(nodePaths[name])};`;
            }).join('\n') });
          } else if (!node.specifiers.some(specifier => specifier.type === 'ImportNamespaceSpecifier')) {
            edits.push({ start: node.source.start, end: node.source.end, text: JSON.stringify(graphPath) });
          }
          return;
        }
        let specifier;
        if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type)) specifier = node.source;
        else if (node.type === 'ImportExpression') specifier = node.source;
        else if (['CallExpression', 'OptionalCallExpression'].includes(node.type)
          && (node.callee.type === 'Import' || isNodeRequire(path, node.callee))) specifier = node.arguments[0];
        if ((node.type === 'ImportExpression' || node.type === 'CallExpression' && node.callee.type === 'Import')
          && specifier?.type === 'StringLiteral' && specifier.value === '@graph') {
          dynamicGraphImports.set(output, { severity: 'error', source: 'graphscript', file,
            line: node.loc.start.line, column: node.loc.start.column + 1,
            message: 'Dynamic GraphScript imports require separate bundle support' });
        }
        const dynamicImport = node.type === 'ImportExpression' || node.type === 'CallExpression' && node.callee.type === 'Import';
        const runtimeRequire = ['CallExpression', 'OptionalCallExpression'].includes(node.type) && isNodeRequire(path, node.callee);
        if ((dynamicImport || runtimeRequire) && specifier && specifier.type !== 'StringLiteral') {
          if (dynamicImport && !importGuard) {
            importGuard = path.scope.generateUidIdentifier('graphscriptImportSpecifier').name;
            edits.push({ start: 0, end: 0, text: `import { importSpecifier as ${importGuard} } from ${JSON.stringify(importGuardPath)};\n` });
          }
          edits.push({ start: specifier.start, end: specifier.start, text: dynamicImport ? `${importGuard}(` : relativeImportGuardPrefix() });
          edits.push({ start: specifier.end, end: specifier.end, text: ')' });
        }
        if (specifier?.type === 'StringLiteral' && (specifier.value.startsWith('./') || specifier.value.startsWith('../'))) {
          const target = resolve(dirname(file), specifier.value);
          const nodeName = basename(target).replace(/\.(?:js|ts)$/, '');
          const stagedNode = dirname(target) === nodesDirectory && nodePaths[nodeName];
          edits.push({ start: specifier.start, end: specifier.end, text: JSON.stringify(stagedNode || target) });
        }
      } });
      let outputText = text;
      for (const edit of edits.sort((left, right) => right.start - left.start)) outputText = outputText.slice(0, edit.start) + edit.text + outputText.slice(edit.end);
      writeFileSync(output, outputText);
    }
    for (const file of files) stage(join(nodesDirectory, file), nodePaths[file.slice(0, -3)]);
    const entry = join(temporary, 'entry.ts');
    stage(result.programStart, entry);
    const processResult = spawnSync(process.execPath, [join(__dirname, 'program-bundle.cjs')], {
      input: JSON.stringify({ entry, graphPath, nodePaths }), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    if (processResult.error) throw processResult.error;
    if (processResult.status !== 0) throw new Error(processResult.stderr);
    const bundled = JSON.parse(processResult.stdout);
    const unsupported = bundled.inputs.map(file => dynamicGraphImports.get(realpathSync(resolve(file)))).filter(Boolean);
    if (unsupported.length) return { ...result, ok: false, diagnostics: [...result.diagnostics, ...unsupported] };
    writeOutput(join(resolve(project), 'dist'), new Map([['main.mjs', bundled.text]]));
    return result;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function libraryMetadata(project) {
  let metadata = {};
  try {
    metadata = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const packageExports = { '.': { types: './index.d.mts', import: './index.mjs' } };
  if (metadata.exports !== undefined) {
    const root = metadata.exports?.['.'];
    if (!metadata.exports || typeof metadata.exports !== 'object' || Array.isArray(metadata.exports)
      || Object.keys(metadata.exports).some(key => !key.startsWith('.'))
      || (root !== undefined && (!root || typeof root !== 'object' || Array.isArray(root)
        || Object.entries(root).some(([condition, target]) => condition === 'require'
          || target !== (condition === 'types' ? './index.d.mts' : './index.mjs'))))) {
      throw new Error('Conflicting package metadata: exports');
    }
    Object.assign(packageExports, metadata.exports);
    if (root !== undefined) packageExports['.'] = { ...packageExports['.'], types: './index.d.mts', import: './index.mjs' };
  }
  for (const [field, expected] of [['main', 'index.mjs'], ['types', 'index.d.mts'], ['typings', 'index.d.mts']]) {
    if (metadata[field] !== undefined && metadata[field] !== expected && metadata[field] !== `./${expected}`) {
      throw new Error(`Conflicting package metadata: ${field}`);
    }
  }
  return JSON.stringify({ type: 'module', ...metadata, exports: packageExports }, null, 2) + '\n';
}

function buildLibrary(project, { language = 'javascript' } = {}) {
  if (!['javascript', 'typescript'].includes(language)) throw new Error(`Unsupported output language: ${language}`);
  project = resolve(project);
  const result = checkProject(project);
  if (!result.ok) return result;
  const files = readdirSync(join(project, 'nodes'))
    .filter(file => file.endsWith('.ts') && join(project, 'nodes', file) !== result.programStart).sort();
  const nodeNames = Object.fromEntries(files.map(file => {
    const name = file.slice(0, -3);
    return [name, `./${name === 'index' ? '.graphscript-node-index' : name}.mjs`];
  }));
  const exports = files.map(file => {
    const name = file.slice(0, -3);
    return `export { ${name} } from ${JSON.stringify(nodeNames[name])};`;
  }).join('\n') + '\n';
  const temporary = mkdtempSync(join(tmpdir(), 'graphscript-build-'));
  try {
    let emittedDirectory = temporary;
    if (files.length) {
      const config = join(temporary, 'source-tsconfig.json');
      const sourceFiles = files.map(file => join(project, 'nodes', file));
      writeFileSync(config, JSON.stringify({ compilerOptions: { noEmit: true }, files: sourceFiles }));
      const api = new API({ cwd: project });
      let compilerFiles = sourceFiles;
      try {
        const program = api.updateSnapshot({ openProjects: [config] }).getProject(config).program;
        const stagedSources = sourceFiles.map(file => {
          const source = program.getSourceFile(file);
          let text = source.text;
          const imports = source.statements.filter(node => node.kind === SyntaxKind.ImportDeclaration
            && node.moduleSpecifier?.text === '@graph' && !node.importClause?.isTypeOnly
            && node.importClause?.namedBindings?.kind === SyntaxKind.NamedImports
            && node.importClause.namedBindings.elements.length === 0);
          for (const node of imports.reverse()) text = text.slice(0, node.getStart(source)) + 'import "@graph";' + text.slice(node.end);
          return text;
        });
        if (stagedSources.some((text, index) => text !== program.getSourceFile(sourceFiles[index]).text)) {
          const stagedProject = join(temporary, 'source');
          mkdirSync(join(stagedProject, 'nodes'), { recursive: true });
          for (const entry of readdirSync(project)) {
            if (entry !== 'nodes') symlinkSync(join(project, entry), join(stagedProject, entry));
          }
          for (const entry of readdirSync(join(project, 'nodes'))) {
            if (!files.includes(entry)) symlinkSync(join(project, 'nodes', entry), join(stagedProject, 'nodes', entry));
          }
          compilerFiles = files.map((file, index) => {
            const stagedFile = join(stagedProject, 'nodes', file);
            writeFileSync(stagedFile, stagedSources[index]);
            return stagedFile;
          });
          emittedDirectory = join(temporary, 'emitted');
        }
      } finally {
        api.close();
      }
      const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
      const emitted = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--noCheck', '--target', 'es2022',
        '--module', 'esnext', '--outDir', emittedDirectory, ...compilerFiles], { encoding: 'utf8' });
      if (emitted.error) throw emitted.error;
      if (emitted.status !== 0) throw new Error(emitted.stdout + emitted.stderr);
    }
    const nodePaths = Object.fromEntries(files.map(file => [`./${file.slice(0, -3)}.js`, nodeNames[file.slice(0, -3)]]));
    const { modules, declarationPaths } = localDependencies(project, files, nodePaths, emittedDirectory);
    if (files.length) {
      const config = join(temporary, 'tsconfig.json');
      const sourceFiles = files.map(file => language === 'typescript' ? join(project, 'nodes', file)
        : join(emittedDirectory, `${file.slice(0, -3)}.js`));
      writeFileSync(config, JSON.stringify({ compilerOptions: { allowJs: true, noEmit: true }, files: sourceFiles }));
      const api = new API({ cwd: project });
      try {
        const program = api.updateSnapshot({ openProjects: [config] }).getProject(config).program;
        let needsGraph = false;
        let needsGuard = false;
        const nodePaths = Object.fromEntries(files.map(file => [`./${file.slice(0, -3)}.js`, nodeNames[file.slice(0, -3)]]));
        for (const [index, file] of files.entries()) {
          const name = file.slice(0, -3);
          const source = program.getSourceFile(sourceFiles[index]);
          const rewritten = rewriteGraphImports(source, nodePaths, nodeNames,
            language === 'typescript' ? declarationPaths.get(join(project, 'nodes', file)) : undefined);
          needsGraph ||= rewritten.needsGraph;
          needsGuard ||= rewritten.needsGuard;
          modules.set(nodeNames[name].slice(2, -4) + (language === 'typescript' ? '.mts' : '.mjs'), rewritten.text);
        }
        if (needsGraph) {
          modules.set(`.graph.${language === 'typescript' ? 'mts' : 'mjs'}`, exports);
        }
        if (needsGuard) {
          const parameters = language === 'typescript' ? 'specifier: string' : 'specifier';
          const typeCast = language === 'typescript' ? ' as unknown as string' : '';
          modules.set(`.graphscript-resolve.${language === 'typescript' ? 'mts' : 'mjs'}`, `export function localSpecifier(${parameters}) {\n  if (typeof specifier === "string" && /^file:/i.test(specifier)) throw new Error("GraphScript rule error: file: URL imports are not allowed");\n  if (typeof specifier === "string" && (specifier.startsWith("./") || specifier.startsWith("../"))) throw new Error("GraphScript rule error: relative runtime imports are not allowed");\n  return specifier;\n}\nexport function importSpecifier(${parameters}) {\n  return ({ [Symbol.toPrimitive]() { const name = \`\${specifier}\`; return name === "@graph" ? "./.graph.mjs" : localSpecifier(name); } })${typeCast};\n}\n`);
          modules.set('.graphscript-resolve.d.mts', 'export declare function localSpecifier(specifier: string): string;\nexport declare function importSpecifier(specifier: string): string;\n');
        }
      } finally {
        api.close();
      }
    }
    if (language === 'typescript') modules.set('index.mts', files.length ? exports : 'export {};\n');
    else modules.set('index.mjs', files.length ? exports : 'export {};\n');
    {
      const declarations = join(temporary, 'declarations');
      if (files.length) {
        const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
        const graphTypes = join(temporary, 'graph.d.ts');
        writeFileSync(graphTypes, files.map(file => `export { ${file.slice(0, -3)} } from ${JSON.stringify(join(project, 'nodes', file).replace(/\.ts$/, '.js'))};`).join('\n'));
        const declarationConfig = join(temporary, 'declaration-emit.json');
        writeFileSync(declarationConfig, JSON.stringify({ compilerOptions: { noCheck: true, declaration: true,
          emitDeclarationOnly: true, target: 'es2022', module: 'esnext', moduleResolution: 'bundler',
          rootDir: join(project, 'nodes'), outDir: declarations, paths: { '@graph': [graphTypes] } },
        files: files.map(file => join(project, 'nodes', file)) }));
        const emitted = spawnSync(process.execPath, [compiler, '--project', declarationConfig], { encoding: 'utf8' });
        if (emitted.error) throw emitted.error;
        if (emitted.status !== 0) throw new Error(emitted.stdout + emitted.stderr);
        const declarationFiles = files.map(file => join(declarations, `${file.slice(0, -3)}.d.ts`));
        const config = join(temporary, 'declarations-tsconfig.json');
        writeFileSync(config, JSON.stringify({ compilerOptions: { noEmit: true }, files: declarationFiles }));
        const api = new API({ cwd: project });
        try {
          const program = api.updateSnapshot({ openProjects: [config] }).getProject(config).program;
          const nodePaths = Object.fromEntries(files.map(file => [`./${file.slice(0, -3)}.js`, nodeNames[file.slice(0, -3)]]));
          let needsGraph = false;
          for (const [index, file] of files.entries()) {
            const name = file.slice(0, -3);
            const rewritten = rewriteGraphImports(program.getSourceFile(declarationFiles[index]), nodePaths, nodeNames,
              declarationPaths.get(join(project, 'nodes', file)), true);
            needsGraph ||= rewritten.needsGraph;
            modules.set(nodeNames[name].slice(2, -4) + '.d.mts', rewritten.text);
          }
          if (needsGraph) modules.set('.graph.d.mts', exports);
        } finally {
          api.close();
        }
      }
      modules.set('index.d.mts', files.length ? exports : 'export {};\n');
      modules.set('package.json', libraryMetadata(project));
    }
    writeOutput(join(project, 'dist'), modules);
    return result;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

module.exports = { buildLibrary, buildProject };