"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");
const root = path.resolve(__dirname, "..");
const renderSource = fs.readFileSync(path.join(root, "native/island-capture/renderer.js"), "utf8");
const controlSource = fs.readFileSync(path.join(root, "native/island-capture/controller.js"), "utf8");
function renderer() {
  const calls = { decodes: 0, closed: 0, paints: 0, samples: 0, errors: [], optics: [], disposed: 0 };
  let accept, now = 0, brightness = 255;
  const controls = [{ dataset: {}, getBoundingClientRect: () => ({ left: 0, right: 800 }) },
    { dataset: {}, getBoundingClientRect: () => ({ left: 800, right: 1600 }) }];
  const canvas = { width: 0, height: 0, style: {}, parentElement: { style: {} },
    getBoundingClientRect: () => ({ left: 0, width: 1600 }), getContext: () => ({ drawImage() { calls.paints++; } }) };
  const sample = { getContext: () => ({ drawImage() {}, getImageData() {
    calls.samples++; const data = new Uint8ClampedArray(128 * 6 * 4);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 128; x++) data.fill(x < 64 ? brightness : 0, (y * 128 + x) * 4, (y * 128 + x) * 4 + 3);
    return { data };
  } }) };
  const win = { performance: { now: () => now }, Blob: class {},
    document: { createElement: name => { assert.equal(name, "canvas"); return sample; }, querySelectorAll: () => controls },
    createImageBitmap() { calls.decodes++; return new Promise(resolve => { accept = resolve; }); } };
  const engine = { attach(_el, opts) { calls.optics.push(opts); }, setOpts(opts) { calls.optics.push(opts); }, detach() {}, dispose() { calls.disposed++; } };
  const module = { exports: {} };
  vm.runInNewContext(renderSource + ";module.exports=jamDeckCreateIslandOptics;", { module, jamDeckCreateGlassEngine: () => engine });
  const instance = module.exports(win, canvas, error => calls.errors.push(error));
  instance.configure({ platform: "win32", bounds: { x: -2080, y: 0, width: 1600, height: 72 } });
  return { instance, calls, controls, material: canvas.parentElement, time: value => now = value, brightness: value => brightness = value,
    resolve: () => accept({ close() { calls.closed++; } }) };
}
const moduleForController = { exports: {} };
vm.runInNewContext(controlSource + ";module.exports=IslandGlassMaterial;", { module: moduleForController, process: { platform: "win32" }, Buffer, setTimeout, clearTimeout });
const Controller = moduleForController.exports;

(async () => {
  {
    const h = renderer();
    h.instance.update({ active: true, blur: 4, quality: "balanced" });
    h.instance.update({ active: true, blur: 8, quality: "balanced" });
    const pending = h.instance.frame(Buffer.from([1]));
    await h.instance.frame(Buffer.from([2]));
    assert.equal(h.calls.decodes, 1, "only one frame can decode at once");
    h.instance.update({ active: false }); h.resolve(); await pending;
    assert.equal(h.calls.closed, 1, "late frame is released after collapse");
    assert.equal(h.calls.paints, 0); assert.equal(h.calls.errors.length, 0);
    h.instance.dispose(); h.instance.dispose(); assert.equal(h.calls.disposed, 1);
  }
  {
    const h = renderer();
    h.instance.update({ active: true, blur: 0, quality: "balanced" });
    assert.equal(h.material.style.opacity, "0", "filter output stays hidden until a desktop frame is painted");
    const paint = async () => { const pending = h.instance.frame(Buffer.from([1])); h.resolve(); await pending; };
    await paint(); assert.equal(h.calls.paints, 1);
    assert.equal(h.material.style.opacity, "1");
    assert.equal(h.controls[0].dataset.glassTone, "light");
    assert.equal(h.controls[1].dataset.glassTone, "dark", "mixed desktop selects each control's own palette");
    delete h.controls[0].dataset.glassTone;
    h.instance.refreshText();
    assert.equal(h.controls[0].dataset.glassTone, "light", "rebuilt clipboard controls reuse the sampled desktop immediately");
    assert.equal(h.calls.samples, 1, "ordinary UI refresh does not trigger another pixel readback");
    h.brightness(128); h.time(500); await paint(); assert.equal(h.calls.samples, 1, "brightness readback capped at once per second");
    h.time(1000); await paint(); assert.equal(h.controls[0].dataset.glassTone, "light", "midrange keeps prior palette");
    h.brightness(32); h.time(2000); await paint(); assert.equal(h.controls[0].dataset.glassTone, "dark");
    h.brightness(128); h.time(3000); await paint(); assert.equal(h.controls[0].dataset.glassTone, "dark", "dead band works in both directions");
    h.brightness(255); h.time(4000); await paint(); assert.equal(h.controls[0].dataset.glassTone, "light");
    h.instance.update({ active: true, blur: 16, quality: "balanced" });
    assert.equal(h.calls.optics.at(-1).blur, 16);
    h.instance.update({ active: false }); const before = h.calls.decodes; await h.instance.frame(Buffer.from([1])); assert.equal(h.calls.decodes, before);
    assert.equal(h.material.style.opacity, "0", "collapse hides stale filter output before reopening");
    h.instance.dispose();
  }
  {
    let resolveConfiguration;
    const configurations = [], messages = [];
    const island = { isDestroyed: () => false, getBounds: () => ({ x: -2080, y: 0, width: 1600, height: 72 }), webContents: { executeJavaScript: v => { configurations.push(v); return new Promise(resolve => { resolveConfiguration = resolve; }); }, send: (...v) => messages.push(v) } };
    const remote = { screen: { getDisplayMatching: () => ({ id: 42, bounds: { x: -2560, y: 0, width: 2560, height: 1440 } }) } };
    const cancelled = new Controller(island, () => assert.fail(), remote, "test");
    cancelled.startNative = () => assert.fail("late configuration must not launch a helper");
    const pending = cancelled.start(); cancelled.stop(); resolveConfiguration(); await pending;
    assert.equal(cancelled.ready, false);
    const material = new Controller(island, () => assert.fail(), remote, "test");
    material.startNative = async () => {};
    const started = material.start(); resolveConfiguration(); await started;
    assert(configurations[0].includes('"platform":"win32"'));
    material.update(true, { glassBlur: 0, glassQuality: "balanced" });
    const count = messages.length; material.update(true, { glassBlur: 0, glassQuality: "balanced" }); assert.equal(messages.length, count);
    material.update(true, { glassBlur: 16, glassQuality: "light" }); assert.equal(messages.at(-1)[1].blur, 16);
    material.stop(); assert.equal(messages.at(-1)[1].active, false);
  }
  {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
    let kills = 0; child.kill = () => { kills++; };
    const frames = [], failures = [];
    const material = new Controller({ isDestroyed: () => false, webContents: { send: (channel, frame) => frames.push({ channel, frame }) } }, e => failures.push(e), null, "test");
    material.launchNative = () => child;
    const started = material.startNative({});
    child.stdout.write("rea"); child.stdout.write("dy\n"); await started;
    const packet = Buffer.from([0, 0, 0, 3, 1, 2, 3]);
    child.stdout.write(packet.subarray(0, 2)); child.stdout.write(packet.subarray(2));
    assert.equal(frames[0].channel, "test:capture-frame"); assert.deepEqual([...frames[0].frame], [1, 2, 3]);
    child.stdout.write(Buffer.from([255, 255, 255, 255])); assert.equal(failures.length, 1); assert.equal(kills, 1);
    material.stop(); assert.equal(kills, 1);
  }
  console.log("Island capture: local text tone, one-second sampling, hysteresis, frame cancellation, optics and native framing passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
