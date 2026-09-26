/**
 * Jam Deck dead-CSS auditor.
 *
 * Static reading of styles.css cannot tell whether a rule actually renders:
 * the file carries flat-era rules that the later Spatial rewrites override by
 * specificity, and those zombies look perfectly alive in the source. This
 * script decides the question at runtime instead.
 *
 * Usage:
 *   node scripts/audit-dead-css.js            # prints a ready-to-run bash command
 *   node scripts/audit-dead-css.js --probe    # prints the raw probe for devtools
 *
 * Pipe the first form into bash, or paste the second into the Obsidian devtools
 * console. The probe deliberately contains no single quotes so the emitted
 * command can be single-quoted safely. Note that invoking obsidian.com through
 * node's spawnSync fails with EBUSY on Windows, which is why this script only
 * emits the command instead of running it.
 *
 * IMPORTANT — coverage: a rule can only be judged when at least one element
 * currently matches it. Open every surface you care about before running
 * (workbench widgets, each own modal, an embedded Canvas, island mode, the
 * caption wall), otherwise most rules land in `noMatchInDom` and stay
 * unjudged. Never delete a rule that this script never got to test.
 *
 * Method, two passes:
 *   1. Blank pass — clear the rule, re-read only the properties it declared.
 *      No change means the rule contributed nothing.
 *   2. Sentinel pass — put an impossible value in and see whether the computed
 *      value follows. This separates a genuinely overridden rule from one that
 *      merely repeats the inherited value (e.g. --jd-heading and the theme's
 *      --text-muted are both #5c5c5c, so the blank pass alone flags it).
 *      Only rules that fail both passes are reported as overridden.
 *
 * Both passes restore the rule in a finally block; nothing is written to disk
 * and the stylesheet is left exactly as found.
 */

const PROBE = String.raw`
(() => {
  const sentinelFor = (p) => {
    if (p === "color" || /color$/.test(p) || p === "background") return "rgb(1, 2, 3)";
    if (/(radius|width|height|padding|margin|gap|top|left|right|bottom)/.test(p)) return "12345px";
    if (p === "display") return "inline-table";
    if (p === "opacity") return "0.123";
    return null;
  };
  const responded = (v) =>
    v.indexOf("1, 2, 3") > -1 || v.indexOf("12345") > -1 || v === "inline-table" || v === "0.123";

  const rules = [];
  /* Collect first, recurse second, and gate recursion on length. Chrome now
     exposes a (usually empty) cssRules list on plain CSSStyleRule because of
     CSS nesting, so an "if (rule.cssRules) { recurse; continue; }" shape
     silently skips every ordinary rule. */
  const walk = (list) => {
    for (const rule of list) {
      if (typeof rule.selectorText === "string" && rule.selectorText.indexOf("jam-deck") > -1) rules.push(rule);
      if (rule.cssRules && rule.cssRules.length) walk(rule.cssRules);
    }
  };
  for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch (err) { /* cross-origin */ } }

  const report = { totalJamRules: rules.length, tested: 0, noMatchInDom: 0, stateSelectors: 0, overridden: [], redundant: [] };

  for (const rule of rules) {
    const selector = rule.selectorText;
    if (/:hover|:focus|:active|:disabled|:checked|:placeholder|::/.test(selector)) { report.stateSelectors++; continue; }

    let el = null;
    try { el = document.querySelector(selector); } catch (err) { continue; }
    if (!el) { report.noMatchInDom++; continue; }

    const props = [];
    for (let i = 0; i < rule.style.length; i++) props.push(rule.style[i]);
    if (!props.length) continue;
    report.tested++;

    const read = () => props.map((p) => getComputedStyle(el).getPropertyValue(p)).join("|");
    const before = read();
    const saved = rule.style.cssText;
    let after = "";
    try { rule.style.cssText = ""; after = read(); } finally { rule.style.cssText = saved; }
    if (before !== after) continue;

    let reacted = false;
    let testable = 0;
    for (const p of props) {
      const sentinel = sentinelFor(p);
      if (!sentinel) continue;
      const keep = rule.style.getPropertyValue(p);
      rule.style.setProperty(p, sentinel);
      if (rule.style.getPropertyValue(p)) {
        testable++;
        if (responded(getComputedStyle(el).getPropertyValue(p))) reacted = true;
      }
      rule.style.setProperty(p, keep);
    }

    const record = { selector, declaredProps: props.length, probedProps: testable };
    if (testable === 0 || reacted) report.redundant.push(record);
    else report.overridden.push(record);
  }

  report.coverage = report.totalJamRules
    ? Math.round((report.tested / report.totalJamRules) * 100) + "%"
    : "0%";
  return JSON.stringify(report);
})();
`;

const compact = PROBE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s*\n\s*/g, " ").trim();

if (compact.includes("'")) {
  process.stderr.write("Probe contains a single quote; the emitted command would break.\n");
  process.exit(1);
}

if (process.argv.includes("--probe")) {
  process.stdout.write(`${PROBE}\n`);
} else {
  const vault = process.env.JAM_DECK_VAULT || "Jamnote";
  process.stdout.write(
    `"$LOCALAPPDATA/Programs/obsidian/obsidian.com" eval 'code=${compact}' vault=${vault}\n`
  );
}
