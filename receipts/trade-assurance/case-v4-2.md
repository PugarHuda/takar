# Trade Assurance case: TakarSettle4 deal 2

Contract: https://sepolia.etherscan.io/address/0x310275e6d66818e068245326bb9e398822304248 · state now: **open** · escrow 1.00 test USDC

**Order:** PO-7781: 1,000 stainless fasteners kits at USD 12.40, Tallinn -> Helsinki, delivered (DAP Helsinki West Harbour)  
**Supplier:** Harju Metal OÜ (illustrative supplier) · **Ship:** MEGASTAR → Helsinki West Harbour  
**Terms on chain:** Pays the supplier when MEGASTAR is berthed at Helsinki West Harbour (two vessel miners on different operators), the invoice reconciles with the PO and goods-received note (two reconcile miners), and the supplier screens clear (two screening miners + Praman). Disagreement = review, not payment. Test USDC, scaled 1:12,400.

_Illustrative order (the supplier is not a real company; test USDC scaled 1:12,400). The ship, the miners, every paid answer and every transaction are real, on Ethereum Sepolia._

## Steps

| When (UTC) | Step | Outcome | Tx |
|---|---|---|---|
| 2026-11-27 06:53 | open |  | [0x3cdc2a17…](https://sepolia.etherscan.io/tx/0x3cdc2a1745b533e4c8b6dc72c5669c7d33524f978a2ba2803a84e8d1794aceda) |
| 2026-11-27 06:54 | review |  |  |
| 2026-11-27 06:54 | review |  |  |
| 2026-11-27 06:55 | hold |  |  |
| 2026-11-27 07:31 | review |  |  |

## Evidence rounds, re-decided

| When (UTC) | Recorded | Replayed | Arrival / Goods / Supplier | Port record | Identity | Signals |
|---|---|---|---|---|---|---|
| 2026-11-27 06:54 | review | review ✓ | fail / review / pass | - | - | 5 (5 on the node) |
| 2026-11-27 06:54 | review | review ✓ | fail / review / pass | - | - | 6 (6 on the node) |
| 2026-11-27 06:55 | hold | hold ✓ | fail / pass / pass | - | - | 6 (6 on the node) |
| 2026-11-27 07:31 | review | review ✓ | fail / review / pass | away | unverified | 7 (7 on the node) |

Replay: every round re-decides to what was recorded. Re-run: `node scripts/case-file.mjs --signals`. Each signal: `https://devnode.telegraphprotocol.com/engine/v1/signal/<hash>`.
