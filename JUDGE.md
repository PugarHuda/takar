# For reviewers

Takar is entered in Telegraph Hackathon Season II, in all three tracks, from one repo. Everything runs on Ethereum Sepolia testnet with test USDC.

| Part | Track | Mission or Intent |
|---|---|---|
| Fleet | Apps & Agents | Mission 11, Autonomous Systems |
| Forecast scorecard | Apps & Agents | Mission 13, Asset Management |
| Takar Outcome miner | Miners / Providers | EVENT_OUTCOME_RESOLUTION_GENERAL |
| Takar Outcome evaluator | Evaluators | EVENT_OUTCOME_RESOLUTION family (Hybrid) |

Site: https://takar-telegraph.vercel.app. MCP: `npx -y takar-mcp`.

## Check it in five minutes, with no wallet

1. `npm install && npm test` runs 99 offline checks of the payment signers (exact and escrow), the fleet rules, the outcome resolver and the scorecard rules. No network, no funds.
2. Open `receipts/ledger.jsonl` and pick a line with `"status":"paid"`.
   - With a `settlementTx` (exact payment before 20 Nov): open it on https://sepolia.etherscan.io and see the 0.01 USDC transfer.
   - With `"rail":"escrow"` (from 20 Nov): the ask is billed to the escrow balance at the next ledger root, and there is no per-ask transaction. See `https://devnode.telegraphprotocol.com/v1/ledger/account/0x39d2bae5eaeda9283535ddc98f1991c81ed5cd7e`.
3. Fetch `https://devnode.telegraphprotocol.com/engine/v1/signal/<signalHash>` for the same line. It shows exactly what was asked and what the miner returned.
4. `npx -y takar-mcp` and call `forecast_scorecard`. It checks the scorecard's Ed25519 signature against the pinned key and reports `verified`.

## Mission 11: the fleet

| Step | How |
|---|---|
| Run | `npm run fund && npm run fleet` (about $0.05–0.09 of test USDC). Prints GO, HOLD or ABORT per unit, with receipts. |
| New input | Edit `fleet.json`: change a unit's `location`, `limits` or `budgetUsd`. |
| Check | `receipts/decisions.jsonl`: the purchases each decision used, any answer it rejected (`unusableMiners`), the METAR station reading and the reasons. |
| Inspect | the `ledger.jsonl` lines named in a decision's `receipts`, then their signal or transaction (above). |
| Break | Set a rover's `budgetUsd` to `0.01`: it needs two purchases, so it must HOLD with "budget exhausted". Set a drone's `maxGustKmh` below the station wind: it must HOLD and say why. Pick a place with no airport nearby: the decision is marked unconfirmed. |

## Mission 13: the forecast scorecard

For each resolved prediction market, Takar reads the crowd's probability N days before close from Manifold's public bet history. It then buys the outcome through Telegraph (EVENT_OUTCOME_RESOLUTION_GENERAL) and checks it against the market's own resolution. Only outcomes that Telegraph confirmed are scored.

| Step | How |
|---|---|
| Run | `npm run fund && npm run scorecard` (at most two $0.01 asks per market, paid from escrow). Writes the signed `receipts/scorecard.json`. |
| New input | `npm run scorecard -- --days 30 --per-topic 3` scores the crowd 30 days out over more markets. Topics are the `TOPICS` list in `scripts/scorecard-run.mjs`. |
| Check | `receipts/scorecard.json`: per market, the crowd price and its bet id, the resolution, what Telegraph said and the Brier score. Latest run: 13 of 13 confirmed, Brier 0.015, with 0.25 as the coin-flip baseline. Second check: FACT_CHECK agreed on 5, disagreed on 2 and could not settle 6. This is reported beside the score and never changes it. |
| Inspect | each row's `verification.attempts[].signal`, then the signal URL above. |
| Break | An outcome that Telegraph contradicts is reported and left out of the score. One it cannot settle is listed as `unverified`, never dropped. `lib/scorecard.test.mjs` covers both. Live: run with an empty escrow and every ask is refused and nothing is charged, so every row comes out `unverified` with a `null` Brier score. |

## Miner: Takar Outcome

- Endpoint: `POST https://takar-outcome.vercel.app/api/resolve {"event": "..."}`. Registration YAML: `miner/takar-outcome.yaml`.
- Every yes or no carries a sentence quoted word for word from the cited Wikipedia article, and the code checks it is really there. Events that have not ended, or that the sources do not settle, come back `unresolved`.
- Network evidence: ranked #1 in epoch 16 at 0.9622, and every spot check that epoch passed (`https://anjoman.ai/api/explorer/spot-checks?miner=takar-outcome`). Scores in later epochs are on the leaderboard as they are; we do not pick epochs.
- Known gap: facts that exist only in Wikipedia tables never reach the text the resolver reads, so it answers `unresolved` for them.

## Evaluator: Takar Outcome evaluator

Details in `evaluator/README.md`. Package `evaluator/EVENT_OUTCOME_RESOLUTION.safetensors`, keccak256 `0xfeac3f31…0eedd3e`, registration 153 on the ledger Diamond `0x72a7…`. Also at https://huggingface.co/PugarHuda/takar-outcome-evaluator.

**Baseline comparison** (same 537 held-out pairs):

| Method | Pairwise accuracy |
|---|---|
| Pick the longer answer | 50.8% |
| Bag-of-words probe, prompt hidden (the kit's dataset gate) | 62.2% |
| This adapter | 99.8% (PyTorch), and 40 of 40 sampled on the real WASM engine |

On real answers from the network, every off-topic payload ranks below an on-topic answer (`evaluator/real-check.py`). Before the network tightened its own scoring, those payloads scored about 0.99.

**What it does not cover:** the family is Hybrid, scored by comparator + adapter. This is the adapter half only; we did not build a comparator. Activation is pending the network's remote check, so no canonical status or ranking change is claimed. We chose not to upload our own pairs to this family's evaluation pool, because that pool's hidden half grades adapters, ours included.

## What is not claimed

Real machines, production traffic or paying customers. The fleet is simulated. Every purchase is testnet. The scorecard is 13 markets, and every EVENT_OUTCOME confirmation came from a single miner (the FACT_CHECK second opinion came from another).
