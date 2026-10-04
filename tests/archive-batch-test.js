"use strict";
const assert = require("assert/strict");
const fs = require("fs"), path = require("path"), Module = require("module");
const clone = value => JSON.parse(JSON.stringify(value));
const notices = [];
function loadPlugin(filename = path.resolve(__dirname, "../main.js")) {
  const original = Module._load;
  Module._load = function(name, ...args) {
    if (name === "obsidian") {
      class Base {}
      return { Plugin: Base, ItemView: Base, Modal: Base, FuzzySuggestModal: Base,
        PluginSettingTab: Base, Setting: Base, Notice: class { constructor(text) { notices.push(text); } } };
    }
    return original.call(this, name, ...args);
  };
  try { return require(filename); } finally { Module._load = original; }
}
function fixture(Plugin = loadPlugin(), options = {}) {
  const files = new Map(), folders = new Set(), stats = { saves:0, renders:0, processes:0, deletes:0 };
  const sleep = ms => ms ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();
  const plugin = Object.create(Plugin.prototype);
  plugin.settings = { widgets:[], clipboardItems:[], deckRoutines:[], deckTasks:[],
    workArchiveMode:"file", workArchiveFile:"Work/工作.md", lifeArchiveMode:"file", lifeArchiveFile:"Life/Daily.md" };
  plugin.archiveQueue = Promise.resolve(); plugin.settingsSaveQueue = Promise.resolve(); plugin.archivingTaskIds = new Set();
  plugin.renderAllViews = () => { stats.renders++; const end = performance.now() + (options.renderMs || 0); while (performance.now() < end) {} };
  plugin.saveData = async settings => {
    stats.saves++;
    await sleep(options.saveMs);
    if (stats.saves === options.failSave) throw new Error("save failed");
    plugin.disk = clone(settings);
  };
  plugin.app = { workspace:{getLeavesOfType:()=>[]}, fileManager:{
    getAvailablePathForAttachment: async (filename, source) => `${path.posix.dirname(source)}/附件/${filename}`
  }, vault:{
    getAbstractFileByPath: name => files.has(name) ? {path:name} : folders.has(name) ? {path:name} : null,
    createFolder: async name => { folders.add(name); },
    create: async (name, text) => { if (files.has(name)) throw Error("exists"); files.set(name,text); return {path:name}; },
    createBinary: async (name, bytes) => { files.set(name,bytes); return {path:name}; },
    read: async file => files.get(file.path), readBinary: async file => files.get(file.path),
    process: async (file, update) => {
      stats.processes++; await sleep(options.processMs);
      if (file.path === options.failNote) throw Error("note write failed");
      if (options.beforeProcess) options.beforeProcess(plugin, files, file);
      files.set(file.path, update(files.get(file.path)));
    },
    delete: async file => { stats.deletes++; if (options.beforeDelete) options.beforeDelete(plugin,file); files.delete(file.path); }
  }};
  function task(id, category = "work", image = false) {
    const item = { id, text:`事项 ${id}`, category, status:"completed", createdAt:1, completedAt:2,
      archivedAt:null, archiveDate:null, journalPath:null, archiveFormat:null, archiveRef:null,
      archiveTargetDate:null, archiveTargetPath:null, pendingJournalOp:null, images:[], links:[] };
    if (image) {
      const source = `attachments/jam-deck-task-assets/2026-10-04/source-${id}.png`;
      files.set(source,Buffer.from([1,2,3])); item.images.push({id:`image-${id}`,path:source});
    }
    plugin.settings.deckTasks.push(item); return item;
  }
  return {plugin,files,stats,task,options};
}
async function benchmark(filename) {
  const f = fixture(loadPlugin(filename), {saveMs:15, processMs:10, renderMs:3});
  for(let i=0;i<20;i++) f.task(`task-${i}`, i%2 ? "work" : "life");
  const start = performance.now();
  const failed = await f.plugin.archiveCompletedTasks();
  return { tasks:20, simulatedSaveMs:15, simulatedNoteMs:10, simulatedRenderMs:3,
    elapsedMs:Math.round(performance.now()-start), failed, ...f.stats };
}
async function tests() {
  const f = fixture();
  for(let i=0;i<20;i++) f.task(`task-${i}`, i%2 ? "work" : "life");
  assert.equal(await f.plugin.archiveCompletedTasks(),0);
  assert.equal(f.stats.saves,4,"one checkpoint per batch stage");
  assert.equal(f.stats.processes,2,"one atomic write per target note");
  assert.equal(f.stats.renders,2,"one render at entry and one at exit");
  for(const task of f.plugin.settings.deckTasks) {
    assert.equal(task.status,"archived"); assert.equal(task.pendingJournalOp,null);
    assert(f.plugin.findLifeTaskBlock(f.files.get(task.journalPath),task.id).range);
  }
  assert.equal(await f.plugin.archiveCompletedTasks(),0); assert.equal(f.stats.saves,4);

  const shared = fixture(); shared.plugin.settings.lifeArchivePath="Work/工作.md";
  shared.task("task-shared-work"); shared.task("task-shared-life","life");
  assert.equal(await shared.plugin.archiveCompletedTasks(),0);
  assert.equal(shared.stats.processes,1,"work/life sharing a note must not overwrite one another");
  assert(shared.files.get("Work/工作.md").includes("分类：工作"));
  assert(shared.files.get("Work/工作.md").includes("分类：生活"));
  const directories = fixture();
  Object.assign(directories.plugin.settings,{workArchiveMode:"dir",workArchiveDir:"Work/Daily",lifeArchiveMode:"dir",lifeArchiveDir:"Life/Daily"});
  directories.task("task-dir-work"); directories.task("task-dir-life","life");
  assert.equal(await directories.plugin.archiveCompletedTasks(),0);
  for(const task of directories.plugin.settings.deckTasks) assert(task.journalPath.endsWith(task.archiveDate+".md"));

  for(const stage of [1,2,3,4]) {
    const failed = fixture(undefined,{failSave:stage});
    const tasks = [failed.task("task-one","work",true),failed.task("task-two","work",true)];
    const sources = tasks.map(t=>t.images[0].path);
    assert.equal(await failed.plugin.archiveCompletedTasks(),stage===4 ? 0 : 2);
    assert.equal(failed.plugin.archivingTaskIds.size,0);
    if(stage<4) {
      tasks.forEach(t=>assert.equal(t.status,"completed")); sources.forEach(p=>assert(failed.files.has(p)));
      tasks.forEach(t=>assert.equal(t.archiveDate,null,"rollback archive date with status"));
    } else tasks.forEach(t=>assert.equal(t.status,"archived"));
    const restart = fixture(); restart.plugin.settings = clone(failed.plugin.disk || failed.plugin.settings);
    failed.files.forEach((value,key)=>restart.files.set(key,value));
    if(stage===1) { restart.options.failSave=undefined; await restart.plugin.archiveCompletedTasks(); }
    else await restart.plugin.resumePendingJournalOperations();
    for(const task of restart.plugin.settings.deckTasks) {
      assert.equal(task.status,"archived");
      const md = restart.files.get(task.journalPath);
      assert.equal(md.split(restart.plugin.lifeTaskMarker(task.id,"start")).length-1,1,"restart must not duplicate blocks");
    }
  }

  const partial = fixture(undefined,{failNote:"Life/Daily.md"});
  partial.task("task-work"); const life = partial.task("task-life","life",true);
  assert.equal(await partial.plugin.archiveCompletedTasks(),1);
  assert.equal(partial.plugin.getDeckTask("task-work").status,"archived");
  assert.equal(life.status,"completed"); assert(partial.files.has(life.images[0].path));
  partial.options.failNote=null;
  assert.equal(await partial.plugin.archiveCompletedTasks(),0);

  const badImage = fixture(); const missing = badImage.task("task-missing","work",true);
  badImage.files.delete(missing.images[0].path); const sibling = badImage.task("task-sibling");
  assert.equal(await badImage.plugin.archiveCompletedTasks(),1); assert.equal(sibling.status,"archived");
  assert.equal(missing.status,"completed");

  const invalid = fixture(); invalid.task("task-invalid"); const valid = invalid.task("task-valid");
  const date = invalid.plugin.formatLocalDate(new Date());
  invalid.files.set("Work/工作.md",`${invalid.plugin.formatLifeDateHeading(date)}\n\n${invalid.plugin.lifeTaskMarker("task-invalid","start")}\nBroken\n`);
  assert.equal(await invalid.plugin.archiveCompletedTasks(),1);
  assert.equal(valid.status,"archived","a malformed block must not prevent valid siblings");
  assert(invalid.files.get("Work/工作.md").includes("Broken"));

  const concurrent = fixture(undefined,{saveMs:10}); concurrent.task("task-lock");
  const first = concurrent.plugin.archiveCompletedTasks();
  assert(concurrent.plugin.archivingTaskIds.has("task-lock"));
  assert.equal(await concurrent.plugin.archiveCompletedTasks(),1);
  assert.equal(await concurrent.plugin.archiveDeckTask("task-lock"),false);
  await concurrent.plugin.toggleDeckTask("task-lock");
  assert.equal(concurrent.plugin.getDeckTask("task-lock").status,"completed");
  assert.equal(await first,0); assert.equal(concurrent.stats.processes,1);

  const mutation = fixture(undefined,{beforeProcess:p=>{p.getDeckTask("task-changed").completedAt=9;}});
  const changed=mutation.task("task-changed","work",true); const source=changed.images[0].path;
  assert.equal(await mutation.plugin.archiveCompletedTasks(),1); assert.equal(changed.status,"completed");
  assert(mutation.files.has(source));

  const cleanup = fixture(undefined,{beforeDelete:(p,file)=>{
    assert(p.disk.deckTasks.every(t=>t.status==="archived"),"all states persisted before deleting any source");
    assert(p.disk.deckTasks.every(t=>t.images[0].path!==file.path));
  }});
  cleanup.task("task-cleanup-one","work",true); cleanup.task("task-cleanup-two","life",true);
  assert.equal(await cleanup.plugin.archiveCompletedTasks(),0); assert.equal(cleanup.stats.deletes,2);

  const latest = fixture(undefined,{beforeProcess:(p,files,file)=>{
    files.set(file.path,files.get(file.path)+"\n用户同步加入的正文\n");
    p.settings.glassBlur=8;
  }});
  latest.task("task-latest"); assert.equal(await latest.plugin.archiveCompletedTasks(),0);
  assert(latest.files.get("Work/工作.md").includes("用户同步加入的正文"));
  assert.equal(latest.plugin.disk.glassBlur,8,"checkpoint must preserve unrelated current settings");

  const savedTarget = fixture(); const pinned=savedTarget.task("task-pinned");
  const ref={kind:"work-daily-v3",notePath:"Work/Old.md",dateKey:"2026-09-01",blockId:pinned.id};
  pinned.archiveTargetDate=ref.dateKey; pinned.archiveTargetPath=ref.notePath;
  pinned.pendingJournalOp={type:"archive",targetRef:ref,targetDate:ref.dateKey,targetCategory:"work",stage:"prepared"};
  savedTarget.plugin.settings.workArchiveFile="Work/New.md";
  assert.equal(await savedTarget.plugin.archiveCompletedTasks(),0); assert.equal(pinned.journalPath,ref.notePath);
  assert.equal(pinned.archiveDate,ref.dateKey,"retry must not reroute when settings or date change");
  console.log("Batch archive: bounded writes/renders, failure isolation, restart, attachments and concurrent locks passed");
}
module.exports = { fixture, loadPlugin, benchmark };
if(require.main===module) {
  const errors=console.error; console.error=()=>{};
  const run=process.argv[2]==="--benchmark" ? benchmark(process.argv[3] && path.resolve(process.argv[3])).then(r=>console.log(JSON.stringify(r))) : tests();
  run.catch(error=>{ errors(error); process.exitCode=1; }).finally(()=>{console.error=errors;});
}
