class IslandGlassMaterial {
  constructor(island, onFailure, remote, channel) {
    this.island = island;
    this.onFailure = onFailure;
    this.remote = remote;
    this.channel = channel;
    this.stopped = false;
    this.ready = false;
    this.child = null;
    this.lastCommand = "";
    this.cancelStart = null;
  }

  launchMac(display) {
    const fs = require("fs"), payload = MACOS_ISLAND_CAPTURE_PAYLOAD;
    const bytes = zlib.gunzipSync(Buffer.from(payload.gzip, "base64"));
    const hash = value => crypto.createHash("sha256").update(value).digest("hex");
    if (hash(bytes) !== payload.sha256) throw Error("Invalid island capture helper");
    const directory = nodePath.join(require("os").tmpdir(), "jam-deck-island-capture");
    fs.mkdirSync(directory, { recursive: true });
    const executable = nodePath.join(directory, payload.sha256);
    if (!fs.existsSync(executable) || hash(fs.readFileSync(executable)) !== payload.sha256) fs.writeFileSync(executable, bytes, { mode: 0o700 });
    const windowNumber = String(this.island.getMediaSourceId()).split(":")[1];
    return spawn(executable, [windowNumber, String(display.id)], { stdio: ["pipe", "pipe", "pipe"] });
  }

  async start() {
    const display = this.remote.screen.getDisplayMatching(this.island.getBounds());
    const config = { platform: process.platform, bounds: this.island.getBounds(), display: display.bounds };
    if (process.platform === "win32") {
      const sources = await this.remote.require("electron").desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } });
      if (this.stopped) return;
      const source = sources.find(item => item.display_id === String(display.id));
      if (!source) throw Error("Cannot find island display for capture");
      config.sourceId = source.id;
    } else if (process.platform !== "darwin") throw Error("Desktop island capture requires Windows or macOS");
    await this.island.webContents.executeJavaScript(`window.jamDeckIslandOptics.configure(${JSON.stringify(config)})`);
    if (this.stopped) return;
    if (process.platform === "darwin") await this.startMac(display);
    if (!this.stopped) this.ready = true;
  }

  startMac(display) {
    return new Promise((resolve, reject) => {
      let settled = false, buffer = Buffer.alloc(0), diagnostic = "", timer;
      const fail = error => {
        if (this.stopped) return;
        if (!settled) { settled = true; clearTimeout(timer); reject(error); }
        else this.onFailure(error);
        this.stop();
      };
      this.cancelStart = () => { if (!settled) { settled = true; clearTimeout(timer); reject(Error("Island capture cancelled")); } };
      try {
        this.child = this.launchMac(display);
        this.child.once("error", fail);
        this.child.once("exit", code => fail(Error(`Island capture exited (${code}): ${diagnostic}`)));
        this.child.stdin.on("error", fail);
        this.child.stderr.on("data", data => { diagnostic = (diagnostic + data.toString()).slice(-2048); });
        this.child.stdout.on("data", data => {
          if (this.stopped) return;
          buffer = Buffer.concat([buffer, data]);
          if (!settled) {
            if (buffer.length < 6) return;
            if (buffer.subarray(0, 6).toString() !== "ready\n") { fail(Error("Invalid capture handshake")); return; }
            buffer = buffer.subarray(6); settled = true; clearTimeout(timer); resolve();
          }
          while (buffer.length >= 4) {
            const length = buffer.readUInt32BE(0);
            if (length < 1 || length > 4 * 1024 * 1024) { fail(Error("Invalid capture frame length")); return; }
            if (buffer.length < length + 4) break;
            this.island.webContents.send(`${this.channel}:capture-frame`, buffer.subarray(4, length + 4));
            buffer = buffer.subarray(length + 4);
          }
        });
        timer = setTimeout(() => fail(Error(`Desktop capture permission or startup failed: ${diagnostic}`)), 15000);
      } catch (error) { fail(error); }
    });
  }

  update(visible, settings = {}) {
    if (!this.ready || this.stopped) return;
    if (typeof this.island.isVisible === "function" && !this.island.isVisible()) visible = false;
    const state = { active: visible, blur: Number.isFinite(Number(settings.glassBlur)) ? Math.max(0, Math.min(16, Number(settings.glassBlur))) : 4,
      quality: settings.glassQuality === "light" ? "light" : "balanced" };
    const key = JSON.stringify(state);
    if (key === this.lastCommand) return;
    const wasVisible = this.lastCommand && JSON.parse(this.lastCommand).active;
    this.lastCommand = key;
    this.island.webContents.send(`${this.channel}:capture-state`, state);
    if (this.child && visible !== !!wasVisible) {
      const b = this.island.getBounds();
      this.child.stdin.write(visible ? `show ${b.x} ${b.y} ${b.width} ${b.height}\n` : "hide\n");
    }
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true; this.ready = false;
    if (this.cancelStart) this.cancelStart();
    try { if (!this.island.isDestroyed()) this.island.webContents.send(`${this.channel}:capture-state`, { active: false }); } catch (error) {}
    if (this.child) {
      try { this.child.stdin.end("quit\n"); } catch (error) {}
      try { this.child.kill(); } catch (error) {}
      this.child = null;
    }
  }
}
