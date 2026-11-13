import assert from 'node:assert/strict';
import { cp, link, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const cli = resolve('src/cli.js');
const require = createRequire(import.meta.url);
const run = (project, ...args) => spawnSync(process.execPath, [cli, ...args], {
  cwd: project,
  encoding: 'utf8',
});

test('protected rename refuses absolute and file URL node references without changes', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript path-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const node = join(project, 'nodes', 'target.ts');
    const original = await readFile(node, 'utf8');
    const start = join(project, 'nodes', 'main.ts');
    const startSource = '"graphscript:program";\nimport { target } from "@graph";\ntarget();\n';
    await writeFile(start, startSource);
    const helper = join(project, 'helper.ts');
    for (const specifier of [node, node.slice(0, -3), `${node.slice(0, -3)}.js`,
      pathToFileURL(node).href.replace(/^file:/, 'FILE:'), pathToFileURL(node).href,
      pathToFileURL(node.slice(0, -3)).href, pathToFileURL(`${node.slice(0, -3)}.js`).href]) {
      for (const source of [
        `import { target } from ${JSON.stringify(specifier)};\n`,
        `export * from ${JSON.stringify(specifier)};\n`,
        `type Target = typeof import(${JSON.stringify(specifier)}).target;\n`,
        `const target = import(${JSON.stringify(specifier)});\n`,
        `const target = require(${JSON.stringify(specifier)});\n`,
        `const target = module.require(${JSON.stringify(specifier)});\n`,
        `import target = require(${JSON.stringify(specifier)});\n`,
      ]) {
        await writeFile(helper, source);
        const result = run(project, 'rename', 'target', 'renamed');
        assert.notEqual(result.status, 0, source);
        assert.match(result.stderr, /cannot resolve/i, source);
        assert.equal(await readFile(node, 'utf8'), original);
        assert.equal(await readFile(start, 'utf8'), startSource);
        assert.equal(await readFile(helper, 'utf8'), source);
        await assert.rejects(readFile(join(project, 'nodes', 'renamed.ts')), { code: 'ENOENT' });
      }
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected deletion removes an unreferenced node through the CLI', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    for (const [kind, name] of [['function', 'target'], ['class', 'Account'], ['state', 'settings']]) {
      assert.equal(run(project, 'create', kind, name).status, 0);
      const source = await readFile(join(project, 'nodes', `${name}.ts`), 'utf8');
      const identity = source.match(/graphscript:id ([\da-f-]+)/)[1];
      const forced = run(project, 'delete', identity, '--force');
      assert.notEqual(forced.status, 0);
      assert.equal(await readFile(join(project, 'nodes', `${name}.ts`), 'utf8'), source);
      const result = run(project, 'delete', identity);
      assert.equal(result.status, 0, result.stderr);
      await assert.rejects(readFile(join(project, 'nodes', `${name}.ts`)), { code: 'ENOENT' });
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected deletion refuses a target changed during commit', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const fs = require('node:fs');
  const originalUnlink = fs.unlinkSync;
  const originalRename = fs.renameSync;
  const modulePath = require.resolve('../src/protected-edit.js');
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const target = join(project, 'nodes', 'target.ts');
    const changed = `${await readFile(target, 'utf8')}\n// concurrent edit\n`;
    fs.unlinkSync = file => {
      if (file === target) fs.writeFileSync(target, changed);
      return originalUnlink(file);
    };
    fs.renameSync = (source, destination) => {
      if (source === target) fs.writeFileSync(target, changed);
      return originalRename(source, destination);
    };
    delete require.cache[modulePath];
    const { deleteNode } = require(modulePath);
    assert.throws(() => deleteNode(project, { name: 'target' }), /conflict/i);
    assert.equal(await readFile(target, 'utf8'), changed);
  } finally {
    fs.unlinkSync = originalUnlink;
    fs.renameSync = originalRename;
    delete require.cache[modulePath];
    await rm(project, { recursive: true, force: true });
  }
});

test('protected deletion permits a namespace reference to another node', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    assert.equal(run(project, 'create', 'function', 'other').status, 0);
    const start = join(project, 'nodes', 'main.ts');
    for (const importSource of ['import * as graph from "@graph";', 'import graph = require("@graph");']) {
      const source = `"graphscript:program";\n${importSource}\ngraph.other();\n`;
      await writeFile(start, source);
      const result = run(project, 'delete', 'target');
      assert.equal(result.status, 0, result.stderr);
      assert.equal(await readFile(start, 'utf8'), source);
      await assert.rejects(readFile(join(project, 'nodes', 'target.ts')), { code: 'ENOENT' });
      assert.equal(run(project, 'create', 'function', 'target').status, 0);
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected deletion lists source references and refuses force without changing files', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'state', 'target').status, 0);
    assert.equal(run(project, 'create', 'function', 'caller').status, 0);
    const nodes = join(project, 'nodes');
    const caller = join(nodes, 'caller.ts');
    const start = join(nodes, 'main.ts');
    await writeFile(caller, (await readFile(caller, 'utf8')).replace('export function', 'import type { target } from "@graph";\nexport function'));
    await writeFile(start, '"graphscript:program";\nimport { target as unused } from "@graph";\nconst graph = await import("@graph");\ngraph.target;\n');
    const before = new Map(await Promise.all((await readdir(nodes)).map(async file => [file, await readFile(join(nodes, file), 'utf8')])));
    for (const args of [['delete', 'target'], ['delete', 'target', '--force']]) {
      const result = run(project, ...args);
      assert.notEqual(result.status, 0);
      if (args.length === 2) {
        assert.match(result.stderr, /caller\.ts:4:/);
        assert.match(result.stderr, /main\.ts:2:/);
        assert.match(result.stderr, /main\.ts:4:/);
      }
      assert.deepEqual(await readdir(nodes), [...before.keys()]);
      for (const [file, contents] of before) assert.equal(await readFile(join(nodes, file), 'utf8'), contents);
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected deletion refuses import types and re-exports', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'class', 'target').status, 0);
    const start = join(project, 'nodes', 'main.ts');
    const source = '"graphscript:program";\ntype Alias = import("@graph").target;\nexport { target as saved } from "@graph";\n';
    await writeFile(start, source);
    const result = run(project, 'delete', 'target');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /main\.ts:2:/);
    assert.match(result.stderr, /main\.ts:3:/);
    assert.equal(await readFile(start, 'utf8'), source);
    assert.ok(await readFile(join(project, 'nodes', 'target.ts'), 'utf8'));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected deletion refuses graph imports in local project helpers', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    await mkdir(join(project, 'helpers'));
    const helper = join(project, 'helpers', 'client.js');
    const source = 'import { target } from "@graph";\nexport const run = () => target();\n';
    await writeFile(helper, source);
    const result = run(project, 'delete', 'target');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /client\.js:1:/);
    assert.equal(await readFile(helper, 'utf8'), source);
    assert.ok(await readFile(join(project, 'nodes', 'target.ts'), 'utf8'));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected deletion refuses relative references to the target source', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const helper = join(project, 'helper.ts');
    const target = join(project, 'nodes', 'target.ts');
    const original = await readFile(target, 'utf8');
    for (const source of [
      'import { target } from "./nodes/target.ts";\n',
      'import "./nodes/target";\n',
      'export { target } from "./nodes/target.js";\n',
      'export * from "./nodes/target.ts";\n',
      'type Target = typeof import("./nodes/target.ts").target;\n',
      'const target = import("./nodes/target.ts");\n',
      'const target = import("./nodes/" + "target.ts");\n',
      'const target = require("./nodes/target.ts");\n',
      'const target = require(`./nodes/target.ts`);\n',
      `const target = require(${JSON.stringify(target)});\n`,
      `const target = import(${JSON.stringify(pathToFileURL(target).href)});\n`,
      `const target = import(${JSON.stringify(pathToFileURL(target).href.replace(/^file:/, 'FILE:'))});\n`,
      'const target = module.require("./nodes/target.ts");\n',
      'const load = require;\nload("./nodes/target.ts");\n',
      'const graph = module["requ" + "ire"]("@graph");\ngraph.target();\n',
      'const load = module.require;\nload("./nodes/target.ts");\n',
      'const load = module?.require;\nload("./nodes/target.ts");\n',
      'const { require: load } = module;\nload("./nodes/target.ts");\n',
      'const host = global;\nhost.require("./nodes/target.ts");\n',
      'globalThis.require("./nodes/target.ts");\n',
      'module[method]("./nodes/target.ts");\n',
      'import { createRequire } from "node:module";\nconst load = createRequire(import.meta.url);\nload("./nodes/target.ts");\n',
      'const { createRequire } = require("node:module");\nconst load = createRequire(__filename);\nload("./nodes/target.ts");\n',
      'const { createRequire } = await import("node:module");\nconst load = createRequire(import.meta.url);\nload("./nodes/target.ts");\n',
      'const load = process.getBuiltinModule("module").createRequire(__filename);\nload("./nodes/target.ts");\n',
      'module.parent.require("./nodes/target.ts");\n',
      'eval("require(\'@graph\').target()");\n',
      'globalThis["eval"]("require(\'@graph\').target()");\n',
      'new Function("return require(\'@graph\').target")();\n',
      'globalThis.Function("return require(\'@graph\').target")();\n',
      'import graph = require("@graph");\ngraph.target();\n',
      'import graph = require("@graph");\ngraph[key]();\n',
      'export import graph = require("@graph");\n',
      'import target = require("./nodes/target.ts");\n',
    ]) {
      await writeFile(helper, source);
      const result = run(project, 'delete', 'target');
      assert.notEqual(result.status, 0, source);
      assert.match(result.stderr, /helper\.ts:\d+:/);
      assert.equal(await readFile(helper, 'utf8'), source);
      assert.equal(await readFile(target, 'utf8'), original);
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected deletion refuses manifest-only node routes without changing the project', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const snapshot = async () => {
      const entries = await readdir(project, { recursive: true, withFileTypes: true });
      const files = await Promise.all(entries.filter(entry => entry.isFile()).map(async entry => {
        const file = join(entry.parentPath, entry.name);
        return [file, await readFile(file, 'utf8')];
      }));
      return files.sort((left, right) => left[0].localeCompare(right[0]));
    };
    for (const routes of [
      { exports: { './target': './nodes/target.ts' } },
      { imports: { '#target': './nodes/target.ts' } },
      { imports: { '#nodes/*': './nodes/*.ts' } },
      { exports: { './nodes/*': { import: [null, './nodes/*.ts'] } } },
      { imports: { '#target': { default: './nodes/target.ts' } } },
      { exports: { './*': './nodes/*.ts', './target*': null } },
    ]) {
      await writeFile(join(project, 'package.json'), JSON.stringify(routes));
      const before = await snapshot();
      const result = run(project, 'delete', 'target');
      assert.notEqual(result.status, 0, JSON.stringify(routes));
      assert.match(result.stderr, /package\.json/i);
      assert.deepEqual(await snapshot(), before);
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected deletion permits unrelated and unreachable manifest routes', async () => {
  for (const routes of [
    { exports: { './other/*': './elsewhere/*.ts' }, imports: { '#other/*': './elsewhere/*.ts' } },
    { exports: { default: './other.ts', import: './nodes/target.ts' } },
    { exports: ['./other.ts', './nodes/target.ts'] },
    { exports: './nodes/../nodes/target.ts' },
  ]) {
    const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
    try {
      assert.equal(run(project, 'init', '--library').status, 0);
      assert.equal(run(project, 'create', 'function', 'target').status, 0);
      const manifest = JSON.stringify(routes);
      await writeFile(join(project, 'package.json'), manifest);
      const result = run(project, 'delete', 'target');
      assert.equal(result.status, 0, result.stderr);
      assert.equal(await readFile(join(project, 'package.json'), 'utf8'), manifest);
      await assert.rejects(readFile(join(project, 'nodes', 'target.ts')), { code: 'ENOENT' });
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  }
});

test('protected deletion refuses manifest-only routes outside the project root', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const project = join(parent, 'project');
  try {
    await mkdir(project);
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const node = join(project, 'nodes', 'target.ts');
    const original = await readFile(node, 'utf8');
    for (const [file, route] of [
      [join(parent, 'package.json'), './project/nodes/target.ts'],
      [join(project, 'nodes', 'package.json'), './target.ts'],
    ]) {
      const manifest = JSON.stringify({ exports: route });
      await writeFile(file, manifest);
      const result = run(project, 'delete', 'target');
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /package\.json/i);
      assert.equal(await readFile(node, 'utf8'), original);
      assert.equal(await readFile(file, 'utf8'), manifest);
      await rm(file);
    }
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('protected deletion refuses package import aliases without changing the project', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    await writeFile(join(project, 'package.json'), JSON.stringify({ imports: { '#nodes/*': './nodes/*.ts' } }));
    const snapshot = async () => {
      const entries = await readdir(project, { recursive: true, withFileTypes: true });
      const files = await Promise.all(entries.filter(entry => entry.isFile()).map(async entry => {
        const file = join(entry.parentPath, entry.name);
        return [file, await readFile(file, 'utf8')];
      }));
      return files.sort((left, right) => left[0].localeCompare(right[0]));
    };
    for (const helper of [
      'import { target } from "#nodes/target";\n',
      'export { target } from "#nodes/target";\n',
      'export * from "#nodes/target";\n',
      'type Target = typeof import("#nodes/target").target;\n',
      'const target = import("#nodes/target");\n',
      'const target = require("#nodes/target");\n',
      'import target = require("#nodes/target");\n',
    ]) {
      await writeFile(join(project, 'helper.ts'), helper);
      const before = await snapshot();
      const result = run(project, 'delete', 'target');
      assert.notEqual(result.status, 0, helper);
      assert.match(result.stderr, /helper\.ts:1:/, helper);
      assert.deepEqual(await snapshot(), before);
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected deletion refuses package self-references without changing the project', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const manifest = JSON.stringify({ name: '@example/package', exports: { './*': './nodes/*.ts' } });
    const helper = 'import { target } from "@example/package/target";\ntarget();\n';
    const node = join(project, 'nodes', 'target.ts');
    const original = await readFile(node, 'utf8');
    await writeFile(join(project, 'package.json'), manifest);
    await writeFile(join(project, 'helper.ts'), helper);
    const result = run(project, 'delete', 'target');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /helper\.ts:1:/);
    assert.equal(await readFile(node, 'utf8'), original);
    assert.equal(await readFile(join(project, 'package.json'), 'utf8'), manifest);
    assert.equal(await readFile(join(project, 'helper.ts'), 'utf8'), helper);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected deletion permits unrelated package imports', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const manifest = JSON.stringify({ name: '@example/package', exports: { './other/*': './elsewhere/*.ts' } });
    const helper = 'import "@example/package-other/target";\nimport "unrelated/target";\n';
    await writeFile(join(project, 'package.json'), manifest);
    await writeFile(join(project, 'helper.ts'), helper);
    const result = run(project, 'delete', 'target');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(join(project, 'package.json'), 'utf8'), manifest);
    assert.equal(await readFile(join(project, 'helper.ts'), 'utf8'), helper);
    await assert.rejects(readFile(join(project, 'nodes', 'target.ts')), { code: 'ENOENT' });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected deletion preserves a concurrent package manifest change', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const fs = require('node:fs');
  const originalRename = fs.renameSync;
  const modulePath = require.resolve('../src/protected-edit.js');
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const node = join(project, 'nodes', 'target.ts');
    const original = await readFile(node, 'utf8');
    const manifest = join(project, 'package.json');
    const changed = JSON.stringify({ name: 'unrelated', exports: { './target': './nodes/target.ts' } });
    await writeFile(manifest, JSON.stringify({ name: 'example' }));
    await writeFile(join(project, 'helper.ts'), 'import "unrelated/target";\n');
    fs.renameSync = (source, destination) => {
      const result = originalRename(source, destination);
      if (source === node) fs.writeFileSync(manifest, changed);
      return result;
    };
    delete require.cache[modulePath];
    const { deleteNode } = require(modulePath);
    assert.throws(() => deleteNode(project, { name: 'target' }), /conflicting package manifest change/i);
    assert.equal(await readFile(node, 'utf8'), original);
    assert.equal(await readFile(manifest, 'utf8'), changed);
  } finally {
    fs.renameSync = originalRename;
    delete require.cache[modulePath];
    await rm(project, { recursive: true, force: true });
  }
});

test('protected deletion preserves a manifest-only route added during commit', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const fs = require('node:fs');
  const originalRename = fs.renameSync;
  const modulePath = require.resolve('../src/protected-edit.js');
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const node = join(project, 'nodes', 'target.ts');
    const original = await readFile(node, 'utf8');
    const manifest = join(project, 'nodes', 'package.json');
    const added = JSON.stringify({ exports: './target.ts' });
    fs.renameSync = (source, destination) => {
      const result = originalRename(source, destination);
      if (source === node) fs.writeFileSync(manifest, added);
      return result;
    };
    delete require.cache[modulePath];
    const { deleteNode } = require(modulePath);
    assert.throws(() => deleteNode(project, { name: 'target' }), /conflicting package manifest change/i);
    assert.equal(await readFile(node, 'utf8'), original);
    assert.equal(await readFile(manifest, 'utf8'), added);
  } finally {
    fs.renameSync = originalRename;
    delete require.cache[modulePath];
    await rm(project, { recursive: true, force: true });
  }
});

test('protected deletion refuses a manifest in a directory added during commit', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const fs = require('node:fs');
  const originalRename = fs.renameSync;
  const modulePath = require.resolve('../src/protected-edit.js');
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const node = join(project, 'nodes', 'target.ts');
    const original = await readFile(node, 'utf8');
    const folder = join(project, 'new-package');
    const manifest = join(folder, 'package.json');
    const added = JSON.stringify({ exports: './target.ts' });
    fs.renameSync = (source, destination) => {
      const result = originalRename(source, destination);
      if (source === node) {
        fs.mkdirSync(folder);
        fs.writeFileSync(manifest, added);
      }
      return result;
    };
    delete require.cache[modulePath];
    const { deleteNode } = require(modulePath);
    assert.throws(() => deleteNode(project, { name: 'target' }), /conflicting package manifest change/i);
    assert.equal(await readFile(node, 'utf8'), original);
    assert.equal(await readFile(manifest, 'utf8'), added);
  } finally {
    fs.renameSync = originalRename;
    delete require.cache[modulePath];
    await rm(project, { recursive: true, force: true });
  }
});

test('protected deletion refuses a caller-reported unsaved package manifest', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const node = join(project, 'nodes', 'target.ts');
    const original = await readFile(node, 'utf8');
    const manifest = join(project, 'package.json');
    await writeFile(manifest, JSON.stringify({ name: 'example' }));
    await writeFile(join(project, 'helper.ts'), 'import "unrelated/target";\n');
    const { deleteNode } = require('../src/protected-edit.js');
    assert.throws(() => deleteNode(project, { name: 'target', unsavedFiles: [manifest] }), /save unsaved/i);
    const alias = join(project, 'open-manifest.json');
    await symlink(manifest, alias);
    assert.throws(() => deleteNode(project, { name: 'target', unsavedFiles: [alias] }), /save unsaved/i);
    assert.equal(await readFile(node, 'utf8'), original);
    assert.equal(await readFile(manifest, 'utf8'), JSON.stringify({ name: 'example' }));
    await rm(manifest);
    assert.throws(() => deleteNode(project, { name: 'target', unsavedFiles: [alias] }), /save unsaved/i);
    assert.equal(await readFile(node, 'utf8'), original);
    await assert.rejects(readFile(manifest), { code: 'ENOENT' });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected deletion refuses a new unsaved ancestor package manifest', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const project = join(parent, 'project');
  try {
    await mkdir(project);
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const node = join(project, 'nodes', 'target.ts');
    const original = await readFile(node, 'utf8');
    await writeFile(join(project, 'helper.ts'), 'import "example/target";\n');
    const { deleteNode } = require('../src/protected-edit.js');
    assert.throws(() => deleteNode(project, { name: 'target', unsavedFiles: [join(parent, 'package.json')] }), /save unsaved/i);
    assert.throws(() => deleteNode(project, { name: 'target', unsavedFiles: [join(parent, 'Package.json')] }), /save unsaved/i);
    assert.equal(await readFile(node, 'utf8'), original);
    await assert.rejects(readFile(join(parent, 'package.json')), { code: 'ENOENT' });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('protected deletion refuses case-insensitive relative node references', async t => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    await writeFile(join(project, 'case-probe'), 'probe');
    try {
      await readFile(join(project, 'CASE-PROBE'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      t.skip('temporary filesystem is case-sensitive');
      return;
    }
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const target = join(project, 'nodes', 'target.ts');
    const original = await readFile(target, 'utf8');
    const helper = join(project, 'helper.ts');
    const source = 'import { target } from "./nodes/TARGET.js";\n';
    await writeFile(helper, source);
    const result = run(project, 'delete', 'target');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /helper\.ts:1:/);
    assert.equal(await readFile(target, 'utf8'), original);
    assert.equal(await readFile(helper, 'utf8'), source);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected deletion scans user directories with staging-like names', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const folder = join(project, 'nodes', '.graphscript-delete-user');
    await mkdir(folder);
    const helper = join(folder, 'helper.ts');
    const source = 'import { target } from "@graph";\n';
    await writeFile(helper, source);
    const result = run(project, 'delete', 'target');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /helper\.ts:1:/);
    assert.equal(await readFile(helper, 'utf8'), source);
    assert.ok(await readFile(join(project, 'nodes', 'target.ts'), 'utf8'));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected deletion refuses CommonJS graph imports in helpers', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const helper = join(project, 'helper.cjs');
    const source = 'const graph = require("@graph");\ngraph.target();\n';
    await writeFile(helper, source);
    const result = run(project, 'delete', 'target');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /helper\.cjs:1:/);
    assert.equal(await readFile(helper, 'utf8'), source);
    assert.ok(await readFile(join(project, 'nodes', 'target.ts'), 'utf8'));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected deletion refuses unresolved graph namespace access', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const start = join(project, 'nodes', 'main.ts');
    const source = '"graphscript:program";\nimport * as graph from "@graph";\nconst key = "target";\ngraph[key];\n';
    await writeFile(start, source);
    const result = run(project, 'delete', 'target');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /main\.ts:4:/);
    assert.equal(await readFile(start, 'utf8'), source);
    assert.ok(await readFile(join(project, 'nodes', 'target.ts'), 'utf8'));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected deletion refuses unresolved dynamic import sources', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const start = join(project, 'nodes', 'main.ts');
    const source = '"graphscript:program";\nconst moduleName = "@graph";\nconst graph = await import(moduleName);\ngraph.target();\n';
    await writeFile(start, source);
    const result = run(project, 'delete', 'target');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /main\.ts:3:/);
    assert.equal(await readFile(start, 'utf8'), source);
    assert.ok(await readFile(join(project, 'nodes', 'target.ts'), 'utf8'));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected deletion permits a non-source file symbolic link', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const data = join(project, 'data.json');
    const linked = join(project, 'linked.json');
    await writeFile(data, '{"value": 1}\n');
    await symlink(data, linked);
    const result = run(project, 'delete', 'target');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(linked, 'utf8'), '{"value": 1}\n');
    await assert.rejects(readFile(join(project, 'nodes', 'target.ts')), { code: 'ENOENT' });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected deletion refuses unsafe source links', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const target = join(project, 'nodes', 'target.ts');
    const original = await readFile(target, 'utf8');
    const linked = join(project, 'linked.ts');
    for (const createLink of [symlink, link]) {
      await createLink(target, linked);
      try {
        const result = run(project, 'delete', 'target');
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /conflict|link/i);
        assert.equal(await readFile(target, 'utf8'), original);
      } finally {
        await rm(linked);
      }
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected deletion refuses a reference added during commit', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const fs = require('node:fs');
  const originalRename = fs.renameSync;
  const modulePath = require.resolve('../src/protected-edit.js');
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const target = join(project, 'nodes', 'target.ts');
    const original = await readFile(target, 'utf8');
    const helper = join(project, 'helper.js');
    const added = 'import { target } from "@graph";\n';
    fs.renameSync = (source, destination) => {
      if (source === target) fs.writeFileSync(helper, added);
      return originalRename(source, destination);
    };
    delete require.cache[modulePath];
    const { deleteNode } = require(modulePath);
    assert.throws(() => deleteNode(project, { name: 'target' }), /conflict/i);
    assert.equal(await readFile(target, 'utf8'), original);
    assert.equal(await readFile(helper, 'utf8'), added);
    assert.deepEqual(await readdir(join(project, 'nodes')), ['main.ts', 'target.ts']);
  } finally {
    fs.renameSync = originalRename;
    delete require.cache[modulePath];
    await rm(project, { recursive: true, force: true });
  }
});

test('protected deletion restores the target after a removal failure', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const fs = require('node:fs');
  const originalUnlink = fs.unlinkSync;
  const modulePath = require.resolve('../src/protected-edit.js');
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const nodes = join(project, 'nodes');
    const target = join(nodes, 'target.ts');
    const original = await readFile(target, 'utf8');
    fs.unlinkSync = file => {
      if (file.includes('.graphscript-delete-')) {
        throw new Error('injected removal failure');
      }
      return originalUnlink(file);
    };
    delete require.cache[modulePath];
    const { deleteNode } = require(modulePath);
    assert.throws(() => deleteNode(project, { name: 'target' }), /injected removal failure/);
    assert.equal(await readFile(target, 'utf8'), original);
    assert.deepEqual(await readdir(nodes), ['target.ts']);
  } finally {
    fs.unlinkSync = originalUnlink;
    delete require.cache[modulePath];
    await rm(project, { recursive: true, force: true });
  }
});

test('protected deletion retains recovery files when rollback or cleanup fails', async () => {
  const fs = require('node:fs');
  const originalUnlink = fs.unlinkSync;
  const originalLink = fs.linkSync;
  const originalRemove = fs.rmSync;
  const modulePath = require.resolve('../src/protected-edit.js');
  for (const failure of ['rollback', 'cleanup']) {
    const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
    try {
      assert.equal(run(project, 'init', '--library').status, 0);
      assert.equal(run(project, 'create', 'function', 'target').status, 0);
      const nodes = join(project, 'nodes');
      const target = join(nodes, 'target.ts');
      const original = await readFile(target, 'utf8');
      fs.unlinkSync = file => {
        if (file.includes('.graphscript-delete-')) throw new Error('injected removal failure');
        return originalUnlink(file);
      };
      fs.linkSync = (source, destination) => {
        if (failure === 'rollback' && destination === target) throw new Error('injected rollback failure');
        return originalLink(source, destination);
      };
      fs.rmSync = (file, options) => {
        if (failure === 'cleanup' && file.includes('.graphscript-delete-')) throw new Error('injected cleanup failure');
        return originalRemove(file, options);
      };
      delete require.cache[modulePath];
      const { deleteNode } = require(modulePath);
      let failureMessage;
      assert.throws(() => deleteNode(project, { name: 'target' }), error => {
        failureMessage = error.message;
        assert.match(error.message, /injected removal failure/);
        assert.match(error.message, new RegExp(`injected ${failure} failure`));
        return true;
      });
      const staging = (await readdir(nodes)).find(file => file.startsWith('.graphscript-delete-'));
      assert.ok(staging);
      assert.ok(failureMessage.includes(`${failure === 'rollback' ? 'recovery files' : 'remaining files'}: ${join(nodes, staging)}`));
      assert.equal(await readFile(join(nodes, staging, 'source'), 'utf8'), original);
      if (failure === 'cleanup') assert.equal(await readFile(target, 'utf8'), original);
      else await assert.rejects(readFile(target), { code: 'ENOENT' });
    } finally {
      fs.unlinkSync = originalUnlink;
      fs.linkSync = originalLink;
      fs.rmSync = originalRemove;
      delete require.cache[modulePath];
      await rm(project, { recursive: true, force: true });
    }
  }
});

test('protected deletion refuses caller-reported unsaved node source', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const target = join(project, 'nodes', 'target.ts');
    const original = await readFile(target, 'utf8');
    const { deleteNode } = require('../src/protected-edit.js');
    assert.throws(() => deleteNode(project, { name: 'target', unsavedFiles: [join(project, 'nodes', 'main.ts')] }), /save|unsaved/i);
    assert.throws(() => deleteNode(project, { name: 'target', unsavedFiles: [join(project, 'helper.ts')] }), /save|unsaved/i);
    const alias = `${project}-alias`;
    await symlink(project, alias);
    try {
      assert.throws(() => deleteNode(project, { name: 'target', unsavedFiles: [join(alias, 'nodes', 'new.ts')] }), /save|unsaved/i);
    } finally {
      await rm(alias);
    }
    const sourceAlias = `${project}-open.json`;
    await symlink(target, sourceAlias);
    try {
      assert.throws(() => deleteNode(project, { name: 'target', unsavedFiles: [sourceAlias] }), /save|unsaved/i);
    } finally {
      await rm(sourceAlias);
    }
    assert.equal(await readFile(target, 'utf8'), original);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename updates a node and resolved imports through the CLI', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'function', 'greet').status, 0);
    assert.equal(run(project, 'create', 'function', 'caller').status, 0);
    const nodes = join(project, 'nodes');
    const original = await readFile(join(nodes, 'greet.ts'), 'utf8');
    const caller = '"graphscript:function";\n// graphscript:id 11111111-1111-4111-8111-111111111111\nimport { greet } from "@graph";\nexport function caller() { greet(); }\n';
    const start = '"graphscript:program";\nimport { greet as local } from "@graph";\nlocal();\n';
    const helper = 'import { greet } from "@graph";\nimport { greet as direct } from "./nodes/greet.ts";\nexport { greet as greeting } from "@graph";\ntype Greeting = typeof import("@graph").greet;\nfunction use(require: (name: string) => unknown) { return require("other" + "-module"); }\nmodule.exports = require("node:fs");\nprocess.env.NODE_ENV;\nconst { env } = process;\nglobalThis.console;\ngreet();\n'
      + `import ${JSON.stringify(join(nodes, 'caller.ts'))};\nimport ${JSON.stringify(pathToFileURL(join(nodes, 'main.ts')).href)};\n`;
    await writeFile(join(nodes, 'caller.ts'), caller);
    await writeFile(join(nodes, 'main.ts'), start);
    await writeFile(join(project, 'helper.ts'), helper);
    await writeFile(join(project, 'direct.ts'), 'import { greet } from "./nodes/greet.ts";\ngreet();\n');
    await writeFile(join(project, 'asset.txt'), 'asset');
    await symlink(join(project, 'asset.txt'), join(project, 'asset-link'));
    const { readGraph } = require('../src/graph.js');
    const before = readGraph(project);
    const identity = before.nodes.find(node => node.name === 'greet').id;
    const callerId = before.nodes.find(node => node.name === 'caller').id;
    const result = run(project, 'rename', 'greet', 'welcome');
    assert.equal(result.status, 0, result.stderr);
    const after = readGraph(project);
    assert.equal(after.nodes.find(node => node.name === 'welcome').id, identity);
    assert.ok(after.imports.some(reference => reference.fromId === callerId && reference.toId === identity && reference.name === 'welcome'));
    assert.equal(await readFile(join(nodes, 'welcome.ts'), 'utf8'), original.replace('function greet', 'function welcome'));
    await assert.rejects(readFile(join(nodes, 'greet.ts')), { code: 'ENOENT' });
    assert.equal(await readFile(join(nodes, 'caller.ts'), 'utf8'), caller.replace('{ greet }', '{ welcome as greet }'));
    assert.equal(await readFile(join(nodes, 'main.ts'), 'utf8'), start.replace('{ greet as local }', '{ welcome as local }'));
    assert.equal(await readFile(join(project, 'helper.ts'), 'utf8'), helper.replace('{ greet }', '{ welcome as greet }').replace('{ greet as direct }', '{ welcome as direct }').replace('./nodes/greet.ts', './nodes/welcome.ts').replace('{ greet as greeting }', '{ welcome as greeting }').replace(').greet', ').welcome'));
    assert.equal(await readFile(join(project, 'direct.ts'), 'utf8'), 'import { welcome as greet } from "./nodes/welcome.ts";\ngreet();\n');
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename accepts case-only names on a case-insensitive volume', async t => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    await writeFile(join(project, 'case-probe'), 'probe');
    try {
      await readFile(join(project, 'CASE-PROBE'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      t.skip('temporary filesystem is case-sensitive');
      return;
    }
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const nodes = join(project, 'nodes');
    const original = await readFile(join(nodes, 'target.ts'), 'utf8');
    const start = '"graphscript:program";\nimport { target } from "@graph";\ntarget();\n';
    await writeFile(join(nodes, 'main.ts'), start);
    const result = run(project, 'rename', 'target', 'Target');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(join(nodes, 'Target.ts'), 'utf8'), original.replace('function target', 'function Target'));
    assert.equal(await readFile(join(nodes, 'main.ts'), 'utf8'), start.replace('{ target }', '{ Target as target }'));
    assert.deepEqual((await readdir(nodes)).sort(), ['Target.ts', 'main.ts']);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename restores a case-only source after installation failure', async t => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const fs = require('node:fs');
  const originalLink = fs.linkSync;
  const modulePath = require.resolve('../src/protected-edit.js');
  try {
    await writeFile(join(project, 'case-probe'), 'probe');
    try {
      await readFile(join(project, 'CASE-PROBE'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      t.skip('temporary filesystem is case-sensitive');
      return;
    }
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const nodes = join(project, 'nodes');
    const start = join(nodes, 'main.ts');
    const source = '"graphscript:program";\nimport { target } from "@graph";\n';
    await writeFile(start, source);
    const before = await readFile(join(nodes, 'target.ts'), 'utf8');
    let calls = 0;
    fs.linkSync = (...args) => {
      calls += 1;
      if (calls === 2) throw new Error('injected installation failure');
      return originalLink(...args);
    };
    delete require.cache[modulePath];
    const { renameNode } = require(modulePath);
    assert.throws(() => renameNode(project, { name: 'target', newName: 'Target' }), /injected installation failure/);
    assert.equal(await readFile(start, 'utf8'), source);
    assert.equal(await readFile(join(nodes, 'target.ts'), 'utf8'), before);
    assert.deepEqual((await readdir(nodes)).sort(), ['main.ts', 'target.ts']);
  } finally {
    fs.linkSync = originalLink;
    delete require.cache[modulePath];
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename reports committed success when cleanup fails', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const fs = require('node:fs');
  const originalRm = fs.rmSync;
  const modulePath = require.resolve('../src/protected-edit.js');
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const nodes = join(project, 'nodes');
    const original = await readFile(join(nodes, 'target.ts'), 'utf8');
    fs.rmSync = (file, options) => {
      if (typeof file === 'string' && file.startsWith(join(nodes, '.graphscript-rename-'))) throw new Error('injected cleanup failure');
      return originalRm(file, options);
    };
    delete require.cache[modulePath];
    const { renameNode } = require(modulePath);
    const result = renameNode(project, { name: 'target', newName: 'renamed' });
    assert.match(result.cleanupWarning, /injected cleanup failure/);
    assert.match(result.cleanupWarning, /\.graphscript-rename-/);
    assert.equal(await readFile(join(nodes, 'renamed.ts'), 'utf8'), original.replace('function target', 'function renamed'));
    await assert.rejects(readFile(join(nodes, 'target.ts')), { code: 'ENOENT' });
  } finally {
    fs.rmSync = originalRm;
    delete require.cache[modulePath];
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename CLI warns when committed cleanup fails', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const nodes = join(project, 'nodes');
    const preload = join(project, 'inject-cleanup.cjs');
    await writeFile(preload, `const fs = require('node:fs');
const path = require('node:path');
const original = fs.rmSync;
fs.rmSync = (file, options) => {
  if (typeof file === 'string' && file.startsWith(path.join(process.cwd(), 'nodes', '.graphscript-rename-'))) throw new Error('injected cleanup failure');
  return original(file, options);
};
`);
    const result = spawnSync(process.execPath, ['--require', preload, cli, 'rename', 'target', 'renamed'], { cwd: project, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Rename succeeded.*injected cleanup failure.*\.graphscript-rename-/);
    assert.match(await readFile(join(nodes, 'renamed.ts'), 'utf8'), /function renamed/);
    await assert.rejects(readFile(join(nodes, 'target.ts')), { code: 'ENOENT' });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename updates resolved namespace and dynamic imports', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'class', 'Account').status, 0);
    const nodes = join(project, 'nodes');
    const start = '"graphscript:program";\nimport * as graph from "@graph";\nconst { Account } = graph;\ngraph.Account;\ngraph["Account"];\nlet alias;\n({ Account: alias } = graph);\nconst loaded = await import("@graph");\nconst copy = loaded;\ncopy[`Account`];\nloaded.Account;\n';
    await writeFile(join(nodes, 'main.ts'), start);
    const result = run(project, 'rename', 'Account', 'Customer');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(join(nodes, 'main.ts'), 'utf8'), start.replace('{ Account }', '{ Customer: Account }')
      .replace('graph.Account', 'graph.Customer').replace('graph["Account"]', 'graph["Customer"]')
      .replace('{ Account: alias }', '{ Customer: alias }').replace('copy[`Account`]', 'copy[`Customer`]').replace('loaded.Account', 'loaded.Customer'));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename refuses unsaved affected files without changes', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'state', 'settings').status, 0);
    const nodes = join(project, 'nodes');
    const start = join(nodes, 'main.ts');
    const source = '"graphscript:program";\nimport { settings } from "@graph";\nsettings.value;\n';
    await writeFile(start, source);
    const before = await readFile(join(nodes, 'settings.ts'), 'utf8');
    const { renameNode } = require('../src/protected-edit.js');
    assert.throws(() => renameNode(project, { name: 'settings', newName: 'config', unsavedFiles: [start] }), /unsaved|save/i);
    const alias = join(project, 'open-file.ts');
    await symlink(start, alias);
    assert.throws(() => renameNode(project, { name: 'settings', newName: 'config', unsavedFiles: [alias] }), /unsaved|save/i);
    await rm(alias);
    const sourceAlias = `${project}-open.json`;
    await symlink(start, sourceAlias);
    try {
      assert.throws(() => renameNode(project, { name: 'settings', newName: 'config', unsavedFiles: [sourceAlias] }), /unsaved|save/i);
    } finally {
      await rm(sourceAlias);
    }
    const helper = join(project, 'helper.ts');
    const helperSource = 'import { settings } from "@graph";\nsettings.value;\n';
    await writeFile(helper, helperSource);
    assert.throws(() => renameNode(project, { name: 'settings', newName: 'config', unsavedFiles: [helper] }), /unsaved|save/i);
    assert.equal(await readFile(helper, 'utf8'), helperSource);
    assert.equal(await readFile(start, 'utf8'), source);
    assert.equal(await readFile(join(nodes, 'settings.ts'), 'utf8'), before);
    await assert.rejects(readFile(join(nodes, 'config.ts')), { code: 'ENOENT' });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename refuses a caller-reported unsaved ancestor package manifest', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const project = join(parent, 'project');
  try {
    await mkdir(project);
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const node = join(project, 'nodes', 'target.ts');
    const start = join(project, 'nodes', 'main.ts');
    const helper = join(project, 'helper.ts');
    const manifest = join(parent, 'package.json');
    const source = 'import "other/target";\n';
    const startSource = '"graphscript:program";\nimport { target } from "@graph";\ntarget();\n';
    await writeFile(helper, source);
    await writeFile(start, startSource);
    await writeFile(manifest, JSON.stringify({ name: 'example' }));
    const beforeNode = await readFile(node, 'utf8');
    const { renameNode } = require('../src/protected-edit.js');
    const aliasDirectory = join(parent, 'alias');
    const aliasFile = join(parent, 'open-manifest.json');
    await symlink(parent, aliasDirectory);
    await symlink(manifest, aliasFile);
    const projectManifest = join(project, 'package.json');
    const cases = [
      { reported: manifest, existing: true },
      { reported: join(aliasDirectory, 'package.json'), existing: true },
      { reported: aliasFile, existing: true },
      { reported: join(aliasDirectory, 'package.json'), existing: false },
      { reported: aliasFile, existing: false },
      { reported: join(parent, 'Package.json'), existing: false },
      { reported: projectManifest, existing: false },
      { reported: projectManifest, existing: true },
    ];
    for (const { reported, existing } of cases) {
      const currentManifest = reported === projectManifest ? projectManifest : manifest;
      if (existing) await writeFile(currentManifest, JSON.stringify({ name: 'example' }));
      else await rm(currentManifest, { force: true });
      assert.throws(() => renameNode(project, { name: 'target', newName: 'renamed', unsavedFiles: [reported] }), /save unsaved/i, reported);
      assert.equal(await readFile(node, 'utf8'), beforeNode);
      assert.equal(await readFile(start, 'utf8'), startSource);
      assert.equal(await readFile(helper, 'utf8'), source);
      if (existing) assert.equal(await readFile(currentManifest, 'utf8'), JSON.stringify({ name: 'example' }));
      else await assert.rejects(readFile(currentManifest), { code: 'ENOENT' });
      await assert.rejects(readFile(join(project, 'nodes', 'renamed.ts')), { code: 'ENOENT' });
    }
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('protected rename refuses unresolved CommonJS graph references without changes', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const node = join(project, 'nodes', 'target.ts');
    const original = await readFile(node, 'utf8');
    const helper = join(project, 'helper.cjs');
    const source = 'const graph = require("@graph");\ngraph.target();\n';
    await writeFile(helper, source);
    const result = run(project, 'rename', 'target', 'renamed');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /cannot resolve/i);
    assert.equal(await readFile(node, 'utf8'), original);
    assert.equal(await readFile(helper, 'utf8'), source);
    await assert.rejects(readFile(join(project, 'nodes', 'renamed.ts')), { code: 'ENOENT' });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename refuses a manifest-only node route without changes', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const node = join(project, 'nodes', 'target.ts');
    const original = await readFile(node, 'utf8');
    for (const routes of [
      { exports: { './target': './nodes/target.ts' } },
      { imports: { '#nodes/*': './nodes/*.ts' } },
      { exports: { './nodes/*': { import: [null, './nodes/*.ts'] } } },
      { imports: { '#target': { default: './nodes/target.ts' } } },
      { exports: { './*': './nodes/*.ts', './target*': null } },
    ]) {
      const manifest = JSON.stringify(routes);
      await writeFile(join(project, 'package.json'), manifest);
      const result = run(project, 'rename', 'target', 'renamed');
      assert.notEqual(result.status, 0, manifest);
      assert.match(result.stderr, /package manifest/i);
      assert.equal(await readFile(node, 'utf8'), original);
      assert.equal(await readFile(join(project, 'package.json'), 'utf8'), manifest);
      await assert.rejects(readFile(join(project, 'nodes', 'renamed.ts')), { code: 'ENOENT' });
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename permits unrelated manifest routes', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const manifest = JSON.stringify({
      description: './nodes/target.ts',
      exports: { './other/*': './elsewhere/*.ts' },
      imports: { '#other/*': './elsewhere/*.ts' },
    });
    await writeFile(join(project, 'package.json'), manifest);
    const result = run(project, 'rename', 'target', 'renamed');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(join(project, 'package.json'), 'utf8'), manifest);
    await assert.rejects(readFile(join(project, 'nodes', 'target.ts')), { code: 'ENOENT' });
    assert.match(await readFile(join(project, 'nodes', 'renamed.ts'), 'utf8'), /renamed/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename permits unreachable conditional and array manifest targets', async () => {
  for (const routes of [
    { exports: { default: './other.ts', import: './nodes/target.ts' } },
    { exports: { default: { default: './other.ts' }, import: './nodes/target.ts' } },
    { exports: ['./other.ts', './nodes/target.ts'] },
    { exports: './nodes/../nodes/target.ts' },
  ]) {
    const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
    try {
      assert.equal(run(project, 'init', '--library').status, 0);
      assert.equal(run(project, 'create', 'function', 'target').status, 0);
      const manifest = JSON.stringify(routes);
      await writeFile(join(project, 'package.json'), manifest);
      const result = run(project, 'rename', 'target', 'renamed');
      assert.equal(result.status, 0, result.stderr);
      assert.equal(await readFile(join(project, 'package.json'), 'utf8'), manifest);
      assert.match(await readFile(join(project, 'nodes', 'renamed.ts'), 'utf8'), /renamed/);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  }
});

test('protected rename detects manifest routes on a case-insensitive volume', async t => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    await writeFile(join(project, 'case-probe'), 'probe');
    try {
      await readFile(join(project, 'CASE-PROBE'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      t.skip('temporary filesystem is case-sensitive');
      return;
    }
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const node = join(project, 'nodes', 'target.ts');
    const original = await readFile(node, 'utf8');
    for (const routes of [
      { exports: './nodes/TARGET.ts' },
      { exports: { './*': './NODES/*.ts' } },
      { exports: { './target': './other.ts', './*': './nodes/*.ts' } },
    ]) {
      const manifest = JSON.stringify(routes);
      await writeFile(join(project, 'package.json'), manifest);
      const result = run(project, 'rename', 'target', 'renamed');
      assert.notEqual(result.status, 0, manifest);
      assert.match(result.stderr, /package manifest/i);
      assert.equal(await readFile(node, 'utf8'), original);
      assert.equal(await readFile(join(project, 'package.json'), 'utf8'), manifest);
      await assert.rejects(readFile(join(project, 'nodes', 'renamed.ts')), { code: 'ENOENT' });
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename permits a shadowed wildcard on a case-sensitive volume', async t => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    await writeFile(join(project, 'case-probe'), 'probe');
    try {
      await readFile(join(project, 'CASE-PROBE'));
      t.skip('temporary filesystem is case-insensitive');
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const manifest = JSON.stringify({ exports: { './target': './other.ts', './*': './nodes/*.ts' } });
    await writeFile(join(project, 'package.json'), manifest);
    const result = run(project, 'rename', 'target', 'renamed');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(join(project, 'package.json'), 'utf8'), manifest);
    assert.match(await readFile(join(project, 'nodes', 'renamed.ts'), 'utf8'), /renamed/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename refuses an ancestor manifest-only route without changes', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const project = join(parent, 'project');
  try {
    await mkdir(project);
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const node = join(project, 'nodes', 'target.ts');
    const original = await readFile(node, 'utf8');
    const manifest = JSON.stringify({ exports: './project/nodes/target.ts' });
    await writeFile(join(parent, 'package.json'), manifest);
    const result = run(project, 'rename', 'target', 'renamed');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /package manifest/i);
    assert.equal(await readFile(node, 'utf8'), original);
    assert.equal(await readFile(join(parent, 'package.json'), 'utf8'), manifest);
    await assert.rejects(readFile(join(project, 'nodes', 'renamed.ts')), { code: 'ENOENT' });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('protected rename detects normalized manifest paths on a normalization-insensitive volume', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const project = join(parent, 'caf\u00e9');
  try {
    await mkdir(project);
    try {
      await readdir(join(parent, 'cafe\u0301'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      t.skip('temporary filesystem is normalization-sensitive');
      return;
    }
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const node = join(project, 'nodes', 'target.ts');
    const original = await readFile(node, 'utf8');
    const manifest = JSON.stringify({ exports: { './*': './cafe\u0301/nodes/*.ts' } });
    await writeFile(join(parent, 'package.json'), manifest);
    const result = run(project, 'rename', 'target', 'renamed');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /package manifest/i);
    assert.equal(await readFile(node, 'utf8'), original);
    assert.equal(await readFile(join(parent, 'package.json'), 'utf8'), manifest);
    await assert.rejects(readFile(join(project, 'nodes', 'renamed.ts')), { code: 'ENOENT' });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('protected rename refuses package import aliases without changes', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const node = join(project, 'nodes', 'target.ts');
    const original = await readFile(node, 'utf8');
    const manifest = JSON.stringify({ type: 'module', imports: { '#nodes/*': './nodes/*.ts' } });
    await writeFile(join(project, 'package.json'), manifest);
    for (const helper of [
      'import { target } from "#nodes/target";\ntarget();\n',
      'export { target } from "#nodes/target";\n',
      'export * from "#nodes/target";\n',
      'type Target = typeof import("#nodes/target").target;\n',
      'const target = import("#nodes/target");\n',
      'const target = require("#nodes/target");\n',
      'import target = require("#nodes/target");\n',
    ]) {
      await writeFile(join(project, 'helper.ts'), helper);
      const result = run(project, 'rename', 'target', 'renamed');
      assert.notEqual(result.status, 0, helper);
      assert.match(result.stderr, /cannot resolve/i, helper);
      assert.equal(await readFile(node, 'utf8'), original);
      assert.equal(await readFile(join(project, 'helper.ts'), 'utf8'), helper);
      assert.equal(await readFile(join(project, 'package.json'), 'utf8'), manifest);
      await assert.rejects(readFile(join(project, 'nodes', 'renamed.ts')), { code: 'ENOENT' });
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename refuses package self-references without changes', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const node = join(project, 'nodes', 'target.ts');
    const original = await readFile(node, 'utf8');
    const manifest = JSON.stringify({ name: 'example-package', exports: { './*': './nodes/*.ts' } });
    const helper = 'import { target } from "example-package/target";\ntarget();\n';
    await writeFile(join(project, 'package.json'), manifest);
    await writeFile(join(project, 'helper.ts'), helper);
    const result = run(project, 'rename', 'target', 'renamed');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /cannot resolve/i);
    assert.equal(await readFile(node, 'utf8'), original);
    assert.equal(await readFile(join(project, 'helper.ts'), 'utf8'), helper);
    assert.equal(await readFile(join(project, 'package.json'), 'utf8'), manifest);
    await assert.rejects(readFile(join(project, 'nodes', 'renamed.ts')), { code: 'ENOENT' });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

for (const [description, sources] of [
  ['relative node references', [
    'import "./nodes/target";\n',
    'export { target } from "./nodes/target.js";\n',
    'export * from "./nodes/target.ts";\n',
    'type Target = typeof import("./nodes/target.ts").target;\n',
    'const target = import("./nodes/target.ts");\n',
    'const target = import(`./nodes/target.ts`);\n',
    'const target = import("./nodes/" + "target.ts");\n',
    'const target = require("./nodes/target.ts");\n',
    'const target = require(`./nodes/target.ts`);\n',
    'const target = module.require("./nodes/target.ts");\n',
    'import target = require("./nodes/target.ts");\n',
  ]],
  ['module.require graph references', [
    'const graph = module.require("@graph");\ngraph.target();\n',
    'const graph = module["require"]("@graph");\ngraph.target();\n',
    'const graph = module[`require`]("@graph");\ngraph.target();\n',
    'const graph = module["requ" + "ire"]("@graph");\ngraph.target();\n',
    'const graph = module[method]("@graph");\ngraph.target();\n',
  ]],
  ['import-equals graph references', [
    'import graph = require("@graph");\ngraph.target();\n',
  ]],
  ['wildcard graph re-exports', [
    'export * from "@graph";\n',
  ]],
  ['unqualified graph import types', [
    'type Target = typeof import("@graph")["target"];\n',
  ]],
  ['bound require graph references', [
    'const require = createRequire(import.meta.url);\nconst graph = require(`@graph`);\ngraph.target();\n',
    'const require = createRequire(import.meta.url);\nconst graph = require(path);\ngraph.target();\n',
  ]],
  ['aliased require references', [
    'const load = require;\nload("./nodes/target.ts");\n',
    'const load = module.require;\nload("./nodes/target.ts");\n',
    'const load = module["requ" + "ire"];\nload("./nodes/target.ts");\n',
    'const { require: load } = module;\nload("./nodes/target.ts");\n',
    'const holder = module;\nholder.require("./nodes/target.ts");\n',
    'globalThis["require"]("./nodes/target.ts");\n',
    'const loader = globalThis[method];\nloader("./nodes/target.ts");\n',
    'const { require: load } = globalThis;\nload("./nodes/target.ts");\n',
    'const host = global;\nhost.require("./nodes/target.ts");\n',
    'const { getBuiltinModule } = process;\nconst load = getBuiltinModule("module").createRequire(__filename);\nload("./nodes/target.ts");\n',
    'import { createRequire as makeLoader } from "node:module";\nconst load = makeLoader(import.meta.url);\nload("./nodes/target.ts");\n',
    'import { default as mod } from "node:module";\nconst load = mod.createRequire(import.meta.url);\nload("./nodes/target.ts");\n',
    'import { Module } from "node:module";\nModule.createRequire(import.meta.url)("./nodes/target.ts");\n',
    'export { Module } from "node:module";\n',
    'import mod = require("node:module");\nmod.createRequire(__filename)("./nodes/target.ts");\n',
    'import mod = require("module");\nmod.createRequire(__filename)("./nodes/target.ts");\n',
    'const { createRequire } = require("node:module");\nconst load = createRequire(__filename);\nload("./nodes/target.ts");\n',
    'const { createRequire } = await import("node:module");\nconst load = createRequire(import.meta.url);\nload("./nodes/target.ts");\n',
    'const load = module?.require;\nload("./nodes/target.ts");\n',
    'const load = process.getBuiltinModule("module").createRequire(__filename);\nload("./nodes/target.ts");\n',
    'const load = globalThis.process.getBuiltinModule("module").createRequire(__filename);\nload("./nodes/target.ts");\n',
    'const load = module.constructor.createRequire(__filename);\nload("./nodes/target.ts");\n',
    'module.parent.require("./nodes/target.ts");\n',
    'module.children[0].require("./nodes/target.ts");\n',
    'export { createRequire } from "node:module";\n',
  ]],
]) {
  test(`protected rename refuses ${description} without changes`, async () => {
    const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
    try {
      assert.equal(run(project, 'init', '--program').status, 0);
      assert.equal(run(project, 'create', 'function', 'target').status, 0);
      const node = join(project, 'nodes', 'target.ts');
      const original = await readFile(node, 'utf8');
      const start = join(project, 'nodes', 'main.ts');
      const startSource = '"graphscript:program";\nimport { target } from "@graph";\ntarget();\n';
      await writeFile(start, startSource);
      const helper = join(project, 'helper.ts');
      for (const source of sources) {
        await writeFile(helper, source);
        const result = run(project, 'rename', 'target', 'renamed');
        assert.notEqual(result.status, 0, source);
        assert.match(result.stderr, /cannot resolve/i, source);
        assert.equal(await readFile(node, 'utf8'), original);
        assert.equal(await readFile(start, 'utf8'), startSource);
        assert.equal(await readFile(helper, 'utf8'), source);
        await assert.rejects(readFile(join(project, 'nodes', 'renamed.ts')), { code: 'ENOENT' });
      }
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
}

test('protected rename refuses case-insensitive relative node references', async t => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    await writeFile(join(project, 'case-probe'), 'probe');
    try {
      await readFile(join(project, 'CASE-PROBE'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      t.skip('temporary filesystem is case-sensitive');
      return;
    }
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const node = join(project, 'nodes', 'target.ts');
    const original = await readFile(node, 'utf8');
    const helper = join(project, 'helper.ts');
    for (const specifier of ['./nodes/TARGET.js', join(project, 'nodes', 'TARGET.js'), pathToFileURL(join(project, 'nodes', 'TARGET.js')).href]) {
      const source = `import { target } from ${JSON.stringify(specifier)};\n`;
      await writeFile(helper, source);
      const result = run(project, 'rename', 'target', 'renamed');
      assert.notEqual(result.status, 0, source);
      assert.match(result.stderr, /cannot resolve/i, source);
      assert.equal(await readFile(node, 'utf8'), original);
      assert.equal(await readFile(helper, 'utf8'), source);
      await assert.rejects(readFile(join(project, 'nodes', 'renamed.ts')), { code: 'ENOENT' });
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename restores all sources when an installation fails', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const fs = require('node:fs');
  const originalLink = fs.linkSync;
  const modulePath = require.resolve('../src/protected-edit.js');
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const nodes = join(project, 'nodes');
    const source = '"graphscript:program";\nimport { target } from "@graph";\ntarget();\n';
    await writeFile(join(nodes, 'main.ts'), source);
    const before = await readFile(join(nodes, 'target.ts'), 'utf8');
    let calls = 0;
    fs.linkSync = (...args) => {
      calls += 1;
      if (calls === 2) throw new Error('injected installation failure');
      return originalLink(...args);
    };
    delete require.cache[modulePath];
    const { renameNode } = require(modulePath);
    assert.throws(() => renameNode(project, { name: 'target', newName: 'renamed' }), /injected installation failure/);
    assert.equal(await readFile(join(nodes, 'main.ts'), 'utf8'), source);
    assert.equal(await readFile(join(nodes, 'target.ts'), 'utf8'), before);
    assert.deepEqual((await readdir(nodes)).sort(), ['main.ts', 'target.ts']);
  } finally {
    fs.linkSync = originalLink;
    delete require.cache[modulePath];
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename restores sources when staged link removal fails', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const fs = require('node:fs');
  const originalUnlink = fs.unlinkSync;
  const modulePath = require.resolve('../src/protected-edit.js');
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const nodes = join(project, 'nodes');
    const start = join(nodes, 'main.ts');
    const source = '"graphscript:program";\nimport { target } from "@graph";\ntarget();\n';
    await writeFile(start, source);
    const before = await readFile(join(nodes, 'target.ts'), 'utf8');
    let injected = false;
    fs.unlinkSync = file => {
      if (!injected && typeof file === 'string' && /\/new-\d+$/.test(file)) {
        injected = true;
        throw new Error('injected staged unlink failure');
      }
      return originalUnlink(file);
    };
    delete require.cache[modulePath];
    const { renameNode } = require(modulePath);
    assert.throws(() => renameNode(project, { name: 'target', newName: 'renamed' }), error => {
      assert.match(error.message, /injected staged unlink failure/);
      assert.doesNotMatch(error.message, /rollback failed/);
      return true;
    });
    assert.equal(await readFile(start, 'utf8'), source);
    assert.equal(await readFile(join(nodes, 'target.ts'), 'utf8'), before);
    assert.deepEqual((await readdir(nodes)).sort(), ['main.ts', 'target.ts']);
  } finally {
    fs.unlinkSync = originalUnlink;
    delete require.cache[modulePath];
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename retains both errors when rollback cleanup fails', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const fs = require('node:fs');
  const originalLink = fs.linkSync;
  const originalRm = fs.rmSync;
  const modulePath = require.resolve('../src/protected-edit.js');
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const nodes = join(project, 'nodes');
    const before = await readFile(join(nodes, 'target.ts'), 'utf8');
    let injected = false;
    fs.linkSync = (...args) => {
      if (!injected) {
        injected = true;
        throw new Error('injected installation failure');
      }
      return originalLink(...args);
    };
    fs.rmSync = (file, options) => {
      if (typeof file === 'string' && file.startsWith(join(nodes, '.graphscript-rename-'))) throw new Error('injected cleanup failure');
      return originalRm(file, options);
    };
    delete require.cache[modulePath];
    const { renameNode } = require(modulePath);
    assert.throws(() => renameNode(project, { name: 'target', newName: 'renamed' }), /injected installation failure.*injected cleanup failure.*\.graphscript-rename-/);
    assert.equal(await readFile(join(nodes, 'target.ts'), 'utf8'), before);
    const remaining = await readdir(nodes);
    assert.equal(remaining.filter(file => file.startsWith('.graphscript-rename-')).length, 1);
    await assert.rejects(readFile(join(nodes, 'renamed.ts')), { code: 'ENOENT' });
  } finally {
    fs.linkSync = originalLink;
    fs.rmSync = originalRm;
    delete require.cache[modulePath];
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename refuses a source changed during commit', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const fs = require('node:fs');
  const originalRename = fs.renameSync;
  const modulePath = require.resolve('../src/protected-edit.js');
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const nodes = join(project, 'nodes');
    const start = join(nodes, 'main.ts');
    const source = '"graphscript:program";\nimport { target } from "@graph";\n';
    await writeFile(start, source);
    const before = await readFile(join(nodes, 'target.ts'), 'utf8');
    let injected = false;
    fs.renameSync = (...args) => {
      if (!injected) {
        injected = true;
        fs.writeFileSync(start, source + '// concurrent change\n');
      }
      return originalRename(...args);
    };
    delete require.cache[modulePath];
    const { renameNode } = require(modulePath);
    assert.throws(() => renameNode(project, { name: 'target', newName: 'renamed' }), /conflict/i);
    assert.equal(await readFile(start, 'utf8'), source + '// concurrent change\n');
    assert.equal(await readFile(join(nodes, 'target.ts'), 'utf8'), before);
    assert.deepEqual((await readdir(nodes)).sort(), ['main.ts', 'target.ts']);
  } finally {
    fs.renameSync = originalRename;
    delete require.cache[modulePath];
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename preserves a concurrent permission change', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const fs = require('node:fs');
  const originalRename = fs.renameSync;
  const modulePath = require.resolve('../src/protected-edit.js');
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const nodes = join(project, 'nodes');
    const target = join(nodes, 'target.ts');
    const source = await readFile(target, 'utf8');
    fs.chmodSync(target, 0o644);
    let injected = false;
    fs.renameSync = (...args) => {
      if (!injected) {
        injected = true;
        fs.chmodSync(target, 0o600);
      }
      return originalRename(...args);
    };
    delete require.cache[modulePath];
    const { renameNode } = require(modulePath);
    assert.throws(() => renameNode(project, { name: 'target', newName: 'renamed' }), /conflict/i);
    assert.equal(fs.statSync(target).mode & 0o777, 0o600);
    assert.equal(await readFile(target, 'utf8'), source);
    assert.deepEqual(await readdir(nodes), ['target.ts']);
  } finally {
    fs.renameSync = originalRename;
    delete require.cache[modulePath];
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename preserves a concurrent package manifest change', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const fs = require('node:fs');
  const originalRename = fs.renameSync;
  const modulePath = require.resolve('../src/protected-edit.js');
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const nodes = join(project, 'nodes');
    const target = join(nodes, 'target.ts');
    const source = await readFile(target, 'utf8');
    const manifest = join(project, 'package.json');
    const changed = JSON.stringify({ name: 'other-package', exports: { './*': './nodes/*.ts' } });
    await writeFile(manifest, JSON.stringify({ name: 'example-package' }));
    await writeFile(join(project, 'helper.ts'), 'import { target } from "other-package/target";\n');
    let injected = false;
    fs.renameSync = (...args) => {
      if (!injected) {
        injected = true;
        fs.writeFileSync(manifest, changed);
      }
      return originalRename(...args);
    };
    delete require.cache[modulePath];
    const { renameNode } = require(modulePath);
    assert.throws(() => renameNode(project, { name: 'target', newName: 'renamed' }), /conflict/i);
    assert.equal(await readFile(manifest, 'utf8'), changed);
    assert.equal(await readFile(target, 'utf8'), source);
    assert.deepEqual(await readdir(nodes), ['target.ts']);
  } finally {
    fs.renameSync = originalRename;
    delete require.cache[modulePath];
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename preserves a manifest-only route added during commit', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const fs = require('node:fs');
  const originalRename = fs.renameSync;
  const modulePath = require.resolve('../src/protected-edit.js');
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const target = join(project, 'nodes', 'target.ts');
    const source = await readFile(target, 'utf8');
    const manifest = join(project, 'package.json');
    const changed = JSON.stringify({ exports: './nodes/target.ts' });
    let injected = false;
    fs.renameSync = (...args) => {
      if (!injected) {
        injected = true;
        fs.writeFileSync(manifest, changed);
      }
      return originalRename(...args);
    };
    delete require.cache[modulePath];
    const { renameNode } = require(modulePath);
    assert.throws(() => renameNode(project, { name: 'target', newName: 'renamed' }), /conflict/i);
    assert.equal(await readFile(manifest, 'utf8'), changed);
    assert.equal(await readFile(target, 'utf8'), source);
    await assert.rejects(readFile(join(project, 'nodes', 'renamed.ts')), { code: 'ENOENT' });
  } finally {
    fs.renameSync = originalRename;
    delete require.cache[modulePath];
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename preserves a manifest-only route added during installation', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const fs = require('node:fs');
  const originalLink = fs.linkSync;
  const modulePath = require.resolve('../src/protected-edit.js');
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const target = join(project, 'nodes', 'target.ts');
    const destination = join(project, 'nodes', 'renamed.ts');
    const source = await readFile(target, 'utf8');
    const manifest = join(project, 'package.json');
    const changed = JSON.stringify({ exports: './nodes/target.ts' });
    fs.linkSync = (from, to) => {
      const result = originalLink(from, to);
      if (to === destination) fs.writeFileSync(manifest, changed);
      return result;
    };
    delete require.cache[modulePath];
    const { renameNode } = require(modulePath);
    assert.throws(() => renameNode(project, { name: 'target', newName: 'renamed' }), /conflict/i);
    assert.equal(await readFile(manifest, 'utf8'), changed);
    assert.equal(await readFile(target, 'utf8'), source);
    await assert.rejects(readFile(destination), { code: 'ENOENT' });
  } finally {
    fs.linkSync = originalLink;
    delete require.cache[modulePath];
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename preserves a source changed during installation', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const fs = require('node:fs');
  const originalLink = fs.linkSync;
  const modulePath = require.resolve('../src/protected-edit.js');
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const target = join(project, 'nodes', 'target.ts');
    const destination = join(project, 'nodes', 'renamed.ts');
    const source = await readFile(target, 'utf8');
    const helper = join(project, 'helper.ts');
    const changed = 'export const helper = 2;\n';
    await writeFile(helper, 'export const helper = 1;\n');
    fs.linkSync = (from, to) => {
      const result = originalLink(from, to);
      if (to === destination) fs.writeFileSync(helper, changed);
      return result;
    };
    delete require.cache[modulePath];
    const { renameNode } = require(modulePath);
    assert.throws(() => renameNode(project, { name: 'target', newName: 'renamed' }), /conflict/i);
    assert.equal(await readFile(helper, 'utf8'), changed);
    assert.equal(await readFile(target, 'utf8'), source);
    await assert.rejects(readFile(destination), { code: 'ENOENT' });
  } finally {
    fs.linkSync = originalLink;
    delete require.cache[modulePath];
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename does not overwrite a destination created during commit', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const fs = require('node:fs');
  const originalExists = fs.existsSync;
  const modulePath = require.resolve('../src/protected-edit.js');
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const nodes = join(project, 'nodes');
    const original = join(nodes, 'target.ts');
    const destination = join(nodes, 'renamed.ts');
    const before = await readFile(original, 'utf8');
    let injected = false;
    fs.existsSync = file => {
      const exists = originalExists(file);
      if (!injected && file === destination && !originalExists(original)) {
        injected = true;
        fs.writeFileSync(destination, 'concurrent work');
      }
      return exists;
    };
    delete require.cache[modulePath];
    const { renameNode } = require(modulePath);
    assert.throws(() => renameNode(project, { name: 'target', newName: 'renamed' }), /exist|conflict/i);
    assert.equal(await readFile(original, 'utf8'), before);
    assert.equal(await readFile(destination, 'utf8'), 'concurrent work');
  } finally {
    fs.existsSync = originalExists;
    delete require.cache[modulePath];
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename preserves identity and self references for every node kind', async () => {
  for (const [kind, declaration] of [
    ['function', 'export function Original() { return { Original }; }'],
    ['class', 'export class Original { static create() { return new Original(); } }'],
    ['state', 'export const Original = { get self() { return Original; } };'],
  ]) {
    const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
    try {
      assert.equal(run(project, 'init', '--library').status, 0);
      assert.equal(run(project, 'create', kind, 'Original').status, 0);
      const file = join(project, 'nodes', 'Original.ts');
      const created = await readFile(file, 'utf8');
      const source = created.slice(0, created.indexOf('export ')) + declaration + '\n';
      await writeFile(file, source);
      const result = run(project, 'rename', 'Original', 'Updated');
      assert.equal(result.status, 0, result.stderr);
      const updated = await readFile(join(project, 'nodes', 'Updated.ts'), 'utf8');
      assert.match(updated, /graphscript:id [0-9a-f-]+/);
      assert.equal(updated.match(/graphscript:id [0-9a-f-]+/)[0], source.match(/graphscript:id [0-9a-f-]+/)[0]);
      assert.equal(updated, source.replaceAll('Original', 'Updated').replace('{ Updated };', '{ Original: Updated };'));
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  }
});

test('protected rename refuses name collisions and captured self references', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'Original').status, 0);
    assert.equal(run(project, 'create', 'state', 'Existing').status, 0);
    const nodes = join(project, 'nodes');
    const file = join(nodes, 'Original.ts');
    const created = await readFile(file, 'utf8');
    const source = created.replace('function Original() {\n}', 'function Original() { const Updated = 1; return Original; }');
    await writeFile(file, source);
    for (const [newName, diagnostic] of [['Existing', /duplicate/i], ['Updated', /conflict|capture/i]]) {
      const result = run(project, 'rename', 'Original', newName);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, diagnostic);
      assert.equal(await readFile(file, 'utf8'), source);
      assert.deepEqual((await readdir(nodes)).sort(), ['Existing.ts', 'Original.ts']);
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename refuses a new reference added during commit', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const fs = require('node:fs');
  const originalRename = fs.renameSync;
  const modulePath = require.resolve('../src/protected-edit.js');
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    assert.equal(run(project, 'create', 'function', 'other').status, 0);
    const nodes = join(project, 'nodes');
    const target = join(nodes, 'target.ts');
    const other = join(nodes, 'other.ts');
    const before = await readFile(target, 'utf8');
    const changed = (await readFile(other, 'utf8')).replace('export function', 'import { target } from "@graph";\nexport function');
    let injected = false;
    fs.renameSync = (...args) => {
      if (!injected) {
        injected = true;
        fs.writeFileSync(other, changed);
      }
      return originalRename(...args);
    };
    delete require.cache[modulePath];
    const { renameNode } = require(modulePath);
    assert.throws(() => renameNode(project, { name: 'target', newName: 'renamed' }), /conflict/i);
    assert.equal(await readFile(target, 'utf8'), before);
    assert.equal(await readFile(other, 'utf8'), changed);
    assert.deepEqual((await readdir(nodes)).sort(), ['other.ts', 'target.ts']);
  } finally {
    fs.renameSync = originalRename;
    delete require.cache[modulePath];
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename refuses a source replaced during commit even when text matches', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const fs = require('node:fs');
  const originalRename = fs.renameSync;
  const modulePath = require.resolve('../src/protected-edit.js');
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const nodes = join(project, 'nodes');
    const target = join(nodes, 'target.ts');
    const source = await readFile(target, 'utf8');
    let injected = false;
    fs.renameSync = (...args) => {
      if (!injected) {
        injected = true;
        fs.unlinkSync(target);
        fs.writeFileSync(target, source);
      }
      return originalRename(...args);
    };
    delete require.cache[modulePath];
    const { renameNode } = require(modulePath);
    assert.throws(() => renameNode(project, { name: 'target', newName: 'renamed' }), /conflict/i);
    assert.equal(await readFile(target, 'utf8'), source);
    assert.deepEqual(await readdir(nodes), ['target.ts']);
  } finally {
    fs.renameSync = originalRename;
    delete require.cache[modulePath];
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename preserves a concurrent replacement during rollback', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const fs = require('node:fs');
  const originalLink = fs.linkSync;
  const modulePath = require.resolve('../src/protected-edit.js');
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const start = join(project, 'nodes', 'main.ts');
    const target = join(project, 'nodes', 'target.ts');
    const originalTarget = await readFile(target, 'utf8');
    const originalStart = '"graphscript:program";\nimport { target } from "@graph";\n';
    await writeFile(start, originalStart);
    let installed;
    let calls = 0;
    fs.linkSync = (...args) => {
      calls += 1;
      if (calls === 1) installed = args[1];
      if (calls === 2) {
        const text = fs.readFileSync(installed, 'utf8');
        fs.unlinkSync(installed);
        fs.writeFileSync(installed, text);
        throw new Error('injected installation failure');
      }
      return originalLink(...args);
    };
    delete require.cache[modulePath];
    const { renameNode } = require(modulePath);
    let recovery;
    assert.throws(() => renameNode(project, { name: 'target', newName: 'renamed' }), error => {
      assert.match(error.message, /rollback failed.*recovery/i);
      recovery = error.message.match(/recovery files: (.+)$/)[1];
      return true;
    });
    assert.match(await readFile(installed, 'utf8'), /renamed/);
    assert.equal(await readFile(target, 'utf8'), originalTarget);
    const recoveryContents = await Promise.all((await readdir(recovery)).map(file => readFile(join(recovery, file), 'utf8')));
    assert.ok(recoveryContents.includes(originalStart));
  } finally {
    fs.linkSync = originalLink;
    delete require.cache[modulePath];
    await rm(project, { recursive: true, force: true });
  }
});

test('protected rename preserves source permissions under a restrictive umask', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const fs = require('node:fs');
  const previousUmask = process.umask();
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'target').status, 0);
    const nodes = join(project, 'nodes');
    fs.chmodSync(join(nodes, 'target.ts'), 0o664);
    process.umask(0o077);
    const { renameNode } = require('../src/protected-edit.js');
    renameNode(project, { name: 'target', newName: 'renamed' });
    assert.equal(fs.statSync(join(nodes, 'renamed.ts')).mode & 0o777, 0o664);
  } finally {
    process.umask(previousUmask);
    await rm(project, { recursive: true, force: true });
  }
});

test('creates a program project with a program-start directive', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    const result = run(project, 'init', '--program');
    assert.equal(result.status, 0, result.stderr);
    const files = await readdir(join(project, 'nodes'));
    assert.equal(files.length, 1);
    assert.match(await readFile(join(project, 'nodes', files[0]), 'utf8'), /^"graphscript:program";/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('selects program or library mode when checking a project', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    const { initializeProject } = require('../src/project.js');
    const { checkProject } = require('../src/check.js');
    initializeProject(project, { kind: 'program' });
    const start = join(project, 'nodes', 'main.ts');
    await writeFile(start, '"graphscript:program";\nconst value: number = 1;\nconsole.log(value);\n');
    let result = checkProject(project);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.equal(result.mode, 'program');
    assert.equal(result.programStart, start);
    await rm(start);
    result = checkProject(project);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.equal(result.mode, 'library');
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('reports every program-start file when more than one exists', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    const first = join(project, 'nodes', 'main.ts');
    const second = join(project, 'nodes', 'other.ts');
    await writeFile(second, '"graphscript:program";\n');
    const result = run(project, 'check');
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(first), result.stderr);
    assert.ok(result.stderr.includes(second), result.stderr);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('creates graph nodes in a program project', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    const result = run(project, 'create', 'function', 'greet');
    assert.equal(result.status, 0, result.stderr);
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { greet } from "@graph";\ngreet();\n');
    const check = run(project, 'check');
    assert.equal(check.status, 0, check.stderr);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('rejects program directives outside the first statement', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    const start = join(project, 'nodes', 'main.ts');
    for (const source of [
      'const value = 1;\n"graphscript:program";\n',
      '"graphscript:program";\nconst value = 1;\n"graphscript:program";\n',
    ]) {
      await writeFile(start, source);
      const result = run(project, 'check');
      assert.notEqual(result.status, 0, source);
      assert.ok(result.stderr.includes(start), result.stderr);
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('automatic builds select library or program mode without emitting the wrong output', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'greet').status, 0);
    let result = run(project, 'build');
    assert.equal(result.status, 0, result.stderr);
    assert.ok((await readdir(join(project, 'dist'))).includes('greet.mjs'));
    await rm(join(project, 'dist'), { recursive: true });
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nconst message: string = "program started";\nconsole.log(message);\n');
    for (const language of ['javascript', 'typescript']) {
      result = run(project, 'build', '--language', language);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(!(await readdir(join(project, 'dist'))).includes('index.mjs'));
      let output = join(project, 'dist', 'main.mjs');
      if (language === 'typescript') {
        const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
        const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
          '--module', 'nodenext', '--outDir', join(project, 'compiled'), join(project, 'dist', 'main.mts')], { encoding: 'utf8' });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
        output = join(project, 'compiled', 'main.mjs');
      }
      const execution = spawnSync(process.execPath, [output], { encoding: 'utf8' });
      assert.equal(execution.status, 0, execution.stderr);
      assert.equal(execution.stdout, 'program started\n');
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('program bundles run the reachable graph once in either output language', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    for (const [kind, name] of [['state', 'settings'], ['function', 'increment'], ['class', 'Reader'], ['function', 'unused']]) {
      assert.equal(run(project, 'create', kind, name).status, 0);
    }
    for (const [name, declaration] of Object.entries({
      settings: 'export const settings = { count: 0 };\nsettings.count++;',
      increment: 'import { settings } from "@graph";\nexport function increment(amount: number): number { return settings.count += amount; }',
      Reader: 'import { settings, increment } from "@graph";\nexport class Reader { read() { return settings.count; } increment() { return increment(1); } }',
      unused: 'export function unused() { console.log("UNREACHABLE_MARKER"); }',
    })) {
      const file = join(project, 'nodes', `${name}.ts`);
      const source = await readFile(file, 'utf8');
      await writeFile(file, source.slice(0, source.indexOf('export ')) + declaration + '\n');
    }
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { Reader, increment } from "@graph";\nconst reader = new Reader();\nconsole.log(reader.read(), reader.increment(), increment(2));\n');
    for (const language of ['javascript', 'typescript']) {
      const result = run(project, 'build', '--language', language);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, '');
      const output = join(project, 'dist', `main.${language === 'typescript' ? 'mts' : 'mjs'}`);
      for (const file of await readdir(join(project, 'dist'))) {
        if (file.endsWith('.mjs') || file.endsWith('.mts')) {
          assert.doesNotMatch(await readFile(join(project, 'dist', file), 'utf8'), /UNREACHABLE_MARKER/);
        }
      }
      let executable = output;
      if (language === 'typescript') {
        const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
        const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
          '--module', 'nodenext', '--outDir', join(project, 'compiled'), output], { encoding: 'utf8' });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
        executable = join(project, 'compiled', 'main.mjs');
      }
      const execution = spawnSync(process.execPath, [executable], { encoding: 'utf8' });
      assert.equal(execution.status, 0, execution.stderr);
      assert.equal(execution.stdout, '1 2 4\n');
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('program builds preserve top-level await in the program-start file', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    await writeFile(join(project, 'package.json'), '{"type":"module"}\n');
    assert.equal(run(project, 'create', 'function', 'helper').status, 0);
    const helper = join(project, 'nodes', 'helper.ts');
    await writeFile(helper, (await readFile(helper, 'utf8')) + 'try { await Promise.resolve(); } finally { console.log("setup"); }\n');
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { helper } from "@graph";\nawait Promise.resolve();\nhelper();\nconsole.log("started");\n');
    for (const language of ['typescript', 'javascript']) {
      const build = run(project, 'build', '--language', language);
      assert.equal(build.status, 0, build.stderr);
      let output = join(project, 'dist', 'main.mjs');
      if (language === 'typescript') {
        const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
        const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
          '--module', 'nodenext', '--outDir', join(project, 'compiled'), join(project, 'dist', 'main.mts')], { cwd: project, encoding: 'utf8' });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
        output = join(project, 'compiled', 'main.mjs');
      }
      const execution = spawnSync(process.execPath, [output], { cwd: project, encoding: 'utf8' });
      assert.equal(execution.status, 0, execution.stderr);
      assert.equal(execution.stdout, 'setup\nstarted\n');
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('program graph require preserves native async-module errors', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    await writeFile(join(project, 'package.json'), '{"type":"module"}\n');
    assert.equal(run(project, 'create', 'function', 'helper').status, 0);
    const helper = join(project, 'nodes', 'helper.ts');
    await writeFile(helper, (await readFile(helper, 'utf8')) + 'await Promise.resolve();\n');
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\ndeclare function require(name: string): unknown;\ntry { require("@graph"); } catch (error) { console.log((error as { code: string }).code); }\n');
    await mkdir(join(project, 'node_modules'), { recursive: true });
    await symlink(resolve('node_modules/@types'), join(project, 'node_modules', '@types'), 'dir');
    for (const language of ['typescript', 'javascript']) {
      const build = run(project, 'build', '--language', language);
      assert.equal(build.status, 0, build.stderr);
      let output = join(project, 'dist', 'main.mjs');
      if (language === 'typescript') {
        const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
        const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
          '--module', 'nodenext', '--types', 'node', '--outDir', join(project, 'compiled'), join(project, 'dist', 'main.mts')], { cwd: project, encoding: 'utf8' });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
        output = join(project, 'compiled', 'main.mjs');
      }
      const execution = spawnSync(process.execPath, [output], { cwd: project, encoding: 'utf8' });
      assert.equal(execution.status, 0, execution.stderr);
      assert.equal(execution.stdout, 'ERR_REQUIRE_ASYNC_MODULE\n');
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('TypeScript program bundles preserve top-level await in graph nodes', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    await writeFile(join(project, 'package.json'), '{"type":"module"}\n');
    assert.equal(run(project, 'create', 'function', 'helper').status, 0);
    const helper = join(project, 'nodes', 'helper.ts');
    await writeFile(helper, (await readFile(helper, 'utf8')).replace('export function helper() {\n}', 'export function helper(): number { return 7; }'));
    assert.equal(run(project, 'create', 'function', 'answer').status, 0);
    const node = join(project, 'nodes', 'answer.ts');
    await writeFile(node, (await readFile(node, 'utf8')).replace('export function answer() {\n}', 'import { helper } from "@graph";\nawait Promise.resolve(answer());\nconsole.log("setup", helper());\nexport function answer(): number { return 42; }'));
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { answer } from "@graph";\nconsole.log(answer());\n');
    const build = run(project, 'build', '--language', 'typescript');
    assert.equal(build.status, 0, build.stderr);
    const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
    const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
      '--module', 'nodenext', '--outDir', join(project, 'compiled'), join(project, 'dist', 'main.mts')], { encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const execution = spawnSync(process.execPath, [join(project, 'compiled', 'main.mjs')], { encoding: 'utf8' });
    assert.equal(execution.status, 0, execution.stderr);
    assert.equal(execution.stdout, 'setup 7\n42\n');
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('TypeScript program bundles preserve top-level await statements in graph nodes', async t => {
  for (const [label, setup, expected] of [
    ['if', 'if (true) await Promise.resolve();\nconsole.log("setup");', 'setup\n42\n'],
    ['for await', 'for await (const item of [Promise.resolve(1)]) { console.log("setup", item); }', 'setup 1\n42\n'],
    ['for await with awaited iterable', 'for await (const item of await Promise.resolve([Promise.resolve(1)])) { console.log("setup", item); }', 'setup 1\n42\n'],
  ]) {
    await t.test(label, async () => {
      const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
      try {
        assert.equal(run(project, 'init', '--program').status, 0);
        await writeFile(join(project, 'package.json'), '{"type":"module"}\n');
        assert.equal(run(project, 'create', 'function', 'answer').status, 0);
        const node = join(project, 'nodes', 'answer.ts');
        await writeFile(node, (await readFile(node, 'utf8')).replace('export function answer() {\n}', `${setup}\nexport function answer(): number { return 42; }`));
        await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { answer } from "@graph";\nconsole.log(answer());\n');
        const build = run(project, 'build', '--language', 'typescript');
        assert.equal(build.status, 0, build.stderr);
        const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
        const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
          '--module', 'nodenext', '--outDir', join(project, 'compiled'), join(project, 'dist', 'main.mts')], { encoding: 'utf8' });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
        const execution = spawnSync(process.execPath, [join(project, 'compiled', 'main.mjs')], { encoding: 'utf8' });
        assert.equal(execution.status, 0, execution.stderr);
        assert.equal(execution.stdout, expected);
      } finally {
        await rm(project, { recursive: true, force: true });
      }
    });
  }
});

test('TypeScript program bundles preserve top-level await in state initializers', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    await writeFile(join(project, 'package.json'), '{"type":"module"}\n');
    assert.equal(run(project, 'create', 'state', 'settings').status, 0);
    const node = join(project, 'nodes', 'settings.ts');
    const source = await readFile(node, 'utf8');
    await writeFile(node, source.slice(0, source.indexOf('export ')) + 'export const settings = { value: await Promise.resolve(42) };\n');
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { settings } from "@graph";\nconsole.log(settings.value);\n');
    const build = run(project, 'build', '--language', 'typescript');
    assert.equal(build.status, 0, build.stderr);
    const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
    const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
      '--module', 'nodenext', '--outDir', join(project, 'compiled'), join(project, 'dist', 'main.mts')], { encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const execution = spawnSync(process.execPath, [join(project, 'compiled', 'main.mjs')], { encoding: 'utf8' });
    assert.equal(execution.status, 0, execution.stderr);
    assert.equal(execution.stdout, '42\n');
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('program bundles support graph nodes with internal-looking names', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    for (const name of ['entry', 'graph', '__entry']) {
      assert.equal(run(project, 'create', 'function', name).status, 0);
      const file = join(project, 'nodes', `${name}.ts`);
      const source = await readFile(file, 'utf8');
      await writeFile(file, source.replace(`export function ${name}() {\n}`, `export function ${name}() { return ${JSON.stringify(name)}; }`));
    }
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { entry, graph, __entry } from "@graph";\nconsole.log(entry(), graph(), __entry());\n');
    for (const language of ['javascript', 'typescript']) {
      const result = run(project, 'build', '--language', language);
      assert.equal(result.status, 0, result.stderr);
      let output = join(project, 'dist', 'main.mjs');
      if (language === 'typescript') {
        const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
        const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
          '--module', 'nodenext', '--outDir', join(project, 'compiled'), join(project, 'dist', 'main.mts')], { encoding: 'utf8' });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
        output = join(project, 'compiled', 'main.mjs');
      }
      const execution = spawnSync(process.execPath, [output], { encoding: 'utf8' });
      assert.equal(execution.status, 0, execution.stderr);
      assert.equal(execution.stdout, 'entry graph __entry\n');
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('program bundles retain external package imports in either output language', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'function', 'answer').status, 0);
    assert.equal(run(project, 'create', 'function', 'other').status, 0);
    const dependency = join(project, 'node_modules', 'example-package');
    await mkdir(dependency, { recursive: true });
    await symlink(resolve('node_modules/@types'), join(project, 'node_modules', '@types'), 'dir');
    await writeFile(join(dependency, 'package.json'), JSON.stringify({ name: 'example-package', main: 'index.js', types: 'index.d.ts' }));
    await writeFile(join(dependency, 'index.js'), 'exports.value = 42;\n');
    await writeFile(join(dependency, 'index.d.ts'), 'export declare const value: number;\n');
    const secondDependency = join(project, 'node_modules', 'other-package');
    await mkdir(secondDependency, { recursive: true });
    await writeFile(join(secondDependency, 'package.json'), JSON.stringify({ name: 'other-package', main: 'index.js', types: 'index.d.ts' }));
    await writeFile(join(secondDependency, 'index.js'), 'exports.value = 7;\n');
    await writeFile(join(secondDependency, 'index.d.ts'), 'export declare const value: number;\n');
    const node = join(project, 'nodes', 'answer.ts');
    await writeFile(node, (await readFile(node, 'utf8')).replace('export function answer() {\n}', 'import { value } from "example-package";\ndeclare function require(name: string): typeof import("other-package");\nexport async function answer(): Promise<typeof import("example-package").value> { const loaded = await import("example-package"); return value + loaded.value + require("other-package").value - 49; }'));
    const other = join(project, 'nodes', 'other.ts');
    await writeFile(other, (await readFile(other, 'utf8')).replace('export function other() {\n}', 'import { value } from "other-package";\nexport function other(): number { return value; }'));
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { answer, other } from "@graph";\nvoid answer().then(result => console.log(result, other()));\n');
    for (const language of ['javascript', 'typescript']) {
      const build = run(project, 'build', '--language', language);
      assert.equal(build.status, 0, build.stderr);
      let output = join(project, 'dist', 'main.mjs');
      if (language === 'typescript') {
        const source = join(project, 'dist', 'main.mts');
        const files = (await readdir(join(project, 'dist'))).filter(file => file.endsWith('.mts'));
        const sources = await Promise.all(files.map(file => readFile(join(project, 'dist', file), 'utf8')));
        assert.match(sources.join('\n'), /answer\(\): Promise</);
        const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
        const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
          '--module', 'nodenext', '--types', 'node', '--outDir', join(project, 'compiled'), source], { cwd: project, encoding: 'utf8' });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
        output = join(project, 'compiled', 'main.mjs');
      }
      const execution = spawnSync(process.execPath, [output], { encoding: 'utf8' });
      assert.equal(execution.status, 0, execution.stderr);
      assert.equal(execution.stdout, '42 7\n');
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('program build preserves existing output when a manifest write fails', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const fs = require('node:fs');
  const originalRename = fs.renameSync;
  const buildModule = require.resolve('../src/build.js');
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    const source = join(project, 'nodes', 'main.ts');
    await writeFile(source, '"graphscript:program";\nconsole.log("old");\n');
    assert.equal(run(project, 'build', '--language', 'typescript').status, 0);
    const output = join(project, 'dist', 'main.mts');
    const manifest = join(project, 'dist', '.graphscript-build.json');
    const oldOutput = await readFile(output);
    const oldManifest = await readFile(manifest);
    await writeFile(join(project, 'dist', 'user.txt'), 'user data');
    await writeFile(source, '"graphscript:program";\nconsole.log("new");\n');
    let injected = false;
    fs.renameSync = (source, destination) => {
      if (destination === manifest && !injected) {
        injected = true;
        throw new Error('injected manifest failure');
      }
      return originalRename(source, destination);
    };
    delete require.cache[buildModule];
    const { buildProject } = require(buildModule);
    assert.throws(() => buildProject(project, { language: 'typescript' }), /injected manifest failure/);
    assert.deepEqual(await readFile(output), oldOutput);
    assert.deepEqual(await readFile(manifest), oldManifest);
    assert.equal(await readFile(join(project, 'dist', 'user.txt'), 'utf8'), 'user data');
    let replaced = false;
    fs.renameSync = (source, destination) => {
      if (destination === manifest && !replaced) {
        replaced = true;
        fs.writeFileSync(output, 'user replacement');
        throw new Error('injected replacement');
      }
      return originalRename(source, destination);
    };
    delete require.cache[buildModule];
    const secondBuild = require(buildModule).buildProject;
    let failure;
    try { secondBuild(project, { language: 'typescript' }); } catch (error) { failure = error; }
    assert.match(failure?.message ?? '', /rollback failed.*recovery files:/);
    assert.equal(await readFile(output, 'utf8'), 'user replacement');
    const recovery = failure.message.split('recovery files: ')[1];
    const recovered = await Promise.all((await readdir(recovery)).map(file => readFile(join(recovery, file))));
    assert.ok(recovered.some(content => content.equals(oldOutput)));
  } finally {
    fs.renameSync = originalRename;
    delete require.cache[buildModule];
    await rm(project, { recursive: true, force: true });
  }
});

test('type-only local helper imports do not run helper setup', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    await writeFile(join(project, 'helper.ts'), 'export class Model {}\nconsole.log("HELPER_SETUP");\n');
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport type { Model } from "../helper.js";\nconst model: Model | null = null;\nconsole.log(model);\n');
    const build = run(project, 'build', '--language', 'typescript');
    assert.equal(build.status, 0, build.stderr);
    const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
    const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
      '--module', 'nodenext', '--outDir', join(project, 'compiled'), join(project, 'dist', 'main.mts')], { encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const execution = spawnSync(process.execPath, [join(project, 'compiled', 'main.mjs')], { encoding: 'utf8' });
    assert.equal(execution.status, 0, execution.stderr);
    assert.equal(execution.stdout, 'null\n');
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('TypeScript program bundles match compiler import initialization', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    await writeFile(join(project, 'package.json'), '{"type":"module"}\n');
    await writeFile(join(project, 'helper.ts'), 'export class Model {}\nconsole.log("helper setup");\n');
    await writeFile(join(project, 'effect.ts'), 'console.log("effect setup");\n');
    const source = join(project, 'nodes', 'main.ts');
    await writeFile(source, '"graphscript:program";\nimport { Model } from "../helper.js";\nimport "../effect.js";\nconsole.log("main");\n');
    const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
    const original = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'esnext',
      '--module', 'nodenext', '--outDir', join(project, 'original'), source], { encoding: 'utf8' });
    assert.equal(original.status, 0, original.stdout + original.stderr);
    const expected = spawnSync(process.execPath, [join(project, 'original', 'nodes', 'main.js')], { encoding: 'utf8' });
    assert.equal(expected.status, 0, expected.stderr);
    await writeFile(source, '"graphscript:program";\n');
    assert.equal(run(project, 'create', 'class', 'Model').status, 0);
    assert.equal(run(project, 'create', 'function', 'effect').status, 0);
    const model = join(project, 'nodes', 'Model.ts');
    const effect = join(project, 'nodes', 'effect.ts');
    await writeFile(model, (await readFile(model, 'utf8')).replace('export class Model {\n}', 'export class Model {}\nconsole.log("helper setup");'));
    await writeFile(effect, (await readFile(effect, 'utf8')).replace('export function effect() {\n}', 'export function effect() {}\nconsole.log("effect setup");'));
    await writeFile(source, '"graphscript:program";\nimport { Model, effect } from "@graph";\neffect();\nconsole.log("main");\n');
    const build = run(project, 'build', '--language', 'typescript');
    assert.equal(build.status, 0, build.stderr);
    const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
      '--module', 'nodenext', '--outDir', join(project, 'compiled'), join(project, 'dist', 'main.mts')], { encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const actual = spawnSync(process.execPath, [join(project, 'compiled', 'main.mjs')], { encoding: 'utf8' });
    assert.equal(actual.status, 0, actual.stderr);
    assert.equal(actual.stdout, expected.stdout);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('TypeScript program bundles preserve local and package initialization order', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'function', 'answer').status, 0);
    assert.equal(run(project, 'create', 'function', 'helperValue').status, 0);
    await writeFile(join(project, 'package.json'), '{"type":"module"}\n');
    const dependency = join(project, 'node_modules', 'order-package');
    await mkdir(dependency, { recursive: true });
    await writeFile(join(dependency, 'package.json'), JSON.stringify({ name: 'order-package', type: 'module', exports: './index.js', types: './index.d.ts' }));
    await writeFile(join(dependency, 'index.js'), 'const setup = globalThis.helperSetup;\nconsole.log("package setup", setup);\nexport let value = setup === "ready" ? 2 : -1;\nexport function bump() { value++; }\nexport function unbound() { return this === undefined; }\n');
    await writeFile(join(dependency, 'index.d.ts'), 'export declare let value: number;\nexport declare function bump(): void;\nexport declare function unbound(): boolean;\nexport type Value = number;\n');
    await writeFile(join(project, 'helper.ts'), '(globalThis as any).helperSetup = "ready";\nconsole.log("helper setup");\nexport function helperValue(): number { return 40; }\n');
    const node = join(project, 'nodes', 'answer.ts');
    await writeFile(node, (await readFile(node, 'utf8')).replace('export function answer() {\n}', 'import { helperValue } from "../helper.js";\nimport { value as packageValue, bump, unbound, type Value } from "order-package";\nexport function answer(): number { bump(); const checked: Value = packageValue; return helperValue() + checked + (unbound() ? 0 : -100); }'));
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { answer } from "@graph";\nconsole.log("answer", answer());\n');
    const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
    const original = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
      '--module', 'nodenext', '--outDir', join(project, 'original'), node], { cwd: project, encoding: 'utf8' });
    assert.equal(original.status, 0, original.stdout + original.stderr);
    const originalNode = pathToFileURL(join(project, 'original', 'nodes', 'answer.js')).href;
    const expected = spawnSync(process.execPath, ['--input-type=module', '--eval', `import { answer } from ${JSON.stringify(originalNode)}; console.log("answer", answer());`], { cwd: project, encoding: 'utf8' });
    assert.equal(expected.status, 0, expected.stderr);
    assert.equal(expected.stdout, 'helper setup\npackage setup ready\nanswer 43\n');
    const graphHelper = join(project, 'nodes', 'helperValue.ts');
    await writeFile(graphHelper, (await readFile(graphHelper, 'utf8')).replace('export function helperValue() {\n}', 'export function helperValue(): number { return 40; }\n(globalThis as any).helperSetup = "ready";\nconsole.log("helper setup");'));
    await writeFile(node, (await readFile(node, 'utf8')).replace('"../helper.js"', '"@graph"'));
    const build = run(project, 'build', '--language', 'typescript');
    assert.equal(build.status, 0, build.stderr);
    const source = join(project, 'dist', 'main.mts');
    const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
      '--module', 'nodenext', '--outDir', join(project, 'compiled'), source], { cwd: project, encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const actual = spawnSync(process.execPath, [join(project, 'compiled', 'main.mjs')], { cwd: project, encoding: 'utf8' });
    assert.equal(actual.status, 0, actual.stderr);
    assert.equal(actual.stdout, expected.stdout);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('program builds preserve entry graph and package import order', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    await writeFile(join(project, 'package.json'), '{"type":"module"}\n');
    const dependency = join(project, 'node_modules', 'order-package');
    await mkdir(dependency, { recursive: true });
    await symlink(resolve('node_modules/@types'), join(project, 'node_modules', '@types'), 'dir');
    await writeFile(join(dependency, 'package.json'), JSON.stringify({ name: 'order-package', type: 'module', exports: './index.js', types: './index.d.ts' }));
    await writeFile(join(dependency, 'index.js'), 'export const value = globalThis.helperReady ? 2 : -1;\n');
    await writeFile(join(dependency, 'index.d.ts'), 'export declare const value: number;\n');
    assert.equal(run(project, 'create', 'function', 'unused').status, 0);
    assert.equal(run(project, 'create', 'function', 'helper').status, 0);
    const helper = join(project, 'nodes', 'helper.ts');
    await writeFile(helper, (await readFile(helper, 'utf8')).replace('export function helper() {\n}', 'export function helper() { return 40; }\n(globalThis as any).helperReady = true;\nconsole.log("helper setup");'));
    const unused = join(project, 'nodes', 'unused.ts');
    await writeFile(unused, (await readFile(unused, 'utf8')) + 'console.log("UNREACHABLE_MARKER");\n');
    async function checkProgram(language, expected, checkReachability = false) {
      const build = run(project, 'build', '--language', language);
      assert.equal(build.status, 0, build.stderr);
      if (checkReachability) for (const file of await readdir(join(project, 'dist'))) {
        if (file.endsWith('.mjs') || file.endsWith('.mts')) {
          assert.doesNotMatch(await readFile(join(project, 'dist', file), 'utf8'), /UNREACHABLE_MARKER/);
        }
      }
      let output = join(project, 'dist', 'main.mjs');
      if (language === 'typescript') {
        const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
        const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
          '--module', 'nodenext', '--types', 'node', '--outDir', join(project, 'compiled'), join(project, 'dist', 'main.mts')], { cwd: project, encoding: 'utf8' });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
        output = join(project, 'compiled', 'main.mjs');
      }
      const execution = spawnSync(process.execPath, [output], { cwd: project, encoding: 'utf8' });
      assert.equal(execution.status, 0, execution.stderr);
      assert.equal(execution.stdout, expected);
    }
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { helper, unused } from "@graph";\nimport { value as packageValue } from "order-package";\nconsole.log(helper() + packageValue);\n');
    for (const language of ['typescript', 'javascript']) await checkProgram(language, 'helper setup\n42\n', true);
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { helper, unused } from "@graph";\nimport { value } from "order-package";\ntype Unused = typeof unused;\nconst ignored: Unused | undefined = undefined;\nvoid ignored;\nconsole.log(helper() + value);\n');
    const typeOnlyBuild = run(project, 'build', '--language', 'javascript');
    assert.equal(typeOnlyBuild.status, 0, typeOnlyBuild.stderr);
    for (const file of await readdir(join(project, 'dist'))) {
      if (file.endsWith('.mjs')) assert.doesNotMatch(await readFile(join(project, 'dist', file), 'utf8'), /UNREACHABLE_MARKER/);
    }
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport * as graph from "@graph";\nimport { value } from "order-package";\ntype Unused = typeof graph.unused;\nconst ignored: Unused | undefined = undefined;\nvoid ignored;\nconsole.log(graph.helper() + value);\n');
    await checkProgram('javascript', 'helper setup\n42\n', true);
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport * as graph from "@graph";\nimport { value } from "order-package";\nconsole.log(graph.helper() + value);\n');
    for (const language of ['typescript', 'javascript']) await checkProgram(language, 'helper setup\n42\n');
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { helper } from "@graph";\nimport { value } from "order-package";\ndeclare function require(name: string): { basename(path: string): string };\nconsole.log(helper() + value, require("node:path").basename("/tmp/test"));\n');
    for (const language of ['typescript', 'javascript']) await checkProgram(language, 'helper setup\n42 test\n');
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { helper } from "@graph";\nimport { value } from "order-package";\ndeclare function require(name: string): { basename(path: string): string };\nconst load = require;\nconsole.log(helper() + value, load("node:path").basename("/tmp/test"));\n');
    for (const language of ['typescript', 'javascript']) await checkProgram(language, 'helper setup\n42 test\n', true);
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { helper } from "@graph";\nimport { value } from "order-package";\ndeclare function require(name: string): { basename(path: string): string };\nconst load = require.bind(null);\nconsole.log(helper() + value, load("node:path").basename("/tmp/test"));\n');
    for (const language of ['typescript', 'javascript']) await checkProgram(language, 'helper setup\n42 test\n', true);
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { helper } from "@graph";\nimport { value } from "order-package";\ndeclare const module: { require(name: string): { basename(path: string): string } };\nconsole.log(helper() + value, module.require("node:path").basename("/tmp/test"));\n');
    for (const language of ['typescript', 'javascript']) await checkProgram(language, 'helper setup\n42 test\n');
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { helper } from "@graph";\ndeclare const module: { require(name: string): { basename(path: string): string } };\nconsole.log(helper(), module.require("node:path").basename("/tmp/test"));\n');
    for (const language of ['typescript', 'javascript']) await checkProgram(language, 'helper setup\n40 test\n');
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { helper } from "@graph";\ndeclare const module: { require(name: string): { basename(path: string): string } };\nconsole.log(helper(), module?.require("node:path").basename("/tmp/test"));\n');
    for (const language of ['typescript', 'javascript']) await checkProgram(language, 'helper setup\n40 test\n');
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { helper } from "@graph";\nimport { value } from "order-package";\ndeclare function require(name: string): unknown;\nconst load = require;\nconsole.log(helper() + value, typeof load);\n');
    for (const language of ['typescript', 'javascript']) await checkProgram(language, 'helper setup\n42 function\n');
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport "@graph";\nimport { value } from "order-package";\nconsole.log(value);\n');
    for (const language of ['typescript', 'javascript']) await checkProgram(language, 'helper setup\nUNREACHABLE_MARKER\n2\n');
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nexport { helper } from "@graph";\nimport { value } from "order-package";\nconsole.log(value);\n');
    for (const language of ['typescript', 'javascript']) await checkProgram(language, 'helper setup\n2\n', true);
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nexport { helper as greeting } from "@graph";\nimport { value } from "order-package";\nconsole.log(value);\n');
    for (const language of ['typescript', 'javascript']) await checkProgram(language, 'helper setup\n2\n', true);
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nexport * from "@graph";\nimport { value } from "order-package";\nconsole.log(value);\n');
    for (const language of ['typescript', 'javascript']) await checkProgram(language, 'helper setup\nUNREACHABLE_MARKER\n2\n');
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { helper } from "@graph";\nimport graph = require("@graph");\nconsole.log(helper() + Number(graph.helper === helper));\n');
    for (const language of ['typescript', 'javascript']) await checkProgram(language, 'helper setup\nUNREACHABLE_MARKER\n41\n');
    await writeFile(join(project, 'nodes', 'main.ts'), '/// <reference types="node" />\n"graphscript:program";\nimport { helper } from "@graph";\nimport path = require("node:path");\nconsole.log(helper(), path.basename("/tmp/test"));\n');
    for (const language of ['typescript', 'javascript']) await checkProgram(language, 'helper setup\n40 test\n');
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { helper } from "@graph";\ndeclare function require(name: string): typeof import("@graph");\nconst graph = require("@graph");\nconsole.log(helper() + Number(graph.helper === helper));\n');
    for (const language of ['typescript', 'javascript']) await checkProgram(language, 'helper setup\nUNREACHABLE_MARKER\n41\n');
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { helper } from "@graph";\ndeclare function require(name: string): typeof import("@graph");\nconst load = require.bind(null);\nconsole.log(helper() + Number(load("@graph").helper === helper));\n');
    for (const language of ['typescript', 'javascript']) await checkProgram(language, 'helper setup\nUNREACHABLE_MARKER\n41\n');
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { helper } from "@graph";\nimport { value } from "order-package";\ntype Helper = typeof import("@graph").helper;\nconst typed: Helper = helper;\nconsole.log(typed() + value);\n');
    for (const language of ['typescript', 'javascript']) await checkProgram(language, 'helper setup\n42\n');
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { helper } from "@graph";\nimport { value } from "order-package";\ntype Graph = typeof import("@graph");\nconst typed: Graph["helper"] = helper;\nconsole.log(typed() + value);\n');
    for (const language of ['typescript', 'javascript']) await checkProgram(language, 'helper setup\n42\n');
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('program modules guard computed runtime imports', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'function', 'helper').status, 0);
    await writeFile(join(project, 'package.json'), '{"type":"module"}\n');
    const dependency = join(project, 'node_modules', 'order-package');
    await mkdir(dependency, { recursive: true });
    await writeFile(join(dependency, 'package.json'), JSON.stringify({ name: 'order-package', type: 'module', exports: './index.js', types: './index.d.ts' }));
    await writeFile(join(dependency, 'index.js'), 'export const value = 2;\n');
    await writeFile(join(dependency, 'index.d.ts'), 'export declare const value: number;\n');
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { helper } from "@graph";\nimport { value } from "order-package";\nconst target: string = "./helper.js";\nhelper(); console.log(value);\nvoid import(target).catch(error => console.log(error.message));\n');
    for (const language of ['typescript', 'javascript']) {
      const build = run(project, 'build', '--language', language);
      assert.equal(build.status, 0, build.stderr);
      let output = join(project, 'dist', 'main.mjs');
      if (language === 'typescript') {
        const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
        const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
          '--module', 'nodenext', '--outDir', join(project, 'compiled'), join(project, 'dist', 'main.mts')], { cwd: project, encoding: 'utf8' });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
        output = join(project, 'compiled', 'main.mjs');
      }
      await writeFile(join(project, language === 'typescript' ? 'compiled' : 'dist', 'helper.js'), 'export const value = 42;\n');
      const execution = spawnSync(process.execPath, [output], { cwd: project, encoding: 'utf8' });
      assert.equal(execution.status, 0, execution.stderr);
      assert.match(execution.stdout, /relative runtime imports are not allowed/);
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('TypeScript program builds allow safe external import order', async t => {
  const cases = [
    ['package before setup', 'import { value } from "order-package";\nimport { helper } from "@graph";\nhelper(); console.log(value);', 'console.log("helper setup");', 'helper setup\n2\n'],
    ['type-only package after setup', 'import { helper } from "@graph";\nimport type { Value } from "order-package";\nconst value: Value = 2;\nhelper(); console.log(value);', 'console.log("helper setup");', 'helper setup\n2\n'],
    ['package already evaluated', 'import { value } from "order-package";\nimport { helper } from "@graph";\nimport "order-package";\nhelper(); console.log(value);', 'console.log("helper setup");', 'helper setup\n2\n'],
    ['function-only helper before package', 'import { helper } from "@graph";\nimport { value } from "order-package";\nconsole.log(helper() + value);', '', '42\n'],
  ];
  for (const [label, main, helper, expected] of cases) {
    await t.test(label, async () => {
      const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
      try {
        assert.equal(run(project, 'init', '--program').status, 0);
        await writeFile(join(project, 'package.json'), '{"type":"module"}\n');
        const dependency = join(project, 'node_modules', 'order-package');
        await mkdir(dependency, { recursive: true });
        await writeFile(join(dependency, 'package.json'), JSON.stringify({ name: 'order-package', type: 'module', exports: './index.js', types: './index.d.ts' }));
        await writeFile(join(dependency, 'index.js'), 'export const value = 2;\n');
        await writeFile(join(dependency, 'index.d.ts'), 'export declare const value: number;\nexport type Value = number;\n');
        assert.equal(run(project, 'create', 'function', 'helper').status, 0);
        const node = join(project, 'nodes', 'helper.ts');
        await writeFile(node, (await readFile(node, 'utf8')).replace('export function helper() {\n}', `export function helper() { return 40; }\n${helper}`));
        await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\n' + main + '\n');
        const build = run(project, 'build', '--language', 'typescript');
        assert.equal(build.status, 0, build.stderr);
        const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
        const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
          '--module', 'nodenext', '--outDir', join(project, 'compiled'), join(project, 'dist', 'main.mts')], { cwd: project, encoding: 'utf8' });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
        const execution = spawnSync(process.execPath, [join(project, 'compiled', 'main.mjs')], { cwd: project, encoding: 'utf8' });
        assert.equal(execution.status, 0, execution.stderr);
        assert.equal(execution.stdout, expected);
      } finally {
        await rm(project, { recursive: true, force: true });
      }
    });
  }
});

test('program bundles preserve class module dependencies', async t => {
  for (const fixture of ['acyclic classes', 'cyclic classes', 'cyclic class TDZ', 'class-function cycle']) {
    await t.test(fixture, async () => {
      const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
      try {
        assert.equal(run(project, 'init', '--program').status, 0);
        if (fixture === 'class-function cycle') {
          assert.equal(run(project, 'create', 'class', 'First').status, 0);
          assert.equal(run(project, 'create', 'function', 'second').status, 0);
          const first = join(project, 'nodes', 'First.ts');
          const second = join(project, 'nodes', 'second.ts');
          await writeFile(first, (await readFile(first, 'utf8')).replace('export class First {\n}', 'import { second } from "@graph";\nexport class First { read(): number { return second(); } }\nconsole.log("first setup");'));
          await writeFile(second, (await readFile(second, 'utf8')).replace('export function second() {\n}', 'import { First } from "@graph";\nexport function second(): number { return First.name === "First" ? 42 : 0; }\nconsole.log("second setup");'));
          await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { First } from "@graph";\nconst first: First = new First();\nconsole.log(first.read());\n');
        } else {
          for (const name of ['First', 'Second']) assert.equal(run(project, 'create', 'class', name).status, 0);
          const first = join(project, 'nodes', 'First.ts');
          const second = join(project, 'nodes', 'Second.ts');
          await writeFile(first, (await readFile(first, 'utf8')).replace('export class First {\n}', 'import { Second } from "@graph";\nexport class First { read(): number { return new Second().read(); } }\nconsole.log("first setup");'));
          const secondBody = fixture === 'cyclic classes' || fixture === 'cyclic class TDZ'
            ? 'import { First } from "@graph";\nexport class Second { read(): number { return First.name === "First" ? 42 : 0; } }\nconsole.log("second setup");'
            : 'export class Second { read(): number { return 42; } }\nconsole.log("second setup");';
          await writeFile(second, (await readFile(second, 'utf8')).replace('export class Second {\n}', fixture === 'cyclic class TDZ' ? secondBody + '\nconsole.log(First.name);' : secondBody));
          await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { First } from "@graph";\nconst first: First = new First();\nconsole.log(first.read());\n');
        }
        for (const language of ['javascript', 'typescript']) {
          const build = run(project, 'build', '--language', language);
          assert.equal(build.status, 0, `${language}: ${build.stderr}`);
          let output = join(project, 'dist', `main.${language === 'typescript' ? 'mts' : 'mjs'}`);
          if (language === 'typescript') {
            const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
            const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
              '--module', 'nodenext', '--outDir', join(project, 'compiled'), output], { encoding: 'utf8' });
            assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr + '\n' + await readFile(output, 'utf8'));
            output = join(project, 'compiled', 'main.mjs');
          }
          const execution = spawnSync(process.execPath, [output], { encoding: 'utf8' });
          if (fixture === 'cyclic class TDZ') {
            assert.notEqual(execution.status, 0);
            assert.match(execution.stderr, /ReferenceError: Cannot access 'First' before initialization/);
            continue;
          }
          assert.equal(execution.status, 0, execution.stderr);
          assert.equal(execution.stdout, 'second setup\nfirst setup\n42\n');
        }
      } finally {
        await rm(project, { recursive: true, force: true });
      }
    });
  }
});

test('program bundles execute cyclic graph functions in either output language', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    for (const name of ['even', 'odd']) assert.equal(run(project, 'create', 'function', name).status, 0);
    for (const [name, other, base] of [['even', 'odd', 'true'], ['odd', 'even', 'false']]) {
      const file = join(project, 'nodes', `${name}.ts`);
      await writeFile(file, (await readFile(file, 'utf8')).replace(`export function ${name}() {\n}`, `import { ${other} } from "@graph";\nexport function ${name}(value: number): boolean { return value === 0 ? ${base} : ${other}(value - 1); }`));
    }
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { even } from "@graph";\nconsole.log(even(4), even(3));\n');
    for (const language of ['javascript', 'typescript']) {
      const build = run(project, 'build', '--language', language);
      assert.equal(build.status, 0, build.stderr);
      let output = join(project, 'dist', `main.${language === 'typescript' ? 'mts' : 'mjs'}`);
      if (language === 'typescript') {
        const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
        const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
          '--module', 'nodenext', '--outDir', join(project, 'compiled'), output], { encoding: 'utf8' });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
        output = join(project, 'compiled', 'main.mjs');
      }
      const execution = spawnSync(process.execPath, [output], { encoding: 'utf8' });
      assert.equal(execution.status, 0, execution.stderr);
      assert.equal(execution.stdout, 'true false\n');
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('program bundles preserve external imports in cyclic graph functions', async t => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    for (const name of ['first', 'second']) assert.equal(run(project, 'create', 'function', name).status, 0);
    await mkdir(join(project, 'node_modules'), { recursive: true });
    await symlink(resolve('node_modules/@types'), join(project, 'node_modules', '@types'), 'dir');
    const dependency = join(project, 'node_modules', 'cycle-package');
    await mkdir(dependency);
    await writeFile(join(dependency, 'package.json'), JSON.stringify({ name: 'cycle-package', type: 'module', exports: './index.js', types: './index.d.ts' }));
    await writeFile(join(dependency, 'index.js'), 'export let count = 0;\nexport function bump() { count++; }\nexport function unbound() { return this === undefined; }\nexport const label = "package";\nexport default function identify() { return "default"; }\n');
    await writeFile(join(dependency, 'index.d.ts'), 'export type PathValue = string;\nexport declare let count: number;\nexport declare function bump(): void;\nexport declare function unbound(): boolean;\nexport declare const label: string;\nexport default function identify(): string;\n');
    const first = join(project, 'nodes', 'first.ts');
    await writeFile(first, '/// <reference types="node" />\n' + (await readFile(first, 'utf8')).replace('export function first() {\n}', 'import { basename } from "node:path";\nimport identify, { label as alias, count, unbound } from "cycle-package";\nimport * as packageNamespace from "cycle-package";\nimport type { PathValue } from "cycle-package";\nimport { second } from "@graph";\nexport function first(value: PathValue): string { const shadow = ((basename: string) => basename)("shadow"); return value ? [basename(value), ({ alias }).alias, count, packageNamespace.count, identify(), unbound(), shadow].join(":") : second(); }\nconsole.log("first setup");'));
    const second = join(project, 'nodes', 'second.ts');
    await writeFile(second, (await readFile(second, 'utf8')).replace('export function second() {\n}', 'import { first } from "@graph";\nexport function second(): string { return first("/tmp/example.txt"); }\nconsole.log("second setup", first("/tmp/setup.txt"));'));
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { first } from "@graph";\nimport { bump } from "cycle-package";\nbump();\nconsole.log(first(""));\n');
    for (const language of ['typescript', 'javascript']) {
      await t.test(language, async () => {
        const build = run(project, 'build', '--language', language);
        assert.equal(build.status, 0, build.stderr);
        let output = join(project, 'dist', `main.${language === 'typescript' ? 'mts' : 'mjs'}`);
        if (language === 'typescript') {
          const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
          const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
            '--module', 'nodenext', '--types', 'node', '--outDir', join(project, 'compiled'), output], { cwd: project, encoding: 'utf8' });
          assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
          output = join(project, 'compiled', 'main.mjs');
        }
        const execution = spawnSync(process.execPath, [output], { encoding: 'utf8' });
        assert.equal(execution.status, 0, execution.stderr);
        assert.equal(execution.stdout, 'second setup setup.txt:package:0:0:default:true:shadow\nfirst setup\nexample.txt:package:1:1:default:true:shadow\n');
      });
    }
    const firstSource = await readFile(first, 'utf8');
    await writeFile(first, firstSource.replace('import { basename } from "node:path";', 'import { second } from "@graph";\nimport { basename } from "node:path";')
      .replace('import type { PathValue } from "cycle-package";\nimport { second } from "@graph";', 'import type { PathValue } from "cycle-package";'));
    for (const language of ['typescript', 'javascript']) {
      await t.test(`${language} package read before initialization`, async () => {
        const build = run(project, 'build', '--language', language);
        assert.equal(build.status, 0, build.stderr);
        let output = join(project, 'dist', `main.${language === 'typescript' ? 'mts' : 'mjs'}`);
        if (language === 'typescript') {
          const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
          const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
            '--module', 'nodenext', '--types', 'node', '--outDir', join(project, 'compiled'), output], { cwd: project, encoding: 'utf8' });
          assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
          output = join(project, 'compiled', 'main.mjs');
        }
        const execution = spawnSync(process.execPath, [output], { encoding: 'utf8' });
        assert.notEqual(execution.status, 0);
        assert.match(execution.stderr, /ReferenceError: Cannot access 'alias' before initialization/);
      });
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('program bundles support cycles with an additional graph dependency', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    for (const [kind, name] of [['function', 'first'], ['function', 'second'], ['function', 'helper'], ['state', 'shared']]) {
      assert.equal(run(project, 'create', kind, name).status, 0);
    }
    const first = join(project, 'nodes', 'first.ts');
    await writeFile(first, (await readFile(first, 'utf8')).replace('export function first() {\n}', 'import { second, helper, shared } from "@graph";\nexport function first(useState = true): number { return second() + helper() + (useState ? shared.value++ : 0); }\nconsole.log("first setup");'));
    const second = join(project, 'nodes', 'second.ts');
    await writeFile(second, (await readFile(second, 'utf8')).replace('export function second() {\n}', 'import { first } from "@graph";\nexport function second(): number { return 10; }\nconsole.log("second setup", first(false));'));
    const helper = join(project, 'nodes', 'helper.ts');
    await writeFile(helper, (await readFile(helper, 'utf8')).replace('export function helper() {\n}', 'export function helper(): number { return 20; }\nconsole.log("helper setup");'));
    const shared = join(project, 'nodes', 'shared.ts');
    await writeFile(shared, (await readFile(shared, 'utf8')).replace('export const shared = {\n};', 'export const shared = { value: 1 };\nconsole.log("shared setup");'));
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { first, shared } from "@graph";\nconsole.log("main", first(), shared.value);\n');
    for (const language of ['typescript', 'javascript']) {
      const build = run(project, 'build', '--language', language);
      assert.equal(build.status, 0, build.stderr);
      let output = join(project, 'dist', `main.${language === 'typescript' ? 'mts' : 'mjs'}`);
      if (language === 'typescript') {
        const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
        const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
          '--module', 'nodenext', '--outDir', join(project, 'compiled'), output], { encoding: 'utf8' });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
        output = join(project, 'compiled', 'main.mjs');
      }
      const execution = spawnSync(process.execPath, [output], { encoding: 'utf8' });
      assert.equal(execution.status, 0, execution.stderr);
      assert.equal(execution.stdout, 'second setup 30\nhelper setup\nshared setup\nfirst setup\nmain 31 2\n');
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('program bundles exclude unrelated unsupported cycles', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    for (const [kind, name] of [['function', 'first'], ['function', 'second'], ['class', 'Model']]) {
      assert.equal(run(project, 'create', kind, name).status, 0);
    }
    const first = join(project, 'nodes', 'first.ts');
    await writeFile(first, (await readFile(first, 'utf8')).replace('export function first() {\n}', 'import { second, Model } from "@graph";\nexport function first(): void { void second; void Model; }'));
    const second = join(project, 'nodes', 'second.ts');
    await writeFile(second, (await readFile(second, 'utf8')).replace('export function second() {\n}', 'import { first } from "@graph";\nexport function second(): void { void first; }'));
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nconsole.log("main");\n');
    for (const language of ['typescript', 'javascript']) {
      const build = run(project, 'build', '--language', language);
      assert.equal(build.status, 0, build.stderr);
      let output = join(project, 'dist', `main.${language === 'typescript' ? 'mts' : 'mjs'}`);
      if (language === 'typescript') {
        const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
        const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
          '--module', 'nodenext', '--outDir', join(project, 'compiled'), output], { encoding: 'utf8' });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
        output = join(project, 'compiled', 'main.mjs');
      }
      const execution = spawnSync(process.execPath, [output], { encoding: 'utf8' });
      assert.equal(execution.status, 0, execution.stderr);
      assert.equal(execution.stdout, 'main\n');
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('program bundles reject early reads of state outside a cycle', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    for (const [kind, name] of [['function', 'first'], ['function', 'second'], ['state', 'shared']]) {
      assert.equal(run(project, 'create', kind, name).status, 0);
    }
    const first = join(project, 'nodes', 'first.ts');
    await writeFile(first, (await readFile(first, 'utf8')).replace('export function first() {\n}', 'import { second, shared } from "@graph";\nexport function first(): number { void second; return shared.value; }'));
    const second = join(project, 'nodes', 'second.ts');
    await writeFile(second, (await readFile(second, 'utf8')).replace('export function second() {\n}', 'import { first } from "@graph";\nexport function second(): number { return first(); }\nconsole.log(first());'));
    const shared = join(project, 'nodes', 'shared.ts');
    await writeFile(shared, (await readFile(shared, 'utf8')).replace('export const shared = {\n};', 'export const shared = { value: 42 };'));
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { first } from "@graph";\nconsole.log(first());\n');
    for (const language of ['typescript', 'javascript']) {
      const build = run(project, 'build', '--language', language);
      assert.equal(build.status, 0, build.stderr);
      let output = join(project, 'dist', `main.${language === 'typescript' ? 'mts' : 'mjs'}`);
      if (language === 'typescript') {
        const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
        const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
          '--module', 'nodenext', '--outDir', join(project, 'compiled'), output], { encoding: 'utf8' });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
        output = join(project, 'compiled', 'main.mjs');
      }
      const execution = spawnSync(process.execPath, [output], { encoding: 'utf8' });
      assert.notEqual(execution.status, 0);
      assert.match(execution.stderr, /ReferenceError: Cannot access 'shared' before initialization/);
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('program bundles preserve hoisted functions during cyclic node setup', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    for (const name of ['first', 'second']) assert.equal(run(project, 'create', 'function', name).status, 0);
    const first = join(project, 'nodes', 'first.ts');
    await writeFile(first, (await readFile(first, 'utf8')).replace('export function first() {\n}', 'import { second } from "@graph";\nexport function first(): number { return 42; }\nconsole.log("first", second());'));
    const second = join(project, 'nodes', 'second.ts');
    await writeFile(second, (await readFile(second, 'utf8')).replace('export function second() {\n}', 'import { first } from "@graph";\nexport function second(): number { return first(); }\nconsole.log("second", first());'));
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { first } from "@graph";\nconsole.log("main", first());\n');
    for (const language of ['javascript', 'typescript']) {
      const build = run(project, 'build', '--language', language);
      assert.equal(build.status, 0, build.stderr);
      let output = join(project, 'dist', `main.${language === 'typescript' ? 'mts' : 'mjs'}`);
      if (language === 'typescript') {
        const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
        const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
          '--module', 'nodenext', '--outDir', join(project, 'compiled'), output], { encoding: 'utf8' });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
        output = join(project, 'compiled', 'main.mjs');
      }
      const execution = spawnSync(process.execPath, [output], { encoding: 'utf8' });
      assert.equal(execution.status, 0, execution.stderr);
      assert.equal(execution.stdout, 'second 42\nfirst 42\nmain 42\n');
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('cyclic program functions preserve imported function identity and unbound tags', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    for (const name of ['first', 'second']) assert.equal(run(project, 'create', 'function', name).status, 0);
    const first = join(project, 'nodes', 'first.ts');
    await writeFile(first, (await readFile(first, 'utf8')).replace('export function first() {\n}', 'import { second } from "@graph";\nexport function first(): string { return second.name + " " + second`ok`; }'));
    const second = join(project, 'nodes', 'second.ts');
    await writeFile(second, (await readFile(second, 'utf8')).replace('export function second() {\n}', 'import { first } from "@graph";\nexport function second(this: unknown, parts: TemplateStringsArray): string { void first; return this === undefined ? parts[0] : "bound"; }'));
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { first } from "@graph";\nconsole.log(first());\n');
    for (const language of ['javascript', 'typescript']) {
      const build = run(project, 'build', '--language', language);
      assert.equal(build.status, 0, build.stderr);
      let output = join(project, 'dist', `main.${language === 'typescript' ? 'mts' : 'mjs'}`);
      if (language === 'typescript') {
        const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
        const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
          '--module', 'nodenext', '--outDir', join(project, 'compiled'), output], { encoding: 'utf8' });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
        output = join(project, 'compiled', 'main.mjs');
      }
      const execution = spawnSync(process.execPath, [output], { encoding: 'utf8' });
      assert.equal(execution.status, 0, execution.stderr);
      assert.equal(execution.stdout, 'second ok\n');
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('program bundles preserve shared state during cyclic graph setup', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'function', 'readValue').status, 0);
    assert.equal(run(project, 'create', 'state', 'shared').status, 0);
    const functionFile = join(project, 'nodes', 'readValue.ts');
    await writeFile(functionFile, (await readFile(functionFile, 'utf8')).replace('export function readValue() {\n}', 'import { shared } from "@graph";\nexport function readValue(): number { return shared.value; }'));
    const stateFile = join(project, 'nodes', 'shared.ts');
    await writeFile(stateFile, (await readFile(stateFile, 'utf8')).replace('export const shared = {\n};', 'import { readValue } from "@graph";\nexport const shared = { value: 42 };\nconsole.log("setup", readValue());'));
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { readValue, shared } from "@graph";\nconst model: typeof shared = shared;\nconsole.log("main", readValue(), model.value);\n');
    for (const language of ['javascript', 'typescript']) {
      const build = run(project, 'build', '--language', language);
      assert.equal(build.status, 0, build.stderr);
      let output = join(project, 'dist', `main.${language === 'typescript' ? 'mts' : 'mjs'}`);
      if (language === 'typescript') {
        const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
        const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
          '--module', 'nodenext', '--outDir', join(project, 'compiled'), output], { encoding: 'utf8' });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
        output = join(project, 'compiled', 'main.mjs');
      }
      const execution = spawnSync(process.execPath, [output], { encoding: 'utf8' });
      assert.equal(execution.status, 0, execution.stderr);
      assert.equal(execution.stdout, 'setup 42\nmain 42 42\n');
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('program bundles reject early reads of cyclic state', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'function', 'readValue').status, 0);
    assert.equal(run(project, 'create', 'state', 'shared').status, 0);
    const functionFile = join(project, 'nodes', 'readValue.ts');
    await writeFile(functionFile, (await readFile(functionFile, 'utf8')).replace('export function readValue() {\n}', 'import { shared } from "@graph";\nexport function readValue(): number { return shared.value; }'));
    const stateFile = join(project, 'nodes', 'shared.ts');
    await writeFile(stateFile, (await readFile(stateFile, 'utf8')).replace('export const shared = {\n};', 'import { readValue } from "@graph";\nexport const shared = { value: readValue() };'));
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { readValue } from "@graph";\nconsole.log(readValue());\n');
    for (const language of ['typescript', 'javascript']) {
      const build = run(project, 'build', '--language', language);
      assert.equal(build.status, 0, build.stderr);
      let output = join(project, 'dist', `main.${language === 'typescript' ? 'mts' : 'mjs'}`);
      if (language === 'typescript') {
        const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
        const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
          '--module', 'nodenext', '--outDir', join(project, 'compiled'), output], { encoding: 'utf8' });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
        output = join(project, 'compiled', 'main.mjs');
      }
      const execution = spawnSync(process.execPath, [output], { encoding: 'utf8' });
      assert.notEqual(execution.status, 0);
      assert.match(execution.stderr, /ReferenceError: Cannot access 'shared' before initialization/);
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('program bundles preserve static graph namespace calls in graph nodes', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    for (const name of ['answer', 'caller', 'unused']) assert.equal(run(project, 'create', 'function', name).status, 0);
    const answer = join(project, 'nodes', 'answer.ts');
    await writeFile(answer, (await readFile(answer, 'utf8')).replace('export function answer() {\n}', 'export function answer(this: unknown) { if (Object.prototype.toString.call(this) !== "[object Module]") throw new Error("wrong receiver"); return 42; }'));
    const caller = join(project, 'nodes', 'caller.ts');
    await writeFile(caller, (await readFile(caller, 'utf8')).replace('export function caller() {\n}', 'import * as graph from "@graph";\nexport function caller() { return graph.answer(); }'));
    const unused = join(project, 'nodes', 'unused.ts');
    await writeFile(unused, (await readFile(unused, 'utf8')) + 'console.log("UNREACHABLE_MARKER");\n');
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { caller } from "@graph";\nconsole.log(caller());\n');
    for (const language of ['javascript', 'typescript']) {
      const build = run(project, 'build', '--language', language);
      assert.equal(build.status, 0, build.stderr);
      const source = join(project, 'dist', `main.${language === 'typescript' ? 'mts' : 'mjs'}`);
      assert.doesNotMatch(await readFile(source, 'utf8'), /UNREACHABLE_MARKER/);
      let output = source;
      if (language === 'typescript') {
        const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
        const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
          '--module', 'nodenext', '--outDir', join(project, 'compiled'), source], { encoding: 'utf8' });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
        output = join(project, 'compiled', 'main.mjs');
      }
      const execution = spawnSync(process.execPath, [output], { encoding: 'utf8' });
      assert.equal(execution.status, 0, execution.stderr);
      assert.equal(execution.stdout, '42\n');
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('program builds expose native graph namespace descriptors', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'function', 'answer').status, 0);
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport * as graph from "@graph";\nconst descriptor = Object.getOwnPropertyDescriptor(graph, "answer")!;\nconst tag = Object.getOwnPropertyDescriptor(graph, Symbol.toStringTag)!;\nconsole.log(typeof descriptor.value, descriptor.writable, descriptor.enumerable, descriptor.configurable, tag.enumerable);\n');
    for (const language of ['typescript', 'javascript']) {
      const build = run(project, 'build', '--language', language);
      assert.equal(build.status, 0, build.stderr);
      let output = join(project, 'dist', 'main.mjs');
      if (language === 'typescript') {
        const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
        const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
          '--module', 'nodenext', '--outDir', join(project, 'compiled'), join(project, 'dist', 'main.mts')], { cwd: project, encoding: 'utf8' });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
        output = join(project, 'compiled', 'main.mjs');
      }
      const execution = spawnSync(process.execPath, [output], { cwd: project, encoding: 'utf8' });
      assert.equal(execution.status, 0, execution.stderr);
      assert.equal(execution.stdout, 'function true true false false\n');
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('type-only graph imports do not run node setup in program bundles', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'class', 'Model').status, 0);
    assert.equal(run(project, 'create', 'function', 'unused').status, 0);
    const node = join(project, 'nodes', 'Model.ts');
    await writeFile(node, (await readFile(node, 'utf8')) + 'console.log("TYPE_ONLY_SETUP");\n');
    const unused = join(project, 'nodes', 'unused.ts');
    await writeFile(unused, (await readFile(unused, 'utf8')) + 'console.log("UNUSED_SETUP");\n');
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport type { Model } from "@graph";\nimport { unused } from "@graph";\nconst value: Model | null = null;\nconsole.log(value);\n');
    for (const language of ['javascript', 'typescript']) {
      const build = run(project, 'build', '--language', language);
      assert.equal(build.status, 0, build.stderr);
      let output = join(project, 'dist', `main.${language === 'typescript' ? 'mts' : 'mjs'}`);
      if (language === 'typescript') {
        const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
        const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
          '--module', 'nodenext', '--outDir', join(project, 'compiled'), output], { encoding: 'utf8' });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
        output = join(project, 'compiled', 'main.mjs');
      }
      const execution = spawnSync(process.execPath, [output], { encoding: 'utf8' });
      assert.equal(execution.status, 0, execution.stderr);
      assert.equal(execution.stdout, 'null\n');
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('program bundles support graph types with type-only dependencies', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    for (const name of ['Model', 'Detail']) assert.equal(run(project, 'create', 'class', name).status, 0);
    const model = join(project, 'nodes', 'Model.ts');
    await writeFile(model, (await readFile(model, 'utf8')).replace('export class Model {\n}', 'import type { Detail } from "@graph";\nexport class Model { detail!: Detail; }') + 'console.log("MODEL_SETUP");\n');
    const detail = join(project, 'nodes', 'Detail.ts');
    await writeFile(detail, (await readFile(detail, 'utf8')) + 'console.log("DETAIL_SETUP");\n');
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport type { Model } from "@graph";\ntype Alias = import("@graph").Detail;\nconst model: Model | null = null;\nconst detail: Alias | null = null;\nconsole.log(model, detail);\n');
    for (const language of ['javascript', 'typescript']) {
      const build = run(project, 'build', '--language', language);
      assert.equal(build.status, 0, build.stderr);
      let output = join(project, 'dist', `main.${language === 'typescript' ? 'mts' : 'mjs'}`);
      if (language === 'typescript') {
        const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
        const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
          '--module', 'nodenext', '--outDir', join(project, 'compiled'), output], { encoding: 'utf8' });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
        output = join(project, 'compiled', 'main.mjs');
      }
      const execution = spawnSync(process.execPath, [output], { encoding: 'utf8' });
      assert.equal(execution.status, 0, execution.stderr);
      assert.equal(execution.stdout, 'null null\n');
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('program bundles treat graph imports used only as types as type-only', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'class', 'Model').status, 0);
    const model = join(project, 'nodes', 'Model.ts');
    await writeFile(model, (await readFile(model, 'utf8')) + 'console.log("MODEL_SETUP");\n');
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { Model } from "@graph";\nconst model: Model | null = null;\nconsole.log(model);\n');
    for (const language of ['javascript', 'typescript']) {
      const build = run(project, 'build', '--language', language);
      assert.equal(build.status, 0, build.stderr);
      let output = join(project, 'dist', `main.${language === 'typescript' ? 'mts' : 'mjs'}`);
      if (language === 'typescript') {
        const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
        const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
          '--module', 'nodenext', '--outDir', join(project, 'compiled'), output], { encoding: 'utf8' });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
        output = join(project, 'compiled', 'main.mjs');
      }
      const execution = spawnSync(process.execPath, [output], { encoding: 'utf8' });
      assert.equal(execution.status, 0, execution.stderr);
      assert.equal(execution.stdout, 'null\n');
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('program bundles support type-only graph namespace imports', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'class', 'Model').status, 0);
    const model = join(project, 'nodes', 'Model.ts');
    await writeFile(model, (await readFile(model, 'utf8')) + 'console.log("MODEL_SETUP");\n');
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport type * as graph from "@graph";\nconst model: graph.Model | null = null;\nconsole.log(model);\n');
    for (const language of ['javascript', 'typescript']) {
      const build = run(project, 'build', '--language', language);
      assert.equal(build.status, 0, build.stderr);
      let output = join(project, 'dist', `main.${language === 'typescript' ? 'mts' : 'mjs'}`);
      if (language === 'typescript') {
        const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
        const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
          '--module', 'nodenext', '--outDir', join(project, 'compiled'), output], { encoding: 'utf8' });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
        output = join(project, 'compiled', 'main.mjs');
      }
      const execution = spawnSync(process.execPath, [output], { encoding: 'utf8' });
      assert.equal(execution.status, 0, execution.stderr);
      assert.equal(execution.stdout, 'null\n');
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('program bundles retain external types used by graph declarations', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'class', 'Model').status, 0);
    const dependency = join(project, 'node_modules', 'example-types');
    await mkdir(dependency, { recursive: true });
    await writeFile(join(dependency, 'package.json'), JSON.stringify({ name: 'example-types', types: 'index.d.ts' }));
    await writeFile(join(dependency, 'index.d.ts'), 'export interface Detail { value: number; }\n');
    const model = join(project, 'nodes', 'Model.ts');
    await writeFile(model, (await readFile(model, 'utf8')).replace('export class Model {\n}', 'import type { Detail } from "example-types";\nexport class Model { detail!: Detail; }') + 'console.log("MODEL_SETUP");\n');
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport type { Model } from "@graph";\nconst model: Model | null = null;\nconsole.log(model);\n');
    const build = run(project, 'build', '--language', 'typescript');
    assert.equal(build.status, 0, build.stderr);
    const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
    const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
      '--module', 'nodenext', '--outDir', join(project, 'compiled'), join(project, 'dist', 'main.mts')], { encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const execution = spawnSync(process.execPath, [join(project, 'compiled', 'main.mjs')], { encoding: 'utf8' });
    assert.equal(execution.status, 0, execution.stderr);
    assert.equal(execution.stdout, 'null\n');
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('program bundles initialize graph imports before entry statements', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'function', 'answer').status, 0);
    const node = join(project, 'nodes', 'answer.ts');
    await writeFile(node, (await readFile(node, 'utf8')).replace('export function answer() {\n}', 'export function answer() { return 42; }'));
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nconsole.log(answer());\nimport { answer } from "@graph";\n');
    for (const language of ['javascript', 'typescript']) {
      const build = run(project, 'build', '--language', language);
      assert.equal(build.status, 0, build.stderr);
      let output = join(project, 'dist', `main.${language === 'typescript' ? 'mts' : 'mjs'}`);
      if (language === 'typescript') {
        const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
        const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
          '--module', 'nodenext', '--outDir', join(project, 'compiled'), output], { encoding: 'utf8' });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
        output = join(project, 'compiled', 'main.mjs');
      }
      const execution = spawnSync(process.execPath, [output], { encoding: 'utf8' });
      assert.equal(execution.status, 0, execution.stderr);
      assert.equal(execution.stdout, '42\n');
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('program builds report unsupported dynamic GraphScript imports', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'function', 'load').status, 0);
    const file = join(project, 'nodes', 'load.ts');
    const source = await readFile(file, 'utf8');
    await writeFile(file, source.replace('export function load() {\n}', 'export async function load() { return import("@graph"); }'));
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nconsole.log("static");\n');
    const unrelated = run(project, 'build', '--language', 'javascript');
    assert.equal(unrelated.status, 0, unrelated.stderr);
    await rm(join(project, 'dist'), { recursive: true });
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nimport { load } from "@graph";\nvoid load();\n');
    const result = run(project, 'build', '--language', 'javascript');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /dynamic GraphScript import/i);
    await assert.rejects(readdir(join(project, 'dist')), { code: 'ENOENT' });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('JavaScript program builds preserve analyzer warnings and reject compiler errors', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'state', 'settings').status, 0);
    assert.equal(run(project, 'create', 'function', 'readSetting').status, 0);
    const state = join(project, 'nodes', 'settings.ts');
    await writeFile(state, (await readFile(state, 'utf8')).replace('export const settings = {\n};', 'export const settings = { volume: 1 };'));
    const node = join(project, 'nodes', 'readSetting.ts');
    await writeFile(node, (await readFile(node, 'utf8')).replace('export function readSetting() {\n}', 'import { settings } from "@graph";\nexport function readSetting(key: keyof typeof settings) { return settings[key]; }'));
    const start = join(project, 'nodes', 'main.ts');
    await writeFile(start, '"graphscript:program";\nimport { readSetting } from "@graph";\nconsole.log(readSetting("volume"));\n');
    const valid = run(project, 'build', '--language', 'javascript');
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(valid.stderr, /analyzer warning/);
    const execution = spawnSync(process.execPath, [join(project, 'dist', 'main.mjs')], { encoding: 'utf8' });
    assert.equal(execution.status, 0, execution.stderr);
    assert.equal(execution.stdout, '1\n');
    await rm(join(project, 'dist'), { recursive: true });
    await writeFile(start, '"graphscript:program";\nconst value: number = "wrong";\n');
    const invalid = run(project, 'build', '--language', 'javascript');
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /TS2322/);
    await assert.rejects(readdir(join(project, 'dist')), { code: 'ENOENT' });
    await writeFile(start, '"graphscript:program";\nimport { readSetting } from "@graph";\nconsole.log(readSetting("volume"));\n');
    await writeFile(state, (await readFile(state, 'utf8')).replace('export const settings', 'const forbidden = 1;\nexport const settings'));
    const invalidNode = run(project, 'build', '--language', 'javascript');
    assert.notEqual(invalidNode.status, 0);
    assert.match(invalidNode.stderr, /private top-level runtime/);
    await assert.rejects(readdir(join(project, 'dist')), { code: 'ENOENT' });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('builds program nodes as a library without running the program-start file', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    assert.equal(run(project, 'create', 'function', 'unreachable').status, 0);
    assert.equal(run(project, 'create', 'function', 'reachable').status, 0);
    const start = join(project, 'nodes', 'main.ts');
    const source = '"graphscript:program";\nimport { reachable } from "@graph";\nreachable();\nconsole.log("PROGRAM STARTED");\nthrow new Error("program started");\n';
    await writeFile(start, source);
    const result = run(project, 'build', '--library');
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /PROGRAM STARTED/);
    assert.equal(await readFile(start, 'utf8'), source);
    assert.ok(!(await readdir(join(project, 'dist'))).includes('main.mjs'));
    const consumer = spawnSync(process.execPath, ['--input-type=module', '-e',
      `const first = await import(${JSON.stringify(pathToFileURL(join(project, 'dist', 'unreachable.mjs')).href)}); const second = await import(${JSON.stringify(pathToFileURL(join(project, 'dist', 'reachable.mjs')).href)}); process.stdout.write([typeof first.unreachable, typeof second.reachable].join(','));`], { encoding: 'utf8' });
    assert.equal(consumer.status, 0, consumer.stderr);
    assert.equal(consumer.stdout, 'function,function');
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('buildLibrary emits TypeScript nodes from a program with a renamed start file', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    await rename(join(project, 'nodes', 'main.ts'), join(project, 'nodes', 'start.ts'));
    assert.equal(run(project, 'create', 'function', 'main').status, 0);
    const start = join(project, 'nodes', 'start.ts');
    const source = '"graphscript:program";\nthrow new Error("program started");\n';
    await writeFile(start, source);
    const { buildLibrary } = require('../src/build.js');
    const result = buildLibrary(project, { language: 'typescript' });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.equal(await readFile(start, 'utf8'), source);
    assert.ok(!(await readdir(join(project, 'dist'))).includes('start.mts'));
    const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
    const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
      '--module', 'nodenext', '--outDir', join(project, 'compiled'), join(project, 'dist', 'index.mts')], { encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const consumer = spawnSync(process.execPath, ['--input-type=module', '-e',
      `const nodes = await import(${JSON.stringify(pathToFileURL(join(project, 'compiled', 'index.mjs')).href)}); process.stdout.write(typeof nodes.main);`], { encoding: 'utf8' });
    assert.equal(consumer.status, 0, consumer.stderr);
    assert.equal(consumer.stdout, 'function');
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('builds executable TypeScript library modules with shared exports', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    for (const [kind, name] of [['state', 'settings'], ['function', 'increment'], ['class', 'Reader']]) {
      assert.equal(run(project, 'create', kind, name).status, 0);
    }
    for (const [name, declaration] of Object.entries({
      settings: 'export const settings = { count: 0 };\nsettings.count++;',
      increment: "import { settings } from '@graph';\nexport function increment(amount: number): number { return settings.count += amount; }",
      Reader: "import { settings, increment } from '@graph';\nexport class Reader { read() { return settings; } increment() { return increment(1); } }",
    })) {
      const file = join(project, 'nodes', `${name}.ts`);
      const source = await readFile(file, 'utf8');
      await writeFile(file, source.slice(0, source.indexOf('export ')) + declaration + '\n');
    }
    const { buildLibrary } = require('../src/build.js');
    const result = buildLibrary(project, { language: 'typescript' });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const output = join(project, 'dist');
    assert.match(await readFile(join(output, 'increment.mts'), 'utf8'), /amount: number/);
    const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
    const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
      '--module', 'nodenext', '--outDir', join(project, 'compiled'), join(output, 'index.mts')], { encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const { Reader, settings, increment } = await import(join(project, 'compiled', 'index.mjs'));
    const reader = new Reader();
    assert.strictEqual(reader.read(), settings);
    assert.equal(settings.count, 1);
    assert.equal(reader.increment(), 2);
    assert.equal(increment(2), 4);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('ordinary JavaScript and TypeScript consumers import named nodes from the library package root', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    const sourceManifest = JSON.stringify({ name: 'sample-library', version: '1.2.3', license: 'MIT', type: 'commonjs',
      dependencies: { 'example-package': '^1.0.0' }, peerDependencies: { 'peer-package': '^2.0.0' },
      description: 'Sample library' }, null, 2) + '\n';
    await writeFile(join(project, 'package.json'), sourceManifest);
    for (const [kind, name] of [['state', 'settings'], ['function', 'index'], ['class', 'Reader'], ['function', 'makeReader'], ['function', 'helperValue']]) {
      assert.equal(run(project, 'create', kind, name).status, 0);
    }
    const external = join(project, 'node_modules', 'example-package');
    await mkdir(external, { recursive: true });
    await writeFile(join(external, 'package.json'), JSON.stringify({ name: 'example-package', main: 'index.js', types: 'index.d.ts' }));
    await writeFile(join(external, 'index.js'), 'exports.value = 5;');
    await writeFile(join(external, 'index.d.ts'), 'export declare const value: number;');
    for (const [name, declaration] of Object.entries({
      settings: 'export const settings = { count: 1 };',
      index: "import { settings } from '@graph';\nexport function index(amount: number): number { return settings.count += amount; }",
      Reader: "import { settings } from '@graph';\nexport class Reader { read() { return settings.count; } state() { return settings; } typedState(): typeof import('@graph').settings { return settings; } }",
      makeReader: "import { Reader } from '@graph';\nexport function makeReader() { return new Reader(); }",
      helperValue: "import { value } from 'example-package';\nexport function helperValue(): typeof import('example-package').value { return value; }",
    })) {
      const file = join(project, 'nodes', `${name}.ts`);
      const source = await readFile(file, 'utf8');
      await writeFile(file, source.slice(0, source.indexOf('export ')) + declaration + '\n');
    }
    const result = run(project, 'build', '--library');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(join(project, 'package.json'), 'utf8'), sourceManifest);
    const outputManifest = JSON.parse(await readFile(join(project, 'dist', 'package.json'), 'utf8'));
    for (const [key, value] of Object.entries(JSON.parse(sourceManifest))) assert.deepEqual(outputManifest[key], value);
    const consumer = join(project, 'consumer');
    await mkdir(join(consumer, 'node_modules'), { recursive: true });
    const installed = join(consumer, 'node_modules', 'sample-library');
    await cp(join(project, 'dist'), installed, { recursive: true });
    await cp(external, join(consumer, 'node_modules', 'example-package'), { recursive: true });
    await rename(join(project, 'nodes'), join(project, 'saved-nodes'));
    const script = join(consumer, 'consumer.mjs');
    await writeFile(script, "import { index, Reader, settings, helperValue } from 'sample-library';\nif (index(2) !== 3 || new Reader().read() !== 3 || settings.count !== 3 || helperValue() !== 5) throw new Error('bad exports');\n");
    const executed = spawnSync(process.execPath, [script], { cwd: consumer, encoding: 'utf8' });
    assert.equal(executed.status, 0, executed.stderr);
    const typescript = join(consumer, 'consumer.mts');
    await writeFile(typescript, "import { index, Reader, makeReader, settings, helperValue } from 'sample-library';\nconst reader: Reader = makeReader();\nconst state: typeof settings = reader.state();\nconst count: number = index(2) + new Reader().read() + reader.read() + state.count + new Reader().typedState().count + settings.count + helperValue();\n// @ts-expect-error\nindex('wrong');\n// @ts-expect-error\nconst wrongReader: string = makeReader();\n// @ts-expect-error\nconst wrong: string = new Reader().state().count;\nvoid count; void wrongReader; void wrong;\n");
    const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
    const checked = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--noEmit', '--target', 'es2022',
      '--module', 'nodenext', typescript], { cwd: consumer, encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    await rename(join(project, 'saved-nodes'), join(project, 'nodes'));
    const typescriptBuild = run(project, 'build', '--library', '--language', 'typescript');
    assert.equal(typescriptBuild.status, 0, typescriptBuild.stderr);
    await rm(installed, { recursive: true });
    await cp(join(project, 'dist'), installed, { recursive: true });
    await rename(join(project, 'nodes'), join(project, 'saved-nodes'));
    const checkedTypeScriptOutput = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--noEmit',
      '--target', 'es2022', '--module', 'nodenext', typescript], { cwd: consumer, encoding: 'utf8' });
    assert.equal(checkedTypeScriptOutput.status, 0, checkedTypeScriptOutput.stdout + checkedTypeScriptOutput.stderr);
    const compiledOutput = join(project, 'publish');
    await cp(installed, compiledOutput, { recursive: true });
    const sources = (await readdir(compiledOutput)).filter(file => file.endsWith('.mts') && !file.endsWith('.d.mts'))
      .map(file => join(compiledOutput, file));
    const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
      '--module', 'nodenext', '--outDir', compiledOutput, ...sources], { cwd: consumer, encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    await Promise.all(sources.map(source => rm(source)));
    await rm(installed, { recursive: true });
    await cp(compiledOutput, installed, { recursive: true });
    const checkedCompiledOutput = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--noEmit',
      '--target', 'es2022', '--module', 'nodenext', typescript], { cwd: consumer, encoding: 'utf8' });
    assert.equal(checkedCompiledOutput.status, 0, checkedCompiledOutput.stdout + checkedCompiledOutput.stderr);
    const executedTypeScriptOutput = spawnSync(process.execPath, [script], { cwd: consumer, encoding: 'utf8' });
    assert.equal(executedTypeScriptOutput.status, 0, executedTypeScriptOutput.stderr);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('library builds reject conflicting package root metadata without changing the source', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'greet').status, 0);
    assert.equal(run(project, 'build', '--library').status, 0);
    const outputManifest = await readFile(join(project, 'dist', 'package.json'), 'utf8');
    const sourceManifest = JSON.stringify({ name: 'sample-library', exports: { '.': './other.mjs' } }) + '\n';
    await writeFile(join(project, 'package.json'), sourceManifest);
    const result = run(project, 'build', '--library');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /conflict.*exports/i);
    assert.equal(await readFile(join(project, 'package.json'), 'utf8'), sourceManifest);
    assert.equal(await readFile(join(project, 'dist', 'package.json'), 'utf8'), outputManifest);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('library builds preserve compatible authored package entry metadata', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'greet').status, 0);
    const metadata = { type: 'module', exports: { '.': { types: './index.d.mts', import: './index.mjs', default: './index.mjs' },
      './greet': './greet.mjs' } };
    await writeFile(join(project, 'package.json'), JSON.stringify(metadata));
    const result = run(project, 'build', '--library');
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(await readFile(join(project, 'dist', 'package.json'), 'utf8'));
    assert.deepEqual(output.exports, metadata.exports);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('library builds reject conflicting legacy package entry paths', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'greet').status, 0);
    for (const [field, value] of [['main', './old.js'], ['types', './old.d.ts']]) {
      const sourceManifest = JSON.stringify({ [field]: value }) + '\n';
      await writeFile(join(project, 'package.json'), sourceManifest);
      const result = run(project, 'build', '--library');
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, new RegExp(`conflict.*${field}`, 'i'));
      assert.equal(await readFile(join(project, 'package.json'), 'utf8'), sourceManifest);
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('installed library resolves its declared runtime dependency without installing development tools', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'greet').status, 0);
    const dependency = join(project, 'dependency');
    await mkdir(dependency);
    await writeFile(join(dependency, 'package.json'), JSON.stringify({ name: 'local-runtime-package', version: '1.0.0',
      main: 'index.js', types: 'index.d.ts' }));
    await writeFile(join(dependency, 'index.js'), 'exports.value = 42;\n');
    await writeFile(join(dependency, 'index.d.ts'), 'export declare const value: number;\n');
    const packed = spawnSync('npm', ['pack', '--ignore-scripts', '--pack-destination', project], { cwd: dependency, encoding: 'utf8' });
    assert.equal(packed.status, 0, packed.stderr);
    const archive = join(project, packed.stdout.trim());
    const peer = join(project, 'peer');
    await mkdir(peer);
    await writeFile(join(peer, 'package.json'), JSON.stringify({ name: 'local-peer-package', version: '1.0.0',
      main: 'index.js', types: 'index.d.ts' }));
    await writeFile(join(peer, 'index.js'), 'exports.value = 10;\n');
    await writeFile(join(peer, 'index.d.ts'), 'export declare const value: number;\n');
    const packedPeer = spawnSync('npm', ['pack', '--ignore-scripts', '--pack-destination', project], { cwd: peer, encoding: 'utf8' });
    assert.equal(packedPeer.status, 0, packedPeer.stderr);
    const developmentTool = join(project, 'development-tool');
    await mkdir(developmentTool);
    await writeFile(join(developmentTool, 'package.json'), JSON.stringify({ name: '@arcmantle/graphscript', version: '1.0.0' }));
    const metadata = { name: 'sample-library', version: '1.0.0', dependencies: { 'local-runtime-package': `file:${archive}` },
      peerDependencies: { 'local-peer-package': `file:${join(project, packedPeer.stdout.trim())}` },
      devDependencies: { '@arcmantle/graphscript': `file:${developmentTool}` } };
    await writeFile(join(project, 'package.json'), JSON.stringify(metadata));
    await mkdir(join(project, 'node_modules'), { recursive: true });
    await cp(dependency, join(project, 'node_modules', 'local-runtime-package'), { recursive: true });
    await cp(peer, join(project, 'node_modules', 'local-peer-package'), { recursive: true });
    const node = join(project, 'nodes', 'greet.ts');
    const source = await readFile(node, 'utf8');
    await writeFile(node, source.slice(0, source.indexOf('export '))
      + "import { value } from 'local-runtime-package';\nimport { value as peerValue } from 'local-peer-package';\nexport function greet() { return value + peerValue; }\n");
    const built = run(project, 'build', '--library');
    assert.equal(built.status, 0, built.stderr);
    const consumer = join(project, 'consumer');
    await mkdir(consumer);
    await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true }));
    const installed = spawnSync('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--install-links', join(project, 'dist')],
      { cwd: consumer, encoding: 'utf8' });
    assert.equal(installed.status, 0, installed.stderr);
    await rename(join(project, 'node_modules'), join(project, 'saved-node-modules'));
    const executed = spawnSync(process.execPath, ['--input-type=module', '-e',
      "import { greet } from 'sample-library'; if (greet() !== 52) throw new Error('bad dependency');"],
    { cwd: consumer, encoding: 'utf8' });
    assert.equal(executed.status, 0, executed.stderr);
    await assert.rejects(readFile(join(consumer, 'node_modules', '@arcmantle', 'graphscript', 'package.json')), { code: 'ENOENT' });
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('nonliteral imports do not load unrelated graph nodes until requested', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    for (const name of ['load', 'unrelated']) assert.equal(run(project, 'create', 'function', name).status, 0);
    for (const [name, declaration] of Object.entries({
      load: 'export async function load(specifier: string) { return import(specifier); }',
      unrelated: 'export function unrelated() {}\nObject.assign(globalThis, { unrelatedLoaded: true });',
    })) {
      const file = join(project, 'nodes', `${name}.ts`);
      const source = await readFile(file, 'utf8');
      await writeFile(file, source.slice(0, source.indexOf('export ')) + declaration + '\n');
    }
    const result = run(project, 'build', '--library');
    assert.equal(result.status, 0, result.stderr);
    const runtime = spawnSync(process.execPath, ['--input-type=module', '-e', `
      const { load } = await import(${JSON.stringify(pathToFileURL(join(project, 'dist', 'load.mjs')).href)});
      if (globalThis.unrelatedLoaded) throw new Error('loaded before import call');
      await load('node:path');
      if (globalThis.unrelatedLoaded) throw new Error('loaded for external import');
      await load('@graph');
      if (!globalThis.unrelatedLoaded) throw new Error('graph import did not load nodes');
    `], { encoding: 'utf8' });
    assert.equal(runtime.status, 0, runtime.stderr);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('rebuild does not modify another file through a hard-linked output', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'greet').status, 0);
    assert.equal(run(project, 'build', '--library').status, 0);
    const output = join(project, 'dist', 'greet.mjs');
    const other = join(project, 'other.mjs');
    await link(output, other);
    const original = await readFile(other, 'utf8');
    const node = join(project, 'nodes', 'greet.ts');
    await writeFile(node, (await readFile(node, 'utf8')).replace('greet() {', 'greet() { return 42;'));
    const result = run(project, 'build', '--library');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Build output was modified/);
    assert.equal(await readFile(other, 'utf8'), original);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('rejects a linked helper output directory on rebuild', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'load').status, 0);
    await mkdir(join(project, 'nodes', 'helper'));
    await writeFile(join(project, 'nodes', 'helper', 'index.js'), 'exports.value = 7;');
    await writeFile(join(project, 'nodes', 'helper', 'index.d.ts'), 'export declare const value: number;');
    const node = join(project, 'nodes', 'load.ts');
    const source = await readFile(node, 'utf8');
    await writeFile(node, source.slice(0, source.indexOf('export ')) + "import type { value } from './helper/index.js';\nexport function load(input: typeof value) { return input; }\n");
    assert.equal(run(project, 'build', '--library').status, 0);
    const output = join(project, 'dist', '.graphscript-local');
    const outside = join(project, 'outside');
    await rename(output, outside);
    await symlink(outside, output, 'dir');
    const original = await readFile(join(outside, 'nodes', 'helper', 'index.d.ts'), 'utf8');
    const result = run(project, 'build', '--library');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Build output directory is not a directory/);
    assert.equal(await readFile(join(outside, 'nodes', 'helper', 'index.d.ts'), 'utf8'), original);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('selects the library output language on each CLI build', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'greet').status, 0);
    const file = join(project, 'nodes', 'greet.ts');
    await writeFile(file, (await readFile(file, 'utf8')).replace('greet() {', 'greet(name: string): string { return name;'));
    let result = run(project, 'build', '--library', '--language', 'typescript');
    assert.equal(result.status, 0, result.stderr);
    assert.match(await readFile(join(project, 'dist', 'greet.mts'), 'utf8'), /name: string/);
    result = run(project, 'build', '--library', '--language', 'javascript');
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(await readFile(join(project, 'dist', 'greet.mjs'), 'utf8'), /name: string/);
    assert.ok(!(await readdir(join(project, 'dist'))).includes('greet.mts'));
    result = run(project, 'build', '--library', '--language', 'other');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported output language/);
    result = run(project, 'build', '--library', '--language', 'typescript');
    assert.equal(result.status, 0, result.stderr);
    await writeFile(join(project, 'dist', 'greet.mts'), 'user changes');
    result = run(project, 'build', '--library', '--language', 'javascript');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Build output was modified/);
    assert.equal(await readFile(join(project, 'dist', 'greet.mts'), 'utf8'), 'user changes');
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('preserves TypeScript graph import forms and type-only initialization', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    for (const [kind, name] of [['state', 'settings'], ['function', 'typeTarget'], ['function', 'read'], ['function', 'load']]) {
      assert.equal(run(project, 'create', kind, name).status, 0);
    }
    for (const [name, declaration] of Object.entries({
      settings: 'export const settings = { value: 42 };',
      typeTarget: 'export function typeTarget() { return 1; }\nObject.assign(globalThis, { typeTargetLoaded: true });',
      read: "import type { typeTarget } from '@graph';\nimport { type settings } from '@graph';\ntype GraphState = typeof import('@graph').settings & typeof import('./settings.js').settings;\nexport function read(value: typeof typeTarget, state: typeof settings & GraphState) { return value() + state.value; }",
      load: "import * as graph from '@graph';\nimport { settings } from '@graph';\nexport async function load(target: string) { return graph.settings === settings && (await import('@graph')).settings === (await import(target)).settings; }",
    })) {
      const file = join(project, 'nodes', `${name}.ts`);
      const source = await readFile(file, 'utf8');
      await writeFile(file, source.slice(0, source.indexOf('export ')) + declaration + '\n');
    }
    const result = run(project, 'build', '--library', '--language', 'typescript');
    assert.equal(result.status, 0, result.stderr);
    const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
    const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
      '--module', 'nodenext', '--outDir', join(project, 'compiled'), join(project, 'dist', 'read.mts'),
      join(project, 'dist', 'load.mts')], { encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const { read } = await import(join(project, 'compiled', 'read.mjs'));
    assert.equal(read(() => 1, { value: 42 }), 43);
    assert.equal(globalThis.typeTargetLoaded, undefined);
    const { load } = await import(join(project, 'compiled', 'load.mjs'));
    assert.equal(await load('@graph'), true);
  } finally {
    delete globalThis.typeTargetLoaded;
    await rm(project, { recursive: true, force: true });
  }
});

test('preserves empty graph import evaluation in JavaScript and compiled TypeScript', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    for (const name of ['target', 'emptyCaller', 'typeCaller']) {
      assert.equal(run(project, 'create', 'function', name).status, 0);
    }
    const externalDependency = join(project, 'node_modules', 'example-package');
    await mkdir(externalDependency, { recursive: true });
    await writeFile(join(externalDependency, 'package.json'), JSON.stringify({ name: 'example-package', main: 'index.js', types: 'index.d.ts' }));
    await writeFile(join(externalDependency, 'index.js'), 'exports.value = 7;');
    await writeFile(join(externalDependency, 'index.d.ts'), 'export declare const value: number;');
    for (const [name, declaration] of Object.entries({
      target: 'export function target() {}\nObject.assign(globalThis, { graphscriptEmptyImportCount: ((globalThis as any).graphscriptEmptyImportCount ?? 0) + 1 });',
      emptyCaller: "import {} from '@graph';\nimport { value as external } from 'example-package';\nexport function emptyCaller() { return 5 + external; }",
      typeCaller: "import type {} from '@graph';\nimport type { target } from '@graph';\nimport { type target as inlineTarget } from '@graph';\nexport function typeCaller(value: typeof target & typeof inlineTarget) { return value; }",
    })) {
      const file = join(project, 'nodes', `${name}.ts`);
      const source = await readFile(file, 'utf8');
      await writeFile(file, source.slice(0, source.indexOf('export ')) + declaration + '\n');
    }
    for (const language of ['javascript', 'typescript']) {
      const result = run(project, 'build', '--library', '--language', language);
      assert.equal(result.status, 0, result.stderr);
      let output = join(project, 'dist');
      if (language === 'typescript') {
        const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
        output = join(project, 'compiled');
        const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
          '--module', 'nodenext', '--outDir', output, join(project, 'dist', 'emptyCaller.mts'),
          join(project, 'dist', 'typeCaller.mts')], { encoding: 'utf8' });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
      }
      const runtime = spawnSync(process.execPath, ['--input-type=module', '-e', `
        await import(${JSON.stringify(pathToFileURL(join(output, 'typeCaller.mjs')).href)});
        const before = globalThis.graphscriptEmptyImportCount ?? 0;
        const { emptyCaller } = await import(${JSON.stringify(pathToFileURL(join(output, 'emptyCaller.mjs')).href)});
        const afterEmptyImport = globalThis.graphscriptEmptyImportCount ?? 0;
        await import(${JSON.stringify(pathToFileURL(join(output, 'target.mjs')).href)});
        process.stdout.write(JSON.stringify([before, afterEmptyImport, globalThis.graphscriptEmptyImportCount ?? 0, emptyCaller()]));
      `], { encoding: 'utf8' });
      assert.equal(runtime.status, 0, runtime.stderr);
      assert.deepEqual(JSON.parse(runtime.stdout), [0, 1, 1, 12], language);
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('compiles TypeScript output with external require imports', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'load').status, 0);
    const dependency = join(project, 'node_modules', 'example-package');
    await mkdir(dependency, { recursive: true });
    await symlink(resolve('node_modules/@types'), join(project, 'node_modules', '@types'), 'dir');
    await writeFile(join(dependency, 'package.json'), JSON.stringify({ name: 'example-package', main: 'index.js', types: 'index.d.ts' }));
    await writeFile(join(dependency, 'index.js'), 'exports.value = 7;');
    await writeFile(join(dependency, 'index.d.ts'), 'export declare const value: number;');
    const file = join(project, 'nodes', 'load.ts');
    const source = await readFile(file, 'utf8');
    await writeFile(file, source.slice(0, source.indexOf('export ')) + "declare function require(name: string): typeof import('example-package');\nexport function load(): number { return require('example-package').value; }\n");
    const result = run(project, 'build', '--library', '--language', 'typescript');
    assert.equal(result.status, 0, result.stderr);
    const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
    const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
      '--module', 'nodenext', '--types', 'node', '--outDir', join(project, 'compiled'), join(project, 'dist', 'index.mts')], { cwd: project, encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const { load } = await import(join(project, 'compiled', 'index.mjs'));
    assert.equal(load(), 7);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('emits a TypeScript entry for empty libraries and a node named index', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    let result = run(project, 'build', '--library', '--language', 'typescript');
    assert.equal(result.status, 0, result.stderr);
    const entry = join(project, 'dist', 'index.mts');
    assert.match(await readFile(entry, 'utf8'), /export/);
    const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
    let compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
      '--module', 'nodenext', '--outDir', join(project, 'compiled'), entry], { encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    assert.equal(run(project, 'create', 'function', 'index').status, 0);
    result = run(project, 'build', '--library', '--language', 'typescript');
    assert.equal(result.status, 0, result.stderr);
    compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
      '--module', 'nodenext', '--outDir', join(project, 'compiled'), entry], { encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    const library = await import(join(project, 'compiled', 'index.mjs'));
    assert.equal(typeof library.index, 'function');
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('shares graph node exports and runs setup once on first load', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    for (const [kind, name] of [['state', 'settings'], ['function', 'increment'], ['class', 'Reader'], ['function', 'untouched']]) {
      assert.equal(run(project, 'create', kind, name).status, 0);
    }
    for (const [name, declaration] of Object.entries({
      settings: 'export const settings = { count: 0 };\nsettings.count++;',
      increment: "import { settings as shared } from '@graph';\nexport function increment() { return ++shared.count; }",
      Reader: "import { settings, increment } from '@graph';\nexport class Reader { read() { return settings; } increment() { return increment(); } }",
      untouched: 'export function untouched() {}\nthrow new Error("loaded too early");',
    })) {
      const file = join(project, 'nodes', `${name}.ts`);
      const source = await readFile(file, 'utf8');
      await writeFile(file, source.slice(0, source.indexOf('export ')) + '// \u{1f600}\n' + declaration + '\n');
    }
    const result = run(project, 'build', '--library');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual((await readdir(join(project, 'dist'))).filter(name => name.endsWith('.mjs')).sort(), ['Reader.mjs', 'increment.mjs', 'index.mjs', 'settings.mjs', 'untouched.mjs']);
    const { Reader } = await import(join(project, 'dist', 'Reader.mjs'));
    const { settings } = await import(join(project, 'dist', 'settings.mjs'));
    const { increment } = await import(join(project, 'dist', 'increment.mjs'));
    const reader = new Reader();
    assert.strictEqual(reader.read(), settings);
    assert.equal(settings.count, 1);
    assert.equal(reader.increment(), 2);
    assert.equal(increment(), 3);
    const freshRuntime = spawnSync(process.execPath, ['--input-type=module', '-e',
      `const module = await import(${JSON.stringify(pathToFileURL(join(project, 'dist', 'settings.mjs')).href)}); process.stdout.write(String(module.settings.count));`], { encoding: 'utf8' });
    assert.equal(freshRuntime.status, 0, freshRuntime.stderr);
    assert.equal(freshRuntime.stdout.trim(), '1');
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('does not initialize graph nodes imported only for types', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    for (const name of ['typeTarget', 'inlineTarget', 'typeCaller', 'inlineCaller']) {
      assert.equal(run(project, 'create', 'function', name).status, 0);
    }
    for (const [name, declaration] of Object.entries({
      typeTarget: 'export function typeTarget() { return 1; }\nObject.assign(globalThis, { graphscriptTypeTargetInitialized: true });',
      inlineTarget: 'export function inlineTarget() { return 2; }\nObject.assign(globalThis, { graphscriptInlineTargetInitialized: true });',
      typeCaller: "import type { typeTarget } from '@graph';\nexport function typeCaller(value: typeof typeTarget) { return value(); }",
      inlineCaller: "import { type inlineTarget } from '@graph';\nexport function inlineCaller(value: typeof inlineTarget) { return value(); }",
    })) {
      const file = join(project, 'nodes', `${name}.ts`);
      const source = await readFile(file, 'utf8');
      await writeFile(file, source.slice(0, source.indexOf('export ')) + declaration + '\n');
    }
    const result = run(project, 'build', '--library');
    assert.equal(result.status, 0, result.stderr);
    const { typeCaller } = await import(join(project, 'dist', 'typeCaller.mjs'));
    const { inlineCaller } = await import(join(project, 'dist', 'inlineCaller.mjs'));
    assert.equal(typeCaller(() => 3), 3);
    assert.equal(inlineCaller(() => 4), 4);
    assert.equal(globalThis.graphscriptTypeTargetInitialized, undefined);
    assert.equal(globalThis.graphscriptInlineTargetInitialized, undefined);
    await import(join(project, 'dist', 'typeTarget.mjs'));
    await import(join(project, 'dist', 'inlineTarget.mjs'));
    assert.equal(globalThis.graphscriptTypeTargetInitialized, true);
    assert.equal(globalThis.graphscriptInlineTargetInitialized, true);
  } finally {
    delete globalThis.graphscriptTypeTargetInitialized;
    delete globalThis.graphscriptInlineTargetInitialized;
    await rm(project, { recursive: true, force: true });
  }
});

test('builds namespace and dynamic graph imports despite analyzer warnings', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    for (const [kind, name] of [['state', 'settings'], ['function', 'read'], ['function', 'load']]) {
      assert.equal(run(project, 'create', kind, name).status, 0);
    }
    for (const [name, declaration] of Object.entries({
      settings: 'export const settings = { value: 42 };',
      read: "import * as graph from '@graph';\nexport function read(key: keyof typeof graph) { class Local { accessor value = 1; } return graph[key]; }",
      load: "import { settings as directSettings } from '@graph';\nexport async function load() { const target: string = '@graph'; const direct = (await import('@graph')).settings; const computed = (await import(target)).settings; return direct === computed && direct === directSettings ? direct : null; }",
    })) {
      const file = join(project, 'nodes', `${name}.ts`);
      const source = await readFile(file, 'utf8');
      await writeFile(file, source.slice(0, source.indexOf('export ')) + declaration + '\n');
    }
    const { buildLibrary } = require('../src/build.js');
    const result = buildLibrary(project);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.ok(result.diagnostics.some(item => item.source === 'analyzer' && item.severity === 'warning'));
    const cliResult = run(project, 'build', '--library');
    assert.equal(cliResult.status, 0, cliResult.stderr);
    assert.match(cliResult.stderr, /analyzer warning/);
    const { read } = await import(join(project, 'dist', 'read.mjs'));
    const { load } = await import(join(project, 'dist', 'load.mjs'));
    assert.strictEqual(read('settings'), await load());
    assert.equal((await load()).value, 42);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('runs external static, dynamic, and require imports in emitted ESM', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'load').status, 0);
    const dependency = join(project, 'node_modules', 'example-package');
    await mkdir(dependency, { recursive: true });
    await writeFile(join(dependency, 'package.json'), JSON.stringify({ name: 'example-package', main: 'index.js', types: 'index.d.ts' }));
    await writeFile(join(dependency, 'index.js'), 'exports.value = 7; exports.URL = 100;');
    await writeFile(join(dependency, 'index.d.ts'), 'export declare const value: number; export declare const URL: number;');
    const file = join(project, 'nodes', 'load.ts');
    const source = await readFile(file, 'utf8');
    await writeFile(file, source.slice(0, source.indexOf('export ')) + "import { value, URL } from 'example-package';\ndeclare function require(name: string): typeof import('example-package');\nexport async function load() { let calls = 0; const path = () => { calls++; return 'example-package'; }; return value + (await import('example-package')).value + (await import(path())).value + require('example-package').value + calls + URL - 100; }\n");
    const result = run(project, 'build', '--library');
    assert.equal(result.status, 0, result.stderr);
    const { load } = await import(join(project, 'dist', 'load.mjs'));
    assert.equal(await load(), 29);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('rejects computed relative runtime imports in library output', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    await writeFile(join(project, 'package.json'), '{"type":"module"}\n');
    assert.equal(run(project, 'create', 'function', 'load').status, 0);
    const file = join(project, 'nodes', 'load.ts');
    const source = await readFile(file, 'utf8');
    await writeFile(file, source.slice(0, source.indexOf('export ')) + "declare function require(name: string): unknown;\ndeclare const module: { require(name: string): unknown };\nexport function load(path: string, mode: number) { const alias = module.require; return mode === 1 ? require(path) : mode === 2 ? module.require(path) : mode === 3 ? import(new URL(path, import.meta.url) as unknown as string) : mode === 4 ? alias(path) : mode === 5 ? module.require?.(path) : mode === 6 ? import(new globalThis.URL(path, import.meta.url) as unknown as string) : import(path); }\n");
    const consumer = join(project, 'consumer');
    for (const language of ['javascript', 'typescript']) {
      const result = run(project, 'build', '--library', '--language', language);
      assert.equal(result.status, 0, result.stderr);
      await rm(consumer, { recursive: true, force: true });
      await cp(join(project, 'dist'), consumer, { recursive: true });
      if (language === 'typescript') {
        const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
        const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
          '--module', 'nodenext', '--types', 'node', '--typeRoots', resolve('node_modules/@types'), '--outDir', consumer,
          join(consumer, 'index.mts')], { cwd: project, encoding: 'utf8' });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
      }
      await writeFile(join(consumer, 'target.mjs'), 'export const value = 42;');
      const runtime = spawnSync(process.execPath, ['--input-type=module', '-e', `
        const { createRequire } = await import('node:module');
        globalThis.module = { require: createRequire(import.meta.url) };
        const { load } = await import(${JSON.stringify(pathToFileURL(join(consumer, 'index.mjs')).href)});
        for (const mode of [0, 1, 2, 3, 4, 5, 6]) {
          let result;
          try { result = load('./helper/index.js', mode); } catch (error) {
            if (mode === 3 || mode === 6) throw new Error('URL import threw synchronously');
            if (!/relative runtime imports are not allowed/.test(error.message)) throw error;
            continue;
          }
          try { await result; throw new Error('relative import accepted'); }
          catch (error) { if (!(mode === 3 || mode === 6 ? /file: URL imports are not allowed/ : /relative runtime imports are not allowed/).test(error.message)) throw error; }
        }
        const fileUrl = ${JSON.stringify(pathToFileURL(join(consumer, 'target.mjs')).href)};
        for (const mode of [0, 1, 2, 3, 4, 5, 6]) {
          try { await load(fileUrl.replace(/^file:/, 'FiLe:'), mode); throw new Error('file URL import accepted'); }
          catch (error) { if (!/file: URL imports are not allowed/.test(error.message)) throw error; }
        }
        try { await load(new URL(fileUrl), 0); throw new Error('file URL object accepted'); }
        catch (error) { if (!/file: URL imports are not allowed/.test(error.message)) throw error; }
        let conversions = 0;
        const external = { [Symbol.toPrimitive](hint) { if (hint !== 'string') throw new Error('wrong coercion'); conversions++; return 'data:text/javascript,export default 42'; } };
        if ((await load(external, 0)).default !== 42 || conversions !== 1) throw new Error('dynamic import coercion changed');
        if ((await load('data:text/javascript,export default 42', 3)).default !== 42) throw new Error('non-file URL import changed');
        const failing = { [Symbol.toPrimitive]() { throw new Error('coercion failure'); } };
        let promise;
        try { promise = load(failing, 0); } catch { throw new Error('dynamic import threw synchronously'); }
        try { await promise; throw new Error('coercion accepted'); }
        catch (error) { if (error.message !== 'coercion failure') throw error; }
      `], { encoding: 'utf8' });
      assert.equal(runtime.status, 0, runtime.stderr);
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('dynamic library imports preserve a locally shadowed Symbol', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'load').status, 0);
    const file = join(project, 'nodes', 'load.ts');
    const source = await readFile(file, 'utf8');
    await writeFile(file, source.slice(0, source.indexOf('export ')) + 'export function load(path: string) { const Symbol = { toPrimitive: "local" }; void Symbol; return import(path); }\n');
    const result = run(project, 'build', '--library');
    assert.equal(result.status, 0, result.stderr);
    const { load } = await import(pathToFileURL(join(project, 'dist', 'index.mjs')).href);
    assert.equal((await load('data:text/javascript,export default 42')).default, 42);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('rejects computed relative runtime imports in JavaScript program output', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    await writeFile(join(project, 'package.json'), '{"type":"module"}\n');
    for (const expression of ['void import(path);', 'void import(new URL(path, import.meta.url) as unknown as string);',
      'void import(new globalThis.URL(path, import.meta.url) as unknown as string);',
      'declare function require(name: string): unknown;\nrequire(path);',
      'declare function require(name: string): unknown;\nconst load = require; load(path);',
      'declare const module: { require(name: string): unknown };\nmodule.require(path);',
      'declare const module: { require(name: string): unknown };\nconst load = module.require; load(path);']) {
      await writeFile(join(project, 'nodes', 'main.ts'), `"graphscript:program";\nconst path: string = "./helper.js";\n${expression}\n`);
      const result = run(project, 'build', '--language', 'javascript');
      assert.equal(result.status, 0, result.stderr);
      const runtime = spawnSync(process.execPath, ['--input-type=module', '-e', `
        const { createRequire } = await import('node:module');
        globalThis.module = { require: createRequire(import.meta.url) };
        await import(${JSON.stringify(pathToFileURL(join(project, 'dist', 'main.mjs')).href)});
      `], { cwd: project, encoding: 'utf8' });
      assert.notEqual(runtime.status, 0);
      assert.match(runtime.stderr, expression.includes('URL(') ? /file: URL imports are not allowed/ : /relative runtime imports are not allowed/);
    }
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nconst path: string = "./helper.js";\nconst target = new URL(path, import.meta.url);\nvoid import(target as unknown as string);\n');
    const urlBuild = run(project, 'build', '--language', 'javascript');
    assert.equal(urlBuild.status, 0, urlBuild.stderr);
    await writeFile(join(project, 'dist', 'helper.js'), 'export const value = 42;');
    const urlRuntime = spawnSync(process.execPath, [join(project, 'dist', 'main.mjs')], { cwd: project, encoding: 'utf8' });
    assert.notEqual(urlRuntime.status, 0);
    assert.match(urlRuntime.stderr, /file: URL imports are not allowed/);
    for (const expression of ['void import(path);', 'declare function require(name: string): unknown;\nconst load = require.bind(null); load(path);']) {
      await writeFile(join(project, 'nodes', 'main.ts'), `"graphscript:program";\nconst path: string = "FiLe:///missing.mjs";\n${expression}\n`);
      const result = run(project, 'build', '--language', 'javascript');
      assert.equal(result.status, 0, result.stderr);
      const runtime = spawnSync(process.execPath, [join(project, 'dist', 'main.mjs')], { cwd: project, encoding: 'utf8' });
      assert.notEqual(runtime.status, 0);
      assert.match(runtime.stderr, /file: URL imports are not allowed/);
    }
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nlet conversions = 0;\nconst target = { [Symbol.toPrimitive](hint: string) { if (hint !== "string") throw new Error("wrong coercion"); conversions++; return "data:text/javascript,export default 42"; } };\nvoid import(target as unknown as string).then(value => console.log(value.default, conversions));\n');
    const externalBuild = run(project, 'build', '--language', 'javascript');
    assert.equal(externalBuild.status, 0, externalBuild.stderr);
    const externalRuntime = spawnSync(process.execPath, [join(project, 'dist', 'main.mjs')], { cwd: project, encoding: 'utf8' });
    assert.equal(externalRuntime.status, 0, externalRuntime.stderr);
    assert.equal(externalRuntime.stdout, '42 1\n');
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nconst target = { [Symbol.toPrimitive]() { throw new Error("coercion failure"); } };\ntry { const result = import(target as unknown as string); console.log("returned"); void result.catch(error => console.log(error.message)); } catch { console.log("threw"); }\n');
    const failingBuild = run(project, 'build', '--language', 'javascript');
    assert.equal(failingBuild.status, 0, failingBuild.stderr);
    const failingRuntime = spawnSync(process.execPath, [join(project, 'dist', 'main.mjs')], { cwd: project, encoding: 'utf8' });
    assert.equal(failingRuntime.status, 0, failingRuntime.stderr);
    assert.equal(failingRuntime.stdout, 'returned\ncoercion failure\n');
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nconst path: string = "./helper.js";\ntry { const result = import(new URL(path, import.meta.url) as unknown as string); console.log("returned"); void result.catch(error => console.log(error.message)); } catch { console.log("threw"); }\n');
    const urlPromiseBuild = run(project, 'build', '--language', 'javascript');
    assert.equal(urlPromiseBuild.status, 0, urlPromiseBuild.stderr);
    const urlPromiseRuntime = spawnSync(process.execPath, [join(project, 'dist', 'main.mjs')], { cwd: project, encoding: 'utf8' });
    assert.equal(urlPromiseRuntime.status, 0, urlPromiseRuntime.stderr);
    assert.match(urlPromiseRuntime.stdout, /^returned\nGraphScript rule error: file: URL imports are not allowed\n$/);
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nconst Symbol = { toPrimitive: "local" };\nvoid Symbol;\nconst target: string = "data:text/javascript,export default 42";\nvoid import(target).then(value => console.log(value.default));\n');
    const shadowedBuild = run(project, 'build', '--language', 'javascript');
    assert.equal(shadowedBuild.status, 0, shadowedBuild.stderr);
    const shadowedRuntime = spawnSync(process.execPath, [join(project, 'dist', 'main.mjs')], { cwd: project, encoding: 'utf8' });
    assert.equal(shadowedRuntime.status, 0, shadowedRuntime.stderr);
    assert.equal(shadowedRuntime.stdout, '42\n');
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nfunction require(name: string) { return name; }\nconsole.log(require("./not-an-import"));\n');
    const localBuild = run(project, 'build', '--language', 'javascript');
    assert.equal(localBuild.status, 0, localBuild.stderr);
    const localRuntime = spawnSync(process.execPath, [join(project, 'dist', 'main.mjs')], { cwd: project, encoding: 'utf8' });
    assert.equal(localRuntime.status, 0, localRuntime.stderr);
    assert.equal(localRuntime.stdout, './not-an-import\n');
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('rejects computed module.require paths in TypeScript program output', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--program').status, 0);
    await mkdir(join(project, 'node_modules'), { recursive: true });
    await symlink(resolve('node_modules/@types'), join(project, 'node_modules', '@types'), 'dir');
    const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
    for (const [specifier, message] of [['./helper.js', /relative runtime imports are not allowed/], ['FiLe:///missing.mjs', /file: URL imports are not allowed/]]) {
      for (const expression of ['module.require(path);', 'const alias = module.require; alias(path);', 'module.require?.(path);', 'module?.require(path);']) {
        await writeFile(join(project, 'nodes', 'main.ts'), `"graphscript:program";\ndeclare const module: { require(name: string): unknown };\nconst path: string = ${JSON.stringify(specifier)};\n${expression}\n`);
        const result = run(project, 'build', '--language', 'typescript');
        assert.equal(result.status, 0, result.stderr);
        const compiled = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--target', 'es2022',
          '--module', 'nodenext', '--types', 'node', '--outDir', join(project, 'compiled'), join(project, 'dist', 'main.mts')], { cwd: project, encoding: 'utf8' });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
        const runtime = spawnSync(process.execPath, [join(project, 'compiled', 'main.mjs')], { cwd: project, encoding: 'utf8' });
        assert.notEqual(runtime.status, 0);
        assert.match(runtime.stderr, message);
      }
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('does not emit runtime files for a type-only local dependency', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'load').status, 0);
    await mkdir(join(project, 'nodes', 'helper'));
    await writeFile(join(project, 'nodes', 'helper', 'index.d.ts'), 'export declare const value: number;');
    const file = join(project, 'nodes', 'load.ts');
    const source = await readFile(file, 'utf8');
    await writeFile(join(project, 'nodes', 'helper', 'index.js'), "require('./not-needed'); exports.value = 7;");
    await writeFile(file, source.slice(0, source.indexOf('export ')) + "import type { value } from './helper/index.js';\nexport function load(input: typeof value): typeof value { return input; }\n");
    const typeOnly = run(project, 'build', '--library');
    assert.equal(typeOnly.status, 0, typeOnly.stderr);
    await assert.rejects(readFile(join(project, 'dist', '.graphscript-local', 'nodes', 'helper', 'index.js')), { code: 'ENOENT' });
    const { load } = await import(join(project, 'dist', 'index.mjs'));
    assert.equal(load(7), 7);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('builds a type-only local package with custom declarations and no runtime entry', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'load').status, 0);
    const helper = join(project, 'nodes', 'helper');
    await mkdir(join(helper, 'types'), { recursive: true });
    await writeFile(join(helper, 'package.json'), JSON.stringify({ types: 'types/public.d.ts' }));
    await writeFile(join(helper, 'types', 'public.d.ts'), 'export interface Value { count: number }');
    const file = join(project, 'nodes', 'load.ts');
    const source = await readFile(file, 'utf8');
    await writeFile(file, source.slice(0, source.indexOf('export ')) + "import type { Value } from './helper';\nexport function load(value: Value): number { return value.count; }\n");
    const result = run(project, 'build', '--library');
    assert.equal(result.status, 0, result.stderr);
    const consumer = join(project, 'consumer');
    await mkdir(join(consumer, 'node_modules'), { recursive: true });
    await cp(join(project, 'dist'), join(consumer, 'node_modules', 'sample-library'), { recursive: true });
    await rename(join(project, 'nodes'), join(project, 'saved-nodes'));
    const entry = join(consumer, 'consumer.mts');
    await writeFile(entry, "import { load } from 'sample-library';\nconst value: number = load({ count: 7 });\nvoid value;\n");
    const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
    const checked = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--noEmit', '--target', 'es2022', '--module', 'nodenext', entry], { cwd: consumer, encoding: 'utf8' });
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('preserves custom local package type declarations for consumers', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'load').status, 0);
    const helper = join(project, 'nodes', 'helper');
    await mkdir(join(helper, 'types'), { recursive: true });
    await writeFile(join(helper, 'runtime.js'), 'exports.value = 7;');
    await writeFile(join(helper, 'types', 'public.d.ts'), 'export declare const value: number;');
    const file = join(project, 'nodes', 'load.ts');
    const source = await readFile(file, 'utf8');
    await writeFile(file, source.slice(0, source.indexOf('export ')) + "export function load(): typeof import('./helper').value { return 7; }\n");
    const consumer = join(project, 'consumer');
    await mkdir(join(consumer, 'node_modules'), { recursive: true });
    const entry = join(consumer, 'consumer.mts');
    await writeFile(entry, "import { load } from 'sample-library';\nconst value: number = load();\nvoid value;\n");
    const compiler = join(require.resolve('typescript/package.json'), '..', 'bin', 'tsc');
    for (const [field, language] of [['types', 'javascript'], ['typings', 'javascript'], ['types', 'typescript']]) {
      await writeFile(join(helper, 'package.json'), JSON.stringify({ main: 'runtime.js', [field]: 'types/public.d.ts' }));
      const result = run(project, 'build', '--library', '--language', language);
      assert.equal(result.status, 0, result.stderr);
      await rm(join(consumer, 'node_modules', 'sample-library'), { recursive: true, force: true });
      await cp(join(project, 'dist'), join(consumer, 'node_modules', 'sample-library'), { recursive: true });
      await rename(join(project, 'nodes'), join(project, 'saved-nodes'));
      const checked = spawnSync(process.execPath, [compiler, '--ignoreConfig', '--strict', '--noEmit', '--target', 'es2022', '--module', 'nodenext', '--types', 'node', '--typeRoots', resolve('node_modules/@types'), entry], { cwd: consumer, encoding: 'utf8' });
      assert.equal(checked.status, 0, checked.stdout + checked.stderr);
      if (language === 'javascript') {
        const executed = spawnSync(process.execPath, ['--input-type=module', '-e', "import { load } from 'sample-library'; if (load() !== 7) throw new Error('bad value');"], { cwd: consumer, encoding: 'utf8' });
        assert.equal(executed.status, 0, executed.stderr);
      }
      await rename(join(project, 'saved-nodes'), join(project, 'nodes'));
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('rejects compiler and GraphScript errors without emitting output', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'broken').status, 0);
    const file = join(project, 'nodes', 'broken.ts');
    const source = await readFile(file, 'utf8');
    for (const [invalid, message] of [
      [source.replace('export function broken()', 'export function broken(): number').replace('\n}', '\n  return "wrong";\n}'), /TS2322/],
      [source.replace('export function broken()', 'const forbidden = 1;\nexport function broken()'), /private top-level runtime/],
    ]) {
      await writeFile(file, invalid);
      const { buildLibrary } = require('../src/build.js');
      assert.equal(buildLibrary(project).ok, false);
      const result = run(project, 'build', '--library');
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, message);
      await assert.rejects(readdir(join(project, 'dist')), { code: 'ENOENT' });
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('rebuilds generated modules without overwriting user files', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'greet').status, 0);
    const file = join(project, 'nodes', 'greet.ts');
    const source = await readFile(file, 'utf8');
    await writeFile(file, source.replace('export function greet() {\n}', 'export function greet() { return 1; }'));
    assert.equal(run(project, 'build', '--library').status, 0);
    await writeFile(join(project, 'dist', 'notes.txt'), 'user content');
    await writeFile(file, source.replace('export function greet() {\n}', 'export function greet() { return 2; }'));
    const result = run(project, 'build', '--library');
    assert.equal(result.status, 0, result.stderr);
    const module = await import(join(project, 'dist', 'greet.mjs'));
    assert.equal(module.greet(), 2);
    assert.equal(await readFile(join(project, 'dist', 'notes.txt'), 'utf8'), 'user content');
    await writeFile(join(project, 'dist', 'greet.mjs'), 'user changes');
    const conflict = run(project, 'build', '--library');
    assert.notEqual(conflict.status, 0);
    assert.match(conflict.stderr, /Build output was modified/);
    assert.equal(await readFile(join(project, 'dist', 'greet.mjs'), 'utf8'), 'user changes');
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('returns a source-located warning for an unresolved state property', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'state', 'settings').status, 0);
    assert.equal(run(project, 'create', 'function', 'readSetting').status, 0);
    const state = join(project, 'nodes', 'settings.ts');
    await writeFile(state, (await readFile(state, 'utf8')).replace('export const settings = {\n};', 'export const settings = { volume: 1 };'));
    const file = join(project, 'nodes', 'readSetting.ts');
    await writeFile(file, (await readFile(file, 'utf8')).replace('export function readSetting() {\n}', "import { settings } from '@graph';\nexport function readSetting(key: keyof typeof settings) { return settings[key]; }"));
    const { checkProject } = require('../src/check.js');
    const result = checkProject(project);
    assert.equal(result.ok, true);
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.severity === 'warning' && diagnostic.source === 'analyzer'
      && diagnostic.file === file && diagnostic.line === 5 && diagnostic.column > 0));
    const cliResult = run(project, 'check');
    assert.equal(cliResult.status, 0);
    assert.match(cliResult.stdout + cliResult.stderr, /readSetting\.ts\(5,\d+\): analyzer warning/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('shares compiler diagnostics between check callers and the CLI', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'broken').status, 0);
    const file = join(project, 'nodes', 'broken.ts');
    await writeFile(file, (await readFile(file, 'utf8')).replace('export function broken() {\n}', 'export function broken(): number { return "wrong"; }'));
    const { checkProject } = require('../src/check.js');
    const result = checkProject(project);
    const diagnostic = result.diagnostics.find(item => item.source === 'typescript' && item.code === 2322);
    assert.equal(result.ok, false);
    assert.equal(diagnostic.file, file);
    assert.equal(diagnostic.line, 4);
    assert.ok(diagnostic.column > 0);
    const cliResult = run(project, 'check');
    assert.notEqual(cliResult.status, 0);
    assert.match(cliResult.stdout + cliResult.stderr, /TS2322/);
    assert.match(cliResult.stdout + cliResult.stderr, /broken\.ts\(4,/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('warns for dynamic graph namespace access but not unused or type-only imports', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    for (const name of ['target', 'caller', 'unused']) assert.equal(run(project, 'create', 'function', name).status, 0);
    const caller = join(project, 'nodes', 'caller.ts');
    await writeFile(caller, (await readFile(caller, 'utf8')).replace('export function caller() {\n}', "import * as graph from '@graph';\nexport function caller(key: keyof typeof graph) { return graph[key]; }"));
    const unused = join(project, 'nodes', 'unused.ts');
    await writeFile(unused, (await readFile(unused, 'utf8')).replace('export function unused() {\n}', "import { target } from '@graph';\nimport type * as graph from '@graph';\nexport function unused(value: typeof graph.target) { return value; }"));
    const { checkProject } = require('../src/check.js');
    const result = checkProject(project);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.diagnostics.filter(item => item.source === 'analyzer').map(({ file, line }) => ({ file, line })), [{ file: caller, line: 5 }]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('checks standard TypeScript syntax and external import forms', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'load').status, 0);
    const dependency = join(project, 'node_modules', 'example-package');
    await mkdir(dependency, { recursive: true });
    await writeFile(join(dependency, 'package.json'), JSON.stringify({ name: 'example-package', types: 'index.d.ts', main: 'index.js' }));
    await writeFile(join(dependency, 'index.d.ts'), 'export declare const value: number;');
    const file = join(project, 'nodes', 'load.ts');
    await writeFile(file, (await readFile(file, 'utf8')).replace('export function load() {\n}', "import { value } from 'example-package';\ndeclare function require(name: string): typeof import('example-package');\ntype Result<T> = T extends number ? { value: T } : never;\nexport async function load<T extends number>(input: T): Promise<Result<T>> { const dynamic = await import('example-package'); const common = require('example-package'); const result = { value: input } satisfies { value: number }; return { value: (result.value + value + dynamic.value + common.value) as T } as Result<T>; }"));
    const { checkProject } = require('../src/check.js');
    const result = checkProject(project);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.diagnostics, []);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('accepts standard class decorators', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'class', 'Example').status, 0);
    const file = join(project, 'nodes', 'Example.ts');
    await writeFile(file, (await readFile(file, 'utf8')).replace('export class Example', 'declare function sealed(value: Function, context: ClassDecoratorContext): void;\n@sealed\nexport class Example'));
    const { checkProject } = require('../src/check.js');
    const result = checkProject(project);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('accepts parenthesized state object initializers', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'state', 'settings').status, 0);
    const file = join(project, 'nodes', 'settings.ts');
    await writeFile(file, (await readFile(file, 'utf8')).replace('export const settings = {\n};', 'export const settings = (({ value: 1 } as const));'));
    const { checkProject } = require('../src/check.js');
    const result = checkProject(project);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('warns when state or a dynamic graph import escapes analysis', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'state', 'settings').status, 0);
    assert.equal(run(project, 'create', 'function', 'caller').status, 0);
    const file = join(project, 'nodes', 'caller.ts');
    await writeFile(file, (await readFile(file, 'utf8')).replace('export function caller() {\n}', "import { settings } from '@graph';\nexport function caller() { return [settings, import('@graph')]; }"));
    const { checkProject } = require('../src/check.js');
    const result = checkProject(project);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.equal(result.diagnostics.filter(item => item.source === 'analyzer' && item.file === file && item.line === 5).length, 2);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('locates rule failures and reports invalid syntax as a compiler error', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'broken').status, 0);
    const file = join(project, 'nodes', 'broken.ts');
    const original = await readFile(file, 'utf8');
    const { checkProject } = require('../src/check.js');
    await writeFile(file, original.replace('export function broken()', 'const forbidden = 1;\nexport function broken()'));
    const rule = checkProject(project);
    assert.equal(rule.ok, false);
    assert.ok(rule.diagnostics.some(item => item.source === 'graphscript' && item.file === file && item.line === 4 && item.column === 1));
    await writeFile(file, original.replace('export function broken()', 'export function broken('));
    const syntax = checkProject(project);
    assert.equal(syntax.ok, false);
    assert.ok(syntax.diagnostics.some(item => item.source === 'typescript' && item.file === file && item.line === 4));
    assert.ok(!syntax.diagnostics.some(item => item.source === 'graphscript' && /parse|syntax/i.test(item.message)));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('enforces each managed-node rule when the analyzer cannot parse a file', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'example').status, 0);
    const file = join(project, 'nodes', 'example.ts');
    const original = (await readFile(file, 'utf8')).replace('export function example() {\n}', 'export function example() { class Local { accessor value = 1; } return Local; }');
    const { checkProject } = require('../src/check.js');
    for (const [source, rule] of [
      [original.replace('"graphscript:function";', '"graphscript:other";'), /directive/],
      [original.replace('"graphscript:function";', '"graphscript:function";\n"graphscript:state";'), /directive/],
      [original.replace('export function example()', 'export function wrong()'), /filename/],
      [original + '\nexport type Extra = number;\n', /export/],
      [original.replace('export function example()', 'const forbidden = 1;\nexport function example()'), /runtime/],
    ]) {
      await writeFile(file, source);
      const result = checkProject(project);
      assert.equal(result.ok, false, JSON.stringify(result.diagnostics));
      assert.ok(result.diagnostics.some(item => item.source === 'graphscript' && rule.test(item.message)
        && item.file === file && item.line > 0 && item.column > 0), JSON.stringify(result.diagnostics));
      assert.ok(!result.diagnostics.some(item => item.source === 'typescript' && item.severity === 'error'), JSON.stringify(result.diagnostics));
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('indexes and validates identities when the analyzer rejects valid TypeScript', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    for (const name of ['target', 'caller']) assert.equal(run(project, 'create', 'function', name).status, 0);
    const target = join(project, 'nodes', 'target.ts');
    const original = (await readFile(target, 'utf8')).replace('export function target() {\n}', 'export function target() { class Local { accessor value = 1; } return Local; }');
    await writeFile(target, original);
    const caller = join(project, 'nodes', 'caller.ts');
    await writeFile(caller, (await readFile(caller, 'utf8')).replace('export function caller()', "import { target } from '@graph';\nexport function caller()"));
    const { checkProject } = require('../src/check.js');
    const valid = checkProject(project);
    assert.equal(valid.ok, true, JSON.stringify(valid.diagnostics));
    assert.ok(valid.diagnostics.some(item => item.source === 'analyzer' && item.file === target));
    await writeFile(target, original.replace(/\/\/ graphscript:id [^\n]+/, '   // graphscript:id invalid'));
    const invalid = checkProject(project);
    assert.equal(invalid.ok, false, JSON.stringify(invalid.diagnostics));
    assert.ok(invalid.diagnostics.some(item => item.source === 'graphscript' && /identity/.test(item.message)
      && item.file === target && item.line === 2 && item.column === 4));
    const callerId = (await readFile(caller, 'utf8')).match(/graphscript:id ([0-9a-f-]+)/)[1];
    for (const [source, message, line, column] of [
      [original.replace(/\/\/ graphscript:id [^\n]+\n/, ''), /expected one valid node ID/, 1, 1],
      [original.replace(/\/\/ graphscript:id [^\n]+/, `   // graphscript:id ${callerId}`), /duplicate node ID/, 2, 4],
    ]) {
      await writeFile(target, source);
      const result = checkProject(project);
      assert.equal(result.ok, false, JSON.stringify(result.diagnostics));
      assert.ok(result.diagnostics.some(item => item.source === 'graphscript' && message.test(item.message)
        && item.file === target && item.line === line && item.column === column), JSON.stringify(result.diagnostics));
      assert.ok(result.diagnostics.some(item => item.source === 'analyzer' && item.file === target), JSON.stringify(result.diagnostics));
      assert.ok(!result.diagnostics.some(item => item.source === 'typescript' && item.severity === 'error'), JSON.stringify(result.diagnostics));
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('checks class and state rules when the analyzer cannot parse a file', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    const { checkProject } = require('../src/check.js');
    for (const [kind, name, declaration, invalid, rule] of [
      ['class', 'Example', 'export class Example { accessor value = 1; }', 'export class Wrong { accessor value = 1; }', /filename/],
      ['state', 'settings', 'export const settings = { method() { class Local { accessor value = 1; } return Local; } };',
        'export const settings = 1, extra = { method() { class Local { accessor value = 1; } return Local; } };', /export/],
    ]) {
      assert.equal(run(project, 'create', kind, name).status, 0);
      const file = join(project, 'nodes', `${name}.ts`);
      const original = await readFile(file, 'utf8');
      const prefix = original.slice(0, original.indexOf('export '));
      await writeFile(file, prefix + declaration + '\n');
      const valid = checkProject(project);
      assert.equal(valid.ok, true, JSON.stringify(valid.diagnostics));
      assert.ok(valid.diagnostics.some(item => item.source === 'analyzer' && item.file === file && item.line === 4 && item.column > 1), JSON.stringify(valid.diagnostics));
      await writeFile(file, prefix + invalid + '\n');
      const result = checkProject(project);
      assert.equal(result.ok, false, JSON.stringify(result.diagnostics));
      assert.ok(result.diagnostics.some(item => item.source === 'graphscript' && rule.test(item.message)
        && item.file === file && item.line === 4 && item.column === 1), JSON.stringify(result.diagnostics));
      assert.ok(result.diagnostics.some(item => item.source === 'analyzer' && item.file === file && item.line === 4), JSON.stringify(result.diagnostics));
      assert.ok(!result.diagnostics.some(item => item.source === 'typescript' && item.severity === 'error'), JSON.stringify(result.diagnostics));
      await rm(file);
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('locates unknown graph imports when the analyzer rejects the importing file', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'caller').status, 0);
    const file = join(project, 'nodes', 'caller.ts');
    await writeFile(file, (await readFile(file, 'utf8')).replace('export function caller() {\n}', "import { missing } from '@graph';\nexport function caller() { class Local { accessor value = 1; } return Local; }"));
    const { checkProject } = require('../src/check.js');
    const result = checkProject(project);
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some(item => item.source === 'graphscript' && /unknown node missing/.test(item.message)
      && item.file === file && item.line === 4 && item.column === 10), JSON.stringify(result.diagnostics));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('reports duplicate node names when the analyzer rejects both files', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    for (const name of ['alpha', 'caller', 'zeta']) assert.equal(run(project, 'create', 'function', name).status, 0);
    for (const name of ['alpha', 'zeta']) {
      const file = join(project, 'nodes', `${name}.ts`);
      await writeFile(file, (await readFile(file, 'utf8')).replace(`export function ${name}() {\n}`, 'export function alpha() { class Local { accessor value = 1; } return Local; }'));
    }
    const caller = join(project, 'nodes', 'caller.ts');
    await writeFile(caller, (await readFile(caller, 'utf8')).replace('export function caller()', "import { alpha } from '@graph';\nexport function caller()"));
    const { checkProject } = require('../src/check.js');
    const result = checkProject(project);
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some(item => item.source === 'graphscript' && /duplicate node name alpha/i.test(item.message)
      && item.file === join(project, 'nodes', 'zeta.ts') && item.line === 4 && item.column === 1), JSON.stringify(result.diagnostics));
    assert.ok(result.diagnostics.some(item => item.source === 'graphscript' && /filename/.test(item.message)
      && item.file === join(project, 'nodes', 'zeta.ts')), JSON.stringify(result.diagnostics));
    assert.ok(!result.diagnostics.some(item => item.source === 'typescript'), JSON.stringify(result.diagnostics));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('locates an unknown graph import', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'caller').status, 0);
    const file = join(project, 'nodes', 'caller.ts');
    await writeFile(file, (await readFile(file, 'utf8')).replace('export function caller()', "import { missing } from '@graph';\nexport function caller()"));
    const { checkProject } = require('../src/check.js');
    const result = checkProject(project);
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some(item => item.source === 'graphscript' && /unknown node missing/.test(item.message)
      && item.file === file && item.line === 4 && item.column > 1));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('keeps valid graph imports available when another node has a rule error', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    for (const name of ['target', 'caller', 'invalid']) assert.equal(run(project, 'create', 'function', name).status, 0);
    const caller = join(project, 'nodes', 'caller.ts');
    await writeFile(caller, (await readFile(caller, 'utf8')).replace('export function caller()', "import { target } from '@graph';\nexport function caller()"));
    const invalid = join(project, 'nodes', 'invalid.ts');
    await writeFile(invalid, (await readFile(invalid, 'utf8')).replace('export function invalid()', 'const forbidden = 1;\nexport function invalid()'));
    const { checkProject } = require('../src/check.js');
    const result = checkProject(project);
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some(item => item.source === 'graphscript' && item.file === invalid));
    assert.ok(!result.diagnostics.some(item => item.source === 'typescript' && item.code === 2305 && item.file === caller));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('keeps a recoverable export available when its source has a compiler error', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    for (const name of ['target', 'caller']) assert.equal(run(project, 'create', 'function', name).status, 0);
    const target = join(project, 'nodes', 'target.ts');
    await writeFile(target, (await readFile(target, 'utf8')).replace('target()', 'target(value: string, value: string)'));
    const caller = join(project, 'nodes', 'caller.ts');
    await writeFile(caller, (await readFile(caller, 'utf8')).replace('export function caller()', "import { target } from '@graph';\nexport function caller()"));
    const { checkProject } = require('../src/check.js');
    const result = checkProject(project);
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some(item => item.source === 'typescript' && item.file === target));
    assert.ok(!result.diagnostics.some(item => item.file === caller && /unknown node|no exported member/i.test(item.message)), JSON.stringify(result.diagnostics));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('continues graph validation when another node has invalid syntax', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    for (const name of ['broken', 'other']) assert.equal(run(project, 'create', 'function', name).status, 0);
    const broken = join(project, 'nodes', 'broken.ts');
    await writeFile(broken, (await readFile(broken, 'utf8')).replace('export function broken()', 'export function broken('));
    const other = join(project, 'nodes', 'other.ts');
    await writeFile(other, (await readFile(other, 'utf8')).replace(/\/\/ graphscript:id [^\n]+\n/, ''));
    const { checkProject } = require('../src/check.js');
    const result = checkProject(project);
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some(item => item.source === 'typescript' && item.file === broken));
    assert.ok(result.diagnostics.some(item => item.source === 'graphscript' && item.file === other && /identity/.test(item.message)));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('reports later analyzer gaps when an earlier node has an identity error', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    for (const name of ['alpha', 'beta', 'zeta']) assert.equal(run(project, 'create', 'function', name).status, 0);
    const alpha = join(project, 'nodes', 'alpha.ts');
    await writeFile(alpha, (await readFile(alpha, 'utf8')).replace(/graphscript:id [^\n]+/, 'graphscript:id invalid'));
    const beta = join(project, 'nodes', 'beta.ts');
    await writeFile(beta, (await readFile(beta, 'utf8')).replace('export function beta() {\n}', "import * as graph from '@graph';\nexport function beta(key: keyof typeof graph) { return graph[key]; }"));
    const zeta = join(project, 'nodes', 'zeta.ts');
    await writeFile(zeta, (await readFile(zeta, 'utf8')).replace('export function zeta() {\n}', 'export function zeta() { class Local { accessor value = 1; } return Local; }'));
    const { checkProject } = require('../src/check.js');
    const result = checkProject(project);
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some(item => item.source === 'graphscript' && item.file === alpha && /identity/.test(item.message)));
    assert.ok(result.diagnostics.some(item => item.source === 'analyzer' && item.file === beta && item.line === 5), JSON.stringify(result.diagnostics));
    assert.ok(result.diagnostics.some(item => item.source === 'analyzer' && item.file === zeta && item.line === 4 && item.column > 1), JSON.stringify(result.diagnostics));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('warns for computed destructuring of graph and state values', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'state', 'settings').status, 0);
    assert.equal(run(project, 'create', 'function', 'caller').status, 0);
    const file = join(project, 'nodes', 'caller.ts');
    await writeFile(file, (await readFile(file, 'utf8')).replace('export function caller() {\n}', "import * as graph from '@graph';\nexport function caller(key: keyof typeof graph, prop: keyof typeof graph.settings) { const { [key]: node } = graph; const { [prop]: value } = graph.settings; return [node, value]; }"));
    const { checkProject } = require('../src/check.js');
    const result = checkProject(project);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.equal(result.diagnostics.filter(item => item.source === 'analyzer' && item.file === file && item.line === 5).length, 2);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('warns when a state alias has an uncertain identity', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'state', 'settings').status, 0);
    assert.equal(run(project, 'create', 'function', 'caller').status, 0);
    const file = join(project, 'nodes', 'caller.ts');
    await writeFile(file, (await readFile(file, 'utf8')).replace('export function caller() {\n}', "import { settings } from '@graph';\nexport function caller(change: boolean) { let alias = settings; if (change) alias = {}; return alias; }"));
    const { checkProject } = require('../src/check.js');
    const result = checkProject(project);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.ok(result.diagnostics.some(item => item.source === 'analyzer' && item.file === file && item.line === 5));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('reports compiler positions after Unicode text and CR line endings', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'broken').status, 0);
    const file = join(project, 'nodes', 'broken.ts');
    await writeFile(file, (await readFile(file, 'utf8')).replace('export function broken() {\n}', 'export function broken(): number { "😀"; return "wrong"; }').replaceAll('\n', '\r'));
    const { checkProject } = require('../src/check.js');
    const result = checkProject(project);
    const diagnostic = result.diagnostics.find(item => item.source === 'typescript' && item.code === 2322);
    assert.equal(diagnostic.file, file);
    assert.equal(diagnostic.line, 4);
    assert.equal(diagnostic.column, 42);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('creates an empty library project', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    const result = run(project, 'init', '--library');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await readdir(join(project, 'nodes')), []);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('creates persistent nodes with stable IDs and matching names', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    const ids = new Set();
    for (const [kind, name, primaryExport] of [
      ['function', 'greet', /export function greet\(/],
      ['class', 'Account', /export class Account\b/],
      ['state', 'settings', /export const settings\s*=\s*\{/],
    ]) {
      const result = run(project, 'create', kind, name);
      assert.equal(result.status, 0, result.stderr);
      const source = await readFile(join(project, 'nodes', `${name}.ts`), 'utf8');
      assert.match(source, new RegExp(`^"graphscript:${kind}";\\n// graphscript:id [0-9a-f]{8}-[0-9a-f-]{27}\\n`));
      ids.add(source.match(/graphscript:id ([0-9a-f-]+)/)[1]);
      assert.match(source, primaryExport);
      assert.equal((source.match(/graphscript:(?:function|class|state)/g) ?? []).length, 1);
      assert.equal((source.match(/\bexport\b/g) ?? []).length, 1);
    }
    assert.equal(ids.size, 3);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('checks saved nodes without emitting output or changing source', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    for (const [kind, name] of [['function', 'greet'], ['class', 'Account'], ['state', 'settings']]) {
      assert.equal(run(project, 'create', kind, name).status, 0);
    }
    const functionPath = join(project, 'nodes', 'greet.ts');
    const functionSource = await readFile(functionPath, 'utf8');
    await writeFile(functionPath, functionSource.replace('export function greet() {\n}', 'type Name = string;\ndeclare const suffix: string;\nexport function greet(name: Name) { return name + suffix; }'));
    const sourcePath = join(project, 'nodes', 'settings.ts');
    const stateSource = await readFile(sourcePath, 'utf8');
    await writeFile(sourcePath, stateSource.replace('"graphscript:state";', "// graphscript:function in a comment\n'graphscript:state'").replace('export const settings = {\n};', 'export const settings = { volume: 1, muted: false } as const satisfies { volume: number; muted: boolean };'));
    const paths = ['greet', 'Account', 'settings'].map(name => join(project, 'nodes', `${name}.ts`));
    const sources = await Promise.all(paths.map(file => readFile(file, 'utf8')));
    const before = await readdir(project, { recursive: true });
    const result = run(project, 'check');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await readdir(project, { recursive: true }), before);
    assert.deepEqual(await Promise.all(paths.map(file => readFile(file, 'utf8'))), sources);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('checks named graph imports for every node kind', async () => {
  for (const type of ['commonjs', 'module']) {
    const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
    try {
      await writeFile(join(project, 'package.json'), JSON.stringify({ type }));
      assert.equal(run(project, 'init', '--library').status, 0);
      for (const [kind, name] of [['function', 'greet'], ['class', 'Account'], ['state', 'settings'], ['function', 'useGraph']]) {
        assert.equal(run(project, 'create', kind, name).status, 0);
      }
      const sourcePath = join(project, 'nodes', 'useGraph.ts');
      const source = await readFile(sourcePath, 'utf8');
      await writeFile(sourcePath, source.replace('export function useGraph() {\n}', "import { greet, Account, settings } from '@graph';\nexport function useGraph() { greet(); return [new Account(), settings]; }"));
      const result = run(project, 'check');
      assert.equal(result.status, 0, result.stdout + result.stderr);
      await writeFile(sourcePath, (await readFile(sourcePath, 'utf8')).replace('greet();', "greet('unexpected');"));
      const invalid = run(project, 'check');
      assert.notEqual(invalid.status, 0);
      assert.match(invalid.stdout + invalid.stderr, /error TS2554/);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  }
});

test('rejects relative runtime imports in GraphScript source', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    await writeFile(join(project, 'package.json'), '{"type":"module"}\n');
    assert.equal(run(project, 'create', 'function', 'useGraph').status, 0);
    await mkdir(join(project, 'nodes', 'helper'));
    await writeFile(join(project, 'nodes', 'helper', 'index.js'), 'exports.value = 7;');
    await writeFile(join(project, 'nodes', 'helper', 'index.d.ts'), 'export declare const value: number;');
    const sourcePath = join(project, 'nodes', 'useGraph.ts');
    const source = await readFile(sourcePath, 'utf8');
    for (const declaration of [
      "import { value } from './helper/index.js';\nexport function useGraph() { return value; }",
      "export async function useGraph() { return import('./helper/index.js'); }",
      'export async function useGraph() { return import(`./helper/index.js`); }',
      'export async function useGraph() { return import(new URL("./helper/index.js", import.meta.url) as unknown as string); }',
      'export async function useGraph() { return import(new globalThis.URL("./helper/index.js", import.meta.url) as unknown as string); }',
      'export async function useGraph() { const target = new URL("./helper/index.js", import.meta.url); return import(target as unknown as string); }',
      "declare function require(name: string): { value: number };\nexport function useGraph() { return require('./helper/index.js').value; }",
      "declare function require(name: string): { value: number };\nexport function useGraph() { const load = require; return load('./helper/index.js').value; }",
      "import helper = require('./helper/index.js');\nexport function useGraph() { return helper.value; }",
      "declare const module: { require(name: string): { value: number } };\nexport function useGraph() { return module.require('./helper/index.js').value; }",
      "declare const module: { require(name: string): { value: number } } | undefined;\nexport function useGraph() { return module?.require?.('./helper/index.js').value; }",
    ]) {
      await writeFile(sourcePath, source.replace('export function useGraph() {\n}', declaration));
      const result = run(project, 'check');
      assert.notEqual(result.status, 0, declaration);
      assert.match(result.stdout + result.stderr, /relative runtime imports are not allowed/, declaration);
      assert.throws(() => require('../src/graph.js').readGraph(project), /relative runtime imports are not allowed/, declaration);
    }
    for (const declaration of [
      'import "file:///missing.mjs";\nexport function useGraph() {}',
      'export async function useGraph() { return import("FiLe:///missing.mjs"); }',
      'declare function require(name: string): unknown;\nexport function useGraph() { return require("file:///missing.mjs"); }',
    ]) {
      await writeFile(sourcePath, source.replace('export function useGraph() {\n}', declaration));
      const result = run(project, 'check');
      assert.notEqual(result.status, 0, declaration);
      assert.match(result.stdout + result.stderr, /file: URL imports are not allowed/, declaration);
      assert.throws(() => require('../src/graph.js').readGraph(project), /file: URL imports are not allowed/, declaration);
    }
    await writeFile(sourcePath, source.replace('export function useGraph() {\n}',
      "export function useGraph() { const require = (value: string) => value; return require('./not-an-import'); }"));
    const localFunction = run(project, 'check');
    assert.equal(localFunction.status, 0, localFunction.stdout + localFunction.stderr);
    assert.doesNotThrow(() => require('../src/graph.js').readGraph(project));
    const localBuild = run(project, 'build', '--library');
    assert.equal(localBuild.status, 0, localBuild.stderr);
    const localModule = await import(pathToFileURL(join(project, 'dist', 'index.mjs')).href);
    assert.equal(localModule.useGraph(), './not-an-import');
    await writeFile(sourcePath, source.replace('export function useGraph() {\n}',
      "export function useGraph() { const module = { require: (value: string) => value }; return module.require('./not-an-import'); }"));
    const localModuleCheck = run(project, 'check');
    assert.equal(localModuleCheck.status, 0, localModuleCheck.stdout + localModuleCheck.stderr);
    assert.doesNotThrow(() => require('../src/graph.js').readGraph(project));
    await writeFile(sourcePath, source.replace('export function useGraph() {\n}',
      "import type { value } from './helper/index.js';\nexport function useGraph(input: typeof value) { return input; }"));
    const typeOnly = run(project, 'check');
    assert.equal(typeOnly.status, 0, typeOnly.stdout + typeOnly.stderr);
    assert.doesNotThrow(() => require('../src/graph.js').readGraph(project));
    await writeFile(sourcePath, source);
    await writeFile(join(project, 'nodes', 'main.ts'), '"graphscript:program";\nexport { value } from "./helper/index.js";\n');
    const program = run(project, 'check');
    assert.notEqual(program.status, 0);
    assert.match(program.stdout + program.stderr, /relative runtime imports are not allowed/);
    assert.throws(() => require('../src/graph.js').readGraph(project), /relative runtime imports are not allowed/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('reads stable node identities and resolves named graph imports to IDs', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    for (const [kind, name] of [['function', 'greet'], ['class', 'Account'], ['state', 'settings'], ['function', 'useGraph']]) {
      assert.equal(run(project, 'create', kind, name).status, 0);
    }
    const sourcePath = join(project, 'nodes', 'useGraph.ts');
    const source = await readFile(sourcePath, 'utf8');
    await writeFile(sourcePath, source.replace('export function useGraph()', "import { greet as hello, Account, settings } from '@graph';\nexport function useGraph()"));
    const { readGraph } = require('../src/graph.js');
    const first = readGraph(project);
    const second = readGraph(project);
    assert.deepEqual(second, first);
    const nodeByName = new Map(first.nodes.map(node => [node.name, node]));
    for (const name of ['greet', 'Account', 'settings']) {
      assert.ok(first.imports.some(reference => reference.fromId === nodeByName.get('useGraph').id && reference.toId === nodeByName.get(name).id && reference.name === name));
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('resolves graph namespace imports to available node identities', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'greet').status, 0);
    assert.equal(run(project, 'create', 'function', 'caller').status, 0);
    const sourcePath = join(project, 'nodes', 'caller.ts');
    const source = await readFile(sourcePath, 'utf8');
    await writeFile(sourcePath, source.replace('export function caller() {\n}', "import * as graph from '@graph';\nexport function caller() { graph.greet(); }"));
    const result = run(project, 'check');
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const { readGraph } = require('../src/graph.js');
    const graph = readGraph(project);
    const caller = graph.nodes.find(node => node.name === 'caller');
    const greet = graph.nodes.find(node => node.name === 'greet');
    const namespace = graph.namespaces.find(entry => entry.fromId === caller.id);
    assert.ok(namespace.targets.some(target => target.name === 'greet' && target.toId === greet.id));
    await writeFile(sourcePath, source.replace('export function caller() {\n}', "export async function caller() { const graph = await import('@graph'); graph.greet(); }"));
    const dynamicCheck = run(project, 'check');
    assert.equal(dynamicCheck.status, 0, dynamicCheck.stdout + dynamicCheck.stderr);
    const dynamicGraph = readGraph(project);
    const dynamicNamespace = dynamicGraph.namespaces.find(entry => entry.fromId === caller.id && entry.kind === 'dynamic');
    assert.ok(dynamicNamespace.targets.some(target => target.name === 'greet' && target.toId === greet.id));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('rejects missing, malformed, and duplicate node identities without changing source', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'first').status, 0);
    assert.equal(run(project, 'create', 'class', 'Second').status, 0);
    const firstPath = join(project, 'nodes', 'first.ts');
    const secondPath = join(project, 'nodes', 'Second.ts');
    const first = await readFile(firstPath, 'utf8');
    const second = await readFile(secondPath, 'utf8');
    const firstId = first.match(/graphscript:id ([0-9a-f-]+)/)[1];
    for (const invalid of [
      second.replace(/\/\/ graphscript:id [^\n]+\n/, ''),
      second.replace(/graphscript:id [^\n]+/, 'graphscript:id invalid'),
      second.replace(/graphscript:id [^\n]+/, `graphscript:id ${firstId}`),
      second.replace(/(\/\/ graphscript:id [^\n]+)/, '$1\n$1'),
    ]) {
      await writeFile(secondPath, invalid);
      const result = run(project, 'check');
      assert.notEqual(result.status, 0);
      assert.match(result.stdout + result.stderr, /identity.*(?:ID|id)/i);
      assert.equal(await readFile(firstPath, 'utf8'), first);
      assert.equal(await readFile(secondPath, 'utf8'), invalid);
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('locates invalid and duplicate identity comments', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    for (const name of ['alpha', 'zeta']) assert.equal(run(project, 'create', 'function', name).status, 0);
    const first = await readFile(join(project, 'nodes', 'alpha.ts'), 'utf8');
    const file = join(project, 'nodes', 'zeta.ts');
    const original = await readFile(file, 'utf8');
    const id = first.match(/graphscript:id ([0-9a-f-]+)/)[1];
    const { checkProject } = require('../src/check.js');
    for (const identity of ['graphscript:id invalid', `graphscript:id ${id}`]) {
      await writeFile(file, original.replace(/\/\/ graphscript:id [^\n]+/, `   // ${identity}`));
      const diagnostic = checkProject(project).diagnostics.find(item => item.source === 'graphscript' && /identity/.test(item.message));
      assert.deepEqual({ file: diagnostic.file, line: diagnostic.line, column: diagnostic.column }, { file, line: 2, column: 4 });
    }
    await writeFile(file, original.replace(/(\/\/ graphscript:id [^\n]+)/, '$1\n   $1'));
    const diagnostic = checkProject(project).diagnostics.find(item => item.source === 'graphscript' && /identity/.test(item.message));
    assert.deepEqual({ file: diagnostic.file, line: diagnostic.line, column: diagnostic.column }, { file, line: 3, column: 4 });
    await writeFile(file, original.replace('export function zeta() {\n}', `export function zeta() { class Local { accessor value = 1; } { /* graphscript:id ${id} */ } }`));
    const embedded = checkProject(project).diagnostics.find(item => item.source === 'graphscript' && /identity/.test(item.message));
    assert.ok(embedded && embedded.file === file && embedded.line === 4 && embedded.column > 1, JSON.stringify(embedded));
    await writeFile(file, original.replace('export function zeta() {\n}', `export function zeta() { return \`text \${/* graphscript:id ${id} */ 1} text\`; }`));
    const interpolated = checkProject(project).diagnostics.find(item => item.source === 'graphscript' && /identity/.test(item.message));
    assert.ok(interpolated && interpolated.file === file && interpolated.line === 4 && interpolated.column > 1, JSON.stringify(interpolated));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('does not treat literal text as identity comments', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'example').status, 0);
    const file = join(project, 'nodes', 'example.ts');
    await writeFile(file, (await readFile(file, 'utf8')).replace('export function example() {\n}',
      'export function example() { const regex = /\\/\\/ graphscript:id invalid/; return `${regex} /* graphscript:id invalid */`; }'));
    const { checkProject } = require('../src/check.js');
    const result = checkProject(project);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('does not return an index for invalid node source', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'greet').status, 0);
    const sourcePath = join(project, 'nodes', 'greet.ts');
    const source = await readFile(sourcePath, 'utf8');
    await writeFile(sourcePath, source.replace('function greet()', 'class greet'));
    const { readGraph } = require('../src/graph.js');
    assert.throws(() => readGraph(project), /GraphScript.*export/i);
    await writeFile(sourcePath, source.replace('greet()', 'greet(value: string, value: string)'));
    assert.throws(() => readGraph(project), /parse|syntax/i);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('reports a missing node-kind directive as a GraphScript rule error', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    for (const source of [
      'export function greet() {}\n',
      '"graphscript:other";\nexport function greet() {}\n',
      '"graphscr\\u0069pt:function";\nexport function greet() {}\n',
      '"use strict";\n"graphscript:function";\nexport function greet() {}\n',
      'export function greet() {}\n"graphscript:function";\n',
    ]) {
      await writeFile(join(project, 'nodes', 'greet.ts'), source);
      const result = run(project, 'check');
      assert.notEqual(result.status, 0, source);
      assert.match(result.stdout + result.stderr, /greet\.ts.*GraphScript.*directive/i, source);
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('reports duplicate node-kind directives as a GraphScript rule error', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    for (const source of [
      '"graphscript:function";\n"graphscript:state";\nexport function greet() {}\n',
      '"graphscript:function";\nexport function greet() {}\n"graphscript:function";\n',
      '"graphscript:function";\n"graphscr\\u0069pt:state";\nexport function greet() {}\n',
    ]) {
      await writeFile(join(project, 'nodes', 'greet.ts'), source);
      const result = run(project, 'check');
      assert.notEqual(result.status, 0, source);
      assert.match(result.stdout + result.stderr, /greet\.ts.*GraphScript.*directive/i, source);
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('reports a primary export that does not match the node kind', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    for (const source of [
      '"graphscript:class";\nexport function Example() {}\n',
      '"graphscript:function";\nexport class Example {}\n',
      '"graphscript:state";\nexport const Example = 1;\n',
      '"graphscript:state";\nexport const Example = {}, extra = {};\n',
      '"graphscript:function";\nfunction Example() {}\n',
      '"graphscript:class";\nexport default class Example {}\n',
      '"graphscript:class";\nexport declare class Example {}\n',
    ]) {
      await writeFile(join(project, 'nodes', 'Example.ts'), source);
      const result = run(project, 'check');
      assert.notEqual(result.status, 0, source);
      assert.match(result.stdout + result.stderr, /Example\.ts.*GraphScript.*export/i, source);
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('reports filenames that do not match primary exports', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    for (const [kind, declaration] of [
      ['function', 'function Actual() {}'],
      ['class', 'class Actual {}'],
      ['state', 'const Actual = {}'],
    ]) {
      await writeFile(join(project, 'nodes', 'Wrong.ts'), `"graphscript:${kind}";\nexport ${declaration}\n`);
      const result = run(project, 'check');
      assert.notEqual(result.status, 0, kind);
      assert.match(result.stdout + result.stderr, /Wrong\.ts.*GraphScript.*filename/i, kind);
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('reports additional top-level exports as GraphScript rule errors', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    for (const extra of ['export type Extra = string;', 'export { greet };', 'export import Alias = require("missing");', 'export as namespace Example;']) {
      await writeFile(join(project, 'nodes', 'greet.ts'), `"graphscript:function";\nexport function greet() {}\n${extra}\n`);
      const result = run(project, 'check');
      assert.notEqual(result.status, 0, extra);
      assert.match(result.stdout + result.stderr, /greet\.ts.*GraphScript.*export/i, extra);
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('reports private top-level runtime definitions as GraphScript rule errors', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    for (const definition of ['function helper() {}', 'function greet() {}', 'class Helper {}', 'const shared = {};', 'enum Mode { On }', 'namespace Helpers { export const value = 1; }']) {
      await writeFile(join(project, 'nodes', 'greet.ts'), `"graphscript:function";\nexport function greet() {}\n${definition}\n`);
      const result = run(project, 'check');
      assert.notEqual(result.status, 0, definition);
      assert.match(result.stdout + result.stderr, /greet\.ts.*GraphScript.*runtime/i, definition);
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('reports invalid TypeScript source as a failed check', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'greet').status, 0);
    const sourcePath = join(project, 'nodes', 'greet.ts');
    await writeFile(sourcePath, `${await readFile(sourcePath, 'utf8')}\nconst value: number = 'invalid';\n`);
    const result = run(project, 'check');
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /greet\.ts.*error TS\d+/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('rejects invalid node names without creating source', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    for (const kind of ['function', 'class', 'state']) {
      for (const name of ['class', '../escape', '123name']) {
        const result = run(project, 'create', kind, name);
        assert.notEqual(result.status, 0, `${kind} ${name}`);
        assert.match(result.stderr, /invalid.*name/i);
      }
    }
    assert.deepEqual(await readdir(join(project, 'nodes')), []);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('rejects a duplicate node name without changing the existing source', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'greet').status, 0);
    const sourcePath = join(project, 'nodes', 'greet.ts');
    const source = await readFile(sourcePath, 'utf8');
    const result = run(project, 'create', 'state', 'greet');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /already exists/i);
    assert.equal(await readFile(sourcePath, 'utf8'), source);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('rejects duplicate names in edited source and during creation', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'Shared').status, 0);
    assert.equal(run(project, 'create', 'class', 'Other').status, 0);
    const otherPath = join(project, 'nodes', 'Other.ts');
    const other = await readFile(otherPath, 'utf8');
    await writeFile(otherPath, other.replace('class Other', 'class Shared'));
    const check = run(project, 'check');
    assert.notEqual(check.status, 0);
    assert.match(check.stdout + check.stderr, /duplicate.*(?:node )?name.*Shared/i);
    await writeFile(otherPath, other);
    await rename(join(project, 'nodes', 'Shared.ts'), join(project, 'nodes', 'Moved.ts'));
    const creation = run(project, 'create', 'state', 'Shared');
    assert.notEqual(creation.status, 0);
    assert.match(creation.stderr, /(?:duplicate|already exists).*Shared/i);
    assert.deepEqual((await readdir(join(project, 'nodes'))).sort(), ['Moved.ts', 'Other.ts']);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('creates a node that is already referenced by an unresolved graph import', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  try {
    assert.equal(run(project, 'init', '--library').status, 0);
    assert.equal(run(project, 'create', 'function', 'caller').status, 0);
    const sourcePath = join(project, 'nodes', 'caller.ts');
    const source = await readFile(sourcePath, 'utf8');
    const updated = source.replace('export function caller()', "import { Target } from '@graph';\nexport function caller()");
    await writeFile(sourcePath, updated);
    const unresolved = run(project, 'check');
    assert.notEqual(unresolved.status, 0);
    assert.match(unresolved.stderr, /unknown node Target/);
    assert.equal(await readFile(sourcePath, 'utf8'), updated);
    const creation = run(project, 'create', 'class', 'Target');
    assert.equal(creation.status, 0, creation.stderr);
    const check = run(project, 'check');
    assert.equal(check.status, 0, check.stdout + check.stderr);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('rejects a linked managed directory without creating outside source', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-'));
  const outside = await mkdtemp(join(tmpdir(), 'graphscript-outside-'));
  try {
    await symlink(outside, join(project, 'nodes'));
    const creation = run(project, 'create', 'function', 'greet');
    assert.notEqual(creation.status, 0);
    assert.match(creation.stderr, /nodes must be a directory/i);
    assert.deepEqual(await readdir(outside), []);
    const check = run(project, 'check');
    assert.notEqual(check.status, 0);
    assert.match(check.stderr, /nodes must be a directory/i);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});