import assert from "node:assert/strict";
import { km, berth, pair, decide } from "./trade.mjs";

const port = { lat: 60.1497, lon: 24.9155, radiusKm: 1.5 };
const now = Date.parse("2026-11-23T16:00:00Z");
const at = (lat, lon, kn, min = 5) => ({ latitude: lat, longitude: lon, speed_knots: kn, observed_at: new Date(now - min * 60_000).toISOString() });

assert.ok(Math.abs(km({ lat: 60.1497, lon: 24.9155 }, { lat: 59.4437, lon: 24.7536 }) - 79) < 3, "Helsinki-Tallinn ~79 km");
assert.equal(berth(at(60.150, 24.916, 0.1), port, now).state, "berthed");
assert.equal(berth(at(60.150, 24.916, 6), port, now).state, "away", "moving inside the harbour is not berthed");
assert.equal(berth(at(59.748, 24.793, 22.8), port, now).state, "away", "at sea");
assert.equal(berth(at(60.150, 24.916, 0, 90), port, now).state, "unusable", "stale reading");
assert.equal(berth({ latitude: null }, port, now).state, "unusable");
assert.equal(berth({ ...at(60.150, 24.916, 0), observed_at: undefined }, port, now).state, "unusable", "no time");

assert.equal(berth(at(60.150, 24.916, 0, -30), port, now).state, "unusable", "future timestamp");
assert.equal(berth({ ...at(60.150, 24.916, 0), vessel: "OTHER SHIP" }, port, now, "MEGASTAR").state, "unusable", "another ship");
assert.equal(berth({ ...at(60.150, 24.916, 0), vessel: "Megastar" }, port, now, "MEGASTAR").state, "berthed", "name case-insensitive");
assert.equal(pair(true, true, true, false), "pass");
assert.equal(pair(false, false, true, false), "fail");
assert.equal(pair(true, false, true, false), "review");
assert.equal(pair(true, null, true, false), "review", "a missing answer is doubt");

assert.equal(decide({ arrival: "pass", invoice: "pass", sanctions: "pass" })[0], "pay");
assert.equal(decide({ arrival: "fail", invoice: "pass", sanctions: "pass" })[0], "hold");
assert.equal(decide({ arrival: "pass", invoice: "fail", sanctions: "pass" })[0], "refund");
assert.equal(decide({ arrival: "pass", invoice: "review", sanctions: "pass" })[0], "review");
assert.equal(decide({ arrival: "review", invoice: "fail", sanctions: "pass" })[0], "review", "doubt beats refund");
assert.equal(decide({ arrival: "review", invoice: "review", sanctions: "fail" })[0], "refund", "sanctions hit beats everything");
console.log("trade: 20 checks ok");

// Port authority record (Digitraffic port calls), shaped like the real 23-27 Nov MEGASTAR calls at FIHEL.
import { portCall, arrivalWith, sameFix, lateBy, identity, sameEntity } from "./trade.mjs";
let m = 0;
const ok = (c, msg) => { assert.ok(c, msg); m++; };
const call = (id, ata, atd, eta = ata) => ({ portCallId: id, portToVisit: "FIHEL", portAreaDetails: [{ portAreaCode: "LS", berthCode: "LJ7", eta, ata, atd }] });
const calls = [call(1, "2026-11-23T22:30:00Z", "2026-11-24T05:15:00Z"), call(2, "2026-11-24T16:30:00Z", "2026-11-24T17:14:00Z"), call(3, null, null, "2026-11-27T16:30:00Z")];
const HEL = { locode: "FIHEL", area: "LS" };
ok(portCall(calls, HEL, Date.parse("2026-11-23T23:46:00Z")).state === "berthed", "in port between ATA and ATD (case 1's 23:46 round)");
ok(portCall(calls, HEL, Date.parse("2026-11-23T23:46:00Z")).ata === "2026-11-23T22:30:00Z", "reports the actual arrival time");
ok(portCall(calls, HEL, Date.parse("2026-11-27T06:55:00Z")).state === "away", "away after ATD (the 27 Nov HOLD round)");
ok(portCall(calls, HEL, Date.parse("2026-11-27T06:55:00Z")).nextEta === "2026-11-27T16:30:00Z", "an ETA alone is the next call, not an arrival");
ok(portCall(calls, { locode: "EETLL", area: null }).state === "unknown", "no call at another port");
ok(portCall([], HEL).state === "unknown", "no record at all");
ok(portCall([call(9, "2026-11-23T22:30:00Z", null)], { locode: "FIHEL", area: "VS" }, Date.parse("2026-11-23T23:00:00Z")).state === "unknown", "another harbour area of the same port");

ok(arrivalWith("pass", "berthed") === "pass", "AIS and port agree: arrived");
ok(arrivalWith("fail", "away") === "fail", "AIS and port agree: at sea");
ok(arrivalWith("pass", "away") === "review", "AIS says berthed, the port has no arrival: doubt (spoofing looks like this)");
ok(arrivalWith("pass", "unknown") === "review", "port record unavailable: fail closed");
ok(arrivalWith("fail", "berthed") === "review", "port says in, AIS says out: doubt");

ok(sameFix({ latitude: 60.14971, longitude: 24.91552 }, { latitude: 60.14971, longitude: 24.91552 }), "same fix from two relays");
ok(!sameFix({ latitude: 60.14971, longitude: 24.91552 }, { latitude: 60.1503, longitude: 24.9161 }), "different fixes");
ok(!sameFix({}, {}), "no position is not a shared fix");

ok(lateBy("2026-11-25T10:00:00Z", "2026-11-24T10:00:00Z") === 24, "a day late");
ok(lateBy("2026-11-23T22:30:00Z", "2026-11-24T00:00:00Z") === 0, "on time");
ok(lateBy(null, "2026-11-24T00:00:00Z") === 0 && lateBy("2026-11-24T00:00:00Z", null) === 0, "no date, no lateness");

ok(identity({ legal_name: "Siemens Aktiengesellschaft", lei: "W38RGI023J3WT1HWRP32" }, "Siemens AG").state === "verified", "AG vs Aktiengesellschaft: the distinctive word decides");
ok(identity({ legal_name: "SIEMENS AG", lei: "W38RGI023J3WT1HWRP32", jurisdiction: "DE" }, "Siemens AG").state === "verified", "verified with an LEI");
ok(identity({}, "Harju Metal OÜ (illustrative supplier)").state === "unverified", "an illustrative supplier is not found");
ok(identity({ legal_name: "Tyrconnel Trust Charity", lei: "X" }, "Tyrconnel Mining").state === "mismatch", "a surname match is someone else");
ok(sameEntity("Harju Metal OÜ", "HARJU METAL OÜ"), "case and punctuation do not matter");

ok(decide({ arrival: "pass", invoice: "pass", sanctions: "pass", late: 26 })[0] === "review", "late delivery goes to the panel");
ok(decide({ arrival: "pass", invoice: "pass", sanctions: "pass", identity: "review" })[0] === "review", "required identity not verified: review");
ok(decide({ arrival: "fail", invoice: "pass", sanctions: "pass", late: 26 })[0] === "hold", "not arrived beats late");
ok(decide({ arrival: "pass", invoice: "pass", sanctions: "pass", late: 0 })[0] === "pay", "on time pays");
console.log(`trade port, identity, lateness: ${m} checks ok`);

import { payable } from "./trade.mjs";
assert.equal(payable(1_000_000n, 12400, [-496, -496], 496), 960_000n, "960 of 1000 accepted");
assert.equal(payable(1_000_000n, 12400, [-496, 496.4], 496), 960_000n, "sign and rounding");
assert.equal(payable(1_000_000n, 12400, [-496, -248], 496), null, "miners disagree on the shortfall");
assert.equal(payable(1_000_000n, 12400, [-496, -496], 248), null, "Praman disagrees");
assert.equal(payable(1_000_000n, 12400, [-496, null], 496), null, "one miner gave no figure");
assert.equal(payable(1_000_000n, 12400, [-12400, -12400], 12400), null, "nothing accepted is a refund, not a split");
console.log("trade payable: 6 checks ok");

// Every recorded Trade Assurance round, re-decided from the answers it stored, must give the
// decision and payout that were recorded (and acted on). Offline: reads receipts/ only.
import { replay } from "./trade.mjs";
import { readFileSync, existsSync } from "node:fs";
{
  const PORT = { lat: 60.1497, lon: 24.9155, radiusKm: 1.5, locode: "FIHEL", area: "LS" };
  const V4 = "0x310275e6d66818e068245326bb9e398822304248";
  const rows = readFileSync(new URL("../receipts/trade-assurance/log.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const key = (r) => `${(r.contract ?? V4).toLowerCase()}:${r.id}`;
  const terms = new Map(rows.filter((r) => r.action === "open").map((r) => [key(r), r.terms]));
  let k = 0;
  for (const row of rows.filter((r) => r.file && /^(hold|review|propose)$/.test(r.action))) {
    const f = new URL(`../${row.file}`, import.meta.url);
    if (!existsSync(f)) continue;
    const r = JSON.parse(readFileSync(f, "utf8"));
    const x = replay(r, terms.get(key(row)), PORT);
    assert.equal(x.decision, r.decision, `${row.file}: replayed decision`);
    assert.equal(x.payout ?? null, r.payout ?? null, `${row.file}: replayed payout`);
    k++;
  }
  assert.ok(k >= 11, "every recorded round was replayed");
  console.log(`trade replay: ${k} recorded rounds re-decided, all match`);
}

// Signed documents: the buyer's goods-received note and the supplier's invoice, EIP-712, bound to the deal.
import { verifyDocs, DOC_TYPES, docDomain, decide as decide2 } from "./trade.mjs";
import { ethers as E } from "ethers";
{
  let q = 0; const ok2 = (c, m) => { assert.ok(c, m); q++; };
  const buyerW = new E.Wallet("0x" + "11".repeat(32)), supplierW = new E.Wallet("0x" + "22".repeat(32)), other = new E.Wallet("0x" + "33".repeat(32));
  const contract = "0x310275e6D66818E068245326bB9e398822304248";
  const grnMsg = { dealId: 2, po: "PO-7781", invoice: "INV-2026-1107", acceptedUnits: 1000, rejectedUnits: 0, note: "GRN-5530: 1000 units received in good order" };
  const invMsg = { dealId: 2, invoice: "INV-2026-1107", po: "PO-7781", units: 1000, unitPriceCents: 1240, totalCents: 1240000 };
  const sign = async (w, type, message) => ({ type, message, signature: await w.signTypedData(docDomain(contract), { [type]: DOC_TYPES[type] }, message) });
  const ctx = { contract, dealId: 2, payer: buyerW.address, payee: supplierW.address };
  const grn = await sign(buyerW, "GoodsReceipt", grnMsg), inv = await sign(supplierW, "Invoice", invMsg);
  const good = verifyDocs({ grn, invoice: inv }, ctx);
  ok2(good.state === "signed" && good.acceptedUnits === 1000, "both parties signed, for this deal");
  ok2(verifyDocs({ grn: await sign(other, "GoodsReceipt", grnMsg), invoice: inv }, ctx).state === "invalid", "a receipt not signed by the buyer");
  ok2(verifyDocs({ grn, invoice: await sign(buyerW, "Invoice", invMsg) }, ctx).state === "invalid", "an invoice signed by the buyer, not the supplier");
  ok2(verifyDocs({ grn, invoice: inv }, { ...ctx, dealId: 3 }).state === "invalid", "documents for another deal");
  ok2(verifyDocs({ grn, invoice: inv }, { ...ctx, contract: "0xa6D0482cBF29FE43fB644F33f7a020766AF4A42B" }).state === "invalid", "signed for another contract: the domain binds it");
  ok2(verifyDocs({ grn: await sign(buyerW, "GoodsReceipt", { ...grnMsg, invoice: "INV-9" }), invoice: inv }, ctx).state === "invalid", "receipt and invoice name different invoices");
  ok2(verifyDocs({ grn, invoice: await sign(supplierW, "Invoice", { ...invMsg, totalCents: 1300000 }) }, ctx).state === "invalid", "an invoice whose total is not units x price");
  ok2(verifyDocs({ grn: await sign(buyerW, "GoodsReceipt", { ...grnMsg, acceptedUnits: 1001 }), invoice: inv }, ctx).state === "invalid", "more received than invoiced");
  ok2(verifyDocs({ grn: { ...grn, message: { ...grnMsg, acceptedUnits: 999 } }, invoice: inv }, ctx).state === "invalid", "a receipt edited after signing");
  ok2(verifyDocs({ invoice: inv }, ctx).state === "missing", "no receipt");
  ok2(decide2({ arrival: "pass", invoice: "pass", sanctions: "pass", documents: "review" })[0] === "review", "terms require signed documents and they are not there: review");
  console.log(`trade signed documents: ${q} checks ok`);
}
{
  // A Countersign memo can hold a payment but never release one alone.
  assert.equal(decide({ arrival: "pass", invoice: "pass", sanctions: "pass", countersign: "review" })[0], "review", "Countersign HOLD (or unusable memo): review");
  assert.equal(decide({ arrival: "fail", invoice: "pass", sanctions: "pass", countersign: "pass" })[0], "hold", "Countersign release does not override a ship at sea");
  console.log("trade countersign gate: 2 checks ok");
}
{
  // A real Telegraph signal (MEGASTAR berthed, 23 Nov): its hash recomputed from the payload.
  const { signalHashOf } = await import("./trade.mjs");
  const sig = JSON.parse(readFileSync(new URL("../receipts/trade-assurance/signal-sample.json", import.meta.url), "utf8"));
  assert.equal(signalHashOf(sig.payload), sig.signal_hash, "signal hash = keccak256(canonical payload)");
  assert.notEqual(signalHashOf({ ...sig.payload, response: { ...sig.payload.response, speed_knots: 9 } }), sig.signal_hash, "an edited answer no longer matches its signal");
  console.log("trade signal hash: 2 checks ok");
}
{
  const { latePayout } = await import("./trade.mjs");
  const a = latePayout(1_000_000n, 26, 2);
  assert.equal(a.days, 2, "26 h late is two started days"); assert.equal(a.cutPct, 4); assert.equal(a.payout, 960_000n, "2 % a day: 0.96 to the supplier");
  assert.equal(latePayout(1_000_000n, 24 * 40, 2, 30).payout, 700_000n, "capped at 30 %");
  assert.equal(latePayout(1_000_000n, 0, 2), null, "on time: no penalty");
  assert.equal(latePayout(1_000_000n, 5, 0), null, "no penalty in the terms: the panel decides");
  console.log("trade late penalty: 6 checks ok");
}
{
  // replay(): a clean but late delivery with a penalty in the terms re-decides to the split.
  const { replay: rp } = await import("./trade.mjs");
  const at = "2026-11-25T10:00:00Z";
  const fix = { latitude: 60.1498, longitude: 24.9156, speed_knots: 0, observed_at: at, vessel: "MEGASTAR" };
  const round = { at, vessel: [{ result: fix }, { result: fix }], invoice: [{ result: { reconciled: true } }, { result: { reconciled: true } }],
    sanctions: { takar: "agree", screens: [{ matched: false }, { matched: false }], praman: { matched: false, sdn_last_loaded: "x" } },
    port: { state: "berthed", ata: "2026-11-25T08:00:00Z" } };
  const terms = { vessel: "MEGASTAR", port: "Helsinki West Harbour", deliverBy: "2026-11-24T06:00:00Z", latePenaltyPctPerDay: 2, latePenaltyCapPct: 30 };
  const P = { lat: 60.1497, lon: 24.9155, radiusKm: 1.5 };
  const x = rp(round, terms, P);
  assert.equal(x.decision, "partial"); assert.equal(x.payout, "960000", "26 h late, 2 % a day: 0.96");
  assert.equal(rp(round, { ...terms, latePenaltyPctPerDay: undefined }, P).decision, "review", "no penalty in the terms: panel");
  console.log("trade late replay: 3 checks ok");
}
