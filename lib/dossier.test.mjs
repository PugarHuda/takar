// Gold Rush dossier rules, no network.  node lib/dossier.test.mjs
import assert from "node:assert/strict";
import { tonnes, reconcileProduction, bandCheck, closures, inPaidAnswer, buildDossier } from "./dossier.mjs";

assert.equal(tonnes(1000, "kg"), 1);
assert.ok(Math.abs(tonnes(1e6, "oz") - 31.1034768) < 1e-9, "troy ounces");
assert.equal(tonnes(5, "bags"), null, "an unknown unit is not converted");
const row = (amount, unit, from, to, source, scope = "site_total", quote = "") => ({ commodity: "gold", amount, unit, period_from: from, period_to: to, source_ref: source, scope, quote });
const rec = reconcileProduction([
  row(250, "t", 1882, 1990, "GOV"), row(262, "t", 1882, 1981, "WP"), row(294056, "kg", null, null, "REG:Total"),
  row(237896, "kg", null, 1982, "REG:P:1", "period"), row(56160, "kg", 1983, 1990, "REG:P:2", "period", "Ore Type DUMP"),
]);
assert.equal(rec.sums[0].consistent, true, "dated rows add up to the register total");
const by = (a, b) => rec.pairs.find((p) => p.a === a && p.b === b);
assert.equal(by("GOV", "WP").relation, "close", "within 5% but different periods is not agreement");
assert.equal(by("GOV", "REG:Total").relation, "conflict", "same period (end year taken from the dated rows), 15% apart");
assert.match(by("GOV", "REG:Total").why, /dumps or tailings.*237\.9 t/, "the tailings explanation is offered");
assert.equal(by("WP", "REG:Total").relation, "not comparable");
const shorter = reconcileProduction([row(100, "t", 1900, 1950, "A"), row(80, "t", 1890, 1960, "B")]);
assert.equal(shorter.pairs[0].relation, "conflict", "a shorter period reporting more gold");
assert.equal(bandCheck(294, "giant, over 150 tonnes").consistent, true);
assert.equal(bandCheck(51.5, "50 - 150 TONNES").consistent, true);
assert.equal(bandCheck(20, "50 - 150 TONNES").consistent, false);
const c = closures([
  { year: 1927, reason_text: "until 1927 when fire destroyed underground workings", reason_class: "unknown", source_ref: "WP" },
  { year: 1990, reason_text: null, source_ref: "GOV" }, { year: 1990, reason_text: null, source_ref: "REG:MineHist:1" },
  { year: 1981, reason_text: "end of its ore body", reason_class: "exhausted", source_ref: "WP" }]);
assert.equal(c[0].reason[0].cls, "not geological (fire)");
assert.equal(c[1].reason[0].cls, "geological exhaustion");
assert.equal(c[2].status, "two sources"); assert.equal(c[2].reason, "no source states a reason");
assert.ok(inPaidAnswer(294056, "and 294,056 kg of gold")); assert.ok(!inPaidAnswer(237896, "nothing here"));
const d = buildDossier({ mine: "X", history: { site_no: 5, production: [], closure: [{ year: 1917, source_ref: "R" }], not_found: ["owners"] }, survey: { answer: "gold large, 50 - 150 t", sources: ["…site_no%3D6…"] } });
assert.equal(d.identity.same_site, false, "two different site numbers are flagged");
assert.ok(d.open_questions.some((q) => /1917.*do not assume/.test(q)));
console.log("gold rush dossier rules: 21 checks ok");
{
  const { causesIn, closureFinding } = await import("./dossier.mjs");
  assert.deepEqual(causesIn("operations ceased in 1917 as the ore body was depleted and the war took the miners who enlisted"), ["ore exhausted", "war"]);
  assert.equal(closureFinding([{ miner: "1", text: "closed because of falling gold price" }, { miner: "2", text: "uneconomic after costs rose" }]).status, "corroborated");
  assert.equal(closureFinding([{ miner: "1", text: "a fire" }, { miner: "2", text: "flooding of the shafts" }]).status, "disputed");
  assert.equal(closureFinding([{ miner: "1", text: "a fire" }, { miner: "2", text: "no record" }]).status, "single source");
  console.log("closure research: 4 checks ok");
}
{
  const { md } = await import("./dossier.mjs");
  assert.equal(md("![x](http://evil/a.png) [y](javascript:z)"), String.raw`\!\[x\]\(http://evil/a.png\) \[y\]\(javascript:z\)`, "miner text cannot become an image or a link");
  console.log("markdown escape: 1 check ok");
}
{
  const { renderMarkdown, buildDossier } = await import("./dossier.mjs");
  const d = buildDossier({ mine: "X", history: { site_no: 1, production: [{ commodity: "gold", amount: 1000, unit: "kg", scope: "site_total", source_ref: "S](javascript:alert(1)", source_url: "javascript:alert(1)", entity: "![img](http://e/x.png)" }], ownership: [{ owner: "[Evil](http://e)", source_ref: "R" }] }, survey: {}, control: [{ company: "<b>Co</b>", active: null, why: "x](y", miners: [], other_differences: [] }] });
  const out = renderMarkdown(d);
  assert.ok(!/\]\(javascript:/i.test(out), "no javascript: link");
  assert.ok(!/!\[img\]\(/.test(out), "no image from miner text");
  assert.ok(!/<b>/.test(out), "no raw HTML from miner text");
  console.log("render escaping: 3 checks ok");
}
{
  const { cpiSeries, realRatio } = await import("./dossier.mjs");
  const s = cpiSeries("observation_date,CPIAUCNS\n1990-01-01,127.4\n1990-07-01,130.4\n2026-10-01,337.5\n");
  const r = realRatio(s, 1990, 410, "2026-10", 4105);
  assert.equal(r.cpi_then, 128.9); assert.equal(r.inflation, 2.62);
  assert.equal(r.real_ratio, 3.82, "10x nominal is about 3.8x after US inflation");
  assert.equal(realRatio(s, 1917, 20.67, "2026-10", 4105), null, "no CPI for the year, no real ratio");
  console.log("inflation: 4 checks ok");
}
{
  const { year, goldRows } = await import("./dossier.mjs");
  assert.equal(year("1917"), 1917); assert.equal(year("<img src=x>"), null); assert.equal(year(null), null);
  assert.equal(goldRows([{ commodity: "gold", amount: 1, unit: "t", period_from: "[x](javascript:y)", period_to: 1990 }])[0].from, null, "a year that is not a number is dropped");
  console.log("years: 4 checks ok");
}
{
  const { summariseTenure } = await import("./tenure.mjs");
  const f = (id, holder, exp, nt, kind = "ML granted") => ({ kind, displayname: id, permitstatus: "Granted", authorisedholdername: holder, expirydate: Date.parse(exp), nativetitlecategory: nt });
  const t = summariseTenure([f("ML 1", "A PTY LTD", "2025-08-31", "Granted before 1 January 1994"), f("ML 1", "A PTY LTD", "2025-08-31", "x", "ML granted (access)"), f("ML 2", "A PTY LTD", "2030-01-01", "No Registered Native Title Claimants")], { now: Date.parse("2026-11-22") });
  assert.equal(t.authorities, 2, "one row per authority across layers");
  assert.equal(t.expired_but_granted, 1); assert.match(t.note, /renewal is pending/);
  assert.equal(t.holders["A PTY LTD"], 2);
  console.log("tenure: 4 checks ok");
}
{
  const { buildDossier } = await import("./dossier.mjs");
  const mk = (band, n) => buildDossier({ mine: "X", history: { site_no: 1, gsq_record: { size_definition: band } }, survey: { answer: `Within 5 km it records ${n} other historical workings` } }).open_questions.some((q) => q.startsWith("identity:"));
  assert.equal(mk("<0.5 TONNES", 130), true, "a tiny working in a crowded field is flagged");
  assert.equal(mk("0.5 - 5 TONNES", 32), true);
  assert.equal(mk(">150 TONNES", 37), false, "a giant with neighbours is not ambiguous");
  assert.equal(mk("<0.5 TONNES", 3), false, "a tiny working alone is not ambiguous");
  console.log("name ambiguity: 4 checks ok");
}
{
  const { troveArticles, troveSearch } = await import("./trove.mjs");
  const json = { category: [{ code: "newspaper", records: { article: [
    { id: "1", heading: "THE BRILLIANT MINE", date: "1920-03-01", title: { title: "The Northern Miner" }, snippet: "<strong>closed</strong> owing to the war" },
    { id: "2", heading: "BRILLIANT CLOSES", date: "1917-06-02", title: { title: "Townsville Daily Bulletin" }, snippet: "work ceased", troveUrl: "https://trove.nla.gov.au/newspaper/article/2" },
    { id: "3", heading: "", date: "1917-01-01" }] } }] };
  const a = troveArticles(json, 1917);
  assert.equal(a.length, 2, "articles without a heading are dropped");
  assert.equal(a[0].date, "1917-06-02", "nearest to the closure year first");
  assert.equal(a[1].snippet, "closed owing to the war", "tags stripped");
  assert.equal(await troveSearch("X", 1917, { key: "" }), null, "no key, no call");
  console.log("trove: 4 checks ok");
}
