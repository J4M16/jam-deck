"use strict";
const assert = require("assert/strict");
const fs = require("fs"), path = require("path"), vm = require("vm");
const source = fs.readFileSync(path.join(__dirname, "../native/external-drag/controller.js"), "utf8");
const api = vm.runInNewContext(`${source}\n({entries:jamDeckExternalDragEntries, plain:jamDeckRenderedPlainText, payload:jamDeckBuildExternalDragPayload, packet:jamDeckExternalDragPacket, Controller:JamDeckExternalDragController})`, {Buffer, console});
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
  console.log("External drag: selection, all file types, spatial order, deduplication, rendered text and native packet passed");
})().catch(error=>{console.error(error);process.exitCode=1;});
