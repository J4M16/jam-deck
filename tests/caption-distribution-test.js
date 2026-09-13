"use strict";
const assert = require("assert/strict");
const fs = require("fs"), os = require("os"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "main.js"), "utf8");
const start = source.indexOf("    const captionDirectory =");
const end = source.indexOf("    await this.ensureClipboardDir();", start);
assert(start >= 0 && end > start);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jam-deck-optional-"));
try {
  fs.writeFileSync(path.join(directory, "main.js"), "");
  const run = () => {
    const plugin = { manifest: { dir: "." }, settings: {} };
    const context = { plugin, require, nodePath: path, jamDeckVaultBasePath: () => directory,
      FuzzySuggestModal: class {}, Notice: class {}, setIcon() {}, JAM_DECK_DEEPSEEK_MODEL: "test" };
    vm.runInNewContext(`(function(){${source.slice(start, end)}}).call(plugin)`, context);
    return plugin;
  };
  assert.equal(run().captions, undefined, "base install boots without optional modules");
  for (const name of ["caption-host.js", "caption-wall.js"]) fs.copyFileSync(path.join(root, name), path.join(directory, name));
  const full = run();
  assert.equal(full.captions.sessions.size, 0, "installed extension does not start capture or create sessions at boot");
  full.captions.dispose();
  fs.writeFileSync(path.join(directory, "caption-host.js"), 'throw new Error("broken extension");');
  assert.match(run().captionLoadError, /broken extension/, "broken optional extension is isolated from core boot");
  console.log("caption distribution: missing, installed and broken extension boot passed");
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
