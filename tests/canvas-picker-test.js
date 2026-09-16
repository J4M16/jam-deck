"use strict";
const assert = require("assert/strict");
const fs = require("fs"), path = require("path"), vm = require("vm");
const source = fs.readFileSync(path.join(__dirname, "../main.js"), "utf8");
const modalCode = source.slice(source.indexOf("class CanvasFilePickerModal extends Modal"), source.indexOf("class BrowserConfigModal extends Modal"));
const nameCode = source.slice(source.indexOf("function jamDeckNextCanvasFileName("), source.indexOf("function jamDeckCanvasStackNormalizationKey("));
const notices = [];
class Modal {
  constructor(app) { this.app = app; this.contentEl = { setAttribute() {}, querySelectorAll: () => [], empty() {} }; }
  close() { this.onClose(); }
}
const Picker = vm.runInNewContext(`${nameCode}\n${modalCode}\nCanvasFilePickerModal`, { Modal, Notice: class { constructor(text) { notices.push(text); } } });
function setup(widgetId = "widget") {
  const files = new Map([["未命名.canvas", { path: "未命名.canvas" }]]), selected = [], added = [], created = [];
  const app = { vault: {
    getAbstractFileByPath: name => files.get(name),
    async create(name, text) { assert(!files.has(name)); assert.deepEqual(JSON.parse(text), { nodes: [], edges: [] }); const file = {path:name}; files.set(name,file); created.push(name); return file; },
  } };
  const plugin = { async setCanvasEmbedFile(id, name) { selected.push([id,name]); return true; }, async addCanvasEmbedWidget(name) { added.push(name); return true; } };
  const picker = new Picker(app, plugin, widgetId); picker.renderList = () => {};
  return { picker, app, plugin, selected, added, created, files };
}
(async () => {
  const existing = setup(); await existing.picker.selectFile("Existing.canvas");
  assert.deepEqual(existing.selected, [["widget","Existing.canvas"]]); assert.equal(existing.created.length,0); assert(existing.picker.closed);
  const fresh = setup(); await fresh.picker.selectFile(null,true);
  assert.deepEqual(fresh.selected,[["widget","未命名 1.canvas"]]); assert(fresh.picker.closed);
  const adding = setup(null); await adding.picker.selectFile(null,true);
  assert.deepEqual(adding.added,["未命名 1.canvas"]); assert.equal(adding.selected.length,0);
  const busy = setup(); let release;
  const create = busy.app.vault.create;
  busy.app.vault.create = async (...args) => { await new Promise(resolve => { release=resolve; }); return create(...args); };
  const first=busy.picker.selectFile(null,true); await busy.picker.selectFile(null,true); await busy.picker.selectFile("Other.canvas");
  release(); await first; assert.equal(busy.created.length,1); assert.equal(busy.selected.length,1);
  const fail = setup(); fail.app.vault.create=async()=>{throw new Error("disk full");};
  await fail.picker.selectFile(null,true); assert.equal(fail.selected.length,0); assert(!fail.picker.busy); assert(!fail.picker.closed);
  const retry=setup(); retry.plugin.setCanvasEmbedFile=async()=>false;
  await retry.picker.selectFile(null,true); assert(!retry.picker.closed); assert.equal(retry.created.length,1);
  retry.plugin.setCanvasEmbedFile=async()=>true; await retry.picker.selectFile(null,true);
  assert.equal(retry.created.length,1,"retry reuses the already saved Canvas"); assert(retry.picker.closed);
  const thrown=setup(); thrown.plugin.setCanvasEmbedFile=async()=>{throw new Error("save failed");};
  await thrown.picker.selectFile(null,true); assert(!thrown.picker.closed); assert.equal(thrown.created.length,1);
  assert(notices.some(text=>text.includes("未命名 1.canvas")&&text.includes("切换失败")));
  const closed=setup(); const slowCreate=closed.app.vault.create;
  closed.app.vault.create=async(...args)=>{await new Promise(resolve=>{release=resolve;});return slowCreate(...args);};
  const pending=closed.picker.selectFile(null,true); closed.picker.close(); release(); await pending;
  assert.equal(closed.created.length,1); assert.equal(closed.selected.length,0,"closing while creating must not switch a widget afterward");
  console.log("Canvas picker: selection, new/replace, unique name, duplicate clicks, failures/retry and close-during-create passed");
})().catch(error=>{console.error(error);process.exitCode=1;});
