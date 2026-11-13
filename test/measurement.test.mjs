import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('../benchmarks/measure.cjs', import.meta.url));
const { readGraph } = createRequire(import.meta.url)('../src/graph.js');

test('measures a persistent project without replacing its source files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'graphscript-measure-test-'));
  const project = join(directory, 'project');
  const run = action => spawnSync(process.execPath, [script, action, project], { encoding: 'utf8' });
  try {
    const prepared = run('prepare');
    assert.equal(prepared.status, 0, prepared.stderr);
    const files = await readdir(join(project, 'nodes'));
    assert.equal(files.length, 120);
    const sources = await Promise.all(files.map(file => readFile(join(project, 'nodes', file), 'utf8')));
    const graph = readGraph(project);
    const ids = new Map(graph.nodes.map(node => [node.name, node.id]));
    const expectedEdges = [];
    for (let group = 0; group < 40; group++) {
      const number = String(group).padStart(3, '0');
      const state = ids.get(`state${number}`);
      const update = ids.get(`update${number}`);
      const reader = ids.get(`Reader${number}`);
      expectedEdges.push({ fromId: update, toId: state, property: 'count', access: 'read' });
      expectedEdges.push({ fromId: update, toId: state, property: 'count', access: 'write' });
      expectedEdges.push({ fromId: reader, toId: state, property: 'label', access: 'read' });
      expectedEdges.push({ fromId: reader, toId: update });
      if (group) expectedEdges.push({ fromId: update, toId: ids.get(`update${String(group - 1).padStart(3, '0')}`) });
    }
    const normalize = edges => edges.map(edge => JSON.stringify(edge)).sort();
    assert.deepEqual(normalize(graph.edges), normalize(expectedEdges));
    const fixtureHash = createHash('sha256');
    for (const [index, file] of files.entries()) fixtureHash.update(file).update('\0').update(sources[index]).update('\0');
    const expectedFixtureHash = fixtureHash.digest('hex');
    const lockfileHash = createHash('sha256').update(await readFile(new URL('../package-lock.json', import.meta.url))).digest('hex');
    for (let iteration = 0; iteration < 2; iteration++) {
      const measured = run('measure');
      assert.equal(measured.status, 0, measured.stderr);
      const result = JSON.parse(measured.stdout);
      assert.deepEqual(result.projectShape, { nodes: 120, kinds: { function: 40, class: 40, state: 40 }, imports: 159, edges: 199 });
      assert.equal(result.diagnostics, 0);
      assert.equal(result.typescriptDiagnostics, 0);
      assert.equal(typeof result.milliseconds.graphRead, 'number');
      assert.equal(typeof result.milliseconds.typescriptCheck, 'number');
      assert.equal(typeof result.milliseconds.checkIncludingGraph, 'number');
      assert.equal(result.tools.node, process.version);
      assert.equal(result.sha256.fixture, expectedFixtureHash);
      assert.match(result.sha256.implementation, /^[0-9a-f]{64}$/);
      assert.equal(result.sha256.lockfile, lockfileHash);
    }
    assert.deepEqual(await readdir(join(project, 'nodes')), files);
    assert.deepEqual(await Promise.all(files.map(file => readFile(join(project, 'nodes', file), 'utf8'))), sources);
    const changedFile = join(project, 'nodes', 'update000.ts');
    const original = await readFile(changedFile, 'utf8');
    await writeFile(changedFile, `${original}\n`);
    const changed = run('measure');
    assert.equal(changed.status, 0, changed.stderr);
    assert.notEqual(JSON.parse(changed.stdout).sha256.fixture, expectedFixtureHash);
    await writeFile(changedFile, original.replace('value: number', 'value: string'));
    const invalid = run('measure');
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /TypeScript diagnostics:/);
    await writeFile(changedFile, original);
    const readerFile = join(project, 'nodes', 'Reader000.ts');
    const reader = await readFile(readerFile, 'utf8');
    await writeFile(readerFile, reader.replace('return state000.label', 'return "fixed"'));
    const wrongShape = run('measure');
    assert.notEqual(wrongShape.status, 0);
    assert.match(wrongShape.stderr, /Unexpected measurement project or diagnostics:/);
    await writeFile(readerFile, reader);
    assert.notEqual(run('prepare').status, 0);
    assert.deepEqual(await Promise.all(files.map(file => readFile(join(project, 'nodes', file), 'utf8'))), sources);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});