const { mkdtempSync, readdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { basename, join, resolve } = require('node:path');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { API, DiagnosticCategory } = require('typescript/unstable/sync');
const { SyntaxKind, createScanner } = require('typescript/unstable/ast');
const { readGraph } = require('./graph');
const { isNodeRequire, runtimeImportError, urlImportPath } = require('./import-validation');

function primaryName(kind, primary) {
  if (kind === 'function' && primary?.kind === SyntaxKind.FunctionDeclaration) return primary.name?.text;
  if (kind === 'class' && primary?.kind === SyntaxKind.ClassDeclaration) return primary.name?.text;
  if (kind === 'state' && primary?.kind === SyntaxKind.VariableStatement && primary.declarationList.declarations.length === 1) {
    const declaration = primary.declarationList.declarations[0];
    let initializer = declaration.initializer;
    while (initializer && [SyntaxKind.AsExpression, SyntaxKind.SatisfiesExpression, SyntaxKind.TypeAssertionExpression,
      SyntaxKind.NonNullExpression, SyntaxKind.ParenthesizedExpression].includes(initializer.kind)) initializer = initializer.expression;
    if (declaration.name.kind === SyntaxKind.Identifier && initializer?.kind === SyntaxKind.ObjectLiteralExpression) return declaration.name.text;
  }
}

function checkManagedNode(source) {
  const statements = source.statements;
  const modifier = (node, kind) => node.modifiers?.some(item => item.kind === kind);
  const literal = node => node?.kind === SyntaxKind.ExpressionStatement && node.expression.kind === SyntaxKind.StringLiteral
    ? node.expression : undefined;
  const directives = statements.filter(statement => literal(statement)?.text.startsWith('graphscript:'));
  const first = literal(statements[0]);
  const raw = first?.getText(source);
  const kind = first?.text.slice('graphscript:'.length);
  function error(message, node) {
    const position = source.getLineAndCharacterOfPosition(node?.getStart(source) ?? 0);
    return { severity: 'error', source: 'graphscript', file: source.fileName, line: position.line + 1,
      column: position.character + 1, message: `GraphScript rule error: ${message}` };
  }
  if (directives.length !== 1 || !['function', 'class', 'state'].includes(kind)
    || ![`"graphscript:${kind}"`, `'graphscript:${kind}'`].includes(raw)) {
    return error('exactly one node-kind directive must be the first statement', statements[0]);
  }
  const exports = statements.filter(statement => modifier(statement, SyntaxKind.ExportKeyword)
    || [SyntaxKind.ExportDeclaration, SyntaxKind.ExportAssignment, SyntaxKind.NamespaceExportDeclaration].includes(statement.kind));
  const primary = exports[0];
  const name = primary && !modifier(primary, SyntaxKind.DeclareKeyword) && !modifier(primary, SyntaxKind.DefaultKeyword)
    ? primaryName(kind, primary) : undefined;
  if (exports.length !== 1 || !name) return error('exactly one primary export must match the node kind', exports[1] ?? primary ?? statements[0]);
  if (basename(source.fileName) !== `${name}.ts`) return error('filename must match the primary export', primary);
  const runtime = statements.find(statement => [SyntaxKind.FunctionDeclaration, SyntaxKind.ClassDeclaration, SyntaxKind.VariableStatement,
    SyntaxKind.EnumDeclaration, SyntaxKind.ModuleDeclaration].includes(statement.kind)
    && !modifier(statement, SyntaxKind.ExportKeyword) && !modifier(statement, SyntaxKind.DeclareKeyword));
  if (runtime) return error('private top-level runtime definitions are not allowed', runtime);
}

function nodeCandidate(source) {
  const first = source.statements[0];
  const kind = first?.kind === SyntaxKind.ExpressionStatement && first.expression.kind === SyntaxKind.StringLiteral
    ? first.expression.text.slice('graphscript:'.length) : undefined;
  const primary = source.statements.find(statement => statement.modifiers?.some(item => item.kind === SyntaxKind.ExportKeyword)
    && [SyntaxKind.FunctionDeclaration, SyntaxKind.ClassDeclaration, SyntaxKind.VariableStatement].includes(statement.kind));
  const name = primaryName(kind, primary);
  return name ? { name, kind, file: source.fileName, position: primary.getStart(source) } : undefined;
}

function identityComments(source) {
  const protectedTokens = new Map();
  function visit(node) {
    if ([SyntaxKind.RegularExpressionLiteral, SyntaxKind.TemplateHead, SyntaxKind.TemplateMiddle, SyntaxKind.TemplateTail,
      SyntaxKind.NoSubstitutionTemplateLiteral].includes(node.kind)) protectedTokens.set(node.getStart(source), node.end);
    node.forEachChild(visit);
  }
  visit(source);
  const scanner = createScanner(false, undefined, source.text);
  const comments = [];
  for (let token = scanner.scan(); token !== SyntaxKind.EndOfFile; token = scanner.scan()) {
    const pos = scanner.getTokenStart();
    const protectedEnd = protectedTokens.get(pos);
    if (protectedEnd !== undefined) {
      scanner.resetTokenState(protectedEnd);
    } else if (token === SyntaxKind.SingleLineCommentTrivia || token === SyntaxKind.MultiLineCommentTrivia) {
      const end = scanner.getTokenEnd();
      const text = source.text.slice(pos + 2, end - (token === SyntaxKind.MultiLineCommentTrivia ? 2 : 0));
      if (/^\s*graphscript:id\b/.test(text)) comments.push({ pos, text });
    }
  }
  return comments;
}

function checkProject(project) {
  project = resolve(project);
  const files = readdirSync(join(project, 'nodes')).filter(file => file.endsWith('.ts')).sort().map(file => join(project, 'nodes', file));
  const diagnostics = [];
  const programStarts = [];
  if (files.length) {
    const temporary = mkdtempSync(join(tmpdir(), 'graphscript-check-'));
    const api = new API({ cwd: project });
    try {
      const index = join(temporary, 'index.ts');
      writeFileSync(index, '');
      const config = join(temporary, 'tsconfig.json');
      writeFileSync(config, JSON.stringify({ compilerOptions: { noEmit: true, strict: true, target: 'esnext', module: 'nodenext', paths: { '@graph': [index] } }, files }));
      const snapshot = api.updateSnapshot({ openProjects: [config] });
      const initialProgram = snapshot.getProject(config).program;
      const nodes = [];
      const ids = new Set();
      const seenNames = new Set();
      const sources = [];
      for (const file of files) {
        const source = initialProgram.getSourceFile(file);
        if (source) {
          sources.push(source);
          if (source.statements[0]?.getText(source) === '"graphscript:program";') {
            programStarts.push(file);
            for (const statement of source.statements.slice(1)) {
              if (statement.kind !== SyntaxKind.ExpressionStatement || statement.expression.kind !== SyntaxKind.StringLiteral
                || !statement.expression.text.startsWith('graphscript:')) continue;
              const position = source.getLineAndCharacterOfPosition(statement.getStart(source));
              diagnostics.push({ severity: 'error', source: 'graphscript', file, line: position.line + 1, column: position.character + 1,
                message: 'GraphScript rule error: exactly one program directive must be the first statement' });
            }
            continue;
          }
          const error = checkManagedNode(source);
          if (error) diagnostics.push(error);
          const comments = identityComments(source);
          const match = comments.length === 1 && comments[0].text.match(/^\s*graphscript:id\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*$/i);
          const id = match?.[1]?.toLowerCase();
          if (!id || ids.has(id)) {
            const position = source.getLineAndCharacterOfPosition((comments[1] ?? comments[0])?.pos ?? 0);
            diagnostics.push({ severity: 'error', source: 'graphscript', file, line: position.line + 1, column: position.character + 1,
              message: `GraphScript identity error: ${id ? `duplicate node ID ${id}` : 'expected one valid node ID'}` });
          }
          if (id) ids.add(id);
          const candidate = nodeCandidate(source);
          if (candidate) {
            if (seenNames.has(candidate.name)) {
              const position = source.getLineAndCharacterOfPosition(candidate.position);
              diagnostics.push({ severity: 'error', source: 'graphscript', file, line: position.line + 1, column: position.character + 1,
                message: `GraphScript rule error: duplicate node name ${candidate.name}` });
              continue;
            }
            seenNames.add(candidate.name);
            const { position, ...node } = candidate;
            nodes.push({ ...node, id });
          }
        }
      }
      const names = new Set(nodes.map(node => node.name));
      for (const source of sources) {
        function reportRelativeRuntimeImport(text, start) {
          const message = runtimeImportError(text);
          if (message) {
            const position = source.getLineAndCharacterOfPosition(start);
            diagnostics.push({ severity: 'error', source: 'graphscript', file: source.fileName, line: position.line + 1,
              column: position.character + 1, message });
          }
        }
        function checkRelativeRuntimeImport(specifier) {
          if ([SyntaxKind.StringLiteral, SyntaxKind.NoSubstitutionTemplateLiteral].includes(specifier?.kind)) {
            reportRelativeRuntimeImport(specifier.text, specifier.getStart(source));
          }
        }
        function checkDynamicImport(node) {
          if (node.kind === SyntaxKind.CallExpression && node.expression.kind === SyntaxKind.ImportKeyword) {
            checkRelativeRuntimeImport(node.arguments?.[0]);
          }
          node.forEachChild(checkDynamicImport);
        }
        source.forEachChild(checkDynamicImport);
        let parsed;
        try {
          parsed = parse(source.text, { sourceType: 'module', plugins: ['typescript', 'decorators'], errorRecovery: true });
        } catch {}
        function checkRelativeUrl(path, argument) {
          const specifier = urlImportPath(path, argument);
          if (specifier?.type === 'StringLiteral') reportRelativeRuntimeImport(specifier.value, specifier.start);
          if (specifier?.type === 'TemplateLiteral' && specifier.expressions.length === 0) {
            reportRelativeRuntimeImport(specifier.quasis[0].value.cooked, specifier.start);
          }
        }
        if (parsed) traverse(parsed, { ImportExpression(path) {
          checkRelativeUrl(path, path.node.source);
        }, 'CallExpression|OptionalCallExpression'(path) {
          if (path.node.callee.type === 'Import') {
            checkRelativeUrl(path, path.node.arguments[0]);
            return;
          }
          if (!isNodeRequire(path, path.node.callee)) return;
          const specifier = path.node.arguments[0];
          if (specifier?.type === 'StringLiteral') reportRelativeRuntimeImport(specifier.value, specifier.start);
          if (specifier?.type === 'TemplateLiteral' && specifier.expressions.length === 0) {
            reportRelativeRuntimeImport(specifier.quasis[0].value.cooked, specifier.start);
          }
        } });
        for (const statement of source.statements) {
          const bindings = statement.importClause?.namedBindings;
          const specifier = statement.moduleSpecifier;
          const typeOnly = statement.importClause?.isTypeOnly || (!statement.importClause?.name
            && bindings?.kind === SyntaxKind.NamedImports && bindings.elements.length > 0
            && bindings.elements.every(element => element.isTypeOnly));
          if (statement.kind === SyntaxKind.ImportDeclaration && !typeOnly) checkRelativeRuntimeImport(specifier);
          if (statement.kind === SyntaxKind.ImportEqualsDeclaration && !statement.isTypeOnly
            && statement.moduleReference?.kind === SyntaxKind.ExternalModuleReference) {
            checkRelativeRuntimeImport(statement.moduleReference.expression);
          }
          if (statement.kind === SyntaxKind.ExportDeclaration && !statement.isTypeOnly
            && !(statement.exportClause?.kind === SyntaxKind.NamedExports && statement.exportClause.elements.length > 0
              && statement.exportClause.elements.every(element => element.isTypeOnly))) checkRelativeRuntimeImport(specifier);
          if (statement.kind !== SyntaxKind.ImportDeclaration || statement.moduleSpecifier?.text !== '@graph'
            || bindings?.kind !== SyntaxKind.NamedImports) continue;
          for (const specifier of bindings.elements) {
            const name = (specifier.propertyName ?? specifier.name).text;
            if (names.has(name)) continue;
            const position = source.getLineAndCharacterOfPosition(specifier.getStart(source));
            diagnostics.push({ severity: 'error', source: 'graphscript', file: source.fileName, line: position.line + 1,
              column: position.character + 1, message: `GraphScript import error: unknown node ${name}` });
          }
        }
      }
      const graphParseErrors = [];
      try {
        readGraph(project, { additionalNodes: nodes, onWarning: warning => diagnostics.push({ severity: 'warning', source: 'analyzer', ...warning }),
          onParseError: error => graphParseErrors.push(error) });
      } catch (error) {
        const file = error.file ?? files.find(file => error.message.startsWith(`${file}: `));
        const message = file && error.message.startsWith(`${file}: `) ? error.message.slice(file.length + 2) : error.message;
        if (!diagnostics.some(diagnostic => diagnostic.file === file && error.message.includes(diagnostic.message))) {
          diagnostics.push({ severity: 'error', source: 'graphscript', ...(file && { file, line: error.line ?? 1, column: error.column ?? 1 }), message });
        }
      }
      writeFileSync(index, nodes.map(node => `export { ${node.name} } from ${JSON.stringify(node.file.replace(/\.ts$/, '.js'))};`).join('\n'));
      const program = api.updateSnapshot({ fileChanges: { changed: [index] } }).getProject(config).program;
      const syntaxDiagnostics = program.getSyntacticDiagnostics();
      for (const error of graphParseErrors) {
        if (!syntaxDiagnostics.some(diagnostic => diagnostic.category === DiagnosticCategory.Error && diagnostic.fileName === error.file)) {
          diagnostics.push({ severity: 'warning', source: 'analyzer', ...error, message: 'Cannot analyze the node source' });
        }
      }
      for (const diagnostic of [...program.getConfigFileParsingDiagnostics(), ...program.getProgramDiagnostics(),
        ...program.getGlobalDiagnostics(), ...syntaxDiagnostics, ...program.getBindDiagnostics(), ...program.getSemanticDiagnostics()]) {
        let location = {};
        if (diagnostic.fileName) {
          const position = program.getSourceFile(diagnostic.fileName)?.getLineAndCharacterOfPosition(diagnostic.pos);
          location = { file: diagnostic.fileName, ...(position && { line: position.line + 1, column: position.character + 1 }) };
        }
        diagnostics.push({ severity: diagnostic.category === DiagnosticCategory.Error ? 'error' : 'warning', source: 'typescript',
          code: diagnostic.code, message: diagnostic.text, ...location });
      }
    } finally {
      api.close();
      rmSync(temporary, { recursive: true, force: true });
    }
  }
  if (programStarts.length > 1) diagnostics.push({ severity: 'error', source: 'graphscript',
    message: `Multiple program-start files: ${programStarts.join(', ')}` });
  return { ok: !diagnostics.some(diagnostic => diagnostic.severity === 'error'), diagnostics,
    ...(programStarts.length <= 1 && { mode: programStarts.length ? 'program' : 'library' }),
    ...(programStarts.length === 1 && { programStart: programStarts[0] }) };
}

module.exports = { checkProject };