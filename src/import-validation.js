function runtimeImportError(specifier) {
  if (typeof specifier !== 'string') return;
  if (/^file:/i.test(specifier)) return 'GraphScript rule error: file: URL imports are not allowed';
  if (specifier.startsWith('./') || specifier.startsWith('../')) return 'GraphScript rule error: relative runtime imports are not allowed';
}

function isNodeRequire(path, callee, seen = new Set()) {
  if (callee?.type === 'Identifier') {
    const binding = path.scope.getBinding(callee.name);
    if (callee.name === 'require' && (!binding || binding.path.node.declare || binding.path.parentPath?.node.declare)) return true;
    if (binding?.constant && binding.path.isVariableDeclarator() && !seen.has(binding)) {
      seen.add(binding);
      return isNodeRequire(binding.path, binding.path.node.init, seen);
    }
    return false;
  }
  if (!['MemberExpression', 'OptionalMemberExpression'].includes(callee?.type) || callee.object.type !== 'Identifier' || callee.object.name !== 'module'
    || !((!callee.computed && callee.property.name === 'require') || (callee.computed && callee.property.value === 'require'))) return false;
  const binding = path.scope.getBinding('module');
  return !binding || Boolean(binding.path.node.declare || binding.path.parentPath?.node.declare);
}

function urlImportPath(path, argument, seen = new Set()) {
  while (argument && ['TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression', 'TSSatisfiesExpression', 'ParenthesizedExpression'].includes(argument.type)) argument = argument.expression;
  if (argument?.type === 'Identifier') {
    const binding = path.scope.getBinding(argument.name);
    if (binding?.constant && binding.path.isVariableDeclarator() && !seen.has(binding)) {
      seen.add(binding);
      return urlImportPath(binding.path, binding.path.node.init, seen);
    }
    return;
  }
  if (argument?.type !== 'NewExpression') return;
  const callee = argument.callee;
  const globalUrl = callee.type === 'Identifier' && callee.name === 'URL' && !path.scope.getBinding('URL');
  const globalThisUrl = callee.type === 'MemberExpression' && callee.object.type === 'Identifier'
    && callee.object.name === 'globalThis' && !path.scope.getBinding('globalThis')
    && ((!callee.computed && callee.property.name === 'URL') || (callee.computed && callee.property.value === 'URL'));
  if (globalUrl || globalThisUrl) return argument.arguments[0];
}

module.exports = { isNodeRequire, runtimeImportError, urlImportPath };