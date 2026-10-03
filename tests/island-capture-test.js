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
  const calls = { requests: 0, stopped: 0, paints: 0, errors: [], optics: [], disposed: 0 };
  let accept;
  const frames = new Map();
  const track = { stop() { calls.stopped++; }, addEventListener() {} };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const video = { videoWidth: 2560, videoHeight: 1440, pause() {}, play: async () => {},
    requestVideoFrameCallback(fn) { frames.set(1, fn); return 1; }, cancelVideoFrameCallback(id) { frames.delete(id); } };
  const canvas = { width: 0, height: 0, style: {}, parentElement: { style: {} }, getContext: () => ({ drawImage() { calls.paints++; } }) };
  const win = { document: { createElement: () => video }, navigator: { mediaDevices: { getUserMedia(options) {
    calls.requests++; assert.equal(options.audio, false); assert.equal(options.video.mandatory.maxFrameRate, 30);
    return new Promise(resolve => { accept = resolve; });
  } } } };
  const engine = { attach(_el, opts) { calls.optics.push(opts); }, setOpts(opts) { calls.optics.push(opts); }, detach() {}, dispose() { calls.disposed++; } };
  const module = { exports: {} };
  vm.runInNewContext(renderSource + ";module.exports=jamDeckCreateIslandOptics;", { module, jamDeckCreateGlassEngine: () => engine });
  const instance = module.exports(win, canvas, error => calls.errors.push(error));
  instance.configure({ platform: "win32", sourceId: "screen:0:0", display: { x: -2560, y: 0, width: 2560, height: 1440 }, bounds: { x: -2080, y: 0, width: 1600, height: 72 } });
  return { instance, calls, frames, material: canvas.parentElement, resolve: () => accept(stream) };
}
const flush = () => new Promise(setImmediate);
const moduleForController = { exports: {} };
vm.runInNewContext(controlSource + ";module.exports=IslandGlassMaterial;", { module: moduleForController, process: { platform: "win32" }, Buffer, setTimeout, clearTimeout });
const Controller = moduleForController.exports;

(async () => {
  {
    const h = renderer();
    h.instance.update({ active: true, blur: 4, quality: "balanced" });
    h.instance.update({ active: true, blur: 8, quality: "balanced" });
    assert.equal(h.calls.requests, 1, "retuning must not open a second stream");
    h.instance.update({ active: false }); h.resolve(); await flush();
    assert.equal(h.calls.stopped, 1, "a stream resolving after collapse is stopped immediately");
    assert.equal(h.frames.size, 0); assert.equal(h.calls.errors.length, 0);
    h.instance.dispose(); h.instance.dispose(); assert.equal(h.calls.disposed, 1);
  }
  {
    const h = renderer();
    h.instance.update({ active: true, blur: 0, quality: "balanced" }); h.resolve(); await flush();
    assert.equal(h.material.style.opacity, "0", "filter output stays hidden until a desktop frame is painted");
    h.frames.get(1)(); assert.equal(h.calls.paints, 1);
    assert.equal(h.material.style.opacity, "1");
    h.instance.update({ active: true, blur: 16, quality: "balanced" });
    assert.equal(h.calls.optics.at(-1).blur, 16); assert.equal(h.calls.requests, 1);
    h.instance.update({ active: false }); assert.equal(h.calls.stopped, 1); assert.equal(h.frames.size, 0);
    assert.equal(h.material.style.opacity, "0", "collapse hides stale filter output before reopening");
    h.instance.dispose(); assert.equal(h.calls.stopped, 1);
  }
  {
    let resolveSources;
    const configurations = [], messages = [];
    const island = { isDestroyed: () => false, getBounds: () => ({ x: -2080, y: 0, width: 1600, height: 72 }), webContents: { executeJavaScript: async v => configurations.push(v), send: (...v) => messages.push(v) } };
    const remote = { screen: { getDisplayMatching: () => ({ id: 42, bounds: { x: -2560, y: 0, width: 2560, height: 1440 } }) }, require: () => ({ desktopCapturer: { getSources: () => new Promise(resolve => { resolveSources = resolve; }) } }) };
    const cancelled = new Controller(island, () => assert.fail(), remote, "test");
    const pending = cancelled.start(); cancelled.stop(); resolveSources([{ display_id: "42", id: "screen:0:0" }]); await pending;
    assert.equal(configurations.length, 0, "late source discovery must not touch a closed island");
    const material = new Controller(island, () => assert.fail(), remote, "test");
    const started = material.start(); resolveSources([{ display_id: "42", id: "screen:0:0" }]); await started;
    assert(configurations[0].includes('"sourceId":"screen:0:0"'));
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
    material.launchMac = () => child;
    const started = material.startMac({});
    child.stdout.write("rea"); child.stdout.write("dy\n"); await started;
    const packet = Buffer.from([0, 0, 0, 3, 1, 2, 3]);
    child.stdout.write(packet.subarray(0, 2)); child.stdout.write(packet.subarray(2));
    assert.equal(frames[0].channel, "test:capture-frame"); assert.deepEqual([...frames[0].frame], [1, 2, 3]);
    child.stdout.write(Buffer.from([255, 255, 255, 255])); assert.equal(failures.length, 1); assert.equal(kills, 1);
    material.stop(); assert.equal(kills, 1);
  }
  console.log("Island capture: shared optics, stream cancellation, frame lifecycle, retuning and native framing passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
