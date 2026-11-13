const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { test } = require('node:test');
const { resolveCompiler } = require('../compiler');

test('resolves the project-local scoped compiler', () => {
  const project = mkdtempSync(join(tmpdir(), 'graphscript-extension-'));
  try {
    const directory = join(project, 'node_modules', '@arcmantle', 'graphscript');
    mkdirSync(join(directory, 'src'), { recursive: true });
    writeFileSync(join(directory, 'package.json'), JSON.stringify({
      name: '@arcmantle/graphscript', version: '0.1.0', bin: { graphscript: 'src/cli.js' },
    }));
    writeFileSync(join(directory, 'src', 'cli.js'), '');
    assert.equal(resolveCompiler(project).directory, directory);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('rejects invalid compiler names, entries, and prerelease versions', () => {
  const project = mkdtempSync(join(tmpdir(), 'graphscript-extension-'));
  try {
    const directory = join(project, 'node_modules', '@arcmantle', 'graphscript');
    mkdirSync(directory, { recursive: true });
    const manifest = { name: '@arcmantle/graphscript', version: '0.1.0', bin: { graphscript: 'src/cli.js' } };
    const save = () => writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest));
    save();
    assert.throws(() => resolveCompiler(project), /CLI entry is missing/);
    mkdirSync(join(directory, 'src'));
    writeFileSync(join(directory, 'src', 'cli.js'), '');
    manifest.bin.graphscript = '../outside.js';
    save();
    assert.throws(() => resolveCompiler(project), /valid CLI entry/);
    manifest.bin.graphscript = 'src/cli.js';
    manifest.version = '0.1.1-beta.1';
    save();
    assert.throws(() => resolveCompiler(project), /unsupported/i);
    manifest.version = '0.1.0';
    manifest.name = 'graphscript';
    save();
    assert.throws(() => resolveCompiler(project), /unsupported/i);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});