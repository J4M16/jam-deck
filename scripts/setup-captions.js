"use strict";
const path = require("path");
const { spawnSync } = require("child_process");
const args = process.argv.slice(2);
const mac = process.platform === "darwin";
if (!mac && process.platform !== "win32") {
  console.error("字幕引擎安装支持 Windows 和 macOS 14.2+");
  process.exit(1);
}
const result = spawnSync(mac ? "/bin/bash" : "powershell", mac ?
  [path.join(__dirname, "setup-captions.sh"), ...args] :
  ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "setup-captions.ps1"), ...args],
  { stdio: "inherit", shell: false });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
