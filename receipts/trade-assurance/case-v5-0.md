# Trade Assurance case: TakarSettle5 deal 0

Contract: https://sepolia.etherscan.io/address/0xa6d0482cbf29fe43fb644f33f7a020766af4a42b · state now: **settled** · escrow 1.00 test USDC

**Order:** PO-7790: 1,000 stainless fastener kits at USD 12.40, Tallinn -> Helsinki, paid on goods accepted at the buyer's warehouse  
**Supplier:** Harju Metal OÜ (illustrative supplier) · **Ship:** MEGASTAR → Helsinki West Harbour  
**Terms on chain:** Ship arrival is not delivery: the supplier is paid for the units the buyer's goods-received note accepts. Needs MEGASTAR berthed (two vessel miners), the shortfall agreed by two reconcile miners and Praman's three-way reconciliation, and the supplier clear. Test USDC, scaled 1:12,400.

_Illustrative order (the supplier is not a real company; test USDC scaled 1:12,400). The ship, the miners, every paid answer and every transaction are real, on Ethereum Sepolia._

## Steps

| When (UTC) | Step | Outcome | Tx |
|---|---|---|---|
| 2026-11-23 15:51 | open |  | [0x11181c0b…](https://sepolia.etherscan.io/tx/0x11181c0bd1f5044953ce4f6757794acef1d86c14fa9cf2d6884e1d15c77f70a2) |
| 2026-11-23 23:49 | propose | partial | [0xd1735789…](https://sepolia.etherscan.io/tx/0xd1735789ab2ef7b4ce90627da79e553197313648e1c6d8cc37386994afca907d) |
| 2026-11-23 23:49 | second |  | [0x42fcab41…](https://sepolia.etherscan.io/tx/0x42fcab41994559fdd0edc2816dbcb0fb52ef13f49854411768b9edf7cbbf7187) |
| 2026-11-23 23:50 | dispute | by supplier | [0xab6bec71…](https://sepolia.etherscan.io/tx/0xab6bec718d7d25b3e278c341add6f14d616a8ebcf7c06b3ca3564fdb328a406a) |
| 2026-11-23 23:50 | propose | partial | [0x33c0697f…](https://sepolia.etherscan.io/tx/0x33c0697f9688479b61e5a469a84d9b1dd87daed75411c61a73b9ff80c745ec85) |
| 2026-11-23 23:51 | second |  | [0x59eac205…](https://sepolia.etherscan.io/tx/0x59eac2055a075e3ea0190728b06002e3868da26b87981f12398b47a03f4ba82d) |
| 2026-11-23 23:51 | awaiting-independent |  |  |
| 2026-11-24 05:32 | independent-second | by 0x98021b20Efdb7ae2C57366010a6E0fDE207b4466 | [0x28d3ff9c…](https://sepolia.etherscan.io/tx/0x28d3ff9c941714af3f15ec1776dec0a218ba23f826359bea4636804035ea67de) |
| 2026-11-27 06:14 | finalize | supplier 0.96, buyer 0.04; bond 0.50 from the supplier to the buyer | [0x78876aca…](https://sepolia.etherscan.io/tx/0x78876aca83f2827a587d7dadafe1248fefa0839c3eb84b5aa9e39626f8d3a6c5) |

## Evidence rounds, re-decided

| When (UTC) | Recorded | Replayed | Arrival / Goods / Supplier | Port record | Identity | Signals |
|---|---|---|---|---|---|---|
| 2026-11-23 23:48 | partial (0.96) | partial ✓ | pass / review / pass | - | - | 6 (6 on the node) |
| 2026-11-23 23:50 | partial (0.96) | partial ✓ | pass / review / pass | - | - | 6 (6 on the node) |

Replay: every round re-decides to what was recorded. Re-run: `node scripts/case-file.mjs --signals`. Each signal: `https://devnode.telegraphprotocol.com/engine/v1/signal/<hash>`.
