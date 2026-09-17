"use strict";
const assert = require("assert");
const Module = require("module");
const load = Module._load;
Module._load = function (name, ...args) {
  if (name === "obsidian") return new Proxy({ normalizePath: value => value, setIcon() {} }, { get(target, key) { return target[key] || class {}; } });
  return load.call(this, name, ...args);
};
const Plugin = require("../main.js");
Module._load = load;
const clone = value => JSON.parse(JSON.stringify(value));
function element() {
  const classes = new Set();
  return { dataset: {}, style: { removeProperty() {}, setProperty() {} },
    addClass: c => classes.add(c), removeClass: c => classes.delete(c),
    classList: { contains: c => classes.has(c), add: c => classes.add(c), remove: c => classes.delete(c), toggle(c, enabled) { if (enabled) classes.add(c); else classes.delete(c); } },
  };
}
const authored = [
  { id: "section", type: "group", label: "06 · 动效参考", x: -100, y: -100, width: 1400, height: 900, color: "5", background: "paper.png", backgroundStyle: "ratio" },
  { id: "a", type: "text", text: "参考 A", x: 0, y: 0, width: 240, height: 160, jamdeck: { unrelated: "keep" } },
  { id: "b", type: "file", file: "ref.png", x: 500, y: 180, width: 400, height: 280 },
  { id: "link", type: "link", url: "https://example.com", x: 500, y: 500, width: 300, height: 150 },
  { id: "outside", type: "text", text: "外部", x: 1800, y: 400, width: 100, height: 100 },
];
const edges = [
  { id: "ab", fromNode: "a", toNode: "b", fromSide: "right", toSide: "left", label: "方向" },
  { id: "bo", fromNode: "b", toNode: "outside", fromSide: "bottom", toSide: "top" },
];
function fixture(input = authored, inputEdges = edges) {
  const ctrl = new Plugin.CanvasFolderController({}, {});
  const initial = { nodes: clone(input), edges: clone(inputEdges) };
  const canvas = { data: clone(initial), nodes: new Map(), edges: new Map(), selection: new Set(), canvasEl: {}, scale: 1,
    history: { data: [clone(initial)], current: 0, push(data) { this.data.splice(this.current + 1); this.data.push(clone(data)); this.current++; } },
    requestPushHistory: { run() {}, cancel() {} },
    getData() { return clone(this.data); },
    importData(data) {
      this.data = clone(data);
      for (const id of this.nodes.keys()) if (!data.nodes.some(n => n.id === id)) this.nodes.delete(id);
      for (const node of data.nodes) {
        if (!this.nodes.has(node.id)) this.nodes.set(node.id, { id: node.id, nodeEl: element(), getData: () => clone(canvas.data.nodes.find(n => n.id === node.id)) });
      }
      for (const edge of data.edges) if (!this.edges.has(edge.id)) this.edges.set(edge.id, { getData: () => clone(edge), lineGroupEl: element(), lineEndGroupEl: element(), labelElement: { wrapperEl: element() } });
      if (this.failImport) { this.failImport = false; throw new Error("import failure"); }
    },
    pushHistory(data) { this.history.push(data); },
    setData(data) { this.importData(data); this.pushHistory(data); },
    view: { requestSave() { if (canvas.failSave) { canvas.failSave = false; throw new Error("save failure"); } } },
    undo() { this.importData(this.history.data[--this.history.current]); },
    redo() { this.importData(this.history.data[++this.history.current]); },
  };
  canvas.importData(initial);
  ctrl.canvas = canvas;
  ctrl.scheduleReconcile = () => {};
  ctrl.renderFolderLayer = () => {};
  ctrl.syncToolbar = () => {};
  ctrl.ownerWindow = { removeEventListener() {}, cancelAnimationFrame() {} };
  return { ctrl, canvas, node: id => canvas.nodes.get(id), item: id => ctrl.getItems().find(item => item.id === id) };
}
function rects(data, ids) { return data.nodes.filter(n => ids.includes(n.id)).map(({ id, x, y, width, height }) => ({ id, x, y, width, height })).sort((a, b) => a.id.localeCompare(b.id)); }
function groupOf(f) { return f.ctrl.collectGroups()[0]; }
function create(f) { return f.ctrl.createFolder([f.item("a"), f.item("b")]); }

// Creation and deletion must include native Group topology in the same undo.
{
  const f = fixture();
  const before = f.canvas.getData();
  create(f);
  const after = f.canvas.getData();
  assert.deepStrictEqual(rects(after, ["a", "b"]), rects(before, ["a", "b"]), "creating a folder must preserve authored geometry");
  assert.deepStrictEqual(after.edges, edges, "all member connections stay in standard edges");
  assert.strictEqual(after.nodes.length, before.nodes.length + 1);
  assert.strictEqual(f.canvas.history.current, 1);
  f.canvas.undo(); assert.deepStrictEqual(f.canvas.getData(), before);
  f.canvas.redo(); assert.deepStrictEqual(f.canvas.getData(), after);
  f.ctrl.ungroup(groupOf(f));
  assert.deepStrictEqual(f.canvas.getData(), before, "ungroup must remove only owned group and folder metadata");
  f.canvas.undo(); assert.deepStrictEqual(f.canvas.getData(), after);
}

// Converting an authored section keeps its ID, exact bounds, color/background and links.
{
  const f = fixture();
  assert.strictEqual(f.ctrl.collectGroups().length, 0);
  f.ctrl.reconcile();
  assert(!f.node("section").nodeEl.classList.contains("is-jam-deck-folder-group-hidden"));
  f.ctrl.foldNativeGroup(f.node("section"));
  const group = groupOf(f);
  assert(group.memberIds.includes("link"), "link nodes inside real sections must be included");
  const { jamdeck, ...standardGroup } = f.node("section").getData();
  assert.deepStrictEqual(standardGroup, authored[0], "converting a section preserves all standard group fields");
  f.ctrl.reconcile();
  assert(f.node("section").nodeEl.classList.contains("is-jam-deck-folder-group-hidden"));
  assert(f.ctrl.isFolderOwnedNode(f.node("a")));
  for (const edge of f.canvas.edges.values()) for (const el of [edge.lineGroupEl, edge.lineEndGroupEl, edge.labelElement.wrapperEl]) assert(el.classList.contains("is-jam-deck-folder-edge-hidden"));
  const folded = f.canvas.getData();
  f.ctrl.updateFolder(groupOf(f), { collapsed: false }); f.ctrl.reconcile();
  assert(!f.node("section").nodeEl.classList.contains("is-jam-deck-folder-group-hidden"));
  assert(!f.ctrl.isFolderOwnedNode(f.node("a")), "expanded members must be editable");
  for (const edge of f.canvas.edges.values()) for (const el of [edge.lineGroupEl, edge.lineEndGroupEl, edge.labelElement.wrapperEl]) assert(!el.classList.contains("is-jam-deck-folder-edge-hidden"));
  assert(!f.node("link").nodeEl.classList.contains("is-jam-deck-folder-proxy-hidden"));
  assert.deepStrictEqual(rects(f.canvas.getData(), ["a", "b", "link"]), rects(folded, ["a", "b", "link"]));
  assert.deepStrictEqual(f.canvas.getData().edges, edges);
  f.ctrl.updateFolder(groupOf(f), { collapsed: true }); f.ctrl.reconcile();
  f.canvas.undo(); f.ctrl.reconcile();
  assert(!f.node("a").nodeEl.classList.contains("is-jam-deck-folder-proxy-hidden"), "undo must restore presentation state");
  f.canvas.redo(); f.ctrl.reconcile();
  assert(f.node("a").nodeEl.classList.contains("is-jam-deck-folder-proxy-hidden"));
}

// Native rename/resize must remain authoritative after reopening in JamDeck.
{
  const f = fixture(); create(f);
  const id = groupOf(f).nativeGroupId;
  const data = f.canvas.getData();
  const frame = data.nodes.find(n => n.id === id);
  Object.assign(frame, { label: "原生改名", x: frame.x + 120, width: frame.width + 300 });
  f.canvas.importData(data);
  assert.strictEqual(groupOf(f).label, "原生改名");
  f.ctrl.updateFolder(groupOf(f), { collapsed: false });
  const { jamdeck: updatedMeta, ...updatedFrame } = f.node(id).getData();
  const { jamdeck: priorMeta, ...priorFrame } = frame;
  assert.deepStrictEqual(updatedFrame, priorFrame);
}

// Dragging the shell moves the authored layout as one translation at every zoom.
for (const scale of [0.5, 1, 2]) {
  const f = fixture(); create(f); f.canvas.scale = scale;
  const g = groupOf(f), before = f.canvas.getData();
  const shell = f.ctrl.folderWorldShellRect(g);
  const drag = { group: g, moved: true, scale, startClientX: 10, startClientY: 20 };
  f.ctrl.shellDrag = drag;
  f.ctrl.finishFolderShellDrag(drag, { clientX: 110, clientY: 80 }, false);
  for (const id of [...g.memberIds, g.nativeGroupId]) {
    const a = before.nodes.find(n => n.id === id), b = f.node(id).getData();
    assert.strictEqual(b.x, a.x + 100 / scale); assert.strictEqual(b.y, a.y + 60 / scale);
    assert.strictEqual(b.width, a.width); assert.strictEqual(b.height, a.height);
  }
  const moved = f.ctrl.folderWorldShellRect(groupOf(f));
  assert.strictEqual(moved.x, shell.x + 100 / scale);
  assert.deepStrictEqual(f.canvas.getData().edges, edges);
  f.canvas.undo(); assert.deepStrictEqual(f.canvas.getData(), before);
}

// Drop-in and drag-out preserve all other members and all existing connections.
{
  const f = fixture(); create(f);
  const before = f.canvas.getData();
  const shell = f.ctrl.folderWorldShellRect(groupOf(f));
  f.ctrl.updateGroupMembership(groupOf(f), f.item("link"), groupOf(f));
  assert(groupOf(f).memberIds.includes("link"));
  assert.deepStrictEqual(f.ctrl.folderWorldShellRect(groupOf(f)), shell, "growing the native frame must not jump the shell");
  const frame = f.node(groupOf(f).nativeGroupId).getData();
  assert(frame.y + frame.height >= 650, "native frame must include added members");
  f.ctrl.reconcile();
  f.canvas.undo(); f.ctrl.reconcile();
  assert(!f.node("link").nodeEl.classList.contains("is-jam-deck-folder-proxy-hidden"), "undoing membership restores node visibility");
  f.canvas.redo(); f.ctrl.reconcile();
  assert.deepStrictEqual(rects(f.canvas.getData(), ["a", "b", "link"]), rects(before, ["a", "b", "link"]));
  f.ctrl.detachPreviewMember(groupOf(f).id, "a", { x: 1400, y: 750, width: 240, height: 160 });
  assert.strictEqual(f.node("a").getData().x, 1400);
  assert(!f.node("a").getData().jamdeck.folderId);
  assert.strictEqual(f.node("a").getData().jamdeck.unrelated, "keep");
  assert.deepStrictEqual(f.canvas.getData().edges, edges);
  assert.deepStrictEqual(rects(f.canvas.getData(), ["b", "link"]), rects(before, ["b", "link"]));
}

// Import/save failures must roll back topology, data and history together.
for (const fail of ["failImport", "failSave"]) {
  const f = fixture(), before = f.canvas.getData();
  f.canvas[fail] = true;
  assert.throws(() => create(f), /failure/);
  assert.deepStrictEqual(f.canvas.getData(), before);
  assert.strictEqual(f.canvas.history.current, 0);
  create(f);
  const created = f.canvas.getData(); f.canvas[fail] = true;
  assert.throws(() => f.ctrl.ungroup(groupOf(f)), /failure/);
  assert.deepStrictEqual(f.canvas.getData(), created);
}
// Deleting the first member in native Canvas must not delete the folder record.
{
  const f = fixture(); create(f);
  const data = f.canvas.getData(); data.nodes = data.nodes.filter(n => n.id !== "a");
  f.canvas.importData(data);
  assert.deepStrictEqual(groupOf(f).memberIds, ["b"]);
  f.ctrl.updateFolder(groupOf(f), { collapsed: false });
  assert.strictEqual(groupOf(f).collapsed, false);
}
// Refolding an edited native section recomputes membership from current bounds.
{
  const f = fixture(); f.ctrl.foldNativeGroup(f.node("section"));
  f.ctrl.updateFolder(groupOf(f), { collapsed: false });
  const data = f.canvas.getData();
  data.nodes.find(n => n.id === "a").x = 2000;
  data.nodes.find(n => n.id === "outside").x = 100;
  f.canvas.importData(data); f.ctrl.foldNativeGroup(f.node("section"));
  assert(!groupOf(f).memberIds.includes("a"));
  assert(groupOf(f).memberIds.includes("outside"));
  assert(!f.node("a").getData().jamdeck.folderId);
}
// Ordinary groups named 文件夹 are never claimed or purged.
{
  const input = clone(authored); input[0].label = "文件夹";
  const f = fixture(input); f.ctrl.reconcile();
  assert.deepStrictEqual(f.canvas.getData().nodes, input);
  assert.strictEqual(f.ctrl.collectGroups().length, 0);
}
// Grid layout is explicit, preserves connections, and grows the native frame.
{
  const f = fixture(); create(f); const before = f.canvas.getData();
  f.ctrl.layoutSelectionGrid(groupOf(f).members);
  assert.strictEqual(groupOf(f).layoutMode, "grid");
  assert.deepStrictEqual(f.canvas.getData().edges, edges);
  const frame = f.node(groupOf(f).nativeGroupId).getData();
  for (const m of groupOf(f).members) assert(m.rect.x >= frame.x && m.rect.y >= frame.y && m.rect.x + m.rect.width <= frame.x + frame.width && m.rect.y + m.rect.height <= frame.y + frame.height);
  f.canvas.undo(); assert.deepStrictEqual(f.canvas.getData(), before);
  f.canvas.readonly = true;
  assert.throws(() => f.ctrl.updateFolder(groupOf(f), { collapsed: false }), /只读/);
  assert.deepStrictEqual(f.canvas.getData(), before);
}
// Restoring a previously normalized image must keep the actual grab point.
// Collision checks must use that final rectangle, including its new origin.
for (const blocked of [false, true]) {
  const input = clone(authored);
  Object.assign(input[2], { width: 100, height: 100, jamdeck: { stackImageNormalization: {
    version: 1, originalCanvasSize: { width: 200, height: 200 }, normalizedCanvasSize: { width: 100, height: 100 }, anchorNodeIds: ["a"]
  } } });
  const f = fixture(input); create(f);
  const stack = Object.create(Plugin.CanvasImageStackController.prototype);
  stack.entry = { folderController: f.ctrl };
  stack.disposePreviewPress = () => {}; stack.cancelPreviewPress = () => {};
  stack.canvasWorldPoint = () => ({ x: 1000, y: 1000 }); stack.viewportSignature = () => "stable";
  stack.nodeItem = node => f.item(node.id);
  stack.getStackItems = () => blocked ? [{ id: "blocker", rect: { x: 1100, y: 950, width: 100, height: 100 } }] : [];
  const member = f.item("b");
  const press = { member, nodeId: "b", kind: "image", viewport: "stable", startWorld: { x: 50, y: 50 },
    baseRect: clone(member.rect), grabRatio: { x: 0.25, y: 0.25 }, previewCluster: { folderId: groupOf(f).id },
    baseIdentity: { type: "file", file: member.data.file, subpath: null, normalization: JSON.stringify(Plugin.canvasStackGeometry.normalization(member.data)) } };
  assert(stack.commitPreviewDrag(press, {}));
  const actual = f.node("b").getData(), size = blocked ? 100 : 200;
  assert.strictEqual(actual.width, size, "restore must check collisions at the grab-aligned rectangle");
  assert.strictEqual(actual.x, 1000 - size * 0.25);
  assert.strictEqual(actual.y, 1000 - size * 0.25);
  assert.strictEqual(!!actual.jamdeck?.stackImageNormalization, blocked);
  assert.deepStrictEqual(f.canvas.getData().edges, edges);
}
// The visible folder button handles both loose selection and a native group.
{
  const f = fixture();
  const buttons = new Map();
  f.ctrl.getToolbarMenu = () => ({});
  f.ctrl.ensureToolbarButton = (_, id, label, icon, click) => {
    if (!buttons.has(id)) buttons.set(id, {click, setAttribute(key,value){this[key]=value;}});
    return buttons.get(id);
  };
  const sync = () => Plugin.CanvasFolderController.prototype.syncToolbar.call(f.ctrl);
  const before = f.canvas.getData();
  f.canvas.selection = new Set([f.node("a"),f.node("b")]); sync();
  assert.strictEqual(buttons.get("folder").hidden, false);
  assert.strictEqual(buttons.get("folder")["aria-label"], "新建文件夹");
  buttons.get("folder").click();
  assert.deepStrictEqual(groupOf(f).memberIds, ["a","b"]);
  assert.deepStrictEqual(f.canvas.getData().edges, edges);
  assert.strictEqual(f.canvas.history.current, 1);
  f.canvas.undo(); assert.deepStrictEqual(f.canvas.getData(), before);
  f.canvas.selection = new Set([f.node("section")]); sync();
  assert.strictEqual(buttons.get("folder")["aria-label"], "收起为文件夹");
  assert.strictEqual(buttons.get("stack").hidden, true);
  buttons.get("folder").click(); assert.strictEqual(groupOf(f).nativeGroupId, "section");
  f.canvas.undo();
  f.canvas.selection = new Set([f.node("a")]); sync();
  assert.strictEqual(buttons.get("folder").hidden, true);
  buttons.get("folder").click(); assert.deepStrictEqual(f.canvas.getData(), before);
  f.canvas.selection = new Set([f.node("a"),f.node("b")]); f.canvas.readonly=true; sync();
  assert.strictEqual(buttons.get("folder").disabled,true);
  buttons.get("folder").click(); assert.deepStrictEqual(f.canvas.getData(), before);
  f.canvas.readonly=false; f.ctrl.stack={previewWrapper:{}};sync();
  assert.strictEqual(buttons.get("folder").hidden,true);
  buttons.get("folder").click(); assert.deepStrictEqual(f.canvas.getData(),before);
}
console.log("Canvas folder round-trip and transaction tests passed");
