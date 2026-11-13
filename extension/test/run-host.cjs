const { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { createServer } = require('node:net');
const { runTests } = require('@vscode/test-electron');

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function runHost(options, fixture) {
  let timedOut = false;
  let forceTimer;
  let exitTimer;
  const keepAlive = () => {};
  process.on('SIGINT', keepAlive);
  const timer = setTimeout(() => {
    timedOut = true;
    console.error(`VS Code host timed out after 60000ms: ${fixture}`);
    process.kill(process.pid, 'SIGINT');
    forceTimer = setTimeout(() => process.kill(process.pid, 'SIGINT'), 5000);
    exitTimer = setTimeout(() => {
      console.error(`VS Code host did not exit after forced shutdown: ${fixture}`);
      process.exit(1);
    }, 10000);
  }, 60000);
  try {
    await runTests(options);
    if (timedOut) throw new Error(`VS Code host timed out after 60000ms: ${fixture}`);
  } catch (error) {
    if (timedOut) throw new Error(`VS Code host timed out after 60000ms: ${fixture}`, { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
    clearTimeout(forceTimer);
    clearTimeout(exitTimer);
    process.removeListener('SIGINT', keepAlive);
  }
}

async function main() {
  const temporary = mkdtempSync(join(tmpdir(), 'graphscript-host-'));
  try {
    if (!process.env.GRAPHSCRIPT_HOST_FIXTURE || process.env.GRAPHSCRIPT_HOST_FIXTURE === 'setup') {
      const project = join(temporary, 'program');
      const library = join(temporary, 'library');
      for (const folder of [project, library]) {
        mkdirSync(join(folder, 'node_modules', '@arcmantle'), { recursive: true });
        symlinkSync(resolve(__dirname, '../..'), join(folder, 'node_modules', '@arcmantle', 'graphscript'), 'dir');
      }
      const workspace = join(temporary, 'setup.code-workspace');
      writeFileSync(workspace, JSON.stringify({ folders: [{ path: project }, { path: library }] }));
      mkdirSync(join(temporary, 'user-setup', 'User'), { recursive: true });
      writeFileSync(join(temporary, 'user-setup', 'User', 'settings.json'), JSON.stringify({ 'window.menuStyle': 'custom' }));
      const debugPort = await availablePort();
      await runHost({
        vscodeExecutablePath: process.env.VSCODE_EXECUTABLE || '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
        extensionDevelopmentPath: resolve(__dirname, '..'),
        extensionTestsPath: resolve(__dirname, 'host.cjs'),
        extensionTestsEnv: { GRAPHSCRIPT_FIXTURE: 'setup', GRAPHSCRIPT_DEBUG_PORT: String(debugPort) },
        launchArgs: [workspace, '--disable-workspace-trust', '--disable-extensions', '--skip-welcome',
          `--remote-debugging-port=${debugPort}`, '--remote-allow-origins=*',
          '--user-data-dir', join(temporary, 'user-setup'), '--extensions-dir', join(temporary, 'extensions-setup')],
      }, 'setup');
      if (process.env.GRAPHSCRIPT_HOST_FIXTURE === 'setup') return;
    }
    const decoy = join(temporary, 'node_modules', '@arcmantle', 'graphscript');
    mkdirSync(decoy, { recursive: true });
    writeFileSync(join(decoy, 'package.json'), JSON.stringify({ name: '@arcmantle/graphscript', version: '0.1.0', bin: 'cli.js' }));
    writeFileSync(join(decoy, 'cli.js'), '');
    for (const fixture of ['compatible', 'missing', 'unsupported', 'broken']) {
      const project = join(temporary, fixture);
      mkdirSync(join(project, 'nodes'), { recursive: true });
      writeFileSync(join(project, 'example.ts'), 'export {};\n');
      if (fixture === 'compatible') {
        mkdirSync(join(project, 'node_modules', '@arcmantle'), { recursive: true });
        symlinkSync(resolve(__dirname, '../..'), join(project, 'node_modules', '@arcmantle', 'graphscript'), 'dir');
        writeFileSync(join(project, 'nodes', 'greet.ts'), '"graphscript:function";\n// graphscript:id 550e8400-e29b-41d4-a716-446655440000\nimport { Account, settings } from "@graph";\nexport function greet() { return [new Account(), settings.count]; }\n');
        writeFileSync(join(project, 'nodes', 'Account.ts'), '"graphscript:class";\n// graphscript:id 550e8400-e29b-41d4-a716-446655440001\nimport { distant } from "@graph";\nexport class Account { value = distant(); }\n');
        writeFileSync(join(project, 'nodes', 'settings.ts'), '"graphscript:state";\n// graphscript:id 550e8400-e29b-41d4-a716-446655440002\nexport const settings = { count: 0 };\n');
        writeFileSync(join(project, 'nodes', 'caller.ts'), '"graphscript:function";\n// graphscript:id 550e8400-e29b-41d4-a716-446655440003\nimport { greet } from "@graph";\nexport function caller() { return greet(); }\n');
        const branches = Array.from({ length: 12 }, (_, index) => `branch${index}`);
        writeFileSync(join(project, 'nodes', 'distant.ts'), `"graphscript:function";\n// graphscript:id 550e8400-e29b-41d4-a716-446655440004\nimport { tier3, ${branches.join(', ')} } from "@graph";\nexport function distant() { return [tier3(), ${branches.map(name => `${name}()`).join(', ')}]; }\n`);
        writeFileSync(join(project, 'nodes', 'tier3.ts'), '"graphscript:function";\n// graphscript:id 550e8400-e29b-41d4-a716-446655440005\nimport { tier4 } from "@graph";\nexport function tier3() { return tier4(); }\n');
        writeFileSync(join(project, 'nodes', 'tier4.ts'), '"graphscript:function";\n// graphscript:id 550e8400-e29b-41d4-a716-446655440006\nexport function tier4() {}\n');
        writeFileSync(join(project, 'nodes', 'isolated.ts'), '"graphscript:function";\n// graphscript:id 550e8400-e29b-41d4-a716-446655440007\nexport function isolated() {}\n');
        for (const [index, name] of branches.entries()) {
          const id = String(100 + index).padStart(12, '0');
          writeFileSync(join(project, 'nodes', `${name}.ts`), `"graphscript:function";\n// graphscript:id 550e8400-e29b-41d4-a716-${id}\nexport function ${name}() {}\n`);
        }
        writeFileSync(join(project, 'nodes', 'notes.txt'), 'notes\n');
      } else if (fixture !== 'missing') {
        const compiler = join(project, 'node_modules', '@arcmantle', 'graphscript');
        mkdirSync(join(compiler, 'src'), { recursive: true });
        writeFileSync(join(compiler, 'package.json'), JSON.stringify({
          name: '@arcmantle/graphscript', version: fixture === 'unsupported' ? '0.2.0' : '0.1.0', bin: 'src/cli.js',
        }));
        writeFileSync(join(compiler, 'src', 'cli.js'), '');
        writeFileSync(join(compiler, 'src', 'graph.js'), fixture === 'broken'
          ? "throw new Error('broken fixture');\n" : "exports.readGraph = () => 'project compiler';\n");
      }
      if (fixture === 'missing') writeFileSync(join(project, 'nodes', 'missing.ts'), 'export {};\n');
      if (process.env.GRAPHSCRIPT_HOST_FIXTURE === 'mixed') continue;
      console.log(`Testing ${fixture} compiler`);
      const debugPort = await availablePort();
      await runHost({
        vscodeExecutablePath: process.env.VSCODE_EXECUTABLE || '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
        extensionDevelopmentPath: resolve(__dirname, '..'),
        extensionTestsPath: resolve(__dirname, 'host.cjs'),
        extensionTestsEnv: { GRAPHSCRIPT_FIXTURE: fixture, GRAPHSCRIPT_DEBUG_PORT: String(debugPort) },
        launchArgs: [project, '--disable-workspace-trust', '--disable-extensions', '--skip-welcome',
          `--remote-debugging-port=${debugPort}`, '--remote-allow-origins=*',
          '--user-data-dir', join(temporary, `user-${fixture}`), '--extensions-dir', join(temporary, `extensions-${fixture}`)],
      }, fixture);
      if (process.env.GRAPHSCRIPT_HOST_FIXTURE === fixture) return;
    }
    const workspace = join(temporary, 'mixed.code-workspace');
    writeFileSync(workspace, JSON.stringify({ folders: [{ path: join(temporary, 'compatible') }, { path: join(temporary, 'missing') }] }));
    mkdirSync(join(temporary, 'user-mixed', 'User'), { recursive: true });
    writeFileSync(join(temporary, 'user-mixed', 'User', 'settings.json'), JSON.stringify({ 'window.menuStyle': 'custom' }));
    console.log('Testing mixed-root menus');
    const debugPort = await availablePort();
    await runHost({
      vscodeExecutablePath: process.env.VSCODE_EXECUTABLE || '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
      extensionDevelopmentPath: resolve(__dirname, '..'),
      extensionTestsPath: resolve(__dirname, 'host.cjs'),
      extensionTestsEnv: { GRAPHSCRIPT_FIXTURE: 'mixed', GRAPHSCRIPT_DEBUG_PORT: String(debugPort) },
      launchArgs: [workspace, '--disable-workspace-trust', '--disable-extensions', '--skip-welcome',
        `--remote-debugging-port=${debugPort}`, '--remote-allow-origins=*',
        '--user-data-dir', join(temporary, 'user-mixed'), '--extensions-dir', join(temporary, 'extensions-mixed')],
    }, 'mixed');
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });