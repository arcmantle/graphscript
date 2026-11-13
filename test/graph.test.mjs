import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { readGraph } = require('../src/graph.js');

test('reports distinct state property reads with stable node IDs', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-graph-'));
  try {
    await mkdir(join(project, 'nodes'));
    await writeFile(join(project, 'nodes', 'appState.ts'), '"graphscript:state";\n// graphscript:id 00000000-0000-0000-0000-000000000001\nexport const appState = { counter: 0, settings: {}, 0: true };\n');
    await writeFile(join(project, 'nodes', 'caller.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000002\nimport { appState } from "@graph";\nexport function caller() { return [appState.counter, appState.settings, appState[0]]; }\n');
    assert.deepEqual(readGraph(project).edges, [
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'counter', access: 'read' },
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'settings', access: 'read' },
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: '0', access: 'read' },
    ]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('distinguishes writes from read-write state operations', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-graph-'));
  try {
    await mkdir(join(project, 'nodes'));
    await writeFile(join(project, 'nodes', 'appState.ts'), '"graphscript:state";\n// graphscript:id 00000000-0000-0000-0000-000000000001\nexport const appState = { assigned: 0, added: 0, updated: 0 };\n');
    await writeFile(join(project, 'nodes', 'caller.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000002\nimport { appState } from "@graph";\nexport function caller() { appState.assigned = 1; appState.added += 1; appState.updated++; }\n');
    assert.deepEqual(readGraph(project).edges, [
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'assigned', access: 'write' },
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'added', access: 'read' },
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'added', access: 'write' },
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'updated', access: 'read' },
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'updated', access: 'write' },
    ]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('reports nested mutations as reads and writes of the owning state property', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-graph-'));
  try {
    await mkdir(join(project, 'nodes'));
    await writeFile(join(project, 'nodes', 'appState.ts'), '"graphscript:state";\n// graphscript:id 00000000-0000-0000-0000-000000000001\nexport const appState = { assigned: {}, updated: {}, removed: {}, viewed: {} };\n');
    await writeFile(join(project, 'nodes', 'caller.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000002\nimport { appState } from "@graph";\nexport function caller(key: string) { appState.assigned.theme = 1; ++appState.updated[key]; delete appState.removed.theme; appState.viewed.theme; appState[key].theme = 1; }\n');
    assert.deepEqual(readGraph(project).edges, [
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'assigned', access: 'read' },
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'assigned', access: 'write' },
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'updated', access: 'read' },
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'updated', access: 'write' },
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'removed', access: 'read' },
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'removed', access: 'write' },
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'viewed', access: 'read' },
    ]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('resolves state properties through static graph namespaces and literal dynamic imports', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-graph-'));
  try {
    await mkdir(join(project, 'nodes'));
    await writeFile(join(project, 'nodes', 'appState.ts'), '"graphscript:state";\n// graphscript:id 00000000-0000-0000-0000-000000000001\nexport const appState = { first: 0, second: 0, third: 0 };\n');
    await writeFile(join(project, 'nodes', 'caller.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000002\nimport * as graph from "@graph";\nexport async function caller(key: string) { const alias = graph; alias.appState["first"]; graph["appState"][`second`]++; (await import("@graph")).appState.third = 1; graph.appState[key]; }\n');
    assert.deepEqual(readGraph(project).edges, [
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'first', access: 'read' },
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'second', access: 'read' },
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'second', access: 'write' },
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'third', access: 'write' },
    ]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('resolves constant state aliases and destructured state properties', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-graph-'));
  try {
    await mkdir(join(project, 'nodes'));
    await writeFile(join(project, 'nodes', 'appState.ts'), '"graphscript:state";\n// graphscript:id 00000000-0000-0000-0000-000000000001\nexport const appState = { first: 0, second: 0, third: 0 };\n');
    await writeFile(join(project, 'nodes', 'caller.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000002\nimport { appState } from "@graph";\nimport * as graph from "@graph";\nexport function caller() { const state = appState; const { first } = state; const { appState: other } = graph; other.second = first; const { third } = other; return third; }\n');
    assert.deepEqual(readGraph(project).edges, [
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'first', access: 'read' },
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'second', access: 'write' },
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'third', access: 'read' },
    ]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('resolves a state alias before reassignment only when its identity is certain', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-graph-'));
  try {
    await mkdir(join(project, 'nodes'));
    await writeFile(join(project, 'nodes', 'appState.ts'), '"graphscript:state";\n// graphscript:id 00000000-0000-0000-0000-000000000001\nexport const appState = { before: 0, after: 0, deferred: 0, uncertain: 0 };\n');
    await writeFile(join(project, 'nodes', 'caller.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000002\nimport { appState } from "@graph";\nexport function caller(condition: boolean) { let alias = appState; alias.before++; const delayed = () => alias.deferred; alias = { before: 0, after: 0, deferred: 0, uncertain: 0 }; alias.after; delayed(); let maybe = appState; if (condition) maybe = alias; maybe.uncertain; }\n');
    assert.deepEqual(readGraph(project).edges, [
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'before', access: 'read' },
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'before', access: 'write' },
    ]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('reports state self-access but omits type-only, shadowed, and unresolved property references', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-graph-'));
  try {
    await mkdir(join(project, 'nodes'));
    await writeFile(join(project, 'nodes', 'appState.ts'), '"graphscript:state";\n// graphscript:id 00000000-0000-0000-0000-000000000001\nexport const appState = { counter: 0, current: () => appState.counter };\n');
    await writeFile(join(project, 'nodes', 'caller.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000002\nimport { appState } from "@graph";\ntype Counter = typeof appState.counter;\nexport function caller(key: string) { let alias = appState; alias = { counter: 1 }; alias.counter; appState[key]; function shadow(appState: { counter: number }) { return appState.counter; } return shadow; }\n');
    await writeFile(join(project, 'nodes', 'unused.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000003\nimport { appState } from "@graph";\nexport function unused() {}\n');
    await writeFile(join(project, 'nodes', 'typed.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000004\nimport type { appState } from "@graph";\nexport function typed(value: typeof appState.counter) { return value; }\n');
    assert.deepEqual(readGraph(project).edges, [
      { fromId: '00000000-0000-0000-0000-000000000001', toId: '00000000-0000-0000-0000-000000000001', property: 'counter', access: 'read' },
    ]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('classifies state writes in destructuring, loops, deletion, and TypeScript wrappers', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-graph-'));
  try {
    await mkdir(join(project, 'nodes'));
    await writeFile(join(project, 'nodes', 'appState.ts'), '"graphscript:state";\n// graphscript:id 00000000-0000-0000-0000-000000000001\nexport const appState = { destructured: 0, iterated: 0, removed: 0, asserted: 0 };\n');
    await writeFile(join(project, 'nodes', 'caller.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000002\nimport { appState } from "@graph";\nexport function caller(source: any, values: number[]) { ({ value: appState.destructured } = source); for (appState.iterated of values) {} delete appState.removed; (appState.asserted as number)++; }\n');
    assert.deepEqual(readGraph(project).edges, [
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'destructured', access: 'write' },
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'iterated', access: 'write' },
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'removed', access: 'write' },
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'asserted', access: 'read' },
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'asserted', access: 'write' },
    ]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('resolves state access through TypeScript wrappers without duplicating edges', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-graph-'));
  try {
    await mkdir(join(project, 'nodes'));
    await writeFile(join(project, 'nodes', 'appState.ts'), '"graphscript:state";\n// graphscript:id 00000000-0000-0000-0000-000000000001\nexport const appState = { counter: 0 };\n');
    await writeFile(join(project, 'nodes', 'caller.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000002\nimport { appState } from "@graph";\nexport function caller() { (appState as typeof appState).counter++; appState["counter"]; return appState?.counter; }\n');
    assert.deepEqual(readGraph(project).edges, [
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'counter', access: 'read' },
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'counter', access: 'write' },
    ]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('resolves nested state destructuring from a graph namespace', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-graph-'));
  try {
    await mkdir(join(project, 'nodes'));
    await writeFile(join(project, 'nodes', 'appState.ts'), '"graphscript:state";\n// graphscript:id 00000000-0000-0000-0000-000000000001\nexport const appState = { counter: 0, other: 0 };\n');
    await writeFile(join(project, 'nodes', 'caller.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000002\nimport * as graph from "@graph";\nexport function caller() { const { appState: { counter } } = graph; const { appState: { other } = { other: 1 } } = graph; return [counter, other]; }\n');
    assert.deepEqual(readGraph(project).edges, [
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'counter', access: 'read' },
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001', property: 'other', access: 'read' },
    ]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('omits type-only references, unused imports, and shadowed names', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-graph-'));
  try {
    await mkdir(join(project, 'nodes'));
    await writeFile(join(project, 'nodes', 'target.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000001\nexport function target() {}\n');
    await writeFile(join(project, 'nodes', 'Account.ts'), '"graphscript:class";\n// graphscript:id 00000000-0000-0000-0000-000000000003\nexport class Account {}\n');
    await writeFile(join(project, 'nodes', 'caller.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000002\nimport { target, Account } from "@graph";\nexport function caller(value: Account, target: () => void) { target(); return value; }\n');
    assert.deepEqual(readGraph(project).edges, []);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('reports one edge per runtime target for function and class values', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-graph-'));
  try {
    await mkdir(join(project, 'nodes'));
    await writeFile(join(project, 'nodes', 'target.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000001\nexport function target() {}\n');
    await writeFile(join(project, 'nodes', 'Account.ts'), '"graphscript:class";\n// graphscript:id 00000000-0000-0000-0000-000000000003\nexport class Account {}\n');
    await writeFile(join(project, 'nodes', 'caller.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000002\nimport { target as action, Account } from "@graph";\nexport function caller() { action(); return [action, new Account(), Account]; }\n');
    assert.deepEqual(readGraph(project).edges, [
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001' },
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000003' },
    ]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('resolves statically named namespace members without treating type use as runtime use', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-graph-'));
  try {
    await mkdir(join(project, 'nodes'));
    await writeFile(join(project, 'nodes', 'target.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000001\nexport function target() {}\n');
    await writeFile(join(project, 'nodes', 'Account.ts'), '"graphscript:class";\n// graphscript:id 00000000-0000-0000-0000-000000000003\nexport class Account {}\n');
    await writeFile(join(project, 'nodes', 'caller.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000002\nimport * as graph from "@graph";\nexport function caller(value: graph.Account) { graph.target(); return [graph["target"], value]; }\n');
    assert.deepEqual(readGraph(project).edges, [
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001' },
    ]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('omits type queries and ambient declarations', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-graph-'));
  try {
    await mkdir(join(project, 'nodes'));
    await writeFile(join(project, 'nodes', 'target.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000001\nexport function target() {}\n');
    await writeFile(join(project, 'nodes', 'Account.ts'), '"graphscript:class";\n// graphscript:id 00000000-0000-0000-0000-000000000003\nexport class Account {}\n');
    await writeFile(join(project, 'nodes', 'caller.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000002\nimport { target, Account } from "@graph";\ntype Target = typeof target;\ndeclare const value: typeof Account;\nexport function caller(): Target | undefined { return undefined; }\n');
    assert.deepEqual(readGraph(project).edges, []);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('reports a self edge for a recursive function', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-graph-'));
  try {
    await mkdir(join(project, 'nodes'));
    await writeFile(join(project, 'nodes', 'target.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000001\nexport function target() { target(); }\n');
    assert.deepEqual(readGraph(project).edges, [
      { fromId: '00000000-0000-0000-0000-000000000001', toId: '00000000-0000-0000-0000-000000000001' },
    ]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('resolves static members of literal dynamic graph imports', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-graph-'));
  try {
    await mkdir(join(project, 'nodes'));
    await writeFile(join(project, 'nodes', 'target.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000001\nexport function target() {}\n');
    await writeFile(join(project, 'nodes', 'Account.ts'), '"graphscript:class";\n// graphscript:id 00000000-0000-0000-0000-000000000003\nexport class Account {}\n');
    await writeFile(join(project, 'nodes', 'caller.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000002\nexport async function caller() { const graph = await import("@graph"); graph.target(); return (await import("@graph")).Account; }\n');
    assert.deepEqual(readGraph(project).edges, [
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001' },
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000003' },
    ]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('reports dependencies from class and state nodes in runtime expressions', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-graph-'));
  try {
    await mkdir(join(project, 'nodes'));
    await writeFile(join(project, 'nodes', 'target.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000001\nexport function target() {}\n');
    await writeFile(join(project, 'nodes', 'Account.ts'), '"graphscript:class";\n// graphscript:id 00000000-0000-0000-0000-000000000003\nimport { target } from "@graph";\nexport class Account { run = target as typeof target; }\n');
    await writeFile(join(project, 'nodes', 'settings.ts'), '"graphscript:state";\n// graphscript:id 00000000-0000-0000-0000-000000000004\nimport { Account } from "@graph";\nexport const settings = { current: new Account() };\n');
    assert.deepEqual(readGraph(project).edges, [
      { fromId: '00000000-0000-0000-0000-000000000003', toId: '00000000-0000-0000-0000-000000000001' },
      { fromId: '00000000-0000-0000-0000-000000000004', toId: '00000000-0000-0000-0000-000000000003' },
    ]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('resolves a namespace member with a static template-literal name', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-graph-'));
  try {
    await mkdir(join(project, 'nodes'));
    await writeFile(join(project, 'nodes', 'target.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000001\nexport function target() {}\n');
    await writeFile(join(project, 'nodes', 'caller.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000002\nimport * as graph from "@graph";\nexport function caller() { graph[`target`](); }\n');
    assert.deepEqual(readGraph(project).edges, [
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001' },
    ]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('resolves destructured static and awaited graph namespace members', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-graph-'));
  try {
    await mkdir(join(project, 'nodes'));
    await writeFile(join(project, 'nodes', 'target.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000001\nexport function target() {}\n');
    await writeFile(join(project, 'nodes', 'Account.ts'), '"graphscript:class";\n// graphscript:id 00000000-0000-0000-0000-000000000003\nexport class Account {}\n');
    await writeFile(join(project, 'nodes', 'caller.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000002\nimport * as graph from "@graph";\nexport async function caller() { const { target: action } = graph; const { Account } = await import("@graph"); action(); return Account; }\n');
    assert.deepEqual(readGraph(project).edges, [
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001' },
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000003' },
    ]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test('resolves constant aliases of static and dynamic graph namespaces', async () => {
  const project = await mkdtemp(join(tmpdir(), 'graphscript-graph-'));
  try {
    await mkdir(join(project, 'nodes'));
    await writeFile(join(project, 'nodes', 'target.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000001\nexport function target() {}\n');
    await writeFile(join(project, 'nodes', 'Account.ts'), '"graphscript:class";\n// graphscript:id 00000000-0000-0000-0000-000000000003\nexport class Account {}\n');
    await writeFile(join(project, 'nodes', 'caller.ts'), '"graphscript:function";\n// graphscript:id 00000000-0000-0000-0000-000000000002\nimport * as graph from "@graph";\nexport async function caller() { const alias = graph; const next = alias; next.target(); const dynamic = await import("@graph"); const other = dynamic; return other.Account; }\n');
    assert.deepEqual(readGraph(project).edges, [
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000001' },
      { fromId: '00000000-0000-0000-0000-000000000002', toId: '00000000-0000-0000-0000-000000000003' },
    ]);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});