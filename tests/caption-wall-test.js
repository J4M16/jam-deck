"use strict";
const assert = require("assert/strict");
const { CaptionSession, CaptionMatcher, parseNote, parseTime, timeLabel } = require("../caption-wall");
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function fixture(options = {}) {
  const config = options.config || {}, sources = [], saved = [], archives = [], calls = [];
  const host = {
    config: () => config, exists: () => true,
    save: async () => saved.push(JSON.parse(JSON.stringify(config))),
    hasKey: () => true,
    readNote: async () => "[00:01] 今天介绍灯光设计\n[00:05] 然后讨论角色建模\n[00:09] 最后调整材质颜色",
    archive: async text => { archives.push(text); return "Work/字幕墙/test.md"; },
    ai: async (instruction, data) => { calls.push(data); return { translations: data.map(item => ({ id: item.id, text: `译：${item.text}` })) }; },
    source(onEvent, onError, onClose) {
      const source = { start: source => { this.kind = source; }, stop() { this.stopped = true; }, onEvent, onError, onClose };
      sources.push(source); return source;
    },
    ...options.host,
  };
  const session = new CaptionSession(host, "caption-test");
  return { session, config, host, sources, saved, archives, calls };
}
function emit(source, text, final = false, id = 0) { source.onEvent({ type: final ? "final" : "partial", text, id, start: id * 3, end: id * 3 + 2 }); }

async function main() {
  assert.equal(parseTime("01:02:03.500"), 3723.5);
  assert.equal(parseTime("12:34"), 754);
  assert.equal(parseTime("01:70:00"), null);
  assert.equal(parseTime("00:99"), null);
  assert.equal(timeLabel(3723.8), "01:02:03");
  const note = parseNote("---\ntitle: 测试\n---\n# 演讲\n[00:03] 开场\n[00:07.50] 正文\n结束");
  assert.deepEqual(note.map(line => line.time), [null, 3, 7.5, null]);
  assert.equal(note[1].id, 5);
  assert.deepEqual(parseNote("1\n00:00:01,250 --> 00:00:03,000\n你好\n\n2\n00:00:04,000 --> 00:00:05,000\n世界").map(line => [line.text, line.time]), [["你好", 1.25], ["世界", 4]]);
  assert.deepEqual(parseNote("WEBVTT\n\n00:01.500 --> 00:03.000\nHello").map(line => line.time), [1.5]);

  const matcher = new CaptionMatcher("欢迎使用字幕墙，现在开始测试。欢迎使用字幕墙，重复句在后面。");
  const first = matcher.consume("欢迎使用", false);
  const growing = matcher.consume("欢迎使用字幕墙", false);
  assert(growing.index > first.index && growing.index < 9, "cumulative partials must stay in first occurrence");
  assert.equal(matcher.consume("欢迎使用字幕墙", true).index, growing.index, "final must commit without consuming the same words again");
  assert.equal(matcher.consume("火星宇航员正在吃饼干", true).matched, false, "off-script Chinese must freeze");
  const forward = matcher.consume("现在开始测试", true);
  assert(forward.index > growing.index);
  const omission = new CaptionMatcher("今天我们一起测试语音跟随功能");
  assert(omission.consume("今天一起测试", false).matched, "dropped characters must not stall following");
  const english = new CaptionMatcher("Welcome to Jam Deck. This is a lighting tutorial.");
  assert(english.consume("welcome to jam deck", true).matched);
  const rewind = new CaptionMatcher("今天我们一起学习灯光设计。然后介绍其他的课程内容。");
  rewind.consume("今天我们一起学习灯光设计", true);
  rewind.consume("然后介绍其他的课程内容", true);
  assert(rewind.consume("今天我们一起学习灯光设计", true).index < 16, "long confirmed rereading may move backward");

  let f = fixture();
  try {
    f.session.start(); assert.equal(f.sources.length, 1);
    f.session.start(); assert.equal(f.sources.length, 1, "double start owns only one process");
    emit(f.sources[0], "Hello"); emit(f.sources[0], "Hello world"); emit(f.sources[0], "Hello world", true);
    assert.equal(f.session.entries.length, 1);
    await f.session.translate();
    assert.equal(f.session.entries[0].text, "译：Hello world");
    await f.session.translate(); assert.equal(f.calls.length, 1, "already translated entries are never billed twice");
    emit(f.sources[0], "Second line", true, 1);
    await f.session.translate(); assert.equal(f.calls[1].length, 1);
    await f.session.archive(); assert(f.archives[0].includes("译：Hello world"));
    assert.equal(f.session.entries.length, 2, "archive preserves visible content");
    f.session.stop(); assert(f.sources[0].stopped);
    await f.session.save(); assert.equal(f.config.captionDraft.length, 2);
  } finally { f.session.dispose(); }

  f = fixture();
  try {
    f.session.start(); emit(f.sources[0], "尚未说完");
    f.session.stop(); emit(f.sources[0], "尚未说完的完整句子", true); f.sources[0].onClose();
    assert.equal(f.session.entries[0].text, "尚未说完的完整句子", "pause must accept the decoder's final flush");
    assert.equal(f.session.source, null);
  } finally { f.session.dispose(); }

  f = fixture();
  try {
    f.session.start(); emit(f.sources[0], "切换前的临时字幕");
    f.session.setMode("follow"); f.session.setMode("transcribe");
    await f.session.translate();
    assert.equal(f.session.entries[0].translated, true, "mode switching preserves a translatable partial snapshot");
    assert.equal(f.session.status, "已暂停");
    await f.session.loadNote("timed.md");
    f.session.elapsed = 6; f.session.togglePlay(); f.session.tick(f.session.playStarted);
    assert.equal(f.session.activeLine, 2);
    assert(f.session.matcher.anchor >= 0, "clock playback must move the speech anchor with the visible note line");
  } finally { f.session.dispose(); }

  const pending = deferred();
  f = fixture({ host: { ai: () => pending.promise } });
  try {
    f.session.start(); emit(f.sources[0], "Old text", true);
    const id = f.session.entries[0].id;
    const translating = f.session.translate();
    f.session.clear(); emit(f.sources[0], "late partial after clear", true);
    pending.resolve({ translations: [{ id, text: "迟来的旧翻译" }] }); await translating;
    assert.equal(f.session.entries.length, 0, "clear invalidates both in-flight AI and old audio callbacks");
    f.session.start(); emit(f.sources[1], "New run", true);
    assert.equal(f.session.entries.length, 1);
  } finally { f.session.dispose(); }

  f = fixture({ host: { ai: async () => ({ translations: [] }), archive: async () => { throw new Error("disk full"); } } });
  try {
    f.session.start(); emit(f.sources[0], "Keep original", true);
    await assert.rejects(f.session.translate(), /不完整/);
    await assert.rejects(f.session.archive(), /disk full/);
    assert.equal(f.session.entries[0].text, "Keep original");
    assert.equal(f.session.entries[0].translated, false);
  } finally { f.session.dispose(); }

  const loading = deferred();
  f = fixture({ host: { readNote: file => file === "old.md" ? loading.promise : Promise.resolve("[00:00] 新笔记内容") } });
  try {
    const old = f.session.loadNote("old.md"); await f.session.loadNote("new.md");
    loading.resolve("旧笔记内容"); await old;
    assert.equal(f.session.notePath, "new.md", "stale note reads cannot replace current selection");
  } finally { f.session.dispose(); }

  const locating = deferred();
  f = fixture({ host: { ai: () => locating.promise } });
  try {
    f.session.setMode("follow"); await f.session.loadNote("script.md");
    f.session.start();
    f.session.togglePlay();
    f.session.followSpeech("今天介绍灯光设计", true);
    assert.equal(f.session.activeLine, 1);
    assert.equal(f.session.playing, false, "confident speech overrides clock scrolling");
    const operation = f.session.locate("我要谈谈材料的色彩");
    f.session.seek(2);
    locating.resolve({ id: 3, confidence: 0.99 }); await operation;
    assert.equal(f.session.activeLine, 2, "late semantic replies cannot overwrite manual position");
    const text = f.session.noteText;
    await f.session.archive(); assert.equal(f.archives[0], text);
    f.session.dispose(); emit(f.sources[0], "late speech", true);
    assert.equal(f.session.noteText, text);
  } finally { f.session.dispose(); }

  f = fixture({ config: { captionDraft: [{ id: "saved", text: "未完成的句子", original: "未完成的句子", final: false, start: 0, end: 1 }] } });
  try { assert.equal(f.session.entries[0].final, true); assert.equal(f.session.source, null, "restoring a draft must never start recording"); }
  finally { f.session.dispose(); }
  console.log("caption-wall: parser, Chinese/English following, lifecycle, persistence, translation races and archive tests passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
