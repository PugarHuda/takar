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
