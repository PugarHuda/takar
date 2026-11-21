// Reputation rules, no network.  node lib/reputation.test.mjs
import assert from "node:assert/strict";
import { fromScorecard, fromFleet, dedupe, rank, wilson, decodeRow, VERDICT } from "./reputation.mjs";

const S = (n) => "0x" + String(n).padStart(64, "0");
const card = { rows: [
  { market: { resolution: "YES", url: "https://manifold.markets/a" }, verification: { attempts: [
    { miner: { id: "1" }, outcome: "yes", signal: S(1) }, { miner: { id: "2" }, outcome: "no", signal: S(2) },
    { miner: { id: "3" }, outcome: "unresolved", signal: S(3) }, { miner: { id: "4" }, outcome: "unreadable", signal: S(4) },
    { miner: { id: "5" }, outcome: "yes", signal: null } ] } },
  { market: { resolution: "MKT" }, verification: { attempts: [{ miner: { id: "1" }, outcome: "yes", signal: S(9) }] } } ] };
const recs = fromScorecard(card);
assert.deepEqual(recs.map((r) => [r.minerId, r.verdict]), [["1", VERDICT.right], ["2", VERDICT.wrong], ["3", VERDICT.abstained], ["4", VERDICT.unusable]], "no signal or no clear resolution, no record");
const fleet = fromFleet([{ unit: "d1", location: "Bandung", unusableMiners: [{ intent: "STORM_ALERT_GENERAL", miner: { id: "37007" }, signal: S(7), why: "answered for another place (Kerman, Iran)" }, { intent: "STORM_ALERT_GENERAL", miner: { id: "37004" }, signal: S(8), why: "missing a required field" }] }]);
assert.deepEqual(fleet.map((r) => r.verdict), [VERDICT.wrong_place, VERDICT.unusable]);
assert.equal(dedupe([...recs, recs[0]], new Set([S(2)])).length, 3, "one record per signal, skip what is attested");

const att = (minerId, verdict, attester = "0xA") => ({ intent: "X", minerId, verdict, attester });
const r = rank([att("1", 1), att("1", 1), att("1", 1), att("2", 1), att("2", 2), att("3", 5), att("3", 5), att("3", 1), att("9", 1, "0xB")], { intent: "X", attesters: ["0xa"] });
assert.deepEqual(r.map((m) => m.minerId), ["1", "3", "2"], "more evidence ranks higher; abstaining does not cost accuracy; other attesters filtered out");
assert.equal(r.find((m) => m.minerId === "3").coverage, 0.333);
assert.ok(wilson(1, 1) < wilson(10, 10), "one lucky answer does not beat a long record");
assert.equal(wilson(0, 0), 0);
const row = decodeRow({ id: "u", attester: "0xA", time: 1, decodedDataJson: JSON.stringify([{ name: "intent", value: { value: "X" } }, { name: "minerId", value: { value: { type: "BigNumber", hex: "0x0135a1ad" } } }, { name: "signal", value: { value: S(1) } }, { name: "verdict", value: { value: 2 } }, { name: "truthSource", value: { value: "t" } }]) });
assert.equal(row.minerId, "20292013"); assert.equal(row.verdict, 2);
console.log("reputation rules: 11 checks ok");
// Sanctions screens against a known answer.
{
  const { fromScreens } = await import("./reputation.mjs");
  const h = (n) => "0x" + String(n).repeat(64).slice(0, 64);
  const truth = { "Bank Rossiya": { listed: true, source: "OFAC SDN 16681" } };
  const row = (minerId, result, n) => ({ intent: "SANCTIONS_SCREENING_MATCH_GENERAL", params: { name: "Bank Rossiya" }, minerId, signalHash: h(n), resultShape: "intent", result });
  const v = fromScreens([row("1", { matched: true }, 1), row("2", { matched: null }, 2), row("3", { matched: false, lists: ["UN SC"] }, 3), row("4", { matched: false }, 4), { ...row("5", {}, 5), params: { name: "Unknown Co" } }], truth).map((r) => r.verdict);
  assert.deepEqual(v, [1, 3, 4, 2], "right, unusable, wrong place (UN list only), wrong; unknown names skipped");
  console.log("sanctions evidence: 1 check ok");
}
{
  const { rank } = await import("./reputation.mjs");
  const a = (attester, minerId, verdict) => ({ attester, minerId, verdict, intent: "I" });
  const atts = [a("0xA", "1", 1), a("0xA", "1", 1), a("0xB", "1", 2), a("0xB", "1", 2), a("0xB", "1", 2)];
  const flat = rank(atts, { intent: "I" })[0], weighted = rank(atts, { intent: "I", weights: { "0xb": 0.2 } })[0];
  assert.equal(flat.wrong, 3); assert.ok(Math.abs(weighted.wrong - 0.6) < 1e-9, "a low-weight attester counts for less");
  assert.ok(weighted.score > flat.score);
  console.log("attester weights: 3 checks ok");
}
