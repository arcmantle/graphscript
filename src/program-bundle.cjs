const { existsSync, readFileSync } = require('node:fs');
const { dirname, isAbsolute, resolve } = require('node:path');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const esbuild = require('esbuild');
const { rollup } = require('rollup');
const commonjs = require('@rollup/plugin-commonjs');
const { nodeResolve } = require('@rollup/plugin-node-resolve');

const { entry, graphPath, nodePaths } = JSON.parse(readFileSync(0, 'utf8'));

rollup({ input: entry,
  external: source => source !== '@graph' && !source.startsWith('.') && !isAbsolute(source) && !source.startsWith('\0'),
  onwarn(warning, warn) { if (warning.code !== 'CIRCULAR_DEPENDENCY') warn(warning); },
  plugins: [{ name: 'graphscript',
    resolveId(source, importer) {
      if (source === '@graph') return graphPath;
      if (!importer || !source.startsWith('.') && !isAbsolute(source)) return;
      const target = isAbsolute(source) ? source : resolve(dirname(importer), source);
      const typescript = target.replace(/\.([cm]?)js$/, '.$1ts');
      if (typescript !== target && existsSync(typescript)) return typescript;
    },
    async transform(text, id) {
      if (!/\.[cm]?[jt]s$/.test(id)) return;
      const typescript = /\.[cm]?ts$/.test(id);
      if (text.includes('@graph')) {
      const ast = parse(text, { sourceType: 'unambiguous', plugins: typescript ? ['typescript', 'decorators', 'decoratorAutoAccessors'] : [] });
      const edits = [];
      traverse(ast, { ImportDeclaration(path) {
        if (path.node.source.value !== '@graph') return;
        if (path.node.specifiers.length && path.node.specifiers.every(specifier => specifier.type === 'ImportSpecifier')) {
          const imports = path.node.specifiers.map(specifier => {
            const name = specifier.imported.name ?? specifier.imported.value;
            if (!nodePaths[name]) return;
            const type = path.node.importKind === 'type' || specifier.importKind === 'type' ? 'type ' : '';
            return `import ${type}{ ${name} as ${specifier.local.name} } from ${JSON.stringify(nodePaths[name])};`;
          });
          if (imports.every(Boolean)) edits.push({ start: path.node.start, end: path.node.end, text: imports.join('\n') });
          return;
        }
        if (path.node.specifiers.length !== 1
          || path.node.specifiers[0].type !== 'ImportNamespaceSpecifier') return;
        const name = path.node.specifiers[0].local.name;
        const binding = path.scope.getBinding(name);
        const names = new Set();
        for (const reference of binding.referencePaths) {
          const member = reference.parentPath;
          if (!member.isMemberExpression() || member.node.object !== reference.node) return;
          const property = member.node.property;
          const memberName = !member.node.computed && property.type === 'Identifier' ? property.name
            : member.node.computed && property.type === 'StringLiteral' ? property.value : undefined;
          if (!memberName || !nodePaths[memberName]) return;
          names.add(memberName);
        }
        const imports = [];
        const properties = [];
        for (const memberName of names) {
          const local = path.scope.generateUidIdentifier(`graphscript_${memberName}`).name;
          imports.push(`import { ${memberName} as ${local} } from ${JSON.stringify(nodePaths[memberName])};`);
          properties.push(`${JSON.stringify(memberName)}: { enumerable: true, get: () => ${local} }`);
        }
        edits.push({ start: path.node.start, end: path.node.end, text: `${imports.join('\n')}\nconst ${name} = Object.freeze(Object.defineProperties(Object.create(null), { ${properties.join(', ')}${properties.length ? ', ' : ''}[Symbol.toStringTag]: { value: "Module" } }));` });
      } });
      for (const edit of edits.sort((left, right) => right.start - left.start)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
      }
      if (typescript) return (await esbuild.transform(text, { loader: 'ts', target: 'es2022', format: 'esm' })).code;
      return text;
    },
  }, nodeResolve({ extensions: ['.mjs', '.js', '.json', '.node', '.ts', '.mts', '.cts'] }), commonjs()] }).then(async bundle => {
  const generated = await bundle.generate({ format: 'esm' });
  if (generated.output.length !== 1 || generated.output[0].type !== 'chunk') {
    throw new Error('Program builds cannot emit multiple chunks for local dynamic imports');
  }
  const output = generated.output[0].code;
  let helper = '__graphscriptCreateRequire';
  while (output.includes(helper)) helper += '_';
  const text = `import { createRequire as ${helper} } from "node:module";\nvar require = new Proxy(${helper}(import.meta.url), { apply(target, receiver, args) { if (typeof args[0] === "string" && /^file:/i.test(args[0])) throw new Error("GraphScript rule error: file: URL imports are not allowed"); if (typeof args[0] === "string" && (args[0].startsWith("./") || args[0].startsWith("../"))) throw new Error("GraphScript rule error: relative runtime imports are not allowed"); return Reflect.apply(target, receiver, args); } });\n${output}`;
  process.stdout.write(JSON.stringify({ text, inputs: bundle.watchFiles }));
}).catch(error => {
  process.stderr.write(error.message + '\n');
  process.exitCode = 1;
});