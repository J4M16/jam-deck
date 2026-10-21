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
const nativeHandle=Buffer.alloc(8,1);
const api = vm.runInNewContext(`${source}\njamDeckExternalDragBinary=()=>"test-native.node";\n({entries:jamDeckExternalDragEntries, plain:jamDeckRenderedPlainText, payload:jamDeckBuildExternalDragPayload, packet:jamDeckExternalDragPacket, Controller:JamDeckExternalDragController})`, {Buffer, console:{...console,error(){}}, setIcon(){}, Notice:class {constructor(text){notices.push(text);}}, process:{platform:"win32"}, require(name){if(name==="@electron/remote")return {getCurrentWindow:()=>({getNativeWindowHandle:()=>nativeHandle}),process:{pid:123}};return require(name);}});
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
function visualFixture() {
  const f=fixture(), animations=[], frames=new Map(), timers=new Map();let serial=0;
  const element=(rect={left:0,top:0,width:800,height:600})=>({
    style:{},events:{},children:[],isConnected:true,offsetWidth:rect.width*2,
    addEventListener(type,handler){this.events[type]=handler;},
    getBoundingClientRect:()=>({...rect,right:rect.left+rect.width,bottom:rect.top+rect.height}),
    setAttribute(){},append(...items){this.children.push(...items);},appendChild(item){this.children.push(item);},
    remove(){this.isConnected=false;},
    animate(keyframes,options){const animation={element:this,keyframes,options,cancelled:false,cancel(){this.cancelled=true;}};animations.push(animation);return animation;},
  });
  f.plugin.settings={animationsEnabled:true};
  f.toolbar.entry.ownerDocument.createElement=()=>element();
  f.toolbar.entry.folderController={
    createFolderBackboard(view){view.backboard=element();view.backboard.className="existing-backboard";},
    createFolderLayers(view){view.front=element();view.front.className="existing-front";view.representatives=element();},
  };
  const nodes=[{left:100,top:100,width:100,height:100},{left:400,top:200,width:200,height:100}]
    .map((rect,i)=>({...node({type:"text",text:"item "+i,x:rect.left,y:rect.top}),nodeEl:element(rect)}));
  f.toolbar.canvas.selection=new Set(nodes);f.toolbar.canvas.wrapperEl=element();
  Object.assign(f.toolbar.ownerWindow,{
    getComputedStyle:()=>({transform:"matrix(1, 0, 0, 1, 10, 20)",opacity:"1",visibility:"visible",display:"block"}),
    requestAnimationFrame(callback){const id=++serial;frames.set(id,callback);return id;},
    cancelAnimationFrame(id){frames.delete(id);},
    setTimeout(callback){const id=++serial;timers.set(id,callback);return id;},
    clearTimeout(id){timers.delete(id);},
  });
  f.controller.prepare=async()=>({text:"item 0\n\nitem 1",files:[],textFile:"body.txt"});
  return {...f,nodes,animations,frames,timers,paint(){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());},
    settle(){const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());}};
}
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
  const rebuilding=fixture(), busyPayload={text:"A",files:[],textFile:"a"};
  rebuilding.controller.prepare=async()=>busyPayload;
  rebuilding.controller.sync(rebuilding.menu,false);await tick();
  let completeNative, starts=0;
  rebuilding.controller.startWindows=()=>{starts++;return new Promise(resolve=>completeNative=resolve);};
  const operation=rebuilding.controller.start(busyPayload);
  assert.equal(rebuilding.controller.active,true);
  const oldButton=rebuilding.controller.button;oldButton.remove();
  const newMenu=fixture().menu;
  rebuilding.controller.sync(newMenu,false);
  assert.notEqual(rebuilding.controller.button,oldButton);
  assert.equal(rebuilding.controller.button.parentElement,newMenu);
  assert.equal(rebuilding.controller.button.isConnected,true);
  assert.equal(rebuilding.controller.button.disabled,true);
  rebuilding.controller.button.events.pointerdown(event());
  assert.equal(starts,1,"a busy handle must not start a second session");
  completeNative({status:"cancelled"});await operation;
  rebuilding.controller.sync(newMenu,false);
  assert.equal(rebuilding.controller.button.disabled,false);
  assert.equal(rebuilding.plugin.externalDragClipboardOwner,null);
  const native=fixture();let calls=0;
  native.controller.windowsNative={drag(handle,packet){
    calls++;
    assert.equal(handle,nativeHandle);
    assert.equal(packet.readUInt32LE(4),123);
    assert.equal(native.plugin.externalDragClipboardOwner,native.controller);
    return {status:"cancelled",queryCount:2};
  }};
  await native.controller.start(busyPayload);
  await native.controller.start(busyPayload);
  assert.equal(calls,2,"native cancellation must allow the next drag");
  assert.equal(native.controller.active,false);
  assert.equal(native.plugin.externalDragClipboardOwner,null);
  assert.equal(native.toolbar.ownerWindow.events.size,0);
  native.controller.windowsNative.drag=()=>{throw Error("invalid source window");};
  await native.controller.start(busyPayload);
  assert.equal(native.controller.active,false);
  assert.equal(native.plugin.externalDragClipboardOwner,null,"native exception must release ownership");
  for(const cancel of ["pointerup","pointercancel","blur","keydown","destroy"]) {
    const f=visualFixture();f.controller.sync(f.menu,false);await tick();
    const before=JSON.stringify(f.nodes.map(n=>n.getData()));
    f.controller.button.events.pointerdown(event());
    const visual=f.controller.visual;
    assert(visual?.root?.isConnected,"holding a multi-selection must create the visual folder");
    assert.equal(visual.root.children[0].children.length,2,"folder has only the existing backboard and front, no sample cards");
    assert.equal(Math.max(...f.animations.map(a=>a.options.duration+(a.options.delay||0))),500,"gather completes in half a second");
    assert(f.animations.filter(a=>f.nodes.some(n=>n.nodeEl===a.element)).every(a=>a.keyframes.at(-1).opacity===0));
    assert(f.animations.find(a=>a.element===f.nodes[0].nodeEl).keyframes.at(-1).transform.endsWith("translate(400px, 100px)"),
      "half-size zoom must gather the first node at the screen-space union center");
    assert(f.animations.find(a=>a.element===f.nodes[1].nodeEl).keyframes.at(-1).transform.endsWith("translate(-300px, -100px)"));
    if(cancel==="destroy")f.controller.destroy();else f.toolbar.ownerWindow.events.get(cancel)(event({key:"Escape"}));
    f.settle();
    assert.equal(visual.root.isConnected,false);assert(f.animations.every(a=>a.cancelled));
    assert.equal(f.frames.size,0);assert.equal(f.toolbar.ownerWindow.events.size,0);
    assert.equal(JSON.stringify(f.nodes.map(n=>n.getData())),before,"visual cancellation must not move or group Canvas nodes");
    assert(f.nodes.every(n=>Object.keys(n.nodeEl.style).length===0),"original inline styles remain untouched");
  }
  const quick=visualFixture();quick.controller.sync(quick.menu,false);await tick();
  let finishDrag,quickStarts=0;
  quick.controller.startWindows=()=>{quickStarts++;return new Promise(resolve=>finishDrag=resolve);};
  quick.controller.button.events.pointerdown(event());
  const gathering=quick.controller.visual;
  quick.toolbar.ownerWindow.events.get("pointermove")(event({clientX:9}));
  assert.equal(quickStarts,0,"fast movement must allow the first visual frame to reach the compositor");
  quick.paint();quick.paint();
  assert.equal(quickStarts,1,"native drag starts after the first paint, without waiting 500ms");
  assert(gathering.root.isConnected);assert(!quick.animations.some(a=>a.cancelled),"native takeover must retain the gathering visual");
  quick.controller.button.remove();quick.controller.sync(fixture().menu,false);
  assert.equal(quick.controller.visual,gathering,"menu replacement must not restart or remove the animation");
  finishDrag({status:"cancelled"});await tick();quick.settle();
  assert.equal(gathering.root.isConnected,false);
  const released=visualFixture();released.controller.sync(released.menu,false);await tick();
  let lateStarts=0;released.controller.startWindows=()=>{lateStarts++;};
  released.controller.button.events.pointerdown(event());
  released.toolbar.ownerWindow.events.get("pointermove")(event({clientX:9}));
  released.toolbar.ownerWindow.events.get("pointerup")(event());
  released.paint();released.paint();released.settle();
  assert.equal(lateStarts,0,"releasing during the first-frame handoff must never start a late drag");
  for(const status of ["dropped","cancelled","failed"]) {
    const f=visualFixture();f.controller.sync(f.menu,false);await tick();
    f.controller.startWindows=()=>{if(status==="failed")throw Error("native failure");return {status};};
    f.controller.button.events.pointerdown(event());const visual=f.controller.visual;
    f.paint();f.paint();f.toolbar.ownerWindow.events.get("pointermove")(event({clientX:8}));
    await tick();f.settle();
    assert.equal(visual.root.isConnected,false,"native "+status+" must restore all original surfaces");
    assert(f.animations.every(a=>a.cancelled));assert.equal(f.controller.active,false);
  }
  const repeated=visualFixture();repeated.controller.sync(repeated.menu,false);await tick();
  repeated.controller.button.events.pointerdown(event());const firstVisual=repeated.controller.visual;
  repeated.toolbar.ownerWindow.events.get("pointerup")(event());
  repeated.controller.button.events.pointerdown(event());
  assert(firstVisual.destroyed,"a new press must cancel the previous return animation");
  repeated.controller.destroy();repeated.settle();
  assert(repeated.animations.every(a=>a.cancelled));
  const reduced=visualFixture();reduced.plugin.settings.animationsEnabled=false;
  reduced.controller.sync(reduced.menu,false);await tick();reduced.controller.button.events.pointerdown(event());
  assert(reduced.animations.every(a=>a.options.duration===0 && !a.options.delay),"disabled animations go straight to the empty folder");
  reduced.controller.destroy();assert(reduced.animations.every(a=>a.cancelled));
  const throwingCancel=fixture();
  throwingCancel.controller.cancelNative=()=>{throw Error("window closed");};
  assert.doesNotThrow(()=>throwingCancel.controller.destroy());
  assert.equal(throwingCancel.controller.destroyed,true);
  console.log("External drag: selection, all file types, spatial order, deduplication, rendered text and native packet passed");
})().catch(error=>{console.error(error);process.exitCode=1;});
