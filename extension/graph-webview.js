const vscode = acquireVsCodeApi();
let graph = JSON.parse(document.getElementById('graph-data').textContent);
let selectedId = graph.selectedId;
let currentDepth = 1;
function findCycles(graph) {
  const analysis = cytoscape({ headless: true, elements: [
    ...graph.nodes.map(node => ({ data: { id: node.id } })),
    ...graph.edges.map((edge, index) => ({ data: { id: `cycle-edge-${index}`, source: edge.fromId, target: edge.toId, index } })),
  ] });
  const nodes = new Set();
  const edges = new Set();
  for (const component of analysis.elements().tarjanStronglyConnected().components) {
    const componentNodes = component.nodes();
    const componentEdges = component.edges();
    if (componentNodes.length === 1 && !componentEdges.some(edge => edge.source().id() === edge.target().id())) continue;
    componentNodes.forEach(node => nodes.add(node.id()));
    componentEdges.forEach(edge => edges.add(edge.data('index')));
  }
  analysis.destroy();
  return { nodes, edges };
}
let cycles = findCycles(graph);
const view = cytoscape({
  container: document.getElementById('graph'),
  elements: [],
  style: [
    { selector: 'node', style: { label: 'data(name)', 'background-color': '#408275', color: '#ffffff', 'text-valign': 'center', 'text-halign': 'center', 'text-wrap': 'wrap', 'text-max-width': '110px', width: 130, height: 54, shape: 'round-rectangle', 'font-size': 12 } },
    { selector: 'node[kind = "class"]', style: { 'background-color': '#936c32' } },
    { selector: 'node[kind = "state"]', style: { 'background-color': '#8c4f58' } },
    { selector: 'node[?selected]', style: { 'border-width': 3, 'border-color': '#e7e7e7' } },
    { selector: 'edge', style: { width: 2, 'line-color': '#999999', 'target-arrow-color': '#999999', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'arrow-scale': 1.2 } },
    { selector: 'node[?cyclic]', style: { label: node => `${node.data('name')}\n(cycle)`, 'border-width': 4, 'border-style': 'dashed', 'border-color': '#f5a623' } },
    { selector: 'node[?cyclic][?selected]', style: { 'border-color': '#e7e7e7' } },
    { selector: 'edge[?cyclic]', style: { width: 3, 'line-style': 'dashed', 'line-color': '#f5a623', 'target-arrow-color': '#f5a623' } },
  ],
  layout: { name: 'concentric', concentric: node => node.data('selected') ? 2 : 1, levelWidth: () => 1, minNodeSpacing: 70, fit: false },
});

function showDepth(depth) {
  const selectedExists = graph.nodes.some(node => node.id === selectedId);
  const notice = document.getElementById('selection-notice');
  notice.hidden = selectedExists;
  const ids = new Set(depth === 'full' || !selectedExists ? graph.nodes.map(node => node.id) : [selectedId]);
  let frontier = new Set(ids);
  for (let level = 0; level < depth; level++) {
    const next = new Set();
    for (const edge of graph.edges) {
      if (frontier.has(edge.fromId) && !ids.has(edge.toId)) next.add(edge.toId);
      if (frontier.has(edge.toId) && !ids.has(edge.fromId)) next.add(edge.fromId);
    }
    for (const id of next) ids.add(id);
    frontier = next;
  }
  view.elements().remove();
  view.add([
    ...graph.nodes.filter(node => ids.has(node.id)).map(node => ({ data: { ...node, selected: node.id === selectedId, cyclic: cycles.nodes.has(node.id) } })),
    ...graph.edges.map((edge, index) => ({ edge, index })).filter(({ edge }) => ids.has(edge.fromId) && ids.has(edge.toId)).map(({ edge, index }) => ({ data: { id: `edge-${index}`, source: edge.fromId, target: edge.toId, cyclic: cycles.edges.has(index) } })),
  ]);
  if (view.nodes().length) {
    view.layout({ name: 'concentric', concentric: node => node.data('selected') ? 2 : 1, levelWidth: () => 1, minNodeSpacing: 70, fit: false }).run();
    if (selectedExists) {
      const selected = view.getElementById(selectedId);
      const position = selected.position();
      const bounds = view.elements().boundingBox();
      const width = 2 * Math.max(position.x - bounds.x1, bounds.x2 - position.x) + 90;
      const height = 2 * Math.max(position.y - bounds.y1, bounds.y2 - position.y) + 90;
      view.zoom(Math.min(1, view.width() / width, view.height() / height));
      view.center(selected);
    } else {
      view.fit(undefined, 45);
    }
  }
  for (const button of document.querySelectorAll('#graph-controls button')) {
    button.hidden = !ids.has(button.dataset.nodeId);
    button.setAttribute('aria-current', String(button.dataset.nodeId === selectedId));
  }
}

for (const button of document.querySelectorAll('#depth-controls button')) {
  button.addEventListener('click', () => {
    for (const control of document.querySelectorAll('#depth-controls button')) control.setAttribute('aria-pressed', String(control === button));
    currentDepth = button.dataset.depth === 'full' ? 'full' : Number(button.dataset.depth);
    showDepth(currentDepth);
  });
}
function openNode(id) {
  selectedId = id;
  showDependencies();
  view.resize();
  showDepth(currentDepth);
  vscode.postMessage({ type: 'open', id });
}

function showDependencies() {
  const list = document.getElementById('dependency-list');
  list.replaceChildren();
  if (!graph.nodes.some(node => node.id === selectedId)) {
    list.textContent = 'Selected node is not in the saved graph';
    return;
  }
  const ids = new Set(graph.edges.filter(edge => edge.fromId === selectedId).map(edge => edge.toId));
  for (const node of graph.nodes.filter(candidate => ids.has(candidate.id))) {
    const button = document.createElement('button');
    button.textContent = `${node.name} (${node.kind})`;
    button.addEventListener('click', () => openNode(node.id));
    list.appendChild(button);
  }
  if (!ids.size) list.textContent = 'No direct dependencies';
}
showDependencies();

function showControls() {
  const controls = document.getElementById('graph-controls');
  controls.replaceChildren();
  for (const node of graph.nodes) {
    const button = document.createElement('button');
    button.textContent = `${node.name} (${node.kind})`;
    if (cycles.nodes.has(node.id)) button.setAttribute('aria-label', `${node.name} (${node.kind}), cycle`);
    button.dataset.nodeId = node.id;
    button.addEventListener('click', () => openNode(node.id));
    controls.appendChild(button);
  }
}

showControls();
showDepth(1);
new ResizeObserver(() => {
  view.resize();
  const selected = view.getElementById(selectedId);
  if (selected.length) view.center(selected);
}).observe(document.getElementById('graph'));
view.on('tap', 'node', event => openNode(event.target.id()));
window.addEventListener('message', event => {
  const error = document.getElementById('graph-error');
  if (event.data?.type === 'graph') {
    error.textContent = event.data.error || '';
    error.hidden = !event.data.error;
    if (JSON.stringify(graph) === JSON.stringify(event.data.graph)) return;
    graph = event.data.graph;
    cycles = findCycles(graph);
    showDependencies();
    showControls();
    showDepth(currentDepth);
  }
});
vscode.postMessage({ type: 'ready' });