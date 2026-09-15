"use strict";
const assert = require("assert/strict"), fs = require("fs"), path = require("path"), os = require("os"), vm = require("vm"), crypto = require("crypto");
const { EventEmitter } = require("events");
const source = fs.readFileSync(path.join(__dirname, "../main.js"), "utf8");
const factoryText = source.slice(source.indexOf("function jamDeckCreateCanvasDownloadService("), source.indexOf("function jamDeckCanvasDownloadNode("));
const coordinatorText = source.slice(source.indexOf("function jamDeckCanvasDownloadNode("), source.indexOf("class CanvasLinkNavigationBridge"));
const create = vm.runInNewContext(`(${factoryText.trim()})`, { console });
const notices = [];
const Coordinator = vm.runInNewContext(`${coordinatorText}\nCanvasDownloadCoordinator`, {
  crypto, CANVAS_DOWNLOAD_DIR: "attachments/jam-deck-canvas-downloads", Notice: class { constructor(message) { notices.push(message); } }, console,
});
class Item extends EventEmitter {
  constructor(name) { super(); this.name = name; }
  getFilename() { return this.name; }
  setSavePath(file) { this.file = file; fs.writeFileSync(file, "fixture"); }
  cancel() { this.cancelled = true; }
  finish(state = "completed") { this.emit("done", {}, state); }
}
async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jam-deck-download-"));
  try {
    const session = new EventEmitter(), events = [];
    const contents = [1, 2, 3].map(id => ({ id, session, isDestroyed: () => false, getType: () => "webview" }));
    const req = name => name === "electron" ? { webContents: { fromId: id => contents.find(w => w.id === id) } } : require(name);
    const service = create(req, { root, directory: "attachments/downloads", temporary: ".cache/downloads" }, text => events.push(JSON.parse(text)));
    const owner = { canvasPath: "A.canvas", nodeId: "web", rect: { x: 0, y: 0, width: 500, height: 300 } };
    service.register(1, JSON.stringify(owner));
    service.register(2, JSON.stringify({ ...owner, canvasPath: "B.canvas" }));
    assert.equal(session.listenerCount("will-download"), 1);
    const unrelated = new Item("ordinary.txt"); session.emit("will-download", {}, unrelated, contents[2]);
    assert.equal(unrelated.file, undefined, "unowned tabs keep ordinary downloads");
    const first = new Item("../../data.json"), second = new Item("../../data.json");
    session.emit("will-download", {}, first, contents[0]); session.emit("will-download", {}, second, contents[1]);
    assert(first.file.includes(`${path.sep}.cache${path.sep}`));
    service.unregister(1); first.finish(); second.finish();
    const completed = events.filter(event => event.type === "completed");
    assert.equal(completed.length, 2);
    assert.equal(completed[0].owner.canvasPath, "A.canvas", "removing source binding does not redirect in-flight downloads");
    assert.equal(completed[1].owner.canvasPath, "B.canvas");
    assert.notEqual(completed[0].path, completed[1].path);
    for (const event of completed) {
      assert.equal(path.posix.dirname(event.path), "attachments/downloads");
      assert.equal(fs.readFileSync(path.join(root, event.path), "utf8"), "fixture");
    }
    assert(!fs.existsSync(path.join(root, "data.json")));
    for (const state of ["cancelled", "interrupted"]) {
      const item = new Item("cancel.txt"); session.emit("will-download", {}, item, contents[1]); item.finish(state);
      assert(!fs.existsSync(item.file)); assert.equal(events.at(-1).type, "failed");
    }
    const pending = new Item("pending.mp4"); session.emit("will-download", {}, pending, contents[1]); service.dispose();
    assert(pending.cancelled); assert(!fs.existsSync(pending.file));
    assert.equal(session.listenerCount("will-download"), 0); assert.equal(pending.listenerCount("done"), 0);
    assert.throws(() => create(req, { root, directory: "../escape", temporary: ".cache" }, () => {}), /Invalid/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  for (const [api, root] of [[path.win32, "C:\\Users\\Jam\\Vault"], [path.posix, "/Users/jam/Vault"]]) {
    const session = new EventEmitter(), events = [], files = new Set();
    const wc = { id: 9, session, isDestroyed: () => false, getType: () => "webview" };
    const fakeFs = { mkdirSync() {}, linkSync: (from, to) => files.add(to), unlinkSync: file => files.delete(file) };
    const service = create(name => name === "fs" ? fakeFs : name === "path" ? api : name === "electron" ? { webContents: { fromId: () => wc } } : require(name),
      { root, directory: "attachments/downloads", temporary: ".cache/downloads" }, text => events.push(JSON.parse(text)));
    service.register(9, JSON.stringify({ canvasPath: "A.canvas" }));
    const item = new Item("CON.txt"); item.setSavePath = file => { item.file = file; files.add(file); };
    session.emit("will-download", {}, item, wc); item.finish(); service.dispose();
    const saved = events.find(event => event.type === "completed");
    assert(saved.path.startsWith("attachments/downloads/") && !saved.path.includes("\\"));
    assert(api.resolve(root, saved.path).startsWith(root + api.sep));
  }
  const board = { path: "Original.canvas", basename: "Original" }, attachment = { path: "attachments/jam-deck-canvas-downloads/result.pdf" };
  const web = { id: "web", type: "link", x: 10, y: 20, width: 500, height: 400 };
  let document = { nodes: [web], edges: [{ id: "edge" }], custom: "preserved" };
  const files = new Map([[board.path, board], [attachment.path, attachment]]), views = [], reconciled = [];
  const app = { vault: { getAbstractFileByPath: name => files.get(name), adapter: { reconcileInternalFile: async name => reconciled.push(name) },
    process: async (file, fn) => { assert.equal(file, board); document = JSON.parse(fn(JSON.stringify(document))); } },
    workspace: { iterateAllLeaves: fn => views.forEach(view => fn({ view })) } };
  const coordinator = new Coordinator({ app, entries: new Map() });
  const owner = { canvasPath: board.path, nodeId: web.id, rect: web };
  for (const id of ["one", "two"]) {
    coordinator.receive({ type: "started", id, owner }); coordinator.receive({ type: "completed", id, owner, path: attachment.path });
  }
  await coordinator.pending;
  assert.equal(document.nodes.length, 3); assert.equal(document.nodes[1].x, 542);
  assert(document.nodes[2].y >= document.nodes[1].y + 300);
  assert.equal(document.custom, "preserved"); assert.equal(document.edges.length, 1); assert(reconciled.includes(attachment.path));
  let saved = 0;
  const nodes = new Map([[web.id, { getData: () => web }]]);
  const live = { file: board, canvas: { nodes, requestSave() {}, createFileNode() {
    let data = { id: "native", type: "file", file: attachment.path };
    const node = { getData: () => data, setData: value => { data = value; } }; nodes.set(data.id, node); return node;
  } }, saveImmediately: async () => { saved++; } };
  views.push({ file: { path: "Other.canvas" }, canvas: { createFileNode: () => assert.fail("wrong board") } }, live);
  await coordinator.place({ owner, path: attachment.path }, board);
  assert.equal(saved, 1); assert.equal(nodes.get("native").getData().x, 542);
  await coordinator.destroy(); await coordinator.place({ owner, path: attachment.path }, board);
  assert.equal(saved, 1, "dispose blocks late insertion");
  console.log("Canvas downloads: ownership, disk save, cancellation, cleanup, Windows/Mac paths, original board and concurrent placement passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
