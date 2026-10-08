"use strict";
const assert = require("assert/strict"), fs = require("fs"), path = require("path"), vm = require("vm"), crypto = require("crypto");
const source = fs.readFileSync(path.resolve(__dirname, "../main.js"), "utf8");
const start = source.indexOf("function jamDeckCreateGlassEngine(ownerWindow) {");
const end = source.indexOf("function jamDeckBackgroundKind", start);
const factory = vm.runInNewContext(`${source.slice(start, end)}\njamDeckCreateGlassEngine`, { crypto });
function environment() {
  const stats = { allocations: 0, bytes: 0 }, nodes = [];
  class Node {
    constructor() { this.children = []; this.attributes = {}; this.vars = new Map(); this.classList = { add() {} };
      this.style = { setProperty: (k,v) => this.vars.set(k,v), removeProperty: k => this.vars.delete(k) }; }
    appendChild(child) { this.children.push(child); child.parent = this; return child; }
    setAttribute(k,v) { this.attributes[k] = String(v); }
    setAttributeNS(_ns,k,v) { this.setAttribute(k,v); }
    getAttribute(k) { return this.attributes[k]; }
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this),1); }
  }
  const doc = { body: new Node(), documentElement: new Node(), createElementNS: () => new Node(), createElement: () => {
    const canvas = new Node(); let pixels;
    canvas.getContext = () => ({ createImageData(w,h) { stats.allocations++; stats.bytes += w*h*4;
      return { data: new Uint8ClampedArray(w*h*4) }; }, putImageData(image) { pixels = image.data; } });
    canvas.toDataURL = () => Buffer.from(pixels).toString("base64");
    return canvas;
  } };
  class Observer { observe() {} disconnect() {} }
  const win = { document:doc, navigator:{}, CSS:{supports:()=>true}, ResizeObserver:Observer, MutationObserver:Observer,
    performance, getComputedStyle:el=>el.radii, matchMedia:()=>({matches:false}),
    requestAnimationFrame:fn=>setImmediate(()=>fn(performance.now())), setTimeout, clearTimeout };
  const engine = factory(win); engine.force(true);
  function surface(w,h,radii = [18,18,18,18]) {
    const el = new Node(); el.offsetWidth=w; el.offsetHeight=h;
    el.radii=Object.fromEntries(["borderTopLeftRadius","borderTopRightRadius","borderBottomRightRadius","borderBottomLeftRadius"].map((k,i)=>[k,`${radii[i]}px`]));
    nodes.push(el); return el;
  }
  return { engine, stats, doc, surface };
}
const options = { bevel:18, thickness:40, slope:1.8, shape:"squircle", blur:4, dispersion:0, sat:1,
  shade:0.14, rim:0.22, edge:0, edgeW:4, smooth:0, materialize:0, settle:180, light:-35 };
const displacementHash = pixels => {
  const rg = Buffer.alloc(pixels.length/2);
  for(let i=0,j=0;i<pixels.length;i+=4) { rg[j++]=pixels[i]; rg[j++]=pixels[i+1]; }
  return crypto.createHash("sha256").update(rg).digest("hex");
};
(async () => {
  // Golden R/G fields captured from 1.3.5. Lighting changes must not move the background.
  const cases = [
    { w:240,h:72,r:[18,18,18,18],hash:"2705685868c9bde3c81699e3e7358600a91a4d07b5f17f382a3b5ce8f6947a14" },
    { w:240,h:72,r:[0,0,31,31],hash:"9c3788514ab70b00b0d8e3455f040d0853e4ab52b3582fff1131dc5d2608a271" },
    { w:640,h:320,r:[18,18,18,18],hash:"2903aa9d30eb819cbbd13f8126b63f0da9e44d099e9a4f0bb7f9b57c5e173a6f" },
    { w:64,h:64,r:[32,32,32,32],hash:"3271d12bcce3309f7c408cd2ad693cc1ab6e552b23750f2c482c55e832a5439d" },
  ];
  for(const sample of cases) {
    const e=environment(); const el=e.surface(sample.w,sample.h,sample.r);
    e.engine.attach(el,options);
    const info=e.engine.info(), pixels=Buffer.from(info.map,"base64");
    const hash=displacementHash(pixels);
    if(process.argv.includes("--golden")) {
      console.log(JSON.stringify({width:sample.w,height:sample.h,radii:sample.r,hash,allocations:e.stats.allocations,bytes:e.stats.bytes}));
      e.engine.dispose(); continue;
    }
    assert.equal(hash,sample.hash,"refraction geometry stays identical to 1.3.5");
    assert.equal(e.stats.allocations,1,"single-pass glass allocates only the map it uses");
    assert.equal(e.stats.bytes,info.mapSize[0]*info.mapSize[1]*4);
    assert.equal(info.mapInner,""); assert.equal(info.twoPass,false);
    const allocations=e.stats.allocations;
    for(const blur of [0,16,8,4]) await e.engine.setOpts({blur});
    assert.equal(e.stats.allocations,allocations,"blur preview reuses the geometry map");
    e.engine.detach(el); e.engine.attach(el,options);
    assert.equal(e.stats.allocations,allocations,"reattaching reuses the warm map");
    e.engine.dispose(); assert.equal(e.doc.body.children.length,0,"dispose removes filter host");
    assert.equal(el.vars.size,0);
  }
  const two=environment(); two.engine.attach(two.surface(240,72),{...options,slope:0.8,smooth:1});
  assert.equal(two.stats.allocations,2,"two-pass material keeps both maps");
  assert(two.engine.info().mapInner); assert(two.engine.info().twoPass); two.engine.dispose();
  console.log("Glass optics: original displacement, one-pass allocation, two-pass maps, warm reuse and blur retuning passed");
})().catch(error=>{console.error(error);process.exitCode=1;});
