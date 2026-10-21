(async () => {
  const plugin=app.plugins.plugins["jam-deck"], fs=require("fs");
  const current=Array.from(app.workspace.getLeavesOfType("jam-deck-view")[0].view.canvasRuntime.entries.values())[0];
  const active=app.workspace.activeLeaf, leaf=app.workspace.getLeaf("tab");
  const contents=require("@electron/remote").getCurrentWebContents(), throttled=contents.getBackgroundThrottling();
  let toolbar;
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  try {
    contents.setBackgroundThrottling(false);
    await leaf.openFile(app.vault.getAbstractFileByPath("_JamDeck_QA/drag-visual-20261021.canvas"));
    app.workspace.setActiveLeaf(leaf,{focus:false});
    leaf.containerEl.classList.add("jam-deck-canvas-leaf");
    const canvas=leaf.view.canvas;
    canvas.selectAll();canvas.zoomToSelection();await pause(300);
    toolbar=new plugin.constructor.CanvasSelectionToolbarController(current.selectionToolbarController.runtime,
      {leaf,ownerDocument:document,folderController:current.folderController});
    toolbar.install();
    for(let i=0;i<30&&!toolbar.externalDrag?.prepared;i++)await pause(100);
    const drag=toolbar.externalDrag;
    if(!drag?.prepared)throw Error("Deployed handle payload is not ready");
    const before=JSON.stringify(canvas.getData());
    const styles=Array.from(canvas.selection).map(n=>n.nodeEl.getAttribute("style"));
    const checks=[];
    for(const [duration,cancel] of [[60,"pointerup"],[550,"pointerup"],[130,"Escape"]]) {
      drag.button.dispatchEvent(new PointerEvent("pointerdown",{button:0,buttons:1,pointerId:91,bubbles:true}));
      if(!drag.visual?.root?.isConnected)throw Error("Deployed pointerdown did not create the visual");
      await pause(duration);
      if(duration===550) {
        if(drag.visual.sources.some(s=>Number(getComputedStyle(s.element).opacity)!==0))throw Error("Nodes did not finish fading");
        if(Number(getComputedStyle(drag.visual.shell).opacity)!==1)throw Error("Folder did not stay visible");
      }
      if(cancel==="Escape")window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
      else window.dispatchEvent(new PointerEvent("pointerup",{button:0,buttons:0,pointerId:91,bubbles:true}));
      await pause(210);
      if(drag.visual.root.isConnected||drag.cancelGesture)throw Error("Deployed gesture cleanup incomplete");
      if(JSON.stringify(canvas.getData())!==before)throw Error("Canvas data changed");
      if(Array.from(canvas.selection).some((n,i)=>n.nodeEl.getAttribute("style")!==styles[i]))throw Error("Inline styles changed");
      checks.push({duration,cancel,restored:true});
    }
    const report={version:plugin.manifest.version,checks,nodes:canvas.nodes.size,unchanged:true,nativeDragInvoked:false};
    fs.writeFileSync("D:/Project/JamDeck/_reports/external-drag-gesture-20261021.json",JSON.stringify(report,null,2));
    return report;
  } finally {
    toolbar?.destroy();
    if(app.workspace.activeLeaf===leaf&&active)app.workspace.setActiveLeaf(active,{focus:false});
    leaf.detach();
    contents.setBackgroundThrottling(throttled);
  }
})()
