"use strict";
const assert = require("assert/strict"), fs = require("fs"), path = require("path"), vm = require("vm");
const source = fs.readFileSync(path.join(__dirname, "../main.js"), "utf8");
const code = source.slice(source.indexOf("class CanvasToolbarIdleController {"), source.indexOf("class CanvasSelectionToolbarController {"));
const Controller = vm.runInNewContext(code + "\nCanvasToolbarIdleController");
class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  emit(name, event = {}) { for (const fn of this.listeners.get(name) || []) fn(event); }
}
let now = 0, sequence = 0;
const timers = new Map(), win = new Target();
Object.assign(win, { performance: { now: () => now }, setTimeout(fn, delay) { timers.set(++sequence, { fn, at: now + delay }); return sequence; }, clearTimeout(id) { timers.delete(id); } });
const advance = ms => { now += ms; for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); } };
function canvas() {
  const root = new Target(), classes = new Set();
  root.ownerDocument = { defaultView: win };
  root.classList = { contains: v => classes.has(v), add: v => classes.add(v), remove: v => classes.delete(v) };
  return { root, idle: () => classes.has("jam-deck-canvas-toolbar-idle"), controller: new Controller(root) };
}
const a = canvas(); advance(4999); assert(!a.idle()); advance(1); assert(a.idle());
for (const event of ["pointerenter", "pointermove", "wheel", "keydown", "focusin", "input", "dragover"]) {
  a.root.emit(event); assert(!a.idle(), event + " wakes the toolbar"); advance(5000); assert(a.idle());
}
a.root.emit("pointermove"); advance(4000); a.root.emit("pointermove"); advance(1000); assert(!a.idle());
advance(4000); assert(a.idle(), "deadline follows the latest Canvas use");
for (let i = 0; i < 100; i++) a.root.emit("pointermove"); assert.equal(timers.size, 1);
a.root.emit("pointerdown", { pointerId: 3 }); advance(6000); assert(!a.idle(), "held drag stays visible");
win.emit("pointerup", { pointerId: 3 }); advance(4999); assert(!a.idle()); advance(1); assert(a.idle());
for (const event of ["blur", "dragend", "drop"]) {
  a.root.emit("pointerdown", { pointerId: 4 }); win.emit(event); advance(5000); assert(a.idle(), event + " releases a native drag");
}
const b = canvas(); a.root.emit("pointermove"); advance(4000); b.root.emit("pointermove"); advance(1000);
assert(a.idle()); assert(!b.idle(), "separate canvases have independent deadlines");
const late = [...timers.values()][0].fn;
a.controller.destroy(); b.controller.destroy(); late();
assert(!a.idle() && !b.idle()); assert.equal(timers.size, 0);
for (const target of [a.root, b.root, win]) assert([...target.listeners.values()].every(set => set.size === 0));
a.root.emit("pointermove"); assert.equal(timers.size, 0, "destroyed listeners never restart timers");
const calls = [];
const open = source.match(/  openSettings\(\) \{([\s\S]*?)\n  \}/)[1];
new Function(open).call({ app: { setting: { open: () => calls.push("open"), openTabById: id => calls.push(id) } }, manifest: { id: "jam-deck" } });
assert.deepEqual(calls, ["open", "jam-deck"]);
console.log("Canvas toolbar: idle deadline, input wake, drag, independent canvases, teardown and settings shortcut passed");
