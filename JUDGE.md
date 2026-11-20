# For reviewers

Takar is entered in Telegraph Hackathon Season II, in all three tracks, from one repo. Everything runs on Ethereum Sepolia testnet with test USDC.

| Part | Track | Mission or Intent |
|---|---|---|
| Fleet | Apps & Agents | Mission 11, Autonomous Systems |
| Forecast scorecard | Apps & Agents | Mission 13, Asset Management |
| Takar Settle, conditional escrow | Apps & Agents | Mission 14, Web3 & DeFi |
| Takar Settle, drought cover | Apps & Agents | Mission 06, Resources & Agriculture |
| Takar Outcome miner | Miners / Providers | EVENT_OUTCOME_RESOLUTION_GENERAL |
| Takar Outcome evaluator | Evaluators | EVENT_OUTCOME_RESOLUTION family (Hybrid) |

Site: https://takar-telegraph.vercel.app. MCP: `npx -y takar-mcp`.

## Check it in five minutes, with no wallet

1. `npm install && npm test` runs 115 offline checks (plus 8 contract tests: `cd onchain && forge install foundry-rs/forge-std && forge test`) of the payment signers (exact and escrow), the fleet rules, the outcome resolver and the scorecard rules. No network, no funds.
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

## Missions 14 and 06: Takar Settle

One contract, `TakarSettle`, on Sepolia at [`0xfB5E39924F287d14a1833C58e50f466145e62808`](https://sepolia.etherscan.io/address/0xfB5E39924F287d14a1833C58e50f466145e62808). Source in `onchain/src`, with 8 Foundry tests in `onchain/test`.

How a deal works:
1. A payer locks test USDC for a payee against a condition written in the deal's `terms`.
2. After `resolveAfter`, Takar's agent buys the answer through Telegraph.
3. It pays the payee if the condition was met and refunds the payer if not. The settlement records the Telegraph signal hash.

The resolver cannot pay anyone else, cannot settle early or twice, and cannot settle without evidence. If it never settles, the payer reclaims after 7 days.

| | Mission 14, conditional escrow | Mission 06, drought cover |
|---|---|---|
| Condition | a real-world event resolves yes | recorded rain over a period stays under a trigger |
| Bought | EVENT_OUTCOME_RESOLUTION, once | WEATHER_FORECAST_VERIFY, once per day of the period |
| Waits (never pays) when | the outcome is unresolved or unreadable | any day has no readable record |

| Step | How |
|---|---|
| Run | `npm run settle -- open-event --question "Did Argentina win the 2022 FIFA World Cup?" --after 1`, then `npm run settle -- run` a minute later. For M06: `npm run settle -- open-drought --location Kupang --from 2026-11-15 --to 2026-11-17 --trigger 30 --after 1`. |
| New input | any question, or any place, period and trigger |
| Check | `receipts/settlements.jsonl`: per deal the terms, the decision and why, the daily readings (M06), the signal and the settlement transaction |
| Inspect | the `Settled` event on Etherscan carries the signal hash. Open `https://devnode.telegraphprotocol.com/engine/v1/signal/<signal>` to see what was asked and answered. |
| Break | Open a deal on a future event: `run` leaves it open ("cannot settle it yet") because the answer is unresolved. A drought cover on a period that includes a future day waits the same way. The contract rejects an early settle, a second settle and a settle without evidence (Foundry tests). |

Live on 20 Nov, every branch ran:

| Deal | Result |
|---|---|
| 0, Argentina won 2022? | paid the payee |
| 1, France won 2022? | refunded the payer |
| 2, Bandung under 30 mm | paid the payee (13.8 mm) |
| 3, Kupang under 30 mm | paid the payee (16.4 mm) |
| 4, Bandung under 10 mm | refunded the payer (13.8 mm) |

Trust, stated plainly: one resolver key decides, and it is ours. What keeps it honest is that every decision is public and points at a Telegraph signal anyone can read.

## Miner: Takar Outcome

- Endpoint: `POST https://takar-outcome.vercel.app/api/resolve {"event": "..."}`. Registration YAML: `miner/takar-outcome.yaml`.
- Two sources, in order. **First, a settled Polymarket market:** an exact title match, or a dated fixture matched by slug, date and full event title. The market must be closed, with one outcome's final price at 0.99 or more. **Then Wikipedia:** every yes or no carries a sentence quoted word for word from the cited article, and the code checks it is really there. Events that have not ended, or that neither source settles, come back `unresolved`. A slow model also ends as `unresolved` within a 12 s budget, never as an error.
- Why Polymarket: the per-ask log (`api/resolve.js`) showed the network asks prediction-market titles and fixtures ("Bitcoin Up or Down - February 28", "Did the … Heidenheim vs Mainz match end in a draw?"), which Wikipedia cannot settle.
- Network evidence: ranked #1 in epoch 16 at 0.9622, and every spot check that epoch passed (`https://anjoman.ai/api/explorer/spot-checks?miner=takar-outcome`). Scores in later epochs are on the leaderboard as they are; we do not pick epochs.
- Known gaps: facts that exist only in Wikipedia tables, truncated market titles that match several markets ("Bitcoin Up or Down - February 28" without a time), and fixtures Polymarket never listed. All three are answered `unresolved` rather than guessed.

## Evaluator: Takar Outcome evaluator

Details in `evaluator/README.md`. Package `evaluator/EVENT_OUTCOME_RESOLUTION.safetensors`, keccak256 `0x69630036…ffd479a26` (v2.1: the v2 weights, re-hashed with an `x-takar-build` metadata key so the runnable URL could move), registration 153 on the ledger Diamond `0x72a7…`. Also at https://huggingface.co/PugarHuda/takar-outcome-evaluator.

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
