// Countersign adapter, offline, on the two memos Countersign published (saved in receipts/countersign/).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ethers } from "ethers";
import { verifyMemo, memoVerdict, COUNTERSIGN_AGENT } from "./countersign.mjs";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const load = (id) => JSON.parse(readFileSync(new URL(`../receipts/countersign/${id}.json`, import.meta.url), "utf8"));
const hold = load("commodities-2026-11-23-3435f1fa"), proceed = load("commodities-2026-11-24-8712c156");

ok(verifyMemo(hold).valid, "HOLD memo: digest recomputed and signature recovers Countersign's agent");
ok(verifyMemo(proceed).valid, "PROCEED-shipment memo: same");
ok(verifyMemo(hold).signer === COUNTERSIGN_AGENT, "the signer is the pinned agent");

const tampered = { ...hold, decision_label: "PROCEED" };
ok(!verifyMemo(tampered).digestOk, "a memo edited after signing fails the digest");
ok(memoVerdict(tampered, { po: "DEMO-PO-011W" }).state === "unusable", "an edited memo is unusable, never a release");

const forger = new ethers.Wallet("0x" + "44".repeat(32));
const { digest, signature, ...body } = { ...hold, agent: forger.address };
const canon = (o) => (Array.isArray(o) ? `[${o.map(canon).join(",")}]` : o && typeof o === "object" ? `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}` : JSON.stringify(o));
const d2 = ethers.keccak256(ethers.toUtf8Bytes(canon(body)));
const forged = { ...body, digest: d2, signature: forger.signMessageSync(ethers.getBytes(d2)) };
ok(verifyMemo(forged).digestOk && !verifyMemo(forged).signerOk, "a well-formed memo signed by someone else is not Countersign's");

const h = memoVerdict(hold, { po: "DEMO-PO-011W" });
ok(h.state === "hold" && /TGHU1234572/.test(h.why), "HOLD: the discharged container differs from the booked one");
ok(memoVerdict(proceed, { po: "DEMO-PO-011W" }).state === "hold", "overall HOLD even when the shipment checks proceed (originals, registry)");
ok(memoVerdict(proceed, { po: "DEMO-PO-011W" }).shipment === "PROCEED", "the shipment-level decision is kept for the page");
ok(memoVerdict(hold, { po: "PO-7781" }).state === "unusable", "a memo about another order cannot decide this deal");
console.log(`countersign: ${n} checks ok`);
