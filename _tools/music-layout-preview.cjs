// Render the real music DOM with fixture media, without touching Vault data.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const { chromium } = require('C:/Users/zhanghongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const methods = source.slice(source.indexOf('  renderMusicPlayer(body, widget) {'), source.indexOf('  rebuildMusicSourceMenu(player, widget) {'));
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const reportDir = path.join(root, '_reports'), shotDir = path.join(root, '_screenshots');
fs.mkdirSync(reportDir, { recursive: true }); fs.mkdirSync(shotDir, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 580 }, deviceScaleFactor: 2 });
    const reports = [];
    for (const skin of ['spatial', 'glass']) for (const dark of [false, true]) for (const width of [200, 270, 320, 460]) {
      await page.setContent(`<style>${css}</style><style>body{margin:0;padding:30px;background:${dark ? '#262927' : '#e9ece7'};font-family:'Microsoft YaHei UI',sans-serif;--background-primary:${dark ? '#242925' : '#fff'};--background-secondary:${dark ? '#292e2b' : '#fafbf8'};--background-modifier-border:${dark ? '#465046' : '#e3e6e0'};--text-normal:${dark ? '#e6e9e2' : '#343a33'};--text-muted:#8a9188;--font-ui-small:12px;--font-ui-medium:14px;--font-ui-smaller:10px} .jam-deck-root{display:block;width:${width}px;height:auto;min-height:0;padding:0}.jam-deck-widget{height:250px}.jam-deck-widget-header{flex-shrink:0}.jam-deck-music-progress{box-sizing:border-box}</style><body class="${dark ? 'theme-dark' : 'theme-light'}"><div class="jam-deck-root" data-jam-deck-skin="${skin}"><section class="jam-deck-widget is-music"><header class="jam-deck-widget-header"><span class="jam-deck-widget-title">♫　音乐播放器</span></header><div class="jam-deck-widget-body"></div></section></div></body>`);
      await page.evaluate(({ methods }) => {
        for (const [method, tag] of [['createDiv', 'div'], ['createSpan', 'span']]) HTMLElement.prototype[method] = function(opts) { return this.createEl(tag, opts); };
        HTMLElement.prototype.createEl = function(tag, opts = {}) { const el = document.createElement(tag); el.className = opts.cls || ''; if(opts.text) el.textContent = opts.text; for(const [key,value] of Object.entries(opts.attr || {})) el.setAttribute(key,value); this.append(el); return el; };
        HTMLElement.prototype.addClass = function(cls) { this.classList.add(cls); }; HTMLElement.prototype.removeClass = function(cls) { this.classList.remove(cls); };
        const setIcon = (el, name) => { const paths = { 'audio-lines':'M4 9v6M8 5v14M12 3v18M16 7v10M20 9v6', 'skip-back':'M6 4v16M20 4 8 12l12 8Z', 'skip-forward':'M18 4v16M4 4l12 8-12 8Z', play:'M8 4v16l12-8Z' }; el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="${paths[name] || paths.play}"/></svg>`; };
        const View = eval(`(class {${methods}\nupdateMusicPlayerEl() {} })`);
        const view = new View(); window.commands = [];
        view.plugin = { ensureMusicMedia: async () => {}, musicSnapshot: { selected: { trackKey: 'fixture' } }, controlMusic: async (...args) => window.commands.push(args) };
        view.renderMusicPlayer(document.querySelector('.jam-deck-widget-body'), { id: 'preview' });
        document.querySelector('.jam-deck-music-title').textContent = '我们 (Live)'; document.querySelector('.jam-deck-music-artist').textContent = '黄霄雲 / 唐汉霄';
        const progress = document.querySelector('input'); progress.max = '240000'; progress.value = '84000'; progress.style.setProperty('--jd-music-progress','35%');
        document.querySelector('.jam-deck-music-time-current').textContent = '1:24'; document.querySelector('.jam-deck-music-time-total').textContent = '4:00';
        window.jamDeckFormatMediaTime = n => `${Math.floor(n/60000)}:${String(Math.floor(n/1000)%60).padStart(2,'0')}`;
      }, { methods });
      const metric = await page.evaluate(() => {
        const rect = selector => { const el = document.querySelector(selector), r = el.getBoundingClientRect(); return { x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom }; };
        return { disc:rect('.jam-deck-music-disc-stage'), meta:rect('.jam-deck-music-meta'), timeline:rect('.jam-deck-music-timeline'), controls:rect('.jam-deck-music-controls'), body:rect('.jam-deck-widget-body'), player:rect('.jam-deck-music-player'), visible:getComputedStyle(document.querySelector('.jam-deck-music-controls')).visibility, overflow:document.querySelector('.jam-deck-widget-body').scrollWidth > document.querySelector('.jam-deck-widget-body').clientWidth };
      });
      assert.equal(metric.visible, 'visible'); assert.equal(metric.overflow, false); assert(metric.timeline.bottom <= metric.controls.y); assert(metric.controls.bottom <= metric.body.bottom); assert(metric.meta.bottom < metric.timeline.y);
      if(width > 270) { assert(metric.timeline.x >= metric.disc.right); assert.equal(metric.timeline.x, metric.meta.x); }
      for (const role of ['previous','toggle','next']) await page.locator(`[data-role="${role}"]`).click();
      await page.locator('input').focus(); await page.keyboard.press('ArrowRight');
      const commands = await page.evaluate(() => window.commands);
      assert.deepEqual(commands.slice(0,3).map(a => a[1]), ['previous','toggle','next']); assert.equal(commands.at(-1)[1], 'seek');
      reports.push({ skin, dark, width, metric, commands });
      await page.evaluate(() => document.activeElement.blur());
      await page.mouse.move(850, 550);
      if(width === 460 || width === 200) await page.locator('.jam-deck-widget').screenshot({ path:path.join(shotDir,`music-${skin}-${dark ? 'dark' : 'light'}-${width}.png`) });
    }
    fs.writeFileSync(path.join(reportDir, 'music-layout.json'), JSON.stringify(reports,null,2));
    console.log(`Music layout: ${reports.length} real DOM renders passed; no overlap/overflow, controls and keyboard seek passed.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
