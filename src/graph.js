const { readFileSync, readdirSync, watch } = require('node:fs');
const { basename, join } = require('node:path');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { isNodeRequire, runtimeImportError, urlImportPath } = require('./import-validation');

function parseNode(file) {
  return parse(readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['typescript', 'decorators'], errorRecovery: true });
}

function readNodeCandidates(files) {
  return files.flatMap(file => {
    try {
      const source = parseNode(file);
      const kind = source.program.directives[0]?.value.value?.slice('graphscript:'.length);
      const declaration = source.program.body.find(statement => statement.type === 'ExportNamedDeclaration' && statement.declaration)?.declaration;
      if (!['function', 'class', 'state'].includes(kind) || !matchesNodeKind(kind, declaration)) return [];
      return [{ name: kind === 'state' ? declaration.declarations[0].id.name : declaration.id.name, file }];
    } catch {
      return [];
    }
  });
}

function matchesNodeKind(kind, primary) {
  if (!primary || primary.declare) return false;
  if (kind === 'function') return primary.type === 'FunctionDeclaration' && Boolean(primary.id);
  if (kind === 'class') return primary.type === 'ClassDeclaration' && Boolean(primary.id);
  if (primary.type !== 'VariableDeclaration' || primary.declarations.length !== 1) return false;
  const declaration = primary.declarations[0];
  let initializer = declaration.init;
  while (initializer && ['TSAsExpression', 'TSSatisfiesExpression', 'TSTypeAssertion', 'TSNonNullExpression'].includes(initializer.type)) {
    initializer = initializer.expression;
  }
  return declaration.id.type === 'Identifier' && initializer?.type === 'ObjectExpression';
}

function relativeRuntimeImport(source) {
  let invalid;
  traverse(source, { enter(path) {
    if (invalid) return;
    const node = path.node;
    let specifier;
    if (node.type === 'ImportDeclaration' && node.importKind !== 'type'
      && !(node.specifiers.length && node.specifiers.every(item => item.importKind === 'type'))) specifier = node.source;
    else if (['ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.exportKind !== 'type'
      && !(node.specifiers?.length && node.specifiers.every(item => item.exportKind === 'type'))) specifier = node.source;
    else if (node.type === 'TSImportEqualsDeclaration' && node.importKind !== 'type'
      && node.moduleReference.type === 'TSExternalModuleReference') specifier = node.moduleReference.expression;
    else if (node.type === 'ImportExpression') specifier = node.source;
    else if (node.type === 'CallExpression' && node.callee.type === 'Import') specifier = node.arguments[0];
    else if (['CallExpression', 'OptionalCallExpression'].includes(node.type) && isNodeRequire(path, node.callee)) specifier = node.arguments[0];
    if (node.type === 'ImportExpression' || node.type === 'CallExpression' && node.callee.type === 'Import') {
      specifier = urlImportPath(path, specifier) ?? specifier;
    }
    const value = specifier?.type === 'StringLiteral' ? specifier.value
      : specifier?.type === 'TemplateLiteral' && specifier.expressions.length === 0 ? specifier.quasis[0].value.cooked : undefined;
    const message = runtimeImportError(value);
    if (message) invalid = { specifier, message };
  } });
  return invalid;
}

function checkNode(file, source, onLocation = () => {}) {
  if (!source) {
    try {
      source = parseNode(file);
    } catch {
      return `${file}: GraphScript rule error: could not parse node source`;
    }
  }
  function ruleError(message, node) {
    if (node?.loc) onLocation(node.loc.start);
    return `${file}: GraphScript rule error: ${message}`;
  }
  const directives = [
    ...source.program.directives.map(directive => directive.value.extra.expressionValue),
    ...source.program.body.filter(statement => statement.type === 'ExpressionStatement' && statement.expression.type === 'StringLiteral')
      .map(statement => statement.expression.value),
  ].filter(value => value.startsWith('graphscript:'));
  if (directives.length !== 1 || !/^graphscript:(function|class|state)$/.test(source.program.directives[0]?.value.value ?? '')) {
    return ruleError('exactly one node-kind directive must be the first statement', source.program.directives[0] ?? source.program.body[0]);
  }
  const kind = source.program.directives[0].value.value.slice('graphscript:'.length);
  const exports = source.program.body.filter(statement => statement.type.startsWith('Export') || statement.type.startsWith('TSExport')
    || statement.type === 'TSNamespaceExportDeclaration' || (statement.type === 'TSImportEqualsDeclaration' && statement.isExport));
  const primary = exports[0]?.type === 'ExportNamedDeclaration' ? exports[0].declaration : undefined;
  if (exports.length !== 1 || !matchesNodeKind(kind, primary)) {
    return ruleError('exactly one primary export must match the node kind', exports[1] ?? exports[0] ?? source.program.directives[0]);
  }
  const name = kind === 'state' ? primary.declarations[0].id.name : primary.id.name;
  if (basename(file) !== `${name}.ts`) return ruleError('filename must match the primary export', exports[0]);
  const runtimeDeclarations = ['FunctionDeclaration', 'ClassDeclaration', 'VariableDeclaration', 'TSEnumDeclaration', 'TSModuleDeclaration'];
  const privateDeclaration = source.program.body.find(statement => runtimeDeclarations.includes(statement.type) && !statement.declare);
  if (privateDeclaration) return ruleError('private top-level runtime definitions are not allowed', privateDeclaration);
  return null;
}

function dynamicGraphImports(node, fromId, namespaces) {
  if (!node || typeof node !== 'object') return;
  if ((node.type === 'CallExpression' && node.callee?.type === 'Import' && node.arguments[0]?.value === '@graph')
    || (node.type === 'ImportExpression' && node.source?.value === '@graph')) {
    namespaces.push({ fromId, kind: 'dynamic', localName: null });
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) dynamicGraphImports(child, fromId, namespaces);
    } else if (value && typeof value === 'object' && typeof value.type === 'string') {
      dynamicGraphImports(value, fromId, namespaces);
    }
  }
}

function readNodeIndex(project, { reservedName, onParseError, analysisNodes } = {}) {
  const directory = join(project, 'nodes');
  const nodes = [];
  const pendingImports = [];
  const pendingNamespaces = [];
  const sources = [];
  const names = new Map();
  const ids = new Set();
  const ruleErrors = [];
  const files = readdirSync(directory).filter(file => file.endsWith('.ts')).sort().map(filename => join(directory, filename));
  function readSource(file) {
    let source;
    try {
      source = parseNode(file);
    } catch (error) {
      if (onParseError) {
        onParseError({ file, line: error.loc?.line ?? 1, column: (error.loc?.column ?? 0) + 1 });
        return;
      }
      throw new Error(`${file}: GraphScript rule error: could not parse node source`);
    }
    if (source.errors.length) {
      if (onParseError) {
        onParseError({ file, line: source.errors[0].loc?.line ?? 1, column: (source.errors[0].loc?.column ?? 0) + 1 });
      } else {
        throw new Error(`${file}: GraphScript syntax error: ${source.errors[0].message}`);
      }
    }
    return source;
  }
  const parsed = onParseError ? new Map(files.map(file => [file, readSource(file)])) : undefined;
  for (const file of files) {
    const source = parsed ? parsed.get(file) : readSource(file);
    if (!source) continue;
    if (!analysisNodes) {
      const invalid = relativeRuntimeImport(source);
      if (invalid) {
        const error = new Error(`${file}: ${invalid.message}`);
        Object.assign(error, { file, line: invalid.specifier.loc.start.line, column: invalid.specifier.loc.start.column + 1 });
        throw error;
      }
    }
    const directive = source.program.directives[0];
    if (directive?.value.extra.raw === '"graphscript:program"'
      && directive.end - directive.start === '"graphscript:program";'.length) continue;
    let node;
    if (analysisNodes) {
      node = analysisNodes.find(candidate => candidate.file === file);
      if (!node?.id || ids.has(node.id) || names.has(node.name)) continue;
    } else {
      const ruleError = checkNode(file, source);
      if (ruleError) ruleErrors.push(ruleError);
      const kind = source.program.directives[0]?.value.value?.slice('graphscript:'.length);
      const declaration = source.program.body.find(statement => statement.type === 'ExportNamedDeclaration' && statement.declaration)?.declaration;
      const name = kind === 'state' ? declaration?.declarations?.[0]?.id?.name : declaration?.id?.name;
      if (name === reservedName) throw new Error(`Duplicate node name ${name}: already exists`);
      const identityComments = source.comments.filter(comment => /^\s*graphscript:id\b/.test(comment.value));
      const identity = identityComments.length === 1 && identityComments[0].value.match(/^\s*graphscript:id\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*$/i);
      function identityError(message, comment) {
        const error = new Error(`${file}: GraphScript identity error: ${message}`);
        Object.assign(error, { file, line: comment?.loc.start.line ?? 1, column: (comment?.loc.start.column ?? 0) + 1 });
        return error;
      }
      if (!identity) throw identityError('expected one valid node ID', identityComments[1] ?? identityComments[0]);
      const id = identity[1].toLowerCase();
      if (ids.has(id)) throw identityError(`duplicate node ID ${id}`, identityComments[0]);
      if (!name || !['function', 'class', 'state'].includes(kind)) throw new Error(`${file}: GraphScript rule error: invalid node declaration`);
      if (names.has(name)) throw new Error(`${file}: GraphScript rule error: duplicate node name ${name}`);
      node = { id, name, kind, file };
    }
    const { id, name, kind } = node;
    ids.add(id);
    names.set(name, node);
    nodes.push(node);
    if (!source.errors.length) sources.push({ id, name, kind, source });
    for (const statement of source.program.body) {
      dynamicGraphImports(statement, id, pendingNamespaces);
      if (statement.type !== 'ImportDeclaration' || statement.source.value !== '@graph') continue;
      for (const specifier of statement.specifiers) {
        if (specifier.type === 'ImportSpecifier') pendingImports.push({ fromId: id, name: specifier.imported.name ?? specifier.imported.value,
          file, line: specifier.loc.start.line, column: specifier.loc.start.column + 1 });
        if (specifier.type === 'ImportNamespaceSpecifier') pendingNamespaces.push({ fromId: id, kind: 'static', localName: specifier.local.name });
      }
    }
  }
  if (ruleErrors.length) throw new Error(ruleErrors.join('\n'));
  return { nodes, pendingImports, pendingNamespaces, sources };
}

function readGraph(project, { onWarning = () => {}, onParseError, additionalNodes } = {}) {
  const { nodes, pendingImports, pendingNamespaces, sources } = readNodeIndex(project, { onParseError, analysisNodes: additionalNodes });
  for (const node of additionalNodes ?? []) {
    if (!nodes.some(existing => existing.file === node.file)) nodes.push(node);
  }
  const names = new Map(nodes.map(node => [node.name, node]));
  const imports = pendingImports.flatMap(reference => {
    const target = names.get(reference.name);
    if (!target) {
      if (additionalNodes) return [];
      const error = new Error(`GraphScript import error: unknown node ${reference.name}`);
      Object.assign(error, { file: reference.file, line: reference.line, column: reference.column });
      throw error;
    }
    return [{ fromId: reference.fromId, name: reference.name, toId: target.id }];
  });
  const namespaces = pendingNamespaces.map(reference => ({
    ...reference,
    targets: nodes.map(node => ({ name: node.name, toId: node.id })),
  }));
  const edges = [];
  for (const { id, name, kind, source } of sources) {
    const visitedNamespaceBindings = new Set();
    const visitedStateBindings = new Set();
    function warn(node, message) {
      onWarning({ file: names.get(name).file, line: node.loc.start.line, column: node.loc.start.column + 1, message });
    }
    function addEdge(name) {
      const target = names.get(name);
      if (target && target.kind !== 'state' && !edges.some(edge => edge.fromId === id && edge.toId === target.id)) {
        edges.push({ fromId: id, toId: target.id });
      }
    }
    function runtimeReferences(binding) {
      return (binding?.referencePaths ?? []).filter(reference => reference.isIdentifier()
        && !reference.findParent(parent => parent.isTSType() || parent.isTSTypeAliasDeclaration()
          || parent.isTSInterfaceDeclaration() || parent.node.declare));
    }
    function staticProperty(property, computed) {
      if (!computed && property.type === 'Identifier') return property.name;
      if (property.type === 'StringLiteral') return property.value;
      if (property.type === 'NumericLiteral') return String(property.value);
      if (computed && property.type === 'TemplateLiteral' && property.expressions.length === 0) {
        return property.quasis[0].value.cooked;
      }
    }
    function unwrapReference(reference) {
      while (['TSAsExpression', 'TSSatisfiesExpression', 'TSTypeAssertion', 'TSNonNullExpression'].includes(reference.parentPath.node.type)
        && reference.parentPath.node.expression === reference.node) reference = reference.parentPath;
      return reference;
    }
    function addStateEdge(target, property, access) {
      if (property != null && !edges.some(edge => edge.fromId === id && edge.toId === target.id && edge.property === property && edge.access === access)) {
        edges.push({ fromId: id, toId: target.id, property, access });
      }
    }
    function addStateBinding(target, binding) {
      if (!binding || visitedStateBindings.has(binding)) return;
      visitedStateBindings.add(binding);
      for (const reference of runtimeReferences(binding)) {
        if (!binding.constant) {
          const declaration = binding.path.getStatementParent();
          const statement = reference.getStatementParent();
          if (!declaration || !statement || !declaration.parentPath.isBlockStatement()
            || statement.parentPath !== declaration.parentPath || statement.key <= declaration.key
            || reference.findParent(parent => parent === statement || parent.isFunction() || parent.isClass()) !== statement
            || binding.constantViolations.some(violation => {
              const reassignment = violation.getStatementParent();
              return !reassignment || reassignment.parentPath !== declaration.parentPath || reassignment.key <= statement.key;
            })) {
            warn(reference.node, 'Cannot resolve the state alias statically');
            continue;
          }
        }
        addStateAccess(target, reference);
      }
    }
    function addStatePattern(target, pattern) {
      for (const property of pattern.properties) {
        const name = property.type === 'ObjectProperty' ? staticProperty(property.key, property.computed) : undefined;
        if (name == null) warn(property, 'Cannot resolve the state property statically');
        else addStateEdge(target, name, 'read');
      }
    }
    function stateAccesses(member) {
      let target = member;
      let parent = target.parentPath;
      let nested = false;
      while ((['TSAsExpression', 'TSSatisfiesExpression', 'TSTypeAssertion', 'TSNonNullExpression'].includes(parent.node.type) && parent.node.expression === target.node)
        || ((parent.isMemberExpression() || parent.isOptionalMemberExpression()) && parent.node.object === target.node)
        || (parent.isObjectProperty() && parent.parentPath.isObjectPattern() && parent.node.value === target.node)
        || parent.isObjectPattern() || parent.isArrayPattern()
        || (parent.isRestElement() && parent.node.argument === target.node)
        || (parent.isAssignmentPattern() && parent.node.left === target.node)) {
        if (parent.isMemberExpression() || parent.isOptionalMemberExpression()) nested = true;
        target = parent;
        parent = target.parentPath;
      }
      if (parent.isAssignmentExpression() && parent.node.left === target.node) {
        return parent.node.operator === '=' && !nested ? ['write'] : ['read', 'write'];
      }
      if (parent.isUpdateExpression() && parent.node.argument === target.node) return ['read', 'write'];
      if (((parent.isForOfStatement() || parent.isForInStatement()) && parent.node.left === target.node)
        || (parent.isUnaryExpression({ operator: 'delete' }) && parent.node.argument === target.node)) return nested ? ['read', 'write'] : ['write'];
      return ['read'];
    }
    function addStateAccess(target, reference) {
      reference = unwrapReference(reference);
      const member = reference.parentPath;
      if ((member.isVariableDeclarator() && member.node.init === reference.node)
        || (member.isAssignmentExpression() && member.node.right === reference.node)) {
        const pattern = member.isVariableDeclarator() ? member.node.id : member.node.left;
        if (pattern.type === 'ObjectPattern') {
          addStatePattern(target, pattern);
        } else if (member.isVariableDeclarator() && pattern.type === 'Identifier') {
          addStateBinding(target, member.scope.getBinding(pattern.name));
        }
      }
      if (!(member.isMemberExpression() || member.isOptionalMemberExpression()) || member.node.object !== reference.node) {
        if (!((member.isVariableDeclarator() && member.node.init === reference.node && ['ObjectPattern', 'Identifier'].includes(member.node.id.type))
          || (member.isAssignmentExpression() && member.node.right === reference.node && member.node.left.type === 'ObjectPattern'))) {
          warn(reference.node, 'Cannot resolve the state value statically');
        }
        return;
      }
      const property = staticProperty(member.node.property, member.node.computed);
      if (property == null) {
        warn(member.node, 'Cannot resolve the state property statically');
        return;
      }
      for (const access of stateAccesses(member)) addStateEdge(target, property, access);
    }
    function addProperty(property, computed) {
      const name = staticProperty(property, computed);
      if (name != null) addEdge(name);
    }
    function addMember(reference) {
      reference = unwrapReference(reference);
      const parent = reference.parentPath;
      if ((parent.isMemberExpression() || parent.isOptionalMemberExpression()) && parent.node.object === reference.node) {
        const property = staticProperty(parent.node.property, parent.node.computed);
        if (property == null) {
          warn(parent.node, 'Cannot resolve the graph namespace member statically');
          return;
        }
        const target = names.get(property);
        if (target?.kind === 'state') addStateAccess(target, parent);
        else addProperty(parent.node.property, parent.node.computed);
      }
      const pattern = parent.isVariableDeclarator() && parent.node.init === reference.node ? parent.node.id
        : parent.isAssignmentExpression() && parent.node.right === reference.node ? parent.node.left : null;
      if (pattern?.type === 'ObjectPattern') {
        for (const property of pattern.properties) {
          const propertyName = property.type === 'ObjectProperty' ? staticProperty(property.key, property.computed) : undefined;
          if (propertyName == null) {
            warn(property, 'Cannot resolve the graph namespace member statically');
            continue;
          }
          const target = names.get(propertyName);
          const value = property.value.type === 'AssignmentPattern' ? property.value.left : property.value;
          if (target?.kind === 'state' && value.type === 'ObjectPattern') {
            addStatePattern(target, value);
          } else if (target?.kind === 'state' && value.type === 'Identifier' && parent.isVariableDeclarator()) {
            addStateBinding(target, parent.scope.getBinding(value.name));
          } else {
            addProperty(property.key, property.computed);
          }
        }
      } else if (parent.isVariableDeclarator() && parent.node.init === reference.node && parent.node.id.type === 'Identifier') {
        const binding = parent.scope.getBinding(parent.node.id.name);
        if (binding?.constant && !visitedNamespaceBindings.has(binding)) {
          visitedNamespaceBindings.add(binding);
          for (const nextReference of runtimeReferences(binding)) addMember(nextReference);
        } else if (!binding?.constant) {
          warn(reference.node, 'Cannot resolve the graph namespace value statically');
        }
      } else if (!(parent.isMemberExpression() || parent.isOptionalMemberExpression())) {
        warn(reference.node, 'Cannot resolve the graph namespace value statically');
      }
    }
    function dynamicImport(path) {
      if (!path.parentPath.isAwaitExpression()) {
        warn(path.node, 'Cannot resolve the dynamic graph import statically');
        return;
      }
      const awaited = path.parentPath;
      addMember(awaited);
    }
    traverse(source, {
      Program(path) {
        const references = runtimeReferences(path.scope.getBinding(name));
        if (kind === 'state') {
          for (const reference of references) addStateAccess(names.get(name), reference);
        } else if (references.length) {
          addEdge(name);
        }
      },
      ImportDeclaration(path) {
        if (path.node.source.value !== '@graph') return;
        for (const specifier of path.node.specifiers) {
          if (path.node.importKind === 'type' || specifier.importKind === 'type') continue;
          const references = runtimeReferences(path.scope.getBinding(specifier.local.name));
          if (specifier.type === 'ImportSpecifier' && references.length) {
            const importedName = specifier.imported.name ?? specifier.imported.value;
            const target = names.get(importedName);
            if (target?.kind === 'state') {
              for (const reference of references) addStateAccess(target, reference);
            } else {
              addEdge(importedName);
            }
          } else if (specifier.type === 'ImportNamespaceSpecifier') {
            for (const reference of references) addMember(reference);
          }
        }
      },
      CallExpression(path) {
        if (path.node.callee.type === 'Import' && path.node.arguments[0]?.value === '@graph') dynamicImport(path);
      },
      ImportExpression(path) {
        if (path.node.source.value === '@graph') dynamicImport(path);
      },
    });
  }
  return { nodes, imports, namespaces, edges };
}

function watchGraph(project, onUpdate) {
  let timer;
  let closed = false;
  const directory = join(project, 'nodes');
  function schedule() {
    if (closed) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      let result;
      try {
        result = { graph: readGraph(project) };
      } catch (error) {
        result = { error };
      }
      onUpdate(result);
    }, 50);
  }
  function watchDirectory() {
    const watcher = watch(directory, schedule);
    watcher.on('error', error => { if (!closed) onUpdate({ error }); });
    return watcher;
  }
  let watcher;
  const parent = watch(project, (event, filename) => {
    if (closed) return;
    if (filename && filename.toString() !== 'nodes') return;
    watcher?.close();
    watcher = undefined;
    try {
      watcher = watchDirectory();
    } catch (error) {
      if (error.code !== 'ENOENT') onUpdate({ error });
    }
    schedule();
  });
  try {
    watcher = watchDirectory();
  } catch (error) {
    if (error.code !== 'ENOENT') {
      parent.close();
      throw error;
    }
    queueMicrotask(() => { if (!closed) onUpdate({ error }); });
  }
  parent.on('error', error => { if (!closed) onUpdate({ error }); });
  return {
    close() {
      closed = true;
      clearTimeout(timer);
      watcher?.close();
      parent.close();
    },
  };
}

module.exports = { checkNode, readGraph, readNodeCandidates, readNodeIndex, watchGraph };