const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { chromium } = require('playwright-core');
const vscode = require('vscode');

async function checkMixedMenus(api) {
  const [compatible, missing] = vscode.workspace.workspaceFolders;
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.GRAPHSCRIPT_DEBUG_PORT}`, { timeout: 10000 });
  try {
    const page = browser.contexts()[0].pages()[0];
    page.setDefaultTimeout(5000);
    const files = [
      { uri: vscode.Uri.joinPath(compatible.uri, 'nodes', 'greet.ts'), visible: true },
      { uri: vscode.Uri.joinPath(missing.uri, 'nodes', 'missing.ts'), visible: false },
      { uri: vscode.Uri.joinPath(compatible.uri, 'example.ts'), visible: false },
      { uri: vscode.Uri.joinPath(compatible.uri, 'nodes', 'notes.txt'), visible: false },
    ];
    await api.getCompiler(files[0].uri);
    await assert.rejects(api.getCompiler(files[1].uri), /missing.*project/i);
    await assert.rejects(vscode.commands.executeCommand('graphscript.openGraph', files[1].uri), /missing.*project/i);
    for (const { uri, visible } of files) {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
      await vscode.commands.executeCommand('workbench.files.action.showActiveFileInExplorer');
      const row = page.locator('.explorer-item').and(page.getByLabel(uri.fsPath, { exact: true }));
      await row.click({ button: 'right', force: true, timeout: 5000 });
      const menu = page.locator('.context-view .monaco-menu:visible');
      const command = menu.getByRole('menuitem', { name: 'GraphScript: Open Function Graph' });
      await menu.waitFor({ state: 'visible', timeout: 5000 });
      assert.equal(await command.count() > 0, visible, `explorer menu for ${uri.fsPath}`);
      await page.keyboard.press('Escape');
      await page.locator('.editor-instance:visible .monaco-editor:visible').first().click({ button: 'right', force: true, position: { x: 120, y: 30 }, timeout: 5000 });
      await menu.waitFor({ state: 'visible', timeout: 5000 });
      assert.equal(await command.count() > 0, visible, `editor menu for ${uri.fsPath}`);
      await page.keyboard.press('Escape');
    }
    const changed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { subscription.dispose(); reject(new Error('Workspace folder removal timed out')); }, 5000);
      const subscription = vscode.workspace.onDidChangeWorkspaceFolders(() => { clearTimeout(timer); subscription.dispose(); resolve(); });
    });
    assert.equal(vscode.workspace.updateWorkspaceFolders(0, 1), true);
    await changed;
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(files[0].uri));
    await page.locator('.editor-instance:visible .monaco-editor:visible').first().click({ button: 'right', force: true, position: { x: 120, y: 30 }, timeout: 5000 });
    const menu = page.locator('.context-view .monaco-menu:visible');
    await menu.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await menu.getByRole('menuitem', { name: 'GraphScript: Open Function Graph' }).count(), 0, 'editor menu after folder removal');
    await page.keyboard.press('Escape');
    await assert.rejects(api.getCompiler(files[0].uri), /not in a GraphScript workspace folder/i);
  } finally {
    await browser.close();
  }
}

exports.run = async function run() {
  const folder = vscode.workspace.workspaceFolders[0];
  const extension = vscode.extensions.getExtension('arcmantle.graphscript-explorer');
  assert.ok(extension, 'extension is available');
  const api = await extension.activate();
  if (process.env.GRAPHSCRIPT_FIXTURE === 'setup') {
    assert.ok((await vscode.commands.getCommands()).includes('graphscript.setupProject'), 'setup command is available');
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.GRAPHSCRIPT_DEBUG_PORT}`);
    try {
      const page = browser.contexts()[0].pages()[0];
      const setup = vscode.commands.executeCommand('graphscript.setupProject', folder.uri);
      await page.getByRole('option', { name: 'Program', exact: true }).click({ timeout: 5000 });
      await setup;
      assert.match(readFileSync(join(folder.uri.fsPath, 'nodes', 'main.ts'), 'utf8'), /^"graphscript:program";/);
      assert.ok((await vscode.commands.getCommands()).includes('graphscript.createNode'), 'node creation command is available');
      for (const [kind, name] of [['Function', 'greet'], ['Class', 'Account'], ['State', 'settings']]) {
        const creation = vscode.commands.executeCommand('graphscript.createNode', folder.uri);
        await page.getByRole('option', { name: kind, exact: true }).click({ timeout: 5000 });
        const input = page.locator('.quick-input-widget input');
        await input.fill(name);
        await input.press('Enter');
        await creation;
        const node = join(folder.uri.fsPath, 'nodes', `${name}.ts`);
        const source = readFileSync(node, 'utf8');
        const id = source.match(/^"graphscript:\w+";\n\/\/ graphscript:id ([0-9a-f-]+)/)?.[1];
        assert.ok(id, `stable ID for ${name}`);
        assert.match(source, new RegExp(`^"graphscript:${kind.toLowerCase()}";`));
        const document = vscode.window.activeTextEditor?.document;
        assert.equal(document?.uri.fsPath, node);
        assert.equal(document.uri.scheme, 'file');
        assert.equal(document.languageId, 'typescript');
        if (kind === 'Function') {
          const edit = new vscode.WorkspaceEdit();
          edit.insert(document.uri, new vscode.Position(document.lineCount, 0), '\n');
          assert.equal(await vscode.workspace.applyEdit(edit), true);
          assert.equal(await document.save(), true);
          const saved = readFileSync(node, 'utf8');
          assert.notEqual(saved, source);
          assert.ok(saved.includes(id));
        }
        assert.equal((await api.getCompiler(document.uri)).readGraph(folder.uri.fsPath).nodes.find(item => item.name === name).id, id);
      }
      const duplicate = vscode.commands.executeCommand('graphscript.createNode', folder.uri).then(() => null, error => error);
      await page.getByRole('option', { name: 'Class', exact: true }).click({ timeout: 5000 });
      await page.locator('.quick-input-widget input').fill('greet');
      await page.locator('.quick-input-widget input').press('Enter');
      const error = await duplicate;
      const cli = spawnSync('node', [join(folder.uri.fsPath, 'node_modules', '@arcmantle', 'graphscript', 'src', 'cli.js'), 'create', 'class', 'greet'], { cwd: folder.uri.fsPath, encoding: 'utf8' });
      assert.notEqual(cli.status, 0);
      assert.equal(error?.message, cli.stderr.trim());
      const library = vscode.workspace.workspaceFolders[1];
      const librarySetup = vscode.commands.executeCommand('graphscript.setupProject', library.uri);
      await page.getByRole('option', { name: 'Library', exact: true }).click({ timeout: 5000 });
      await librarySetup;
      assert.deepEqual(readdirSync(join(library.uri.fsPath, 'nodes')), []);
      async function create(kind, name, target) {
        const creation = vscode.commands.executeCommand('graphscript.createNode', target).then(() => null, error => error);
        await page.getByRole('option', { name: kind, exact: true }).click({ timeout: 5000 });
        const input = page.locator('.quick-input-widget input');
        await input.fill(name);
        await input.press('Enter');
        return creation;
      }
      assert.equal(await create('Function', 'otherRoot', library.uri), null);
      const other = vscode.window.activeTextEditor.document;
      const unrelatedUri = vscode.Uri.joinPath(folder.uri, 'notes.ts');
      writeFileSync(unrelatedUri.fsPath, 'notes\n');
      const unrelated = await vscode.workspace.openTextDocument(unrelatedUri);
      const otherDisk = readFileSync(other.uri.fsPath, 'utf8');
      const unrelatedDisk = readFileSync(unrelated.uri.fsPath, 'utf8');
      const outsideEdits = new vscode.WorkspaceEdit();
      outsideEdits.insert(other.uri, new vscode.Position(0, 0), '// unsaved other root\n');
      outsideEdits.insert(unrelated.uri, new vscode.Position(0, 0), 'unsaved ');
      assert.equal(await vscode.workspace.applyEdit(outsideEdits), true);
      const otherBuffer = other.getText();
      const unrelatedBuffer = unrelated.getText();
      assert.equal(await create('Function', 'allowed', folder.uri), null, 'unrelated dirty documents do not block creation');
      assert.equal(other.isDirty, true);
      assert.equal(unrelated.isDirty, true);
      assert.equal(other.getText(), otherBuffer);
      assert.equal(unrelated.getText(), unrelatedBuffer);
      assert.equal(readFileSync(other.uri.fsPath, 'utf8'), otherDisk);
      assert.equal(readFileSync(unrelated.uri.fsPath, 'utf8'), unrelatedDisk);

      const nodesDirectory = join(folder.uri.fsPath, 'nodes');
      const alternateDirectory = join(folder.uri.fsPath, 'NODES');
      let alternateStat;
      try {
        alternateStat = statSync(alternateDirectory);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (alternateStat) {
        const nodesStat = statSync(nodesDirectory);
        assert.equal(alternateStat.dev, nodesStat.dev);
        assert.equal(alternateStat.ino, nodesStat.ino);
        const alternateUri = vscode.Uri.file(join(alternateDirectory, 'main.ts'));
        const alternateDocument = await vscode.workspace.openTextDocument(alternateUri);
        assert.equal(dirname(alternateDocument.uri.fsPath), alternateDirectory);
        const alternateEdit = new vscode.WorkspaceEdit();
        alternateEdit.insert(alternateDocument.uri, new vscode.Position(0, 0), '// unsaved alias\n');
        assert.equal(await vscode.workspace.applyEdit(alternateEdit), true);
        const aliasFilesBefore = readdirSync(nodesDirectory);
        const aliasError = await create('Function', 'aliasPending', folder.uri);
        assert.match(aliasError?.message ?? '', /save.*nodes|unsaved.*nodes/i);
        assert.deepEqual(readdirSync(nodesDirectory), aliasFilesBefore);
        assert.equal(alternateDocument.isDirty, true);
        await vscode.window.showTextDocument(alternateDocument);
        await vscode.commands.executeCommand('workbench.action.files.revert');
        console.log('PASS alternate-case dirty node blocks creation');
      } else {
        console.log('SKIP alternate-case dirty node: filesystem is case-sensitive');
        mkdirSync(alternateDirectory);
        const distinctUri = vscode.Uri.file(join(alternateDirectory, 'distinct.ts'));
        writeFileSync(distinctUri.fsPath, 'export {};\n');
        const distinctDocument = await vscode.workspace.openTextDocument(distinctUri);
        const distinctEdit = new vscode.WorkspaceEdit();
        distinctEdit.insert(distinctDocument.uri, new vscode.Position(0, 0), '// unsaved distinct directory\n');
        assert.equal(await vscode.workspace.applyEdit(distinctEdit), true);
        assert.equal(await create('Function', 'distinctAllowed', folder.uri), null);
        assert.equal(distinctDocument.isDirty, true);
        await vscode.window.showTextDocument(distinctDocument);
        await vscode.commands.executeCommand('workbench.action.files.revert');
        unlinkSync(distinctUri.fsPath);
        rmdirSync(alternateDirectory);
        console.log('PASS distinct case-sensitive directory does not block creation');
      }

      const linkDirectory = join(folder.uri.fsPath, 'node-link');
      symlinkSync(nodesDirectory, linkDirectory, 'dir');
      const linkDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(join(linkDirectory, 'Account.ts')));
      assert.equal(dirname(linkDocument.uri.fsPath), linkDirectory);
      const linkEdit = new vscode.WorkspaceEdit();
      linkEdit.insert(linkDocument.uri, new vscode.Position(0, 0), '// unsaved symlink\n');
      assert.equal(await vscode.workspace.applyEdit(linkEdit), true);
      const linkFilesBefore = readdirSync(nodesDirectory);
      const linkError = await create('Function', 'linkPending', folder.uri);
      assert.match(linkError?.message ?? '', /save.*nodes|unsaved.*nodes/i);
      assert.deepEqual(readdirSync(nodesDirectory), linkFilesBefore);
      assert.equal(linkDocument.isDirty, true);
      unlinkSync(linkDirectory);
      const removedLinkError = await create('Function', 'removedLinkPending', folder.uri);
      assert.match(removedLinkError?.message ?? '', /save.*nodes|unsaved.*nodes/i);
      assert.deepEqual(readdirSync(nodesDirectory), linkFilesBefore);
      assert.equal(linkDocument.isDirty, true);
      symlinkSync(nodesDirectory, linkDirectory, 'dir');
      await vscode.window.showTextDocument(linkDocument);
      await vscode.commands.executeCommand('workbench.action.files.revert');
      unlinkSync(linkDirectory);
      console.log('PASS symlink dirty node blocks creation');
      console.log('PASS removed symlink dirty node blocks creation');

      const retargetDirectory = join(folder.uri.fsPath, 'retarget-original');
      const retargetLink = join(folder.uri.fsPath, 'retarget-link');
      mkdirSync(retargetDirectory);
      writeFileSync(join(retargetDirectory, 'Account.ts'), 'export {};\n');
      symlinkSync(retargetDirectory, retargetLink, 'dir');
      const retargetDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(join(retargetLink, 'Account.ts')));
      assert.equal(dirname(retargetDocument.uri.fsPath), retargetLink);
      unlinkSync(retargetLink);
      symlinkSync(nodesDirectory, retargetLink, 'dir');
      const retargetEdit = new vscode.WorkspaceEdit();
      retargetEdit.insert(retargetDocument.uri, new vscode.Position(0, 0), '// unsaved retargeted alias\n');
      assert.equal(await vscode.workspace.applyEdit(retargetEdit), true);
      unlinkSync(retargetLink);
      const retargetError = await create('Function', 'retargetPending', folder.uri);
      assert.match(retargetError?.message ?? '', /save.*nodes|unsaved.*nodes/i);
      assert.equal(existsSync(join(nodesDirectory, 'retargetPending.ts')), false);
      assert.equal(retargetDocument.isDirty, true);
      symlinkSync(retargetDirectory, retargetLink, 'dir');
      await vscode.window.showTextDocument(retargetDocument);
      await vscode.commands.executeCommand('workbench.action.files.revert');
      assert.equal(retargetDocument.isDirty, false);
      const unrelatedRetargetEdit = new vscode.WorkspaceEdit();
      unrelatedRetargetEdit.insert(retargetDocument.uri, new vscode.Position(0, 0), '// unsaved unrelated alias\n');
      assert.equal(await vscode.workspace.applyEdit(unrelatedRetargetEdit), true);
      unlinkSync(retargetLink);
      assert.equal(await create('Function', 'retargetOutsideAllowed', folder.uri), null);
      assert.equal(retargetDocument.isDirty, true);
      symlinkSync(retargetDirectory, retargetLink, 'dir');
      await vscode.window.showTextDocument(retargetDocument);
      await vscode.commands.executeCommand('workbench.action.files.revert');
      unlinkSync(retargetLink);
      unlinkSync(join(retargetDirectory, 'Account.ts'));
      rmdirSync(retargetDirectory);
      console.log('PASS removed retargeted symlink dirty node blocks creation');
      console.log('PASS clean document clears old directory identities');

      const missingNodeUri = vscode.Uri.file(join(nodesDirectory, 'missingNode.ts'));
      writeFileSync(missingNodeUri.fsPath, 'export {};\n');
      const missingNode = await vscode.workspace.openTextDocument(missingNodeUri);
      const missingEdit = new vscode.WorkspaceEdit();
      missingEdit.insert(missingNode.uri, new vscode.Position(0, 0), '// unsaved missing node\n');
      assert.equal(await vscode.workspace.applyEdit(missingEdit), true);
      unlinkSync(missingNodeUri.fsPath);
      const missingError = await create('Function', 'missingPending', folder.uri);
      assert.match(missingError?.message ?? '', /save.*nodes|unsaved.*nodes/i);
      assert.equal(existsSync(join(nodesDirectory, 'missingPending.ts')), false);
      assert.equal(missingNode.isDirty, true);
      writeFileSync(missingNodeUri.fsPath, 'export {};\n');
      await vscode.window.showTextDocument(missingNode);
      await vscode.commands.executeCommand('workbench.action.files.revert');
      unlinkSync(missingNodeUri.fsPath);
      console.log('PASS missing dirty node blocks creation');

      const missingDirectory = join(folder.uri.fsPath, 'unrelated-missing');
      const missingUnrelatedUri = vscode.Uri.file(join(missingDirectory, 'notes.ts'));
      mkdirSync(missingDirectory);
      writeFileSync(missingUnrelatedUri.fsPath, 'notes\n');
      const missingUnrelated = await vscode.workspace.openTextDocument(missingUnrelatedUri);
      const missingUnrelatedEdit = new vscode.WorkspaceEdit();
      missingUnrelatedEdit.insert(missingUnrelated.uri, new vscode.Position(0, 0), 'unsaved ');
      assert.equal(await vscode.workspace.applyEdit(missingUnrelatedEdit), true);
      unlinkSync(missingUnrelatedUri.fsPath);
      rmdirSync(missingDirectory);
      assert.equal(await create('Function', 'missingOutsideAllowed', folder.uri), null);
      assert.equal(missingUnrelated.isDirty, true);
      mkdirSync(missingDirectory);
      writeFileSync(missingUnrelatedUri.fsPath, 'notes\n');
      await vscode.window.showTextDocument(missingUnrelated);
      await vscode.commands.executeCommand('workbench.action.files.revert');
      unlinkSync(missingUnrelatedUri.fsPath);
      rmdirSync(missingDirectory);
      console.log('PASS missing unrelated directory does not block creation');

      const nodeUri = vscode.Uri.joinPath(folder.uri, 'nodes', 'greet.ts');
      const nodeDocument = await vscode.workspace.openTextDocument(nodeUri);
      const diskBefore = readFileSync(nodeUri.fsPath, 'utf8');
      const nodeEdit = new vscode.WorkspaceEdit();
      const text = nodeDocument.getText();
      const start = nodeDocument.positionAt(text.indexOf('function greet'));
      nodeEdit.replace(nodeUri, new vscode.Range(start, nodeDocument.positionAt(text.indexOf('function greet') + 'function greet'.length)), 'function pendingName');
      assert.equal(await vscode.workspace.applyEdit(nodeEdit), true);
      const bufferBefore = nodeDocument.getText();
      const filesBefore = readdirSync(join(folder.uri.fsPath, 'nodes'));
      const folderAdded = new Promise(resolve => {
        const subscription = vscode.workspace.onDidChangeWorkspaceFolders(() => { subscription.dispose(); resolve(); });
      });
      assert.equal(vscode.workspace.updateWorkspaceFolders(2, 0, { uri: vscode.Uri.joinPath(folder.uri, 'nodes') }), true);
      await folderAdded;
      assert.equal(vscode.workspace.getWorkspaceFolder(nodeUri)?.uri.fsPath, join(folder.uri.fsPath, 'nodes'));
      const dirtyError = await create('Class', 'pendingName', folder.uri);
      assert.match(dirtyError?.message ?? '', /save.*nodes|unsaved.*nodes/i);
      assert.deepEqual(readdirSync(join(folder.uri.fsPath, 'nodes')), filesBefore);
      assert.equal(existsSync(join(folder.uri.fsPath, 'nodes', 'pendingName.ts')), false);
      assert.equal(nodeDocument.getText(), bufferBefore);
      assert.equal(nodeDocument.isDirty, true);
      assert.equal(readFileSync(nodeUri.fsPath, 'utf8'), diskBefore);
      assert.equal(other.getText(), otherBuffer);
      assert.equal(unrelated.getText(), unrelatedBuffer);
      assert.equal(readFileSync(other.uri.fsPath, 'utf8'), otherDisk);
      assert.equal(readFileSync(unrelated.uri.fsPath, 'utf8'), unrelatedDisk);
      const folderRemoved = new Promise(resolve => {
        const subscription = vscode.workspace.onDidChangeWorkspaceFolders(() => { subscription.dispose(); resolve(); });
      });
      assert.equal(vscode.workspace.updateWorkspaceFolders(2, 1), true);
      await folderRemoved;
      for (const document of [nodeDocument, other, unrelated]) {
        await vscode.window.showTextDocument(document);
        await vscode.commands.executeCommand('workbench.action.files.revert');
      }
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, 'nodes', 'main.ts')));
      await vscode.commands.executeCommand('workbench.files.action.showActiveFileInExplorer');
      for (const [path, visible] of [[folder.uri.fsPath, true], [join(folder.uri.fsPath, 'nodes'), false]]) {
        const row = page.locator('.explorer-item').and(page.getByLabel(path, { exact: true }));
        await row.click({ button: 'right', force: true, timeout: 5000 });
        const menu = page.locator('.context-view .monaco-menu:visible');
        await menu.waitFor({ state: 'visible', timeout: 5000 });
        for (const command of ['GraphScript: Set Up Project', 'GraphScript: Create Node']) {
          assert.equal(await menu.getByRole('menuitem', { name: command }).count() > 0, visible, `${command}: ${path}`);
        }
        await page.keyboard.press('Escape');
      }
    } finally {
      await browser.close();
    }
    return;
  }
  if (process.env.GRAPHSCRIPT_FIXTURE === 'mixed') return checkMixedMenus(api);
  const source = vscode.Uri.joinPath(folder.uri, 'example.ts');
  if (process.env.GRAPHSCRIPT_FIXTURE === 'compatible') {
    const compiler = await api.getCompiler(source);
    assert.equal(compiler.version, '0.1.0');
    assert.equal(compiler.directory, join(folder.uri.fsPath, 'node_modules', '@arcmantle', 'graphscript'));
    const compilerGraph = compiler.readGraph(folder.uri.fsPath);
    assert.equal(compilerGraph.nodes.length, 20);
    const functionUri = vscode.Uri.joinPath(folder.uri, 'nodes', 'greet.ts');
    const savedSource = readFileSync(functionUri.fsPath, 'utf8');
    const invalidSource = savedSource.replace('550e8400-e29b-41d4-a716-446655440000', 'invalid');
    const notificationBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.GRAPHSCRIPT_DEBUG_PORT}`);
    try {
      writeFileSync(functionUri.fsPath, invalidSource);
      await assert.rejects(vscode.commands.executeCommand('graphscript.openGraph', functionUri), /identity/i);
      const page = notificationBrowser.contexts()[0].pages()[0];
      await page.getByText(/Cannot open graph:.*identity/i).first().waitFor({ state: 'visible', timeout: 5000 });
      assert.equal(readFileSync(functionUri.fsPath, 'utf8'), invalidSource);
    } finally {
      writeFileSync(functionUri.fsPath, savedSource);
      await notificationBrowser.close();
    }
    const panel = await vscode.commands.executeCommand('graphscript.openGraph', functionUri);
    let browser;
    try {
      assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, functionUri.fsPath);
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.GRAPHSCRIPT_DEBUG_PORT}`);
      let frame;
      let rendered;
      const deadline = Date.now() + 20000;
      while (!rendered && Date.now() < deadline) {
        for (const page of browser.contexts()[0].pages()) {
          for (const candidate of page.frames()) {
            const result = await candidate.evaluate(() => {
              if (typeof view === 'undefined' || !view.nodes().length) return null;
              const canvas = [...document.querySelectorAll('#graph canvas')].find(item => {
                const pixels = item.getContext('2d').getImageData(0, 0, item.width, item.height).data;
                return pixels.some((value, index) => index % 4 === 3 && value > 0);
              });
              if (!canvas) return null;
              const center = view.getElementById(graph.selectedId).renderedPosition();
              return { nodes: view.nodes().map(node => node.data()), center,
                width: view.width(), height: view.height(),
                edges: view.edges().map(edge => ({ source: edge.source().data('name'), target: edge.target().data('name'), fromId: edge.source().id(), toId: edge.target().id(), arrow: edge.style('target-arrow-shape') })) };
            }).catch(() => null);
            if (result) { frame = candidate; rendered = result; break; }
          }
        }
        if (!rendered) await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(rendered, 'the graph canvas has visible pixels in the VS Code webview');
      assert.deepEqual(rendered.nodes.map(node => `${node.name}:${node.kind}`).sort(), ['Account:class', 'caller:function', 'greet:function', 'settings:state']);
      const selectedId = compilerGraph.nodes.find(node => node.file === functionUri.fsPath).id;
      const expectedIds = new Set([selectedId]);
      for (const edge of compilerGraph.edges) {
        if (edge.fromId === selectedId) expectedIds.add(edge.toId);
        if (edge.toId === selectedId) expectedIds.add(edge.fromId);
      }
      assert.deepEqual(rendered.nodes.map(node => node.id).sort(), [...expectedIds].sort());
      assert.deepEqual((await frame.locator('#graph-controls').getByRole('button').allTextContents()).sort(),
        ['Account (class)', 'caller (function)', 'greet (function)', 'settings (state)']);
      const endpoints = edges => edges.map(edge => JSON.stringify([edge.fromId, edge.toId])).sort();
      assert.deepEqual(endpoints(rendered.edges), endpoints(compilerGraph.edges.filter(edge => expectedIds.has(edge.fromId) && expectedIds.has(edge.toId))));
      assert.ok(Math.abs(rendered.center.x - rendered.width / 2) < 3 && Math.abs(rendered.center.y - rendered.height / 2) < 3,
        'the selected function is in the center of the view');
      assert.deepEqual(rendered.edges.map(({ source, target, arrow }) => ({ source, target, arrow })).sort((left, right) => left.target.localeCompare(right.target)), [
        { source: 'greet', target: 'Account', arrow: 'triangle' }, { source: 'caller', target: 'greet', arrow: 'triangle' }, { source: 'greet', target: 'settings', arrow: 'triangle' },
      ]);
      await frame.getByRole('button', { name: 'Depth 2', exact: true }).click({ timeout: 5000 });
      assert.deepEqual((await frame.evaluate(() => view.nodes().map(node => node.data('name')))).sort(),
        ['Account', 'caller', 'distant', 'greet', 'settings']);
      await frame.getByRole('button', { name: 'Depth 3', exact: true }).click({ timeout: 5000 });
      assert.deepEqual((await frame.evaluate(() => view.nodes().map(node => node.data('name')))).sort(),
        ['Account', ...Array.from({ length: 12 }, (_, index) => `branch${index}`), 'caller', 'distant', 'greet', 'settings', 'tier3'].sort());
      await frame.getByRole('button', { name: 'Full graph', exact: true }).click({ timeout: 5000 });
      assert.deepEqual((await frame.evaluate(() => view.nodes().map(node => node.id()))).sort(), compilerGraph.nodes.map(node => node.id).sort());
      assert.deepEqual(endpoints(await frame.evaluate(() => view.edges().map(edge => ({ fromId: edge.source().id(), toId: edge.target().id() })))), endpoints(compilerGraph.edges));
      assert.deepEqual(await frame.evaluate(() => view.nodes().filter(node => node.data('cyclic')).map(node => node.data('name'))), []);
      const tier4File = join(folder.uri.fsPath, 'nodes', 'tier4.ts');
      const tier4Source = readFileSync(tier4File, 'utf8');
      const tier3Id = compilerGraph.nodes.find(node => node.name === 'tier3').id;
      const tier4Id = compilerGraph.nodes.find(node => node.name === 'tier4').id;
      writeFileSync(tier4File, tier4Source.replace('export function tier4() {}', 'import { tier3 } from "@graph";\nexport function tier4() { return tier3(); }'));
      await frame.waitForFunction(({ fromId, toId }) => graph.edges.some(edge => edge.fromId === fromId && edge.toId === toId), { fromId: tier4Id, toId: tier3Id }, { timeout: 5000 });
      assert.deepEqual((await frame.evaluate(() => view.nodes().filter(node => node.data('cyclic')).map(node => node.data('name')))).sort(), ['tier3', 'tier4']);
      assert.deepEqual((await frame.evaluate(() => view.edges().filter(edge => edge.data('cyclic')).map(edge => `${edge.source().data('name')}->${edge.target().data('name')}`))).sort(), ['tier3->tier4', 'tier4->tier3']);
      assert.match(await frame.evaluate(() => view.nodes().filter(node => node.data('name') === 'tier3')[0].style('label')), /cycle/i);
      assert.equal(await frame.evaluate(() => view.edges().filter(edge => edge.data('cyclic'))[0].style('line-style')), 'dashed');
      writeFileSync(tier4File, tier4Source);
      await frame.waitForFunction(({ fromId, toId }) => !graph.edges.some(edge => edge.fromId === fromId && edge.toId === toId), { fromId: tier4Id, toId: tier3Id }, { timeout: 5000 });
      assert.deepEqual(await frame.evaluate(() => view.nodes().filter(node => node.data('cyclic')).map(node => node.id())), []);
      const settingsFile = join(folder.uri.fsPath, 'nodes', 'settings.ts');
      const settingsSource = readFileSync(settingsFile, 'utf8');
      const settingsId = compilerGraph.nodes.find(node => node.name === 'settings').id;
      writeFileSync(settingsFile, settingsSource.replace('count: 0', 'count: 0, current: () => settings.count'));
      await frame.waitForFunction(id => graph.edges.some(edge => edge.fromId === id && edge.toId === id), settingsId, { timeout: 5000 });
      assert.deepEqual(await frame.evaluate(() => view.nodes().filter(node => node.data('cyclic')).map(node => node.data('name'))), ['settings']);
      assert.deepEqual(await frame.evaluate(() => view.edges().filter(edge => edge.data('cyclic')).map(edge => edge.source().data('name'))), ['settings']);
      writeFileSync(tier4File, tier4Source.replace('export function tier4() {}', 'import { greet } from "@graph";\nexport function tier4() { return greet(); }'));
      await frame.waitForFunction(({ fromId, toId }) => graph.edges.some(edge => edge.fromId === fromId && edge.toId === toId), { fromId: tier4Id, toId: selectedId }, { timeout: 5000 });
      const cycleNames = ['Account', 'distant', 'greet', 'settings', 'tier3', 'tier4'];
      const cycleEdges = ['Account->distant', 'distant->tier3', 'greet->Account', 'settings->settings', 'tier3->tier4', 'tier4->greet'];
      const markedEdges = () => frame.evaluate(() => view.edges().filter(edge => edge.data('cyclic')).map(edge => `${edge.source().data('name')}->${edge.target().data('name')}`).sort());
      assert.deepEqual((await frame.evaluate(() => view.nodes().filter(node => node.data('cyclic')).map(node => node.data('name')))).sort(), cycleNames);
      assert.deepEqual(await markedEdges(), cycleEdges);
      await frame.getByRole('button', { name: 'Depth 1', exact: true }).click();
      assert.deepEqual((await frame.evaluate(() => view.nodes().filter(node => node.data('cyclic')).map(node => node.data('name')))).sort(), ['Account', 'greet', 'settings', 'tier4']);
      assert.deepEqual(await markedEdges(), ['greet->Account', 'settings->settings', 'tier4->greet']);
      const cycleControl = frame.locator('#graph-controls').getByRole('button', { name: 'Account (class), cycle' });
      await cycleControl.focus();
      await cycleControl.press('Enter');
      const cycleFile = join(folder.uri.fsPath, 'nodes', 'Account.ts');
      const cycleDeadline = Date.now() + 5000;
      while (vscode.window.activeTextEditor?.document.uri.fsPath !== cycleFile && Date.now() < cycleDeadline) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, cycleFile);
      assert.deepEqual((await frame.evaluate(() => view.nodes().filter(node => node.data('cyclic')).map(node => node.data('name')))).sort(), ['Account', 'distant', 'greet']);
      assert.equal(await frame.evaluate(() => view.nodes().filter(node => node.data('selected'))[0].style('border-color')), 'rgb(231,231,231)');
      await frame.getByRole('button', { name: 'Depth 2', exact: true }).click();
      assert.deepEqual((await frame.evaluate(() => view.nodes().filter(node => node.data('cyclic')).map(node => node.data('name')))).sort(), cycleNames);
      assert.deepEqual(await markedEdges(), cycleEdges);
      await frame.getByRole('button', { name: 'Depth 3', exact: true }).click();
      assert.deepEqual((await frame.evaluate(() => view.nodes().filter(node => node.data('cyclic')).map(node => node.data('name')))).sort(), cycleNames);
      assert.deepEqual(await markedEdges(), cycleEdges);
      await frame.getByRole('button', { name: 'Full graph', exact: true }).click();
      assert.deepEqual((await frame.evaluate(() => view.nodes().filter(node => node.data('cyclic')).map(node => node.data('name')))).sort(), cycleNames);
      assert.deepEqual(await markedEdges(), cycleEdges);
      writeFileSync(tier4File, tier4Source);
      writeFileSync(settingsFile, settingsSource);
      await frame.waitForFunction(({ fromId, toId }) => !graph.edges.some(edge => edge.fromId === fromId && edge.toId === toId), { fromId: tier4Id, toId: selectedId }, { timeout: 5000 });
      await frame.waitForFunction(id => !graph.edges.some(edge => edge.fromId === id && edge.toId === id), settingsId, { timeout: 5000 });
      assert.deepEqual(await frame.evaluate(() => view.nodes().filter(node => node.data('cyclic')).map(node => node.id())), []);
      await frame.locator('#graph-controls').getByRole('button', { name: 'greet (function)' }).focus();
      await frame.locator('#graph-controls').getByRole('button', { name: 'greet (function)' }).press('Enter');
      await frame.getByRole('button', { name: 'Depth 1', exact: true }).click({ timeout: 5000 });
      const dependencies = frame.getByRole('region', { name: 'Direct dependencies' });
      await dependencies.waitFor({ timeout: 5000 });
      assert.deepEqual((await dependencies.getByRole('button').allTextContents()).sort(), ['Account (class)', 'settings (state)']);
      await dependencies.getByRole('button', { name: 'Account (class)' }).click();
      const accountFile = join(folder.uri.fsPath, 'nodes', 'Account.ts');
      const dependencyDeadline = Date.now() + 5000;
      while (vscode.window.activeTextEditor?.document.uri.fsPath !== accountFile && Date.now() < dependencyDeadline) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, accountFile);
      assert.deepEqual(await dependencies.getByRole('button').allTextContents(), ['distant (function)']);
      assert.equal(await frame.evaluate(() => view.nodes().filter(node => node.data('selected')).map(node => node.data('name'))[0]), 'Account');
      const greetControl = frame.locator('#graph-controls').getByRole('button', { name: 'greet (function)' });
      await greetControl.focus();
      await greetControl.press('Enter');
      await frame.getByRole('button', { name: 'Full graph', exact: true }).click();
      for (const node of rendered.nodes) {
        const position = await frame.evaluate(id => view.getElementById(id).renderedPosition(), node.id);
        const bounds = await frame.locator('#graph').boundingBox();
        await frame.page().mouse.click(bounds.x + position.x, bounds.y + position.y);
        const expected = join(folder.uri.fsPath, 'nodes', `${node.name}.ts`);
        const openDeadline = Date.now() + 5000;
        while (vscode.window.activeTextEditor?.document.uri.fsPath !== expected && Date.now() < openDeadline) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, expected);
      }
      const account = frame.locator('#graph-controls').getByRole('button', { name: 'Account (class)' });
      assert.equal(await account.count(), 1, 'each node has a keyboard-accessible control');
      await account.focus();
      await account.press('Enter');
      const keyboardDeadline = Date.now() + 5000;
      while (vscode.window.activeTextEditor?.document.uri.fsPath !== accountFile && Date.now() < keyboardDeadline) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, accountFile);
      assert.deepEqual(await dependencies.getByRole('button').allTextContents(), ['distant (function)']);
      const isolatedControl = frame.locator('#graph-controls').getByRole('button', { name: 'isolated (function)' });
      await isolatedControl.focus();
      await isolatedControl.press('Enter');
      const isolatedFile = join(folder.uri.fsPath, 'nodes', 'isolated.ts');
      const isolatedDeadline = Date.now() + 5000;
      while (vscode.window.activeTextEditor?.document.uri.fsPath !== isolatedFile && Date.now() < isolatedDeadline) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, isolatedFile);
      assert.equal(await dependencies.getByRole('button').count(), 0);
      assert.match(await dependencies.textContent(), /No direct dependencies/);
      assert.equal(await frame.evaluate(() => view.nodes().length), compilerGraph.nodes.length);

      await greetControl.focus();
      await greetControl.press('Enter');
      const greetDocument = await vscode.workspace.openTextDocument(functionUri);
      const originalSource = greetDocument.getText();
      const updatedSource = originalSource.replace('Account, settings', 'Account').replace(', settings.count', '');
      const savedEdit = new vscode.WorkspaceEdit();
      savedEdit.replace(functionUri, new vscode.Range(greetDocument.positionAt(0), greetDocument.positionAt(originalSource.length)), updatedSource);
      assert.equal(await vscode.workspace.applyEdit(savedEdit), true);
      assert.equal(await greetDocument.save(), true);
      await dependencies.getByRole('button', { name: 'settings (state)' }).waitFor({ state: 'detached', timeout: 5000 });
      assert.deepEqual(await dependencies.getByRole('button').allTextContents(), ['Account (class)']);
      assert.equal(await frame.evaluate(id => view.getElementById(id).id(), selectedId), selectedId);
      assert.deepEqual((await frame.evaluate(() => view.nodes().map(node => node.id()))).sort(), compilerGraph.nodes.map(node => node.id).sort());
      const diagnostic = frame.getByRole('alert');
      await frame.locator('#graph-error').evaluate(element => { element.style.position = 'absolute'; });
      const markerFile = join(folder.uri.fsPath, 'nodes', `viewport-${Date.now()}.ts`);
      const viewport = await frame.evaluate(() => {
        view.zoom(0.7);
        view.pan({ x: 123, y: 87 });
        const expectedGraph = JSON.stringify(graph);
        window.waitForGraphMessage = marker => new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            window.removeEventListener('message', onMessage);
            reject(new Error('Graph marker message timed out'));
          }, 5000);
          function onMessage(event) {
            if (event.data?.type !== 'graph' || !event.data.error?.includes(marker) || JSON.stringify(event.data.graph) !== expectedGraph) return;
            clearTimeout(timeout);
            window.removeEventListener('message', onMessage);
            resolve();
          }
          window.addEventListener('message', onMessage);
        });
        return { zoom: view.zoom(), pan: view.pan(), positions: view.nodes().map(node => [node.id(), node.position()]) };
      });
      await frame.evaluate(marker => { window.nextGraphMessage = window.waitForGraphMessage(marker); }, markerFile);
      writeFileSync(markerFile, '"graphscript:function";\n// graphscript:id invalid\nexport function marker() {}\n');
      await frame.evaluate(() => window.nextGraphMessage);
      assert.match(await diagnostic.textContent(), /identity/i);
      assert.deepEqual(await frame.evaluate(() => ({ zoom: view.zoom(), pan: view.pan(), positions: view.nodes().map(node => [node.id(), node.position()]) })), viewport);
      unlinkSync(markerFile);
      await diagnostic.waitFor({ state: 'hidden', timeout: 5000 });
      await frame.locator('#graph-error').evaluate(element => { element.style.position = ''; });

      const git = (...args) => {
        const result = spawnSync('git', args, { cwd: folder.uri.fsPath, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
      };
      git('init');
      git('add', 'nodes');
      git('-c', 'user.name=GraphScript Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Saved edit');
      writeFileSync(functionUri.fsPath, originalSource);
      git('add', 'nodes');
      git('-c', 'user.name=GraphScript Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Restore dependency');
      await dependencies.getByRole('button', { name: 'settings (state)' }).waitFor({ state: 'visible', timeout: 5000 });
      git('checkout', '--detach', 'HEAD~1');
      await dependencies.getByRole('button', { name: 'settings (state)' }).waitFor({ state: 'detached', timeout: 5000 });
      assert.equal(await frame.evaluate(id => view.getElementById(id).id(), selectedId), selectedId);

      const invalidIdentity = updatedSource.replace(selectedId, 'invalid');
      writeFileSync(functionUri.fsPath, invalidIdentity);
      await diagnostic.waitFor({ state: 'visible', timeout: 5000 });
      assert.match(await diagnostic.textContent(), /identity/i);
      assert.equal(readFileSync(functionUri.fsPath, 'utf8'), invalidIdentity);
      assert.equal(await frame.evaluate(id => view.getElementById(id).id(), selectedId), selectedId);
      writeFileSync(functionUri.fsPath, updatedSource);
      await diagnostic.waitFor({ state: 'hidden', timeout: 5000 });
      const invalidSyntax = updatedSource.replace('function greet()', 'function greet( {');
      writeFileSync(functionUri.fsPath, invalidSyntax);
      await diagnostic.waitFor({ state: 'visible', timeout: 5000 });
      assert.match(await diagnostic.textContent(), /syntax|parse/i);
      assert.equal(readFileSync(functionUri.fsPath, 'utf8'), invalidSyntax);
      writeFileSync(functionUri.fsPath, updatedSource);
      await diagnostic.waitFor({ state: 'hidden', timeout: 5000 });
      assert.equal(await frame.evaluate(id => view.getElementById(id).id(), selectedId), selectedId);

      const accountUri = vscode.Uri.file(accountFile);
      const accountDocument = await vscode.workspace.openTextDocument(accountUri);
      const accountDisk = readFileSync(accountFile, 'utf8');
      const unsavedEdit = new vscode.WorkspaceEdit();
      unsavedEdit.replace(accountUri, new vscode.Range(accountDocument.positionAt(0), accountDocument.positionAt(accountDocument.getText().length)), accountDisk.replaceAll('distant', 'tier3'));
      assert.equal(await vscode.workspace.applyEdit(unsavedEdit), true);
      const unsavedText = accountDocument.getText();
      writeFileSync(functionUri.fsPath, originalSource);
      await dependencies.getByRole('button', { name: 'settings (state)' }).waitFor({ state: 'visible', timeout: 5000 });
      assert.equal(accountDocument.isDirty, true);
      assert.equal(accountDocument.getText(), unsavedText);
      assert.equal(readFileSync(accountFile, 'utf8'), accountDisk);
      await frame.locator('#graph-controls').getByRole('button', { name: 'Account (class)' }).focus();
      await frame.locator('#graph-controls').getByRole('button', { name: 'Account (class)' }).press('Enter');
      assert.deepEqual(await dependencies.getByRole('button').allTextContents(), ['distant (function)']);
      await vscode.window.showTextDocument(accountDocument);
      await vscode.commands.executeCommand('workbench.action.files.revert');

      const newNodeFile = join(folder.uri.fsPath, 'nodes', 'added.ts');
      const newNodeId = '550e8400-e29b-41d4-a716-446655440008';
      const newNodeSource = `"graphscript:function";\n// graphscript:id ${newNodeId}\nexport function added() {}\n`;
      writeFileSync(newNodeFile, newNodeSource);
      const newNodeControl = frame.locator('#graph-controls').getByRole('button', { name: 'added (function)' });
      await newNodeControl.waitFor({ state: 'attached', timeout: 5000 });
      await newNodeControl.focus();
      await newNodeControl.press('Enter');
      const addedDeadline = Date.now() + 5000;
      while (vscode.window.activeTextEditor?.document.uri.fsPath !== newNodeFile && Date.now() < addedDeadline) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, newNodeFile);
      assert.equal(await frame.evaluate(id => view.getElementById(id).id(), newNodeId), newNodeId);
      unlinkSync(newNodeFile);
      await newNodeControl.waitFor({ state: 'detached', timeout: 5000 });
      assert.equal(await frame.evaluate(id => view.getElementById(id).length, newNodeId), 0);
      const notice = frame.locator('#selection-notice');
      await notice.waitFor({ state: 'visible', timeout: 5000 });
      assert.match(await notice.textContent(), /restore.*select another node/i);
      assert.equal(await frame.evaluate(() => selectedId), newNodeId);
      assert.equal(await frame.evaluate(() => view.nodes().filter(node => node.data('selected')).length), 0);
      writeFileSync(newNodeFile, newNodeSource);
      await notice.waitFor({ state: 'hidden', timeout: 5000 });
      assert.equal(await frame.evaluate(() => selectedId), newNodeId);
      assert.equal(await frame.evaluate(id => view.getElementById(id).data('selected'), newNodeId), true);
    } finally {
      panel.dispose();
      await browser?.close();
    }
  } else {
    const messages = {
      missing: /missing.*project/i,
      unsupported: /unsupported.*0\.2\.0/i,
      broken: /cannot load.*project-local.*graph API.*broken fixture/i,
    };
    const message = messages[process.env.GRAPHSCRIPT_FIXTURE];
    await assert.rejects(api.getCompiler(source), message);
    const document = await vscode.workspace.openTextDocument(source);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(source, new vscode.Position(0, 0), 'const edited = true;\n');
    assert.equal(await vscode.workspace.applyEdit(edit), true);
    assert.equal(await document.save(), true);
    assert.match(document.getText(), /^const edited = true;/);
    if (process.env.GRAPHSCRIPT_FIXTURE === 'missing') {
      assert.equal(existsSync(join(folder.uri.fsPath, 'node_modules', '@arcmantle', 'graphscript')), false);
    }
  }
};