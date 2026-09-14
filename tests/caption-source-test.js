"use strict";
const assert = require("assert/strict");
const fs = require("fs"), path = require("path"), vm = require("vm");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");
const code = fs.readFileSync(path.join(__dirname, "../caption-wall.js"), "utf8");

function fixture(platform, missing = "") {
  const child = new EventEmitter();
  child.pid = 451;
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  const killed = [], calls = [], timers = [], errors = [], events = [];
  child.kill = () => killed.push("child");
  const config = { python: "/用户目录/Python Env/bin/python3", model: "/用户目录/model", audiotee: "/用户目录/audio tee" };
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, process: { platform, kill: (...args) => killed.push(args) },
    require: name => name === "fs" ? { existsSync: file => file !== missing, readFileSync: () => JSON.stringify(config) } :
      name === "child_process" ? { spawn: (...args) => { calls.push(args); return child; } } : require(name),
    setTimeout: (fn, delay) => { const timer = { fn, delay }; timers.push(timer); return timer; },
    clearTimeout: timer => { if (timer) timer.cleared = true; },
  });
  let closed = 0;
  const source = new module.exports.CaptionSource("/plugin", "/runtime.json", event => events.push(event), error => errors.push(error), () => closed++);
  return { source, child, config, killed, calls, timers, errors, events, closed: () => closed };
}

for (const platform of ["win32", "darwin"]) {
  const f = fixture(platform);
  f.source.start("system");
  const [executable, args, options] = f.calls[0];
  assert.equal(executable, f.config.python);
  assert.equal(options.shell, false, "paths with spaces are passed as argv, never shell code");
  assert.equal(options.detached, platform === "darwin");
  assert.equal(args.includes("--audiotee"), platform === "darwin");
  assert.equal(f.timers[0].delay, platform === "darwin" ? 120000 : 30000);
  f.child.stdout.write('{"type":"ready"}\n');
  assert.equal(f.events[0].type, "ready");
  assert.equal(f.timers[0].cleared, true);
  f.source.stop(); f.source.stop();
  assert.equal(f.child.stdin.read().toString(), "stop\n", "stop is idempotent and flushes through stdin");
  const killer = f.timers.find(timer => timer.delay === 2500);
  killer.fn();
  assert.equal(JSON.stringify(f.killed[0]), platform === "darwin" ? '[-451,"SIGKILL"]' : '"child"');
  f.child.emit("close", 0);
  assert.equal(f.closed(), 1);
  assert.equal(killer.cleared, true);
}
assert.throws(() => fixture("linux").source.start("system"), /Windows 和 macOS/);
assert.throws(() => fixture("darwin", "/runtime.json").source.start("system"), /setup-captions.sh/);
assert.throws(() => fixture("win32", "/runtime.json").source.start("system"), /setup-captions.ps1/);
assert.throws(() => fixture("darwin", "/用户目录/audio tee").source.start("system"), /采集器未安装/);
const mic = fixture("darwin", "/用户目录/audio tee");
mic.source.start("mic");
assert(!mic.calls[0][1].includes("--audiotee"), "microphone does not launch system capture");
mic.child.emit("close", 0);
const denied = fixture("darwin");
denied.source.start("system");
denied.timers[0].fn();
assert.match(denied.errors[0].message, /音频权限/);
assert.equal(denied.child.stdin.read().toString(), "stop\n");
denied.child.emit("close", 1);
assert.equal(denied.errors.length, 1, "one startup failure is not reported twice");
const crashed = fixture("darwin");
crashed.source.start("system");
crashed.child.emit("close", 1);
assert.equal(JSON.stringify(crashed.killed), '[[-451,"SIGKILL"]]', "unexpected Python exit also kills the capture process group");
assert.equal(crashed.errors.length, 1);
console.log("caption source: platform routing, startup, argv, stop and process-group cleanup passed");
