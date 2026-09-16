"use strict";
const assert = require("assert/strict");
const Module = require("module");
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === "obsidian") {
    class Base {}
    return {Plugin:Base,ItemView:Base,Modal:Base,FuzzySuggestModal:Base,PluginSettingTab:Base,Setting:Base,WorkspaceLeaf:Base,Notice:Base,normalizePath:p=>p,setIcon(){}};
  }
  return load.call(this,name,parent,main);
};
const Plugin = require("../main.js");
Module._load = load;
const clone=value=>JSON.parse(JSON.stringify(value));
function doc() {
  const vars=new Map([["--another-plugin","keep"]]);
  return {defaultView:{closed:false},body:{dataset:{},style:{setProperty:(k,v)=>vars.set(k,v),removeProperty:k=>vars.delete(k)}},vars};
}
async function setup(saved={dataVersion:4,widgets:[]}) {
  const plugin=Object.create(Plugin.prototype), first=doc(), second=doc();
  plugin.app={workspace:{iterateAllLeaves:callback=>[first,second].forEach(ownerDocument=>callback({view:{contentEl:{ownerDocument}}}))}};
  plugin.settingsSaveQueue=Promise.resolve();
  plugin.loadData=async()=>clone(saved);
  plugin.saveData=async settings=>{plugin.disk=clone(settings);};
  plugin.renderAllViews=()=>{throw new Error("Typography must not rebuild views or stop live sessions");};
  await plugin.loadSettings();
  return {plugin,first,second};
}
(async()=>{
  const fresh=await setup(null);
  assert.equal(fresh.plugin.settings.textSize,"medium","new installs start with readable medium text");
  const {plugin,first,second}=await setup();
  assert.equal(plugin.settings.textSize,"small","existing installations keep their current compact size");
  assert.equal(plugin.settings.captionTextSize,"follow");
  const small=Plugin.typographyValues(plugin.settings);
  assert.equal(small["--jd-font-component-title"],"10px");
  assert.equal(small["--jd-font-caption"],"9px");
  assert.equal(small["--jd-font-body-compact"],"11px");
  assert.equal(small["--jd-caption-font-size"],"17px");
  assert(await plugin.setTypography("textSize","large"));
  assert.equal(first.body.dataset.jamDeckTextSize,"large");
  assert.equal(second.vars.get("--jd-font-body"),"16px","all workspace documents update");
  assert.equal(first.vars.get("--jd-caption-font-size"),"24px");
  assert(await plugin.setTypography("captionTextSize","small"));
  assert.equal(first.vars.get("--jd-caption-font-size"),"17px","caption override independent of global large");
  const reopened=await setup(plugin.disk);
  assert.equal(reopened.plugin.settings.textSize,"large");
  assert.equal(reopened.plugin.settings.captionTextSize,"small");
  await plugin.setTypography("captionTextSize","follow");
  const failureSnapshot=clone(plugin.settings), persist=plugin.saveData;
  plugin.saveData=async()=>{throw new Error("disk full");};
  assert.equal(await plugin.setTypography("textSize","medium"),false);
  assert.deepEqual(plugin.settings,failureSnapshot);
  assert.equal(first.body.dataset.jamDeckTextSize,"large","failed saves leave the visible scale unchanged");
  plugin.saveData=persist;
  await Promise.all([plugin.setTypography("textSize","small"),plugin.setTypography("textSize","medium"),plugin.setTypography("captionTextSize","large")]);
  assert.equal(plugin.disk.textSize,"medium","rapid selections persist in order");
  assert.equal(plugin.disk.captionTextSize,"large");
  assert.equal(first.vars.get("--jd-caption-font-size"),"24px");
  assert.equal(await plugin.setTypography("widgets","large"),false);
  const popout=doc();plugin.applyTypography(popout);
  assert.equal(popout.body.dataset.jamDeckTextSize,"medium");
  const broken=await setup({dataVersion:4,widgets:[],textSize:"oops",captionTextSize:"oops"});
  assert.equal(broken.plugin.settings.textSize,"small"); assert.equal(broken.plugin.settings.captionTextSize,"follow");
  plugin.clearTypography();
  for(const target of [first,second,popout]) {
    assert.equal(target.body.dataset.jamDeckTextSize,undefined);
    assert.deepEqual([...target.vars],[["--another-plugin","keep"]],"unloading removes only owned styling");
  }
  console.log("Typography: defaults, baseline, caption override, multiple documents, persistence, failure, rapid updates and cleanup passed");
})().catch(error=>{console.error(error);process.exitCode=1;});
