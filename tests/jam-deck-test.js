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
const pluginSource = fs.readFileSync(mainPath, "utf8");
const styleSource = fs.readFileSync(stylePath, "utf8");
assert(pluginSource.includes("new WorkspaceLeaf(this.app)"), "Canvas widget must create a real WorkspaceLeaf");
assert(pluginSource.includes("leaf.openFile(file, { active: false })"), "Canvas widget must open the canvas inside its owned leaf");
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
assert(styleSource.includes("translate: var(--jd-stack-bystander-x) var(--jd-stack-bystander-y);"), "reduced motion must retain the final bystander displacement");
assert(pluginSource.includes("getCanvasItems()") && pluginSource.includes("for (const item of this.getCanvasItems())"), "focus displacement must enumerate every Canvas node type");
assert(styleSource.includes(".canvas-node.is-jam-deck-stack-bystander {"), "focus displacement must move the complete Canvas node surface");
assert(styleSource.includes("rgb(248 249 250 / 0.70)"), "Spatial focus preview must ghost the light Canvas background");
assert(styleSource.includes("rgb(29 31 35 / 0.62)"), "Spatial focus preview must ghost the dark Canvas background");
assert(styleSource.includes("0 22px 44px rgb(15 23 42 / 0.22)"), "dragged Canvas images must have a perceptible soft elevation");
assert(styleSource.includes("transform 300ms cubic-bezier(.22, 1, .36, 1)"), "stack previews must use the Spatial enter rhythm");
assert(styleSource.includes("transition-duration: 260ms"), "stack previews must reverse to their source geometry");
assert(styleSource.includes(".is-jam-deck-stack-source-ghost") && styleSource.includes("opacity: 0;"), "source stack visuals must fully yield to their moving FLIP copies");
assert(styleSource.includes("translate3d(0, 0, 0) scale(1)"), "stack preview copies must begin at the exact source geometry");
assert(pluginSource.includes("wrapper.getBoundingClientRect();"), "stack preview must commit its source frame before starting FLIP motion");
assert(pluginSource.includes("this.previewWrapper === wrapper") && pluginSource.includes('!wrapper.hasClass("is-closing")'), "delayed preview motion must not reopen a closing stack");
assert(pluginSource.includes("this.ownerWindow.requestAnimationFrame(() =>"), "stack previews must coordinate work with animation frames");
assert(pluginSource.includes("this.togglePreview(cluster)"), "stack previews must toggle from a completed click");
assert(pluginSource.includes("Math.hypot(next.clientX - drag.startClientX, next.clientY - drag.startClientY) >= 5"), "stack clicks must yield to image drags after a movement threshold");
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
assert(pluginSource.includes("JAM_DECK_STACK_TEXT_PREVIEW_FONT_PX / Math.max(0.01, targetScale)"), "text preview font size must counter-scale the FLIP card");
assert(pluginSource.includes("JAM_DECK_STACK_TEXT_PREVIEW_PADDING_PX / Math.max(0.01, targetScale)"), "text preview padding must remain fixed in screen space");
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
assert(styleSource.includes("prefers-reduced-motion") && styleSource.includes(".jam-deck-countdown-flip-digit.is-flipping { animation: none; }"), "countdown flip motion must respect reduced-motion preferences");
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
assert(styleSource.includes("prefers-reduced-motion: reduce"), "launcher motion must respect reduced-motion preferences");
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
assert(styleSource.includes(".jam-deck-music-disc,") && styleSource.includes("animation: none !important;"), "reduced motion must stop CD rotation");
assert(pluginSource.includes("function jamDeckPreviewWidgetLayout"), "dashboard edit drag must expose a pure layout preview engine");
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
assert(pluginSource.includes("function jamDeckCollectLayoutNodes") && pluginSource.includes("function jamDeckApplySashDelta"), "browse mode must expose gap-node sash helpers");
assert(pluginSource.includes("enableLayoutSashes") && pluginSource.includes("!this.plugin.settings.editMode"), "gap nodes must only mount outside edit mode");
assert(styleSource.includes(".jam-deck-sash-dot") && styleSource.includes(".jam-deck-sash-handle"), "gap nodes must render as small hover dots");
assert(pluginSource.includes("canCommit"), "floating drag must separate hover preview from commit eligibility");
assert(pluginSource.includes("translate3d(") && pluginSource.includes("scale(1.02)"), "dragged widgets must float with a lifted transform");
assert(pluginSource.includes("commitWidgetLayout"), "dashboard drag release must commit a full layout snapshot");
assert(pluginSource.includes("is-layout-dragging"), "dashboard drag preview must mark the grid while rearranging");
assert(pluginSource.includes("jam-deck-layout-slot"), "gap previews must render through a dedicated slot overlay");
assert(styleSource.includes(".jam-deck-layout-slot"), "gap fill previews must have a green gradient stroke rectangle");
assert(styleSource.includes(".jam-deck-widget.is-layout-seam-bottom::after") && styleSource.includes(".jam-deck-widget.is-layout-seam-right::after"), "gapless seams must light the facing neighbor edges");
assert(styleSource.includes("0 18px 40px rgb(15 20 18 / 0.22)"), "dragged widgets must float with a soft elevation shadow");
assert(styleSource.includes("@media (prefers-reduced-motion: reduce)") && styleSource.includes(".jam-deck-grid.is-layout-dragging .jam-deck-widget:not(.is-moving) { transition: none; }"), "dashboard rearrange motion must yield to reduced motion");

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "obsidian") {
    class Base {}
    return { ItemView: Base, Modal: Base, Notice: Base, Plugin: Base, WorkspaceLeaf: Base, setIcon: () => {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const JamDeckPlugin = require(mainPath);
Module._load = originalLoad;

const widgetLayout = JamDeckPlugin.widgetLayoutHelpers;
assert(widgetLayout, "widget layout helpers must be exported for deterministic fixtures");
assert(styleSource.includes(".jam-deck-widget.is-compact") && styleSource.includes(".jam-deck-widget-compact-icon"), "undersized widgets must render the shared watermark surface");
assert(pluginSource.includes("!jamDeckWidgetIsCompact(widget)"), "compact Canvas widgets must be excluded from the live runtime set");
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
assert(lifeOnce.includes("<!-- jam-deck-life-task:life-fixture:start:v1 -->"));
assert(lifeOnce.includes("  - 截止：2026-07-25"));
assert.strictEqual(plugin.upsertTaskInLifeDaily(lifeOnce, lifeTaskFixture, "2026-07-20"), lifeOnce, "Life task block must be idempotent");
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
      String(sourcePath) === "Life/Daily.md"
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

  await instance.archiveDeckTask(task.id);
  assert.strictEqual(instance.settings.deckTasks[0].status, "archived");
  const journalPath = instance.settings.deckTasks[0].journalPath;
  assert.strictEqual(instance.getTaskBlockRanges(files.get(journalPath), task.id).count, 4);
  assert.strictEqual(instance.settings.deckTasks[0].archiveFormat, "section-v2");
  assert(instance.settings.deckTasks[0].images[0].path.startsWith("Work/工作日记/附件/"), "archived task images must move into the journal attachment folder");
  assert(files.get(journalPath).includes(`![[${instance.settings.deckTasks[0].images[0].path}]]`), "journal must reference the migrated attachment");
  assert(!files.has(task.images[0].path), "a newly archived task-owned source should be removed only after settings commit");

  const archived = instance.settings.deckTasks[0];
  const edited = { ...archived, text: "编辑后的归档" };
  await instance.replaceArchivedTaskInJournal(archived, edited);
  archived.text = edited.text;
  assert(files.get(journalPath).includes("- 编辑后的归档"));

  assert(await instance.restoreArchivedTask(task.id));
  assert.strictEqual(instance.settings.deckTasks[0].status, "active");
  assert.strictEqual(instance.getTaskBlockRanges(files.get(journalPath), task.id).count, 0);

  instance.settings.deckTasks[0].status = "completed";
  instance.settings.deckTasks[0].completedAt = 3;
  await instance.archiveDeckTask(task.id);
  assert.strictEqual(instance.settings.deckTasks[0].archiveRef.kind, "life-daily", "an unclassified title without 【】 must auto-archive as life");
  assert(instance.findLifeTaskBlock(files.get("Life/Daily.md"), task.id).range, "re-archive must create one life block");
  assert(await instance.deleteArchivedTask(task.id, true));
  assert.strictEqual(instance.settings.deckTasks.length, 0);
  assert.strictEqual(instance.getTaskBlockRanges(files.get(journalPath), task.id).count, 0, "purge must remove journal blocks");

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
  assert.strictEqual(instance.getTaskBlockRanges(files.get(retryTask.archiveTargetPath), retryTask.id).count, 4);
  assert(files.has(retrySourcePath), "settings failure must retain the original task attachment");
  instance.saveData = async () => {};
  await instance.archiveDeckTask(retryTask.id);
  assert.strictEqual(retryTask.status, "archived");
  assert.strictEqual(instance.getTaskBlockRanges(files.get(retryTask.journalPath), retryTask.id).count, 4, "retry must not duplicate section blocks");
  assert(retryTask.images[0].path.startsWith("Work/工作日记/附件/"));
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
}

testArchiveIntegration().then(() => {
  console.log("jam-deck fixtures: passed");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
