"use strict";

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const os = require("os");
const path = require("path");
const vm = require("vm");

const projectRoot = path.resolve(__dirname, "..");
const mainPath = path.join(projectRoot, "main.js");
const stylePath = path.join(projectRoot, "styles.css");
const deployPath = path.join(projectRoot, "scripts", "deploy.ps1");
const pluginSource = fs.readFileSync(mainPath, "utf8");
const styleSource = fs.readFileSync(stylePath, "utf8");
const deploySource = fs.readFileSync(deployPath, "utf8");
assert(pluginSource.includes("new WorkspaceLeaf(this.app)"), "Canvas widget must create a real WorkspaceLeaf");
assert(pluginSource.includes("leaf.openFile(file, { active: false })"), "Canvas widget must open the canvas inside its owned leaf");
assert(pluginSource.includes("leaf.parent = context.root;"), "detached Canvas leaf must inherit only the workspace root, never impersonate a real tab-group child");
assert(!pluginSource.includes("leaf.parent = context.parent;"), "detached Canvas leaf must not make Obsidian select tab index -1 and fall back to the first journal tab");
assert(pluginSource.includes("view.saveImmediately"), "Canvas cleanup must flush pending edits");
assert(pluginSource.includes("leaf.unload"), "Canvas cleanup must release its owned leaf events");
assert(!pluginSource.includes("MarkdownRenderer"), "Canvas widget must not regress to Markdown preview rendering");
assert(!pluginSource.includes("MarkdownRenderChild"), "Canvas widget must not regress to a static embed child");
assert(pluginSource.includes('tabindex: "0"'), "clipboard cards must be keyboard focusable");
assert(pluginSource.includes('setIcon(copyBtn, "copy")'), "clipboard actions must use compact accessible icons");
assert(styleSource.includes("Spatial whiteboard visual layer"), "Spatial visual layer must remain explicit and reversible");
assert(styleSource.includes("@container (min-width: 360px)"), "clipboard gallery must respond to its widget width");
assert(styleSource.includes("object-fit: contain"), "clipboard images must remain fully visible");
assert(pluginSource.includes('addEventListener("drop", drop, true)'), "embedded Canvas must capture its owned clipboard image drops");
assert(pluginSource.includes("setActiveLeaf(hostLeaf, { focus: false })"), "embedded Canvas interaction must keep the visible Jam Deck host active");
assert(pluginSource.includes("class CanvasReturnCoordinator"), "embedded Canvas must coordinate focus recovery after external browser navigation");
assert(pluginSource.includes('this.adapter.activate(entry, true)'), "external browser return must force one safe host-leaf reaffirmation");
assert(pluginSource.includes("CANVAS_RETURN_ENTRY_ARM_TTL_MS"), "native Canvas link clicks must arm browser-return recovery without requiring an iframe");
assert(pluginSource.includes("class CanvasLinkNavigationBridge"), "native Canvas link nodes must own a scoped same-frame navigation bridge");
assert(pluginSource.includes("webFrame.getFrameForSelector"), "Canvas link iframe injection must use an exact Electron child-frame mapping");
assert(!pluginSource.includes("setWindowOpenHandler"), "Canvas link navigation must not install a global Electron window-open interceptor");
assert(pluginSource.includes('document.activeElement') || pluginSource.includes('ownerDocument.activeElement'), "Canvas browser recovery must attribute departure through the host document iframe element");
assert(pluginSource.includes('matches("iframe, webview")'), "Canvas browser recovery must support native iframe and webview surfaces without entering cross-origin content");
assert(!pluginSource.includes("setActiveLeaf(entry.leaf, { focus: false })"), "detached Canvas leaves must never be activated through the workspace");
assert(pluginSource.includes('addEventListener("keydown", keydown, true)'), "embedded Canvas must bridge selected image copy shortcuts");
assert(pluginSource.includes("copyCanvasImageFile(file)"), "selected Canvas image copy must write the real image to the system clipboard");
assert(pluginSource.includes("class CanvasInkOverlay"), "embedded Canvas must own a leaf-local vector ink overlay");
assert(pluginSource.includes("setPointerCapture"), "Canvas ink must keep pointer gestures coherent outside the initial target");
assert(!pluginSource.includes("getCoalescedEvents"), "fixed-width annotation must not keep pressure-era coalesced sampling");
assert(!pluginSource.includes("sample.pressure"), "fixed-width annotation must not read pressure values");
assert(!pluginSource.includes("tiltX") && !pluginSource.includes("tiltY"), "fixed-width annotation must not store pen tilt");
assert(!pluginSource.includes("pressureMode"), "fixed-width annotation data must not keep pressure modes");
assert(pluginSource.includes("eventPoint(event)"), "fixed-width annotation must use a compact point sampler");
assert(pluginSource.includes(".canvas.jam-deck.json"), "Canvas ink must persist in a sidecar instead of the native canvas file");
assert(pluginSource.includes("fileManager.trashFile"), "Canvas ink lifecycle cleanup must prefer Obsidian trash");
assert(styleSource.includes(".theme-dark .jam-deck-root"), "Spatial dark tokens must follow Obsidian's dark theme class");
assert(pluginSource.includes('imageField.addEventListener("paste"'), "task detail image field must accept pasted images");
assert(pluginSource.includes("openNewTaskForDate(dateKey)"), "calendar dates must open due-date task drafts");
assert(!pluginSource.includes('placeholder: "新增待办…"'), "task widget must not retain the direct add composer");
assert(styleSource.includes(".jam-deck-calendar-toolbar"), "calendar must expose month navigation styling");
assert(styleSource.includes(".jam-deck-task-meta-fields"), "task detail category and due-date fields must remain responsive");
assert(styleSource.includes("lightweight Spatial calendar"), "calendar styling must keep the Spatial lightweight correction explicit");
assert(styleSource.includes("Embedded Canvas image nodes and geometric stacks"), "embedded Canvas stack styling must remain explicitly scoped");
assert(styleSource.includes("Jam Deck Canvas Spatial toolbar and fixed-width annotation"), "Canvas annotation visual layer must remain explicit and reversible");
assert(styleSource.includes(".jam-deck-canvas-leaf .canvas-card-menu.jam-deck-node-toolbar--spatial"), "native Canvas toolbar restyling must stay inside the embedded leaf");
assert(pluginSource.includes("const EAGLE_SEARCH_RESULT_LIMIT = 10"), "Eagle reverse image search must cap requests at ten results");
assert(pluginSource.includes("className = \"clickable-icon jam-deck-canvas-image-search-toolbar\""), "Eagle search must use the native Canvas selection-toolbar button surface");
assert(pluginSource.includes("this.canvas && this.canvas.menu && this.canvas.menu.menuEl"), "Eagle search must target the native selection popup, not the bottom card palette");
assert(!pluginSource.includes("const nativeMenu = this.canvas && this.canvas.cardMenuEl"), "Eagle search must not resolve the bottom card palette");
assert(pluginSource.includes("if (selected.length !== 1) return { image: null, text: null }"), "Canvas image search and AI must only appear for one authoritative selected node");
assert(pluginSource.includes("hasNativeCanvasDuplicate(file.path, existing && existing.leaf)"), "embedded Canvas must pause when the same file is open natively");
assert(pluginSource.includes("getViewState()"), "embedded Canvas duplicate detection must resolve native file paths before the view object finishes loading");
assert(pluginSource.includes("getCanvasExternalImageDrop"), "embedded Canvas must own external image drops instead of delegating them to the native handler");
assert(pluginSource.includes("createCanvasAttachmentFromExternal"), "external Canvas image drops must be copied into vault attachments");
assert(pluginSource.includes("CANVAS_EXTERNAL_IMAGE_MAX_BYTES"), "external Canvas image drops must have a bounded import size");
assert(pluginSource.includes("JAM_DECK_CANVAS_EMPTY"), "empty Canvas files must stop embedding instead of entering a retry loop");
assert(pluginSource.includes("destroyPromises = new Map()"), "embedded Canvas cleanup must serialize repeated destroy calls");
assert(pluginSource.includes("async destroyEntry(widgetId)"), "embedded Canvas cleanup must keep the idempotent destroy implementation separate");
assert(pluginSource.includes("if (this.hasNativeCanvasDuplicate(file.path, leaf))"), "embedded Canvas mount must re-check native conflicts after openFile");
assert(pluginSource.includes("JAM_DECK_CANVAS_CONFLICT"), "embedded Canvas duplicate protection must expose a recoverable conflict state");
assert(pluginSource.includes("scheduleCanvasNativeConflictReconcile"), "embedded Canvas duplicate protection must reconcile when workspace leaves change");
assert(pluginSource.includes("reconcileCanvasNativeConflicts"), "embedded Canvas conflicts must reconcile in place");
assert(!pluginSource.includes("className = \"jam-deck-canvas-image-search\""), "Eagle search must not keep a node-corner hover button");
assert(styleSource.includes(".jam-deck-canvas-leaf .jam-deck-canvas-image-search-toolbar"), "Eagle search toolbar button styling must stay inside the embedded leaf");
assert(styleSource.includes(".jam-deck-canvas-leaf .jam-deck-drawing-palette"), "drawing palette styles must stay inside the embedded leaf");
assert(styleSource.includes(".jam-deck-canvas-leaf .canvas-node:has(.canvas-node-content.media-embed > img) > .canvas-node-label"), "embedded Canvas image filenames must be hidden without affecting normal Canvas views");
assert(styleSource.includes("object-fit: cover"), "embedded Canvas images must fill their node without an inset frame");
assert(pluginSource.includes("class CanvasImageStackController"), "embedded Canvas must own a leaf-local image stack controller");
assert(pluginSource.includes("jamDeckCanvasStackKind"), "Canvas stacks must classify image, text, and Markdown note nodes through one path");
assert(pluginSource.includes("stackImageNormalization"), "oversized stack images must retain reversible Canvas-size metadata");
assert(pluginSource.includes("stackTextNormalization"), "oversized stack text must retain reversible Canvas-size metadata");
assert(pluginSource.includes("this.canvas.markMoved(node)"), "stack resize and snap must participate in native Canvas movement history");
assert(pluginSource.includes("getStackItems()"), "mixed Canvas stacks must enumerate every eligible content kind");
assert(pluginSource.includes("typeof this.canvas.requestPushHistory.run"), "auto-snap must capability-gate against the native history debounce");
assert(pluginSource.includes("stableFrames >= 3"), "auto-snap must wait for three stable world-rect samples");
assert(pluginSource.includes("Date.now() - drag.releaseTime >= 210"), "auto-snap must stay inside the native Canvas history coalescing window");
assert(pluginSource.includes("jamDeckCanvasStackOverlapRatio"), "Canvas stacks must use world-geometry overlap");
assert(styleSource.includes("--jd-canvas-image-radius: var(--jd-radius-sm, 10px)"), "Canvas image radius must reuse the launcher icon radius token");
assert(styleSource.includes("--jd-canvas-group-radius: var(--jd-radius-md, 14px)"), "Canvas group radius must use the next Spatial radius tier");
assert(styleSource.includes(".jam-deck-canvas-leaf .canvas-node:has(> .canvas-group-label)"), "Canvas group styling must stay inside the embedded leaf");
assert(styleSource.includes(".jam-deck-canvas-stack-overlay"), "Canvas stacks must render hover previews in a dedicated overlay");
assert(styleSource.includes(".jam-deck-canvas-stack-preview {") && styleSource.includes("pointer-events: auto;"), "an open stack preview must isolate the Canvas below it");
assert(pluginSource.includes("this.previewWrapper.contains(event.target)") && pluginSource.includes("event.stopImmediatePropagation();"), "preview dismissal must consume covered pointer input");
assert(pluginSource.includes('if (event.key === "Escape") this.collapsePreview();'), "preview isolation must retain an Escape exit");
assert(pluginSource.includes("stackController && stackController.previewWrapper"), "the early Canvas keyboard bridge must yield to an open focus preview");
assert(styleSource.includes(".jam-deck-canvas-stack-overlay {\n  position: absolute;\n  z-index: 70;"), "the focus overlay must sit above native Canvas controls");
assert(!styleSource.includes("prefers-reduced-motion"), "Jam Deck animations must not follow the OS reduced-motion setting");
assert(pluginSource.includes("getCanvasItems()") && pluginSource.includes("for (const item of this.getCanvasItems())"), "focus displacement must enumerate every Canvas node type");
assert(styleSource.includes(".canvas-node.is-jam-deck-stack-bystander {"), "focus displacement must move the complete Canvas node surface");
assert(styleSource.includes("rgb(248 249 250 / 0.70)"), "Spatial focus preview must ghost the light Canvas background");
assert(styleSource.includes("rgb(29 31 35 / 0.62)"), "Spatial focus preview must ghost the dark Canvas background");
assert(styleSource.includes("0 22px 44px rgb(15 23 42 / 0.22)"), "dragged Canvas images must have a perceptible soft elevation");
assert(styleSource.includes("transform 300ms cubic-bezier(.22, 1, .36, 1)"), "stack previews must use the Spatial enter rhythm");
assert(styleSource.includes("transition-duration: 260ms"), "stack previews must reverse to their source geometry");
assert(styleSource.includes(".is-jam-deck-stack-source-ghost") && styleSource.includes("opacity: 0;"), "source stack visuals must fully yield to their moving FLIP copies");
assert(styleSource.includes("translate3d(var(--jd-stack-from-x, 0px), var(--jd-stack-from-y, 0px), 0) scale(var(--jd-stack-from-scale, 1))"), "stack preview copies must start from their source geometry via a from-transform while resting at the arranged layout");
assert(pluginSource.includes("drag.liftTimer = this.ownerWindow.setTimeout(lift, CANVAS_STACK_LIFT_DELAY_MS);"), "pressed Canvas nodes must arm a hold-delay lift on pointerdown");
assert(pluginSource.includes("CANVAS_STACK_LIFT_DELAY_MS"), "the hold delay between click and press must be an explicit constant");
assert(pluginSource.includes("drag.moved = true;\n        this.ownerWindow.clearTimeout(drag.liftTimer);\n        lift();"), "dragging past the threshold must lift immediately without waiting for the hold delay");
assert(pluginSource.includes("this.ownerWindow.clearTimeout(drag.liftTimer);\n      this.ownerWindow.removeEventListener"), "the lift timer must be cleared when the drag session ends");
assert(styleSource.includes("is-jam-deck-stack-dragging:has(.canvas-node-content.media-embed > img) .canvas-node-container {\n  opacity: 0.5;"), "lifted Canvas nodes must drop to 50% opacity");
assert(!styleSource.includes("scale: 1.018"), "lifted Canvas nodes must not scale while pressed");
assert(!styleSource.includes("is-jam-deck-stack-dragging:has(.canvas-node-content.media-embed > img) .canvas-node-container {\n  translate: 0 -6px;"), "lifted Canvas nodes must not translate while pressed");
assert(styleSource.includes(".jam-deck-root.jam-deck-no-motion *"), "the plugin animation toggle must disable motion via a scoped class");
assert(pluginSource.includes("wrapper.getBoundingClientRect();"), "stack preview must commit its source frame before starting FLIP motion");
assert(pluginSource.includes("this.previewWrapper === wrapper") && pluginSource.includes('!wrapper.hasClass("is-closing")'), "delayed preview motion must not reopen a closing stack");
assert(pluginSource.includes("this.ownerWindow.requestAnimationFrame(() =>"), "stack previews must coordinate work with animation frames");
assert(pluginSource.includes("this.togglePreview(cluster)"), "stack previews must toggle from a completed click");
assert(pluginSource.includes("externalPreviewClusters"), "stack previews must retain explicit folder clusters outside implicit reconciliation");
assert(pluginSource.includes("!this.externalPreviewClusters.has(this.previewClusterId)"), "stack reconciliation must preserve an open explicit folder preview");
assert(pluginSource.includes("this.externalPreviewClusters.clear()"), "stack destroy must clear external preview cluster registrations");
assert(pluginSource.includes("Math.hypot(next.clientX - drag.startClientX, next.clientY - drag.startClientY) >= 5"), "stack clicks must yield to image drags after a movement threshold");
assert(pluginSource.includes("jam-deck-ai-chat-actions"), "archive/clear/close must group together at the header's right end beside the close button");
assert(pluginSource.includes("enqueueCanvasDrop(entry, jobs)"), "Canvas image drops must enqueue a work queue instead of rejecting while a previous image is still being written");
assert(pluginSource.includes("drainCanvasDropQueue(entry)"), "Canvas image drops must drain sequentially so multiple images land one after another");
assert(pluginSource.includes("batchTail"), "batched Canvas drops must mark the tail image for the single flush save");
assert(pluginSource.includes("const sources = [];") && pluginSource.includes("sources.length ? sources : null"), "external Canvas drops must collect every image file in the transfer");
assert(pluginSource.includes("items: [item]"), "clipboard drops must put the item object itself in the items array so the source is the item");
assert(!pluginSource.includes("source.item, pos, operation"), "drop commit must not read source.item for clipboard source — the item IS the source");
assert(pluginSource.includes("this.plugin.writeVaultFile(filePath, block"), "archive must write through the guarded writer that ensures the date folder exists");
assert(pluginSource.includes("async ensureVaultFileParent(filePath)"), "a generic guard must ensure a file's parent folder before any vault write");
assert(pluginSource.includes("async writeVaultFile(filePath, content, header)"), "a generic writer must create-or-append behind the parent-folder guard");
assert(pluginSource.includes("await this.writeVaultFile(path"), "the AI conversation log must write through the guarded writer");
assert(pluginSource.includes("await this.plugin.ensureVaultFileParent(path)"), "ink strokes must write through the guarded writer");
assert(!pluginSource.includes("上一张图片仍在写入 Canvas"), "the single-slot drop lock must be gone so queued images are never rejected");
assert(pluginSource.includes("suppressSync"), "toolbar sync must pause while the pointer is down so panning a large Canvas does not rescan every node per move");
assert(pluginSource.includes('event.target.closest(".canvas-menu, .canvas-card-menu, .canvas-controls, .jam-deck-drawing-palette")'), "Canvas interaction throttling must never intercept the native floating toolbar");
assert(pluginSource.includes("if (!this.suppressSync) return;\n      this.suppressSync = false;"), "toolbar pointerup must not schedule a reconcile when pointerdown was an excluded native control");
assert(!pluginSource.includes("ownerWindow.setTimeout(activate, 0)"), "embedded Canvas controls must not lose their native click to a delayed Jam Deck active-leaf takeover");
assert(pluginSource.includes("const pointerdown = () => activate();"), "embedded Canvas controls must synchronously keep the real Jam Deck host tab active instead of activating their detached leaf");
assert(pluginSource.includes("findSelectedNodes()"), "toolbar sync must classify selected image/text nodes in a single scan");
assert(pluginSource.includes("CANVAS_DROP_AUTO_GAP"), "multi-image drops must lay out beside the previous image with a fixed world gap");
assert(pluginSource.includes("dropCursorRect"), "multi-image drops must track the previous placed rect for automatic row layout");
assert(pluginSource.includes("async setAiImageContext("), "the AI chat must own an image loader shared by drag, drop and paste");
assert(pluginSource.includes("async loadAiImageIntoChat("), "the AI chat must accept dropped clipboard or filesystem images");
assert(pluginSource.includes("jam-deck-ai-image-dock"), "the AI chat must show a removable preview dock for the loaded image");
assert(pluginSource.includes("clipboardData.files"), "pasting a screenshot into the AI input must load it as an image");
assert(pluginSource.includes("is-jam-deck-ai-drop-target"), "the AI chat must highlight itself while an image is dragged over it");
assert(pluginSource.includes("findFreeCanvasRect("), "the AI assistant must scan for a free canvas spot instead of stacking onto existing nodes");
assert(pluginSource.includes("const pos = this.findFreeCanvasRect(canvas, basePos, width, height, canvasContext.nodeId)"), "canvas text placement must run through the free-spot finder");
assert(pluginSource.includes("zoomToSelection"), "the newly placed canvas node must be selected and the viewport must follow it");
assert(pluginSource.includes('const providerLabel = this.plugin.settings.aiProvider === "qwen" ? "千问" : "DeepSeek"'), "the busy indicator must follow the active provider, not the image context");
assert(!pluginSource.includes('imageCtx ? "千问"'), "the busy indicator must never infer the model from whether an image is attached");
assert(styleSource.includes(".jam-deck-ai-image-dock[hidden]") && styleSource.includes("display: none"), "the empty image dock must be hidden even though its base rule uses display:flex");
assert(pluginSource.includes("看图需要千问（多模态）"), "Canvas image context must require qwen when the provider is not multimodal");
assert(pluginSource.includes("openAiChatWithCanvasImage"), "Canvas image nodes must open the AI chat with an image context");
assert(pluginSource.includes("图片上下文已移除"), "switching to DeepSeek must drop the image context so plain text continues without a false qwen guard");
assert(pluginSource.includes('next === "deepseek" && this.aiCanvasContext && this.aiCanvasContext.kind === "image"'), "provider switch must degrade the image context only when leaving qwen");
assert(pluginSource.includes("async archiveAiChat()"), "the AI chat must own an archive action");
assert(pluginSource.includes("attachments/jam-deck-chatbot/"), "archives must be stored under attachments/jam-deck-chatbot");
assert(pluginSource.includes("this.aiArchivedCount"), "archives must advance a cursor so already-archived turns are never re-recorded");
assert(pluginSource.includes("clearAiChat()"), "the AI chat must own a clear action");
assert(pluginSource.includes("已清空对话窗口（已归档记录不受影响）"), "clearing the chat window must not touch archived records");
assert(pluginSource.includes("api.deepseek.com/chat/completions"), "archive summarization must always use the DeepSeek endpoint regardless of the active provider");
assert(pluginSource.includes("jam-deck-ai-chat-actions"), "archive/clear/close must group together at the header's right end beside the close button");
assert(pluginSource.includes('const threshold = press.pointerType === "touch" ? 10 : 6'), "expanded stack cards must separate click from drag with pointer-specific thresholds");
assert(pluginSource.includes("this.canvas.posFromEvt(event)"), "expanded stack drag-out must convert pointer endpoints through native Canvas world coordinates");
assert(pluginSource.includes("this.commitPreviewDrag(press, next)"), "expanded stack cards must commit a real Canvas drag-out after the threshold");
assert(pluginSource.includes("normalizationKind: press.kind"), "drag-out must restore image and text normalization through one typed path");
assert(pluginSource.includes("node.startEditing()"), "expanded text cards must enter the verified native Canvas editor directly");
assert(!pluginSource.includes("node.nodeEl.dispatchEvent") && !pluginSource.includes("node.nodeEl.click()"), "Canvas text editing must not depend on synthetic pointer or click fallbacks");
assert(styleSource.includes(".jam-deck-canvas-stack-image-focus-media > img"), "expanded image cards must provide a dedicated viewport preview");
assert(styleSource.includes("width: 90%") && styleSource.includes("height: 90%") && styleSource.includes("max-height: 100%"), "image focus preview must remain bounded to the viewport");
assert(styleSource.includes(".jam-deck-canvas-stack-drag-portal"), "expanded stack drag-out must use a DOM-only elevated portal");
assert(pluginSource.includes("JAM_DECK_STACK_TEXT_PREVIEW_FONT_PX = 16"), "expanded Canvas text must use one fixed screen-space font target");
assert(pluginSource.includes("JAM_DECK_STACK_TEXT_PREVIEW_FONT_PX") && pluginSource.includes('"--jd-stack-text-font-size"') && pluginSource.includes("`${JAM_DECK_STACK_TEXT_PREVIEW_FONT_PX}px`"), "text preview font must be fixed at the screen target because the card rests at its real arranged layout");
assert(pluginSource.includes("JAM_DECK_STACK_TEXT_PREVIEW_PADDING_PX") && pluginSource.includes("--jd-stack-text-padding"), "text preview padding must remain fixed in screen space");
assert(styleSource.includes("font-size: var(--jd-stack-text-font-size, 16px) !important"), "cloned Canvas text descendants must not retain native zoom-driven font sizes");
assert(styleSource.includes("--jd-stack-text-font-size: 16px"), "dragged-out text previews must return to the fixed screen font after the card transform is removed");
assert(styleSource.includes("border-radius: 0") && styleSource.includes(".jam-deck-canvas-stack-preview-card {"), "expanded stack cards must not impose a shared rounded container");
assert(styleSource.includes(".markdown-preview-sizer") && styleSource.includes("max-width: none !important"), "expanded text must remove Obsidian's centered readable-line width");
assert(styleSource.includes("padding: var(--jd-stack-text-padding, 16px) !important"), "expanded text must use one fixed screen-space inset");
assert(pluginSource.includes("window.Notification"), "clock countdown must use the desktop Web Notification bridge");
assert(pluginSource.includes("CreateToastNotifier('${COUNTDOWN_WINDOWS_APP_ID}')"), "Windows countdown notifications must use Obsidian's registered AppUserModelID");
assert(pluginSource.includes('execFile(') && pluginSource.includes('"powershell.exe"'), "Windows countdown notifications must use the hidden native toast bridge");
assert(pluginSource.includes("countdownEndsAt: Date.now() + seconds * 1000"), "countdown persistence must store an absolute deadline instead of decrementing saved state");
assert(pluginSource.includes("for (const widget of this.settings.widgets)") && pluginSource.includes("void this.completeCountdown(widget.id, state.endsAt)"), "countdown completion must run even when no Jam Deck view is visible");
assert(styleSource.includes(".jam-deck-countdown-duration") && styleSource.includes("font-variant-numeric: tabular-nums"), "countdown duration must use a compact stable-width control");
assert(pluginSource.includes("jamDeckRenderCountdownFlip") && pluginSource.includes('role: "timer"'), "running countdown must render an accessible flip-card timer");
assert(pluginSource.includes('role: "group"') && pluginSource.includes("jam-deck-countdown-duration-hours"), "idle countdown must expose separate hour, minute and second fields");
assert(styleSource.includes(".jam-deck-countdown-flip-digit") && styleSource.includes("@keyframes jam-deck-countdown-flip"), "countdown digits must use the flip-card visual treatment");
assert(styleSource.includes("--jd-countdown-card-top") && styleSource.includes(".theme-dark .jam-deck-root"), "countdown cards must use separate light and dark theme tokens");
assert(pluginSource.includes("animationsEnabled"), "the animation toggle must persist in plugin settings");
assert(!pluginSource.includes("queueHoverMove(event)") && !pluginSource.includes('addEventListener("pointerleave", pointerleave'), "stack previews must not open or close from hover");
assert(pluginSource.includes("is-jam-deck-stack-source-ghost"), "stack source visuals must restore through a scoped visual class");
assert(!styleSource.includes(".jam-deck-canvas-leaf .canvas-node { transform:"), "Canvas stack styling must never replace native node positioning transforms");
assert(styleSource.includes(".jam-deck-calendar-day.is-today { background: transparent"), "today state must not paint the whole calendar cell");
assert(pluginSource.includes('const completedCount = tasks.filter((task) => task.status === "completed" || task.status === "archived").length'), "completed and archived due tasks must drive calendar heat");
assert(pluginSource.includes("const completionLevel = Math.min(5, completedCount)"), "calendar completion heat must cap at five levels");
assert(pluginSource.includes('const activeTasks = tasks.filter((task) => task.status === "active")'), "only active due tasks may keep clickable calendar dots");
for (const [level, opacity] of [[1, 20], [2, 40], [3, 60], [4, 80]]) {
  assert(styleSource.includes(`.jam-deck-calendar-date.has-completed.heat-${level} { background: color-mix(in srgb, var(--jd-accent) ${opacity}%, transparent)`), `calendar heat ${level} must use ${opacity}% brand green`);
}
assert(styleSource.includes(".jam-deck-calendar-date.has-completed.heat-5 { background: var(--jd-accent)"), "calendar heat 5 must use solid brand green");
assert(!styleSource.includes(".jam-deck-calendar-task-marker.is-completed"), "completed calendar tasks must not regress to gray dots");
assert(pluginSource.indexOf('cls: `jam-deck-task-category') < pluginSource.indexOf('cls: "jam-deck-task-title"'), "task category must render before the title");
assert(pluginSource.includes('const SHORTCUT_DRAG_MIME = "application/x-jam-deck-shortcut+json"'), "launcher reorder must use a private drag MIME");
assert(pluginSource.includes('kind: "url"'), "launcher must persist URL shortcuts as an explicit kind");
assert(pluginSource.includes("resolveShortcutIconPath(shortcut)"), "launcher icon rendering must resolve converted WebP files");
assert(pluginSource.includes('"aria-live": "polite"'), "launcher reorder must announce position changes");
assert(styleSource.includes(".jam-deck-launcher-item.is-insert-before::before"), "launcher reorder must use a thin insertion indicator");
assert(pluginSource.includes("applyAnimationSetting()") && pluginSource.includes("jam-deck-no-motion"), "the deck must sync the animation class from settings");
assert(!styleSource.includes("@media (any-pointer: coarse)"), "clipboard actions must not remain visible merely because Windows reports a coarse pointer");
assert(pluginSource.includes('music: { label: "音乐播放器"'), "widget picker must expose the music player");
assert(pluginSource.includes('case "music":') && pluginSource.includes("this.renderMusicPlayer(body, widget);"), "music widgets must render through their dedicated view");
assert(pluginSource.includes("GlobalSystemMediaTransportControlsSessionManager"), "music playback must use Windows GSMTC instead of scraping player windows");
assert(
  pluginSource.includes('spawn("powershell.exe"') &&
  pluginSource.includes('"-NoLogo"') &&
  pluginSource.includes('"-NoProfile"') &&
  pluginSource.includes('"-NonInteractive"') &&
  pluginSource.includes('"-EncodedCommand"'),
  "the media bridge must launch a fixed encoded PowerShell program"
);
assert(pluginSource.includes("protocolVersion") && pluginSource.includes("requestId"), "the media bridge must use a versioned request protocol");
assert(!pluginSource.includes('data-role="like"'), "the lightweight player must not render a local favorite control");
assert(!pluginSource.includes("jam-deck-music-lyric") && !pluginSource.includes("jam-deck-music-source-state"), "the lightweight player must remove lyrics and visible provider status");
assert(styleSource.includes("Windows GSMTC music player: compact transport"), "music styling must remain explicitly scoped");
assert(styleSource.includes(".jam-deck-music-player.is-playing .jam-deck-music-disc"), "playing media must rotate its CD surface");
assert(styleSource.includes(".jam-deck-music-cover"), "the rotating CD must keep the album artwork in its center");
assert(styleSource.includes(".jam-deck-music-tonearm") && styleSource.includes(".jam-deck-music-player.is-playing .jam-deck-music-tonearm"), "the CD must include a white tonearm driven by authoritative playback state");
assert(pluginSource.includes('type: "range"') && pluginSource.includes('"seek"'), "the progress control must expose draggable seek");
assert(pluginSource.includes('aria-haspopup": "menu"') && pluginSource.includes('role: "menuitemradio"'), "the compact source button must expose an accessible single-select menu");
assert(styleSource.includes(".jam-deck-music-player:hover .jam-deck-music-controls") && styleSource.includes(".jam-deck-music-player:focus-within .jam-deck-music-controls"), "transport controls must reveal on hover and keyboard focus");
assert(pluginSource.includes("jam-deck-music-transport-stage") && styleSource.includes(".jam-deck-music-transport-stage"), "transport controls and timeline must share one overlay stage");
assert(styleSource.includes("color-mix(in srgb, var(--jd-surface) 94%, transparent)") && styleSource.includes("justify-self: start") && styleSource.includes("text-align: left"), "hover transport must veil the timeline and metadata must follow the screenshot's left-aligned beside-disc layout");
assert(styleSource.includes("@container (max-width: 270px)"), "the music widget must adapt to narrow dashboard columns");
assert(!pluginSource.includes("prefers-reduced-motion"), "JS must not consult the OS reduced-motion media query");
assert(!pluginSource.includes("GameDeck") && !styleSource.includes(".game-deck-"), "Game Deck now ships as its own plugin; Jam Deck must stay 2D only");
assert(pluginSource.includes("function jamDeckCollectFillSlots"), "dashboard insert must collect fillable gaps");
assert(pluginSource.includes("function jamDeckPickFillSlot"), "dashboard insert must pick the hovered gap slot");
assert(pluginSource.includes("function jamDeckApplyFillSlot"), "dashboard insert must apply the fill rectangle size");
assert(pluginSource.includes("function jamDeckFindPushSeam"), "gapless neighbors must fall back to a push seam");
assert(pluginSource.includes("function jamDeckApplyPushSeam"), "push seams must displace the trailing widgets");
assert(pluginSource.includes("applyLayoutSeamPreview"), "push seams must light both neighbor edges while dragging");
assert(pluginSource.includes("includeEdgeSlots"), "edge stretches to the canvas must be Shift-gated");
assert(pluginSource.includes("shiftKey"), "drag preview must read the Shift modifier");
assert(pluginSource.includes("JAM_DECK_WIDGET_MIN_W") && pluginSource.includes("gridColumn = `${widget.x} / span ${JAM_DECK_WIDGET_MIN_W}`"), "dragged widgets must visually collapse to the minimum footprint");
assert(pluginSource.includes("ensureLayoutShiftHint") && pluginSource.includes("setLayoutShiftHintVisible"), "drag must surface a Shift fill hint while floating");
assert(pluginSource.includes("按住 Shift 可延伸填充到画布边缘"), "the drag hint must tell the user about Shift edge fill");
assert(styleSource.includes(".jam-deck-layout-shift-hint") && styleSource.includes("linear-gradient"), "the Shift hint must use a bottom white gradient");
assert(pluginSource.includes("function jamDeckCollectLayoutNodes") && pluginSource.includes("function jamDeckApplySashDelta"), "the shared layout must expose gap-node sash helpers");
assert(pluginSource.includes("this.enableLayoutSashes(grid);"), "gap nodes must mount in both browse and edit modes");
assert(!pluginSource.includes("jam-deck-resize-handle") && !styleSource.includes(".jam-deck-resize-handle"), "the legacy diagonal corner resize handle must be removed");
assert(styleSource.includes(".jam-deck-sash-dot") && styleSource.includes(".jam-deck-sash-handle"), "gap nodes must render as small hover dots");
assert(pluginSource.includes("canCommit"), "floating drag must separate hover preview from commit eligibility");
assert(pluginSource.includes("translate3d(") && pluginSource.includes("scale(1.02)"), "dragged widgets must float with a lifted transform");
assert(pluginSource.includes("commitWidgetLayout"), "dashboard drag release must commit a full layout snapshot");
assert(pluginSource.includes("is-layout-dragging"), "dashboard drag preview must mark the grid while rearranging");
assert(pluginSource.includes("jam-deck-layout-slot"), "gap previews must render through a dedicated slot overlay");
assert(styleSource.includes(".jam-deck-layout-slot"), "gap fill previews must have a green gradient stroke rectangle");
assert(styleSource.includes(".jam-deck-widget.is-layout-seam-bottom::after") && styleSource.includes(".jam-deck-widget.is-layout-seam-right::after"), "gapless seams must light the facing neighbor edges");
assert(styleSource.includes("0 18px 40px rgb(15 20 18 / 0.22)"), "dragged widgets must float with a soft elevation shadow");
assert(pluginSource.includes("root.toggleClass(\"jam-deck-no-motion\", !this.plugin.settings.animationsEnabled)"), "the deck root must apply the animation class from settings");

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "obsidian") {
    class Base {}
    return { ItemView: Base, Modal: Base, Notice: Base, Plugin: Base, PluginSettingTab: Base, Setting: Base, WorkspaceLeaf: Base, normalizePath: (p) => p, requestUrl: async () => ({ status: 200, json: {} }), setIcon: () => {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const JamDeckPlugin = require(mainPath);
const authoritativeTextNode = { getData: () => ({ type: "text", text: "current" }), nodeEl: { matches: () => false } };
const staleDomNode = { getData: () => ({ type: "file", file: "stale.png" }), nodeEl: { matches: () => true } };
assert.deepStrictEqual(
  JamDeckPlugin.selectedCanvasNodes({ selection: new Set([authoritativeTextNode]), nodes: new Set([authoritativeTextNode, staleDomNode]) }),
  { image: null, text: authoritativeTextNode },
  "Canvas AI must trust the authoritative selection set even when stale selected DOM classes remain",
);
assert.deepStrictEqual(
  JamDeckPlugin.selectedCanvasNodes({ selection: new Set([authoritativeTextNode, staleDomNode]) }),
  { image: null, text: null },
  "Canvas AI must stay unavailable for a real multi-selection",
);
const selectedLinkNode = { getData: () => ({ type: "link", url: "https://miro.com/board" }) };
assert.deepStrictEqual(
  JamDeckPlugin.selectedCanvasNodes({ selection: new Set([selectedLinkNode]) }),
  { image: null, text: selectedLinkNode },
  "Canvas AI must accept the current link node instead of silently hiding its action",
);
const selectedMarkdownNode = { getData: () => ({ type: "file", file: "Work/brief.md" }) };
assert.deepStrictEqual(
  JamDeckPlugin.selectedCanvasNodes({ selection: new Set([selectedMarkdownNode]) }),
  { image: null, text: selectedMarkdownNode },
  "Canvas AI must accept the current Markdown note node",
);
assert(pluginSource.includes("this.aiPressedNode = selected.image || selected.text || null"), "Canvas AI must capture the current authoritative node at pointerdown");
Module._load = originalLoad;

const widgetLayout = JamDeckPlugin.widgetLayoutHelpers;
assert(widgetLayout, "widget layout helpers must be exported for deterministic fixtures");
assert(styleSource.includes(".jam-deck-widget.is-compact") && styleSource.includes(".jam-deck-widget-compact-icon"), "undersized widgets must render the shared watermark surface");
assert(pluginSource.includes('el.toggleClass("is-compact-live-full", !nextCompact && committedCompact)'), "compact widgets must reveal their already-mounted body as soon as sash preview crosses the display threshold");
assert(styleSource.includes(".jam-deck-widget.is-compact.is-compact-live-full"), "live full-size preview must override the committed watermark state");
assert(pluginSource.includes("window.requestAnimationFrame(() =>") && pluginSource.includes("this._sashFrame"), "sash DOM updates must be coalesced to animation frames");
assert(pluginSource.includes('restore.addEventListener("pointerdown", (event) => event.stopPropagation())'), "the compact restore icon must not start widget dragging");
assert(pluginSource.includes('restore.setAttribute("aria-busy", "true")') && pluginSource.includes('restore.setAttribute("aria-disabled", "true")'), "restore transactions must expose their busy and disabled state");

const displayMinimums = {
  clock: [4, 4],
  music: [2, 4],
  calendar: [4, 4],
  clipboard: [4, 5],
  launcher: [3, 4],
  "canvas-embed": [5, 5],
  tasks: [4, 4],
  canvas: [3, 4],
  browser: [3, 3],
};
for (const [type, [w, h]] of Object.entries(displayMinimums)) {
  assert.deepStrictEqual(widgetLayout.displayMinimum(type), { w, h }, `${type} must retain the captured minimum full-display size`);
  assert.strictEqual(widgetLayout.isCompact({ type, w, h }), false, `${type} must stay full at the exact threshold`);
  assert.strictEqual(widgetLayout.isCompact({ type, w: w - 1, h }), true, `${type} must compact when narrower than the threshold`);
  assert.strictEqual(widgetLayout.isCompact({ type, w, h: h - 1 }), true, `${type} must compact when shorter than the threshold`);
}
assert.strictEqual(widgetLayout.isCompact({ type: "unknown", w: 1, h: 1 }), false, "unknown widget types must not be compacted destructively");

const pushFixture = [
  { id: "target", type: "clock", x: 1, y: 1, w: 2, h: 2 },
  { id: "small", type: "browser", x: 1, y: 2, w: 2, h: 3 },
  { id: "large", type: "launcher", x: 3, y: 4, w: 5, h: 2 },
  { id: "untouched", type: "music", x: 10, y: 8, w: 2, h: 4 },
];
const pushed = widgetLayout.resolveRestore(pushFixture, "target", { cols: 14, rows: 12, maxStates: 6000 });
assert.strictEqual(pushed.status, "OK", "compact restore must find a deterministic pushed layout");
assert.deepStrictEqual(pushed.layout.find((item) => item.id === "target"), { id: "target", type: "clock", x: 1, y: 1, w: 4, h: 4 }, "restore must use the exact captured threshold at the current origin");
assert.strictEqual(pushed.movedIds[0], "large", "the largest colliding widget footprint must be pushed first even when its overlap is smaller");
assert.deepStrictEqual(pushed.layout.find((item) => item.id === "untouched"), pushFixture[3], "widgets outside the causal collision chain must stay fixed");
assert(widgetLayout.collisionFree(pushed.layout, 14, 12), "pushed restore output must remain in bounds and collision free");
assert.deepStrictEqual(widgetLayout.resolveRestore(pushFixture, "target", { cols: 14, rows: 12, maxStates: 6000 }), pushed, "identical persisted order must produce an identical restore layout");

const compressBelowFixture = [
  { id: "music", type: "music", x: 1, y: 1, w: 7, h: 2 },
  { id: "canvas", type: "canvas-embed", x: 1, y: 3, w: 7, h: 8 },
];
const compressedBelow = widgetLayout.resolveRestore(compressBelowFixture, "music", { cols: 10, rows: 10 });
assert.strictEqual(compressedBelow.status, "OK", "compact restore must move a shared boundary before reporting no space");
assert.strictEqual(compressedBelow.mode, "sash", "an adjacent lower widget must be compressed through the shared sash");
assert.deepStrictEqual(
  compressedBelow.layout.find((item) => item.id === "music"),
  { id: "music", type: "music", x: 1, y: 1, w: 7, h: 4 },
  "restore must preserve an already sufficient width and recover only the missing height",
);
assert.deepStrictEqual(
  compressedBelow.layout.find((item) => item.id === "canvas"),
  { id: "canvas", type: "canvas-embed", x: 1, y: 5, w: 7, h: 6 },
  "the lower component must keep its bottom edge while its top edge is pushed down",
);
assert.deepStrictEqual(compressedBelow.movedIds, ["canvas"], "only the component sharing the pushed boundary should change");
assert(widgetLayout.collisionFree(compressedBelow.layout, 10, 10), "sash restore must remain in bounds and collision free");

const clamped = widgetLayout.resolveRestore([
  { id: "edge", type: "browser", x: 4, y: 4, w: 2, h: 2 },
], "edge", { cols: 5, rows: 5 });
assert.strictEqual(clamped.status, "OK");
assert.deepStrictEqual({ x: clamped.layout[0].x, y: clamped.layout[0].y, w: clamped.layout[0].w, h: clamped.layout[0].h }, { x: 3, y: 3, w: 3, h: 3 }, "edge restore must clamp by the minimum displacement");

const fullGrid = [
  { id: "target", type: "clock", x: 1, y: 1, w: 2, h: 2 },
  { id: "block", type: "music", x: 3, y: 1, w: 2, h: 2 },
];
assert.strictEqual(widgetLayout.resolveRestore(fullGrid, "target", { cols: 4, rows: 4, maxStates: 50 }).status, "NO_SPACE", "an exhausted full grid must report no space without mutation");
assert.deepStrictEqual(fullGrid, [
  { id: "target", type: "clock", x: 1, y: 1, w: 2, h: 2 },
  { id: "block", type: "music", x: 3, y: 1, w: 2, h: 2 },
], "failed restore solving must not mutate the input layout");
assert.strictEqual(widgetLayout.resolveRestore(pushFixture, "target", { cols: 14, rows: 12, maxStates: 1 }).status, "SEARCH_LIMIT", "bounded search must distinguish its safety limit from no space");
// Layout fixtures pin their own grid so they stay meaningful when the deck density changes.
const GRID_12 = { cols: 12, rows: 18 };

const directEmpty = widgetLayout.preview(
  [
    { id: "fixed", type: "clock", x: 1, y: 1, w: 4, h: 4 },
    { id: "moving", type: "music", x: 1, y: 10, w: 4, h: 3 },
  ],
  "moving",
  { col: 8, row: 9, placementX: 7, placementY: 8 },
  GRID_12,
);
assert.strictEqual(directEmpty.mode, "direct", "a free rectangle large enough for the selected widget must accept a direct drop");
assert(directEmpty.canCommit, "direct placement in empty space must be committable");
assert.deepStrictEqual(
  directEmpty.widgets.find((item) => item.id === "moving"),
  { id: "moving", type: "music", x: 7, y: 8, w: 4, h: 3 },
  "direct placement must preserve the selected widget dimensions",
);
assert.deepStrictEqual(directEmpty.widgets.find((item) => item.id === "fixed"), { id: "fixed", type: "clock", x: 1, y: 1, w: 4, h: 4 }, "direct placement must not disturb unrelated widgets");
assert.strictEqual(directEmpty.slot.axis, "free", "direct placement must expose a full-size free-space preview rectangle");
assert(pluginSource.includes("placementX: colFloat - grabOffsetX") && pluginSource.includes("placementY: rowFloat - grabOffsetY"), "free placement must preserve the original pointer grab offset");

const verticalGap = widgetLayout.preview(
  [
    { id: "b", type: "clock", x: 1, y: 1, w: 4, h: 4 },
    { id: "c", type: "clock", x: 1, y: 10, w: 4, h: 4 },
    { id: "a", type: "clock", x: 8, y: 1, w: 3, h: 3 },
  ],
  "a",
  { col: 2.5, row: 7 },
  GRID_12
);
assert(verticalGap.ok, "hovering a vertical gap must remain a valid floating drag");
assert.strictEqual(verticalGap.mode, "fill", "a roomy vertical gap must enter fill mode");
assert(verticalGap.canCommit, "a roomy vertical gap must be committable");
assert.deepStrictEqual(verticalGap.slot, {
  axis: "y",
  x: 1,
  y: 5,
  w: 4,
  h: 5,
  beforeId: "b",
  afterId: "c",
}, "vertical gaps must fill with B/C unified width");
assert.deepStrictEqual(
  verticalGap.widgets.find((item) => item.id === "a"),
  { id: "a", type: "clock", x: 1, y: 5, w: 4, h: 5 },
  "drop into a vertical gap must adopt the fill rectangle size"
);
assert.strictEqual(verticalGap.widgets.find((item) => item.id === "c").y, 10, "fill mode must not move C");

const horizontalGap = widgetLayout.preview(
  [
    { id: "b", type: "clock", x: 1, y: 1, w: 3, h: 5 },
    { id: "c", type: "clock", x: 9, y: 1, w: 3, h: 5 },
    { id: "a", type: "clock", x: 1, y: 10, w: 4, h: 3 },
  ],
  "a",
  { col: 6, row: 3 },
  GRID_12
);
assert.strictEqual(horizontalGap.mode, "fill", "a roomy horizontal gap must enter fill mode");
assert.deepStrictEqual(horizontalGap.slot, {
  axis: "x",
  x: 4,
  y: 1,
  w: 5,
  h: 5,
  beforeId: "b",
  afterId: "c",
}, "horizontal gaps must fill with B/C unified height");
assert.deepStrictEqual(
  horizontalGap.widgets.find((item) => item.id === "a"),
  { id: "a", type: "clock", x: 4, y: 1, w: 5, h: 5 },
  "drop into a horizontal gap must adopt the fill rectangle size"
);

const edgeBelowPlain = widgetLayout.preview(
  [
    { id: "b", type: "clock", x: 5, y: 1, w: 4, h: 6 },
    { id: "a", type: "clock", x: 1, y: 1, w: 3, h: 3 },
  ],
  "a",
  { col: 6.5, row: 12 },
  GRID_12
);
assert.strictEqual(edgeBelowPlain.mode, "float", "B without C below must stay floating unless Shift is held");
assert.strictEqual(edgeBelowPlain.slot, null, "edge stretches must not appear without Shift");

const edgeBelow = widgetLayout.preview(
  [
    { id: "b", type: "clock", x: 5, y: 1, w: 4, h: 6 },
    { id: "a", type: "clock", x: 1, y: 1, w: 3, h: 3 },
  ],
  "a",
  { col: 6.5, row: 12 },
  { ...GRID_12, shiftKey: true }
);
assert.strictEqual(edgeBelow.mode, "fill", "holding Shift must unlock fill to the canvas bottom");
assert.deepStrictEqual(edgeBelow.slot, {
  axis: "y",
  x: 5,
  y: 7,
  w: 4,
  h: 12,
  beforeId: "b",
  afterId: null,
}, "missing C below must stretch the fill rectangle to the last row while Shift is held");

const edgeRightPlain = widgetLayout.preview(
  [
    { id: "b", type: "clock", x: 1, y: 4, w: 5, h: 4 },
    { id: "a", type: "clock", x: 1, y: 10, w: 3, h: 3 },
  ],
  "a",
  { col: 9, row: 5.5 },
  GRID_12
);
assert.strictEqual(edgeRightPlain.mode, "float", "B without C to the right must stay floating unless Shift is held");

const edgeRight = widgetLayout.preview(
  [
    { id: "b", type: "clock", x: 1, y: 4, w: 5, h: 4 },
    { id: "a", type: "clock", x: 1, y: 10, w: 3, h: 3 },
  ],
  "a",
  { col: 9, row: 5.5 },
  { ...GRID_12, shiftKey: true }
);
assert.strictEqual(edgeRight.mode, "fill", "holding Shift must unlock fill to the canvas right edge");
assert.deepStrictEqual(edgeRight.slot, {
  axis: "x",
  x: 6,
  y: 4,
  w: 7,
  h: 4,
  beforeId: "b",
  afterId: null,
}, "missing C to the right must stretch the fill rectangle to the last column while Shift is held");

const zeroGapVertical = widgetLayout.preview(
  [
    { id: "b", type: "clock", x: 1, y: 1, w: 4, h: 5 },
    { id: "c", type: "clock", x: 1, y: 6, w: 4, h: 5 },
    { id: "d", type: "clock", x: 1, y: 11, w: 4, h: 3 },
    { id: "a", type: "clock", x: 8, y: 1, w: 4, h: 3 },
  ],
  "a",
  { col: 2.5, row: 6 },
  GRID_12
);
assert.strictEqual(zeroGapVertical.mode, "push", "zero-height gaps must fall back to push insert");
assert(zeroGapVertical.canCommit, "a zero-gap push must be committable");
assert.strictEqual(zeroGapVertical.slot, null, "push mode must not draw a fill rectangle");
assert.deepStrictEqual(zeroGapVertical.seam, { axis: "y", beforeId: "b", afterId: "c" }, "push mode must report both seam neighbors for the glow");
const pushedVertical = Object.fromEntries(zeroGapVertical.widgets.map((item) => [item.id, item]));
assert.deepStrictEqual(
  pushedVertical.a,
  { id: "a", type: "clock", x: 1, y: 6, w: 4, h: 2 },
  "vertical push insert must adopt the neighbor width and collapse A to the minimum height"
);
assert.strictEqual(pushedVertical.c.y, 8, "C must be pushed down by A's minimum height");
assert.strictEqual(pushedVertical.c.h, 5, "pushed C must keep its own height");
assert.strictEqual(pushedVertical.d.y, 13, "D must follow C downward");

const zeroGapHorizontal = widgetLayout.preview(
  [
    { id: "b", type: "clock", x: 1, y: 1, w: 3, h: 4 },
    { id: "c", type: "clock", x: 4, y: 1, w: 3, h: 4 },
    { id: "d", type: "clock", x: 7, y: 1, w: 3, h: 4 },
    { id: "a", type: "clock", x: 1, y: 10, w: 2, h: 3 },
  ],
  "a",
  { col: 4, row: 2.5 },
  GRID_12
);
assert.strictEqual(zeroGapHorizontal.mode, "push", "zero-width gaps must fall back to push insert");
assert.deepStrictEqual(zeroGapHorizontal.seam, { axis: "x", beforeId: "b", afterId: "c" }, "horizontal push must report both seam neighbors");
const pushedHorizontal = Object.fromEntries(zeroGapHorizontal.widgets.map((item) => [item.id, item]));
assert.deepStrictEqual(
  pushedHorizontal.a,
  { id: "a", type: "clock", x: 4, y: 1, w: 2, h: 4 },
  "horizontal push insert must adopt the neighbor height and keep A's width"
);
assert.strictEqual(pushedHorizontal.c.x, 6, "C must be pushed right by A's width");
assert.strictEqual(pushedHorizontal.d.x, 9, "D must follow C rightward");
assert.strictEqual(pushedHorizontal.c.w, 3, "C keeps its width while there is room to slide");

const edgeShrinkHorizontal = widgetLayout.preview(
  [
    { id: "clock", type: "clock", x: 1, y: 1, w: 2, h: 3 },
    { id: "launcher", type: "launcher", x: 3, y: 1, w: 10, h: 3 },
    { id: "calendar", type: "calendar", x: 1, y: 4, w: 2, h: 4 },
  ],
  "calendar",
  { col: 3, row: 2 },
  GRID_12
);
assert.strictEqual(edgeShrinkHorizontal.mode, "push", "a gapless seam against the canvas edge must still insert");
assert.deepStrictEqual(edgeShrinkHorizontal.seam, { axis: "x", beforeId: "clock", afterId: "launcher" }, "edge seam must light both neighbors");
const edgeLayout = Object.fromEntries(edgeShrinkHorizontal.widgets.map((item) => [item.id, item]));
assert.deepStrictEqual(
  edgeLayout.calendar,
  { id: "calendar", type: "calendar", x: 3, y: 1, w: 2, h: 3 },
  "the dragged widget collapses to the minimum width and adopts the seam height"
);
assert.deepStrictEqual(
  edgeLayout.launcher,
  { id: "launcher", type: "launcher", x: 5, y: 1, w: 8, h: 3 },
  "a neighbor pinned to the edge must shrink instead of blocking the insert"
);

const edgeShrinkVertical = widgetLayout.preview(
  [
    { id: "b", type: "clock", x: 1, y: 1, w: 4, h: 6 },
    { id: "c", type: "clock", x: 1, y: 7, w: 4, h: 12 },
    { id: "a", type: "clock", x: 8, y: 1, w: 4, h: 3 },
  ],
  "a",
  { col: 2.5, row: 7 },
  GRID_12
);
assert.strictEqual(edgeShrinkVertical.mode, "push", "a full-height column must still accept a push insert");
const edgeVertical = Object.fromEntries(edgeShrinkVertical.widgets.map((item) => [item.id, item]));
assert.deepStrictEqual(edgeVertical.a, { id: "a", type: "clock", x: 1, y: 7, w: 4, h: 2 }, "vertical push collapses A to the minimum height and adopts the column width");
assert.deepStrictEqual(edgeVertical.c, { id: "c", type: "clock", x: 1, y: 9, w: 4, h: 10 }, "C shortens because it already reaches the canvas bottom");

const floatAway = widgetLayout.preview(
  [
    { id: "b", type: "clock", x: 1, y: 1, w: 4, h: 4 },
    { id: "a", type: "clock", x: 1, y: 10, w: 4, h: 3 },
  ],
  "a",
  { col: 10, row: 12 },
  GRID_12
);
assert.strictEqual(floatAway.mode, "float", "hovering outside fillable gaps must stay floating");
assert.strictEqual(floatAway.canCommit, false, "dropping outside a slot must cancel");
assert.deepStrictEqual(floatAway.ghost.w, 2, "the floating ghost must collapse to the minimum width");
assert.deepStrictEqual(floatAway.ghost.h, 2, "the floating ghost must collapse to the minimum height");

assert.strictEqual(widgetLayout.cols, 40, "the deck grid must expose 40 columns");
assert.strictEqual(widgetLayout.rows, 36, "the deck grid must expose 36 rows");

const scaled = widgetLayout.scaleColumns(
  [
    { id: "clock-1", type: "clock", x: 1, y: 1, w: 2, h: 3 },
    { id: "launcher-1", type: "launcher", x: 3, y: 1, w: 10, h: 3 },
    { id: "clipboard-1", type: "clipboard", x: 1, y: 8, w: 2, h: 2 },
  ],
  2
);
assert.deepStrictEqual(
  scaled,
  [
    { id: "clock-1", type: "clock", x: 1, y: 1, w: 4, h: 3 },
    { id: "launcher-1", type: "launcher", x: 5, y: 1, w: 20, h: 3 },
    { id: "clipboard-1", type: "clipboard", x: 1, y: 8, w: 4, h: 2 },
  ],
  "legacy 12-column decks must keep their proportions on the 24-column grid"
);

const denseSeam = widgetLayout.preview(
  [
    { id: "clock", type: "clock", x: 1, y: 1, w: 4, h: 3 },
    { id: "launcher", type: "launcher", x: 5, y: 1, w: 20, h: 3 },
    { id: "calendar", type: "calendar", x: 1, y: 4, w: 4, h: 4 },
  ],
  "calendar",
  { col: 5, row: 2 },
  { cols: 24, rows: 18 }
);
assert.strictEqual(denseSeam.mode, "push", "the migrated layout must still expose the clock/launcher seam");
const denseLayout = Object.fromEntries(denseSeam.widgets.map((item) => [item.id, item]));
assert.deepStrictEqual(denseLayout.calendar, { id: "calendar", type: "calendar", x: 5, y: 1, w: 2, h: 3 }, "the insert collapses to the minimum width on the denser grid");
assert.deepStrictEqual(denseLayout.launcher, { id: "launcher", type: "launcher", x: 7, y: 1, w: 18, h: 3 }, "the edge-pinned launcher shrinks by exactly the minimum insert width");

const sashLayout = [
  { id: "clock", type: "clock", x: 1, y: 1, w: 6, h: 6 },
  { id: "music", type: "music", x: 7, y: 1, w: 4, h: 6 },
  { id: "launcher", type: "launcher", x: 11, y: 1, w: 30, h: 6 },
  { id: "calendar", type: "calendar", x: 1, y: 7, w: 6, h: 8 },
  { id: "canvas", type: "canvas-embed", x: 7, y: 7, w: 34, h: 30 },
  { id: "tasks", type: "tasks", x: 1, y: 15, w: 6, h: 5 },
  { id: "clipboard", type: "clipboard", x: 1, y: 20, w: 6, h: 17 },
];
const sashPack = widgetLayout.collectNodes(sashLayout);
assert(sashPack.nodes.some((node) => node.axis === "xy" && node.x === 7 && node.y === 7), "the clock/music/calendar/canvas junction must expose a cross node");
assert(sashPack.nodes.some((node) => node.axis === "x" && node.x === 11), "the music/launcher gap must expose a horizontal drag node");
assert(sashPack.nodes.some((node) => node.axis === "xy" && node.x === 7 && node.y === 15), "the left-column T junction at tasks must expose a cross node");
const columnSash = sashPack.sashes.find((sash) => sash.axis === "x" && sash.line === 7);
assert(columnSash, "the flush left column must collapse into one vertical sash");
assert(columnSash.beforeIds.includes("clock") && columnSash.beforeIds.includes("clipboard"), "moving the left-column sash must resize every left widget together");
assert(columnSash.afterIds.includes("music") && columnSash.afterIds.includes("canvas"), "moving the left-column sash must resize every right neighbor together");
const shifted = widgetLayout.applySash(sashLayout, columnSash, 2);
const shiftedMap = Object.fromEntries(shifted.map((item) => [item.id, item]));
assert.strictEqual(shiftedMap.clock.w, 8, "sash drag must grow the left widgets");
assert.strictEqual(shiftedMap.music.x, 9, "sash drag must keep the right widgets glued to the moved boundary");
assert.strictEqual(shiftedMap.music.w, 2, "sash drag must shrink the right widgets by the same delta");
assert.strictEqual(shiftedMap.canvas.x, 9, "canvas must stay aligned with music after a unified sash move");
assert.strictEqual(shiftedMap.launcher.x, 11, "widgets beyond the sash must stay put");
const blocked = widgetLayout.applySash(sashLayout, columnSash, 20);
assert.strictEqual(blocked.find((item) => item.id === "music").w, 2, "oversized sash drag must clamp to the minimum size");
assert.strictEqual(blocked.find((item) => item.id === "clock").w, 8, "clamped sash drag must still move the shared boundary as far as it can");
assert(sashPack.nodes.some((node) => node.axis === "xy" && node.x === 41 && node.y === 7 && node.widgetId === "launcher"), "the launcher bottom-right corner must expose an owned cross node");
assert(sashPack.nodes.some((node) => node.axis === "xy" && node.x === 7 && node.y === 37 && node.widgetId === "clipboard"), "the clipboard bottom-right corner must expose an owned cross node");
assert(sashPack.nodes.some((node) => node.axis === "xy" && node.x === 41 && node.y === 37 && node.widgetId === "canvas"), "the canvas bottom-right outer corner must expose an owned cross node");
const launcherCornerResize = widgetLayout.resizeCorner(sashLayout, "launcher", -5, -2);
assert.deepStrictEqual(launcherCornerResize.find((item) => item.id === "launcher"), { id: "launcher", type: "launcher", x: 11, y: 1, w: 25, h: 4 }, "an owned corner must resize only its component");
assert.deepStrictEqual(launcherCornerResize.find((item) => item.id === "canvas"), sashLayout.find((item) => item.id === "canvas"), "launcher corner resize must not alter the canvas below");
assert.deepStrictEqual(launcherCornerResize.find((item) => item.id === "music"), sashLayout.find((item) => item.id === "music"), "launcher corner resize must not alter its left neighbor");
const clipboardCornerResize = widgetLayout.resizeCorner(sashLayout, "clipboard", -2, -3);
assert.deepStrictEqual(clipboardCornerResize.find((item) => item.id === "clipboard"), { id: "clipboard", type: "clipboard", x: 1, y: 20, w: 4, h: 14 }, "the left bottom corner must resize only clipboard");
assert.deepStrictEqual(clipboardCornerResize.find((item) => item.id === "canvas"), sashLayout.find((item) => item.id === "canvas"), "clipboard corner resize must not alter the adjacent canvas");
const canvasCornerResize = widgetLayout.resizeCorner(sashLayout, "canvas", -4, -5);
assert.deepStrictEqual(canvasCornerResize.find((item) => item.id === "canvas"), { id: "canvas", type: "canvas-embed", x: 7, y: 7, w: 30, h: 25 }, "the outer bottom-right corner must resize only canvas");
assert.deepStrictEqual(canvasCornerResize.find((item) => item.id === "launcher"), sashLayout.find((item) => item.id === "launcher"), "canvas corner resize must not alter the launcher above");
assert.deepStrictEqual(canvasCornerResize.find((item) => item.id === "clipboard"), sashLayout.find((item) => item.id === "clipboard"), "canvas corner resize must not alter the clipboard beside it");
assert(pluginSource.includes("active.node.widgetId") && pluginSource.includes("jamDeckResizeWidgetAtCorner"), "owned edge-corner handles must use the single-widget resize path");
const rightEdgeSash = sashPack.sashes.find((sash) => sash.edge === "end" && sash.axis === "x");
const bottomEdgeSash = sashPack.sashes.find((sash) => sash.edge === "end" && sash.axis === "y");
assert(rightEdgeSash && rightEdgeSash.beforeIds.includes("launcher") && rightEdgeSash.beforeIds.includes("canvas"), "the right edge sash must resize every right-pinned component together");
assert(bottomEdgeSash && bottomEdgeSash.beforeIds.includes("canvas") && bottomEdgeSash.beforeIds.includes("clipboard"), "the bottom edge sash must resize every bottom-pinned component together");
const rightEdgePulledIn = widgetLayout.applySash(sashLayout, rightEdgeSash, -3);
assert.strictEqual(rightEdgePulledIn.find((item) => item.id === "launcher").w, 27, "pulling the right edge inward must free a full-height blank strip");
assert.strictEqual(rightEdgePulledIn.find((item) => item.id === "canvas").w, 31, "all components sharing the right edge must shrink by the same amount");
const movedRightEdgeSash = widgetLayout.collectNodes(rightEdgePulledIn).sashes.find((sash) => sash.edge === "end" && sash.axis === "x");
assert.strictEqual(movedRightEdgeSash.line, 38, "the right outer handle must follow the new occupied boundary instead of disappearing");
const rightEdgeRestored = widgetLayout.applySash(rightEdgePulledIn, movedRightEdgeSash, 3);
assert.strictEqual(rightEdgeRestored.find((item) => item.id === "launcher").w, 30, "the followed outer handle must expand components back into the blank strip");
const bottomEdgePulledUp = widgetLayout.applySash(sashLayout, bottomEdgeSash, -4);
assert.strictEqual(bottomEdgePulledUp.find((item) => item.id === "canvas").h, 26, "pulling the bottom edge upward must shorten bottom-pinned canvas content");
assert.strictEqual(bottomEdgePulledUp.find((item) => item.id === "clipboard").h, 13, "all components sharing the bottom edge must shrink together");
const movedBottomEdgeSash = widgetLayout.collectNodes(bottomEdgePulledUp).sashes.find((sash) => sash.edge === "end" && sash.axis === "y");
assert.strictEqual(movedBottomEdgeSash.line, 33, "the bottom outer handle must follow the new occupied boundary instead of disappearing");
const bottomEdgeRestored = widgetLayout.applySash(bottomEdgePulledUp, movedBottomEdgeSash, 4);
assert.strictEqual(bottomEdgeRestored.find((item) => item.id === "canvas").h, 30, "the followed bottom handle must restore components into the freed rows");

const largestInsertion = widgetLayout.insertByLargest([
  { id: "largest", type: "canvas-embed", x: 1, y: 1, w: 12, h: 12 },
  { id: "other", type: "clock", x: 13, y: 1, w: 8, h: 6 },
], { id: "new", type: "tasks", x: 1, y: 1, w: 4, h: 4 }, { cols: 20, rows: 12 });
assert(largestInsertion, "a full layout must split a compressible component instead of reporting no space");
assert.strictEqual(largestInsertion.victimId, "largest", "automatic insertion must choose the current largest component first");
assert.strictEqual(largestInsertion.axis, "x", "equal-loss splits must use the stable beside placement");
assert.deepStrictEqual(largestInsertion.layout.find((item) => item.id === "largest"), { id: "largest", type: "canvas-embed", x: 1, y: 1, w: 8, h: 12 }, "the largest component must shrink by the inserted component width");
assert.deepStrictEqual(largestInsertion.layout.find((item) => item.id === "new"), { id: "new", type: "tasks", x: 9, y: 1, w: 4, h: 4 }, "the new component must be inserted beside the compressed largest component at its complete minimum size");
assert.deepStrictEqual(largestInsertion.layout.find((item) => item.id === "other"), { id: "other", type: "clock", x: 13, y: 1, w: 8, h: 6 }, "unrelated components must remain fixed during largest-area insertion");
assert(widgetLayout.collisionFree(largestInsertion.layout, 20, 12), "largest-area insertion must remain collision free");

const countdownHelpers = JamDeckPlugin.countdownHelpers;
assert(countdownHelpers, "countdown helpers must be exported for deterministic fixtures");
assert.strictEqual(countdownHelpers.parse("25"), 1500, "a single countdown field must mean minutes");
assert.strictEqual(countdownHelpers.parse("25:00"), 1500, "minute-second countdown input must parse");
assert.strictEqual(countdownHelpers.parse("01:30:05"), 5405, "hour-minute-second countdown input must parse");
assert.strictEqual(countdownHelpers.parse("05:60"), null, "countdown seconds must stay below sixty");
assert.strictEqual(countdownHelpers.parse("00:00"), null, "zero countdown duration must be rejected");
assert.strictEqual(countdownHelpers.format(1500), "25:00", "sub-hour countdowns must use MM:SS");
assert.strictEqual(countdownHelpers.format(5405), "01:30:05", "hour countdowns must use HH:MM:SS");
assert.strictEqual(countdownHelpers.formatClock(5), "00:00:05", "flip countdown must always preserve hour, minute and second groups");
assert.deepStrictEqual(countdownHelpers.parts(5405), { hours: "01", minutes: "30", seconds: "05" }, "countdown editor must split duration into stable two-digit fields");
const countdownFuture = countdownHelpers.state({
  config: { countdownDurationSec: 1500, countdownEnabled: true, countdownEndsAt: 101000 },
}, 100000);
assert.deepStrictEqual(countdownFuture, {
  durationSeconds: 1500,
  endsAt: 101000,
  enabled: true,
  remainingSeconds: 1,
}, "countdown state must derive remaining time from its absolute deadline");

const mediaHelpers = JamDeckPlugin.mediaHelpers;
assert(mediaHelpers, "media helpers must be exported for deterministic fixtures");
assert.strictEqual(mediaHelpers.provider("QQMusic.exe").id, "qqmusic", "QQ Music sessions must use their branded source");
assert.strictEqual(mediaHelpers.provider("cloudmusic.exe").id, "netease", "NetEase sessions must use their branded source");
assert.strictEqual(mediaHelpers.provider("qishui-music.exe").id, "qishui", "Qishui sessions must use their branded source");
assert.strictEqual(mediaHelpers.provider("com.soda.music").id, "qishui", "Qishui's installed Windows application id must use its branded source");
assert.strictEqual(mediaHelpers.formatTime(254533), "4:14", "media time must use stable minute-second formatting");
assert.strictEqual(mediaHelpers.formatTime(-1), "--:--", "invalid media times must not look playable");
assert.strictEqual(mediaHelpers.projectedPosition({
  receivedAt: 1000,
  selected: { playbackStatus: "playing", timeline: { positionMs: 5000, durationMs: 10000 } },
}, 3500), 7500, "visible progress may extrapolate locally between low-frequency snapshots");
assert.strictEqual(mediaHelpers.projectedPosition({
  receivedAt: 1000,
  selected: { playbackStatus: "playing", timeline: { positionMs: 9000, durationMs: 10000 } },
}, 5000), 10000, "projected progress must clamp to the duration");
const mediaBridgeScript = mediaHelpers.bridgeScript();
assert(mediaBridgeScript.includes("$MaxArtworkBytes = 786432"), "GSMTC artwork must be bounded before entering the plugin");
assert(mediaBridgeScript.includes("TryTogglePlayPauseAsync"), "play and pause must stay capability-gated through GSMTC");
assert(mediaBridgeScript.includes("TryChangePlaybackPositionAsync") && mediaBridgeScript.includes("IsPlaybackPositionEnabled"), "seek must stay capability-gated through GSMTC");
assert(mediaBridgeScript.includes("Start-KnownProvider") && mediaBridgeScript.includes("shell:AppsFolder\\"), "app launch must resolve a fixed registered shell item");
assert(mediaBridgeScript.includes("ShellExecute($target, '', '', 'open', 1)"), "registered app activation must use an explicit open action");
assert(mediaBridgeScript.includes("UNKNOWN_PROVIDER") && mediaBridgeScript.includes("APP_NOT_FOUND"), "the launch allowlist must reject unknown or unresolved providers");
assert(mediaBridgeScript.includes("AMBIGUOUS_SESSION"), "same-source multiple sessions must be rejected instead of controlled blindly");
assert(!mediaBridgeScript.includes("ExecutionPolicy") && !mediaBridgeScript.includes("Bypass"), "the media bridge program must not weaken the user's PowerShell policy");
assert(!mediaBridgeScript.includes("$request.payload.path") && !mediaBridgeScript.includes("$request.payload.appId") && !mediaBridgeScript.includes("$request.payload.url"), "launch requests must never accept a caller-provided path, app id, or URL");

const CanvasRuntimeAdapter = JamDeckPlugin.CanvasRuntimeAdapter;
const CanvasReturnCoordinator = JamDeckPlugin.CanvasReturnCoordinator;
assert(CanvasRuntimeAdapter && CanvasReturnCoordinator, "Canvas browser return helpers must be exported for deterministic fixtures");

async function testCanvasNativeConflictLifecycle() {
  const nativeLeaves = [];
  const workspace = {
    activeLeaf: null,
    getLeavesOfType(type) {
      return type === "canvas" ? nativeLeaves : this.deckLeaves || [];
    },
  };
  const adapter = new CanvasRuntimeAdapter({ app: { workspace }, leaf: {} });
  const nativeSensitiveCalls = [];
  const nativeLeaf = {
    view: {
      file: { path: "Boards\\Idea.canvas" },
      saveImmediately() { nativeSensitiveCalls.push("save"); },
      close() { nativeSensitiveCalls.push("close"); },
    },
    unload() { nativeSensitiveCalls.push("unload"); },
    containerEl: { dataset: {} },
  };
  const ownedLeaf = {
    view: { file: { path: "boards/idea.canvas" } },
    containerEl: { dataset: { jamDeckCanvasOwner: "canvas-widget" } },
  };
  nativeLeaves.push(nativeLeaf, ownedLeaf, { view: { file: { path: "Boards/Other.canvas" } }, containerEl: { dataset: {} } });
  assert.deepStrictEqual([...adapter.getNativeCanvasPaths()], ["boards/idea.canvas", "boards/other.canvas"], "native path scan must normalize slash/case and exclude owned detached leaves");
  assert(adapter.hasNativeCanvasDuplicate("./BOARDS\\IDEA.canvas"), "duplicate detection must compare normalized Canvas paths");
  assert.deepStrictEqual(nativeSensitiveCalls, [], "duplicate scans must not call native leaf save/close/unload methods");

  const ownerCalls = [];
  const entry = {
    widgetId: "canvas-widget",
    closing: false,
    nativeConflictSuspended: false,
    leaf: {
      containerEl: {
        isConnected: true,
        remove() { ownerCalls.push("remove"); this.isConnected = false; },
      },
      view: {
        saveImmediately() { ownerCalls.push("save"); },
        close() { ownerCalls.push("close"); },
      },
      unload() { ownerCalls.push("unload"); },
    },
    resizeObserver: { disconnect() { ownerCalls.push("resize-disconnect"); } },
    dropDisposers: [() => ownerCalls.push("drop-listener")],
    linkNavigationBridge: { destroy() { ownerCalls.push("link-listener"); } },
    folderController: { destroy() { ownerCalls.push("folder-listener"); } },
    imageStackController: { destroy() { ownerCalls.push("stack-listener"); } },
    imageSearchController: { destroy() { ownerCalls.push("search-listener"); } },
    inkOverlay: { async destroy() { ownerCalls.push("ink-listener"); } },
    returnEpoch: 0,
    returnParked: false,
  };
  adapter.entries.set(entry.widgetId, entry);
  await adapter.suspendForNativeConflict(entry.widgetId);
  await adapter.suspendForNativeConflict(entry.widgetId);
  assert.strictEqual(ownerCalls.filter((call) => call === "remove").length, 1, "one conflict burst must park the owned leaf once");
  assert(ownerCalls.includes("drop-listener") && ownerCalls.includes("link-listener") && ownerCalls.includes("stack-listener"), "quiet conflict teardown must remove owned Canvas interaction listeners");
  assert(!adapter.entries.has(entry.widgetId), "suspended conflict entries must not retain a live Canvas view");
  assert(!ownerCalls.includes("save") && !ownerCalls.includes("close"), "conflict suspension must never save/close the owned Canvas view");
  assert.strictEqual(ownerCalls.filter((call) => call === "unload").length, 1, "quiet conflict teardown must unload only the owned leaf");

  const timers = new Map();
  let nextTimer = 1;
  const previousWindow = global.window;
  global.window = {
    setTimeout(callback) { const id = nextTimer++; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  try {
    const boardNativeOne = { view: { file: { path: "Work\\Board.canvas" } }, containerEl: { dataset: {} } };
    const boardNativeTwo = { view: { file: { path: "work/board.canvas" } }, containerEl: { dataset: {} } };
    nativeLeaves.splice(0, nativeLeaves.length, boardNativeOne, boardNativeTwo);
    const boardState = { suspended: 0, resumed: 0, flushes: 0 };
    const view = {
      canvasRuntime: new CanvasRuntimeAdapter({ app: { workspace }, leaf: {} }),
      reconcileCanvasNativeConflicts() {
        boardState.flushes++;
        const conflict = nativeLeaves.some((leaf) => this.canvasRuntime.getCanvasViewPath(leaf) === "work/board.canvas");
        if (conflict && !boardState.suspended) { boardState.suspended++; return; }
        if (!conflict && boardState.suspended && !boardState.resumed) boardState.resumed++;
      },
    };
    workspace.deckLeaves = [{ view, detach() {} }];
    const plugin = new JamDeckPlugin();
    plugin.app = { workspace };
    plugin.settings = { widgets: [{ id: "board", type: "canvas-embed", config: { filePath: "Work/Board.canvas" } }] };
    plugin.canvasNativePaths = new Set();
    plugin.canvasNativeConflictTimer = null;
    plugin.canvasNativeConflictReconcilePromise = null;
    plugin.canvasNativeConflictReconcileQueued = false;
    plugin.canvasNativeConflictDisposed = false;
    plugin.musicArtworkUrls = new Map();
    plugin.stopMusicMedia = async () => {};
    for (let index = 0; index < 100; index++) plugin.scheduleCanvasNativeConflictReconcile();
    assert.strictEqual(timers.size, 1, "a 100-event workspace burst must keep one pending conflict timer");
    const runTimer = async () => {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach((callback) => callback());
      while (plugin.canvasNativeConflictReconcilePromise) await plugin.canvasNativeConflictReconcilePromise;
    };
    await runTimer();
    assert.strictEqual(boardState.suspended, 1, "the first native conflict flush must suspend once");
    nativeLeaves.shift();
    plugin.scheduleCanvasNativeConflictReconcile();
    await runTimer();
    assert.strictEqual(boardState.resumed, 0, "closing one of two native leaves must not resume the embed");
    nativeLeaves.shift();
    plugin.scheduleCanvasNativeConflictReconcile();
    await runTimer();
    assert.strictEqual(boardState.resumed, 1, "closing the last native leaf must resume exactly once");
    assert.strictEqual(boardState.suspended + boardState.resumed, 2, "the stable conflict set must produce at most two reconciliation flushes");
    assert(boardState.flushes <= 2, "the burst and multi-leaf close sequence must flush reconciliation no more than twice");

    nativeLeaves.push({ view: { file: { path: "Other.canvas" } }, containerEl: { dataset: {} } });
    assert(!view.canvasRuntime.hasNativeCanvasDuplicate("Work/Board.canvas"), "a native Canvas on another path must not re-conflict the board embed");
    plugin.canvasNativeConflictDisposed = false;
    plugin.scheduleCanvasNativeConflictReconcile();
    assert.strictEqual(timers.size, 1, "a different Canvas path may queue one isolated flush");
    plugin.onunload();
    assert.strictEqual(timers.size, 0, "plugin unload must cancel queued conflict callbacks");
    await Promise.resolve();
    assert.strictEqual(boardState.resumed, 1, "unload must not run another resume callback");
  } finally {
    global.window = previousWindow;
  }
}

async function testCanvasCreateName() {
  assert.strictEqual(JamDeckPlugin.nextCanvasFileName(() => false), "未命名.canvas", "free name must stay bare");
  assert.strictEqual(
    JamDeckPlugin.nextCanvasFileName((candidate) => candidate === "未命名.canvas"),
    "未命名 1.canvas",
    "first occupied name must bump to 1"
  );
  assert.strictEqual(
    JamDeckPlugin.nextCanvasFileName((candidate) => candidate === "未命名.canvas" || candidate === "未命名 1.canvas"),
    "未命名 2.canvas",
    "two occupied names must bump to 2"
  );
}

async function testCanvasAsyncTeardown() {
  let releaseDrop;
  const dropGate = new Promise((resolve) => { releaseDrop = resolve; });
  let createNodeCalls = 0;
  let requestSaveCalls = 0;
  let saveImmediatelyCalls = 0;
  const canvas = {
    createFileNode() { createNodeCalls++; return { id: "late-node" }; },
    requestSave() { requestSaveCalls++; },
  };
  const workspace = { activeLeaf: null };
  const runtime = new CanvasRuntimeAdapter({ app: {
    workspace,
    vault: { getAbstractFileByPath: () => null },
  }, leaf: {} });
  const entry = {
    widgetId: "async-drop",
    token: 1,
    closing: false,
    nativeConflictSuspended: false,
    leaf: {
      view: { canvas, saveImmediately() { saveImmediatelyCalls++; } },
      containerEl: { isConnected: true, remove() { this.isConnected = false; } },
      unload() {},
    },
    hostEl: null,
    ownerDocument: {},
    dropDisposers: [],
    dropOperations: new Map(),
    activeDropOperation: null,
    returnEpoch: 0,
    returnParked: false,
  };
  runtime.entries.set(entry.widgetId, entry);
  const operation = {
    id: "drop-async",
    entryToken: entry.token,
    controller: new AbortController(),
    inserted: false,
    committed: false,
    node: null,
    createdPath: null,
    createdFile: null,
  };
  entry.dropOperations.set(operation.id, operation);
  operation.promise = runtime.commitCanvasImageDrop(
    entry,
    canvas,
    async (signal) => {
      await dropGate;
      assert(signal.aborted, "destroy must abort the pending Canvas drop before attachment completion");
      return { path: null, file: {} };
    },
    { x: 0, y: 0 },
    operation,
  );
  const suspend = runtime.suspendForNativeConflict(entry.widgetId);
  await Promise.resolve();
  assert.strictEqual(createNodeCalls, 0, "suspending a pending drop must prevent late Canvas node creation");
  releaseDrop();
  await suspend;
  await operation.promise;
  assert.strictEqual(requestSaveCalls, 0, "suspending a pending drop must prevent requestSave after abort");
  assert.strictEqual(saveImmediatelyCalls, 0, "suspending a pending drop must prevent saveImmediately after abort");

  let releaseSearch;
  const searchGate = new Promise((resolve) => { releaseSearch = resolve; });
  let searchCreateCalls = 0;
  const searchCanvas = {
    createFileNode() { searchCreateCalls++; return { id: "search-node" }; },
    requestSave() { requestSaveCalls++; },
    nodes: { values: () => [] },
  };
  const sourceFile = { path: "source.png", name: "source.png", extension: "png" };
  const app = {
    vault: {
      getAbstractFileByPath: () => sourceFile,
      async readBinary() { await searchGate; return new Uint8Array([1, 2, 3]); },
    },
  };
  const searchEntry = {
    closing: false,
    nativeConflictSuspended: false,
    leaf: { view: { canvas: searchCanvas }, containerEl: null },
    ownerDocument: {},
  };
  const searchRuntime = { deckView: { app } };
  const search = new JamDeckPlugin.CanvasImageSearchController(searchRuntime, searchEntry);
  const searchNode = { getData: () => ({ file: sourceFile.path, x: 0, y: 0, width: 100, height: 100 }) };
  const searchPromise = search.performSearch(searchNode);
  await Promise.resolve();
  const searchDestroy = search.destroy();
  releaseSearch();
  await searchDestroy;
  await searchPromise;
  assert.strictEqual(searchCreateCalls, 0, "destroyed Eagle search must not insert a late Canvas node");
  assert.strictEqual(search.destroyed, true, "image search destroy must stay terminal after async abort");
}

{
  const bridgeScript = JamDeckPlugin.canvasLinkBridgeScript;
  assert.strictEqual(typeof bridgeScript, "function", "Canvas same-frame injection script must be exported for fixtures");
  let clickListener = null;
  const assigned = [];
  const context = {
    URL,
    document: {
      addEventListener(type, listener) { if (type === "click") clickListener = listener; },
      removeEventListener(type, listener) { if (type === "click" && clickListener === listener) clickListener = null; },
    },
    location: {
      href: "https://www.bilibili.com/",
      assign(url) { assigned.push(url); },
    },
  };
  context.window = context;
  assert.strictEqual(vm.runInNewContext(bridgeScript("install"), context), "installed");
  assert.strictEqual(vm.runInNewContext(bridgeScript("install"), context), "installed", "repeated injection must remain idempotent");
  const anchor = {
    tagName: "A",
    getAttribute(name) {
      if (name === "target") return "_blank";
      if (name === "href") return "/video/BV1test";
      return null;
    },
    hasAttribute(name) { return name === "download" ? false : false; },
  };
  let prevented = false;
  clickListener({
    isTrusted: true,
    defaultPrevented: false,
    button: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    composedPath: () => [anchor],
    preventDefault() { prevented = true; },
  });
  assert(prevented, "plain trusted target-blank links must suppress the external window");
  assert.deepStrictEqual(assigned, ["https://www.bilibili.com/video/BV1test"], "target-blank links must navigate the current Canvas web surface");
  clickListener({
    isTrusted: true,
    defaultPrevented: false,
    button: 0,
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    composedPath: () => [anchor],
    preventDefault() { throw new Error("modifier links must stay native"); },
  });
  assert.strictEqual(assigned.length, 1, "modifier clicks must not be redirected into the Canvas frame");
  assert.strictEqual(vm.runInNewContext(bridgeScript("cleanup"), context), "cleaned");
  assert.strictEqual(clickListener, null, "bridge cleanup must remove the child-document listener");
}

function createReturnFixture() {
  let documentFocused = false;
  let nextHandle = 1;
  const timers = new Map();
  const frames = new Map();
  const listeners = [];
  const document = {
    activeElement: null,
    visibilityState: "visible",
    addEventListener(type, listener, capture) { listeners.push(["add", "document", type, listener, capture]); },
    removeEventListener(type, listener, capture) { listeners.push(["remove", "document", type, listener, capture]); },
    hasFocus() { return documentFocused; },
  };
  const ownerWindow = {
    document,
    addEventListener(type, listener, capture) { listeners.push(["add", "window", type, listener, capture]); },
    removeEventListener(type, listener, capture) { listeners.push(["remove", "window", type, listener, capture]); },
    setTimeout(callback) {
      const id = nextHandle++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(callback) {
      const id = nextHandle++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) { frames.delete(id); },
  };
  document.defaultView = ownerWindow;
  const runTimers = () => {
    const pending = [...timers.values()];
    timers.clear();
    pending.forEach((callback) => callback());
  };
  const runFrames = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback());
  };
  const hostLeaf = { id: "jam-deck-host" };
  const otherLeaf = { id: "other-leaf" };
  const activeCalls = [];
  const workspace = {
    activeLeaf: hostLeaf,
    setActiveLeaf(leaf, options) {
      activeCalls.push({ leaf, options });
      this.activeLeaf = leaf;
    },
  };
  const adapter = new CanvasRuntimeAdapter({ app: { workspace }, leaf: hostLeaf });
  const frame = {
    nodeType: 1,
    focusCalls: 0,
    matches(selector) { return selector.includes("iframe"); },
    closest() { return null; },
    focus() { this.focusCalls += 1; },
  };
  const content = {
    nodeType: 1,
    matches() { return false; },
    closest() { return null; },
  };
  const container = {
    nodeType: 1,
    isConnected: true,
    contains(node) { return node === frame || node === content; },
  };
  const entry = {
    widgetId: "canvas-browser",
    ownerDocument: document,
    hostEl: { isConnected: true },
    leaf: { containerEl: container },
    closing: false,
    returnEpoch: 0,
    returnParked: false,
  };
  adapter.entries.set(entry.widgetId, entry);
  const coordinator = new CanvasReturnCoordinator(adapter, ownerWindow);
  coordinator.addEntry(entry);
  return {
    adapter,
    coordinator,
    document,
    frame,
    content,
    entry,
    workspace,
    hostLeaf,
    otherLeaf,
    activeCalls,
    listeners,
    runTimers,
    runFrames,
    setDocumentFocus(value) { documentFocused = value; },
  };
}

{
  const fixture = createReturnFixture();
  fixture.document.activeElement = fixture.frame;
  fixture.setDocumentFocus(false);
  fixture.coordinator.handleWindowBlur();
  fixture.runTimers();
  assert(fixture.coordinator.away, "a real window departure from a focused Canvas iframe must arm recovery");
  fixture.workspace.activeLeaf = fixture.otherLeaf;
  fixture.setDocumentFocus(true);
  fixture.coordinator.handleWindowFocus();
  fixture.runTimers();
  fixture.runFrames();
  assert.strictEqual(fixture.activeCalls.length, 1, "external browser return must reaffirm the host exactly once");
  assert.strictEqual(fixture.activeCalls[0].leaf, fixture.hostLeaf);
  assert.deepStrictEqual(fixture.activeCalls[0].options, { focus: false }, "return recovery must never request DOM focus");
  assert.strictEqual(fixture.frame.focusCalls, 0, "return recovery must not steal focus into the iframe");
  fixture.coordinator.destroy();
  assert(fixture.listeners.some(([action, owner, type]) => action === "remove" && owner === "window" && type === "focus"), "destroy must remove the shared window focus listener");
}

{
  const fixture = createReturnFixture();
  fixture.coordinator.handleDocumentInteraction({ type: "pointerdown", target: fixture.content, isTrusted: true });
  fixture.workspace.activeLeaf = fixture.otherLeaf;
  fixture.setDocumentFocus(false);
  fixture.coordinator.handleWindowBlur();
  fixture.runTimers();
  assert(fixture.coordinator.away, "a native Canvas DOM link click must arm recovery even after the active leaf drifts");
  fixture.setDocumentFocus(true);
  fixture.coordinator.handleWindowFocus();
  fixture.runTimers();
  fixture.runFrames();
  assert.strictEqual(fixture.activeCalls.length, 1, "a native Canvas DOM link return must reaffirm the visible host once");
  assert.strictEqual(fixture.activeCalls[0].leaf, fixture.hostLeaf);
  assert.deepStrictEqual(fixture.activeCalls[0].options, { focus: false });
  fixture.coordinator.destroy();
}

{
  const fixture = createReturnFixture();
  fixture.coordinator.handleDocumentInteraction({ type: "pointerdown", target: fixture.entry.leaf.containerEl, isTrusted: true });
  fixture.setDocumentFocus(false);
  fixture.coordinator.handleWindowBlur();
  fixture.runTimers();
  assert.strictEqual(fixture.coordinator.away, null, "the detached leaf root itself must not arm native link recovery");
  fixture.coordinator.destroy();
}

{
  const fixture = createReturnFixture();
  fixture.coordinator.handleDocumentInteraction({ type: "pointerdown", target: fixture.content, isTrusted: true });
  fixture.coordinator.handleDocumentInteraction({ type: "pointerdown", target: {}, isTrusted: true });
  fixture.setDocumentFocus(false);
  fixture.coordinator.handleWindowBlur();
  fixture.runTimers();
  assert.strictEqual(fixture.coordinator.away, null, "trusted input outside the Canvas must cancel a recent native link candidate");
  fixture.coordinator.destroy();
}

{
  const fixture = createReturnFixture();
  fixture.document.activeElement = fixture.frame;
  fixture.setDocumentFocus(false);
  fixture.coordinator.handleWindowBlur();
  fixture.runTimers();
  fixture.coordinator.handleDocumentInteraction({ type: "pointerdown", target: {}, isTrusted: true });
  fixture.setDocumentFocus(true);
  fixture.coordinator.handleWindowFocus();
  fixture.runTimers();
  fixture.runFrames();
  assert.strictEqual(fixture.activeCalls.length, 0, "a competing user interaction after return must cancel Canvas recovery");
  fixture.coordinator.destroy();
}

{
  const fixture = createReturnFixture();
  fixture.document.activeElement = fixture.frame;
  fixture.setDocumentFocus(true);
  fixture.coordinator.handleWindowBlur();
  fixture.runTimers();
  assert.strictEqual(fixture.coordinator.away, null, "moving focus into an iframe without leaving Obsidian must not arm recovery");
  fixture.coordinator.destroy();
}

const stackGeometry = JamDeckPlugin.canvasStackGeometry;
assert(stackGeometry, "Canvas stack geometry helpers must be exported for deterministic fixtures");
const folderGeometry = JamDeckPlugin.canvasFolderGeometry;
assert(folderGeometry, "Canvas folder geometry helpers must be exported for deterministic fixtures");
assert.strictEqual(folderGeometry.schemaVersion, 1, "Canvas folder schema version must stay explicit");
assert.strictEqual(folderGeometry.maxRepresentatives, 4, "Canvas folders must cap representatives at four");
assert.strictEqual(typeof folderGeometry.representativeSlot, "function", "Canvas folder geometry must expose authored Figma representative slots");
assert(Array.isArray(folderGeometry.colors) && folderGeometry.colors.length === 6, "Canvas folders must expose six restrained color presets");
assert(folderGeometry.colors.every((color) => /^#[0-9a-f]{6}$/i.test(color)), "Canvas folder colors must be deterministic six-digit colors");

// Folder schema is deliberately a pure, portable record.  Invalid payloads
// are ignored or normalized instead of leaking runtime-only state into Canvas.
assert.strictEqual(folderGeometry.schema(null), null, "missing Canvas node data must not parse as a folder");
assert.strictEqual(folderGeometry.schema({ id: "plain-node", type: "text" }), null, "nodes without jamdeck folder metadata must stay ungrouped");
assert.strictEqual(folderGeometry.schema({ id: "fallback", jamdeck: { folderId: "folder-fallback" } }).memberIds[0], "fallback", "legacy folderId metadata must still infer the node member");
const parsedFolder = folderGeometry.schema({
  id: "anchor",
  type: "file",
  file: "Board.canvas",
  jamdeck: {
    folder: {
      id: "folder-alpha",
      version: "not-a-number",
      anchorId: "anchor",
      memberIds: ["zeta", "anchor", "alpha", "overflow", "four", "five", "zeta", ""],
      collapsed: 0,
      color: "#not-a-preset",
      layoutMode: "grid",
      representativeIds: ["zeta", "alpha", "overflow", "four", "five"],
      representativeColumns: 99,
    },
  },
});
assert.deepStrictEqual(parsedFolder.memberIds, ["alpha", "anchor", "five", "four", "overflow", "zeta"], "folder members must be unique and stable-sorted");
assert.strictEqual(parsedFolder.version, 1, "invalid folder versions must fall back to the current schema");
assert.strictEqual(parsedFolder.collapsed, false, "folder booleans must normalize through Boolean semantics");
assert.strictEqual(parsedFolder.color, folderGeometry.colors[0], "unknown folder colors must use the first preset");
assert.strictEqual(
  folderGeometry.schema({ id: "legacy-blue", jamdeck: { folder: { id: "legacy", color: "#8EAFCC" } } }).color,
  "#F7BDB1",
  "the 0.19.0 blue-gray folder color must migrate to the NZS4 light red preset",
);
assert.strictEqual(
  folderGeometry.schema({ id: "legacy-0286", jamdeck: { folder: { id: "legacy2", color: "#DDDCDC" } } }).color,
  "#C1C1C1",
  "the 0.28.6 neutral folder color must migrate to the NZS4 paper gray preset",
);
assert.strictEqual(
  folderGeometry.schema({ id: "default-color", jamdeck: { folder: { id: "default" } } }).color,
  "#C1C1C1",
  "new folders must default to the NZS4 paper gray preset",
);
assert.strictEqual(parsedFolder.layoutMode, "grid", "grid layout mode must survive schema parsing");
assert.deepStrictEqual(parsedFolder.representativeIds, ["alpha", "five", "four", "overflow"], "representatives must be stable-sorted and capped at four");
assert.strictEqual(parsedFolder.representativeColumns, 2, "folder representative columns must clamp to the two-column maximum");
assert.strictEqual(folderGeometry.schema({ id: "legacy", jamdeck: { folderId: "f" } }).layoutMode, "stack", "legacy folders must default to stack layout");

const stableFolderId = folderGeometry.stableId(["zeta", "alpha", "alpha", ""], "canvas-salt");
assert.strictEqual(stableFolderId, folderGeometry.stableId(["alpha", "zeta"], "canvas-salt"), "folder IDs must ignore member order and duplicates");
assert.notStrictEqual(stableFolderId, folderGeometry.stableId(["alpha", "zeta"], "other-salt"), "folder ID salts must partition otherwise equal memberships");
assert.strictEqual(folderGeometry.stableId([], "canvas-salt"), null, "empty folder membership must not receive an ID");
assert.deepStrictEqual(
  folderGeometry.memberSort([{ id: "zeta" }, { id: "anchor" }, { id: "alpha" }], "anchor").map((item) => item.id),
  ["anchor", "alpha", "zeta"],
  "folder member sorting must pin the anchor then use lexical IDs",
);
assert.deepStrictEqual(
  folderGeometry.representatives(["zeta", "anchor", "alpha", "beta", "gamma"], "anchor").map((item) => item),
  ["anchor", "alpha", "beta", "gamma"],
  "folder representatives must be stable and limited to four members",
);
assert.strictEqual(folderGeometry.representativeColumns(["a"]), 1, "one representative must use one column");
assert.strictEqual(folderGeometry.representativeColumns(["a", "b"]), 2, "two or more representatives must use two columns");
assert.strictEqual(folderGeometry.representativeColumns(["a", "b", "c", "d"]), 2, "two-to-four representatives must use two columns");
assert.strictEqual(folderGeometry.representativeColumns(["a", "b", "c", "d", "e"]), 2, "five-or-more collapsed representatives must remain within two columns");
assert.strictEqual(folderGeometry.representativeColumns(["a", "b", "c", "d", "e", "f"]), 2, "six collapsed representatives must remain within two columns");
assert.strictEqual(folderGeometry.representativeSlot({ left: 0, top: 0, width: 200, height: 150 }, 0, 0), null, "zero representatives must leave the authored preview slots empty");
const authoredTwoSlots = [0, 1].map((index) => folderGeometry.representativeSlot({ left: 0, top: 0, width: 200, height: 150 }, 2, index));
assert.deepStrictEqual(
  authoredTwoSlots.map((slot) => ({ x: slot.left, y: slot.top, width: slot.width, height: slot.height, rotate: slot.rotate })),
  [
    { x: 4.741, y: 18.745, width: 95.518, height: 67.103, rotate: -4.6 },
    { x: 103.451, y: 5, width: 93.039, height: 63.139, rotate: 2 },
  ],
  "two representatives must match the authored left/right visual bounds and angles",
);
const authoredThreeSlot = folderGeometry.representativeSlot({ left: 0, top: 0, width: 200, height: 150 }, 3, 2);
assert.deepStrictEqual(
  { x: authoredThreeSlot.left, y: authoredThreeSlot.top, width: authoredThreeSlot.width, height: authoredThreeSlot.height, contentWidth: authoredThreeSlot.contentWidth, contentHeight: authoredThreeSlot.contentHeight, rotate: authoredThreeSlot.rotate },
  { x: 14.997, y: 23.384, width: 105.773, height: 73.116, contentWidth: 102.363, contentHeight: 67.852, rotate: 3 },
  "three representatives must add the authored lower-left card",
);
const authoredFourSlot = folderGeometry.representativeSlot({ left: 0, top: 0, width: 200, height: 150 }, 4, 3);
assert.deepStrictEqual(
  { x: authoredFourSlot.left, y: authoredFourSlot.top, width: authoredFourSlot.width, height: authoredFourSlot.height, rotate: authoredFourSlot.rotate },
  { x: 101.357, y: 18.176, width: 93.039, height: 63.139, rotate: -2 },
  "four representatives must add the authored second right card",
);
const authoredFallback = folderGeometry.representativeSlot({ left: 10, top: 20, width: 200, height: 150 }, 1, 0);
assert.deepStrictEqual(
  { x: authoredFallback.visualLeft, y: authoredFallback.visualTop, width: authoredFallback.contentWidth, height: authoredFallback.contentHeight, rotate: authoredFallback.rotate },
  { x: 64.5, y: 32, width: 91, height: 60, rotate: 0 },
  "one representative must use the safe centered fallback slot",
);
assert.strictEqual(folderGeometry.expansionColumns(["a", "b"]), 2, "two expanded members must use two columns");
assert.strictEqual(folderGeometry.expansionColumns(["a", "b", "c", "d"]), 2, "four expanded members must use two columns");
assert.strictEqual(folderGeometry.expansionColumns(["a", "b", "c", "d", "e"]), 3, "five expanded members must use three columns");
assert.strictEqual(folderGeometry.expansionColumns(["a", "b", "c", "d", "e", "f"]), 3, "six expanded members must use three columns");

assert.strictEqual(folderGeometry.path(" ./Boards\\Idea//NOTE.MD "), "boards/idea/note.md", "Canvas folder paths must normalize separators, dot prefixes, case, and duplicate slashes");
assert(folderGeometry.pathEquivalent("./Boards\\Idea.canvas", "boards/idea.canvas"), "equivalent Canvas paths must compare equal");
assert(folderGeometry.pathEquivalent({ file: "Boards/Idea.canvas", subpath: "#设计" }, { file: "boards\\idea.canvas", subpath: "#设计" }), "path equivalence must accept Canvas link records");
assert(!folderGeometry.pathEquivalent({ file: "Boards/Idea.canvas", subpath: "#设计" }, { file: "Boards/Idea.canvas", subpath: "#实现" }), "different Canvas subpaths must remain distinct");
assert(!folderGeometry.pathEquivalent("", "Boards/Idea.canvas"), "empty Canvas paths must never compare equal");
assert.strictEqual(folderGeometry.dataKey({ type: "file", file: "./Boards\\Idea.canvas", subpath: "#设计" }), "file\nboards/idea.canvas\n#设计", "Canvas folder data keys must combine type, normalized file, and subpath");
assert.strictEqual(folderGeometry.dataKey(null), "", "missing Canvas node data must have an empty data key");

const folderBounds = folderGeometry.bounds([
  { id: "wide", rect: { x: -30, y: 10, width: 240, height: 60 } },
  { id: "tall", x: 90, y: -40, width: 80, height: 260 },
  { id: "small", x: 400, y: 100, width: 40, height: 30 },
]);
assert.deepStrictEqual(folderBounds, { x: -30, y: -40, width: 470, height: 260 }, "folder bounds must cover heterogeneous member geometry");
const gridItems = [
  { id: "wide", x: 0, y: 0, width: 500, height: 100 },
  { id: "tall", x: 0, y: 0, width: 80, height: 300 },
  { id: "square", x: 0, y: 0, width: 160, height: 160 },
  { id: "small", x: 0, y: 0, width: 90, height: 60 },
  { id: "note", x: 0, y: 0, width: 260, height: 180 },
];
const wideGrid = folderGeometry.gridLayout(gridItems, { x: 100, y: 200, width: 1200, height: 300 }, {
  gap: 16,
  columns: folderGeometry.expansionColumns(gridItems),
});
assert(wideGrid && wideGrid.columns === 3, "five-or-more folder members must use three expanded columns");
assert.strictEqual(wideGrid.rows, 2, "five folder members in three columns must produce two rows");
assert.strictEqual(wideGrid.gap, 16, "folder grid gap must remain explicit");
for (let left = 0; left < wideGrid.positions.length; left++) {
  for (let right = left + 1; right < wideGrid.positions.length; right++) {
    assert.strictEqual(stackGeometry.intersectionArea(wideGrid.positions[left], wideGrid.positions[right]), 0, "heterogeneous folder grid members must not overlap");
  }
}
const firstCellWidth = (1200 - 16 * (wideGrid.columns - 1)) / wideGrid.columns;
const firstCellHeight = Math.max(96, Math.min(300 / wideGrid.rows, 300));
const firstPosition = wideGrid.positions[0];
assert(Math.abs(firstPosition.x + firstPosition.width / 2 - (100 + firstCellWidth / 2)) < 0.02, "folder grid members must preserve each cell center on the x axis");
assert(Math.abs(firstPosition.y + firstPosition.height / 2 - (200 + firstCellHeight / 2)) < 0.02, "folder grid members must preserve each cell center on the y axis");
assert.strictEqual(folderGeometry.gridLayout([], folderBounds), null, "empty folder grids must not produce a layout");

// Static controller contracts protect the Canvas lifecycle and interaction
// path even when Obsidian's private Canvas DOM is unavailable in CI.
const folderControllerSourceStart = pluginSource.indexOf("class CanvasFolderController");
const folderControllerSourceEnd = pluginSource.indexOf("class CanvasImageSearchController", folderControllerSourceStart);
const stackControllerSourceStart = pluginSource.indexOf("class CanvasImageStackController");
const stackControllerSource = pluginSource.slice(stackControllerSourceStart, folderControllerSourceStart);
const stackShowPreviewSource = stackControllerSource.slice(stackControllerSource.indexOf("showPreview(cluster)"), stackControllerSource.indexOf("buildPreviewVisuals(cluster"));
assert(folderControllerSourceStart >= 0 && folderControllerSourceEnd > folderControllerSourceStart, "Canvas folder controller must remain a standalone runtime class");
const folderControllerSource = pluginSource.slice(folderControllerSourceStart, folderControllerSourceEnd);
for (const className of [
  "is-jam-deck-folder-member",
  "is-jam-deck-folder-anchor",
  "is-jam-deck-folder-collapsed",
  "is-jam-deck-folder-expanded",
]) assert(folderControllerSource.includes(className), `folder reconciliation must manage ${className}`);
assert(folderControllerSource.includes("getSelectedItems()"), "folder drag and selection toolbar must share Canvas selection discovery");
assert(folderControllerSource.includes("const schema = jamDeckCanvasFolderSchema(item.data)"), "folder drag state must read the canonical folder schema");
assert(folderControllerSource.includes("this.createFolder(selected)"), "selection toolbar must use the same folder service as drag grouping");
assert(folderControllerSource.includes("this.layoutSelectionGrid(selected)"), "selection toolbar grid action must use the shared folder geometry service");
assert(folderControllerSource.includes("jamDeckCanvasFolderExpansionColumns"), "expanded folder layout must use the independent expansion column policy");
const toolbarActions = [...folderControllerSource.matchAll(/ensureToolbarButton\(menu, "([^"]+)"/g)].map((match) => match[1]);
assert.deepStrictEqual(toolbarActions, ["stack", "grid"], "Canvas selection toolbar must expose exactly stack and grid folder actions");
assert(folderControllerSource.includes('ensureToolbarButton(menu, "grid", "网格排列", "layout-grid"'), "Canvas grid action must use an Obsidian-supported Lucide icon");
assert(folderControllerSource.includes('data-folder-action="${id}"'), "folder toolbar buttons must carry a stable action data attribute");
assert(folderControllerSource.includes("selection.length > 1 && selection.some"), "multi-selection must yield to native Canvas selection drag behavior");
assert(folderControllerSource.includes("finishDrop(drag)"), "hand drag release must finish through the folder membership service");
assert(folderControllerSource.includes("mutateNodes(changes)"), "hand drag and toolbar grouping must commit through one node mutation service");
assert(folderControllerSource.includes("renderFolderRepresentatives(view, group)"), "collapsed folders must render their representative proxies into the shell");
assert(folderControllerSource.includes("createFolderProxySurface(member)"), "folder representatives must use one sanitized read-only proxy path");
assert(folderControllerSource.includes('surface.querySelectorAll("script, iframe, object, embed, form, button, input, textarea, select, video, audio, source")'), "folder proxy sanitization must remove active embedded content");
assert(folderControllerSource.includes('nodeEl.addClass("is-jam-deck-folder-proxy-hidden")'), "collapsed folders must yield native nodes to owned proxy presentation");
assert(!folderControllerSource.includes('nodeEl.style.zIndex =') && !folderControllerSource.includes('nodeEl.style.position ='), "folder presentation must not overwrite native node stacking styles");
assert(stackControllerSource.includes("ownedPreviewOnly") && stackControllerSource.includes("this.overlay.contains(mutation.target)"), "preview-owned DOM mutations must not rerun the quadratic stack reconciler");
assert(folderControllerSource.includes("stackOverlay.contains(mutation.target)"), "folder reconciliation must ignore stack-preview mount and cleanup mutations");
assert(stackControllerSource.includes("const explicitFolder = Boolean(cluster && cluster.folderId)") && stackControllerSource.includes("explicitFolder ? 0 : 64"), "explicit folder previews must only displace nodes actually covered by the opened cards");
assert(stackControllerSource.includes("jamdeck.folderId || jamdeck.folder || jamdeck.folderGroupId") && stackControllerSource.includes('classList.contains("is-jam-deck-folder-proxy-hidden")'), "explicit folder displacement must skip hidden folder-owned Canvas nodes");
assert(stackShowPreviewSource.indexOf("const previewBystanders = this.prepareBystanders") < stackShowPreviewSource.indexOf("this.overlay.appendChild(wrapper)"), "preview geometry reads must finish before mounting the overlay");
assert(stackControllerSource.includes("const folderSource = cluster && cluster.folderId ? visual.source : null"), "folder cards must return to their visible proxy source instead of hidden native-node geometry");
assert(stackControllerSource.includes("Number(target.x) || 0") && stackControllerSource.includes("returnLeft - targetLeft"), "preview collapse must convert layout x/y into finite return offsets instead of emitting NaNpx");

// Folder schema and runtime contracts stay deliberately separate: the portable
// fields are persisted on the anchor Canvas node, while anchorNodeId,
// transitions, keyed DOM views and focus requests remain runtime-only.  Schema
// v1 gained five optional native-group fields (native/label/nativeGroupId/
// positions/stacked) that legacy folders simply omit.
assert.deepStrictEqual(
  Object.keys(parsedFolder).filter((key) => key !== "version").sort(),
  ["anchorId", "collapsed", "color", "id", "layoutMode", "memberIds", "native", "label", "nativeGroupId", "positions", "stacked", "hiddenEdges", "representativeColumns", "representativeIds"].sort(),
  "schema v1 must keep exactly fourteen portable folder fields besides version",
);
assert.strictEqual(parsedFolder.native, false, "legacy folders must default to the non-native preview mode");
assert.strictEqual(parsedFolder.label, "文件夹", "legacy folders must default to the 文件夹 label");
assert.strictEqual(folderGeometry.schema({ id: "n", jamdeck: { folder: { id: "f", native: true, label: "参考", positions: { n: { x: 1, y: 2, width: 100, height: 80 } }, stacked: { n: { x: 5, y: 6, width: 40, height: 30 } } } } }).label, "参考", "native folder labels must survive schema parsing");
assert.strictEqual(folderGeometry.schema({ id: "n", jamdeck: { folder: { id: "f", native: true } } }).native, true, "native flag must survive schema parsing");
assert.strictEqual(folderGeometry.schema({ id: "n", jamdeck: { folder: { id: "f", positions: { n: { x: 1, y: 2, width: 100, height: 80 } } } } }).positions.n.width, 100, "folder expanded positions must parse authored member rectangles");
assert.strictEqual(folderGeometry.schema({ id: "n", jamdeck: { folder: { id: "f", stacked: { n: { x: 1, y: 2, width: 0, height: 0 } } } } }).stacked, null, "invalid stacked rectangles must be dropped");
assert(folderControllerSource.includes("anchorNodeId"), "folder runtime groups must expose an anchorNodeId alias");
for (const state of ["collapsed", "opening", "expanded", "closing", "destroyed"]) {
  assert(folderControllerSource.includes(`"${state}"`), `folder runtime must model the ${state} lifecycle state`);
}
assert(folderControllerSource.includes("folderPreviewSourceRects(group)"), "folder preview must use stable shell-owned source geometry");
assert(folderControllerSource.includes("this.folderViews.get(String(group.id))"), "folder shells must be keyed by stable folder ID");
assert(folderControllerSource.includes("createFolderView(group)"), "keyed folder rendering must create a view only for new folders");
assert(folderControllerSource.includes("view.dispose()"), "removed keyed folder views must dispose their listeners");
assert(!folderControllerSource.includes("while (this.layer.firstChild)"), "folder reconciliation must not clear the entire overlay layer");
assert(!/reparent(?:Native|Node|Member)/i.test(folderControllerSource), "folder rendering must not reparent native Canvas nodes");
assert(folderControllerSource.includes("sourceRects: this.folderPreviewSourceRects(group)"), "explicit folder clusters must pass stable source rects to the stack preview");
assert(pluginSource.includes("const suppliedSourceRects = cluster.sourceRects instanceof Map"), "stack previews must prefer explicit folder source rects over hidden native DOM");
assert(folderControllerSource.includes("JAM_DECK_CANVAS_FOLDER_PREVIEW_CARD_RETURN_MS"), "folder collapse must wait for preview cards to return before closing the flap");
assert(folderControllerSource.includes("isBlockedTarget(event.target)"), "Canvas folder pointer handling must defer to native controls and editors");
assert(folderControllerSource.includes('const threshold = drag.pointerType === "touch" ? 10 : 5'), "folder shell drag must use pointer-specific touch and mouse thresholds");
assert(!folderControllerSource.includes("suppressShellClickUntil"), "folder click suppression must not leak across folder views");
assert(folderControllerSource.includes("view.suppressClickUntil"), "folder shell drag must suppress only its own following click");
assert(folderControllerSource.includes("if (!drag.moved)") && folderControllerSource.includes("this.toggleFolderPreview(drag.group)"), "folder shell no-motion pointerup must proxy the legacy stack preview");
assert(folderControllerSource.includes("this.popoverLayer") && folderControllerSource.includes('setAttribute("role", "radiogroup")') && folderControllerSource.includes('setAttribute("role", "radio")'), "folder color choices must use one leaf-local accessible popover");
assert(folderControllerSource.includes("JAM_DECK_CANVAS_FOLDER_COLORS.slice()") && folderControllerSource.includes("aria-checked"), "folder color popover must expose all six radio choices and the selected state");
assert(folderControllerSource.includes("jam-deck-canvas-folder-color-menu") && folderControllerSource.includes("jam-deck-canvas-folder-count") && folderControllerSource.includes("jam-deck-canvas-folder-label"), "folder shell DOM must expose the styled color menu and quiet metadata hierarchy");
assert(!folderControllerSource.includes("jam-deck-canvas-folder-kicker") && !folderControllerSource.includes("jam-deck-canvas-folder-kicker-icon"), "folder shell metadata must not add a folder icon or kicker row");
assert(folderControllerSource.includes('count.className = "jam-deck-canvas-folder-count"') && folderControllerSource.includes('label.className = "jam-deck-canvas-folder-label"'), "folder count and label must remain independent metadata spans");
assert(folderControllerSource.includes("--jd-folder-tint-strength") && folderControllerSource.includes('=== "#C1C1C1" ? "0%" : "100%"'), "folder tint strength must distinguish the NZS4 neutral from colored presets");
assert.deepStrictEqual(
  folderGeometry.colors,
  ["#C1C1C1", "#F7BDB1", "#F0C5DA", "#EDD0AE", "#BBE0AF", "#AFD0E0"],
  "folder presets must mirror the NZS4 Figma 134:143 board solids in order",
);
assert(pluginSource.includes("JAM_DECK_CANVAS_FOLDER_FRONT_TINTS") && pluginSource.includes("--jd-folder-front-tint"), "folder front panels must carry the NZS4 Figma per-color tints");
assert(styleSource.includes("var(--jd-folder-front-start) 50%, transparent"), "folder front gradient must fade from 50% alpha tint at the top to solid at the bottom");
assert(styleSource.includes("Inter, \"PingFang SC\", \"Microsoft YaHei\", sans-serif"), "folder label and count must use the NZS4 Inter stack");

// Folder focus shares the transient preview path; it must never resurrect the
// retired persisted expanded/collapsed mutation semantics.
const focusMethodStart = folderControllerSource.indexOf("  focusFolder(");
const focusMethodEnd = folderControllerSource.indexOf("\n  layoutSelectionGrid(", focusMethodStart);
const focusMethodSource = folderControllerSource.slice(focusMethodStart, focusMethodEnd);
assert(focusMethodStart >= 0 && focusMethodEnd > focusMethodStart, "folder focus action must remain an explicit controller method");
assert(focusMethodSource.includes("toggleFolderPreview(group)"), "folder focus must use the same transient all-member preview as shell activation");
assert(!focusMethodSource.includes("mutateNodes("), "focus must never mutate Canvas node data");
assert(folderControllerSource.includes('Object.prototype.hasOwnProperty.call(overrides, "collapsed")') && folderControllerSource.includes("return this.toggleFolderPreview(group)"), "persisted expand requests must be redirected to the transient preview path");
const previewFrontStart = folderControllerSource.indexOf("animateFolderPreviewFront(");
const previewFrontSource = folderControllerSource.slice(previewFrontStart, previewFrontStart + 2600);
assert(previewFrontSource.includes('fill: "both"') && previewFrontSource.includes("latest.animation.cancel"), "preview flap WAAPI must cancel its fill:both animation on finish so CSS hover motion is never shadowed");
const activeReconcileStart = folderControllerSource.lastIndexOf("  reconcile()");
const activeReconcileEnd = folderControllerSource.indexOf("\n  destroy()", activeReconcileStart);
const reconcileSource = folderControllerSource.slice(activeReconcileStart, activeReconcileEnd);
assert(!reconcileSource.includes("focusFolder(") && !reconcileSource.includes("consumeFocusRequest("), "reconcile must not focus or consume an unsolicited request");

// Folder metadata is written only into Canvas node data.  It must not route
// through the plugin settings/data.json persistence path.
const folderController = new JamDeckPlugin.CanvasFolderController({}, {});
assert(pluginSource.includes("JAM_DECK_CANVAS_FOLDER_BASE_WIDTH") && pluginSource.includes("JAM_DECK_CANVAS_FOLDER_BASE_HEIGHT"), "collapsed folders must use the explicit 200×150 Figma baseline");
assert(folderControllerSource.includes("screenCenteredBounds") && folderControllerSource.includes("centeredBounds"), "collapsed folder bounds must center the fixed shell on the anchor rather than reuse its aspect ratio");
const folderScreenController = new JamDeckPlugin.CanvasFolderController({}, {});
const folderScreenAnchorEl = {
  getBoundingClientRect: () => ({ left: 320, top: 240, width: 520, height: 80 }),
};
const folderScreenGroup = {
  id: "folder-screen-geometry",
  anchorNodeId: "folder-screen-anchor",
  anchorId: "folder-screen-anchor",
  collapsed: true,
  memberIds: ["folder-screen-anchor"],
  members: [{
    id: "folder-screen-anchor",
    node: { nodeEl: folderScreenAnchorEl },
    rect: { x: 100, y: 200, width: 500, height: 50 },
  }],
};
folderScreenController.root = { getBoundingClientRect: () => ({ left: 100, top: 50 }) };
folderScreenController.canvas = { scale: 1.5 };
const screenFolderBounds = folderScreenController.groupScreenBounds(folderScreenGroup);
assert.deepStrictEqual(screenFolderBounds, { left: 330, top: 117.5, width: 300, height: 225 }, "collapsed folder shell must be 200×150 scaled by Canvas zoom and centered on the anchor screen rect");
const screenRuntime = folderScreenController.getFolderRuntime(folderScreenGroup.id, folderScreenGroup);
screenRuntime.nodeRects.clear();
screenRuntime.lastScreenRect = null;
screenRuntime.lastScreenRectFrame = -1;
folderScreenGroup.members[0].node.nodeEl = {};
const worldFolderBounds = folderScreenController.groupScreenBounds(folderScreenGroup);
assert.deepStrictEqual(worldFolderBounds, { left: 375, top: 225, width: 300, height: 225 }, "collapsed folder fallback must use the anchor world-space centre with the same fixed shell baseline");
// Regression: a native Canvas pointerdown must enter the stack drag path
// without evaluating the folder-only shell transform variables.
const stackNodeEl = {
  addClass: () => {},
  removeClass: () => {},
  style: { setProperty: () => {}, removeProperty: () => {} },
};
const stackNode = {
  id: "stack-event-node",
  nodeEl: stackNodeEl,
  getData: () => ({ id: "stack-event-node", type: "text", text: "event", x: 0, y: 0, width: 100, height: 80 }),
};
const stackTarget = {
  closest: (selector) => selector === ".canvas-node" ? stackNodeEl : null,
};
const stackRoot = {
  contains: () => true,
  hasClass: () => false,
};
const stackWindow = {
  addEventListener: () => {},
  removeEventListener: () => {},
  requestAnimationFrame: () => 1,
  cancelAnimationFrame: () => {},
  setTimeout: () => 0,
  clearTimeout: () => {},
};
const nativeStackEventController = new JamDeckPlugin.CanvasImageStackController({}, {
  leaf: { view: { canvas: { nodes: { values: () => [stackNode] }, selection: null } }, containerEl: stackRoot },
  ownerDocument: { defaultView: stackWindow },
});
assert.doesNotThrow(() => nativeStackEventController.onPointerDown({
  isPrimary: true,
  button: 0,
  target: stackTarget,
  pointerId: 7,
  clientX: 10,
  clientY: 20,
}), "native Canvas stack pointerdown must not throw on an undefined folder shell variable");
assert(nativeStackEventController.drag, "native Canvas stack pointerdown must create a drag record");
if (nativeStackEventController.drag && nativeStackEventController.drag.dispose) nativeStackEventController.drag.dispose();
nativeStackEventController.drag = null;

// Explicit folders proxy their old stack preview interaction while staying
// outside the geometric cluster list used by reconcile().
const explicitMemberA = {
  id: "folder-member-a",
  node: {},
  data: { id: "folder-member-a", type: "text", text: "A", x: 0, y: 0, width: 120, height: 80 },
  rect: { x: 0, y: 0, width: 120, height: 80 },
  kind: "text",
};
const explicitMemberB = {
  id: "folder-member-b",
  node: {},
  data: { id: "folder-member-b", type: "text", text: "B", x: 30, y: 20, width: 120, height: 80 },
  rect: { x: 30, y: 20, width: 120, height: 80 },
  kind: "text",
};
const explicitFolderGroup = {
  id: "folder-preview-test",
  anchor: explicitMemberA,
  anchorId: explicitMemberA.id,
  members: [explicitMemberA, explicitMemberB],
};
let proxiedPreviewCluster = null;
const originalGroupFromId = folderController.groupFromId;
folderController.stack = { togglePreview: (cluster) => { proxiedPreviewCluster = cluster; } };
folderController.groupFromId = () => explicitFolderGroup;
assert.strictEqual(folderController.toggleFolderPreview(explicitFolderGroup), true, "folder shell must proxy preview toggling to the legacy stack controller");
assert(proxiedPreviewCluster && proxiedPreviewCluster.id === "folder:folder-preview-test", "folder preview proxy must use a stable synthetic cluster ID");
assert.strictEqual(proxiedPreviewCluster.members.length, 2, "folder preview proxy must expose every explicit member");
assert.strictEqual(proxiedPreviewCluster.anchor, explicitMemberA, "folder preview proxy must preserve the explicit anchor");
folderController.groupFromId = originalGroupFromId;
folderController.stack = null;

let pointerupPreviewCalls = 0;
const shellPointerupController = new JamDeckPlugin.CanvasFolderController({}, {});
shellPointerupController.ownerWindow = {
  removeEventListener: () => {},
};
shellPointerupController.toggleFolderPreview = () => { pointerupPreviewCalls += 1; };
const shellPointerup = {
  classList: { add: () => {}, remove: () => {} },
  style: {
    left: "0px",
    top: "0px",
    removeProperty: () => {},
  },
  releasePointerCapture: () => {},
};
const shellPointerupView = { generation: 7, suppressClickUntil: 0 };
const unrelatedFolderView = { generation: 9, suppressClickUntil: 0 };
const shellPointerupDrag = {
  pointerId: 11,
  shell: shellPointerup,
  group: explicitFolderGroup,
  startClientX: 20,
  startClientY: 30,
  scale: 1,
  view: shellPointerupView,
  generation: 7,
  baseLeft: 0,
  baseTop: 0,
  moved: false,
  inlineTransform: "",
  move: () => {},
  up: () => {},
  cancel: () => {},
};
shellPointerupController.shellDrag = shellPointerupDrag;
shellPointerupController.finishFolderShellDrag(shellPointerupDrag, { clientX: 20, clientY: 30 }, false);
assert.strictEqual(pointerupPreviewCalls, 1, "a collapsed folder no-motion pointerup must trigger exactly one stack preview toggle");
assert(shellPointerupView.suppressClickUntil > Date.now(), "pointerup preview must suppress only the matching view's synthetic click");
assert.strictEqual(unrelatedFolderView.suppressClickUntil, 0, "one folder gesture must never suppress another folder");

// The stack reconciler must keep a synthetic folder preview alive until the
// folder controller explicitly collapses it, then release the registration.
const externalPreviewController = new JamDeckPlugin.CanvasImageStackController({}, {
  leaf: { view: { canvas: { nodes: { values: () => [] } } }, containerEl: stackRoot },
  ownerDocument: { defaultView: stackWindow },
});
externalPreviewController.previewClusterId = "folder:external";
externalPreviewController.externalPreviewClusters.set("folder:external", { id: "folder:external", members: [explicitMemberA, explicitMemberB] });
let unexpectedExternalCollapse = false;
const nativeCollapsePreview = externalPreviewController.collapsePreview.bind(externalPreviewController);
externalPreviewController.collapsePreview = () => { unexpectedExternalCollapse = true; };
externalPreviewController.reconcile();
assert.strictEqual(unexpectedExternalCollapse, false, "reconcile must not close a live external folder preview");
externalPreviewController.collapsePreview = nativeCollapsePreview;
externalPreviewController.collapsePreview(true);
assert.strictEqual(externalPreviewController.externalPreviewClusters.size, 0, "collapsing a folder preview must release its external cluster registration");

const folderPayloadSource = folderControllerSource.slice(folderControllerSource.indexOf("withFolderPayload("), folderControllerSource.indexOf("folderRecord(", folderControllerSource.indexOf("withFolderPayload(")));
assert(folderPayloadSource.includes("jamdeck.folderId") && folderPayloadSource.includes("jamdeck.folder"), "folder metadata must live under the Canvas node jamdeck payload");
assert(!folderControllerSource.includes("data.json") && !folderControllerSource.includes("runtime.saveData"), "folder controller must not touch plugin data.json settings");
const originalNodeData = { id: "node-meta", type: "file", file: "Assets/Idea.png", custom: { keep: true }, jamdeck: { unrelated: "preserve" } };
const folderRecord = { id: "folder-meta", anchorId: "node-meta", memberIds: ["node-meta", "other"], representativeIds: ["node-meta"], collapsed: true, color: folderGeometry.colors[0], layoutMode: "stack", representativeColumns: 1 };
const folderPayload = folderController.withFolderPayload(originalNodeData, folderRecord.id, folderRecord);
assert.strictEqual(folderPayload.jamdeck.folderId, "folder-meta", "folder member nodes must carry a stable folderId");
assert.deepStrictEqual(folderPayload.jamdeck.folder, folderRecord, "anchor node must carry the canonical folder record");
assert.strictEqual(folderPayload.jamdeck.unrelated, "preserve", "unrelated node jamdeck metadata must survive folder updates");
assert.strictEqual(originalNodeData.jamdeck.folderId, undefined, "folder updates must not mutate the source Canvas node object");
const clearedPayload = folderController.withFolderPayload({ id: "clear-me", jamdeck: { folderId: "old" } }, null, null);
assert.strictEqual(clearedPayload.jamdeck, undefined, "ungrouping the final folder field must remove the empty jamdeck object");

function createAtomicCanvasFixture(dataMap, options = {}) {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  let failNextImport = !!options.failNextImport;
  let failNextSave = !!options.failNextSave;
  let historyPushes = 0;
  let saves = 0;
  const initial = { nodes: [...dataMap.values()].map(clone), edges: [] };
  const history = {
    data: [clone(initial)],
    current: 0,
    push(value) {
      this.data.splice(this.current + 1);
      this.data.push(clone(value));
      this.current = this.data.length - 1;
      historyPushes += 1;
    },
    canUndo() { return this.current > 0; },
    canRedo() { return this.current < this.data.length - 1; },
    undo() { if (!this.canUndo()) return null; this.current -= 1; return clone(this.data[this.current]); },
    redo() { if (!this.canRedo()) return null; this.current += 1; return clone(this.data[this.current]); },
  };
  const canvas = {
    data: clone(initial),
    history,
    requestPushHistory: { run() {}, cancel() {} },
    getData() { return { ...clone(this.data), nodes: [...dataMap.values()].map(clone), edges: [] }; },
    importData(next) {
      const nodes = clone(next.nodes || []);
      dataMap.clear();
      nodes.forEach((node, index) => {
        dataMap.set(String(node.id), node);
        if (failNextImport && index === 0) {
          failNextImport = false;
          throw new Error(options.failureMessage || "simulated folder mutation failure");
        }
      });
    },
    pushHistory(next) { this.history.push(next); },
    setData(next) {
      this.importData(next, true);
      this.data = clone(next);
      this.pushHistory(next);
    },
    updateHistoryUI() {},
    view: { requestSave() { saves += 1; if (failNextSave) { failNextSave = false; throw new Error(options.saveFailureMessage || "simulated Canvas save failure"); } } },
  };
  return { canvas, history, get historyPushes() { return historyPushes; }, get saves() { return saves; } };
}
const successData = new Map([["a", { id: "a", x: 0 }], ["b", { id: "b", x: 10 }]]);
const successNodes = ["a", "b"].map((id) => {
  const node = {
    id,
    getData: () => successData.get(id),
    setData: (next) => successData.set(id, next),
    render: () => {},
  };
  return { id, node, data: successData.get(id), rect: { x: 0, y: 0, width: 100, height: 100 }, kind: "image" };
});
const successAtomic = createAtomicCanvasFixture(successData);
folderController.canvas = successAtomic.canvas;
folderController.getItems = () => successNodes;
folderController.scheduleReconcile = () => {};
assert(folderController.mutateNodes(new Map([
  ["a", { id: "a", x: 1 }],
  ["b", { id: "b", x: 11 }],
])), "Canvas folder mutations must report success");
assert.strictEqual(successAtomic.historyPushes, 1, "one aggregate folder mutation must push exactly one native history state");
assert.strictEqual(successAtomic.saves, 1, "one aggregate folder mutation must request one low-level Canvas save");
assert.strictEqual(successData.get("a").x, 1, "successful Canvas folder mutation must persist node data");
const undoState = successAtomic.history.undo();
assert.strictEqual(undoState.nodes.find((node) => node.id === "a").x, 0, "one undo state must restore the complete pre-mutation Canvas data");
const redoState = successAtomic.history.redo();
assert.strictEqual(redoState.nodes.find((node) => node.id === "b").x, 11, "one redo state must restore the complete aggregate mutation");

const rollbackData = new Map([["a", { id: "a", x: 0 }], ["b", { id: "b", x: 10 }]]);
const rollbackNodes = ["a", "b"].map((id) => ({
  id,
  node: {
    id,
    getData: () => rollbackData.get(id),
    setData: (next) => rollbackData.set(id, next),
    render: () => {},
  },
  data: rollbackData.get(id),
  rect: { x: 0, y: 0, width: 100, height: 100 },
  kind: "image",
}));
const rollbackAtomic = createAtomicCanvasFixture(rollbackData, { failNextImport: true, failureMessage: "simulated folder mutation failure" });
folderController.canvas = rollbackAtomic.canvas;
folderController.getItems = () => rollbackNodes;
assert.throws(() => folderController.mutateNodes(new Map([["a", { id: "a", x: 1 }], ["b", { id: "b", x: 11 }]])), /simulated folder mutation failure/, "failed folder mutations must surface the original error");
assert.strictEqual(rollbackData.get("a").x, 0, "failed folder mutations must restore original Canvas geometry/data");
assert.strictEqual(rollbackAtomic.historyPushes, 0, "failed aggregate mutations must not append an undo state");
assert.strictEqual(rollbackAtomic.history.current, 0, "failed aggregate mutations must restore the visible history cursor");
assert.strictEqual(rollbackAtomic.saves, 1, "failed folder mutations must persist the restored baseline once");

// The selection toolbar's stack→grid action must use the same transaction as
// other folder mutations, including a full rollback when a member write fails.
const gridData = new Map([
  ["grid-a", { id: "grid-a", x: 0, y: 0, width: 120, height: 80, jamdeck: { folderId: "grid-folder" } }],
  ["grid-b", { id: "grid-b", x: 160, y: 0, width: 90, height: 120, jamdeck: { folderId: "grid-folder" } }],
]);
const folderGridItems = ["grid-a", "grid-b"].map((id) => ({
  id,
  node: { id, getData: () => gridData.get(id), setData: (next) => gridData.set(id, next), render: () => {} },
  get data() { return gridData.get(id); },
  rect: id === "grid-a" ? { x: 0, y: 0, width: 120, height: 80 } : { x: 160, y: 0, width: 90, height: 120 },
  kind: "image",
}));
const gridGroup = {
  id: "grid-folder",
  anchor: folderGridItems[0],
  anchorId: "grid-a",
  anchorNodeId: "grid-a",
  members: folderGridItems,
  memberIds: folderGridItems.map((item) => item.id),
  collapsed: true,
  color: folderGeometry.colors[0],
  layoutMode: "stack",
  representativeIds: ["grid-a", "grid-b"],
  representativeColumns: 2,
};
folderController.ownerWindow = { cancelAnimationFrame: () => {} };
folderController.scheduleReconcile = () => {};
folderController.getItems = () => folderGridItems;
folderController.collectGroups = () => [gridGroup];
const gridAtomic = createAtomicCanvasFixture(gridData);
folderController.canvas = gridAtomic.canvas;
assert(folderController.layoutSelectionGrid(folderGridItems), "selection grid action must commit through the folder mutation transaction");
assert.strictEqual(gridData.get("grid-a").jamdeck.folder.layoutMode, "grid", "stack→grid must persist grid layout mode on the anchor record");
assert.strictEqual(gridData.get("grid-b").jamdeck.folderId, "grid-folder", "stack→grid must retain folder membership for every member");
assert.strictEqual(gridAtomic.historyPushes, 1, "stack→grid must create one aggregate native history entry");
assert.strictEqual(gridAtomic.saves, 1, "stack→grid must request one low-level Canvas save");

const gridRollbackData = new Map([
  ["grid-a", { id: "grid-a", x: 0, y: 0, width: 120, height: 80, jamdeck: { folderId: "grid-folder" } }],
  ["grid-b", { id: "grid-b", x: 160, y: 0, width: 90, height: 120, jamdeck: { folderId: "grid-folder" } }],
]);
const gridRollbackItems = ["grid-a", "grid-b"].map((id) => ({
  id,
  node: {
    id,
    getData: () => gridRollbackData.get(id),
    setData: (next) => gridRollbackData.set(id, next),
    render: () => {},
  },
  get data() { return gridRollbackData.get(id); },
  rect: id === "grid-a" ? { x: 0, y: 0, width: 120, height: 80 } : { x: 160, y: 0, width: 90, height: 120 },
  kind: "image",
}));
folderController.getItems = () => gridRollbackItems;
folderController.collectGroups = () => [{ ...gridGroup, anchor: gridRollbackItems[0], members: gridRollbackItems }];
const gridRollbackAtomic = createAtomicCanvasFixture(gridRollbackData, { failNextImport: true, failureMessage: "simulated grid failure" });
folderController.canvas = gridRollbackAtomic.canvas;
assert.throws(() => folderController.layoutSelectionGrid(gridRollbackItems), /simulated grid failure/, "stack→grid failures must surface the original error");
assert.strictEqual(gridRollbackData.get("grid-a").x, 0, "failed stack→grid must restore the first member snapshot");
assert.strictEqual(gridRollbackData.get("grid-a").jamdeck.folderId, "grid-folder", "failed stack→grid must restore folder metadata");

const saveFailureData = new Map([["save-a", { id: "save-a", x: 4 }], ["save-b", { id: "save-b", x: 14 }]]);
const saveFailureAtomic = createAtomicCanvasFixture(saveFailureData, { failNextSave: true, saveFailureMessage: "simulated Canvas save failure" });
folderController.canvas = saveFailureAtomic.canvas;
assert.throws(
  () => folderController.mutateNodes(new Map([["save-a", { id: "save-a", x: 40 }], ["save-b", { id: "save-b", x: 140 }]])),
  /simulated Canvas save failure/,
  "save-stage failures must surface after the aggregate setter",
);
assert.strictEqual(saveFailureData.get("save-a").x, 4, "save-stage rollback must restore complete Canvas data");
assert.strictEqual(saveFailureAtomic.history.data.length, 1, "save-stage rollback must remove the speculative history state");
assert.strictEqual(saveFailureAtomic.history.current, 0, "save-stage rollback must restore the undo cursor");
assert.strictEqual(saveFailureAtomic.saves, 2, "save-stage rollback must retry persistence only for the restored baseline");

const ungroupRecord = {
  id: "ungroup-folder",
  anchorId: "ungroup-a",
  memberIds: ["ungroup-a", "ungroup-b", "ungroup-c"],
  representativeIds: ["ungroup-a", "ungroup-b", "ungroup-c"],
  collapsed: true,
  color: folderGeometry.colors[2],
  layoutMode: "stack",
  representativeColumns: 3,
};
const ungroupData = new Map([
  ["ungroup-a", { id: "ungroup-a", type: "file", x: 100, y: 100, width: 120, height: 80, jamdeck: { folderId: "ungroup-folder", folder: ungroupRecord, unrelated: "keep-a" } }],
  ["ungroup-b", { id: "ungroup-b", type: "file", x: 100, y: 100, width: 90, height: 130, jamdeck: { folderId: "ungroup-folder", unrelated: "keep-b" } }],
  ["ungroup-c", { id: "ungroup-c", type: "text", x: 100, y: 100, width: 150, height: 70, jamdeck: { folderId: "ungroup-folder", stackTextNormalization: { version: 1 } } }],
]);
const ungroupItems = [...ungroupData.keys()].map((id) => ({
  id,
  node: { id },
  get data() { return ungroupData.get(id); },
  get rect() { const data = ungroupData.get(id); return { x: data.x, y: data.y, width: data.width, height: data.height }; },
  kind: id === "ungroup-c" ? "text" : "image",
}));
const ungroupGroup = {
  id: "ungroup-folder",
  anchor: ungroupItems[0],
  anchorId: "ungroup-a",
  members: ungroupItems,
  memberIds: ungroupItems.map((item) => item.id),
  representativeIds: ungroupItems.map((item) => item.id),
  collapsed: true,
  color: folderGeometry.colors[2],
  layoutMode: "stack",
  representativeColumns: 3,
};
const ungroupAtomic = createAtomicCanvasFixture(ungroupData);
folderController.canvas = ungroupAtomic.canvas;
folderController.groupFromId = () => ungroupGroup;
folderController.scheduleReconcile = () => {};
folderController.folderViews.clear();
folderController.folderRuntimes.clear();
folderController.groups.set(ungroupGroup.id, ungroupGroup);
assert(folderController.ungroup(ungroupGroup), "ungroup must commit a permanent spread layout");
const ungroupRects = [...ungroupData.values()].map((data) => ({ x: data.x, y: data.y, width: data.width, height: data.height }));
for (let left = 0; left < ungroupRects.length; left += 1) for (let right = left + 1; right < ungroupRects.length; right += 1) {
  const a = ungroupRects[left];
  const b = ungroupRects[right];
  assert(!(a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y), "ungrouped members must never remain an implicit overlap stack");
}
assert.strictEqual(ungroupData.get("ungroup-a").jamdeck.folderId, undefined, "ungroup must clear anchor membership metadata");
assert.strictEqual(ungroupData.get("ungroup-a").jamdeck.folder, undefined, "ungroup must clear the canonical anchor record");
assert.strictEqual(ungroupData.get("ungroup-a").jamdeck.unrelated, "keep-a", "ungroup must preserve unrelated anchor metadata");
assert.deepStrictEqual(ungroupData.get("ungroup-c").jamdeck.stackTextNormalization, { version: 1 }, "ungroup must preserve stack normalization metadata");
assert.strictEqual(ungroupAtomic.historyPushes, 1, "ungroup must create exactly one native history state");
assert.strictEqual(ungroupAtomic.saves, 1, "ungroup must request exactly one low-level Canvas save");

const detachData = new Map([
  ["detach-a", { id: "detach-a", type: "file", x: 0, y: 0, width: 100, height: 80, jamdeck: { folderId: "detach-folder", folder: { ...ungroupRecord, id: "detach-folder", anchorId: "detach-a", memberIds: ["detach-a", "detach-b", "detach-c"] } } }],
  ["detach-b", { id: "detach-b", type: "file", x: 0, y: 0, width: 100, height: 80, jamdeck: { folderId: "detach-folder" } }],
  ["detach-c", { id: "detach-c", type: "text", x: 0, y: 0, width: 100, height: 80, jamdeck: { folderId: "detach-folder", stackTextNormalization: { version: 1 } } }],
]);
const detachItems = [...detachData.keys()].map((id) => ({
  id,
  node: { id },
  get data() { return detachData.get(id); },
  get rect() { const data = detachData.get(id); return { x: data.x, y: data.y, width: data.width, height: data.height }; },
  kind: id === "detach-c" ? "text" : "image",
}));
const detachGroup = { ...ungroupGroup, id: "detach-folder", anchor: detachItems[0], anchorId: "detach-a", members: detachItems, memberIds: detachItems.map((item) => item.id) };
const detachAtomic = createAtomicCanvasFixture(detachData);
folderController.canvas = detachAtomic.canvas;
folderController.groupFromId = () => detachGroup;
assert(folderController.detachPreviewMember("detach-folder", "detach-c", { x: 420, y: 260, width: 100, height: 80 }, { removeNormalization: true, normalizationKind: "text" }), "dragging a preview card out must detach it from explicit folder metadata");
assert.strictEqual(detachData.get("detach-c").jamdeck, undefined, "dragged-out members must clear folder and consumed normalization metadata together");
assert.strictEqual(detachData.get("detach-c").x, 420, "dragged-out members must commit their final world position in the same transaction");
assert.deepStrictEqual(detachData.get("detach-a").jamdeck.folder.memberIds, ["detach-a", "detach-b"], "remaining folder metadata must be rebuilt without the dragged member");
assert.strictEqual(detachAtomic.historyPushes, 1, "folder drag-out must create one aggregate history state");
assert.strictEqual(detachAtomic.saves, 1, "folder drag-out must request one low-level save");
assert(pluginSource.includes("folderController.detachPreviewMember(folderId, press.nodeId, finalRect"), "expanded folder drag-out must route through the atomic membership service");

const colorData = new Map([
  ["color-a", { id: "color-a", type: "file", x: 0, y: 0, width: 100, height: 80, jamdeck: { folderId: "color-folder", folder: { ...ungroupRecord, id: "color-folder", anchorId: "color-a", memberIds: ["color-a", "color-b"], color: folderGeometry.colors[0] }, unrelated: "anchor-meta" } }],
  ["color-b", { id: "color-b", type: "file", x: 0, y: 0, width: 100, height: 80, jamdeck: { folderId: "color-folder", unrelated: "member-meta" } }],
]);
const colorItems = [...colorData.keys()].map((id) => ({
  id,
  node: { id },
  get data() { return colorData.get(id); },
  get rect() { const data = colorData.get(id); return { x: data.x, y: data.y, width: data.width, height: data.height }; },
  kind: "image",
}));
const colorGroup = { ...ungroupGroup, id: "color-folder", anchor: colorItems[0], anchorId: "color-a", members: colorItems, memberIds: colorItems.map((item) => item.id), color: folderGeometry.colors[0], representativeIds: colorItems.map((item) => item.id), representativeColumns: 2 };
const colorAtomic = createAtomicCanvasFixture(colorData);
folderController.canvas = colorAtomic.canvas;
folderController.groupFromId = () => colorGroup;
folderController.reconcile = () => {};
assert(folderController.updateFolder(colorGroup, { color: folderGeometry.colors[4] }), "folder color selection must commit through the aggregate transaction");
assert.strictEqual(colorData.get("color-a").jamdeck.folder.color, folderGeometry.colors[4], "folder color must persist on the canonical anchor record");
assert.strictEqual(colorData.get("color-a").jamdeck.unrelated, "anchor-meta", "color updates must preserve unrelated anchor metadata");
assert.strictEqual(colorData.get("color-b").jamdeck.unrelated, "member-meta", "color updates must preserve unrelated member metadata");
assert.strictEqual(colorAtomic.historyPushes, 1, "one color selection must create one native history state");
assert.strictEqual(colorAtomic.saves, 1, "one color selection must request one low-level save");

assert(pluginSource.includes("entry.folderController = new CanvasFolderController(this, entry)"), "Canvas runtime mount must create a folder controller");
assert(pluginSource.includes("entry.folderController.install()"), "Canvas runtime mount must install the folder controller after Canvas open");
assert(pluginSource.includes("if (entry.folderController)"), "Canvas runtime destroy must own folder controller cleanup");
assert(pluginSource.includes("entry.folderController.destroy()"), "Canvas runtime destroy must destroy the folder controller");
assert(pluginSource.includes("destroyPromises = new Map()") && pluginSource.includes("this.destroyPromises.get(widgetId)"), "Canvas runtime destroy must serialize repeated lifecycle calls");
assert(pluginSource.includes("perspective(260px) rotateX(-48deg)"), "folder preview flap must use the reduced 48-degree hinge amplitude");
assert(styleSource.includes("transform-origin: 50% 100%;") && styleSource.includes(".jam-deck-canvas-leaf .jam-deck-canvas-folder-front,"), "the folder front hinge must stay on the bottom edge");
assert(pluginSource.includes("const hasSelectedMember = (group.members || []).some((member) => member && member.node && this.canvas.selection.has(member.node));") && pluginSource.includes("if (hasSelectedMember) this.canvas.deselectAll();"), "collapsing a folder must clear selected members so the giant selection box shrinks to the shell");

for (const token of ["--jd-canvas-folder-color-1", "--jd-canvas-folder-color-2", "--jd-canvas-folder-color-3", "--jd-canvas-folder-color-4", "--jd-canvas-folder-color-5", "--jd-canvas-folder-color-6"]) assert(styleSource.includes(token), `folder styling must retain six scoped color tokens (${token})`);
assert(styleSource.includes(".jam-deck-canvas-leaf .jam-deck-canvas-folder-layer"), "folder overlay styles must remain scoped to embedded Canvas leaves");
assert(styleSource.includes(".jam-deck-canvas-leaf .canvas-node.is-jam-deck-folder-proxy-hidden") && styleSource.includes("visibility: hidden !important"), "proxy presentation must hide native members through one scoped owned class");
assert(styleSource.includes("animation-duration: 0.001s !important") && styleSource.includes("transition-duration: 0.001s !important"), "the no-motion class must quench every animation and transition duration");
assert(styleSource.includes("one scene-local shell with sanitized thumbnail proxies"), "folder styling must document the scene-local proxy architecture");
assert(folderControllerSource.includes('"is-double-column"') && folderControllerSource.includes('"is-single-column"'), "folder DOM must distinguish single- and double-column representative layouts");
assert(!styleSource.includes("translate: calc(var(--jd-folder-representative-x") && !styleSource.includes("rotate(var(--jd-folder-item-tilt))"), "CSS must not override native Canvas member transforms with clone-card positioning");
assert(folderControllerSource.includes("folderPreviewSourceRects(group)") && folderControllerSource.includes("sourceRects.set"), "collapsed folders must retain proxy-owned preview source geometry for every member");
assert(styleSource.includes("max-height: calc(100% - 28px)") && styleSource.includes("min-height: 0"), "folder front must preserve a thumbnail reveal at compact heights");
assert(folderControllerSource.includes("jam-deck-canvas-folder-backboard-svg") && folderControllerSource.includes('backboardSvg.setAttribute("viewBox", "0 0 240 181.79")') && folderControllerSource.includes('backboardPath.setAttribute("fill", "currentColor")'), "folder backboard must render as an inline Figma SVG instead of a fallible CSS resource URL");
assert(!styleSource.includes("background-color: var(--jd-folder-backboard-color)"), "folder backboard must not paint a rectangular CSS fill behind the SVG alpha shape");
assert(!styleSource.includes("mask-image") && !styleSource.includes("jam-deck-canvas-folder::before"), "folder backboard must not regress to a CSS mask pseudo-layer");
assert(styleSource.includes("top: -5.193333%") && styleSource.includes("left: -10%") && styleSource.includes("width: 120%") && styleSource.includes("height: 121.193333%"), "folder backboard inline SVG must preserve the exported 240 x 181.79 overflow around the 200 x 150 shell");
assert(!styleSource.includes("jam-deck-canvas-folder-mask") && !styleSource.includes("--jd-folder-front-mask"), "folder styling must not retain a standalone mask layer");
for (const selector of [
  ".canvas-node:has(.canvas-node-content.media-embed > img)",
  "> .canvas-node-container",
  ".canvas-node-content.media-embed",
  ".canvas-node-content.media-embed > img",
]) assert(styleSource.includes(selector), `embedded representative images must keep the complete 10px clipping chain (${selector})`);
assert(styleSource.includes("border-radius: var(--jd-canvas-image-radius) !important") && styleSource.includes("overflow: hidden !important"), "representative image containers and media must clip every corner with the shared 10px radius");
assert(styleSource.includes("jam-deck-canvas-folder-slot") && styleSource.includes("right: 4.5%") && styleSource.includes("width: 6%") && styleSource.includes("height: 4%") && styleSource.includes("top: 79%") && styleSource.includes("top: 87%"), "folder inset slots must remain explicit decorative 12 x 4 layers at y=129/y=137");
assert(styleSource.includes("pointer-events: none") && folderControllerSource.includes("backboard.style.pointerEvents = \"none\"") && folderControllerSource.includes("representatives.style.pointerEvents = \"none\"") && folderControllerSource.includes("front.style.pointerEvents = \"none\""), "folder decorative layers must never steal Canvas pointer events");
assert(styleSource.includes(".jam-deck-canvas-folder:is(.is-expanded, [aria-expanded=\"true\"]):not(.is-opening):not(.is-closing)") && styleSource.includes(".jam-deck-canvas-folder-backboard") && styleSource.includes(".jam-deck-canvas-folder-front") && styleSource.includes("visibility: hidden"), "expanded folders must release the authored paper layers back to native Canvas members");
assert(styleSource.includes("height: 66.666667%") && styleSource.includes("border-radius: 10px") && styleSource.includes("0 -4px 8px rgb(0 0 0 / 0.05)"), "folder front must preserve the Figma 2:3 geometry and soft top shadow");
assert(styleSource.includes("backdrop-filter: blur(16px) saturate(180%)") && styleSource.includes("color-mix(in srgb, var(--jd-folder-front-start) 50%, transparent)") && styleSource.includes("var(--jd-folder-front-end)"), "folder front must use the NZS4 single tint gradient over the frosted blur");
const stackBackdropStyle = styleSource.slice(styleSource.indexOf(".jam-deck-canvas-stack-backdrop {"), styleSource.indexOf(".jam-deck-canvas-stack-preview.is-visible"));
assert(!stackBackdropStyle.includes("backdrop-filter:"), "full-board stack focus must use a translucent wash without repainting the Canvas through backdrop-filter");
assert(styleSource.includes(".jam-deck-canvas-stack-preview-surface.is-image > img") && styleSource.includes("object-fit: contain"), "canonical preview images must fill their cards without intrinsic-size pop-in");
assert(styleSource.includes(".jam-deck-canvas-folder.is-preview-closing .jam-deck-canvas-folder-proxy") && styleSource.includes("opacity: 1"), "folder proxies must fade in while cards return so collapse has no blank handoff");
assert(styleSource.includes("filter: drop-shadow(0 4px 10px rgb(0 0 0 / 0.10))"), "folder backboard must use a path-aware SVG drop shadow instead of a square box shadow");
assert(styleSource.includes(".jam-deck-canvas-folder-backboard") && styleSource.includes("z-index: 0 !important") && styleSource.includes(".jam-deck-canvas-folder-representatives") && styleSource.includes("z-index: 2 !important") && styleSource.includes(".jam-deck-canvas-folder-front") && styleSource.includes("z-index: 10 !important") && styleSource.includes("z-index: 12 !important"), "folder backboard, proxies, front, and header must interleave inside one local shell context");
assert(styleSource.includes("isolation: isolate !important") && styleSource.includes("contain: layout style !important"), "each folder shell must be an independently ordered Canvas stack unit");
assert(folderControllerSource.includes("onStackPreviewState") && folderControllerSource.includes("JAM_DECK_CANVAS_FOLDER_PREVIEW_CARD_RETURN_MS"), "folder front must bridge stack preview opening/closing and delayed card return");
assert(pluginSource.includes("notifyFolderPreview(cluster, \"opening\"") && pluginSource.includes("notifyFolderPreview(cluster, \"closing\"") && pluginSource.includes("notifyFolderPreview(cluster, \"closed\""), "stack preview lifecycle must notify folder open, collapse, and cleanup paths");
assert(pluginSource.includes("addEventListener(\"pointerup\", up, true)") && pluginSource.includes("removeEventListener(\"pointerup\", up, true)"), "stack pointerup handling must stay in capture phase for Canvas release races");
assert(pluginSource.includes("previewCluster: this.previewCluster") && pluginSource.includes("press.previewCluster || this.clusterByNodeId.get(press.nodeId)"), "preview drag cancellation must restore the saved explicit folder cluster after viewport changes");
assert(styleSource.includes("top: 73.333333%") && styleSource.includes("top: 82.666667%") && styleSource.includes("count baseline sits at y=110") && styleSource.includes("label top sits at y=124"), "folder count and label must keep the NZS4 Figma vertical spacing");
assert(styleSource.includes("transform: translateY(20px)") && /is-expanded\.is-native-folder \.jam-deck-canvas-folder-meta \{[\s\S]*?transform: none;/.test(styleSource), "collapsed folder metadata must move down together by 20px without shifting the expanded toolbar");
assert(styleSource.includes("opacity: 0") && styleSource.includes("visibility: hidden") && styleSource.includes("pointer-events: none !important") && styleSource.includes(".jam-deck-canvas-folder-controls > :not(.jam-deck-canvas-folder-color)") && styleSource.includes("display: grid !important"), "folder hover toolbar must be inert while hidden and expose the ungroup control when shown");
const folderControlShowIdx = styleSource.indexOf(".jam-deck-canvas-folder-controls > :not(.jam-deck-canvas-folder-color)");
assert(folderControlShowIdx > 0 && styleSource.indexOf(".jam-deck-canvas-folder-controls > :not(.jam-deck-canvas-folder-color)") === styleSource.lastIndexOf(".jam-deck-canvas-folder-controls > :not(.jam-deck-canvas-folder-color)"), "folder non-color control rule must exist exactly once after the final-cascade merge");
assert(folderControllerSource.includes("jam-deck-canvas-folder-backboard") && folderControllerSource.includes("jam-deck-canvas-folder-representatives") && folderControllerSource.includes("jam-deck-canvas-folder-front"), "folder DOM must expose ordered backboard/representatives/front layers");
assert(!folderControllerSource.includes("jam-deck-canvas-folder-mask"), "folder DOM must not create or retain a mask layer");
assert(folderControllerSource.includes('backboard.dataset.asset = "assets/jam-deck-folder-shell.svg"'), "folder DOM must retain the exact exported backboard asset reference");
assert(folderControllerSource.includes("shell.append(view.backboard, view.representatives, view.front, view.header)"), "folder DOM layer order must keep the backboard, representatives, front, then metadata header");

// A tiny DOM fixture exercises the keyed view without requiring Obsidian's
// private Canvas DOM.  It protects layer order, decorative hit testing, and
// the root click proxy while keeping native representatives unparented.
class FolderDomFixtureElement {
  constructor(tagName) {
    this.tagName = String(tagName || "div").toUpperCase();
    this.className = "";
    this.dataset = {};
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.style = {
      setProperty: (name, value) => { this.style[name] = String(value); },
      removeProperty: (name) => { delete this.style[name]; },
    };
    const classValues = new Set();
    this.classList = {
      toggle: (name, force) => {
        const next = force === undefined ? !classValues.has(name) : !!force;
        if (next) classValues.add(name); else classValues.delete(name);
        return next;
      },
      add: (...names) => names.forEach((name) => classValues.add(name)),
      remove: (...names) => names.forEach((name) => classValues.delete(name)),
      contains: (name) => classValues.has(name),
    };
  }
  get parentElement() { return this.parentNode; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const index = this.parentNode.children.indexOf(this);
    return index >= 0 ? this.parentNode.children[index + 1] || null : null;
  }
  get isConnected() { return !!this.parentNode; }
  append(...children) { children.forEach((child) => this.appendChild(child)); }
  appendChild(child) { if (child) { child.parentNode = this; this.children.push(child); } return child; }
  insertBefore(child, reference) {
    if (!child) return child;
    child.parentNode = this;
    const index = reference ? this.children.indexOf(reference) : -1;
    if (index >= 0) this.children.splice(index, 0, child); else this.children.push(child);
    return child;
  }
  replaceChildren(...children) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.append(...children);
  }
  contains(target) {
    if (target === this) return true;
    return this.children.some((child) => child && typeof child.contains === "function" && child.contains(target));
  }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  removeEventListener(type, callback) { if (this.listeners.get(type) === callback) this.listeners.delete(type); }
  dispatchEvent(event) { const callback = this.listeners.get(event && event.type); if (callback) callback(event); }
  setAttribute(name, value) { this[name] = String(value); }
  removeAttribute(name) { delete this[name]; }
  closest() { return null; }
  querySelector(selector) {
    const className = String(selector || "").replace(/^\./, "");
    const queue = this.children.slice();
    while (queue.length) {
      const node = queue.shift();
      if (String(node.className || "").split(/\s+/).includes(className)) return node;
      queue.push(...(node.children || []));
    }
    return null;
  }
  querySelectorAll(selector) {
    const className = String(selector || "").replace(/^\./, "");
    const matches = [];
    const queue = this.children.slice();
    while (queue.length) {
      const node = queue.shift();
      if (String(node.className || "").split(/\s+/).includes(className)) matches.push(node);
      queue.push(...(node.children || []));
    }
    return matches;
  }
  getBoundingClientRect() {
    const left = Number(this.rect && this.rect.left) || 0;
    const top = Number(this.rect && this.rect.top) || 0;
    const width = Number(this.rect && this.rect.width) || 200;
    const height = Number(this.rect && this.rect.height) || 150;
    return { left, top, width, height, right: left + width, bottom: top + height };
  }
  setPointerCapture() {}
  releasePointerCapture() {}
  remove() {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) this.parentNode.children.splice(index, 1);
    this.parentNode = null;
  }
}
const folderDomDocument = {
  createElement: (tagName) => new FolderDomFixtureElement(tagName),
  createElementNS: (_namespace, tagName) => new FolderDomFixtureElement(tagName),
  addEventListener: () => {},
  removeEventListener: () => {},
};

// Image previews must resolve from the persisted Canvas file path even when
// the hidden native node has not hydrated a .canvas-node-content element yet.
const canonicalImageController = new JamDeckPlugin.CanvasImageStackController({
  deckView: { app: { vault: { adapter: { getResourcePath: (path) => `app://vault/${path}` } } } },
}, { ownerDocument: folderDomDocument });
const canonicalImageSurface = canonicalImageController.createPreviewSurface({
  kind: "image",
  node: { nodeEl: new FolderDomFixtureElement("div") },
  data: { type: "file", file: "Assets/folder-preview.png" },
});
assert.strictEqual(canonicalImageSurface.children.length, 1, "image preview must create a real image without waiting for native Canvas DOM hydration");
assert.strictEqual(canonicalImageSurface.children[0].src, "app://vault/Assets/folder-preview.png", "image preview must use the Vault resource URL derived from Canvas data.file");
assert.strictEqual(canonicalImageSurface.children[0].alt, "", "decorative folder thumbnails must keep empty alt text");
const folderDomLayer = new FolderDomFixtureElement("div");
const folderDomController = new JamDeckPlugin.CanvasFolderController({}, { ownerDocument: folderDomDocument });
folderDomController.layer = folderDomLayer;
let folderDomClickCount = 0;
folderDomController.toggleFolderPreview = () => { folderDomClickCount += 1; };
const folderDomView = folderDomController.createFolderView({ id: "dom-folder", collapsed: true, members: [] });
assert.deepStrictEqual(
  folderDomView.shell.children.map((child) => child.dataset.layer || child.className),
  ["backboard", "representatives", "front", "jam-deck-canvas-folder-header"],
  "folder DOM must mount backboard, representatives, front, then metadata header",
);
assert.strictEqual(folderDomView.mask, undefined, "folder DOM must not expose a mask element");
assert.strictEqual(folderDomView.backboard.children[0], folderDomView.backboardSvg, "folder DOM must mount the inline SVG inside the backboard layer");
assert.strictEqual(folderDomView.backboardSvg.viewBox, "0 0 240 181.79", "folder inline SVG must retain the exact Figma viewBox");
assert.strictEqual(folderDomView.front.children.length, 2, "folder front must contain exactly two decorative inset slots");
for (const layer of [folderDomView.backboard, folderDomView.representatives, folderDomView.front, ...folderDomView.slots]) {
  assert.strictEqual(layer.style.pointerEvents, "none", "folder decorative layers must remain pointer-transparent");
}
folderDomView.shell.dispatchEvent({ type: "click", target: folderDomView.shell, preventDefault() {}, stopPropagation() {} });
assert.strictEqual(folderDomClickCount, 1, "folder root click must retain the legacy stack preview proxy");
assert.strictEqual(folderDomView.controls.children.length, 3, "folder hover toolbar must expose color, ungroup and rename actions");
assert.strictEqual(folderDomView.controls.children[0], folderDomView.color, "folder toolbar keyboard order must start with color");
assert.strictEqual(folderDomView.controls.children[1], folderDomView.ungroup, "folder toolbar order must keep ungroup second");
assert.strictEqual(folderDomView.controls.children[2], folderDomView.rename, "folder toolbar order must place rename last");
assert(styleSource.includes("perspective(420px) rotateX(-18deg)") && styleSource.includes("transform-origin: 50% 100%;") && styleSource.includes(":is(:hover, :focus-within) > .jam-deck-canvas-folder-front"), "folder hover lift must use the reduced 18-degree hinge amplitude");
assert((styleSource.match(/rotateX\(-48deg\)/g) || []).length === 4 && !styleSource.includes("rotateX(-80deg)"), "folder preview CSS fallback and header must share the reduced 48-degree endpoint");
assert(styleSource.includes(".canvas-node-group") && styleSource.includes("visibility: hidden !important"), "Jam Deck must keep native group frames data-only (shell is the only visible grouping surface)");
assert(folderControllerSource.includes("JAM_DECK_NATIVE_GROUP_BASE_HEIGHT"), "native group frame must use the explicit 200×180 baseline");
assert(folderControllerSource.includes('data.type === "group"') && !folderControllerSource.includes('nodeType === "group"'), "native group lookup must match by id + serialized type because 1.13 minifies nodeType");
assert(folderControllerSource.includes("nativeExpandTargets") === false && folderControllerSource.includes("expandNativeFolder") === false && folderControllerSource.includes("collapseNativeFolder") === false, "native folders must not un-bury real members; the preview is the only expand path");
assert(folderControllerSource.includes("hiddenEdges") && folderControllerSource.includes("edgeChanges"), "native folders must park member edges into the payload instead of leaving phantom connectors");
assert(folderControllerSource.includes("nativeFolderShellBounds(group)") && folderControllerSource.includes("findDropTarget(source, groups)"), "native drop targeting must judge collapsed folders against the visible shell bounds");
assert(folderControllerSource.includes("centerInside") && folderControllerSource.includes("rect.width / 2"), "collapsed folder drop must also hit when the dragged centre lands inside the shell (wide/short images cap at 0.5 area ratio)");
assert(folderControllerSource.includes("(anchorStacked.width - width) / 2"), "joining a collapsed folder must fold the member onto the anchor slot while preserving its own width/height (no anchor-size crop)");
assert(styleSource.includes("object-fit: contain !important") && !styleSource.includes("object-fit: cover !important"), "folder shell thumbnails must show the full frame (contain) instead of cropping to the slot aspect (cover)");
assert(styleSource.includes(":has(.jam-deck-canvas-folder:is(:hover, :focus-within)) .canvas-node-connection-point"), "hovering a folder shell must suppress every canvas connection point (folded members keep oversized rects at the anchor)");
assert(folderControllerSource.includes("patchNodeInteractionLayer") && folderControllerSource.includes("nodeInteractionLayer") && folderControllerSource.includes("isFolderOwnedNode"), "the interaction layer must be patched so folder-owned nodes never become its target (Obsidian renders connection points in a single overlay, not inside nodes)");
assert(folderControllerSource.includes("folderGroupId"), "native group node data must carry a self-describing jamdeck marker for folder-owned detection");
assert(pluginSource.includes("getStackItems(false).filter((item) => item.id !== currentItem.id)"), "legacy auto-snap must exclude explicit folder members from its stack candidates");
assert.strictEqual(folderDomView.controls.children[1], folderDomView.ungroup, "folder toolbar keyboard order must end with ungroup");
let folderDomUngroupCalls = 0;
folderDomController.ungroup = () => { folderDomUngroupCalls += 1; };
folderDomView.ungroup.dispatchEvent({ type: "click", target: folderDomView.ungroup, preventDefault() {}, stopPropagation() {} });
assert.strictEqual(folderDomUngroupCalls, 1, "folder ungroup control must invoke the permanent ungroup service");
assert.strictEqual(folderDomClickCount, 1, "folder toolbar actions must never bubble into the shell preview proxy");
folderDomView.dispose();

const proxyScene = new FolderDomFixtureElement("div");
const proxyAnchorEl = new FolderDomFixtureElement("div");
const proxyMemberEl = new FolderDomFixtureElement("div");
const proxyHiddenMemberEl = new FolderDomFixtureElement("div");
proxyScene.append(proxyAnchorEl, proxyMemberEl, proxyHiddenMemberEl);
const proxyMembers = [
  { id: "proxy-a", node: { id: "proxy-a", nodeEl: proxyAnchorEl }, data: { id: "proxy-a", type: "file", x: 40, y: 50, width: 120, height: 90 }, rect: { x: 40, y: 50, width: 120, height: 90 }, kind: "image" },
  { id: "proxy-b", node: { id: "proxy-b", nodeEl: proxyMemberEl }, data: { id: "proxy-b", type: "file", x: 40, y: 50, width: 100, height: 130 }, rect: { x: 40, y: 50, width: 100, height: 130 }, kind: "image" },
  { id: "proxy-c", node: { id: "proxy-c", nodeEl: proxyHiddenMemberEl }, data: { id: "proxy-c", type: "text", x: 40, y: 50, width: 140, height: 80 }, rect: { x: 40, y: 50, width: 140, height: 80 }, kind: "text" },
];
const proxyGroup = {
  id: "proxy-folder",
  anchor: proxyMembers[0],
  members: proxyMembers,
  memberIds: proxyMembers.map((member) => member.id),
  representativeIds: ["proxy-a", "proxy-b"],
  collapsed: true,
  color: folderGeometry.colors[0],
  representativeColumns: 2,
};
const proxyController = new JamDeckPlugin.CanvasFolderController({}, { ownerDocument: folderDomDocument });
proxyController.stack = { createPreviewSurface: () => new FolderDomFixtureElement("div") };
const proxyView = proxyController.createFolderView(proxyGroup);
proxyController.folderViews.set(proxyGroup.id, proxyView);
proxyController.renderFolderRepresentatives(proxyView, proxyGroup);
assert.strictEqual(proxyView.shell.parentNode, proxyScene, "folder shell must mount as a direct sibling in the live Canvas scene");
assert.strictEqual(proxyScene.children[1], proxyView.shell, "folder shell must inherit deterministic paint order immediately after its anchor");
assert.strictEqual(proxyAnchorEl.parentNode, proxyScene, "folder rendering must never reparent the real anchor node");
assert.strictEqual(proxyMemberEl.parentNode, proxyScene, "folder rendering must never reparent another real member node");
assert.strictEqual(proxyHiddenMemberEl.parentNode, proxyScene, "folder rendering must keep non-representative members in the native scene");
assert.strictEqual(proxyView.representatives.children.length, 2, "folder shell must contain one sanitized proxy for each representative");
assert(proxyView.representatives.children[0].children[0].classList.contains("jam-deck-canvas-folder-proxy-surface"), "folder representative surfaces must receive the scoped thumbnail sizing class");
proxyView.shell.rect = { left: 200, top: 120, width: 200, height: 150 };
proxyView.representatives.children[0].rect = { left: 220, top: 130, width: 90, height: 70 };
proxyView.representatives.children[1].rect = { left: 280, top: 126, width: 90, height: 70 };
const proxySourceRects = proxyController.folderPreviewSourceRects(proxyGroup);
assert.strictEqual(proxySourceRects.size, 3, "folder preview source geometry must include hidden non-representative members too");
assert.deepStrictEqual(proxySourceRects.get("proxy-a"), { left: 220, top: 130, width: 90, height: 70 }, "representative previews must launch from their visible proxy rect");
assert(proxySourceRects.get("proxy-c").width > 0, "non-representative members must receive a deterministic in-folder launch slot");
proxyView.dispose();

// Preview bridge behavior: with the plugin animation toggle off (no-motion
// class on the deck root), opening/closing must settle to a stable final
// state immediately, while a normal collapse keeps one cancellable return
// timer and destroy() must clear it without leaving flap classes behind.
const reducedFolderDocument = { ...folderDomDocument };
reducedFolderDocument.defaultView = {
  setTimeout: (callback) => { callback(); return 1; },
  clearTimeout: () => {},
};
const reducedPreviewController = new JamDeckPlugin.CanvasFolderController({}, {
  ownerDocument: reducedFolderDocument,
  leaf: { containerEl: { closest: () => ({}), addClass: () => {}, removeClass: () => {} } },
});
reducedPreviewController.layer = new FolderDomFixtureElement("div");
const reducedPreviewGroup = { id: "reduced-preview", collapsed: true, members: [] };
const reducedPreviewView = reducedPreviewController.createFolderView(reducedPreviewGroup);
reducedPreviewController.folderViews.set(reducedPreviewGroup.id, reducedPreviewView);
reducedPreviewController.groups.set(reducedPreviewGroup.id, reducedPreviewGroup);
const reducedCluster = { id: "folder:reduced-preview", folderId: reducedPreviewGroup.id };
reducedPreviewController.onStackPreviewState(reducedCluster, "opening");
assert.strictEqual(reducedPreviewView.shell.dataset.previewState, "open", "reduced-motion preview opening must settle to open immediately");
reducedPreviewController.onStackPreviewState(reducedCluster, "closing");
assert.strictEqual(reducedPreviewView.shell.dataset.previewState, "closed", "reduced-motion preview collapse must settle to closed immediately");
assert.strictEqual(reducedPreviewView.front.style.opacity, undefined, "reduced-motion collapse must clear transient front opacity");
reducedPreviewController.destroy();

const pendingPreviewTimers = new Map();
let nextPreviewTimer = 0;
const normalFolderDocument = { ...folderDomDocument };
normalFolderDocument.defaultView = {
  matchMedia: () => ({ matches: false }),
  setTimeout: (callback) => { const id = ++nextPreviewTimer; pendingPreviewTimers.set(id, callback); return id; },
  clearTimeout: (id) => { pendingPreviewTimers.delete(id); },
};
const normalPreviewController = new JamDeckPlugin.CanvasFolderController({}, { ownerDocument: normalFolderDocument });
normalPreviewController.layer = new FolderDomFixtureElement("div");
const normalPreviewGroup = { id: "normal-preview", collapsed: true, members: [] };
const normalPreviewView = normalPreviewController.createFolderView(normalPreviewGroup);
normalPreviewController.folderViews.set(normalPreviewGroup.id, normalPreviewView);
normalPreviewController.groups.set(normalPreviewGroup.id, normalPreviewGroup);
const normalCluster = { id: "folder:normal-preview", folderId: normalPreviewGroup.id };
normalPreviewController.onStackPreviewState(normalCluster, "opening");
normalPreviewController.onStackPreviewState(normalCluster, "closing", { delay: 260 });
assert.strictEqual(pendingPreviewTimers.size, 1, "normal preview collapse must schedule exactly one delayed flap close");
normalPreviewController.onStackPreviewState(normalCluster, "opening");
assert.strictEqual(pendingPreviewTimers.size, 0, "a reopened folder must cancel its pending flap close timer");
normalPreviewController.onStackPreviewState(normalCluster, "closing", { delay: 260 });
normalPreviewController.destroy();
assert.strictEqual(pendingPreviewTimers.size, 0, "folder destroy must cancel pending preview timers");

const savedFolderPreviewCluster = { id: "folder:restore-preview", folderId: "restore-preview", members: [{ id: "a" }, { id: "b" }] };
const previewRestoreStack = Object.create(JamDeckPlugin.CanvasImageStackController.prototype);
let restoredFolderPreviewCluster = null;
previewRestoreStack.ownerWindow = {
  removeEventListener: () => {},
  requestAnimationFrame: (callback) => { callback(); return 0; },
};
previewRestoreStack.previewPress = null;
previewRestoreStack.previewWrapper = null;
previewRestoreStack.dragPortal = null;
previewRestoreStack.clusterByNodeId = new Map();
previewRestoreStack.scheduleReconcile = () => {};
previewRestoreStack.showPreview = (cluster) => { restoredFolderPreviewCluster = cluster; };
const previewRestorePress = {
  pointerId: 1,
  disposed: false,
  previewCluster: savedFolderPreviewCluster,
  nodeId: "folder-member",
  move: null,
  up: null,
  cancel: null,
  card: {
    classList: { remove: () => {} },
    style: { removeProperty: () => {} },
    releasePointerCapture: () => {},
  },
  member: { node: { nodeEl: { removeClass: () => {} } } },
};
previewRestoreStack.previewPress = previewRestorePress;
previewRestoreStack.cancelPreviewPress(previewRestorePress, true);
assert.strictEqual(restoredFolderPreviewCluster, savedFolderPreviewCluster, "viewport/drag cancellation must rebuild the original explicit folder preview cluster");

assert(fs.existsSync(path.join(projectRoot, "assets", "jam-deck-folder-shell.svg")), "the Figma folder shell asset must remain in the source tree");
assert(deploySource.includes("assets/jam-deck-folder-shell.svg") && deploySource.includes("$assetFiles"), "deploy must stage the folder shell asset alongside the plugin files");
assert(deploySource.includes("Protected data.json") && deploySource.includes("Get-DataState"), "asset deployment must retain data.json protection checks");

const eagleSearch = JamDeckPlugin.eagleImageSearchHelpers;
assert(eagleSearch && typeof eagleSearch.resultGridLayout === "function", "Eagle search must export its result grid layout");
const eaglePayload = { results: Array.from({ length: 15 }, (_value, index) => ({ id: `eagle-${index}`, score: index })) };
assert.strictEqual(eagleSearch.topResults(eaglePayload, 20).length, 10, "Eagle search results must remain capped at ten even when a larger limit is requested");
const eagleGrid = eagleSearch.resultGridLayout({ x: 10, y: 20, width: 100, height: 80 }, Array.from({ length: 15 }, () => ({})), 40);
assert.strictEqual(eagleGrid.length, 10, "Eagle search grid must create at most ten positions");
assert.deepStrictEqual(eagleGrid[0], { x: 10, y: 140, width: 100, height: 80 }, "Eagle grid must begin directly below the source image");
assert.deepStrictEqual(eagleGrid[4], { x: 570, y: 140, width: 100, height: 80 }, "Eagle grid must use five columns");
assert.deepStrictEqual(eagleGrid[5], { x: 10, y: 260, width: 100, height: 80 }, "Eagle grid must wrap to a second row");
assert.deepStrictEqual(eagleGrid[9], { x: 570, y: 260, width: 100, height: 80 }, "Eagle grid must end at the fifth column of the second row");
assert(eagleGrid.every((item) => item.width === 100 && item.height === 80), "Eagle grid results must reuse the source size");
const stackA = { id: "a", x: 0, y: 0, width: 100, height: 100 };
const stackHalf = { id: "half", x: 50, y: 0, width: 100, height: 100 };
const stackOver = { id: "over", x: 49, y: 0, width: 100, height: 100 };
const stackContained = { id: "small", x: 20, y: 20, width: 20, height: 20 };
assert.strictEqual(stackGeometry.intersectionArea(stackA, stackHalf), 5000, "stack intersection area must use world rectangles");
assert.strictEqual(stackGeometry.overlapRatio(stackA, stackHalf), 0.5, "exactly fifty percent overlap must remain below the strict stack threshold");
assert(stackGeometry.overlapRatio(stackA, stackOver) > 0.5, "overlap above fifty percent must create a stack edge");
assert.strictEqual(stackGeometry.overlapRatio(stackA, stackContained), 1, "a contained small image must count as fully overlapped");
assert.strictEqual(stackGeometry.overlapRatio(stackA, { id: "bad", x: 0, y: 0, width: 0, height: 10 }), 0, "invalid zero-area images must not stack");
assert.strictEqual(stackGeometry.kind({ type: "text", text: "**Markdown-like text**" }), "text", "Canvas text must remain a text stack member");
assert.strictEqual(stackGeometry.kind({ type: "file", file: "Notes/Idea.md" }), "markdown-note", "Markdown file nodes must join mixed stacks");
assert.strictEqual(stackGeometry.kind({ type: "file", file: "Assets/Hero.webp" }), "image", "WebP images must join mixed stacks");
for (const excluded of [
  { type: "link", url: "https://example.com" },
  { type: "file", file: "Boards/Nested.canvas" },
  { type: "file", file: "Assets/Reference.pdf" },
  { type: "file", file: "Assets/Clip.mp4" },
]) {
  assert.strictEqual(stackGeometry.kind(excluded), null, "unsupported Canvas nodes must stay outside mixed stacks");
}

const normalizedLarge = stackGeometry.normalizeImage(
  { id: "large", x: 0, y: 0, width: 600, height: 400 },
  [
    { id: "text", x: 0, y: 0, width: 210, height: 140 },
    { id: "note", x: 0, y: 0, width: 190, height: 160 },
  ],
);
assert(normalizedLarge && normalizedLarge.changed, "an oversized incoming image must be normalized");
assert.strictEqual(normalizedLarge.width, 200, "mixed member average width must size the incoming image");
assert.strictEqual(normalizedLarge.height, 133.33, "incoming images must preserve aspect ratio");
assert.strictEqual(normalizedLarge.x, 200, "normalization must preserve the pointer-up center");
assert.strictEqual(normalizedLarge.y, 133.33, "normalization must preserve the pointer-up center after rounding");
const unchangedSmall = stackGeometry.normalizeImage(
  { id: "small", x: 10, y: 20, width: 100, height: 80 },
  [{ id: "target", x: 0, y: 0, width: 220, height: 180 }],
);
assert(unchangedSmall && !unchangedSmall.changed && unchangedSmall.scale === 1, "incoming images must never enlarge");
const safelyRestored = stackGeometry.restoreImage(
  { id: "managed", x: 400, y: 300, width: 200, height: 100 },
  { width: 600, height: 300 },
  [{ id: "far", x: 1200, y: 900, width: 100, height: 100 }],
);
assert.deepStrictEqual(safelyRestored, { x: 200, y: 200, width: 600, height: 300 }, "safe detach must restore original size around the final center");
assert.strictEqual(
  stackGeometry.restoreImage(
    { id: "managed", x: 400, y: 300, width: 200, height: 100 },
    { width: 600, height: 300 },
    [{ id: "blocked", x: 250, y: 200, width: 600, height: 300 }],
  ),
  null,
  "unsafe detach must retain normalized geometry",
);

const bridgeClusters = stackGeometry.clusters([
  stackA,
  { id: "b", x: 40, y: 0, width: 100, height: 100 },
  { id: "c", x: 80, y: 0, width: 100, height: 100 },
  { id: "d", x: 400, y: 0, width: 100, height: 100 },
]);
assert.strictEqual(bridgeClusters.length, 1, "overlap graph must exclude isolated images");
assert.deepStrictEqual(bridgeClusters[0].members.map((item) => item.id).sort(), ["a", "b", "c"], "A-B-C bridge overlaps must form one connected stack");
const targetChoice = stackGeometry.chooseTarget(
  { id: "drag", x: 42, y: 0, width: 100, height: 100 },
  [stackA, { id: "far", x: 500, y: 0, width: 100, height: 100 }],
);
assert(targetChoice && targetChoice.cluster.anchor.id === "a", "stack target selection must choose the strongest overlapping cluster");
const snapped = stackGeometry.snap({ id: "drag", x: 42, y: 0, width: 100, height: 100 }, targetChoice.cluster);
assert(snapped && stackGeometry.overlapRatio(snapped, targetChoice.cluster.anchor) > 0.5, "snap positions must preserve strict stack overlap");
assert.strictEqual(snapped.width, 100, "snap must preserve image width");
assert.strictEqual(snapped.height, 100, "snap must preserve image height");
const screenSlots = stackGeometry.slots(10, 7, 2);
assert.strictEqual(screenSlots.length, 10, "stack slots must cover ten visible layers");
assert.strictEqual(new Set(screenSlots.map((slot) => `${slot.screenX.toFixed(3)}:${slot.screenY.toFixed(3)}`)).size, 10, "every stack layer must have a unique screen-space silhouette");
assert.notDeepStrictEqual(screenSlots[1], screenSlots[2], "the third layer must never reuse the second layer position");
for (const slot of screenSlots.slice(1)) {
  assert(Math.hypot(slot.screenX, slot.screenY) >= 7 - 1e-6, "stack slots must remain perceptible after zoom conversion");
}
const occupiedCluster = {
  id: "occupied",
  anchor: stackA,
  members: [
    stackA,
    { id: "second", x: 7, y: 0, width: 100, height: 100 },
  ],
};
const thirdSnap = stackGeometry.snap({ id: "third", x: 40, y: 0, width: 100, height: 100 }, occupiedCluster, { zoom: 1, screenStep: 7 });
assert(thirdSnap, "a third image must find another valid visible slot");
assert(Math.hypot(thirdSnap.screenOffset.x - 7, thirdSnap.screenOffset.y) >= 4.5, "the third image slot must not collide with the second");
assert(stackGeometry.overlapRatio(thirdSnap, stackA) > 0.5, "the third image slot must remain a valid strict-overlap stack");
const previewLayout = stackGeometry.layoutPreview(
  Array.from({ length: 5 }, () => ({ width: 200, height: 120 })),
  { left: 100, right: 300, top: 80, bottom: 200 },
  { width: 1200, height: 800 },
);
assert(previewLayout && previewLayout.positions.length === 5, "five stack previews must use a stable multi-row layout");
assert(previewLayout.x >= 0 && previewLayout.y >= 0, "preview layout must stay in non-negative leaf space");
function assertPreviewLayout(sizes, viewport, label) {
  const layout = stackGeometry.layoutPreview(
    sizes,
    { left: viewport.width * 0.42, right: viewport.width * 0.58, top: viewport.height * 0.42, bottom: viewport.height * 0.58 },
    viewport,
  );
  assert(layout && layout.positions.length === sizes.length, `${label}: layout must include every card`);
  layout.positions.forEach((position, index) => {
    assert(position.x >= layout.safe.left - 0.01 && position.y >= layout.safe.top - 0.01, `${label}: card must stay inside the safe top-left`);
    assert(position.x + position.width <= layout.safe.right + 0.01, `${label}: card must stay inside the safe right edge`);
    assert(position.y + position.height <= layout.safe.bottom + 0.01, `${label}: card must stay inside the safe bottom edge`);
    const sourceRatio = sizes[index].width / sizes[index].height;
    const targetRatio = position.width / position.height;
    assert(Math.abs(sourceRatio - targetRatio) / sourceRatio < 0.005, `${label}: aspect ratio must be preserved`);
  });
  for (let left = 0; left < layout.positions.length; left++) {
    for (let right = left + 1; right < layout.positions.length; right++) {
      assert.strictEqual(stackGeometry.intersectionArea(layout.positions[left], layout.positions[right]), 0, `${label}: preview cards must not overlap`);
    }
  }
}
for (const count of [1, 2, 3, 5, 8, 10, 16]) {
  const mixed = Array.from({ length: count }, (_, index) => index % 3 === 0
    ? { width: 320, height: 180 }
    : index % 3 === 1 ? { width: 140, height: 220 } : { width: 210, height: 210 });
  assertPreviewLayout(mixed, count % 2 ? { width: 1180, height: 760 } : { width: 560, height: 780 }, `mixed-${count}`);
}
const focusRect = { left: 300, top: 200, right: 700, bottom: 500 };
const viewportRect = { width: 1000, height: 700 };
const centerBystander = { left: 440, top: 300, right: 560, bottom: 400 };
const centerShift = stackGeometry.bystanderShift(centerBystander, focusRect, viewportRect);
assert(Math.abs(centerShift.x) > 0 || Math.abs(centerShift.y) > 0, "an image covered by the focus composition must be displaced");
const shiftedCenter = {
  left: centerBystander.left + centerShift.x,
  top: centerBystander.top + centerShift.y,
  right: centerBystander.right + centerShift.x,
  bottom: centerBystander.bottom + centerShift.y,
};
assert(
  shiftedCenter.right <= focusRect.left - 20
  || shiftedCenter.left >= focusRect.right + 20
  || shiftedCenter.bottom <= focusRect.top - 20
  || shiftedCenter.top >= focusRect.bottom + 20,
  "a covered image must clear the expanded focus rectangle",
);
assert.deepStrictEqual(
  stackGeometry.bystanderShift({ left: 20, top: 20, right: 100, bottom: 100 }, focusRect, viewportRect),
  { x: 0, y: 0 },
  "a distant image must not move",
);
assert.deepStrictEqual(
  stackGeometry.bystanderShift({ left: 250, top: 260, right: 290, bottom: 340 }, focusRect, viewportRect, 20, 0),
  { x: 0, y: 0 },
  "explicit folder narrow displacement must not move a nearby node that is not covered",
);
const narrowFolderShift = stackGeometry.bystanderShift(
  { left: 290, top: 260, right: 330, bottom: 340 },
  focusRect,
  viewportRect,
  20,
  0,
);
assert(narrowFolderShift.x <= -30, "explicit folder narrow displacement must clear a covered node with the 20px safety gap");

assert.deepStrictEqual(JamDeckPlugin.clampAiFabPosition({ x: 2444, y: 1241.1355 }, 1576, 953.515625, 55, 52), { x: 1521, y: 901.515625 }, "AI assistant FAB must return fully inside a smaller restored window using its rendered size");
assert.deepStrictEqual(JamDeckPlugin.clampAiFabPosition(null, 1576, 953.515625, 55, 52), { x: 1501, y: 881.515625 }, "AI assistant FAB must default to a 20px bottom-right inset");
assert.strictEqual(JamDeckPlugin.clampAiFabPosition({ x: 10, y: 10 }, 0, 0), null, "AI assistant FAB must wait for a measurable view before clamping persisted coordinates");
assert(pluginSource.includes("installAiFabLayoutObserver(root)") && pluginSource.includes("this.cleanupAiFabLayout()"), "AI assistant FAB must re-clamp on view resize and release its observer on rerender/close");
assert(pluginSource.includes('role: "tablist"') && pluginSource.includes('role: "tabpanel"'), "AI assistant must expose accessible assistant and local-workspace tabs");
assert(pluginSource.includes('sandbox: "allow-scripts allow-same-origin allow-forms"'), "local AI web must keep its iframe sandbox at the reviewed minimum");
assert(!pluginSource.includes("allow-downloads") && !pluginSource.includes("allow-popups-to-escape-sandbox"), "local AI web must not gain download or popup escape privileges");
assert(pluginSource.includes('this.aiActivePage = "assistant";') && pluginSource.includes('this.setAiActivePage("assistant", { focus: false })'), "Canvas AI entry points must return to the built-in assistant tab");
assert(styleSource.includes(".jam-deck-ai-chat.is-local-web-page") && styleSource.includes("width: clamp(760px, 80vw, 925px)"), "the local workspace page must use the wider floating-panel layout without filling the workspace");
assert(styleSource.includes(".jam-deck-ai-pages {\n  display: flex;") && styleSource.includes("width: 100%; min-width: 0; min-height: 0; flex-direction: column;"), "AI pages must preserve the full-height flex chain so the composer stays at the bottom");
assert(pluginSource.includes("this.renderAiChatHeader(header, { assistantPageId, localWebPageId })"), "AI tabs must live inside the single shared header instead of adding a second toolbar row");
assert(styleSource.includes(".jam-deck-ai-page[hidden] { display: none; }"), "inactive AI pages must remain hidden despite their flex layout");

const plugin = new JamDeckPlugin();
assert.strictEqual(plugin.getCanvasInkSidecarPath("Work/Board.canvas"), "Work/Board.canvas.jam-deck.json");
assert.throws(() => plugin.getCanvasInkSidecarPath("data.json"), /Canvas/);
assert.strictEqual(plugin.canvasInkOwnerKey("Work/Board.canvas"), plugin.canvasInkOwnerKey("work/board.canvas"), "Canvas ink registry keys must be case-insensitive on Windows");
const nativeDragFile = { path: "attachments/jam-deck-clipboard/clip.png", extension: "png" };
let nativeDragStarted = null;
plugin.app = {
  vault: { getAbstractFileByPath: (path) => path === nativeDragFile.path ? nativeDragFile : null },
  dragManager: {
    dragFile: (event, file) => ({ type: "file", file }),
    onDragStart: (event, draggable) => { nativeDragStarted = draggable; },
  },
};
assert(plugin.prepareObsidianImageDrag({}, { type: "image", filename: "clip.png" }));
assert.strictEqual(nativeDragStarted.file, nativeDragFile, "clipboard image must register as an Obsidian file drag");
const task = {
  id: "task-test-1",
  text: "【设计】Jam Deck 详情",
  description: "补齐图片与链接\n确认窄窗按钮",
  links: [{ id: "l1", label: "Figma", url: "https://www.figma.com/file/test" }],
  images: [{ id: "i1", path: "attachments/jam-deck-task-assets/2026-07-20/test-task-test-1.png", caption: "test.png" }],
};

const standard = [
  "---",
  "date: 2026-07-20",
  "weekday: 星期一",
  "tags: [工作日记]",
  "---",
  "",
  "# 2026-07-20 星期一",
  "",
  "## 工作内容",
  "",
  "- 原工作",
  "",
  "## 效果图 / 视频",
  "",
  "## 链接",
  "",
  "## 备注",
  "",
].join("\n");

const once = plugin.upsertTaskInJournal(standard, task);
assert(once.includes("<!-- jam-deck-task:task-test-1:work:start:v2 -->\n- 【设计】Jam Deck 详情\n<!-- jam-deck-task:task-test-1:work:end:v2 -->"));
assert(once.includes("- ![[attachments/jam-deck-task-assets/2026-07-20/test-task-test-1.png]]"));
assert(once.includes("- [Figma →](https://www.figma.com/file/test)"));
assert(once.includes("<!-- jam-deck-task:task-test-1:notes:start:v2 -->\n- 补齐图片与链接\n- 确认窄窗按钮\n<!-- jam-deck-task:task-test-1:notes:end:v2 -->"));
assert.strictEqual(plugin.getTaskBlockRanges(once, task.id).count, 4);
assert.strictEqual(plugin.upsertTaskInJournal(once, task), once, "archive marker must be idempotent");

const oldFormat = "# 2026-07-17 工作日报\n\n## 日报发送\n\n旧内容\n\n### 附件\n\n![[old.png]]\n";
const upgraded = plugin.upsertTaskInJournal(oldFormat, task);
assert(upgraded.startsWith(oldFormat.trimEnd()), "old journal content must remain intact");
for (const heading of ["工作内容", "效果图 / 视频", "链接", "备注"]) {
  assert(upgraded.includes(`## ${heading}`), `missing ${heading}`);
}

const deceptive = [
  "---",
  "fake: '<!-- jam-deck-task:task-test-1:work:start:v2 -->'",
  "---",
  "",
  "```md",
  "## 工作内容",
  "<!-- jam-deck-task:task-test-1:work:start:v2 -->",
  "```",
  "",
  "# Real content",
].join("\n");
const deceptiveResult = plugin.upsertTaskInJournal(deceptive, task);
assert.strictEqual(plugin.getTaskBlockRanges(deceptiveResult, task.id).count, 4, "frontmatter/code markers must not block real section blocks");

const crlf = standard.replace(/\n/g, "\r\n");
const crlfResult = plugin.upsertTaskInJournal(crlf, task);
assert(!/(?<!\r)\n/.test(crlfResult), "CRLF style must be preserved");

const context = { date: "2026-07-20", weekday: "星期一" };
const fresh = plugin.buildNewDailyJournal(context, task);
assert(fresh.includes("date: 2026-07-20"));
assert.strictEqual((fresh.match(/^## /gm) || []).length, 4, "new journal must contain exactly four H2 sections");

const migrated = plugin.normalizeDeckTask({ id: "legacy", text: "旧任务", status: "active", customField: 42 });
assert.strictEqual(migrated.customField, 42, "migration must preserve unknown task fields");
assert.deepStrictEqual(migrated.links, []);
assert.deepStrictEqual(migrated.images, []);
assert.strictEqual(migrated.journalPath, null);
assert.strictEqual(plugin.resolveTaskCategory({ text: "【设计】卡牌" }), "work");
assert.strictEqual(plugin.resolveTaskCategory({ text: "买牛奶" }), "life");
assert.strictEqual(plugin.resolveTaskCategory({ text: "【设计】卡牌", category: "life" }), "life", "explicit category must win over title inference");
assert(plugin.isValidLocalDate("2028-02-29"));
assert(!plugin.isValidLocalDate("2027-02-29"));
const lifeTaskFixture = { ...task, id: "life-fixture", text: "买牛奶", category: "life", dueDate: "2026-07-25", images: [] };
const lifeDaily = "# 2026年7月20日\n\n原有生活正文\n";
const lifeOnce = plugin.upsertTaskInLifeDaily(lifeDaily, lifeTaskFixture, "2026-07-20");
assert(lifeOnce.includes("%% jam-deck-life-task:life-fixture:start:v1 %%"), "life block must use Obsidian hidden comment markers");
assert(!lifeOnce.includes("<!-- jam-deck-life-task"), "life block must not emit legacy html comments");
assert(lifeOnce.includes("  - 截止：2026-07-25"));
assert.strictEqual(plugin.upsertTaskInLifeDaily(lifeOnce, lifeTaskFixture, "2026-07-20"), lifeOnce, "Life task block must be idempotent");
// 旧版 <!-- --> 标记（0.30.2 及以前写入）仍可定位、更新与移除。
const legacyLifeDaily = "# 2026年7月20日\n\n<!-- jam-deck-life-task:legacy-life:start:v1 -->\n- [x] 旧生活\n<!-- jam-deck-life-task:legacy-life:end:v1 -->\n";
const legacyLifeFound = plugin.findLifeTaskBlock(legacyLifeDaily, "legacy-life", "2026-07-20");
assert(legacyLifeFound.range, "legacy html-comment markers must still be locatable");
const legacyLifeReplaced = plugin.upsertTaskInLifeDaily(legacyLifeDaily, { ...lifeTaskFixture, id: "legacy-life", text: "旧生活更新" }, "2026-07-20");
assert(legacyLifeReplaced.includes("- [x] 旧生活更新"), "replacing a legacy-blocked task must rewrite its content");
assert(legacyLifeReplaced.includes("%% jam-deck-life-task:legacy-life:start:v1 %%"), "rewritten legacy block must upgrade to hidden comment markers");
assert(plugin.removeTaskFromLifeDaily(legacyLifeDaily, "legacy-life").includes("# 2026年7月20日"), "legacy markers must also support removal");
const lifeRemoved = plugin.removeTaskFromLifeDaily(lifeOnce, lifeTaskFixture.id);
assert(lifeRemoved.includes("原有生活正文"));
assert(lifeRemoved.includes("# 2026年7月20日"));
assert(!lifeRemoved.includes("jam-deck-life-task:life-fixture"));
assert.throws(() => plugin.upsertTaskInLifeDaily("# 2026年7月20日\n\nA\n# 2026年7月20日\n\nB\n", lifeTaskFixture, "2026-07-20"), /重复日期标题/);
assert.throws(() => plugin.parseTaskLinks("危险 | javascript:alert(1)"), /仅支持/);

const legacy = standard
  .replace("## 工作内容\n\n- 原工作", `## 工作内容\n\n- 原工作\n\n${plugin.archiveMarker(task.id)}\n- 【设计】Jam Deck 详情`)
  .replace("## 效果图 / 视频\n", "## 效果图 / 视频\n\n- ![[attachments/jam-deck-task-assets/2026-07-20/test-task-test-1.png]]\n")
  .replace("## 链接\n", "## 链接\n\n- [Figma →](https://www.figma.com/file/test)\n")
  .replace("## 备注\n", "## 备注\n\n- 补齐图片与链接\n- 确认窄窗按钮\n");
const legacyUpgraded = plugin.upsertTaskInJournal(legacy, task);
assert(!plugin.scanJournal(legacyUpgraded).visibleLines.includes(plugin.archiveMarker(task.id)));
assert.strictEqual(plugin.getTaskBlockRanges(legacyUpgraded, task.id).count, 4, "safe legacy entry must upgrade to v2 blocks");
const removed = plugin.removeTaskFromJournal(legacyUpgraded, task);
assert.strictEqual(plugin.getTaskBlockRanges(removed, task.id).count, 0);
assert(removed.includes("- 原工作"), "unrelated journal content must survive removal");
assert.throws(() => plugin.upgradeLegacyTaskInJournal(legacy.replace("- 【设计】Jam Deck 详情", "- 用户改过的标题"), task), /无法安全同步/);

async function testAiLocalWebBootstrap() {
  assert.strictEqual(JamDeckPlugin.AI_LOCAL_WEB_URL, "http://127.0.0.1:3080/");
  assert.strictEqual(JamDeckPlugin.AI_LOCAL_WORKSPACE_PATH, "D:\\jam16\\Jamnote");
  assert.strictEqual(
    JamDeckPlugin.canonicalWindowsPath("D:/jam16/Jamnote/../Jamnote/"),
    "d:\\jam16\\jamnote",
    "local workspace matching must canonicalize Windows paths",
  );
  assert.strictEqual(JamDeckPlugin.canonicalWindowsPath("relative/Jamnote"), null, "local workspace matching must reject relative paths");

  let sent = null;
  const rpcValue = await JamDeckPlugin.dshRpc("workspace.list", {}, {
    rpcId: "rpc-fixed",
    timeoutMs: 100,
    transport: async (request) => {
      sent = request;
      return {
        status: 200,
        json: { type: "server-response", rpcId: "rpc-fixed", result: { ok: true, value: { items: [], archivedSessionIds: [] } } },
      };
    },
  });
  assert.deepStrictEqual(rpcValue, { items: [], archivedSessionIds: [] });
  assert.strictEqual(sent.url, "http://127.0.0.1:3080/api/workspace.list", "local RPC must stay on the fixed loopback endpoint");
  assert.deepStrictEqual(JSON.parse(sent.body), { type: "client-request", rpcId: "rpc-fixed", method: "workspace.list", payload: {} });
  assert.throws(
    () => JamDeckPlugin.dshValue({ status: 200, json: { type: "server-response", rpcId: "wrong", result: { ok: true, value: {} } } }, "expected", "workspace.list"),
    /协议数据/,
    "local RPC must reject a response for another request",
  );

  const workspace = { workspaceId: "ws-jamnote", path: "D:\\jam16\\Jamnote", title: "Jamnote", sessionIds: ["session-blank"] };
  const reuseCalls = [];
  const reused = await JamDeckPlugin.prepareDshWorkspace(async (method, payload) => {
    reuseCalls.push({ method, payload });
    if (method === "workspace.create") return { workspace, created: false };
    if (method === "workspace.list") return { items: [workspace], archivedSessionIds: [] };
    if (method === "session.list") return { items: [{ sessionId: "session-blank", cwd: "d:/jam16/jamnote", blank: true }] };
    throw new Error(`unexpected ${method}`);
  });
  assert.deepStrictEqual(reused, { workspaceId: "ws-jamnote", sessionId: "session-blank", created: false });
  assert.deepStrictEqual(reuseCalls.map((call) => call.method), ["workspace.create", "workspace.list", "session.list"]);

  const beforeCreateWorkspace = { ...workspace, sessionIds: ["session-archived"] };
  const afterCreateWorkspace = { ...workspace, sessionIds: ["session-archived", "session-new"] };
  let workspaceListCount = 0;
  const createCalls = [];
  const created = await JamDeckPlugin.prepareDshWorkspace(async (method, payload) => {
    createCalls.push({ method, payload });
    if (method === "workspace.create") return { workspace: beforeCreateWorkspace, created: false };
    if (method === "workspace.list") {
      workspaceListCount += 1;
      return { items: [workspaceListCount === 1 ? beforeCreateWorkspace : afterCreateWorkspace], archivedSessionIds: ["session-archived"] };
    }
    if (method === "session.list") {
      return workspaceListCount === 1
        ? { items: [{ sessionId: "session-archived", cwd: "D:\\jam16\\Jamnote", blank: true }] }
        : { items: [{ sessionId: "session-new", cwd: "D:\\jam16\\Jamnote", blank: true }] };
    }
    if (method === "session.create") return { sessionId: "session-new" };
    throw new Error(`unexpected ${method}`);
  });
  assert.deepStrictEqual(created, { workspaceId: "ws-jamnote", sessionId: "session-new", created: true });
  assert.deepStrictEqual(
    createCalls.map((call) => call.method),
    ["workspace.create", "workspace.list", "session.list", "session.create", "workspace.list", "session.list"],
    "local bootstrap must confirm a newly created session against fresh workspace and session baselines",
  );
  assert.deepStrictEqual(createCalls[3].payload, { workspaceId: "ws-jamnote" });

  await assert.rejects(
    JamDeckPlugin.prepareDshWorkspace(async (method) => method === "workspace.create"
      ? { created: false }
      : { items: [workspace, { ...workspace, workspaceId: "duplicate" }], archivedSessionIds: [] }),
    /注册重复/,
    "ambiguous canonical workspace registrations must fail closed",
  );
}

async function testArchiveIntegration() {
  const previousWindow = global.window;
  let notificationRecord = null;
  class TestNotification {
    constructor(title, options) {
      notificationRecord = { title, options };
    }
  }
  TestNotification.permission = "granted";
  global.window = { Notification: TestNotification, focus: () => {}, setTimeout, clearTimeout };
  const countdownPlugin = new JamDeckPlugin();
  const countdownWidget = { id: "clock-test", type: "clock", config: {} };
  countdownPlugin.settings = { widgets: [countdownWidget] };
  countdownPlugin.settingsSaveQueue = Promise.resolve();
  countdownPlugin.countdownCompletionLocks = new Set();
  countdownPlugin.saveData = async () => {};
  countdownPlugin.renderAllViews = () => {};
  countdownPlugin.sendWindowsNativeCountdownNotification = async () => {
    notificationRecord = { title: "Jam Deck · 倒计时结束", options: { body: "设定时间已到。" } };
    return true;
  };
  assert(await countdownPlugin.setCountdownEnabled("clock-test", true, "00:01"), "checking the countdown must start it");
  assert.strictEqual(countdownWidget.config.countdownDurationSec, 1);
  countdownWidget.config.countdownEndsAt = Date.now() - 1;
  const elapsedDeadline = countdownWidget.config.countdownEndsAt;
  assert(await countdownPlugin.completeCountdown("clock-test", elapsedDeadline), "an elapsed countdown must complete once");
  assert.strictEqual(countdownWidget.config.countdownEnabled, false, "completion must persist the countdown as stopped before notifying");
  assert(notificationRecord && notificationRecord.title.includes("Jam Deck"), "countdown completion must emit a system notification");
  const windowsToastScript = JamDeckPlugin.countdownHelpers.windowsToastScript();
  assert(windowsToastScript.includes("ToastGeneric"), "Windows native notification must use a supported toast template");
  assert(windowsToastScript.includes("CreateToastNotifier('md.obsidian')"), "Windows native notification must be attributed to Obsidian");

  const mediaPlugin = new JamDeckPlugin();
  let mediaSaveCount = 0;
  mediaPlugin.settings = {
    widgets: [{ id: "music-test", type: "music", config: {} }],
    musicLauncher: { schemaVersion: 1, lastConnectedProvider: null },
  };
  mediaPlugin.settingsSaveQueue = Promise.resolve();
  mediaPlugin.saveData = async () => { mediaSaveCount++; };
  mediaPlugin.musicArtworkUrls = new Map();
  mediaPlugin.musicSnapshot = { sessions: [], selected: null, revision: 0 };
  mediaPlugin.musicPending = null;
  mediaPlugin.updateMusicViews = () => {};
  mediaPlugin.adoptMusicSnapshot({
    bridgeGeneration: "bridge-a",
    snapshotSeq: 1,
    sessions: [{ sourceAppId: "QQMusic.exe", playbackStatus: "paused", sessionCount: 1, ambiguous: false }],
    selected: {
      sourceAppId: "QQMusic.exe",
      title: "Song",
      artist: "Artist",
      album: "Album",
      trackKey: "track-a",
      artworkKey: "art-a",
      artwork: null,
      playbackStatus: "paused",
      timeline: { positionMs: 1000, durationMs: 10000 },
      capabilities: { canToggle: true, canSeek: true },
    },
  });
  await mediaPlugin.settingsSaveQueue;
  assert.strictEqual(mediaPlugin.settings.musicLauncher.lastConnectedProvider, "qqmusic", "only a confirmed controllable provider may become the launch target");
  assert.strictEqual(mediaSaveCount, 1, "the first confirmed provider must persist once");
  mediaPlugin.adoptMusicSnapshot({
    bridgeGeneration: "bridge-a",
    snapshotSeq: 2,
    sessions: [{ sourceAppId: "QQMusic.exe", playbackStatus: "paused", sessionCount: 1, ambiguous: false }],
    selected: {
      sourceAppId: "QQMusic.exe",
      title: "Song",
      artist: "Artist",
      album: "Album",
      trackKey: "track-a",
      artworkKey: "art-a",
      artwork: null,
      playbackStatus: "paused",
      timeline: { positionMs: 1000, durationMs: 10000 },
      capabilities: { canToggle: true, canSeek: true },
    },
  });
  await mediaPlugin.settingsSaveQueue;
  assert.strictEqual(mediaSaveCount, 1, "repeated snapshots must not rewrite an unchanged launch provider");
  mediaPlugin.adoptMusicSnapshot({
    bridgeGeneration: "bridge-a",
    snapshotSeq: 3,
    sessions: [{ sourceAppId: "Chrome", playbackStatus: "playing", sessionCount: 1, ambiguous: false }],
    selected: {
      sourceAppId: "Chrome",
      title: "Web video",
      playbackStatus: "playing",
      timeline: { positionMs: 0, durationMs: 10000 },
      capabilities: { canToggle: true },
    },
  });
  assert.strictEqual(mediaPlugin.musicSnapshot.selected, null, "unrelated browser media must not replace the supported music source");
  assert.deepStrictEqual(mediaPlugin.musicSnapshot.sessions, [], "the source menu must contain only supported music sessions");

  const launchPlugin = new JamDeckPlugin();
  let launchPayload = null;
  let launchProbeStarted = false;
  launchPlugin.settings = {
    widgets: [{ id: "music-launch", type: "music", config: {} }],
    musicLauncher: { schemaVersion: 1, lastConnectedProvider: "qishui" },
  };
  launchPlugin.musicSnapshot = { connection: "ready", sessions: [], selected: null, revision: 1 };
  launchPlugin.musicPending = null;
  launchPlugin.mediaBridge = { ready: true, request: async (_type, payload) => { launchPayload = payload; return { accepted: true }; } };
  launchPlugin.ensureMusicMedia = async () => true;
  launchPlugin.updateMusicViews = () => {};
  launchPlugin.startMusicLaunchProbe = () => { launchProbeStarted = true; };
  assert(await launchPlugin.launchLastMusicProvider(launchPlugin.settings.widgets[0]), "play without a session must launch the last confirmed provider");
  assert.deepStrictEqual(launchPayload, { action: "launch_provider", provider: "qishui" }, "launch IPC must contain only an allowlisted provider enum");
  assert(launchProbeStarted, "a successful launch request must start one bounded discovery window");
  global.window = previousWindow;

  const pollPlugin = new JamDeckPlugin();
  const sampleBitmap = Buffer.alloc(24 * 24 * 4, 37);
  const pngBuffer = Buffer.from([1, 2, 3, 4]);
  const clipboardImage = {
    isEmpty: () => false,
    getSize: () => ({ width: 1145, height: 1204 }),
    resize: () => ({ toBitmap: () => sampleBitmap }),
    toPNG: () => pngBuffer,
  };
  let createdClipboardPath = "";
  let clipboardRefreshes = 0;
  pollPlugin.app = { vault: { createBinary: async (path) => { createdClipboardPath = path; } } };
  pollPlugin.clipboard = { readText: () => "https://image-source.example/", readImage: () => clipboardImage };
  pollPlugin.settings = { clipboardItems: [], clipboardMaxItems: 60 };
  pollPlugin.clipboardBusy = false;
  pollPlugin.lastText = "";
  pollPlugin.lastImageSignature = "";
  pollPlugin.saveSettings = async () => {};
  pollPlugin.renderClipboardViews = () => { clipboardRefreshes++; };
  pollPlugin.renderAllViews = () => { throw new Error("clipboard polling must not redraw the whole deck"); };
  assert(!pollPlugin.imageSignature(clipboardImage).includes("data:"), "image signature must use a sampled bitmap, not a data URL");
  await pollPlugin.pollClipboard();
  assert.strictEqual(pollPlugin.settings.clipboardItems[0].type, "image", "image must win over companion URL text");
  assert(createdClipboardPath.startsWith("attachments/jam-deck-clipboard/clip-"), "new image must be persisted immediately");
  assert.strictEqual(clipboardRefreshes, 1, "only clipboard widgets should refresh");

  const files = new Map();
  const folders = new Set();
  const vault = {
    adapter: { getResourcePath: (path) => path },
    getFiles() {
      return Array.from(files.keys()).map((path) => ({ path, extension: path.split(".").pop(), basename: path.split("/").pop().replace(/\.[^.]+$/, "") }));
    },
    getAbstractFileByPath(path) {
      if (files.has(path)) return { path, kind: "file", extension: path.split(".").pop(), basename: path.split("/").pop().replace(/\.[^.]+$/, ""), stat: { mtime: 1 } };
      if (folders.has(path)) return { path, kind: "folder" };
      return null;
    },
    async createFolder(path) { folders.add(path); return { path }; },
    async create(path, content) {
      if (files.has(path)) throw new Error("already exists");
      files.set(path, content);
      return { path };
    },
    async createBinary(path, content) {
      if (files.has(path)) throw new Error("already exists");
      files.set(path, content);
      return { path };
    },
    async process(file, updater) { files.set(file.path, updater(files.get(file.path))); },
    async read(file) { return files.get(file.path); },
    async readBinary(file) { return files.get(file.path); },
    async delete(file) { files.delete(file.path); },
  };
  const instance = new JamDeckPlugin();
  instance.app = { vault, workspace: { getLeavesOfType: () => [] } };
  instance.settingsSaveQueue = Promise.resolve();
  instance.archiveQueue = Promise.resolve();
  instance.archivingTaskIds = new Set();
  instance.renderAllViews = () => {};
  instance.saveData = async () => {};
  instance.settings = {
    dataVersion: 3,
    clipboardItems: [],
    widgets: [
      { id: "launcher-test", type: "launcher", config: { shortcuts: [] } },
      { id: "launcher-url-test", type: "launcher", config: { shortcuts: [] } },
    ],
    deckTasks: [{ ...task, status: "completed", createdAt: 1, completedAt: 2, archivedAt: null, journalPath: null, archiveFormat: null, archiveTargetDate: null, archiveTargetPath: null }],
  };
  files.set("Work/Test.canvas", JSON.stringify({ nodes: [], edges: [] }));
  files.set("attachments/jam-deck-clipboard/clip-persist.png", Buffer.from([9, 8, 7]));
  files.set(task.images[0].path, Buffer.from([1, 3, 3, 7]));
  instance.app.fileManager = {
    getAvailablePathForAttachment: async (filename, sourcePath) =>
      String(sourcePath) === "Life/Daily.md" || String(sourcePath) === "Life/生活日记.md"
        ? `Life/附件/${filename}`
        : String(sourcePath).endsWith(".md")
        ? `Work/工作日记/附件/${filename}`
        : "attachments/jam-deck-clipboard/clip-persist.png",
  };

  const canonical = instance.normalizeHttpUrl("https://WWW.Example.com:443/path?q=1#section");
  assert.strictEqual(canonical.url, "https://www.example.com/path?q=1", "URL canonicalization must remove default ports and fragments");
  assert.strictEqual(instance.normalizeHttpUrl("https://user:secret@example.com/"), null, "credential URLs must be rejected");
  assert.strictEqual(instance.normalizeHttpUrl("javascript:alert(1)"), null, "non-http URL schemes must be rejected");
  assert.strictEqual(instance.normalizeHttpUrl("https://example.com/a\nhttps://example.com/b"), null, "multi-line plain text must not be mined for URLs");
  assert.deepStrictEqual(instance.parseLauncherUriList("# browser drag\nhttps://example.com/a#x\n\nhttps://example.com/a"), ["https://example.com/a"], "URI lists must ignore comments and canonical-dedupe URLs");

  files.set("attachments/jam-deck-icons/sc-webp-test.webp", Buffer.from([8, 0, 8, 0]));
  const webpShortcut = { id: "sc-webp-test", name: "Converted", path: "C:\\Apps\\Converted.exe", isFolder: false, iconPath: "attachments/jam-deck-icons/sc-webp-test.png" };
  instance.settings.widgets[1].config.shortcuts.push(webpShortcut);
  assert.strictEqual(instance.resolveShortcutIconPath(webpShortcut), "attachments/jam-deck-icons/sc-webp-test.webp", "a unique same-stem WebP must replace a missing PNG at render time");
  await instance.saveShortcut("launcher-url-test", webpShortcut.id, webpShortcut.name, webpShortcut.path);
  assert.strictEqual(webpShortcut.iconPath, "attachments/jam-deck-icons/sc-webp-test.webp", "direct shortcut save must write back a verified WebP fallback");

  instance.settings.clipboardItems.push({ ts: 101, type: "text", content: "https://www.figma.com/design/test#node" });
  await instance.handleLauncherDrop("launcher-url-test", {
    types: ["application/x-jam-deck-clipboard+json", "text/plain"],
    files: [],
    getData: (type) => type === "application/x-jam-deck-clipboard+json" ? JSON.stringify({ ts: 101, type: "text" }) : "https://www.figma.com/design/test#node",
  });
  const urlWidget = instance.settings.widgets[1];
  const figmaShortcut = urlWidget.config.shortcuts.find((entry) => entry.kind === "url");
  assert(figmaShortcut, "clipboard URL drag must create a URL shortcut");
  assert.strictEqual(figmaShortcut.name, "figma.com", "URL shortcut names must be generated from the hostname without network access");
  assert.strictEqual(figmaShortcut.url, "https://www.figma.com/design/test", "URL shortcut storage must be canonical");
  const urlCount = urlWidget.config.shortcuts.length;
  await instance.addUrlShortcuts("launcher-url-test", ["https://www.figma.com:443/design/test#again"]);
  assert.strictEqual(urlWidget.config.shortcuts.length, urlCount, "canonical duplicate URL drops must not create another shortcut");

  await instance.handleLauncherDrop("launcher-url-test", {
    types: ["text/uri-list"],
    files: [],
    getData: (type) => type === "text/uri-list" ? "# links\nhttps://obsidian.md/\nhttps://example.org/docs" : "",
  });
  assert(urlWidget.config.shortcuts.some((entry) => entry.url === "https://obsidian.md/"), "multi-URL URI lists must be accepted");
  const beforeInvalidText = urlWidget.config.shortcuts.length;
  assert.strictEqual(await instance.handleLauncherDrop("launcher-url-test", { types: ["text/plain"], files: [], getData: () => "read https://example.com later" }), false);
  assert.strictEqual(urlWidget.config.shortcuts.length, beforeInvalidText, "ordinary text containing a URL must not create a shortcut");

  const beforeOrder = urlWidget.config.shortcuts.map((entry) => entry.id);
  const moveId = beforeOrder[0];
  const reorderResult = await instance.reorderShortcut("launcher-url-test", moveId, null, true);
  assert(reorderResult && reorderResult.ok, "same-grid launcher reorder must persist");
  assert.strictEqual(urlWidget.config.shortcuts.at(-1).id, moveId, "blank-grid reorder must move the item to the end");
  const stableOrder = urlWidget.config.shortcuts.map((entry) => entry.id);
  const realSaveSettings = instance.saveSettings.bind(instance);
  instance.saveSettings = async () => { throw new Error("simulated shortcut save failure"); };
  const rollbackResult = await instance.reorderShortcut("launcher-url-test", stableOrder.at(-1), stableOrder[0], false);
  assert(rollbackResult && !rollbackResult.ok, "failed reorder must report rollback");
  assert.deepStrictEqual(urlWidget.config.shortcuts.map((entry) => entry.id), stableOrder, "failed reorder must restore the exact previous order");
  instance.saveSettings = realSaveSettings;

  let openedExternal = "";
  let openedPath = "";
  const realModuleLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === "electron") return { shell: { openExternal: async (url) => { openedExternal = url; }, openPath: async (value) => { openedPath = value; return ""; } } };
    return realModuleLoad.call(this, request, parent, isMain);
  };
  await instance.openShortcut(figmaShortcut);
  await instance.openShortcut({ id: "local-open", path: "C:\\Apps\\Local.exe", name: "Local", isFolder: false });
  Module._load = realModuleLoad;
  assert.strictEqual(openedExternal, figmaShortcut.url, "URL shortcuts must use the system browser");
  assert.strictEqual(openedPath, "C:\\Apps\\Local.exe", "local shortcuts must keep using openPath");

  const persistentCanvasImage = await instance.createCanvasAttachmentFromClipboard(
    { type: "image", filename: "clip-persist.png" },
    "Work/Test.canvas",
    new AbortController().signal
  );
  assert(persistentCanvasImage.path.startsWith("attachments/jam-deck-canvas-assets/"), "Canvas attachments must escape the temporary clipboard folder");
  assert(files.has(persistentCanvasImage.path), "persistent Canvas attachment must be written before node creation");
  await instance.removeClipboardAttachment("clip-persist.png");
  assert(files.has(persistentCanvasImage.path), "clearing a clipboard source must not delete its Canvas attachment");

  // 0.30 统一归档格式：默认 file 模式（单文件按日期分节，简单块）。
  instance.settings.workArchiveMode = "file";
  instance.settings.workArchiveFile = "Work/工作.md";
  await instance.archiveDeckTask(task.id);
  assert.strictEqual(instance.settings.deckTasks[0].status, "archived");
  const journalPath = instance.settings.deckTasks[0].journalPath;
  assert.strictEqual(journalPath, "Work/工作.md", "work archive must honor file mode path");
  assert.strictEqual(instance.settings.deckTasks[0].archiveFormat, "simple-v1");
  assert.strictEqual(instance.settings.deckTasks[0].archiveRef.kind, "work-daily-v3", "work archive must use the unified simple format kind");
  const workMarkdown = files.get(journalPath);
  assert(instance.findLifeTaskBlock(workMarkdown, task.id).range, "work simple format must create one dated block");
  assert(workMarkdown.includes("  - 分类：工作"), "work simple block must carry the work category");
  assert(workMarkdown.includes(`![[${instance.settings.deckTasks[0].images[0].path}]]`), "journal must reference the migrated attachment");
  assert(!files.has(task.images[0].path), "a newly archived task-owned source should be removed only after settings commit");

  const archived = instance.settings.deckTasks[0];
  const edited = { ...archived, text: "编辑后的归档" };
  await instance.replaceArchivedTaskInJournal(archived, edited);
  archived.text = edited.text;
  assert(files.get(journalPath).includes("- [x] 编辑后的归档"), "simple format edit must rewrite the task title line");

  assert(await instance.restoreArchivedTask(task.id));
  assert.strictEqual(instance.settings.deckTasks[0].status, "active");
  assert(!instance.findLifeTaskBlock(files.get(journalPath), task.id).range, "restore must remove the simple block");

  instance.settings.deckTasks[0].status = "completed";
  instance.settings.deckTasks[0].completedAt = 3;
  await instance.archiveDeckTask(task.id);
  assert.strictEqual(instance.settings.deckTasks[0].archiveRef.kind, "life-daily", "an unclassified title without 【】 must auto-archive as life");
  assert(instance.findLifeTaskBlock(files.get("Life/Daily.md"), task.id).range, "re-archive must create one life block");
  assert(await instance.deleteArchivedTask(task.id, true));
  assert.strictEqual(instance.settings.deckTasks.length, 0);
  assert(!instance.findLifeTaskBlock(files.get(journalPath), task.id).range, "purge must remove journal blocks");

  await instance.createTaskFromDroppedText("拖入标题\n拖入说明");
  assert.strictEqual(instance.settings.deckTasks[0].text, "拖入标题");
  assert.strictEqual(instance.settings.deckTasks[0].description, "拖入说明");

  await instance.createTaskFromExternalImages([{ name: "drop.png", type: "image/png", arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }]);
  assert.strictEqual(instance.settings.deckTasks[0].images.length, 1);
  assert(instance.settings.deckTasks[0].images[0].path.startsWith("attachments/jam-deck-task-assets/"));
  const droppedTaskId = instance.settings.deckTasks[0].id;
  await instance.appendDropToTask(droppedTaskId, {
    types: ["text/plain"],
    files: [],
    getData: (type) => type === "text/plain" ? "追加到说明" : "",
  });
  assert.strictEqual(instance.settings.deckTasks[0].description, "追加到说明");
  await instance.appendDropToTask(droppedTaskId, {
    types: ["Files"],
    files: [{ name: "second.png", type: "image/png", arrayBuffer: async () => new Uint8Array([4, 5, 6]).buffer }],
    getData: () => "",
  });
  assert.strictEqual(instance.settings.deckTasks[0].images.length, 2, "drop on existing task must append images");
  assert(await instance.deleteDeckTask(droppedTaskId));
  assert(!instance.settings.deckTasks.some((item) => item.id === droppedTaskId), "active task delete must remove the task");

  const dropFolder = os.tmpdir();
  await instance.addDroppedShortcuts("launcher-test", [{ name: "work", path: dropFolder }]);
  assert.strictEqual(instance.settings.widgets[0].config.shortcuts.length, 1);
  assert.strictEqual(instance.settings.widgets[0].config.shortcuts[0].isFolder, true);
  const shortcutId = instance.settings.widgets[0].config.shortcuts[0].id;
  await instance.deleteShortcut("launcher-test", shortcutId);
  assert.strictEqual(instance.settings.widgets[0].config.shortcuts.length, 0, "shortcut delete must remove only the launcher entry");
  files.set("attachments/user-owned/custom.webp", Buffer.from([4, 2]));
  instance.settings.widgets[0].config.shortcuts.push({ id: "sc-user-icon", name: "User icon", path: "C:\\Apps\\User.exe", isFolder: false, iconPath: "attachments/user-owned/custom.webp" });
  await instance.deleteShortcut("launcher-test", "sc-user-icon");
  assert(files.has("attachments/user-owned/custom.webp"), "shortcut deletion must never remove an icon outside the managed icon directory");

  assert(await instance.addCanvasEmbedWidget("Work/Test.canvas"));
  const canvasWidget = instance.settings.widgets.find((item) => item.type === "canvas-embed");
  assert(canvasWidget && canvasWidget.config.filePath === "Work/Test.canvas", "native canvas widget must persist a vault-relative path");
  await instance.handleCanvasFileRenamed({ path: "Work/Renamed.canvas", extension: "canvas" }, "Work/Test.canvas");
  assert.strictEqual(canvasWidget.config.filePath, "Work/Renamed.canvas", "canvas rename must update widget configuration");

  const retrySourcePath = "attachments/jam-deck-task-assets/2026-07-20/retry-task-retry.png";
  files.set(retrySourcePath, Buffer.from([8, 6, 7, 5, 3, 0, 9]));
  const retryTask = { ...task, id: "task-retry", images: [{ id: "retry-image", path: retrySourcePath, caption: "retry.png" }], status: "completed", createdAt: 10, completedAt: 11, archivedAt: null, journalPath: null, archiveFormat: null, archiveTargetDate: null, archiveTargetPath: null };
  instance.settings.deckTasks.unshift(retryTask);
  let saveCalls = 0;
  instance.saveData = async () => { if (++saveCalls === 2) throw new Error("simulated final save failure"); };
  const originalConsoleError = console.error;
  console.error = () => {};
  await instance.archiveDeckTask(retryTask.id);
  console.error = originalConsoleError;
  assert.strictEqual(retryTask.status, "completed");
  assert(retryTask.archiveTargetPath, "failed final save must retain deterministic target path");
  assert(instance.findLifeTaskBlock(files.get(retryTask.archiveTargetPath), retryTask.id).range, "failed save must still stage a simple block");
  assert(files.has(retrySourcePath), "settings failure must retain the original task attachment");
  instance.saveData = async () => {};
  await instance.archiveDeckTask(retryTask.id);
  assert.strictEqual(retryTask.status, "archived");
  assert.strictEqual(retryTask.journalPath, "Work/工作.md", "retry must keep the file-mode target");
  assert(instance.findLifeTaskBlock(files.get(retryTask.journalPath), retryTask.id).range, "retry must not duplicate simple blocks");
  assert(!files.has(retrySourcePath), "successful retry may clean the proven task-owned source");

  const historicalSource = "attachments/jam-deck-task-assets/2026-07-21/history-task-history.png";
  const historicalPath = "Work/工作日记/2026-07-21.md";
  const historicalTask = {
    ...task,
    id: "task-history",
    status: "archived",
    archivedAt: Date.now(),
    journalPath: historicalPath,
    archiveFormat: "section-v2",
    images: [{ id: "history-image", path: historicalSource, caption: "history.png" }],
  };
  files.set(historicalSource, Buffer.from([2, 4, 6, 8]));
  files.set(historicalPath, instance.buildNewDailyJournal(instance.getDayContextFromPath(historicalPath), historicalTask));
  instance.settings.deckTasks.push(historicalTask);
  const migration = await instance.migrateArchivedTaskAssets();
  assert.strictEqual(migration.migrated, 1, "eligible historical archives should migrate once");
  assert(historicalTask.images[0].path.startsWith("Work/工作日记/附件/"));
  assert(files.get(historicalPath).includes(`![[${historicalTask.images[0].path}]]`));
  assert(files.has(historicalSource), "historical migration must preserve the old source as a safety copy");
  const repeatedMigration = await instance.migrateArchivedTaskAssets();
  assert.strictEqual(repeatedMigration.migrated, 0, "historical migration must be idempotent");

  // 0.30 目录模式：工作归档落到 dir/dateKey.md，且同样走统一简单块。
  const dirModeTask = { ...task, id: "task-dirmode", images: [], status: "completed", createdAt: 20, completedAt: 21, archivedAt: null, journalPath: null, archiveFormat: null, archiveTargetDate: null, archiveTargetPath: null };
  instance.settings.deckTasks.unshift(dirModeTask);
  instance.settings.workArchiveMode = "dir";
  instance.settings.workArchiveDir = "Work/工作日记";
  const dirModeDateKey = instance.getLocalDayContext(new Date()).date;
  await instance.archiveDeckTask(dirModeTask.id);
  assert.strictEqual(dirModeTask.status, "archived");
  assert.strictEqual(dirModeTask.archiveRef.kind, "work-daily-v3");
  assert.strictEqual(dirModeTask.journalPath, `Work/工作日记/${dirModeDateKey}.md`, "dir mode must archive into the dated file");
  assert(instance.findLifeTaskBlock(files.get(`Work/工作日记/${dirModeDateKey}.md`), dirModeTask.id).range, "dir mode must write the unified simple block");
  assert(await instance.deleteArchivedTask(dirModeTask.id, true));
  instance.settings.workArchiveMode = "file";

  const draftId = await instance.createDeckTaskFromDraft({
    text: "体检预约",
    description: "带身份证",
    links: [],
    images: [],
    pendingFiles: [],
    category: "life",
    dueDate: "2026-07-30",
  });
  const drafted = instance.getDeckTask(draftId);
  assert.strictEqual(drafted.category, "life");
  assert.strictEqual(drafted.dueDate, "2026-07-30");

  const lifeSource = "attachments/jam-deck-task-assets/2026-07-22/photo-task-life.png";
  files.set(lifeSource, Buffer.from([5, 5, 8, 9]));
  const lifeArchiveTask = instance.makeDeckTask("task-life", "家庭照片整理", "周末处理", [{ id: "life-image", path: lifeSource, caption: "photo.png" }], { category: "life", dueDate: "2026-07-31" });
  lifeArchiveTask.status = "completed";
  lifeArchiveTask.completedAt = Date.now();
  instance.settings.deckTasks.unshift(lifeArchiveTask);
  await instance.archiveDeckTask(lifeArchiveTask.id);
  assert.strictEqual(lifeArchiveTask.status, "archived");
  assert.strictEqual(lifeArchiveTask.archiveRef.kind, "life-daily");
  assert(lifeArchiveTask.images[0].path.startsWith("Life/附件/"), "life archive images must use Life/Daily's attachment context");
  const lifeMarkdown = files.get("Life/Daily.md");
  assert(instance.findLifeTaskBlock(lifeMarkdown, lifeArchiveTask.id).range);
  assert(lifeMarkdown.includes("  - 截止：2026-07-31"));
  assert(!files.has(lifeSource), "committed life archive may clean its proven task-owned source");
  assert(await instance.restoreArchivedTask(lifeArchiveTask.id));
  assert(!instance.findLifeTaskBlock(files.get("Life/Daily.md"), lifeArchiveTask.id).range, "life restore must remove only its stable block");

  // 归档模式与路径（0.30）：缺省回退内置常量，mode 决定 file/dir。
  instance.settings.workArchiveMode = "file";
  instance.settings.workArchiveFile = "";
  instance.settings.lifeArchiveMode = "file";
  instance.settings.lifeArchivePath = "";
  assert.strictEqual(instance.getWorkArchiveMode(), "file", "empty work mode must fall back to file");
  assert.strictEqual(instance.getLifeArchiveMode(), "file", "empty life mode must fall back to file");
  assert.strictEqual(instance.getWorkArchiveFile(), "Work/工作.md", "empty work file must fall back to the built-in default");
  assert.strictEqual(instance.getLifeArchivePath(), "Life/Daily.md", "empty life archive path must fall back to the built-in default");
  assert.strictEqual(instance.getWorkArchiveTargetPath("2026-07-31"), "Work/工作.md", "file mode must ignore the date in the target path");
  assert.strictEqual(instance.getLifeArchiveTargetPath("2026-07-31"), "Life/Daily.md", "file mode must keep the single-file target");
  instance.settings.workArchiveMode = "dir";
  instance.settings.workArchiveDir = "Journal/Work";
  instance.settings.lifeArchiveMode = "dir";
  instance.settings.lifeArchiveDir = "Journal/Life";
  assert.strictEqual(instance.getWorkArchiveTargetPath("2026-07-31"), "Journal/Work/2026-07-31.md", "dir mode must build a dated work file");
  assert.strictEqual(instance.getLifeArchiveTargetPath("2026-07-31"), "Journal/Life/2026-07-31.md", "dir mode must build a dated life file");
  instance.settings.workArchiveMode = "file";
  instance.settings.workArchiveFile = "Journal/Work.md";
  instance.settings.lifeArchiveMode = "file";
  instance.settings.lifeArchivePath = "Journal/Life.md";
  const customRef = instance.buildArchiveRef(lifeArchiveTask, "2026-07-31", "life");
  assert.strictEqual(customRef.notePath, "Journal/Life.md", "life archive ref must honor the configured file");
  const customWorkRef = instance.buildArchiveRef(lifeArchiveTask, "2026-07-31", "work");
  assert.strictEqual(customWorkRef.notePath, "Journal/Work.md", "work archive ref must honor the configured file");
  assert.strictEqual(customWorkRef.kind, "work-daily-v3", "work archive ref must use the unified simple kind");
}

testCanvasCreateName();
testAiLocalWebBootstrap().then(() => testArchiveIntegration()).then(() => testCanvasNativeConflictLifecycle()).then(() => testCanvasAsyncTeardown()).then(() => {
  console.log("jam-deck fixtures: passed");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
