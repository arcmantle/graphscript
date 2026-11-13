import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const { watchGraph } = require('../src/graph.js');

function observeGraph(project) {
  let receive = () => {};
  const watcher = watchGraph(project, result => receive(result));
  return {
    next(action, matches) {
      return new Promise((resolve, reject) => {
        let finished = false;
        const finish = (callback, value) => {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          receive = () => {};
          callback(value);
        };
        const timeout = setTimeout(() => finish(reject, new Error('Expected graph update timed out')), 5000);
        receive = result => {
          if (matches(result)) finish(resolve, result);
        };
        Promise.resolve().then(action).catch(error => finish(reject, error));
      });
    },
    close() { watcher.close(); },
  };
}

async function waitForUpdate(project, action, matches) {
  const observer = observeGraph(project);
  try {
    return await observer.next(action, matches);
  } finally {
    observer.close();
  }
}

test('updates the graph after a saved source edit', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-watch-'));
  try {
    await mkdir(join(project, 'nodes'));
    const target = join(project, 'nodes', 'target.ts');
    const caller = join(project, 'nodes', 'caller.ts');
    const targetId = '00000000-0000-0000-0000-000000000001';
    const callerId = '00000000-0000-0000-0000-000000000002';
    await writeFile(target, `"graphscript:function";\n// graphscript:id ${targetId}\nexport function target() {}\n`);
    await writeFile(caller, `"graphscript:function";\n// graphscript:id ${callerId}\nexport function caller() {}\n`);
    const { graph, error } = await waitForUpdate(project, () => writeFile(caller, `"graphscript:function";\n// graphscript:id ${callerId}\nimport { target } from "@graph";\nexport function caller() { target(); }\n`), result => result.graph?.edges.some(edge => edge.fromId === callerId && edge.toId === targetId));
    assert.equal(error, undefined);
    assert.deepEqual(graph.edges, [{ fromId: callerId, toId: targetId }]);
    assert.deepEqual(graph.nodes.map(node => node.id).sort(), [targetId, callerId]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('reports invalid identity without changing source and recovers after correction', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-watch-'));
  try {
    await mkdir(join(project, 'nodes'));
    const file = join(project, 'nodes', 'target.ts');
    const valid = '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000001\nexport function target() {}\n';
    const invalid = valid.replace('00000000-0000-0000-0000-000000000001', 'invalid');
    await writeFile(file, valid);
    const observer = observeGraph(project);
    try {
      const result = await observer.next(() => writeFile(file, invalid), result => /GraphScript identity error/.test(result.error?.message));
      assert.match(result.error.message, /GraphScript identity error/);
      assert.equal(await readFile(file, 'utf8'), invalid);
      const recovered = await observer.next(() => writeFile(file, valid), result => result.graph?.nodes[0]?.id === '00000000-0000-0000-0000-000000000001');
      assert.equal(recovered.graph.nodes[0].id, '00000000-0000-0000-0000-000000000001');
      const syntax = valid.replace('target() {}', 'target( {');
      const syntaxResult = await observer.next(() => writeFile(file, syntax), result => /syntax|parse/i.test(result.error?.message));
      assert.match(syntaxResult.error.message, /syntax|parse/i);
      assert.equal(await readFile(file, 'utf8'), syntax);
      const duplicate = join(project, 'nodes', 'other.ts');
      const duplicateSource = valid.replaceAll('target', 'other');
      const duplicateResult = await observer.next(async () => {
        await writeFile(file, valid);
        await delay(150);
        await writeFile(duplicate, duplicateSource);
      }, result => /duplicate node ID/.test(result.error?.message));
      assert.match(duplicateResult.error.message, /duplicate node ID/);
      assert.equal(await readFile(duplicate, 'utf8'), duplicateSource);
    } finally {
      observer.close();
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('updates the graph after a Git checkout changes saved source', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-watch-git-'));
  try {
    await mkdir(join(project, 'nodes'));
    const targetId = '00000000-0000-0000-0000-000000000001';
    const callerId = '00000000-0000-0000-0000-000000000002';
    const caller = join(project, 'nodes', 'caller.ts');
    await writeFile(join(project, 'nodes', 'target.ts'), `"graphscript:function";\n// graphscript:id ${targetId}\nexport function target() {}\n`);
    await writeFile(caller, `"graphscript:function";\n// graphscript:id ${callerId}\nexport function caller() {}\n`);
    const git = (...args) => execFileSync('git', args, { cwd: project, stdio: 'pipe' });
    git('init');
    git('add', 'nodes');
    git('-c', 'user.name=GraphScript Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Initial source');
    await writeFile(caller, `"graphscript:function";\n// graphscript:id ${callerId}\nimport { target } from "@graph";\nexport function caller() { target(); }\n`);
    git('add', 'nodes');
    git('-c', 'user.name=GraphScript Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Add dependency');
    const result = await waitForUpdate(project, () => git('checkout', '--detach', 'HEAD~1'), result => result.graph?.nodes.length === 2 && result.graph.edges.length === 0);
    assert.deepEqual(result.graph.edges, []);
    assert.deepEqual(result.graph.nodes.map(node => node.id).sort(), [targetId, callerId]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('continues watching when the managed directory is replaced', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-watch-'));
  const directory = join(project, 'nodes');
  try {
    await mkdir(directory);
    const source = '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000001\nexport function target() {}\n';
    await writeFile(join(directory, 'target.ts'), source);
    const observer = observeGraph(project);
    try {
      const removed = await observer.next(() => rm(directory, { recursive: true }), result => Boolean(result.error));
      assert.ok(removed.error);
      const restored = await observer.next(async () => {
        await mkdir(directory);
        await writeFile(join(directory, 'target.ts'), source);
      }, result => result.graph?.nodes[0]?.id === '00000000-0000-0000-0000-000000000001');
      assert.equal(restored.graph.nodes[0].id, '00000000-0000-0000-0000-000000000001');
      const added = await observer.next(() => writeFile(join(directory, 'other.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000002\nexport function other() {}\n'), result => result.graph?.nodes.length === 2);
      assert.deepEqual(added.graph.nodes.map(node => node.name).sort(), ['other', 'target']);
    } finally {
      observer.close();
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('reports a missing managed directory at startup and recovers when it appears', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-watch-'));
  const directory = join(project, 'nodes');
  const source = '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000001\nexport function target() {}\n';
  try {
    const observer = observeGraph(project);
    try {
      const missing = await observer.next(() => {}, result => result.error?.code === 'ENOENT');
      assert.equal(missing.error.code, 'ENOENT');
      const restored = await observer.next(async () => {
        await mkdir(directory);
        await writeFile(join(directory, 'target.ts'), source);
      }, result => result.graph?.nodes[0]?.id === '00000000-0000-0000-0000-000000000001');
      assert.equal(restored.graph.nodes[0].id, '00000000-0000-0000-0000-000000000001');
      const added = await observer.next(() => writeFile(join(directory, 'other.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000002\nexport function other() {}\n'), result => result.graph?.nodes.length === 2);
      assert.deepEqual(added.graph.nodes.map(node => node.name).sort(), ['other', 'target']);
    } finally {
      observer.close();
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('updates the graph after a node file is renamed and deleted', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-watch-'));
  const directory = join(project, 'nodes');
  const original = join(directory, 'target.ts');
  const renamed = join(directory, 'renamed.ts');
  const id = '00000000-0000-0000-0000-000000000001';
  const source = `"graphscript:function";\n// graphscript:id ${id}\nexport function target() {}\n`;
  try {
    await mkdir(directory);
    await writeFile(original, source);
    const observer = observeGraph(project);
    try {
      const moved = await observer.next(async () => {
        await writeFile(original, source.replace('function target', 'function renamed'));
        await rename(original, renamed);
      }, result => result.graph?.nodes[0]?.name === 'renamed');
      assert.equal(moved.graph.nodes[0].id, id);
      assert.equal(moved.graph.nodes[0].name, 'renamed');
      const deleted = await observer.next(() => rm(renamed), result => result.graph?.nodes.length === 0);
      assert.deepEqual(deleted.graph.nodes, []);
    } finally {
      observer.close();
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('reports the startup error even when the managed directory appears immediately', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-watch-'));
  const directory = join(project, 'nodes');
  const updates = [];
  let resolveUpdates;
  const received = new Promise(resolve => { resolveUpdates = resolve; });
  try {
    const watcher = watchGraph(project, result => {
      updates.push(result);
      if (updates.length === 2) resolveUpdates();
    });
    try {
      mkdirSync(directory);
      writeFileSync(join(directory, 'target.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000001\nexport function target() {}\n');
      await Promise.race([received, delay(1000, undefined, { ref: false }).then(() => { throw new Error('Graph updates timed out'); })]);
      assert.equal(updates[0].error.code, 'ENOENT');
      assert.equal(updates[1].graph.nodes[0].name, 'target');
    } finally {
      watcher.close();
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('close cancels pending updates and stops watching', async context => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-watch-'));
  const directory = join(project, 'nodes');
  let updates = 0;
  let scheduled;
  const pending = new Promise(resolve => { scheduled = resolve; });
  const timers = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  context.mock.method(globalThis, 'setTimeout', (callback, milliseconds, ...args) => {
    if (milliseconds !== 50) return originalSetTimeout(callback, milliseconds, ...args);
    const timer = { callback, cancelled: false };
    timers.push(timer);
    scheduled();
    return timer;
  });
  context.mock.method(globalThis, 'clearTimeout', timer => {
    if (timers.includes(timer)) timer.cancelled = true;
    else originalClearTimeout(timer);
  });
  try {
    const missingWatcher = watchGraph(project, () => { updates++; });
    missingWatcher.close();
    await mkdir(directory);
    const activeWatcher = watchGraph(project, () => { updates++; });
    await writeFile(join(directory, 'target.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000001\nexport function target() {}\n');
    try {
      await Promise.race([pending, delay(5000, undefined, { ref: false }).then(() => { throw new Error('Watcher did not schedule an update'); })]);
    } finally {
      activeWatcher.close();
    }
    assert.ok(timers.length > 0);
    const timerCountAtClose = timers.length;
    await rm(directory, { recursive: true });
    await mkdir(directory);
    await delay(200);
    for (const timer of timers.filter(timer => !timer.cancelled)) timer.callback();
    assert.equal(timers.length, timerCountAtClose);
    assert.ok(timers.every(timer => timer.cancelled));
    assert.equal(updates, 0);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});