# Trade Assurance case: TakarSettle6 deal 0

Contract: https://sepolia.etherscan.io/address/0x789844606ca3c8693e2cebf2e1b065314f1e8013 · state now: **open** · escrow 1.00 test USDC

**Order:** PO-7781: 1,000 stainless fasteners kits at USD 12.40, Tallinn -> Helsinki, delivered (DAP Helsinki West Harbour)  
**Supplier:** Harju Metal OÜ (illustrative supplier) · **Ship:** MEGASTAR → Helsinki West Harbour  
**Terms on chain:** Pays the supplier when MEGASTAR is berthed at Helsinki West Harbour (two vessel miners on different operators), the invoice reconciles with the PO and goods-received note (two reconcile miners), and the supplier screens clear (two screening miners + Praman). Disagreement = review, not payment. Test USDC, scaled 1:12,400. After arrival is recorded the buyer has 30 minutes to confirm or object; silence releases the payment (automatic confirmation).

_Illustrative order (the supplier is not a real company; test USDC scaled 1:12,400). The ship, the miners, every paid answer and every transaction are real, on Ethereum Sepolia._

## Steps

| When (UTC) | Step | Outcome | Tx |
|---|---|---|---|
| 2026-11-27 08:23 | open |  | [0x631fbc4d…](https://sepolia.etherscan.io/tx/0x631fbc4d02aca37edceb4f9a910d94ec6cf4d8b6e2cb7982899fed50146a46d0) |

## Evidence rounds, re-decided

| When (UTC) | Recorded | Replayed | Arrival / Goods / Supplier | Port record | Identity | Signals |
|---|---|---|---|---|---|---|

Replay: every round re-decides to what was recorded. Re-run: `node scripts/case-file.mjs --signals`. Each signal: `https://devnode.telegraphprotocol.com/engine/v1/signal/<hash>`.
