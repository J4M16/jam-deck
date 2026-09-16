"use strict";
const assert = require("assert/strict");
const Module = require("module");
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "obsidian") {
    class Base {}
    return { ItemView: Base, Modal: Base, Notice: Base, Plugin: Base, PluginSettingTab: Base, Setting: Base, WorkspaceLeaf: Base, normalizePath: p => p, setIcon() {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const Plugin = require("../main.js");
Module._load = originalLoad;
// Layout reacts to actual wrapped rows and releases every observed node on teardown.
{
  let callback, disconnected = false, multirow;
  const observed = [];
  class Observer {
    constructor(fn) { callback = fn; }
    observe(node) { observed.push(node); }
    disconnect() { disconnected = true; }
  }
  const children = [0, 0, 0].map(offsetTop => ({offsetTop, classList:{contains:()=>true}}));
  const grid = {children, ownerDocument:{defaultView:{ResizeObserver:Observer}}, classList:{toggle:(_, value)=>{multirow=value;}}};
  const dispose = Plugin.observeLauncherLayout(grid);
  assert.equal(multirow, false);
  assert.equal(observed.length, 4);
  children[2].offsetTop = 96; callback(); assert.equal(multirow, true);
  children.forEach(item => { item.offsetTop = 120; }); callback(); assert.equal(multirow, false);
  dispose(); assert.equal(disconnected, true);
}
const clone = value => JSON.parse(JSON.stringify(value));
function setup(shortcuts = []) {
  const plugin = Object.create(Plugin.prototype);
  plugin.settings = { widgets: [{id: "launcher", config: {shortcuts: clone(shortcuts)}}] };
  plugin.renderAllViews = () => {};
  plugin.resolveShortcutIconPath = item => item?.iconPath || null;
  plugin.persistLocalShortcutLink = async () => null;
  plugin.extractExeIcon = async () => null;
  plugin.saveSettings = async () => { plugin.disk = clone(plugin.settings); };
  return plugin;
}
const items = plugin => plugin.settings.widgets[0].config.shortcuts;
(async () => {
  for (const [input, expected] of [["字幕", "字"], [" 👩🏽‍💻 工作", "👩🏽‍💻"], ["🇨🇳ABC", "🇨🇳"], ["e\u0301xy", "é"], ["", ""]]) {
    assert.equal(Plugin.shortcutCharacter(input), expected, "one complete grapheme, not one UTF-16 code unit");
  }
  const raw = {mode:"character", character:"✨更多", start:"#112233", end:"#fedcba", folderColor:"#AECBA4"};
  const appearance = Plugin.shortcutAppearance(raw);
  assert.equal(appearance.character,"✨"); assert.equal(appearance.end,"#FEDCBA");
  const malformed = Plugin.shortcutAppearance({start:"url(https://example.com)",end:"#f",mode:"unknown"});
  assert.equal(malformed.start,"#EFD3A6"); assert.equal(malformed.end,"#E9BFCB"); assert.equal(malformed.mode,"auto");
  assert.equal(Plugin.shortcutAppearance(null).mode,"auto");
  assert.equal(Plugin.shortcutAppearance({folderColor:"#EDD0AE"}).folderColor,"#EFCF9E","legacy canvas color maps to the matching shortcut hue");
  assert.equal(Plugin.shortcutAppearance({folderColor:"#123456"}).folderColor,"#C8C2B8","unknown colors fall back to the neutral swatch");
  const preview = {
    children: [], style: {setProperty() {}}, addClass() {}, removeAttribute() {}, setAttribute() {},
    empty() { for (const child of this.children) child.parentElement=null; this.children=[]; },
    createSpan(options) { this.children.push({text:options.text,parentElement:this}); },
    createEl() {
      const child={parentElement:this,addEventListener(type,handler){this[type]=handler;},remove(){this.parentElement.children=this.parentElement.children.filter(item=>item!==this);this.parentElement=null;}};
      this.children.push(child); return child;
    },
  };
  const renderer={isUrlShortcut:()=>false,resolveShortcutIconPath:()=>"icon.png",app:{vault:{adapter:{getResourcePath:p=>p}}}};
  Plugin.renderShortcutIcon(renderer,preview,{name:"应用"});
  const staleImage=preview.children[0];
  Plugin.renderShortcutIcon(renderer,preview,{name:"设计",appearance});
  staleImage.error();
  assert.deepEqual(preview.children.map(child=>child.text),["✨"],"late image errors must not overwrite a newer character preview");
  const plugin = setup();
  assert(await plugin.saveShortcut("launcher",null,"设计","https://example.com/design",raw));
  const id = items(plugin)[0].id;
  assert.deepEqual(plugin.disk.widgets[0].config.shortcuts[0].appearance,appearance);
  raw.start="#000000";
  assert.equal(items(plugin)[0].appearance.start,"#112233","saved data must not alias the editor draft");
  const reopened=setup(plugin.disk.widgets[0].config.shortcuts);
  const draft=Plugin.shortcutAppearance(items(reopened)[0].appearance); draft.character="改";
  assert.equal(items(reopened)[0].appearance.character,"✨","canceling a draft leaves saved settings alone");
  assert(await reopened.saveShortcut("launcher",id,"重命名","https://example.com/design"));
  assert.deepEqual(items(reopened)[0].appearance,appearance,"other callers preserve appearance when omitted");
  const before=clone(items(reopened));
  reopened.saveSettings=async()=>{throw new Error("disk full");};
  assert.equal(await reopened.saveShortcut("launcher",id,"不应保存","https://example.com/other",draft),false);
  assert.deepEqual(items(reopened),before,"save failure rolls back target, name and appearance together");
  assert.equal(await plugin.saveShortcut("launcher",null,"重复","https://example.com/design",draft),false);
  assert.equal(items(plugin).length,1);
  for (const target of ["D:\\Project\\Assets", "/Users/jam/Design"]) {
    const local=setup([{id:"folder",name:"作品",path:target,isFolder:true,localPath:"managed/link"}]);
    assert(await local.saveShortcut("launcher","folder","作品",target,{...appearance,mode:"auto"}));
    assert.equal(items(local)[0].path,target); assert.equal(items(local)[0].localPath,"managed/link");
    assert.equal(items(local)[0].isFolder,true); assert.equal(items(local)[0].appearance.folderColor,"#AECBA4");
  }
  for (const target of ["C:\\Apps\\Design.exe", "/Applications/Design.app"]) {
    const app=setup([{id:"app",name:"应用",path:target,isFolder:false,iconPath:"icons/app.png",localPath:"managed/app"}]);
    assert(await app.saveShortcut("launcher","app","应用",target,appearance));
    assert.equal(items(app)[0].iconPath,"icons/app.png"); assert.equal(items(app)[0].isFolder,false);
  }
  console.log("shortcut appearance: graphemes, validation, round trip, draft isolation, rollback and Windows/macOS targets passed");
})().catch(error=>{console.error(error);process.exitCode=1;});
