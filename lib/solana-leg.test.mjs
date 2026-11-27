// Solana leg (scripts/solana-leg.mjs): it pays only what the Sepolia contract settled.
import assert from "node:assert/strict";
import { payoutFrom } from "../scripts/solana-leg.mjs";
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const split = payoutFrom({ state: "settled", amount: 1_000_000n, settled: { toSupplier: "960000", toBuyer: "40000", tx: "0x7887" } });
ok(split.toSupplier === 960_000n && split.toBuyer === 40_000n && split.sepoliaTx === "0x7887", "mirrors the 0.96 / 0.04 split");
ok(payoutFrom({ state: "open", amount: 1_000_000n, settled: null }) === null, "nothing moves while the deal is open");
ok(payoutFrom({ state: "proposed", amount: 1_000_000n, settled: null }) === null, "nor while a proposal waits for its window");
ok(payoutFrom({ state: "settled", amount: 1_000_000n, settled: null }) === null, "settled on chain but no logged row: wait for the record");
assert.throws(() => payoutFrom({ state: "settled", amount: 1_000_000n, settled: { toSupplier: "960000", toBuyer: "0", tx: "x" } }), /does not add up/); n++;
console.log(`solana leg: ${n} checks ok`);
