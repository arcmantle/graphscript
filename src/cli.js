#!/usr/bin/env node
const { lstatSync } = require('node:fs');
const { checkProject } = require('./check');
const { buildLibrary, buildProject } = require('./build');
const { initializeProject, createNode } = require('./project');
const { deleteNode, renameNode } = require('./protected-edit');

function requireNodesDirectory() {
  if (!lstatSync('nodes').isDirectory()) throw new Error('nodes must be a directory, not a symbolic link');
}

try {
  if (process.argv[2] === 'init' && ['--library', '--program'].includes(process.argv[3]) && process.argv.length === 4) {
    initializeProject(process.cwd(), { kind: process.argv[3].slice(2) });
  } else if (process.argv[2] === 'create' && ['function', 'class', 'state'].includes(process.argv[3]) && process.argv.length === 5) {
    createNode(process.cwd(), { kind: process.argv[3], name: process.argv[4] });
  } else if (process.argv[2] === 'rename' && process.argv.length === 5) {
    const result = renameNode(process.cwd(), { name: process.argv[3], newName: process.argv[4] });
    if (result.cleanupWarning) console.error(result.cleanupWarning);
  } else if (process.argv[2] === 'delete' && process.argv.length === 4) {
    const result = deleteNode(process.cwd(), { name: process.argv[3] });
    if (result.cleanupWarning) console.error(result.cleanupWarning);
  } else if ((process.argv[2] === 'check' && process.argv.length === 3)
    || (process.argv[2] === 'build' && (process.argv.length === 3
      || (process.argv.length === 5 && process.argv[3] === '--language')))
    || (process.argv[2] === 'build' && process.argv[3] === '--library'
      && (process.argv.length === 4 || (process.argv.length === 6 && process.argv[4] === '--language')))) {
    requireNodesDirectory();
    const result = process.argv[2] === 'check' ? checkProject(process.cwd()) : process.argv[3] === '--library'
      ? buildLibrary(process.cwd(), { language: process.argv[5] }) : buildProject(process.cwd(), { language: process.argv[4] });
    for (const diagnostic of result.diagnostics) {
      const location = diagnostic.file ? `${diagnostic.file}(${diagnostic.line},${diagnostic.column}): ` : '';
      const label = diagnostic.source === 'typescript' ? `${diagnostic.severity} TS${diagnostic.code}`
        : diagnostic.source === 'analyzer' ? `analyzer ${diagnostic.severity}` : '';
      console.error(`${location}${label}${label ? ': ' : ''}${diagnostic.message}`);
    }
    process.exitCode = result.ok ? 0 : 1;
  } else {
    throw new Error('Usage: graphscript init <--library|--program> | create <function|class|state> <name> | rename <name> <new-name> | delete <name> | check | build [--library] [--language <javascript|typescript>]');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}