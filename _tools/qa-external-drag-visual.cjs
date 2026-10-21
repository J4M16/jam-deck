// Run with Obsidian eval; creates a separate QA board, never edits user boards/settings.
(async () => {
  const fs = require("fs"), path = require("path");
  const root = "D:/Project/JamDeck";
  const entry = Array.from(app.workspace.getLeavesOfType("jam-deck-view")[0].view.canvasRuntime.entries.values())[0];
  const originalLeaf = app.workspace.activeLeaf;
  const boardPath = "_JamDeck_QA/drag-visual-20261021.canvas";
  let file = app.vault.getAbstractFileByPath(boardPath);
  if (!file) file = await app.vault.create(boardPath, JSON.stringify({nodes:[
    {id:"visual-a",type:"text",text:"# 第一段正文",x:0,y:0,width:300,height:180},
    {id:"visual-b",type:"text",text:"第二段正文\n\n**加粗文字**",x:350,y:0,width:300,height:180},
    {id:"visual-image",type:"file",file:"_JamDeck_QA/drag-qa-1792500182430/image.png",x:0,y:230,width:200,height:160},
    {id:"visual-video",type:"file",file:"_JamDeck_QA/drag-qa-1792500182430/video.mp4",x:225,y:230,width:200,height:160},
    {id:"visual-file",type:"file",file:"_JamDeck_QA/drag-qa-1792500182430/sample.txt",x:450,y:230,width:200,height:160}
  ],edges:[]},null,2));
  const leaf = app.workspace.getLeaf("tab");
  await leaf.openFile(file);
  app.workspace.setActiveLeaf(leaf,{focus:true});
  const canvas = leaf.view.canvas;
  const toolbar = {canvas,ownerWindow:entry.ownerDocument.defaultView,runtime:entry.selectionToolbarController.runtime,
    entry:{ownerDocument:entry.ownerDocument,folderController:entry.folderController}};
  leaf.containerEl.classList.add("jam-deck-canvas-leaf");
  const source = fs.readFileSync(path.join(root, "native/external-drag/controller.js"), "utf8");
  const Visual = new Function(source + "\nreturn JamDeckExternalDragVisual;")();
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const start = css.indexOf("/* External drag collects");
  const end = css.indexOf(".jam-deck-canvas-leaf .canvas-controls,", start);
  if (start < 0 || end < 0) throw Error("Visual styles missing");
  const style = entry.ownerDocument.createElement("style");
  style.textContent = css.slice(start, end);
  let before, selected, inline;
  const visual = new Visual(toolbar), samples = [];
  const contents = require("@electron/remote").getCurrentWebContents();
  const throttled = contents.getBackgroundThrottling();
  const nextFrame = () => new Promise(resolve => toolbar.ownerWindow.requestAnimationFrame(resolve));
  let region;
  entry.ownerDocument.head.appendChild(style);
  try {
    contents.setBackgroundThrottling(false);
    await nextFrame();
    canvas.selectAll();
    canvas.zoomToSelection();
    await new Promise(resolve=>setTimeout(resolve,300));
    before = JSON.stringify(canvas.getData());
    selected = Array.from(canvas.selection);
    inline = selected.map(n => n.nodeEl.getAttribute("style"));
    if (!visual.show()) throw Error("No eligible visible multi-selection: " + JSON.stringify({nodes:canvas.nodes.size,selection:canvas.selection.size,rect:canvas.wrapperEl.getBoundingClientRect().toJSON()}));
    const rects = visual.sources.map(s => s.rect);
    const left = Math.max(0, Math.floor(Math.min(...rects.map(r => r.left)) - 110));
    const top = Math.max(0, Math.floor(Math.min(...rects.map(r => r.top)) - 110));
    const right = Math.min(innerWidth, Math.ceil(Math.max(...rects.map(r => r.right)) + 110));
    const bottom = Math.min(innerHeight, Math.ceil(Math.max(...rects.map(r => r.bottom)) + 110));
    region = {x:left,y:top,width:right-left,height:bottom-top};
    for (const animation of visual.animations) animation.pause();
    for (const time of [0, 150, 300, 500]) {
      visual.animations.forEach(animation => { animation.currentTime = time; });
      await nextFrame();
      const sample = {
        time,
        nodes: visual.sources.map(s => ({opacity:getComputedStyle(s.element).opacity, transform:getComputedStyle(s.element).transform,rect:s.element.getBoundingClientRect().toJSON()})),
        shellOpacity:getComputedStyle(visual.shell).opacity,
        shellRect:visual.shell.getBoundingClientRect().toJSON(),
        frontTransform:getComputedStyle(visual.front).transform,
        children:Array.from(visual.shell.children).map(el=>el.className),
      };
      samples.push(sample);
      const image = await contents.capturePage(region);
      fs.writeFileSync(path.join(root, "_screenshots", "drag-gather-" + time + "-20261021.png"), image.toPNG());
    }
    const last = samples.at(-1), folder = last.shellRect;
    if (last.nodes.some(n=>Math.abs(n.rect.x+n.rect.width/2-folder.x-folder.width/2)>1
      ||Math.abs(n.rect.y+n.rect.height/2-folder.y-folder.height/2)>1)) throw Error("Gather centers do not align");
    visual.release();
    await new Promise(resolve=>setTimeout(resolve,220));
    if (visual.root.isConnected || visual.sources.some(s=>s.element.getAnimations().some(a=>visual.animations.includes(a)))) throw Error("Visual cleanup incomplete");
    const unchanged = JSON.stringify(canvas.getData()) === before;
    const inlineUnchanged = selected.every((n,i)=>n.nodeEl.getAttribute("style")===inline[i]);
    if (!unchanged || !inlineUnchanged) throw Error("Canvas data or inline styles changed");
    const report = {file:leaf.view.file.path,unchanged,inlineUnchanged,samples,region};
    fs.writeFileSync(path.join(root,"_reports","external-drag-visual-20261021.json"),JSON.stringify(report,null,2));
    return report;
  } finally {
    visual.destroy();
    style.remove();
    contents.setBackgroundThrottling(throttled);
    if (app.workspace.activeLeaf === leaf && originalLeaf) app.workspace.setActiveLeaf(originalLeaf);
    leaf.detach();
  }
})()
