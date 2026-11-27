# Trade Assurance case: TakarSettle4 deal 1

Contract: https://sepolia.etherscan.io/address/0x310275e6d66818e068245326bb9e398822304248 · state now: **settled** · escrow 1.00 test USDC

**Order:** PO-7781: 1,000 stainless fasteners kits at USD 12.40, Tallinn -> Helsinki, delivered (DAP Helsinki West Harbour)  
**Supplier:** Harju Metal OÜ (illustrative supplier) · **Ship:** MEGASTAR → Helsinki West Harbour  
**Terms on chain:** Pays the supplier when MEGASTAR is berthed at Helsinki West Harbour (two vessel miners on different operators), the invoice reconciles with the PO and goods-received note (two reconcile miners), and the supplier screens clear (two screening miners + Praman). Disagreement = review, not payment. Test USDC, scaled 1:12,400.

_Illustrative order (the supplier is not a real company; test USDC scaled 1:12,400). The ship, the miners, every paid answer and every transaction are real, on Ethereum Sepolia._

## Steps

| When (UTC) | Step | Outcome | Tx |
|---|---|---|---|
| 2026-11-23 15:20 | open |  | [0x693e2f43…](https://sepolia.etherscan.io/tx/0x693e2f438aee9113a3d7588ae8d3f2e5093b9d46d95ade04d43092e5448e8f18) |
| 2026-11-23 15:21 | review |  |  |
| 2026-11-23 16:07 | review |  |  |
| 2026-11-23 23:46 | review |  |  |
| 2026-11-23 23:46 | review |  |  |
| 2026-11-23 23:51 | review |  |  |
| 2026-11-23 23:51 | panel-propose | pay | [0xaf7c880a…](https://sepolia.etherscan.io/tx/0xaf7c880af3c1415198522b0f001a8d9fb525aba0a0b9d14c1c3941f211a981b8) |
| 2026-11-23 23:51 | awaiting-independent |  |  |
| 2026-11-24 05:32 | independent-second | by 0x98021b20Efdb7ae2C57366010a6E0fDE207b4466 | [0x976d78bb…](https://sepolia.etherscan.io/tx/0x976d78bb84e2f9ff131ae137646f3faa2640a81b7b77c7829feb222f1eb27f13) |
| 2026-11-27 06:13 | finalize | supplier 1.00, buyer 0.00 | [0x82aa3076…](https://sepolia.etherscan.io/tx/0x82aa307640a7f0d7e1f7bd64aec1771332e3cfea0cf03a7f0a958fb1b9e3dd32) |

## Evidence rounds, re-decided

| When (UTC) | Recorded | Replayed | Arrival / Goods / Supplier | Port record | Identity | Signals |
|---|---|---|---|---|---|---|
| 2026-11-23 15:21 | review | review ✓ | fail / review / pass | - | - | 6 (6 on the node, 6 hash recomputed) |
| 2026-11-23 16:07 | review | review ✓ | fail / review / pass | - | - | 6 (6 on the node, 6 hash recomputed) |
| 2026-11-23 23:46 | review | review ✓ | pass / review / pass | - | - | 6 (6 on the node, 6 hash recomputed) |
| 2026-11-23 23:46 | review | review ✓ | pass / review / pass | - | - | 6 (6 on the node, 6 hash recomputed) |
| 2026-11-23 23:51 | review | review ✓ | pass / review / pass | - | - | 6 (6 on the node, 6 hash recomputed) |

Replay: every round re-decides to what was recorded. Re-run: `node scripts/case-file.mjs --signals`. Each signal: `https://devnode.telegraphprotocol.com/engine/v1/signal/<hash>`.
