const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const { join, resolve } = require('node:path');
const { performance } = require('node:perf_hooks');
const { API } = require('typescript/unstable/sync');
const { checkProject } = require('../src/check');
const { readGraph } = require('../src/graph');

const groups = 40;
const [action, directory] = process.argv.slice(2);
if (!['prepare', 'measure'].includes(action) || !directory || process.argv.length !== 4) {
  throw new Error('Usage: node benchmarks/measure.cjs <prepare|measure> <project-directory>');
}
const project = resolve(directory);

if (action === 'prepare') {
  mkdirSync(project);
  mkdirSync(join(project, 'nodes'));
  for (let group = 0; group < groups; group++) {
    const number = String(group).padStart(3, '0');
    const previous = String(group - 1).padStart(3, '0');
    const nodes = [
      ['state', `state${number}`, `export const state${number} = { count: 0, label: "group ${number}" };`],
      ['function', `update${number}`, `import { state${number}${group ? `, update${previous}` : ''} } from "@graph";\nexport function update${number}(value: number): number { state${number}.count += value; return state${number}.count${group ? ` + update${previous}(0)` : ''}; }`],
      ['class', `Reader${number}`, `import { state${number}, update${number} } from "@graph";\nexport class Reader${number} { read(): string { return state${number}.label; } update(value: number): number { return update${number}(value); } }`],
    ];
    for (const [index, [kind, name, source]] of nodes.entries()) {
      const id = (group * 3 + index + 1).toString(16).padStart(12, '0');
      writeFileSync(join(project, 'nodes', `${name}.ts`), `"graphscript:${kind}";\n// graphscript:id 00000000-0000-4000-8000-${id}\n${source}\n`, { flag: 'wx' });
    }
  }
  console.log(`Created ${groups * 3} persistent node files in ${project}`);
} else {
  const hashFiles = files => {
    const hash = createHash('sha256');
    for (const [name, file] of files) hash.update(name).update('\0').update(readFileSync(file)).update('\0');
    return hash.digest('hex');
  };
  const fixtureFiles = readdirSync(join(project, 'nodes')).sort().map(name => [name, join(project, 'nodes', name)]);
  const implementationFiles = ['benchmarks/measure.cjs', 'src/check.js', 'src/graph.js']
    .map(name => [name, join(__dirname, '..', name)]);
  const graphStart = performance.now();
  const graph = readGraph(project);
  const graphMilliseconds = performance.now() - graphStart;
  const temporary = mkdtempSync(join(os.tmpdir(), 'graphscript-measure-check-'));
  let typescriptMilliseconds;
  let typescriptDiagnostics;
  try {
    const index = join(temporary, 'index.ts');
    const files = fixtureFiles.filter(([name]) => name.endsWith('.ts')).map(([, file]) => file);
    writeFileSync(index, graph.nodes.map(node => `export { ${node.name} } from ${JSON.stringify(node.file.replace(/\.ts$/, '.js'))};`).join('\n'));
    const config = join(temporary, 'tsconfig.json');
    writeFileSync(config, JSON.stringify({ compilerOptions: { noEmit: true, strict: true, target: 'esnext', module: 'nodenext', paths: { '@graph': [index] } }, files }));
    const typescriptStart = performance.now();
    const api = new API({ cwd: project });
    try {
      const program = api.updateSnapshot({ openProjects: [config] }).getProject(config).program;
      typescriptDiagnostics = [...program.getConfigFileParsingDiagnostics(), ...program.getProgramDiagnostics(),
        ...program.getGlobalDiagnostics(), ...program.getSyntacticDiagnostics(), ...program.getBindDiagnostics(), ...program.getSemanticDiagnostics()];
    } finally {
      api.close();
    }
    typescriptMilliseconds = performance.now() - typescriptStart;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  if (typescriptDiagnostics.length) {
    throw new Error(`TypeScript diagnostics: ${JSON.stringify(typescriptDiagnostics)}`);
  }
  const checkStart = performance.now();
  const check = checkProject(project);
  const checkMilliseconds = performance.now() - checkStart;
  const kinds = Object.fromEntries(['function', 'class', 'state'].map(kind => [kind, graph.nodes.filter(node => node.kind === kind).length]));
  if (!check.ok || check.diagnostics.length || Object.values(kinds).some(count => count !== groups) || graph.edges.length !== 199) {
    throw new Error(`Unexpected measurement project or diagnostics: ${JSON.stringify({ kinds, edges: graph.edges.length, diagnostics: check.diagnostics })}`);
  }
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    project,
    host: { platform: os.platform(), release: os.release(), osVersion: os.platform() === 'darwin' ? execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim() : os.version(), architecture: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.availableParallelism(), memoryBytes: os.totalmem() },
    tools: { node: process.version, typescript: require('typescript/package.json').version, babelParser: require('@babel/parser/package.json').version, babelTraverse: require('@babel/traverse/package.json').version },
    sha256: { fixture: hashFiles(fixtureFiles), implementation: hashFiles(implementationFiles), lockfile: createHash('sha256').update(readFileSync(join(__dirname, '..', 'package-lock.json'))).digest('hex') },
    projectShape: { nodes: graph.nodes.length, kinds, imports: graph.imports.length, edges: graph.edges.length },
    milliseconds: { graphRead: graphMilliseconds, typescriptCheck: typescriptMilliseconds, checkIncludingGraph: checkMilliseconds },
    typescriptDiagnostics: typescriptDiagnostics.length,
    diagnostics: check.diagnostics.length,
  }, null, 2));
}