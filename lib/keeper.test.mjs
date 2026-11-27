// Offline checks for the finalize keeper (scripts/keeper.mjs): what counts as due, and the log row
// it writes from the contract's own events.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ethers } from "ethers";
import { due, settledRow } from "../scripts/keeper.mjs";

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// due(): state 1 = proposed; finalizesAt 0 = threshold not met yet.
ok(due({ state: 1n, finalizesAt: 100n }, 100), "due at the window's end");
ok(!due({ state: 1n, finalizesAt: 100n }, 99), "not before the window ends");
ok(!due({ state: 1n, finalizesAt: 0n }, 10_000), "not while approvals are short (Praman has not seconded)");
ok(!due({ state: 2n, finalizesAt: 100n }, 10_000), "not once settled");
ok(!due({ state: 0n, finalizesAt: 0n }, 10_000), "not while open (a HOLD round)");

const buyer = "0xC209DF51Df20dfF6d168C584EFD8B3e512441195", supplier = "0xF6c2CC14fF024225e0473c92B5c9F6336427108C";
const iface = (v) => new ethers.Interface(JSON.parse(readFileSync(new URL(`../onchain/TakarSettle${v}.artifact.json`, import.meta.url), "utf8")).abi);
const log = (i, name, args) => { const f = i.getEvent(name); const e = i.encodeEventLog(f, args); return { topics: e.topics, data: e.data }; };
const H = ethers.ZeroHash;

// v5 split with the supplier's bond lost, as case 2 settled on 27 Nov.
const i5 = iface(5);
const r5 = settledRow({ contract: "0xa6D0", id: 0, v: 5, d: { payer: buyer }, iface: i5, tx: "0x1",
  logs: [log(i5, "Settled", [0, 960000, 40000, H]), log(i5, "BondPaid", [0, buyer, 500000, false])] });
ok(r5.toSupplier === "960000" && r5.toBuyer === "40000", "v5: split read from Settled");
ok(r5.bond?.to === "buyer" && r5.bond.from === "supplier" && r5.bond.amount === "500000", "v5: the supplier's lost bond went to the buyer");

// v5 with the bond returned: no bond line on the page.
const r5b = settledRow({ contract: "0xa6D0", id: 0, v: 5, d: { payer: buyer }, iface: i5, tx: "0x1",
  logs: [log(i5, "Settled", [0, 960000, 40000, H]), log(i5, "BondPaid", [0, supplier, 500000, true])] });
ok(!r5b.bond, "a returned bond is not reported as lost");

// v4 pay and refund.
const i4 = iface(4);
const pay = settledRow({ contract: "0x3102", id: 1, v: 4, d: { payer: buyer }, iface: i4, tx: "0x2", logs: [log(i4, "Settled", [1, true, supplier, 1000000, H])] });
ok(pay.toSupplier === "1000000" && pay.toBuyer === "0", "v4: pay goes to the supplier");
const refund = settledRow({ contract: "0x3102", id: 2, v: 4, d: { payer: buyer }, iface: i4, tx: "0x3", logs: [log(i4, "Settled", [2, false, buyer, 1000000, H])] });
ok(refund.toSupplier === "0" && refund.toBuyer === "1000000", "v4: refund goes to the buyer");
ok(pay.by === "keeper", "rows say the keeper settled them");

console.log(`keeper: ${n} checks ok`);
{
  const { releasable } = await import("../scripts/keeper.mjs");
  let r = 0; const ok4 = (c, m) => { assert.ok(c, m); r++; };
  const d = { state: 0n, acceptWindow: 3600n, arrivedAt: 1000n, payerDisputed: false };
  ok4(releasable(d, 4600), "silent buyer, window over: release");
  ok4(!releasable(d, 4599), "window still open");
  ok4(!releasable({ ...d, payerDisputed: true }, 9999), "the buyer objected");
  ok4(!releasable({ ...d, arrivedAt: 0n }, 9999), "no arrival recorded");
  ok4(!releasable({ ...d, acceptWindow: 0n }, 9999), "no window in the terms");
  ok4(!releasable({ ...d, state: 2n }, 9999), "already settled");
  console.log(`keeper release: ${r} checks ok`);
}
{
  const { needsTopUp } = await import("../scripts/keeper.mjs");
  assert.ok(needsTopUp("0") && needsTopUp("1999999") && !needsTopUp("2000000") && needsTopUp(undefined), "top up under 2 test USDC");
  console.log("keeper top-up: 1 check ok");
}
