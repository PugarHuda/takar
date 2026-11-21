# For reviewers

Takar is entered in Telegraph Hackathon Season II, in all three tracks, from one repo. Everything runs on Ethereum Sepolia testnet with test USDC.

| Part | Track | Mission or Intent |
|---|---|---|
| Fleet | Apps & Agents | Mission 11, Autonomous Systems |
| Forecast scorecard | Apps & Agents | Mission 13, Asset Management |
| Country note priced per fact | Apps & Agents | Mission 05, Conflict Intelligence |
| Takar Settle, conditional escrow | Apps & Agents | Mission 14, Web3 & DeFi |
| Takar Settle, drought cover | Apps & Agents | Mission 06, Resources & Agriculture |
| Takar Outcome miner | Miners / Providers | EVENT_OUTCOME_RESOLUTION_GENERAL |
| Takar Outcome evaluator | Evaluators | EVENT_OUTCOME_RESOLUTION family (Hybrid). Rejected by the network; kept as a documented negative result |

Site: https://takar-telegraph.vercel.app. MCP: `npx -y takar-mcp`. CI: `.github/workflows/test.yml`.

## The second-opinion layer (what every app here runs on, and what other teams can use)

Every team on Telegraph ends up writing its own cross-check:
- Gold Rush's niche questions get routed to a general miner;
- Ballast's ERCOT question got NYISO answers;
- a top-ranked FX miner returned 1.0.

Takar offers that check once, for any intent and any app:

| Piece | Where | What it does |
|---|---|---|
| Second opinion | `POST https://takar-telegraph.vercel.app/api/second-opinion {intent, params}` | Asks two different miners, from different operators, directly by id, and compares their answers field by field (nested fields too; tolerance by what the field measures: prices 0.5%, temperatures 1°C, wind 10%): agree, disagree or insufficient, plus the numeric `spread`. An "unresolved" answer is an abstention and brings in the next miner. It never averages. |
| Open record of who was right | [EAS schema on Sepolia](https://sepolia.easscan.org/schema/view/0x351bc4ecf778660c8de0d42eb111e758469e1fe5ffc1b993899e399c9c056741), `GET /api/reputation?intent=` | Every check Takar bought is an attestation: miner, Telegraph signal, verdict against an independent truth. 74 so far. Anyone can attest with their own wallet [on easscan](https://sepolia.easscan.org/attestation/attestWithSchema/0x351bc4ecf778660c8de0d42eb111e758469e1fe5ffc1b993899e399c9c056741); paid asks are ordered only by trusted attesters. |
| Public record of every call | [feed schema](https://sepolia.easscan.org/schema/view/0xe0bad453487eee9668996b592e5cc85d5945dd5e07125f20feec4cf65b224513), `GET /api/feed` | Each second opinion is an EAS attestation as it happens: intent, both miners and signals, verdict, the fields that differed, the caller's self-declared `client`. Usage and disagreements are counted from the chain, not our logs. |
| For miner operators | `GET /api/miner?id=<id or slug>` (`&format=svg` for a README badge) | Why a miner scored what it scored: per-epoch scores and failure reasons, spot checks, status, its paid record, and a flag on every 0 that came with no reason (bounties#225). |
| Drop-in for agents (no limit if you pay) | `npx -y takar-mcp` with `TAKAR_PAYER_KEY` set runs the same rules locally on your own Telegraph escrow (takar-mcp 0.4.0). Otherwise [`openapi.json`](https://takar-telegraph.vercel.app/openapi.json), `npx -y takar-mcp` (tools `second_opinion`, `miner_reputation`, `miner_report`), and a [Minds Bazaar Skill](https://hellominds.ai) ("Takar Second Opinion") | An HTTP tool for Minds and any agent framework. |
| Meta-miner | Takar Outcome (20261117) | When its own sources cannot settle a past event, it answers only if two other miners agree. It never asks itself. |

Watch it (1:38): [takar-telegraph.vercel.app/videos.html](https://takar-telegraph.vercel.app/videos.html). Try it: the board's "A second opinion for any Telegraph intent" box, or

```
curl -X POST https://takar-telegraph.vercel.app/api/second-opinion -H 'content-type: application/json'   -d '{"intent":"EVENT_OUTCOME_RESOLUTION_GENERAL","params":{"event":"Did France win the 2022 FIFA World Cup?"}}'
```

## Check it in five minutes, with no wallet

1. `npm install && npm test` runs 278 offline checks: the payment signers (exact and escrow), the fleet, the outcome resolver, the scorecard, Settle and the Mission 05 note. `cd onchain && forge install foundry-rs/forge-std --no-git && forge test` runs the 11 contract tests. No network, no funds.
2. On the site, press **Verify the signature in this browser** under the scorecard. It checks the Ed25519 signature against the key pinned in the page, with WebCrypto.
3. On the site, use **Ask the outcome miner yourself**. It calls the miner's own endpoint, with no wallet.
4. Open `receipts/ledger.jsonl` and pick a line with `"status":"paid"`.
   - With a `settlementTx` (exact payment, before 20 Nov): open it on https://sepolia.etherscan.io.
   - With `"rail":"escrow"` (from 20 Nov): the ask is billed to the escrow balance at the next ledger root, with no per-ask transaction. See `https://devnode.telegraphprotocol.com/v1/ledger/account/0x39d2bae5eaeda9283535ddc98f1991c81ed5cd7e`.
5. Fetch `https://devnode.telegraphprotocol.com/engine/v1/signal/<signalHash>` for the same line. It shows what was asked and what the miner returned.

## With and without Telegraph's second opinion

Every app here buys **more than one** answer before it acts. The same runs, read with only the first answer, would have acted wrongly:

| App | With one answer | With the second check | Receipt |
|---|---|---|---|
| Settle, M06 | Bandung, 10–12 Nov, 30 mm trigger: Telegraph recorded 9 mm, so the cover **pays** | NASA POWER recorded 40.2 mm: the sources disagree, the cover **holds** | `receipts/settlements.jsonl`, deal 2 on v2 |
| Fleet, M11 | Makassar and Palangka Raya: PREFLIGHT says LOW risk (gusts 22.7 and 16.9 km/h), so the drones **fly** | No second usable STORM_ALERT miner exists for Indonesia (37004 answers with *space* weather, Tempest misses fields), so both **hold** | `receipts/decisions.jsonl`, run 2026-11-21T02:34 |
| Note, M05 | "Pakistan shot down Indian Rafale jets": FACT_CHECK says true, so it is **confirmed** | TxLens says no, so the claim is **disputed** and stays out of the escalation tally | `receipts/brief-india-pakistan-2025.json`, c4 |
| Scorecard, M13 | Asking only the routed miner: TxLens answered 15 of 28 markets and got 7 wrong | Asked of two miners and held against each market's own resolution, so the wrong answers are **contradicted** and left out of the score | `receipts/scorecard.json`, `summary.miners` |

## Mission 11: the fleet

| Step | How |
|---|---|
| Run | `npm run fund && npm run fleet` (about $0.10 of test USDC). Prints GO, HOLD or ABORT per unit, with receipts. |
| New input | Edit `fleet.json`: change a unit's `location`, `limits` or `budgetUsd`. |
| Check | `receipts/decisions.jsonl`: the purchases behind each decision, the answers it rejected (`unusableMiners`), the station reading and the reasons. |
| Inspect | the `ledger.jsonl` lines a decision's `receipts` name, then their signal. |
| Break | Set a rover's `budgetUsd` to `0.01`: it must HOLD, "budget exhausted". Set a drone's `maxGustKmh` below the station wind: it must HOLD. |

The rules, in order:
- **A drone needs two different STORM_ALERT miners that agree**: on whether the risk level can fly, and on which side of the gust limit they are. It acts on the worst of each field (highest risk, highest gust; a missing gust fails closed).
- **An answer about another place or country is unusable** (bounties#211), and the unit re-buys from the next-ranked miner.
- **The nearest METAR station must not contradict the answer.** With no station in range, an Open-Meteo model reading is used, labelled as a model. It can hold the unit but never confirms a GO.

## Mission 13: the forecast scorecard

For each resolved prediction market, Takar reads the crowd's probability 7 days before close from Manifold's public bet history. It then buys the outcome through Telegraph from **two miners**: Takar Outcome by id, and the ranked route. Each answer is held against the market's own resolution.

| Step | How |
|---|---|
| Run | `npm run fund && npm run scorecard` (up to three $0.01 asks per market plus one FACT_CHECK, from escrow). Writes the signed `receipts/scorecard.json`. |
| New input | `npm run scorecard -- --days 30 --per-topic 3 --out receipts/scorecard-30d.json`. Topics are `TOPICS` in `scripts/scorecard-run.mjs`. |
| Check | `summary`: 28 markets, 20 scored, 6 contradicted, 1 split, Brier 0.0085, Brier skill 0.966, log loss 0.064 (a coin flip scores 0.693), plus calibration bins. `summary.miners` grades the miners on the same receipts: PREFLIGHT 13 of 13 right, TxLens 8 right and 7 wrong, Takar Outcome 1 right and 27 `unresolved`. `summary.sample` says what that Brier is worth: 16 of the 20 were near-certain (under 10% or over 90%), so it mostly measures easy markets (bootstrap 95% interval 0.002–0.019; always forecasting the base rate would score 0.0475). |
| Harder test | `npm run scorecard -- --contested --per-topic 8 --out receipts/scorecard-contested.json` skips, before paying, every market the crowd had already called. Signed result: 15 contested markets, all confirmed, Brier **0.1148** (95% interval 0.054–0.195), skill 0.54 against a coin flip, against 0.249 for always forecasting the base rate. 3 of 15 rest on two miners. |
| Inspect | each row's `verification.attempts[].signal`. |
| Break | A miner that contradicts the market is reported, not scored. Two miners that disagree make the row `split`. No yes or no gives `unverified`. All three are tested in `lib/scorecard.test.mjs`. |

Our own miner is honest but narrow here. On Manifold's vaguer questions ("Will Google be in a winning position in the AI war?") Wikipedia settles nothing, so it answers `unresolved` and does not guess.

## Mission 05: a country note priced per fact

A risk desk's note on India and Pakistan, April to June 2025, is written as claims in `briefs/india-pakistan-2025.json`.
- **Observations** (a period that has ended) are bought from three checks: Takar Outcome by id, the ranked EVENT_OUTCOME route, and FACT_CHECK.
- **Forecasts** are listed and not bought.

The checks are never averaged:
- **confirmed** or **contradicted** needs two agreeing checks and none against;
- a lone answer is **single-source**;
- yes and no together is **disputed**;
- no yes or no is **unsupported**.

The escalation tally counts confirmed claims only.

| Step | How |
|---|---|
| Run | `npm run brief -- briefs/india-pakistan-2025.json` ($0.03 per observation). `--rescore` re-applies the rules to the checks already bought, with no new asks. |
| New input | write a brief JSON with your own claims (`id`, `kind`, `claim`, `question`) |
| Check | `receipts/brief-india-pakistan-2025.json` (signed). Result: 2 confirmed, 1 contradicted, 1 disputed, 1 single-source, 1 unsupported, 2 forecasts. $0.18 total. |
| Break | c6 is fabricated on purpose ("exchanged nuclear strikes"): contradicted by TxLens and FACT_CHECK. c4 is contested: disputed. |

## Gold Rush dossiers (for Telegraph's own Gold Rush app)

Ahmed asked the Gold Rush contributors for the verification side: show both figures, check whether they mean different periods, trace every finding to its record, and export a dossier. [goldrush.html](https://takar-telegraph.vercel.app/goldrush.html) does that from the two Gold Rush miners (goldrush-qld-history 7310050 and OathCast 64176), asked by id and paid through Telegraph.

| Check | What it found |
|---|---|
| Sum check | Mount Morgan: the survey's dated rows add up to its own site total (294.1 t). |
| Same-period conflict | Queensland Government 250 t vs survey 294 t for 1882–1990 (15% apart). Candidate explanation, offered and not applied: the survey includes 56 t from dump retreatment (1983–1990); without it, 238 t. |
| Different periods | Wikipedia's 262 t (to 1981) is "close" to 250 t, not "agree"; Brilliant Lode's 22,843 oz (Brilliant Deeps, 1908–1916) and 51,483 kg (site, to 1917) are different workings. |
| Size band | Each total against OathCast's live MINOCC band (Mount Morgan over 150 t, Brilliant Lode 50–150 t, Mount Leyshon 50–150 t): all inside. |
| Closures | Mount Morgan closed in 1927 (fire, not geological), 1981 (end of the ore body, one source) and 1990 (no reason quoted). A closure with no quoted reason becomes an open question, never "exhausted". |
| Receipts | Each structured figure is checked against the answer bought through Telegraph; the miner's rank sits next to the evidence. |

Any mine: `GET /api/dossier?mine=…` (`&format=md` downloads). Tested on a site we had not looked at (Golden Plateau). Rules in `lib/dossier.mjs`, 21 offline checks; `npm run`-free: `node --env-file=.env scripts/dossier-run.mjs`.

## Missions 14 and 06: Takar Settle v2

[`TakarSettle` v2](https://sepolia.etherscan.io/address/0xcb35d51094335141a986a429bA546b7955705187) runs on Sepolia at `0xcb35d51094335141a986a429bA546b7955705187`, with a 10-minute liveness. Source is in `onchain/src`, with 11 Foundry tests.

The dispute window follows the optimistic-oracle pattern (UMA):
1. The payer locks test USDC for a payee against a condition in `terms`.
2. After `resolveAfter`, Takar buys the answer through Telegraph and **proposes** pay or refund, with the signal hashes.
3. During liveness the payer and the payee may each **dispute** once. A dispute voids the proposal, and the same signal set cannot be proposed again.
4. After liveness, **anyone** finalizes.

| | Mission 14, conditional escrow | Mission 06, drought cover |
|---|---|---|
| Condition | a real-world event resolves yes | recorded rain over a period stays under a trigger |
| Bought | EVENT_OUTCOME from Takar Outcome by id plus the ranked route; **two miners must agree** (the contract refuses fewer than two distinct signals) | WEATHER_FORECAST_VERIFY per day; every day's signal goes on-chain |
| Second source | the second miner | **NASA POWER** (MERRA-2 reanalysis) must put the period on the same side of the trigger |
| Holds (never pays) when | miners disagree, fewer than two answer, or the event is unresolved | a day is missing, or the sources disagree |

| Step | How |
|---|---|
| Run | `npm run settle -- open-event --question "Did Argentina win the 2022 FIFA World Cup?" --after 1`, then `npm run settle -- run` (proposes), and `run` again after 10 minutes (finalizes). |
| Dispute | `npm run settle -- dispute --id <n> --as payee` during liveness. |
| Check | `receipts/settlements.jsonl`: every step (`propose`, `dispute`, `finalize`, `hold`) with its reasons, answers, signals and transaction. |
| Break | A future event stays open. A disputed proposal cannot come back with the same evidence. An early proposal, one with a single signal, a repeated signal or a dispute by a third party are all rejected (Foundry tests). |

Live on 21 Nov, every branch ran:

| Deal | What happened |
|---|---|
| 0, Argentina won 2022? | two miners agree yes → proposed → finalized, payee paid |
| 1, France won 2022? | two miners agree no → proposed → **disputed by the payee** → re-proposed with new signals → finalized, payer refunded |
| 2, Bandung 10–12 Nov, under 30 mm | Telegraph 9 mm, NASA POWER 40.2 mm → **held** |
| 3, Kupang 14–16 Nov, under 30 mm | Telegraph 13.1 mm, NASA POWER 4.3 mm, both under → proposed → finalized, payee paid |

v1 (`0xfB5E…2808`) settled five deals on 20 Nov on one answer, with no window; its rows are marked v1 on the board.

Trust, stated plainly: the resolver key is ours. What limits it is the quorum, the second source, the window in which either party can dispute, and that every step points at public Telegraph signals.

## Miner: Takar Outcome

- Endpoint: `POST https://takar-outcome.vercel.app/api/resolve {"event": "..."}`. Registration YAML: `miner/takar-outcome.yaml`. Node id 20261117.
- It uses two sources, in order:
  - **A settled Polymarket market.** An exact title match (ignoring a trailing "Resolution" or "Resolve this market"), or a dated fixture matched by slug, date and full event title. The market must be closed, with a final price of 0.99 or more.
  - **Wikipedia.** The prose plus the table rows that name the question's year or terms. Every yes or no carries a sentence or table row quoted word for word, checked in code; a quote may not run across two rows.
- Every answer states `confidence` (`high` for a settled market, `medium` for a checked quote, `none` for unresolved) and the `resolution_rule` it rests on.
- Network evidence: ranked #1 in epoch 16 at 0.9622, with every spot check passed. Epochs 18–28 scored 0: every graded ask came back `unresolved`. One cause was ours (the "Resolution" suffix, fixed 21 Nov). The other is asks that name no event at all, which no source can settle. Reported in [bounties#225](https://github.com/telegraphprotocol/bounties/issues/225), with data and without quoting graded material. After the fix, epoch 30 scored 0.9993 (rank #2). We do not pick epochs.
- Known gaps:
  - Titles that match several markets ("Bitcoin Up or Down - February 28" with no time).
  - Fixtures Polymarket never listed.
  - Vague questions.

  All are answered `unresolved` rather than guessed.

## Evaluator: Takar Outcome evaluator (rejected)

Details are in `evaluator/README.md`. Registration 156 was **rejected** on 20 Nov: on the node's 15 public pairs it ordered 7 correctly (46.7%, floor 70%). Our 99.8% was measured on 537 held-out pairs we generated (length baseline 50.8%, bag-of-words 62.2%), and it did not transfer to the network's material.

We did not capture or train on the node's pairs, and we did not seed the family's evaluation pool, because its hidden half grades adapters, ours included. It is kept as a documented negative result: the data, the training run and the rejection are all public. We do not claim it as a qualifying Evaluators entry.

## What is not claimed

Real machines, production traffic or paying customers. The fleet is simulated, and every purchase is testnet. The scorecard is 28 markets, plus 15 contested ones; both samples are small and the intervals say so. Settle has one resolver (Takar) and no dispute bond: a dispute costs the disputer nothing but gas, and the contract cannot check on chain that a signal is Telegraph's. The Mission 05 note is one brief with eight claims. Our miner answers few of the scorecard's markets; the confirmations there come mostly from PREFLIGHT, and the board shows it.
