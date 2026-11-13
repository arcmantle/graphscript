const { existsSync, realpathSync, statSync } = require('node:fs');
const { basename, dirname, join } = require('node:path');
const vscode = require('vscode');
const { resolveCompiler } = require('./compiler');

function sameDirectory(left, right) {
  return left && left.dev === right.dev && left.ino === right.ino;
}

function directoryIdentity(stat) {
  return `${stat.dev}:${stat.ino}`;
}

function isManagedDirectory(candidate, directory, directoryStat, rememberedDirectories) {
  if (rememberedDirectories?.has(directoryIdentity(directoryStat))) return true;
  try {
    const candidateStat = statSync(candidate, { bigint: true });
    return sameDirectory(candidateStat, directoryStat);
  } catch {
    if (candidate === directory) return true;
    try {
      return join(realpathSync(dirname(candidate)), basename(candidate)) === realpathSync(directory);
    } catch {
      return false;
    }
  }
}

function activate(context) {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  status.command = 'graphscript.checkCompiler';
  const states = new Map();
  const documentDirectories = new WeakMap();
  function rememberDirectory(document) {
    if (document.uri.scheme !== 'file') return;
    try {
      const identity = directoryIdentity(statSync(dirname(document.uri.fsPath), { bigint: true }));
      const directories = documentDirectories.get(document) || new Set();
      directories.add(identity);
      documentDirectories.set(document, directories);
    } catch {}
  }
  vscode.workspace.textDocuments.forEach(rememberDirectory);
  function rememberCleanDirectory(document) {
    documentDirectories.delete(document);
    rememberDirectory(document);
  }
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(rememberDirectory),
    vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.isDirty) rememberDirectory(event.document);
      else rememberCleanDirectory(event.document);
    }),
    vscode.workspace.onDidSaveTextDocument(rememberCleanDirectory),
  );
  context.subscriptions.push(status);

  async function refresh(notify = false) {
    states.clear();
    const nodeDirectories = [];
    for (const folder of vscode.workspace.workspaceFolders || []) {
      if (folder.uri.scheme !== 'file' || !existsSync(join(folder.uri.fsPath, 'nodes'))) continue;
      try {
        if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace to use the project-local GraphScript compiler.');
        const compiler = resolveCompiler(folder.uri.fsPath);
        let graph;
        try {
          graph = require(join(compiler.directory, 'src', 'graph.js'));
          if (typeof graph.readGraph !== 'function') throw new Error('readGraph is not available');
        } catch (error) {
          throw new Error(`Cannot load the project-local GraphScript compiler graph API: ${error.message}`);
        }
        states.set(folder.uri.toString(), { compiler: { ...compiler, readGraph: graph.readGraph, watchGraph: graph.watchGraph } });
        nodeDirectories.push(join(folder.uri.fsPath, 'nodes'));
      } catch (error) {
        states.set(folder.uri.toString(), { error: error.message });
        if (notify) void vscode.window.showErrorMessage(`${folder.name}: ${error.message}`);
      }
    }
    const values = [...states.values()];
    await vscode.commands.executeCommand('setContext', 'graphscript.nodeDirectories', nodeDirectories);
    if (!values.length) {
      status.hide();
    } else {
      const failures = values.filter(value => value.error);
      status.text = failures.length ? '$(warning) GraphScript compiler' : '$(check) GraphScript compiler';
      status.tooltip = failures.length ? failures.map(value => value.error).join('\n') : 'Project-local compiler available';
      status.show();
    }
  }

  async function getCompiler(uri) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) throw new Error('The file is not in a GraphScript workspace folder.');
    await refresh();
    const state = states.get(folder.uri.toString());
    if (!state) throw new Error('This workspace folder is not a GraphScript project.');
    if (state.error) throw new Error(state.error);
    return state.compiler;
  }

  async function selectFolder(uri) {
    const folders = vscode.workspace.workspaceFolders || [];
    return uri ? vscode.workspace.getWorkspaceFolder(uri)
      : folders.length === 1 ? folders[0] : vscode.window.showWorkspaceFolderPick();
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('graphscript.checkCompiler', () => refresh(true)),
    vscode.commands.registerCommand('graphscript.setupProject', async uri => {
      const folder = await selectFolder(uri);
      if (!folder) return;
      if (folder.uri.scheme !== 'file') throw new Error('GraphScript requires a local workspace folder.');
      if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace to use the project-local GraphScript compiler.');
      const compiler = resolveCompiler(folder.uri.fsPath);
      const kind = await vscode.window.showQuickPick(['Program', 'Library'], { placeHolder: 'Select a project kind' });
      if (!kind) return;
      const { initializeProject } = require(join(compiler.directory, 'src', 'project.js'));
      initializeProject(folder.uri.fsPath, { kind: kind.toLowerCase() });
      await refresh();
    }),
    vscode.commands.registerCommand('graphscript.createNode', async uri => {
      const folder = await selectFolder(uri);
      if (!folder) return;
      const compiler = await getCompiler(folder.uri);
      const kind = await vscode.window.showQuickPick(['Function', 'Class', 'State'], { placeHolder: 'Select a node kind' });
      if (!kind) return;
      const name = await vscode.window.showInputBox({ prompt: `Enter a name for the ${kind.toLowerCase()} node` });
      if (name === undefined) return;
      const directory = join(folder.uri.fsPath, 'nodes');
      const directoryStat = statSync(directory, { bigint: true });
      const dirty = vscode.workspace.textDocuments.some(document => document.isDirty && document.uri.scheme === 'file'
        && document.uri.fsPath.endsWith('.ts') && isManagedDirectory(dirname(document.uri.fsPath), directory, directoryStat, documentDirectories.get(document)));
      if (dirty) throw new Error('Save or discard unsaved changes in the nodes directory before creating a node.');
      const { createNode } = require(join(compiler.directory, 'src', 'project.js'));
      const file = createNode(folder.uri.fsPath, { kind: kind.toLowerCase(), name });
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(file)));
    }),
    vscode.commands.registerCommand('graphscript.openGraph', async uri => {
      uri = uri || vscode.window.activeTextEditor?.document.uri;
      if (!uri) throw new Error('Select a GraphScript function file.');
      const compiler = await getCompiler(uri);
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      if (typeof compiler.watchGraph !== 'function') throw new Error('The project-local GraphScript compiler graph API does not provide watchGraph.');
      let graph;
      try {
        graph = compiler.readGraph(folder.uri.fsPath);
      } catch (error) {
        void vscode.window.showErrorMessage(`Cannot open graph: ${error.message}`);
        throw error;
      }
      const node = graph.nodes.find(candidate => candidate.file === uri.fsPath && candidate.kind === 'function');
      if (!node) throw new Error('Select a GraphScript function file.');
      const sourceColumn = vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { viewColumn: sourceColumn });
      const panel = vscode.window.createWebviewPanel('graphscript.graph', `Graph: ${node.name}`, vscode.ViewColumn.Beside, {
        enableScripts: true,
        localResourceRoots: [context.extensionUri],
      });
      const resource = (...parts) => panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, ...parts));
      const graphData = () => ({ nodes: graph.nodes.map(({ id, name, kind }) => ({ id, name, kind })), edges: graph.edges, selectedId: node.id });
      const data = JSON.stringify(graphData()).replace(/</g, '\\u003c');
      panel.webview.html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${panel.webview.cspSource}; style-src ${panel.webview.cspSource};">
<link rel="stylesheet" href="${resource('graph.css')}"></head>
<body><div id="graph-error" role="alert" hidden></div><div id="selection-notice" role="status" hidden>The selected node is not in the saved graph. Restore it or select another node.</div><div id="depth-controls" aria-label="Graph depth"><button type="button" data-depth="1" aria-pressed="true">Depth 1</button><button type="button" data-depth="2" aria-pressed="false">Depth 2</button><button type="button" data-depth="3" aria-pressed="false">Depth 3</button><button type="button" data-depth="full" aria-pressed="false">Full graph</button></div><div id="graph" aria-label="Directed dependency graph"></div><section id="dependencies" aria-label="Direct dependencies"><h2>Direct dependencies</h2><div id="dependency-list"></div></section><div id="graph-controls" aria-label="Graph nodes"></div>
<script type="application/json" id="graph-data">${data}</script>
<script src="${resource('node_modules', 'cytoscape', 'dist', 'cytoscape.min.js')}"></script>
<script src="${resource('graph-webview.js')}"></script></body></html>`;
      let currentError;
      const publish = () => panel.webview.postMessage({ type: 'graph', graph: graphData(), error: currentError });
      let watcher;
      try {
        watcher = compiler.watchGraph(folder.uri.fsPath, result => {
          currentError = result.error?.message;
          if (result.graph) graph = result.graph;
          void publish();
        });
        try {
          graph = compiler.readGraph(folder.uri.fsPath);
        } catch (error) {
          currentError = error.message;
        }
      } catch (error) {
        panel.dispose();
        throw error;
      }
      const messages = panel.webview.onDidReceiveMessage(async message => {
        if (message?.type === 'ready') void publish();
        const selected = graph.nodes.find(candidate => candidate.id === message?.id);
        if (message?.type === 'open' && selected) {
          const document = await vscode.workspace.openTextDocument(vscode.Uri.file(selected.file));
          await vscode.window.showTextDocument(document, { viewColumn: sourceColumn });
        }
      });
      panel.onDidDispose(() => { messages.dispose(); watcher.close(); });
      return panel;
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void refresh(true)),
    vscode.workspace.onDidGrantWorkspaceTrust(() => void refresh(true)),
  );
  void refresh(true);

  return { getCompiler };
}

module.exports = { activate };