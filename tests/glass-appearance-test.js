"use strict";
const assert = require("assert/strict");
const fs = require("fs"), path = require("path"), os = require("os"), vm = require("vm"), Module = require("module");
const originalLoad = Module._load;
Module._load = function(name, ...args) {
  if (name === "obsidian") {
    class Base {}
    return { Plugin: Base, ItemView: Base, Modal: Base, FuzzySuggestModal: Base, PluginSettingTab: Base, Setting: Base, Notice: Base };
  }
  return originalLoad.call(this, name, ...args);
};
const Plugin = require("../main.js");
Module._load = originalLoad;
const clone = value => JSON.parse(JSON.stringify(value));

class Target {
  constructor() { this.events = new Map(); }
  addEventListener(type, fn) { this.events.set(type, fn); }
  removeEventListener(type) { this.events.delete(type); }
}
class Element extends Target {
  constructor(tag = "div") {
    super(); this.tagName = tag.toUpperCase(); this.dataset = {}; this.vars = new Map(); this.children = [];
    this.style = { setProperty: (k,v) => this.vars.set(k,v), removeProperty: k => this.vars.delete(k) };
    const classes = new Set(); this.classList = { add: n => classes.add(n), remove: n => classes.delete(n) };
    this.isConnected = true; this.offsetWidth = 100; this.offsetHeight = 60; this.paused = true;
  }
  setAttribute() {}
  removeAttribute(name) { delete this[name]; }
  append(child) { this.children.push(child); child.parent = this; }
  prepend(child) { this.children.unshift(child); child.parent = this; }
  remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
  load() { this.loads = (this.loads || 0) + 1; }
  play() { this.paused = false; this.plays = (this.plays || 0) + 1; return Promise.resolve(); }
  pause() { this.paused = true; }
  getClientRects() { return this.offsetWidth ? [{}] : []; }
  querySelectorAll() { return this.surfaces || []; }
}
function environment() {
  const timers = new Map(), observers = []; let sequence = 0, engines = [];
  class Observer {
    constructor(fn) { this.fn = fn; this.targets = []; observers.push(this); }
    observe(el) { this.targets.push(el); }
    disconnect() { this.disconnected = true; }
  }
  const doc = new Target(); doc.createElement = tag => new Element(tag); doc.hidden = false;
  const motion = new Target(); motion.matches = false;
  const win = { matchMedia: () => motion, IntersectionObserver: Observer, ResizeObserver: Observer, MutationObserver: Observer,
    setTimeout: fn => { const id = ++sequence; timers.set(id,fn); return id; }, clearTimeout: id => timers.delete(id) };
  doc.defaultView = win;
  const root = new Element(); root.ownerDocument = doc;
  root.surfaces = Array.from({length: 8}, () => new Element());
  const plugin = { settings: {...Plugin.appearanceSettings({}), animationsEnabled:true}, app: {vault:{adapter:{getResourcePath:p=>`app://vault/${p}`}}} };
  const source = fs.readFileSync(path.join(__dirname,"../main.js"),"utf8");
  const code = source.slice(source.indexOf("class JamDeckAppearance {"), source.indexOf("const DEFAULT_SETTINGS = {"));
  const Controller = vm.runInNewContext(`${code}\nJamDeckAppearance`, {
    jamDeckBackgroundKind: Plugin.backgroundKind, Notice: class {},
    jamDeckCreateGlassEngine: () => {
      const engine = { attached:new Set(), attach(el){this.attached.add(el);}, detach(el){this.attached.delete(el);}, dispose(){this.disposed=true;this.attached.clear();} };
      engines.push(engine); return engine;
    }
  });
  const view = { contentEl: root, plugin, aiChat: root.surfaces[2] };
  const appearance = new Controller(view);
  const flush = () => { for (const [id,fn] of Array.from(timers)) { timers.delete(id); fn(); } };
  return { appearance, root, plugin, doc, motion, timers, observers, engines, flush };
}

(async () => {
  const plugin = Object.create(Plugin.prototype);
  let updates = 0;
  plugin.app = {workspace:{getLeavesOfType:()=>[{view:{appearance:{update(){updates++;}}}},{view:{appearance:{update(){updates++;}}}}]}};
  plugin.settingsSaveQueue = Promise.resolve();
  plugin.loadData = async () => ({dataVersion:4,widgets:[]});
  plugin.saveData = async settings => { plugin.disk = clone(settings); };
  plugin.renderAllViews = () => { throw new Error("Skin change must preserve Canvas, captions, focus and AI sessions"); };
  await plugin.loadSettings();
  assert.equal(plugin.settings.skin,"spatial");
  assert(await plugin.setAppearance("skin","glass"));
  assert.equal(updates,2,"both workspace documents update in place");
  const saved = clone(plugin.disk);
  plugin.loadData = async () => saved; await plugin.loadSettings(); assert.equal(plugin.settings.skin,"glass");
  const persist = plugin.saveData;
  plugin.saveData = async () => {throw new Error("disk full");};
  assert.equal(await plugin.setAppearance("skin","spatial"),false);
  assert.equal(plugin.settings.skin,"glass"); assert.equal(updates,2,"failed save leaves visible appearance intact");
  plugin.saveData = persist;
  await Promise.all([plugin.setAppearance("skin","spatial"),plugin.setAppearance("skin","glass"),plugin.setAppearance("glassQuality","light")]);
  assert.equal(plugin.disk.skin,"glass"); assert.equal(plugin.disk.glassQuality,"light");
  assert.equal(await plugin.setAppearance("widgets",[]),false);
  let releaseSlot, writes=0;
  plugin.settingsSaveQueue=new Promise(resolve=>{releaseSlot=resolve;});
  plugin.saveData=async()=>{writes++;};
  const queued=plugin.setAppearance("skin","spatial");
  await Promise.resolve(); plugin.appearanceDisposed=true; releaseSlot();
  assert.equal(await queued,false); assert.equal(writes,0,"queued write must check unload when its slot starts");
  plugin.appearanceDisposed=false;
  let finishWrite, writing;
  const startedWrite=new Promise(resolve=>{writing=resolve;});
  plugin.saveData=async()=>{writing();await new Promise(resolve=>{finishWrite=resolve;});};
  const beforeUnloadUpdates=updates;
  const written=plugin.setAppearance("glassBackground","attachments/saved.mp4");
  await startedWrite; plugin.appearanceDisposed=true; finishWrite();
  assert.equal(await written,true,"a completed write retains its referenced attachment when unload happens in flight");
  assert.equal(updates,beforeUnloadUpdates,"unloaded instance must not update DOM after write completes");
  plugin.appearanceDisposed=false; plugin.saveData=persist;
  for (const unsafe of ["../secret.mp4","C:\\video.mp4","/Users/jam/video.mp4","https://example.com/video.mp4"]) {
    assert.equal(Plugin.appearanceSettings({glassBackground:unsafe}).glassBackground,"");
  }
  assert.equal(Plugin.appearanceSettings({glassBackground:"attachments\\背景.mp4"}).glassBackground,"attachments/背景.mp4");
  assert.equal(Plugin.appearanceSettings({glassBackgroundDim:90}).glassBackgroundDim,70);

  const e = environment(); e.appearance.update(); e.flush();
  assert.equal(e.root.children.length,0,"paper skin has no media layer or glass engine");
  e.plugin.settings.skin="glass"; e.plugin.settings.glassBackground="attachments/a.mp4"; e.appearance.update();
  const video = e.appearance.media;
  assert(video.muted && video.defaultMuted && video.loop && video.playsInline);
  assert(video.paused,"hidden deck does not start decoding playback");
  e.appearance.intersection.fn([{isIntersecting:true}]); e.flush();
  assert(!video.paused); assert.equal(e.engines[0].attached.size,4,"optical surface count is bounded");
  const contentIdentity = e.root.surfaces[0];
  e.plugin.settings.glassBackgroundDim=30; e.appearance.update(); e.flush();
  assert.equal(e.appearance.media,video,"dimming does not recreate the video");
  assert.equal(e.root.surfaces[0],contentIdentity);
  e.doc.hidden=true; e.doc.events.get("visibilitychange")(); e.flush(); assert(video.paused); assert(e.engines[0].disposed);
  e.doc.hidden=false; e.doc.events.get("visibilitychange")(); e.flush(); assert(!video.paused);
  e.motion.matches=true; e.motion.events.get("change")(); assert(video.paused);
  e.motion.matches=false; e.plugin.settings.animationsEnabled=false; e.appearance.syncPlayback(); assert(video.paused);
  e.plugin.settings.animationsEnabled=true; e.plugin.settings.glassVideoPlaying=false; e.appearance.syncPlayback(); assert(video.paused);
  e.plugin.settings.glassVideoPlaying=true;
  e.plugin.islandMode={active:true}; e.appearance.update(); e.flush();
  assert(video.paused && e.engines.at(-1).disposed,"island hiding suspends the deck even with background throttling disabled");
  e.plugin.islandMode.active=false; e.appearance.update(); e.flush(); assert(!video.paused);
  e.plugin.settings.glassBackground="attachments/b.webp"; e.appearance.update(); e.flush();
  assert(video.paused && video.removed && video.src === undefined && video.loads===1,"replacement releases the old decoder");
  assert.equal(e.root.children.length,1,"only one wallpaper layer");
  const image = e.appearance.media;
  e.plugin.settings.skin="spatial"; e.appearance.update(); e.flush();
  assert(image.removed); assert.equal(e.root.children.length,0); assert(e.engines.at(-1).disposed);
  e.appearance.destroy(); e.appearance.destroy();
  assert(e.observers.every(o=>o.disconnected)); assert.equal(e.timers.size,0);
  assert.equal(e.doc.events.size,0); assert.equal(e.motion.events.size,0);
  assert.equal(e.root.dataset.jamDeckSkin,undefined);
  const budget = environment(); budget.plugin.settings.skin="glass";
  for(const el of budget.root.surfaces) {el.offsetWidth=500;el.offsetHeight=300;}
  budget.appearance.visible=true; budget.appearance.update(); budget.flush();
  assert.equal(budget.engines[0].attached.size,2,"pixel budget limits many large surfaces");
  budget.plugin.settings.glassQuality="light"; budget.appearance.update(); budget.flush();
  assert(budget.engines[0].disposed); budget.appearance.destroy();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(),"jamdeck-background-"));
  try {
    const source = path.join(dir,"source.mp4"); fs.writeFileSync(source,"test-video-bytes");
    plugin.app.vault = {adapter:{getBasePath:()=>dir,remove:async rel=>fs.promises.unlink(path.join(dir,rel))}};
    plugin.ensureVaultFolder = async rel => fs.promises.mkdir(path.join(dir,rel),{recursive:true});
    plugin.getDroppedFilePath = () => source;
    assert(await plugin.importGlassBackground({name:"背景.mp4",arrayBuffer(){throw new Error("large video must use streamed OS copy");}}));
    const imported=plugin.settings.glassBackground;
    assert.equal(fs.readFileSync(path.join(dir,imported),"utf8"),"test-video-bytes");
    plugin.saveData=async()=>{throw new Error("disk full");};
    assert.equal(await plugin.importGlassBackground({name:"another.mp4"}),false);
    assert.equal(plugin.settings.glassBackground,imported);
    assert.equal(fs.readdirSync(path.join(dir,"attachments/jam-deck-backgrounds")).length,1,"failed import only removes its own new attachment");
    plugin.saveData = persist;
    plugin.getDroppedFilePath = () => "";
    plugin.app.vault.createBinary = async (rel,bytes) => fs.promises.writeFile(path.join(dir,rel),Buffer.from(bytes));
    let release, started;
    const copying = new Promise(resolve=>{started=resolve;});
    const slow = plugin.importGlassBackground({name:"slow.mp4",arrayBuffer:async()=>{started();return new Promise(resolve=>{release=resolve;});}});
    await copying;
    await plugin.setAppearance("glassBackground","");
    release(new Uint8Array([1,2,3]).buffer);
    assert.equal(await slow,false,"a late import cannot overwrite a newer restore-default request");
    assert.equal(plugin.settings.glassBackground,"");
    assert.equal(fs.readdirSync(path.join(dir,"attachments/jam-deck-backgrounds")).length,1);
    let unloadRelease, unloadStarted;
    const unloadingCopy = new Promise(resolve=>{unloadStarted=resolve;});
    const duringUnload=plugin.importGlassBackground({name:"unload.mp4",arrayBuffer:async()=>{unloadStarted();return new Promise(resolve=>{unloadRelease=resolve;});}});
    await unloadingCopy; plugin.appearanceDisposed=true; unloadRelease(new Uint8Array([4]).buffer);
    assert.equal(await duringUnload,false,"an unloaded plugin instance must not save stale settings after a copy");
    assert.equal(fs.readdirSync(path.join(dir,"attachments/jam-deck-backgrounds")).length,1);
    assert.equal(await plugin.setAppearance("skin","spatial"),false);
    await assert.rejects(plugin.importGlassBackground({name:"script.html"}),/请选择/);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
  console.log("Glass: persistence, rollback, ordered updates, path isolation, media lifecycle, motion, budgets, cleanup and streamed imports passed");
})().catch(error=>{console.error(error);process.exitCode=1;});
