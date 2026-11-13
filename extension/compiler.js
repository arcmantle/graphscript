const { readFileSync, statSync } = require('node:fs');
const { isAbsolute, join, relative, resolve } = require('node:path');
const semver = require('semver');
const { graphscriptCompiler } = require('./package.json');

function resolveCompiler(project) {
  const directory = join(project, 'node_modules', '@arcmantle', 'graphscript');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('GraphScript compiler is missing from this project. Install it as a project-local development dependency.');
    }
    throw new Error(`Cannot read the project-local GraphScript compiler: ${error.message}`);
  }
  if (manifest.name !== '@arcmantle/graphscript' || !semver.satisfies(manifest.version, graphscriptCompiler)) {
    throw new Error(`Unsupported GraphScript compiler version ${String(manifest.version)}. This extension requires ${graphscriptCompiler}.`);
  }
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.graphscript;
  if (typeof bin !== 'string' || isAbsolute(bin)) {
    throw new Error('The project-local GraphScript compiler has no valid CLI entry.');
  }
  const entry = resolve(directory, bin);
  const entryRelative = relative(directory, entry);
  if (!entryRelative || entryRelative.startsWith('..') || isAbsolute(entryRelative)) {
    throw new Error('The project-local GraphScript compiler has no valid CLI entry.');
  }
  try {
    if (!statSync(entry).isFile()) throw new Error('not a file');
  } catch {
    throw new Error('The project-local GraphScript compiler CLI entry is missing.');
  }
  return { directory, entry, version: manifest.version };
}

module.exports = { resolveCompiler };