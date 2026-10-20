"use strict";
const assert = require("assert/strict");
const fs = require("fs"), path = require("path"), vm = require("vm");
const source = fs.readFileSync(path.join(__dirname, "../native/external-drag/controller.js"), "utf8");
const crypto = require("crypto"), zlib = require("zlib");
const normalized = value => value.replace(/\r\n/g, "\n");
const main = normalized(fs.readFileSync(path.join(__dirname, "../main.js"), "utf8"));
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
for (const [name, nativeSource, magic] of [["WINDOWS", "main.cpp", "4d5a"], ["MACOS", "main.mm", "cffaedfe"]]) {
  const payload = JSON.parse(main.match(new RegExp(`const ${name}_EXTERNAL_DRAG_PAYLOAD = (\\{[^\\n]+\\});`))[1]);
  const binary = zlib.gunzipSync(Buffer.from(payload.gzip, "base64"));
  assert.equal(hash(binary), payload.sha256, `${name} binary integrity`);
  assert.equal(binary.subarray(0, magic.length / 2).toString("hex"), magic);
  assert.equal(hash(normalized(fs.readFileSync(path.join(__dirname, "../native/external-drag", nativeSource), "utf8"))), payload.sourceSha256, `${name} source provenance`);
}
assert(main.includes(normalized(source)), "shipped controller must match tested source");
const notices = [];
const api = vm.runInNewContext(`${source}\n({entries:jamDeckExternalDragEntries, plain:jamDeckRenderedPlainText, payload:jamDeckBuildExternalDragPayload, packet:jamDeckExternalDragPacket, Controller:JamDeckExternalDragController})`, {Buffer, console:{...console,error(){}}, setIcon(){}, Notice:class {constructor(text){notices.push(text);}}, process:{platform:"win32"}, require(name){if(name==="@electron/remote")return {getCurrentWindow:()=>({}),process:{pid:123}};return require(name);}});
const plain = value => JSON.parse(JSON.stringify(value));
const node = data => ({getData:()=>data});
const selected = [
  node({type:"file",file:"movie.mp4",x:50,y:20}),
  node({type:"text",text:"second",x:100,y:10}),
  node({type:"text",text:"first",x:10,y:10}),
  node({type:"file",file:"note.md",x:0,y:30}),
  node({type:"file",file:"doc.pdf",x:0,y:40}),
  node({type:"file",file:"movie.mp4",x:0,y:50}),
  node({type:"group",x:0,y:0}),
];
const vault={getAbstractFileByPath: name=>({path:name})};
const entries=api.entries({selection:new Set(selected)},vault);
assert.deepEqual(plain(entries.map(x=>x.value)),["first","second","movie.mp4","note.md","doc.pdf","movie.mp4"]);
const text=value=>({nodeType:3,nodeValue:value});
const el=(tag,...children)=>({nodeType:1,tagName:tag,childNodes:children});
assert.equal(api.plain(el("div",el("h2",text("[制作]")),el("p",text("正文"),el("br"),text("第二行")),el("pre",el("code",text("\\[代码\\]"))))), "[制作]\n\n正文\n第二行\n\n\\[代码\\]");
assert.equal(api.plain(el("pre",el("code",text("const x = 1;")),el("button",text("复制")))), "const x = 1;");
function fixture() {
  const menu={appendChild(button){button.parentElement=this;button.isConnected=true;}};
  const plugin={app:{vault},clipboard:{readText:()=>""}};
  const toolbar={runtime:{deckView:{plugin}},entry:{ownerDocument:{createElement(){return {style:{},events:{},setAttribute(){},addEventListener(type,handler){this.events[type]=handler;},remove(){this.isConnected=false;}};}}},canvas:{selection:new Set([node({type:"text",text:"A"})])},scheduleToolbarSync(){}};
  const controller=new api.Controller(toolbar);
  toolbar.ownerWindow={events:new Map(),addEventListener(type,handler){this.events.set(type,handler);},removeEventListener(type,handler){if(this.events.get(type)===handler)this.events.delete(type);}};
  return {menu,plugin,toolbar,controller};
}
const event=(extra={})=>({button:0,buttons:1,pointerId:7,clientX:0,clientY:0,preventDefault(){this.cancelled=true;},stopPropagation(){},stopImmediatePropagation(){this.stopped=true;},...extra});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  let written;
  const payload=await api.payload(entries,{plainText:async s=>s,absolutePath:s=>"/vault/"+s,writeTextFile:async(text,files)=>{written={text,files};return "/tmp/正文.txt";}});
  assert.deepEqual(plain(payload),{text:"first\n\nsecond",textFile:"/tmp/正文.txt",files:["/vault/movie.mp4","/vault/note.md","/vault/doc.pdf"]});
  assert.equal(written.text,payload.text);
  const packet=api.packet(payload,12345);
  assert.equal(packet.subarray(0,4).toString(),"JD01");
  assert.equal(packet.readUInt32LE(4),12345);
  let offset=8;
  const read=()=>{const bytes=packet.readUInt32LE(offset);offset+=4;const value=packet.subarray(offset,offset+bytes).toString("utf16le");offset+=bytes;return value;};
  assert.equal(read(),payload.text); assert.equal(read(),payload.textFile);
  assert.equal(packet.readUInt32LE(offset),3); offset+=4;
  assert.deepEqual([read(),read(),read()],plain(payload.files)); assert.equal(offset,packet.length);
  const noText=await api.payload(entries.filter(e=>e.kind==="file"),{absolutePath:s=>s,writeTextFile:()=>assert.fail("file-only must not make TXT")});
  assert.equal(noText.textFile,"");
  const original=JSON.stringify(selected.map(n=>n.getData()));
  api.entries({selection:new Set(selected)},vault);
  assert.equal(JSON.stringify(selected.map(n=>n.getData())),original,"collecting must never mutate Canvas data");
  const f=fixture(), pending=[];
  f.controller.prepare=entries=>new Promise(resolve=>pending.push({entries,resolve}));
  f.controller.sync(f.menu,false);
  f.toolbar.canvas.selection=new Set([node({type:"text",text:"B"})]);
  const press=event();f.controller.button.events.pointerdown(press);
  assert(press.cancelled && press.stopped,"the handle must retain Canvas focus and selection");
  assert.equal(f.controller.pressed,null,"selection changed before RAF must not send A");
  pending[1].resolve({text:"B",files:[],textFile:"b"}); await tick();
  pending[0].resolve({text:"A",files:[],textFile:"a"}); await tick();
  assert.equal(f.controller.prepared.text,"B","late A must not replace B");
  f.controller.button.events.pointerdown(event());
  f.toolbar.canvas.selection.clear();
  let sent; f.controller.start=async payload=>{sent=payload;};
  f.toolbar.ownerWindow.events.get("pointermove")(event({clientX:3}));
  assert.equal(sent,undefined,"a click or small tremor is not an OS drag");
  f.toolbar.ownerWindow.events.get("pointermove")(event({clientX:8}));
  assert.equal(sent.text,"B","pressed snapshot survives selection clearing");
  assert.equal(f.toolbar.ownerWindow.events.size,0,"listeners must be gone before native takeover");
  f.toolbar.canvas.selection=new Set([node({type:"text",text:"B"})]);
  for(const type of ["pointerup","pointercancel","blur","keydown"]) {
    sent=undefined;f.controller.button.events.pointerdown(event());
    f.toolbar.ownerWindow.events.get(type)(event({key:"Escape"}));
    assert.equal(sent,undefined);assert.equal(f.toolbar.ownerWindow.events.size,0);
  }
  const destroyed=fixture();let finish;
  destroyed.controller.prepare=()=>new Promise(resolve=>finish=resolve);
  destroyed.controller.sync(destroyed.menu,false);destroyed.controller.destroy();
  finish({text:"late",files:[],textFile:"late"});await tick();
  assert.equal(destroyed.controller.prepared,null);assert.equal(destroyed.controller.button,null);
  const retry=fixture();let attempts=0;
  retry.controller.prepare=async()=>{if(++attempts===1)throw Error("file offline");return {text:"retry",files:[],textFile:"retry"};};
  retry.controller.sync(retry.menu,false);await tick();
  retry.controller.button.events.pointerdown(event());await tick();
  assert.equal(attempts,2);assert.equal(retry.controller.prepared.text,"retry");
  const cleanup=fixture();
  cleanup.plugin.clipboard.readText=()=>{throw Error("clipboard busy");};
  cleanup.controller.startWindows=async()=>({status:"cancelled"});
  await cleanup.controller.start({text:"x",files:[],textFile:"x"});
  assert.equal(cleanup.controller.active,false);
  assert.equal(cleanup.plugin.externalDragClipboardOwner,null,"clipboard failure must release polling");
  const throwingCancel=fixture();
  throwingCancel.controller.cancelNative=()=>{throw Error("window closed");};
  assert.doesNotThrow(()=>throwingCancel.controller.destroy());
  assert.equal(throwingCancel.controller.destroyed,true);
  console.log("External drag: selection, all file types, spatial order, deduplication, rendered text and native packet passed");
})().catch(error=>{console.error(error);process.exitCode=1;});
