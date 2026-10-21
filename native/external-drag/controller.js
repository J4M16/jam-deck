// Source for the external drag bundle. No Canvas node or settings writes.
function jamDeckExternalDragEntries(canvas, vault) {
  const entries = [];
  for (const [index, node] of Array.from(canvas?.selection?.values?.() || []).entries()) {
    const data = node?.getData?.();
    if (!data) continue;
    const order = { x: Number(data.x) || 0, y: Number(data.y) || 0, index };
    if (data.type === "text" && String(data.text || "").trim()) {
      entries.push({ ...order, kind: "text", value: String(data.text) });
    } else if (data.type === "link" && data.url) {
      entries.push({ ...order, kind: "link", value: String(data.url) });
    } else if (data.type === "file") {
      const file = vault.getAbstractFileByPath(data.file);
      if (file?.path && !Array.isArray(file.children)) entries.push({ ...order, kind: "file", value: file.path });
    }
  }
  return entries.sort((a, b) => a.y - b.y || a.x - b.x || a.index - b.index);
}

function jamDeckRenderedPlainText(root) {
  const blocks = new Set(["P", "DIV", "SECTION", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "PRE", "TABLE", "TR"]);
  const visit = node => {
    if (node.nodeType === 3) return node.nodeValue || "";
    const tag = String(node.tagName || "").toUpperCase();
    if (["SCRIPT", "STYLE", "BUTTON"].includes(tag) || node.getAttribute?.("aria-hidden") === "true") return "";
    if (tag === "BR") return "\n";
    if (tag === "INPUT") return node.checked ? "[x] " : "[ ] ";
    const text = Array.from(node.childNodes || []).map(visit).join("");
    if (tag === "LI") return `• ${text.trim()}\n`;
    if (tag === "TD" || tag === "TH") return `${text}\t`;
    return blocks.has(tag) ? `${text.replace(/\n+$/, "")}\n\n` : text;
  };
  // Markdown rendering already resolves escapes. A second unescape would damage code.
  return visit(root).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function jamDeckBuildExternalDragPayload(entries, { plainText, absolutePath, writeTextFile }) {
  const texts = [], files = [], seen = new Set();
  for (const entry of entries) {
    if (entry.kind === "file") {
      const path = absolutePath(entry.value);
      if (!seen.has(path)) { seen.add(path); files.push(path); }
    } else {
      const text = entry.kind === "link" ? entry.value : await plainText(entry.value);
      if (text.trim()) texts.push(text.trim());
    }
  }
  const text = texts.join("\n\n");
  const textFile = text ? await writeTextFile(text, files) : "";
  return { text, textFile, files };
}

function jamDeckExternalDragPacket(payload, ownerPid) {
  const parts = [Buffer.from("JD01")];
  const number = value => { const b = Buffer.alloc(4); b.writeUInt32LE(value); parts.push(b); };
  const string = value => { const b = Buffer.from(value, "utf16le"); number(b.length); parts.push(b); };
  number(ownerPid);
  string(payload.text); string(payload.textFile);
  number(payload.files.length); payload.files.forEach(string);
  return Buffer.concat(parts);
}

function jamDeckExternalDragBinary(platform) {
  const fs = require("fs");
  const payload = platform === "win32" ? WINDOWS_EXTERNAL_DRAG_PAYLOAD : MACOS_EXTERNAL_DRAG_PAYLOAD;
  const bytes = zlib.gunzipSync(Buffer.from(payload.gzip, "base64"));
  const hash = value => crypto.createHash("sha256").update(value).digest("hex");
  if (hash(bytes) !== payload.sha256) throw Error("拖出辅助程序校验失败");
  const directory = nodePath.join(require("os").tmpdir(), "jam-deck-external-drag", "bin");
  fs.mkdirSync(directory, { recursive: true });
  const executable = nodePath.join(directory, payload.sha256 + ".node");
  if (!fs.existsSync(executable) || hash(fs.readFileSync(executable)) !== payload.sha256) fs.writeFileSync(executable, bytes, { mode: 0o700 });
  return executable;
}

class JamDeckExternalDragController {
  constructor(toolbar) {
    this.toolbar = toolbar;
    this.plugin = toolbar.runtime.deckView.plugin;
    this.button = null;
    this.prepared = null;
    this.pressed = null;
    this.signature = "";
    this.failed = false;
    this.generation = 0;
    this.destroyed = false;
    this.active = false;
    this.cancelNative = null;
    this.cancelGesture = null;
    this.windowsNative = null;
  }

  sync(menu, blocked) {
    if (this.destroyed) return;
    if (!menu) {
      if (this.button) this.button.style.display = "none";
      return;
    }
    if (!this.button?.isConnected || this.button.parentElement !== menu) {
      this.button?.remove();
      const button = this.toolbar.entry.ownerDocument.createElement("button");
      button.type = "button";
      button.className = "clickable-icon jam-deck-canvas-drag-out";
      button.draggable = false;
      button.setAttribute("aria-label", "拖出所选内容");
      button.setAttribute("title", "拖到应用或桌面；桌面正文保存为 TXT");
      setIcon(button, "share");
      button.addEventListener("pointerdown", event => this.beginGesture(event, menu), true);
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!this.active) new Notice("Jam Deck：按住此图标，拖到目标应用或桌面后松开");
      });
      menu.appendChild(button);
      this.button = button;
    }
    // Canvas can replace its entire menu during a native drag. Maintain the
    // handle before pausing payload preparation; the old DOM may be detached.
    this.button.disabled = this.active;
    this.button.setAttribute("aria-busy", this.active || (!this.prepared && !this.failed) ? "true" : "false");
    if (this.active) {
      this.button.style.display = "";
      return;
    }
    const entries = blocked ? [] : jamDeckExternalDragEntries(this.toolbar.canvas, this.plugin.app.vault);
    this.button.style.display = entries.length ? "" : "none";
    const signature = JSON.stringify(entries);
    if (signature === this.signature) return;
    this.signature = signature;
    this.failed = false;
    this.prepared = null;
    const generation = ++this.generation;
    this.button.setAttribute("aria-busy", entries.length ? "true" : "false");
    if (!entries.length) return;
    void this.prepare(entries).then(payload => {
      if (this.destroyed || generation !== this.generation) return;
      this.prepared = payload.text || payload.files.length ? payload : null;
      this.button?.setAttribute("aria-busy", this.active ? "true" : "false");
    }).catch(error => {
      if (this.destroyed || generation !== this.generation) return;
      this.failed = true;
      console.error("jam-deck external drag preparation failed", error);
      this.button?.setAttribute("aria-busy", "false");
      new Notice(`Jam Deck：无法准备拖出内容：${error.message}`);
    });
  }

  beginGesture(event, menu) {
    if (event.button !== 0 || this.destroyed || this.active) return;
    // This handle owns its gesture, just like the adjacent toolbar actions.
    // Cancelling the default keeps Canvas focus/selection intact; OS drag starts
    // directly at the distance threshold, without waiting for HTML dragstart.
    event.preventDefault();
    event.stopImmediatePropagation();
    this.cancelGesture?.();
    const current = JSON.stringify(jamDeckExternalDragEntries(this.toolbar.canvas, this.plugin.app.vault));
    const payload = this.pressed = current === this.signature ? this.prepared : null;
    if (this.failed) this.signature = "";
    if (current !== this.signature) this.sync(menu, false);
    const win = this.toolbar.ownerWindow, button = this.button;
    const cleanup = () => {
      win.removeEventListener("pointermove", move, true);
      win.removeEventListener("pointerup", release, true);
      win.removeEventListener("pointercancel", release, true);
      win.removeEventListener("blur", cleanup, true);
      win.removeEventListener("keydown", key, true);
      try { if (button.hasPointerCapture?.(event.pointerId)) button.releasePointerCapture(event.pointerId); } catch (_) {}
      this.pressed = null;
      this.cancelGesture = null;
    };
    const release = next => { if (next.pointerId === event.pointerId) cleanup(); };
    const key = next => { if (next.key === "Escape") cleanup(); };
    const move = next => {
      if (next.pointerId !== event.pointerId) return;
      if (!(next.buttons & 1)) { cleanup(); return; }
      if (Math.hypot(next.clientX - event.clientX, next.clientY - event.clientY) < 6) return;
      next.preventDefault();
      next.stopImmediatePropagation();
      // Remove pointercancel/blur listeners before the OS takes pointer ownership.
      cleanup();
      if (!payload) { new Notice("Jam Deck：内容准备中，请稍后再拖"); return; }
      if (!this.destroyed && !this.active) void this.start(payload);
    };
    this.cancelGesture = cleanup;
    win.addEventListener("pointermove", move, true);
    win.addEventListener("pointerup", release, true);
    win.addEventListener("pointercancel", release, true);
    win.addEventListener("blur", cleanup, true);
    win.addEventListener("keydown", key, true);
    try { button.setPointerCapture?.(event.pointerId); } catch (_) {}
  }

  async prepare(entries) {
    const fs = require("fs");
    // Load on selection, before the mouse gesture. Windows OLE must run in the
    // owning Electron UI thread, not a background process with another queue.
    if (process.platform === "win32" && !this.windowsNative)
      this.windowsNative = require("@electron/remote").require(jamDeckExternalDragBinary("win32"));
    const { MarkdownRenderer, Component } = require("obsidian");
    const sourcePath = this.toolbar.entry.leaf?.view?.file?.path || "";
    return jamDeckBuildExternalDragPayload(entries, {
      plainText: async markdown => {
        const component = new Component();
        const el = this.toolbar.entry.ownerDocument.createElement("div");
        component.load();
        try {
          await MarkdownRenderer.render(this.plugin.app, markdown, el, sourcePath, component);
          return jamDeckRenderedPlainText(el);
        } finally { component.unload(); el.remove(); }
      },
      absolutePath: path => {
        const absolute = this.plugin.absoluteFromVaultRel(path);
        if (!fs.existsSync(absolute)) throw Error(`文件不可用：${path}`);
        return absolute;
      },
      writeTextFile: async (text, files) => {
        const root = nodePath.join(require("os").tmpdir(), "jam-deck-external-drag", "text");
        await fs.promises.mkdir(root, { recursive: true });
        // Only our generated, UUID-named directories are eligible for later cleanup.
        for (const entry of await fs.promises.readdir(root, { withFileTypes: true })) {
          if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/.test(entry.name)) continue;
          const dir = nodePath.resolve(root, entry.name);
          if (nodePath.dirname(dir) !== nodePath.resolve(root)) continue;
          const stat = await fs.promises.stat(dir);
          if (Date.now() - stat.mtimeMs > 86400000) await fs.promises.rm(dir, { recursive: true, force: true });
        }
        const directory = nodePath.join(root, crypto.randomUUID());
        await fs.promises.mkdir(directory);
        const names = new Set(files.map(file => nodePath.basename(file).toLowerCase()));
        let name = "正文.txt", suffix = 2;
        while (names.has(name.toLowerCase())) name = `正文 (${suffix++}).txt`;
        const file = nodePath.join(directory, name);
        await fs.promises.writeFile(file, "\uFEFF" + text.replace(/\r?\n/g, "\r\n"), "utf8");
        return file;
      },
    });
  }

  async start(payload) {
    if (this.active || this.destroyed || this.plugin.externalDragClipboardOwner) return;
    this.active = true;
    this.plugin.externalDragClipboardOwner = this;
    this.toolbar.scheduleToolbarSync();
    const key = event => { if (event.key === "Escape") this.cancelNative?.(); };
    this.toolbar.ownerWindow.addEventListener("keydown", key, true);
    let result;
    try {
      const remote = require("@electron/remote");
      const window = remote.getCurrentWindow();
      if (process.platform === "win32") result = await this.startWindows(payload, remote, window);
      else if (process.platform === "darwin") result = await this.startMac(payload, remote, window);
      else throw Error("拖出支持 Windows 和 macOS");
      if (!this.destroyed && result?.status === "dropped" && result.target === "chat" && payload.text && payload.files.length && !result.pasteInjected) {
        new Notice("Jam Deck：文件已拖出，正文未补入（焦点已变化或需要辅助功能权限）");
      }
    } catch (error) {
      if (!this.destroyed) new Notice(`Jam Deck：拖出失败：${error.message}`);
      console.error("jam-deck external drag failed", error);
    } finally {
      // Native writes are not a new user copy. Preserve any unrelated clipboard change.
      try {
        if (this.plugin.clipboard?.readText() === payload.text) this.plugin.lastText = payload.text;
      } catch (error) { console.error("jam-deck drag clipboard read failed", error); }
      if (this.plugin.externalDragClipboardOwner === this) this.plugin.externalDragClipboardOwner = null;
      this.toolbar.ownerWindow.removeEventListener("keydown", key, true);
      this.cancelNative = null;
      this.active = false;
      if (!this.destroyed) this.toolbar.scheduleToolbarSync();
    }
    return result;
  }

  startWindows(payload, remote, window) {
    // This call returns after native drop/cancel. Esc and mouse release are
    // handled entirely by OLE, without needing the waiting renderer to run JS.
    const result = this.windowsNative.drag(window.getNativeWindowHandle(), jamDeckExternalDragPacket(payload, remote.process.pid));
    this.lastNativeResult = result;
    return result;
  }

  startMac(payload, remote, window) {
    const native = remote.require(jamDeckExternalDragBinary("darwin"));
    const id = native.begin(window.getNativeWindowHandle(), payload);
    return new Promise((resolve, reject) => {
      let timer;
      const finish = () => { clearInterval(timer); };
      this.cancelNative = () => {
        try { native.cancel(id); }
        finally { finish(); resolve({ status: "cancelled" }); }
      };
      timer = setInterval(() => {
        try {
          const result = native.poll(id);
          if (result) { finish(); resolve(result); }
        } catch (error) { finish(); reject(error); }
      }, 80);
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    ++this.generation;
    this.cancelGesture?.();
    this.prepared = this.pressed = null;
    this.button?.remove();
    this.button = null;
    try { this.cancelNative?.(); }
    catch (error) { console.error("jam-deck drag cancellation failed", error); }
  }
}
