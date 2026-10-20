// Run inside Obsidian's eval command; creates only an isolated QA Canvas.
(async () => {
  if (window.__jamDeckDragQa) throw Error("QA is already mounted");
  const plugin = app.plugins.plugins["jam-deck"];
  const deck = app.workspace.getLeavesOfType("jam-deck-view")[0]?.view;
  if (!deck) throw Error("Open Jam Deck first");
  const id = `drag-qa-${Date.now()}`;
  const folder = `_JamDeck_QA/${id}`;
  await plugin.ensureVaultFolder(folder);
  await app.vault.create(`${folder}/sample.txt`, "Jam Deck 外拖测试文件\n");
  const fs = require("fs");
  for (const name of ["image.png", "video.mp4"]) {
    const bytes = fs.readFileSync(`D:/Project/JamDeck/.cache/external-drag-fixtures/${name}`);
    await app.vault.createBinary(`${folder}/${name}`, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
  const fixtureFiles = ["sample.txt", "image.png", "video.mp4"].map(name => `${folder}/${name}`);
  const nodes = [
    {id:"qa-text-b",type:"text",x:340,y:0,width:300,height:160,text:"第二段\n\n**加粗文字**"},
    {id:"qa-text-a",type:"text",x:0,y:0,width:300,height:160,text:"# \\[制作\\]\n\n第一段正文"},
    ...fixtureFiles.map((file,i)=>({id:`qa-file-${i}`,type:"file",file,x:i*230,y:230,width:210,height:150})),
  ];
  const file = await app.vault.create(`${folder}/test.canvas`, JSON.stringify({nodes,edges:[]},null,2));
  const panel = deck.contentEl.createDiv();
  Object.assign(panel.style,{position:"fixed",left:"48px",top:"80px",width:"900px",height:"610px",maxWidth:"calc(100vw - 80px)",maxHeight:"calc(100vh - 120px)",zIndex:"9999",background:"var(--background-primary)",border:"1px solid var(--background-modifier-border)",boxShadow:"0 16px 50px #0003",overflow:"hidden"});
  const host = panel.createDiv({cls:"jam-deck-canvas-embed-host"});
  Object.assign(host.style,{height:"100%",width:"100%"});
  const runtime = new plugin.constructor.CanvasRuntimeAdapter(deck);
  try {
    const entry = await runtime.mount({id},host,file,error=>console.error("QA mount",error));
    if (!entry) throw Error("QA mount failed");
    Object.assign(entry.leaf.containerEl.style,{position:"relative",width:"100%",height:"100%"});
    entry.leaf.onResize();
    const canvas=entry.leaf.view.canvas;
    for (let tries=0; canvas.nodes.size!==nodes.length && tries<40; ++tries) await new Promise(resolve=>setTimeout(resolve,50));
    if (canvas.nodes.size!==nodes.length) throw Error(`Canvas not loaded: ${canvas.nodes.size}`);
    const q=window.__jamDeckDragQa={runtime,entry,panel,canvas,folder,results:[],baseline:JSON.stringify(canvas.getData())};
    q.select = ids => {
      canvas.deselectAll();
      for(const nodeId of ids) canvas.select(canvas.nodes.get(nodeId));
      canvas.zoomToSelection();
      entry.selectionToolbarController.syncToolbar();
    };
    q.select(nodes.map(n=>n.id));
    await new Promise(resolve=>setTimeout(resolve,150));
    entry.selectionToolbarController.syncToolbar();
    const drag=entry.selectionToolbarController.externalDrag;
    if (!drag) throw Error("External drag controller missing");
    const original=drag.start.bind(drag);
    drag.start=async payload=>{
      const before=JSON.stringify(canvas.getData());
      const result=await original(payload);
      q.results.push({result,unchanged:before===JSON.stringify(canvas.getData()),text:payload.text,files:payload.files});
      return result;
    };
    return {folder,nodes:canvas.nodes.size,selection:canvas.selection.size};
  } catch(error) { await runtime.destroyAll();panel.remove();delete window.__jamDeckDragQa;throw error; }
})()
