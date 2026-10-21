"use strict";
const assert = require("assert/strict");
const native = require(process.argv[2]);
assert.equal(native.selfTest(), 0, "Unicode, shell/chat formats, own-window rejection and retained COM data");
assert.throws(() => native.drag(Buffer.alloc(1), Buffer.alloc(0)), /native window handle/);
assert.throws(() => native.drag(Buffer.alloc(8), Buffer.alloc(0)), /source window UI thread/);
console.log("Windows native drag formats, lifetime and source-window validation passed");
