const { chmodSync, existsSync, linkSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } = require('node:fs');
const { basename, dirname, isAbsolute, join, relative, resolve, sep } = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { readGraph } = require('./graph');
const { validateName } = require('./project');

function matchesSnapshot(file, snapshot, links = 1) {
  const info = lstatSync(file);
  return info.isFile() && info.nlink === links && info.dev === snapshot.info.dev && info.ino === snapshot.info.ino
    && info.mode === snapshot.info.mode && info.uid === snapshot.info.uid && info.gid === snapshot.info.gid
    && info.size === snapshot.info.size && info.mtimeMs === snapshot.info.mtimeMs && readFileSync(file, 'utf8') === snapshot.original;
}

function resolveUnsavedFile(absolute) {
  let ancestor = absolute;
  while (true) {
    try {
      return resolve(realpathSync(ancestor), relative(ancestor, absolute));
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code)) throw error;
      let info;
      try {
        info = lstatSync(ancestor);
      } catch (statError) {
        if (!['ENOENT', 'ENOTDIR', 'ELOOP'].includes(statError.code)) throw statError;
      }
      if (info?.isSymbolicLink() || error.code === 'ELOOP') {
        throw new Error(`Save unsaved file with unresolved symbolic link: ${absolute}`);
      }
      const parent = dirname(ancestor);
      if (parent === ancestor) return absolute;
      ancestor = parent;
    }
  }
}

function recordUnsavedManifest(manifests, absolute, resolvedFile) {
  const paths = [absolute, resolvedFile].filter(file => basename(file).toLowerCase() === 'package.json');
  if (!paths.length) return false;
  manifests.add(absolute);
  manifests.add(resolvedFile);
  for (const file of paths) manifests.add(join(dirname(file), 'package.json'));
  return true;
}

function packageManifestTracker(unsavedManifests = new Set()) {
  const manifests = new Map();
  function readManifest(manifest) {
    if (!manifests.has(manifest)) {
      const folder = dirname(manifest);
      if (unsavedManifests.has(manifest) || unsavedManifests.has(join(realpathSync(folder), 'package.json'))) {
        throw new Error(`Save unsaved package manifest before protected edit: ${manifest}`);
      }
      let info;
      try {
        info = lstatSync(manifest);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (info) {
        if (!info.isFile() || info.nlink !== 1) throw new Error(`Cannot resolve package manifest ${manifest}`);
        if (unsavedManifests.has(realpathSync(manifest))) {
          throw new Error(`Save unsaved package manifest before protected edit: ${manifest}`);
        }
        const original = readFileSync(manifest, 'utf8');
        manifests.set(manifest, { info, original, data: JSON.parse(original) });
      } else manifests.set(manifest, null);
    }
    return manifests.get(manifest)?.data;
  }
  function packageName(file) {
    let folder = dirname(file);
    while (true) {
      const manifest = join(folder, 'package.json');
      const data = readManifest(manifest);
      if (data) return data.name;
      const parent = dirname(folder);
      if (parent === folder) return;
      folder = parent;
    }
  }
  function checkManifests() {
    for (const [file, snapshot] of manifests) {
      if (snapshot ? !matchesSnapshot(file, snapshot) : existsSync(file)) {
        throw new Error(`Conflicting package manifest change in ${file}`);
      }
    }
  }
  function checkKnownManifest(manifest) {
    if (manifests.has(manifest)) return;
    try {
      lstatSync(manifest);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    throw new Error(`Conflicting package manifest change in ${manifest}`);
  }
  function checkManifestRoute(manifest, target, operation, targetInfo) {
    const data = readManifest(manifest);
    function isTargetFile(file) {
      try {
        const info = statSync(file);
        return info.dev === targetInfo.dev && info.ino === targetInfo.ino;
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
        return false;
      }
    }
    function validLocalTarget(value) {
      if (!value.startsWith('./') || /%2f|%5c/i.test(value)) return false;
      try {
        const segments = decodeURIComponent(value.slice(2).split(/[?#]/, 1)[0]).split(/[\\/]/);
        return !segments.some(segment => ['.', '..', 'node_modules'].includes(segment.toLowerCase()));
      } catch {
        return false;
      }
    }
    function alwaysResolves(value) {
      if (Array.isArray(value)) return value.some(alwaysResolves);
      if (value && typeof value === 'object') {
        for (const [condition, item] of Object.entries(value)) {
          if (!alwaysResolves(item)) return false;
          if (condition === 'default' || condition === 'node') return true;
        }
        return false;
      }
      return typeof value === 'string' && validLocalTarget(value);
    }
    function targetsNode(value, key, routes) {
      if (typeof value === 'string') {
        if (!validLocalTarget(value)) return false;
        const marker = '__graphscript_route_wildcard__';
        let candidate;
        try {
          candidate = fileURLToPath(new URL(value.replaceAll('*', marker), pathToFileURL(`${dirname(manifest)}${sep}`)));
        } catch {
          return false;
        }
        if (!key.includes('*') || !value.includes('*')) return isTargetFile(candidate);
        function matchPath(path, pattern) {
          const parts = pattern.split(marker).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
          return new RegExp(`^${parts[0]}(.+)${parts.slice(1).join('\\1')}$`, 'i').exec(path);
        }
        const match = matchPath(target.file, candidate) || matchPath(target.file.normalize('NFC'), candidate.normalize('NFC'));
        if (!match || !isTargetFile(candidate.replaceAll(marker, match[1]))) return false;
        for (let index = 0; index < match[1].length; index++) {
          const letter = match[1][index];
          const alternate = letter === letter.toUpperCase() ? letter.toLowerCase() : letter.toUpperCase();
          if (letter !== alternate && isTargetFile(candidate.replaceAll(marker, `${match[1].slice(0, index)}${alternate}${match[1].slice(index + 1)}`))) return true;
        }
        const specifier = key.replace('*', match[1]);
        if (Object.hasOwn(routes, specifier)) return false;
        const baseLength = key.indexOf('*') + 1;
        return !Object.keys(routes).some(other => {
          const star = other.indexOf('*');
          if (other === key || star < 0 || !specifier.startsWith(other.slice(0, star))
            || !specifier.endsWith(other.slice(star + 1)) || specifier.length < other.length) return false;
          return star + 1 > baseLength || (star + 1 === baseLength && other.length > key.length);
        });
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          if (targetsNode(item, key, routes)) return true;
          if (alwaysResolves(item)) return false;
        }
        return false;
      }
      if (value && typeof value === 'object') {
        for (const [condition, item] of Object.entries(value)) {
          if (targetsNode(item, key, routes)) return true;
          if ((condition === 'default' || condition === 'node') && alwaysResolves(item)) return false;
        }
      }
      return false;
    }
    function hasTarget(value, prefix) {
      if (value && !Array.isArray(value) && typeof value === 'object' && Object.keys(value).some(key => key.startsWith(prefix))) {
        return Object.entries(value).some(([key, item]) => key.startsWith(prefix) && targetsNode(item, key, value));
      }
      return prefix === '.' && targetsNode(value, '.', {});
    }
    if (data && (hasTarget(data.imports, '#') || hasTarget(data.exports, '.'))) {
      throw new Error(`Cannot resolve node route in package manifest ${manifest} for ${operation}`);
    }
  }
  return { packageName, checkManifestRoute, checkManifests, checkKnownManifest };
}

function deleteNode(project, { name, unsavedFiles = [] }) {
  project = resolve(project);
  const directory = join(project, 'nodes');
  if (!lstatSync(directory).isDirectory()) throw new Error('nodes must be a directory, not a symbolic link');
  const realProject = realpathSync(project);
  const sourcePattern = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
  const unsavedManifests = new Set();
  function insideProject(root, file) {
    const name = relative(root, file);
    return name && name !== '..' && !name.startsWith(`..${sep}`);
  }
  for (const file of unsavedFiles) {
    const absolute = resolve(file);
    const resolvedFile = resolveUnsavedFile(absolute);
    const manifest = recordUnsavedManifest(unsavedManifests, absolute, resolvedFile);
    if ((sourcePattern.test(absolute) || sourcePattern.test(resolvedFile) || manifest) && (insideProject(project, absolute) || insideProject(realProject, resolvedFile))) {
      throw new Error(`Save unsaved project file before deletion: ${file}`);
    }
  }
  const graph = readGraph(project);
  const target = graph.nodes.find(node => node.name === name || node.id === name);
  if (!target) throw new Error(`Unknown node ${name}`);
  const { packageName, checkManifestRoute, checkManifests, checkKnownManifest } = packageManifestTracker(unsavedManifests);
  const targetInfo = statSync(target.file);
  function projectSources(inspectRoutes = false, rejectNewManifests = false) {
    const files = [];
    function visit(folder) {
      if (inspectRoutes) checkManifestRoute(join(folder, 'package.json'), target, 'deletion', targetInfo);
      if (rejectNewManifests) checkKnownManifest(join(folder, 'package.json'));
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (['.git', 'node_modules'].includes(entry.name) || (folder === project && entry.name === 'dist')) continue;
        const file = join(folder, entry.name);
        if (entry.isSymbolicLink()) {
          const target = realpathSync(file);
          if (!statSync(file).isFile() || sourcePattern.test(file) || sourcePattern.test(target)) {
            throw new Error(`Conflicting symbolic link ${file}`);
          }
          continue;
        }
        if (entry.isDirectory()) visit(file);
        else if (sourcePattern.test(entry.name)) files.push(file);
      }
    }
    visit(project);
    return files.sort();
  }
  const snapshots = new Map();
  for (const file of projectSources()) {
    const info = lstatSync(file);
    if (!info.isFile() || info.nlink !== 1) throw new Error(`Conflicting file ${file}`);
    snapshots.set(file, { info, original: readFileSync(file, 'utf8') });
  }
  const references = [];
  for (const [file, snapshot] of snapshots) {
    if (file === target.file) continue;
    const plugins = ['typescript', 'decorators'];
    if (/\.[jt]sx$/i.test(file)) plugins.push('jsx');
    const source = parse(snapshot.original, { sourceType: 'unambiguous', allowReturnOutsideFunction: true, plugins });
    const visited = new Set();
    function addReference(node) {
      references.push(`${file}:${node.loc.start.line}:${node.loc.start.column + 1}`);
    }
    function staticString(node) {
      if (node?.type === 'StringLiteral') return node.value;
      if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
      if (node?.type === 'BinaryExpression' && node.operator === '+') {
        const left = staticString(node.left);
        const right = staticString(node.right);
        if (typeof left === 'string' && typeof right === 'string') return left + right;
      }
    }
    function isTargetSource(node) {
      const value = staticString(node);
      if (typeof value !== 'string') return false;
      if (value.startsWith('#')) return true;
      let imported;
      if (/^file:/i.test(value)) {
        try {
          imported = fileURLToPath(value);
        } catch {
          return true;
        }
      } else {
        if (!value.startsWith('.') && !isAbsolute(value)) {
          if (value === '@graph') return false;
          const name = packageName(file);
          return typeof name === 'string' && (value === name || value.startsWith(`${name}/`));
        }
        imported = resolve(dirname(file), value);
      }
      const candidates = [imported, `${imported}.ts`];
      if (imported.endsWith('.js')) candidates.push(`${imported.slice(0, -3)}.ts`);
      const targetInfo = snapshots.get(target.file).info;
      return candidates.some(candidate => {
        if (candidate === target.file) return true;
        try {
          const info = statSync(candidate);
          return info.dev === targetInfo.dev && info.ino === targetInfo.ino;
        } catch (error) {
          if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
          return false;
        }
      });
    }
    function propertyReference(property, computed) {
      const propertyName = !computed && property.type === 'Identifier' ? property.name
        : property.type === 'StringLiteral' ? property.value
          : property.type === 'TemplateLiteral' && property.expressions.length === 0 ? property.quasis[0].value.cooked : undefined;
      if (propertyName == null || propertyName === target.name) addReference(property);
    }
    function namespaceBinding(binding, node) {
      if (!binding?.constant) return addReference(node);
      if (visited.has(binding)) return;
      visited.add(binding);
      for (const reference of binding.referencePaths) namespaceReference(reference);
    }
    function namespaceReference(reference) {
      while (['TSAsExpression', 'TSSatisfiesExpression', 'TSTypeAssertion', 'TSNonNullExpression'].includes(reference.parentPath.node.type)
        && reference.parentPath.node.expression === reference.node) reference = reference.parentPath;
      const parent = reference.parentPath;
      if ((parent.isMemberExpression() || parent.isOptionalMemberExpression()) && parent.node.object === reference.node) {
        propertyReference(parent.node.property, parent.node.computed);
      } else if (parent.isTSQualifiedName() && parent.node.left === reference.node) {
        propertyReference(parent.node.right, false);
      } else if ((parent.isVariableDeclarator() && parent.node.init === reference.node)
        || (parent.isAssignmentExpression() && parent.node.right === reference.node)) {
        const pattern = parent.isVariableDeclarator() ? parent.node.id : parent.node.left;
        if (pattern.type === 'ObjectPattern') {
          for (const property of pattern.properties) {
            if (property.type === 'ObjectProperty') propertyReference(property.key, property.computed);
            else addReference(property);
          }
        } else if (parent.isVariableDeclarator() && pattern.type === 'Identifier') {
          namespaceBinding(parent.scope.getBinding(pattern.name), pattern);
        } else addReference(reference.node);
      } else addReference(reference.node);
    }
    function dynamicImport(path) {
      if (path.parentPath.isAwaitExpression()) namespaceReference(path.parentPath);
      else addReference(path.node);
    }
    function checkLoaderMember(path) {
      const { object, property, computed } = path.node;
      if (object.type !== 'Identifier') return;
      const name = computed ? staticString(property) : property.name;
      if (object.name === 'process' && (name === 'getBuiltinModule' || typeof name !== 'string')) return addReference(path.node);
      if (['globalThis', 'global'].includes(object.name) && ['eval', 'Function'].includes(name)) return addReference(path.node);
      if ((['globalThis', 'global'].includes(object.name) && ['process', 'module'].includes(name))
        || (object.name === 'module' && ['constructor', 'parent', 'children'].includes(name))
        || (object.name === 'process' && name === 'mainModule')) return addReference(path.node);
      if (!['module', 'globalThis', 'global'].includes(object.name)) return;
      if (name !== 'require' && typeof name === 'string') return;
      if (object.name !== 'module' || !path.isMemberExpression()
        || !(path.parentPath.isCallExpression() && path.parentPath.node.callee === path.node)) addReference(path.node);
    }
    traverse(source, {
      ImportDeclaration(path) {
        if (isTargetSource(path.node.source)) return addReference(path.node.source);
        if (['module', 'node:module'].includes(path.node.source.value)
          && path.node.specifiers.some(specifier => specifier.type === 'ImportNamespaceSpecifier'
            || specifier.type === 'ImportDefaultSpecifier'
            || ['createRequire', 'default', 'Module'].includes(specifier.imported?.name ?? specifier.imported?.value))) {
          addReference(path.node);
        }
        if (path.node.source.value !== '@graph') return;
        for (const specifier of path.node.specifiers) {
          if (specifier.type === 'ImportNamespaceSpecifier') namespaceBinding(path.scope.getBinding(specifier.local.name), specifier);
          else if (specifier.type === 'ImportSpecifier' && (specifier.imported.name ?? specifier.imported.value) === target.name) addReference(specifier);
          else if (specifier.type === 'ImportDefaultSpecifier') addReference(specifier);
        }
      },
      ExportNamedDeclaration(path) {
        if (isTargetSource(path.node.source)) return addReference(path.node.source);
        if (['module', 'node:module'].includes(path.node.source?.value)
          && path.node.specifiers.some(specifier => specifier.type !== 'ExportSpecifier'
            || ['createRequire', 'default', 'Module'].includes(specifier.local.name ?? specifier.local.value))) addReference(path.node);
        if (path.node.source?.value !== '@graph') return;
        for (const specifier of path.node.specifiers) {
          if (specifier.type !== 'ExportSpecifier' || (specifier.local.name ?? specifier.local.value) === target.name) addReference(specifier);
        }
      },
      ExportAllDeclaration(path) {
        if (['@graph', 'module', 'node:module'].includes(path.node.source.value) || isTargetSource(path.node.source)) addReference(path.node);
      },
      TSImportType(path) {
        if (isTargetSource(path.node.argument)) return addReference(path.node.argument);
        if (path.node.argument.value !== '@graph') return;
        let qualifier = path.node.qualifier;
        while (qualifier?.type === 'TSQualifiedName') qualifier = qualifier.left;
        if (!qualifier || qualifier.name === target.name) addReference(qualifier ?? path.node);
      },
      TSExternalModuleReference(path) {
        if (isTargetSource(path.node.expression) || ['module', 'node:module'].includes(path.node.expression.value)) return addReference(path.node);
        if (path.node.expression.value !== '@graph') return;
        const declaration = path.parentPath;
        if (!declaration.isTSImportEqualsDeclaration() || declaration.node.isExport) return addReference(path.node);
        namespaceBinding(declaration.scope.getBinding(declaration.node.id.name), declaration.node);
      },
      ReferencedIdentifier(path) {
        if (['eval', 'Function'].includes(path.node.name)) addReference(path.node);
        if (path.node.name === 'require' && !(path.parentPath.isCallExpression() && path.parentPath.node.callee === path.node)) {
          addReference(path.node);
        }
        const declaration = path.parentPath.node;
        if (path.node.name === 'process' && !path.scope.getBinding('process') && path.parentPath.isVariableDeclarator()
          && declaration.init === path.node && declaration.id.type === 'ObjectPattern'
          && declaration.id.properties.every(property => property.type === 'ObjectProperty' && !property.computed && property.key.name === 'env')) return;
        if (['module', 'globalThis', 'global', 'process'].includes(path.node.name)
          && !((path.parentPath.isMemberExpression() || path.parentPath.isOptionalMemberExpression())
            && path.parentPath.node.object === path.node)) addReference(path.node);
      },
      MemberExpression: checkLoaderMember,
      OptionalMemberExpression: checkLoaderMember,
      CallExpression(path) {
        const argument = path.node.arguments[0];
        if (path.node.callee.type === 'Import') {
          if (isTargetSource(argument)) addReference(argument);
          else if (staticString(argument) === '@graph') dynamicImport(path);
          else if (['module', 'node:module'].includes(staticString(argument)) || typeof staticString(argument) !== 'string') addReference(path.node);
        }
        const callee = path.node.callee;
        const isRequire = (callee.type === 'Identifier' && callee.name === 'require')
          || (callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && callee.object.name === 'module'
            && ((!callee.computed && callee.property.type === 'Identifier' && callee.property.name === 'require')
              || (callee.computed && (staticString(callee.property) === 'require' || typeof staticString(callee.property) !== 'string'))));
        if (isRequire
          && (['@graph', 'module', 'node:module'].includes(staticString(argument)) || isTargetSource(argument) || typeof staticString(argument) !== 'string'
            || (callee.type === 'MemberExpression' && callee.computed && typeof staticString(callee.property) !== 'string'))) addReference(path.node);
      },
      ImportExpression(path) {
        if (isTargetSource(path.node.source)) addReference(path.node.source);
        else if (staticString(path.node.source) === '@graph') dynamicImport(path);
        else if (['module', 'node:module'].includes(staticString(path.node.source)) || typeof staticString(path.node.source) !== 'string') addReference(path.node);
      },
    });
  }
  if (references.length) throw new Error(`Cannot delete ${target.name}; source references:\n${references.join('\n')}`);
  for (let folder = dirname(project); ; folder = dirname(folder)) {
    checkManifestRoute(join(folder, 'package.json'), target, 'deletion', targetInfo);
    if (dirname(folder) === folder) break;
  }
  for (const [file, snapshot] of snapshots) {
    if (!matchesSnapshot(file, snapshot)) throw new Error(`Conflicting change in ${file}`);
  }
  const currentFiles = projectSources(true);
  if (currentFiles.length !== snapshots.size || currentFiles.some(file => !snapshots.has(file))) throw new Error('Conflicting project source change during deletion');
  checkManifests();
  const temporary = mkdtempSync(join(directory, '.graphscript-delete-'));
  const staged = join(temporary, 'source');
  let moved = false;
  let retainRecovery = false;
  let committed = false;
  let failure;
  let cleanupWarning;
  try {
    renameSync(target.file, staged);
    moved = true;
    if (!matchesSnapshot(staged, snapshots.get(target.file))) throw new Error(`Conflicting change in ${target.file}`);
    for (const [file, snapshot] of snapshots) {
      if (file !== target.file && !matchesSnapshot(file, snapshot)) throw new Error(`Conflicting change in ${file}`);
    }
    checkManifests();
    const remaining = projectSources(false, true);
    if (remaining.length !== snapshots.size - 1 || remaining.some(file => !snapshots.has(file) || file === target.file)) {
      throw new Error('Conflicting project source change during deletion');
    }
    checkManifests();
    unlinkSync(staged);
    moved = false;
    committed = true;
  } catch (error) {
    failure = error;
    if (moved) {
      try {
        linkSync(staged, target.file);
      } catch (rollbackError) {
        retainRecovery = true;
        failure = new Error(`${error.message}; rollback failed: ${rollbackError.message}; recovery files: ${temporary}`);
      }
    }
  } finally {
    if (!retainRecovery) {
      try {
        rmSync(temporary, { recursive: true, force: true });
      } catch (error) {
        if (committed) cleanupWarning = `Deletion succeeded, but cleanup failed: ${error.message}; remaining files: ${temporary}`;
        else failure = new Error(`${failure.message}; cleanup failed: ${error.message}; remaining files: ${temporary}`);
      }
    }
  }
  if (failure) throw failure;
  return { id: target.id, file: target.file, ...(cleanupWarning && { cleanupWarning }) };
}

function renameNode(project, { name, newName, unsavedFiles = [] }) {
  project = resolve(project);
  const directory = join(project, 'nodes');
  if (!lstatSync(directory).isDirectory()) throw new Error('nodes must be a directory, not a symbolic link');
  const realProject = realpathSync(project);
  const unsavedManifests = new Set();
  for (const file of unsavedFiles) {
    const absolute = resolve(file);
    const resolvedFile = resolveUnsavedFile(absolute);
    const inside = (root, candidate) => {
      const location = relative(root, candidate);
      return location && location !== '..' && !location.startsWith(`..${sep}`);
    };
    const manifest = recordUnsavedManifest(unsavedManifests, absolute, resolvedFile);
    if ((/\.(?:[cm]?[jt]s|[jt]sx)$/i.test(absolute) || /\.(?:[cm]?[jt]s|[jt]sx)$/i.test(resolvedFile) || manifest)
      && (inside(project, absolute) || inside(realProject, resolvedFile))) {
      throw new Error(`Save unsaved project file before rename: ${file}`);
    }
  }
  const graph = readGraph(project);
  const target = graph.nodes.find(node => node.name === name || node.id === name);
  if (!target) throw new Error(`Unknown node ${name}`);
  validateName(target.kind, newName);
  if (graph.nodes.some(node => node.name === newName)) throw new Error(`Duplicate node name ${newName}`);
  const destination = join(directory, `${newName}.ts`);
  function destinationConflicts() {
    if (!existsSync(destination)) return false;
    if (target.name.toLowerCase() !== newName.toLowerCase()) return true;
    const sourceInfo = lstatSync(target.file);
    const destinationInfo = lstatSync(destination);
    return !sourceInfo.isFile() || !destinationInfo.isFile() || sourceInfo.nlink !== 1 || destinationInfo.nlink !== 1
      || sourceInfo.dev !== destinationInfo.dev || sourceInfo.ino !== destinationInfo.ino;
  }
  if (destinationConflicts()) throw new Error(`Conflicting file ${destination}`);
  const projectManifests = new Set();
  const { packageName, checkManifestRoute, checkManifests } = packageManifestTracker(unsavedManifests);
  const targetInfo = statSync(target.file);
  for (let folder = dirname(project); ; folder = dirname(folder)) {
    checkManifestRoute(join(folder, 'package.json'), target, 'rename', targetInfo);
    if (dirname(folder) === folder) break;
  }
  function projectSources() {
    const files = [];
    function visit(folder) {
      checkManifestRoute(join(folder, 'package.json'), target, 'rename', targetInfo);
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (['.git', 'node_modules'].includes(entry.name) || (folder === project && entry.name === 'dist')) continue;
        const file = join(folder, entry.name);
        if (entry.name === 'package.json') projectManifests.add(file);
        if (entry.isSymbolicLink()) {
          const target = realpathSync(file);
          if (!statSync(file).isFile() || /\.(?:[cm]?[jt]s|[jt]sx)$/i.test(file) || /\.(?:[cm]?[jt]s|[jt]sx)$/i.test(target)) {
            throw new Error(`Conflicting symbolic link ${file}`);
          }
          continue;
        }
        if (entry.isDirectory()) visit(file);
        else if (/\.(?:[cm]?[jt]s|[jt]sx)$/i.test(entry.name)) files.push(file);
      }
    }
    visit(project);
    return files.sort();
  }
  const changes = [];
  const snapshots = new Map();
  const sourceFiles = projectSources();
  const initialManifests = new Set(projectManifests);
  for (const file of sourceFiles) {
    const info = lstatSync(file);
    if (!info.isFile() || info.nlink !== 1) throw new Error(`Conflicting file ${file}`);
    const original = readFileSync(file, 'utf8');
    snapshots.set(file, { original, info });
    const plugins = ['typescript', 'decorators'];
    if (/\.[jt]sx$/i.test(file)) plugins.push('jsx');
    const source = parse(original, { sourceType: 'unambiguous', allowReturnOutsideFunction: true, plugins });
    const edits = [];
    const visited = new Set();
    function staticString(node) {
      if (node?.type === 'StringLiteral') return node.value;
      if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
      if (node?.type === 'BinaryExpression' && node.operator === '+') {
        const left = staticString(node.left);
        const right = staticString(node.right);
        if (typeof left === 'string' && typeof right === 'string') return left + right;
      }
    }
    function isTargetSource(node) {
      const value = staticString(node);
      if (typeof value !== 'string') return;
      if (value.startsWith('#')) throw new Error(`Cannot resolve package import ${value} in ${file}`);
      let imported;
      if (/^file:/i.test(value)) {
        try {
          imported = fileURLToPath(value);
        } catch {
          throw new Error(`Cannot resolve node reference in ${file}`);
        }
      } else {
        if (!value.startsWith('.') && !isAbsolute(value)) {
          if (value !== '@graph') {
            const name = packageName(file);
            if (typeof name === 'string' && (value === name || value.startsWith(`${name}/`))) {
              throw new Error(`Cannot resolve package self-reference ${value} in ${file}`);
            }
          }
          return;
        }
        imported = resolve(dirname(file), value);
      }
      const candidates = [imported, `${imported}.ts`];
      if (imported.endsWith('.js')) candidates.push(`${imported.slice(0, -3)}.ts`);
      for (const candidate of candidates) {
        let info;
        try {
          info = statSync(candidate);
        } catch (error) {
          if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
        }
        const targetInfo = lstatSync(target.file);
        if (candidate === target.file || (info && info.dev === targetInfo.dev && info.ino === targetInfo.ino)) {
          return true;
        }
      }
    }
    function refuseTargetSource(node) {
      if (isTargetSource(node)) throw new Error(`Cannot resolve node reference in ${file}`);
    }
    function propertyEdit(property, shorthand = false) {
      const propertyName = property.type === 'Identifier' ? property.name : property.type === 'StringLiteral' ? property.value
        : property.type === 'TemplateLiteral' && property.expressions.length === 0 ? property.quasis[0].value.cooked : undefined;
      if (propertyName == null) throw new Error(`Cannot resolve graph namespace in ${file}`);
      if (propertyName !== target.name) return;
      const text = property.type === 'StringLiteral' ? JSON.stringify(newName) : property.type === 'TemplateLiteral' ? `\`${newName}\`` : newName;
      edits.push({ start: property.start, end: property.end, text: shorthand ? `${text}: ${target.name}` : text });
    }
    function namedImportEdit(specifier) {
      if (specifier.type !== 'ImportSpecifier' || (specifier.imported.name ?? specifier.imported.value) !== target.name) return;
      const text = specifier.imported === specifier.local || (specifier.imported.start === specifier.local.start && specifier.imported.end === specifier.local.end)
        ? `${newName} as ${specifier.local.name}` : newName;
      edits.push({ start: specifier.imported.start, end: specifier.imported.end, text });
    }
    function namespaceReference(reference) {
      while (['TSAsExpression', 'TSSatisfiesExpression', 'TSTypeAssertion', 'TSNonNullExpression'].includes(reference.parentPath.node.type)
        && reference.parentPath.node.expression === reference.node) reference = reference.parentPath;
      const parent = reference.parentPath;
      if ((parent.isMemberExpression() || parent.isOptionalMemberExpression()) && parent.node.object === reference.node) {
        if (parent.node.computed && parent.node.property.type === 'Identifier') throw new Error(`Cannot resolve graph namespace in ${file}`);
        propertyEdit(parent.node.property);
      } else if (parent.isTSQualifiedName() && parent.node.left === reference.node) {
        propertyEdit(parent.node.right);
      } else if ((parent.isVariableDeclarator() && parent.node.init === reference.node)
        || (parent.isAssignmentExpression() && parent.node.right === reference.node)) {
        const pattern = parent.isVariableDeclarator() ? parent.node.id : parent.node.left;
        if (pattern.type === 'ObjectPattern') {
          for (const property of pattern.properties) {
            if (property.type !== 'ObjectProperty' || (property.computed && property.key.type === 'Identifier')) throw new Error(`Cannot resolve graph namespace in ${file}`);
            propertyEdit(property.key, property.shorthand);
          }
        } else if (parent.isVariableDeclarator() && pattern.type === 'Identifier') {
          namespaceBinding(parent.scope.getBinding(pattern.name));
        } else throw new Error(`Cannot resolve graph namespace in ${file}`);
      } else throw new Error(`Cannot resolve graph namespace in ${file}`);
    }
    function namespaceBinding(binding) {
      if (!binding?.constant) throw new Error(`Cannot resolve graph namespace in ${file}`);
      if (visited.has(binding)) return;
      visited.add(binding);
      for (const reference of binding.referencePaths) namespaceReference(reference);
    }
    function dynamicImport(path) {
      if (!path.parentPath.isAwaitExpression()) throw new Error(`Cannot resolve graph namespace in ${file}`);
      namespaceReference(path.parentPath);
    }
    function checkLoaderMember(path) {
      const { object, property, computed } = path.node;
      if (object.type !== 'Identifier') return;
      const name = computed ? staticString(property) : property.name;
      if (object.name === 'process' && (name === 'getBuiltinModule' || typeof name !== 'string')) {
        throw new Error(`Cannot resolve module loader in ${file}`);
      }
      if ((['globalThis', 'global'].includes(object.name) && ['process', 'module'].includes(name))
        || (object.name === 'module' && ['constructor', 'parent', 'children'].includes(name))
        || (object.name === 'process' && name === 'mainModule')) {
        throw new Error(`Cannot resolve module loader in ${file}`);
      }
      if (!['module', 'globalThis', 'global'].includes(object.name)) return;
      if (name !== 'require' && typeof name === 'string') return;
      if (object.name !== 'module' || !path.isMemberExpression()
        || !(path.parentPath.isCallExpression() && path.parentPath.node.callee === path.node)) {
        throw new Error(`Cannot resolve module loader in ${file}`);
      }
    }
    traverse(source, {
      Program(path) {
        if (file !== target.file) return;
        const binding = path.scope.getBinding(target.name);
        if (!binding) throw new Error(`Cannot resolve node ${target.name}`);
        if (path.scope.hasBinding(newName) || path.scope.hasGlobal(newName) || binding.constantViolations.length) {
          throw new Error(`Conflicting binding for ${newName} in ${file}`);
        }
        edits.push({ start: binding.identifier.start, end: binding.identifier.end, text: newName });
        for (const reference of binding.referencePaths.filter(reference => reference.isIdentifier())) {
          if (reference.scope.hasBinding(newName)) throw new Error(`Conflicting binding for ${newName} in ${file}`);
          const shorthand = reference.parentPath.isObjectProperty() && reference.parentPath.node.shorthand;
          edits.push({ start: reference.node.start, end: reference.node.end, text: shorthand ? `${target.name}: ${newName}` : newName });
        }
      },
      ImportDeclaration(path) {
        if (isTargetSource(path.node.source)) {
          const value = path.node.source.value;
          const slash = value.lastIndexOf('/');
          const filename = value.slice(slash + 1);
          if (!value.startsWith('.') || slash < 0 || filename.toLowerCase() !== `${target.name}.ts`.toLowerCase()
            || realpathSync(dirname(resolve(dirname(file), value))) !== realpathSync(directory)
            || !path.node.specifiers.length || path.node.specifiers.some(specifier => specifier.type !== 'ImportSpecifier')
            || !path.node.specifiers.some(specifier => (specifier.imported.name ?? specifier.imported.value) === target.name)) {
            throw new Error(`Cannot resolve node reference in ${file}`);
          }
          edits.push({ start: path.node.source.start, end: path.node.source.end, text: JSON.stringify(`${value.slice(0, slash + 1)}${newName}.ts`) });
          for (const specifier of path.node.specifiers) namedImportEdit(specifier);
        }
        if (['module', 'node:module'].includes(path.node.source.value)
          && path.node.specifiers.some(specifier => specifier.type === 'ImportNamespaceSpecifier'
            || specifier.type === 'ImportDefaultSpecifier'
            || ['createRequire', 'default', 'Module'].includes(specifier.imported?.name ?? specifier.imported?.value))) {
          throw new Error(`Cannot resolve module loader in ${file}`);
        }
        if (path.node.source.value !== '@graph') return;
        for (const specifier of path.node.specifiers) {
          if (specifier.type === 'ImportNamespaceSpecifier') {
            namespaceBinding(path.scope.getBinding(specifier.local.name));
            continue;
          }
          namedImportEdit(specifier);
        }
      },
      ExportNamedDeclaration(path) {
        refuseTargetSource(path.node.source);
        if (['module', 'node:module'].includes(path.node.source?.value)
          && path.node.specifiers.some(specifier => specifier.type !== 'ExportSpecifier'
            || ['createRequire', 'default', 'Module'].includes(specifier.local.name ?? specifier.local.value))) {
          throw new Error(`Cannot resolve module loader in ${file}`);
        }
        if (path.node.source?.value !== '@graph') return;
        for (const specifier of path.node.specifiers) {
          if (specifier.type !== 'ExportSpecifier') throw new Error(`Cannot resolve graph namespace in ${file}`);
          if ((specifier.local.name ?? specifier.local.value) !== target.name) continue;
          const sameName = specifier.local.start === specifier.exported.start && specifier.local.end === specifier.exported.end;
          const text = sameName ? `${newName} as ${target.name}` : newName;
          edits.push({ start: specifier.local.start, end: specifier.local.end, text });
        }
      },
      ExportAllDeclaration(path) {
        refuseTargetSource(path.node.source);
        if (['module', 'node:module'].includes(path.node.source.value)) throw new Error(`Cannot resolve module loader in ${file}`);
        if (path.node.source.value === '@graph') throw new Error(`Cannot resolve graph namespace in ${file}`);
      },
      TSImportType(path) {
        refuseTargetSource(path.node.argument);
        if (path.node.argument.value !== '@graph') return;
        let qualifier = path.node.qualifier;
        while (qualifier?.type === 'TSQualifiedName') qualifier = qualifier.left;
        if (!qualifier) throw new Error(`Cannot resolve graph namespace in ${file}`);
        propertyEdit(qualifier);
      },
      TSExternalModuleReference(path) {
        refuseTargetSource(path.node.expression);
        if (['@graph', 'module', 'node:module'].includes(path.node.expression.value)) throw new Error(`Cannot resolve module reference in ${file}`);
      },
      ReferencedIdentifier(path) {
        if (path.node.name === 'require' && !(path.parentPath.isCallExpression() && path.parentPath.node.callee === path.node)) {
          throw new Error(`Cannot resolve require reference in ${file}`);
        }
        const declaration = path.parentPath.node;
        if (path.node.name === 'process' && !path.scope.getBinding('process') && path.parentPath.isVariableDeclarator()
          && declaration.init === path.node && declaration.id.type === 'ObjectPattern'
          && declaration.id.properties.every(property => property.type === 'ObjectProperty' && !property.computed && property.key.name === 'env')) return;
        if (['module', 'globalThis', 'global', 'process'].includes(path.node.name)
          && !((path.parentPath.isMemberExpression() || path.parentPath.isOptionalMemberExpression())
          && path.parentPath.node.object === path.node)) {
          throw new Error(`Cannot resolve loader host reference in ${file}`);
        }
      },
      MemberExpression: checkLoaderMember,
      OptionalMemberExpression: checkLoaderMember,
      CallExpression(path) {
        const callee = path.node.callee;
        const argument = path.node.arguments[0];
        const isModuleRequire = callee.type === 'MemberExpression' && callee.object.type === 'Identifier' && callee.object.name === 'module'
          && ((!callee.computed && callee.property.type === 'Identifier' && callee.property.name === 'require')
            || (callee.computed && (staticString(callee.property) === 'require' || typeof staticString(callee.property) !== 'string')));
        if (callee.type === 'Import' || (callee.type === 'Identifier' && callee.name === 'require') || isModuleRequire) {
          refuseTargetSource(argument);
        }
        if (callee.type === 'Import') {
          if (staticString(argument) === '@graph') dynamicImport(path);
          else if (['module', 'node:module'].includes(staticString(argument))) throw new Error(`Cannot resolve module loader in ${file}`);
          else if (typeof staticString(argument) !== 'string') throw new Error(`Cannot resolve dynamic import in ${file}`);
        }
        if (isModuleRequire && (staticString(argument) === '@graph' || typeof staticString(argument) !== 'string')) {
          throw new Error(`Cannot resolve graph namespace in ${file}`);
        }
        if (path.node.callee.type === 'Identifier' && path.node.callee.name === 'require'
          && (staticString(argument) === '@graph'
            || typeof staticString(argument) !== 'string'
            || ['module', 'node:module'].includes(staticString(argument)))) {
          throw new Error(`Cannot resolve graph namespace in ${file}`);
        }
        if (isModuleRequire && ['module', 'node:module'].includes(staticString(argument))) {
          throw new Error(`Cannot resolve module loader in ${file}`);
        }
      },
      ImportExpression(path) {
        refuseTargetSource(path.node.source);
        if (staticString(path.node.source) === '@graph') dynamicImport(path);
        else if (['module', 'node:module'].includes(staticString(path.node.source))) throw new Error(`Cannot resolve module loader in ${file}`);
        else if (typeof staticString(path.node.source) !== 'string') throw new Error(`Cannot resolve dynamic import in ${file}`);
      },
    });
    if (!edits.length && file !== target.file) continue;
    let updated = original;
    for (const edit of edits.sort((first, second) => second.start - first.start)) updated = updated.slice(0, edit.start) + edit.text + updated.slice(edit.end);
    changes.push({ file, destination: file === target.file ? destination : file, original, updated, info });
  }
  const temporary = mkdtempSync(join(directory, '.graphscript-rename-'));
  const moved = [];
  const installed = [];
  let retainRecovery = false;
  let committed = false;
  let failure;
  let cleanupWarning;
  try {
    for (const [index, change] of changes.entries()) {
      const staged = join(temporary, `new-${index}`);
      writeFileSync(staged, change.updated, { mode: change.info.mode, flag: 'wx' });
      chmodSync(staged, change.info.mode & 0o7777);
    }
    for (const [file, snapshot] of snapshots) {
      if (!matchesSnapshot(file, snapshot)) throw new Error(`Conflicting change in ${file}`);
    }
    checkManifests();
    if (destinationConflicts()) throw new Error(`Conflicting file ${destination}`);
    for (const [index, change] of changes.entries()) {
      renameSync(change.file, join(temporary, `old-${index}`));
      moved.push(index);
      if (!matchesSnapshot(join(temporary, `old-${index}`), change)) {
        throw new Error(`Conflicting change in ${change.file}`);
      }
    }
    const changedFiles = new Set(changes.map(change => change.file));
    for (const [file, snapshot] of snapshots) {
      if (!changedFiles.has(file) && !matchesSnapshot(file, snapshot)) throw new Error(`Conflicting change in ${file}`);
    }
    checkManifests();
    const remaining = projectSources();
    if (remaining.length !== snapshots.size - changedFiles.size || remaining.some(file => !snapshots.has(file) || changedFiles.has(file))) {
      throw new Error('Conflicting project source change during rename');
    }
    if (projectManifests.size !== initialManifests.size) throw new Error('Conflicting project package manifest change during rename');
    for (const [index, change] of changes.entries()) {
      if (existsSync(change.destination)) throw new Error(`Conflicting file ${change.destination}`);
      const staged = join(temporary, `new-${index}`);
      const info = lstatSync(staged);
      linkSync(staged, change.destination);
      installed.push({ index, info });
      unlinkSync(staged);
    }
    checkManifests();
    const installedSources = projectSources();
    const expectedSources = new Set([...snapshots.keys()].filter(file => !changedFiles.has(file)));
    for (const change of changes) expectedSources.add(change.destination);
    if (installedSources.length !== expectedSources.size || installedSources.some(file => !expectedSources.has(file))
      || projectManifests.size !== initialManifests.size) {
      throw new Error('Conflicting project source or package manifest change during rename');
    }
    for (const [file, snapshot] of snapshots) {
      if (!changedFiles.has(file) && !matchesSnapshot(file, snapshot)) throw new Error(`Conflicting change in ${file}`);
    }
    for (const { index, info } of installed) {
      const change = changes[index];
      if (!matchesSnapshot(change.destination, { info, original: change.updated })) {
        throw new Error(`Conflicting change in ${change.destination}`);
      }
    }
    checkManifests();
    committed = true;
  } catch (error) {
    failure = error;
    const rollbackErrors = [];
    for (const { index, info } of installed.reverse()) {
      try {
        const snapshot = { info, original: changes[index].updated };
        const staged = join(temporary, `new-${index}`);
        const stagedExists = existsSync(staged);
        const links = stagedExists ? 2 : 1;
        if ((stagedExists && !matchesSnapshot(staged, snapshot, links)) || !matchesSnapshot(changes[index].destination, snapshot, links)) {
          throw new Error(`Conflicting change in ${changes[index].destination}`);
        }
        unlinkSync(changes[index].destination);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    for (const index of moved.reverse()) {
      try {
        linkSync(join(temporary, `old-${index}`), changes[index].file);
        unlinkSync(join(temporary, `old-${index}`));
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length) {
      retainRecovery = true;
      failure = new Error(`${error.message}; rollback failed: ${rollbackErrors.map(rollbackError => rollbackError.message).join('; ')}; recovery files: ${temporary}`);
    }
  } finally {
    if (!retainRecovery) {
      try {
        rmSync(temporary, { recursive: true, force: true });
      } catch (error) {
        if (committed) cleanupWarning = `Rename succeeded, but cleanup failed: ${error.message}; remaining files: ${temporary}`;
        else failure = new Error(`${failure.message}; cleanup failed: ${error.message}; remaining files: ${temporary}`);
      }
    }
  }
  if (failure) throw failure;
  return { id: target.id, file: destination, ...(cleanupWarning && { cleanupWarning }) };
}

module.exports = { deleteNode, renameNode };