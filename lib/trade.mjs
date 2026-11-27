// Trade Assurance rules (scripts/trade-assurance.mjs): pure, so they are tested offline.
import { ethers } from "ethers";

/** The parties' own documents, signed as EIP-712 typed data bound to one deal on one contract:
 *  the buyer signs what it received, the supplier signs what it billed. Then "the goods-received
 *  note" the miners reconcile is the buyer's own statement, not text Takar wrote. */
export const DOC_TYPES = {
  GoodsReceipt: [
    { name: "dealId", type: "uint256" }, { name: "po", type: "string" }, { name: "invoice", type: "string" },
    { name: "acceptedUnits", type: "uint256" }, { name: "rejectedUnits", type: "uint256" }, { name: "note", type: "string" },
  ],
  Invoice: [
    { name: "dealId", type: "uint256" }, { name: "invoice", type: "string" }, { name: "po", type: "string" },
    { name: "units", type: "uint256" }, { name: "unitPriceCents", type: "uint256" }, { name: "totalCents", type: "uint256" },
  ],
};
export const docDomain = (contract) => ({ name: "Takar Trade Assurance", version: "1", chainId: 11155111, verifyingContract: contract });

/** Both documents present, signed by the deal's own payer (receipt) and payee (invoice), for this
 *  deal, about the same invoice and PO, with arithmetic that adds up. */
export function verifyDocs(docs, { contract, dealId, payer, payee }) {
  const { grn, invoice } = docs ?? {};
  if (!grn || !invoice) return { state: "missing", why: `no ${!grn ? "signed goods-received note" : "signed invoice"} for this deal` };
  const signer = (d, type) => { try { return ethers.verifyTypedData(docDomain(contract), { [type]: DOC_TYPES[type] }, d.message, d.signature); } catch { return null; } };
  const g = signer(grn, "GoodsReceipt"), i = signer(invoice, "Invoice");
  const same = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
  const bad = [
    !same(g, payer) && `the goods-received note is signed by ${g ?? "nobody"}, not the buyer ${payer}`,
    !same(i, payee) && `the invoice is signed by ${i ?? "nobody"}, not the supplier ${payee}`,
    (String(grn.message.dealId) !== String(dealId) || String(invoice.message.dealId) !== String(dealId)) && "a document is for another deal",
    (grn.message.invoice !== invoice.message.invoice || grn.message.po !== invoice.message.po) && "the receipt and the invoice name different invoice or PO numbers",
    BigInt(invoice.message.units) * BigInt(invoice.message.unitPriceCents) !== BigInt(invoice.message.totalCents) && "the invoice total is not units x unit price",
    BigInt(grn.message.acceptedUnits) + BigInt(grn.message.rejectedUnits) > BigInt(invoice.message.units) && "more units received than invoiced",
  ].filter(Boolean);
  if (bad.length) return { state: "invalid", why: bad.join("; "), grnSigner: g, invoiceSigner: i };
  return { state: "signed", grnSigner: g, invoiceSigner: i, acceptedUnits: Number(grn.message.acceptedUnits), invoicedUnits: Number(invoice.message.units), note: grn.message.note };
}

export function km(a, b) {
  const r = (d) => (d * Math.PI) / 180, dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** One vessel reading -> berthed / away / unusable, against the port and a 60-minute freshness bound. */
export function berth(result, port, now = Date.now(), vessel = null) {
  const { latitude: lat, longitude: lon, speed_knots: kn, observed_at } = result ?? {};
  if (typeof lat !== "number" || typeof lon !== "number" || typeof kn !== "number") return { state: "unusable", why: "no position" };
  const norm = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (vessel && norm(result.vessel) !== norm(vessel)) return { state: "unusable", why: `reading is for ${result.vessel ?? "an unnamed vessel"}, not ${vessel}` };
  const age = (now - Date.parse(observed_at)) / 60_000;
  // Fresh means 0-60 min old, with 2 min of clock skew; a future timestamp is not fresh.
  if (!(age >= -2 && age <= 60)) return { state: "unusable", why: `reading ${Number.isFinite(age) ? Math.round(age) + " min old" : "has no time"}` };
  const d = km({ lat, lon }, port);
  return { state: d <= port.radiusKm && kn <= 1 ? "berthed" : "away", km: Math.round(d * 100) / 100, knots: kn, ageMin: Math.round(age) };
}

/** Two independent verdicts -> pass (both passWhen) / fail (both failWhen) / review (anything else). */
export function pair(a, b, passWhen, failWhen) {
  if (a === passWhen && b === passWhen) return "pass";
  if (a === failWhen && b === failWhen) return "fail";
  return "review";
}

/** Port authority record (Fintraffic Digitraffic / Portnet port calls), not the ship's own AIS:
 *  berthed at `at` when a call at this LOCODE and port area has an actual arrival (ATA) at or before
 *  `at` and no actual departure (ATD) yet. A call with only an ETA is not an arrival. */
export function portCall(calls, { locode, area }, at = Date.now()) {
  const mine = (calls ?? []).filter((c) => c.portToVisit === locode).map((c) => ({ id: c.portCallId, ...((c.portAreaDetails ?? []).find((a) => !area || a.portAreaCode === area) ?? {}) })).filter((c) => c.ata || c.eta);
  if (!mine.length) return { state: "unknown", why: `no port call for ${locode}` };
  const t = new Date(at).getTime();
  const inPort = mine.find((c) => c.ata && Date.parse(c.ata) <= t && !(c.atd && Date.parse(c.atd) <= t));
  if (inPort) return { state: "berthed", ata: inPort.ata, berth: inPort.berthCode ?? null, call: inPort.id };
  const last = mine.filter((c) => c.atd && Date.parse(c.atd) <= t).sort((a, b) => Date.parse(b.atd) - Date.parse(a.atd))[0];
  const next = mine.filter((c) => !c.ata && c.eta && Date.parse(c.eta) > t).sort((a, b) => Date.parse(a.eta) - Date.parse(b.eta))[0];
  return { state: "away", lastAtd: last?.atd ?? null, nextEta: next?.eta ?? null, call: (next ?? last)?.id ?? null };
}

/** Two AIS relays + the port's own record. AIS is one broadcast from the ship however many
 *  operators relay it, so it only passes when the port agrees; a split is doubt, not a payment. */
export function arrivalWith(ais, port) {
  if (ais === "pass" && port === "berthed") return "pass";
  if (ais === "fail" && port === "away") return "fail";
  return "review";
}

/** Two relays returning the same position to the metre are one AIS message, reported as such. */
export function sameFix(a, b) {
  const p = (r) => (typeof r?.latitude === "number" && typeof r?.longitude === "number" ? `${r.latitude.toFixed(5)},${r.longitude.toFixed(5)}` : null);
  return p(a) !== null && p(a) === p(b);
}

/** Hours after the agreed delivery date, from the port's actual arrival time; 0 when on time. */
export function lateBy(ata, deliverBy) {
  if (!ata || !deliverBy) return 0;
  const h = (Date.parse(ata) - Date.parse(deliverBy)) / 3_600_000;
  return Number.isFinite(h) && h > 0 ? Math.round(h * 10) / 10 : 0;
}

const WORDS = (s) => new Set(String(s ?? "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !/^(PTY|LTD|LIMITED|THE|AND|CORPORATION|COMPANY)$/.test(w)));
/** A register's name and a resolved legal name must share all their distinctive words. */
export const sameEntity = (a, b) => { const A = WORDS(a), B = WORDS(b); return A.size > 0 && [...A].every((w) => B.has(w)); };

/** Supplier identity from an identity miner's raw answer: verified (legal name matches and an LEI),
 *  mismatch (resolved to someone else), or unverified (nothing found). */
export function identity(raw, supplier) {
  const name = String(supplier ?? "").replace(/\(.*?\)/g, "").trim();
  if (!raw?.legal_name || !raw?.lei) return { state: "unverified", why: `no registered entity found for ${name}` };
  if (!sameEntity(name, raw.legal_name)) return { state: "mismatch", why: `resolved to ${raw.legal_name} (${raw.lei}), not ${name}`, legal_name: raw.legal_name, lei: raw.lei };
  return { state: "verified", legal_name: raw.legal_name, lei: raw.lei, jurisdiction: raw.jurisdiction ?? null, status: raw.status ?? null };
}

/** Checks -> decision, most cautious first: sanctions hit refunds, any doubt goes to review.
 *  Optional: `identity` (gates only when the terms require an LEI) and `late` (hours after the
 *  agreed date; a late delivery goes to the panel instead of paying in full). */
export function decide({ arrival, invoice, sanctions, identity: who = "pass", documents = "pass", countersign = "pass", late = 0 }, port = "the port") {
  if (sanctions === "fail") return ["refund", "supplier matched a sanctions list in both Takar's and Praman's screens"];
  const doubt = Object.entries({ arrival, invoice, sanctions, identity: who, documents, countersign }).filter(([, v]) => v === "review").map(([k]) => k);
  if (doubt.length) return ["review", `checks disagree or are unusable: ${doubt.join(", ")}`];
  if (invoice === "fail") return ["refund", "both reconcile miners say the invoice does not match the PO and goods received"];
  if (arrival === "fail") return ["hold", `the ship is not berthed at ${port} yet (both vessel miners and the port's own record agree)`];
  if (late > 0) return ["review", `delivered ${late} h after the agreed date (port's actual arrival time): the panel decides what is owed`];
  return ["pay", `berthed at ${port}, invoice reconciles, supplier clear`];
}

/** Quantity dispute: what the supplier is owed for the accepted part, in token units.
 *  The two reconcile miners must report the same shortfall (within 1 currency unit) and Praman's
 *  own three-way reconciliation must land on it too; otherwise null (review). */
export function payable(amount, invoiceTotal, discrepancies, pramanDelta) {
  const ds = discrepancies.map((d) => Math.abs(Number(d)));
  if (ds.length < 2 || ds.some((d) => !Number.isFinite(d) || d <= 0)) return null;
  if (Math.max(...ds) - Math.min(...ds) > 1 || !(Math.abs(Math.abs(Number(pramanDelta)) - ds[0]) <= 1)) return null;
  if (!(invoiceTotal > ds[0])) return null;
  const share = Math.round(((invoiceTotal - ds[0]) / invoiceTotal) * 1e6); // parts per million
  return (BigInt(amount) * BigInt(share)) / 1_000_000n;
}

/** Re-decide a recorded evidence round from the answers it stored, with these same rules, so anyone
 *  can check a decision without trusting Takar's runner. Rounds before 27 Nov carry no port record
 *  and are replayed AIS-only, as they were decided. `amount` is the deal's escrow in token units. */
export function replay(r, t, port, amount = 1_000_000n) {
  const at = Date.parse(r.at);
  const states = r.vessel.map((v) => (v.result ? berth(v.result, port, at, t.vessel).state : "unusable"));
  const ais = pair(states[0], states[1], "berthed", "away");
  const arrival = r.port ? arrivalWith(ais, r.port.state) : ais;
  const invoice = pair(r.invoice[0]?.result?.reconciled, r.invoice[1]?.result?.reconciled, true, false);
  const m = (r.sanctions?.screens ?? []).map((s) => s.matched);
  const takarClear = r.sanctions?.takar === "agree" && m.length >= 2 ? (m.every((x) => x === false) ? true : m.every((x) => x === true) ? false : null) : null;
  const p = r.sanctions?.praman ?? {};
  const pramanClear = typeof p.matched === "boolean" && p.sdn_last_loaded ? !p.matched : null;
  const sanctions = takarClear === true && pramanClear === true ? "pass" : takarClear === false && pramanClear === false ? "fail" : "review";
  const who = t.requireLei ? (r.identity?.state === "verified" ? "pass" : "review") : "pass";
  const late = arrival === "pass" && r.port ? lateBy(r.port.ata, t.deliverBy) : 0;
  const documents = t.signedDocs ? (r.documents?.state === "signed" ? "pass" : "review") : "pass";
  const countersign = r.countersign ? (r.countersign.state === "release" ? "pass" : "review") : "pass";
  let [decision] = decide({ arrival, invoice, sanctions, identity: who, documents, countersign, late }, t.port);
  let payout = decision === "pay" ? amount : decision === "refund" ? 0n : null;
  if (t.qty && arrival === "pass" && sanctions === "pass" && who === "pass" && documents === "pass" && countersign === "pass" && !late) {
    const pay = payable(amount, t.qty.billed * t.qty.unitPrice, r.invoice.map((x) => x.result?.discrepancy), r.reconcile?.details?.delta_total);
    if (pay !== null) [decision, payout] = ["partial", pay];
    else if (invoice === "pass" && r.reconcile?.reconciled === true) [decision, payout] = ["pay", amount];
    else [decision, payout] = ["review", null];
  }
  const lp = !t.qty && late && arrival === "pass" && invoice === "pass" && sanctions === "pass" && who === "pass" && documents === "pass" && countersign === "pass" ? latePayout(amount, late, t.latePenaltyPctPerDay, t.latePenaltyCapPct) : null;
  if (lp) [decision, payout] = ["partial", lp.payout];
  return { decision, payout: payout === null ? null : String(payout), checks: { arrival, invoice, sanctions } };
}

/** JSON with keys sorted at every level: the canonical form both Telegraph (signal hashes) and
 *  Countersign (memo digests) hash. */
export const canonJson = (o) => (Array.isArray(o) ? `[${o.map(canonJson).join(",")}]` : o && typeof o === "object" ? `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonJson(o[k])}`).join(",")}}` : JSON.stringify(o));

/** A Telegraph signal's hash is keccak256 of its payload in canonical JSON (the node reports
 *  verification {algorithm: keccak256, commitment: payload}). Recomputing it shows the stored
 *  request and answer are the ones the signal committed to. It does not prove who produced them:
 *  the node does not sign. */
export const signalHashOf = (payload) => ethers.keccak256(ethers.toUtf8Bytes(canonJson(payload)));

/** Late delivery with a penalty in the terms (TakarSettle5, split settlement): the supplier gets the
 *  amount less pctPerDay for each started day late, capped at capPct; the rest goes back to the buyer.
 *  Without a penalty in the terms a late delivery goes to the panel instead (decide()). */
export function latePayout(amount, lateHours, pctPerDay, capPct = 30) {
  if (!(lateHours > 0) || !(pctPerDay > 0)) return null;
  const days = Math.ceil(lateHours / 24);
  const cut = Math.min(capPct, days * pctPerDay);
  return { payout: (BigInt(amount) * BigInt(Math.round((100 - cut) * 100))) / 10_000n, days, cutPct: cut };
}
