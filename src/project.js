const { randomUUID } = require('node:crypto');
const { lstatSync, mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { readNodeIndex } = require('./graph');

function initializeProject(project, { kind }) {
  if (!['library', 'program'].includes(kind)) throw new Error(`Unsupported project kind: ${kind}`);
  const directory = join(project, 'nodes');
  mkdirSync(directory);
  if (kind === 'program') writeFileSync(join(directory, 'main.ts'), '"graphscript:program";\n', { flag: 'wx' });
}

function validateName(kind, name) {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) || name === 'await') throw new Error(`Invalid ${kind} name`);
  try {
    new Function(`"use strict"; function ${name}() {}`);
  } catch {
    throw new Error(`Invalid ${kind} name`);
  }
}

function createNode(project, { kind, name }) {
  if (!['function', 'class', 'state'].includes(kind)) throw new Error(`Unsupported node kind: ${kind}`);
  const directory = join(project, 'nodes');
  if (!lstatSync(directory).isDirectory()) throw new Error('nodes must be a directory, not a symbolic link');
  validateName(kind, name);
  readNodeIndex(project, { reservedName: name });
  const declarations = {
    function: `function ${name}() {\n}`,
    class: `class ${name} {\n}`,
    state: `const ${name} = {\n};`,
  };
  const source = `"graphscript:${kind}";\n// graphscript:id ${randomUUID()}\n\nexport ${declarations[kind]}\n`;
  const file = join(directory, `${name}.ts`);
  writeFileSync(file, source, { flag: 'wx' });
  return file;
}

module.exports = { initializeProject, createNode, validateName };