/**
 * Jam Deck dead-CSS auditor.
 *
 * Static reading of styles.css cannot tell whether a rule actually renders:
 * the file carries flat-era rules that the later Spatial rewrites override by
 * specificity, and those zombies look perfectly alive in the source. This
 * script decides the question at runtime instead.
 *
 * Usage:
 *   node scripts/audit-dead-css.js --install   # emit the installer command
 *   node scripts/audit-dead-css.js --scan LBL  # emit a scan command
 *   node scripts/audit-dead-css.js --report    # emit the report command
 *   node scripts/audit-dead-css.js --probe     # raw installer source, for devtools
 *
 * Pipe a command into bash, e.g.
 *   eval "$(node scripts/audit-dead-css.js --install)"
 *   eval "$(node scripts/audit-dead-css.js --scan workbench)"
 *
 * Emitted commands contain no single quotes so they can be single-quoted
 * safely. Note that invoking obsidian.com through node's spawnSync fails with
 * EBUSY on Windows, which is why this script only emits commands.
 *
 * WORKFLOW -- coverage is everything. A rule can only be judged while at least
 * one element matches it, so install once and then scan repeatedly, opening a
 * different surface each time: workbench widgets, each own modal, the settings
 * tab, an embedded Canvas, island mode, the caption wall. Verdicts accumulate
 * on window.__jamCssAudit, so a rule judged during one scan is not re-tested
 * later. Never delete a rule that never got judged; unjudged is not dead.
 *
 * METHOD -- two passes per rule:
 *   1. Blank pass. Clear the rule, re-read only the properties it declared.
 *      If anything changed, the rule is live and we stop there.
 *   2. Sentinel pass. Push an impossible value in and see whether the computed
 *      value follows. This separates a genuinely overridden rule from one that
 *      merely repeats the inherited value -- e.g. --jd-heading and the theme's
 *      --text-muted are both #5c5c5c, so pass 1 alone flags a working rule.
 *      Responding to the sentinel means "redundant", not "dead".
 * Both passes restore the rule in a finally block. Nothing is written to disk
 * and the stylesheet is left exactly as found.
 */

const HELPERS = String.raw`
  const sentinelFor = (p) => {
    if (p === "color" || /color$/.test(p) || p === "background") return "rgb(1, 2, 3)";
    if (/(radius|width|height|padding|margin|gap|top|left|right|bottom)/.test(p)) return "12345px";
    if (p === "display") return "inline-table";
    if (p === "opacity") return "0.123";
    if (p === "visibility") return "collapse";
    return null;
  };
  const responded = (v) =>
    v.indexOf("1, 2, 3") > -1 || v.indexOf("12345") > -1 || v === "inline-table" ||
    v === "0.123" || v === "collapse";
  const STATE_SELECTOR = /:hover|:focus|:active|:disabled|:checked|:placeholder|::/;

  /* Collect first, recurse second, and gate recursion on length. Chrome now
     exposes a (usually empty) cssRules list on plain CSSStyleRule because of
     CSS nesting, so an "if (rule.cssRules) { recurse; continue; }" shape
     silently skips every ordinary rule. */
  const collect = () => {
    const out = [];
    const walk = (list) => {
      for (const rule of list) {
        if (typeof rule.selectorText === "string" && rule.selectorText.indexOf("jam-deck") > -1) out.push(rule);
        if (rule.cssRules && rule.cssRules.length) walk(rule.cssRules);
      }
    };
    for (const sheet of document.styleSheets) {
      try { walk(sheet.cssRules); } catch (err) { /* cross-origin sheet */ }
    }
    return out;
  };

  const judge = (rule, el) => {
    const props = [];
    for (let i = 0; i < rule.style.length; i++) props.push(rule.style[i]);
    if (!props.length) return null;

    const read = () => props.map((p) => getComputedStyle(el).getPropertyValue(p)).join("|");
    const before = read();
    const saved = rule.style.cssText;
    let after = "";
    try { rule.style.cssText = ""; after = read(); } finally { rule.style.cssText = saved; }
    if (before !== after) return { verdict: "alive", props: props.length, probed: 0 };

    let reacted = false;
    let probed = 0;
    for (const p of props) {
      const sentinel = sentinelFor(p);
      if (!sentinel) continue;
      const keep = rule.style.getPropertyValue(p);
      rule.style.setProperty(p, sentinel);
      if (rule.style.getPropertyValue(p)) {
        probed++;
        if (responded(getComputedStyle(el).getPropertyValue(p))) reacted = true;
      }
      rule.style.setProperty(p, keep);
    }
    if (probed === 0 || reacted) return { verdict: "redundant", props: props.length, probed };
    return { verdict: "overridden", props: props.length, probed };
  };
`;

const INSTALL = `(() => {${HELPERS}
  const judged = new Map();
  const scans = [];
  let totalRules = 0;

  const scan = (label) => {
    const rules = collect();
    totalRules = rules.length;
    let newly = 0, unmatched = 0, stateSel = 0;
    rules.forEach((rule, idx) => {
      if (judged.has(idx)) return;
      const selector = rule.selectorText;
      if (STATE_SELECTOR.test(selector)) { stateSel++; return; }
      let el = null;
      try { el = document.querySelector(selector); } catch (err) { return; }
      if (!el) { unmatched++; return; }
      const result = judge(rule, el);
      if (!result) return;
      judged.set(idx, { selector: selector, label: label || "unlabelled", verdict: result.verdict, props: result.props, probed: result.probed });
      newly++;
    });
    const entry = {
      label: label || "unlabelled",
      newlyJudged: newly,
      stillUnmatched: unmatched,
      stateSelectors: stateSel,
      totalJudged: judged.size,
      totalRules: totalRules
    };
    scans.push(entry);
    return entry;
  };

  const report = () => {
    const overridden = [], redundant = [];
    let alive = 0;
    for (const v of judged.values()) {
      if (v.verdict === "alive") { alive++; continue; }
      const line = v.selector + "   <" + v.label + ">";
      if (v.verdict === "overridden") overridden.push(line); else redundant.push(line);
    }
    return {
      totalRules: totalRules,
      judged: judged.size,
      coverage: totalRules ? Math.round((judged.size / totalRules) * 100) + "%" : "0%",
      aliveCount: alive,
      overriddenCount: overridden.length,
      redundantCount: redundant.length,
      overridden: overridden,
      redundant: redundant,
      scans: scans
    };
  };

  window.__jamCssAudit = { scan: scan, report: report };
  return "installed";
})();`;

const compact = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s*\n\s*/g, " ").replace(/ {2,}/g, " ").trim();

const CLI = '"$LOCALAPPDATA/Programs/obsidian/obsidian.com"';
const vault = process.env.JAM_DECK_VAULT || "Jamnote";

const emit = (code) => {
  const one = compact(code);
  if (one.includes("'")) {
    process.stderr.write("Probe contains a single quote; the emitted command would break.\n");
    process.exit(1);
  }
  process.stdout.write(`${CLI} eval 'code=${one}' vault=${vault}\n`);
};

const args = process.argv.slice(2);
const mode = args[0] || "--install";

if (mode === "--probe") {
  process.stdout.write(`${INSTALL}\n`);
} else if (mode === "--install") {
  emit(INSTALL);
} else if (mode === "--scan") {
  const label = (args[1] || "unlabelled").replace(/[^\w.-]/g, "");
  emit(`JSON.stringify(window.__jamCssAudit.scan("${label}"));`);
} else if (mode === "--report") {
  emit("JSON.stringify(window.__jamCssAudit.report());");
} else {
  process.stderr.write(`Unknown mode ${mode}. Use --install, --scan LABEL, --report or --probe.\n`);
  process.exit(1);
}
