"use strict";
const path = require("path");
const crypto = require("crypto");

module.exports = function createCaptionHost(plugin, { FuzzySuggestModal, Notice, setIcon, model, directory }) {
  const modulePath = path.join(directory, "caption-wall.js");
  delete require.cache[require.resolve(modulePath)];
  const { CaptionSession, CaptionSource, mountCaption } = require(modulePath);
  const sessions = new Map(), requests = new Set();
  async function ai(instruction, data) {
    if (!plugin.settings.aiApiKey) throw new Error("请先在 Jam Deck 设置中配置 DeepSeek API Key");
    const controller = new AbortController(); requests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const payload = JSON.stringify({ model, stream: false, thinking: { type: "disabled" },
        response_format: { type: "json_object" }, max_tokens: 6000,
        messages: [{ role: "system", content: instruction }, { role: "user", content: JSON.stringify(data) }] });
      const body = await new Promise((resolve, reject) => {
        const request = require("https").request("https://api.deepseek.com/chat/completions", {
          method: "POST", signal: controller.signal,
          headers: { Authorization: `Bearer ${plugin.settings.aiApiKey}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
        }, response => {
          let result = ""; response.setEncoding("utf8"); response.on("error", reject);
          response.on("data", chunk => { result += chunk; if (result.length > 1024 * 1024) request.destroy(new Error("DeepSeek 响应过大")); });
          response.on("end", () => response.statusCode >= 200 && response.statusCode < 300 ? resolve(result) : reject(new Error(`DeepSeek HTTP ${response.statusCode}`)));
        });
        request.on("error", reject); request.end(payload);
      });
      const result = JSON.parse(body);
      if (result.choices?.[0]?.finish_reason === "length") throw new Error("DeepSeek 返回内容被截断，原文已保留");
      return JSON.parse(result.choices?.[0]?.message?.content || "{}");
    } finally { clearTimeout(timeout); requests.delete(controller); }
  }
  const host = {
    exists: id => plugin.settings.widgets.some(widget => widget.id === id),
    config: id => { const widget = plugin.settings.widgets.find(item => item.id === id); return widget.config ||= {}; },
    icon: (element, name) => setIcon(element, name),
    save: () => plugin.saveSettings(), hasKey: () => !!plugin.settings.aiApiKey, ai,
    source: (onEvent, onError, onClose) => new CaptionSource(directory, path.join(directory, `.cache/caption-runtime-${process.platform}.json`), onEvent, onError, onClose),
    copy: async text => { require("electron").clipboard.writeText(text); new Notice("字幕墙：已复制"); },
    readNote: async filePath => {
      const file = plugin.app.vault.getAbstractFileByPath(filePath);
      if (!file || !["md", "srt", "vtt", "txt"].includes(file.extension)) throw new Error("笔记不存在，请重新选择");
      return plugin.app.vault.read(file);
    },
    chooseNote: callback => {
      new (class extends FuzzySuggestModal {
        constructor() { super(plugin.app); this.setPlaceholder("选择笔记或字幕文件…"); }
        getItems() { return plugin.app.vault.getFiles().filter(file => ["md", "srt", "vtt", "txt"].includes(file.extension)); }
        getItemText(file) { return file.path; }
        onChooseItem(file) { callback(file.path); }
      })().open();
    },
    archive: async text => {
      const folder = "Work/字幕墙";
      for (const dir of ["Work", folder]) if (!plugin.app.vault.getAbstractFileByPath(dir)) {
        try { await plugin.app.vault.createFolder(dir); } catch (error) { if (!plugin.app.vault.getAbstractFileByPath(dir)) throw error; }
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const file = await plugin.app.vault.create(`${folder}/字幕 ${stamp}-${crypto.randomBytes(3).toString("hex")}.md`, `# 字幕归档\n\n${text}\n`);
      new Notice(`字幕墙：已归档到 ${file.path}`); return file.path;
    },
  };
  return {
    sessions,
    get(id) {
      if (!sessions.has(id)) {
        const session = new CaptionSession(host, id); sessions.set(id, session);
        if (session.mode === "follow" && session.notePath) void session.loadNote(session.notePath).catch(error => { session.error = error.message; session.notify(); });
      }
      return sessions.get(id);
    },
    mount(body, id) { return mountCaption(body, this.get(id), host); },
    stopUnused() { for (const session of sessions.values()) if (!session.listeners.size) session.stop(); },
    remove(id) { if (sessions.has(id)) { sessions.get(id).dispose(); sessions.delete(id); } },
    dispose() { for (const session of sessions.values()) session.dispose(); for (const controller of requests) controller.abort(); },
  };
};
