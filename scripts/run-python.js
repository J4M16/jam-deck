"use strict";
const { spawnSync } = require("child_process");
const python = process.env.PYTHON || (process.platform === "darwin" ? "python3.12" : process.platform === "win32" ? "python" : "python3");
const result = spawnSync(python, process.argv.slice(2), { stdio: "inherit", shell: false });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
