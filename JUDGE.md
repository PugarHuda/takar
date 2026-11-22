# For reviewers

## In one page

**Takar: never act on one answer from Telegraph.** It is the verification layer that tells you when two "independent" miners are really one operator, writes who was right on chain, and lets money move only when that record agrees. Ethereum Sepolia, test USDC.

What it found by doing that: the node lists 2,189 active miners, but they pay out to 86 fee addresses, and one address alone holds 76% of them. EVENT_OUTCOME has 39 miners but only 7 operators. Two miners from different operators still disagreed on 34% of the outcome questions we compared (13 of 38; 95% interval 21–50%). See https://takar-telegraph.vercel.app/network.html.

Watch (3:12, narrated): https://takar-telegraph.vercel.app/media/takar-overview.mp4

| Proof | Try it in one step | What to look for |
|---|---|---|
| A second opinion for any intent, every call on EAS | `curl -X POST https://takar-telegraph.vercel.app/api/second-opinion -H 'content-type: application/json' -d '{"intent":"SANCTIONS_SCREENING_MATCH_GENERAL","params":{"name":"Bank Rossiya"},"fields":["matched"]}'` | `agree`, two miners of different operators, two Telegraph signals, an EAS `record`; then `/api/feed` counts it |
| Escrow that needs two resolvers and makes a wrong dispute cost | https://takar-telegraph.vercel.app/#settle-h | v3: the payer disputed a correct payment and its bond went to the supplier; v4 with a panel of three (threshold 2): after both parties disputed, all three resolvers had to sign, each after its own check (22 Nov, deal 0 on [0xA8EC…2e82](https://sepolia.etherscan.io/address/0xA8EC319EE7DA4cDA9B45723E167219B492E92e82)). Since 22 Nov 21:30 WIB the third seat belongs to another team: [0x3102…4248](https://sepolia.etherscan.io/address/0x310275e6D66818E068245326bB9e398822304248) has Praman Desk's address as resolver 3, chosen by them, and their runner seconds escalated disputes after its own OFAC screen (no Praman signature yet; we report one only when it lands). Contracts verified on Sourcify |
| Gold Rush dossiers for Telegraph's own Gold Rush | https://takar-telegraph.vercel.app/goldrush.html | Mount Morgan: 250 t vs 294 t explained by dump retreatment (offered, not applied); 24 leases past expiry yet "Granted"; an active native title claim the lease category does not show |
| Who really runs the miners, and how often they disagree | https://takar-telegraph.vercel.app/network.html (API `/api/network?view=operators|disagreement|signal`) | 2,189 miners on 86 fee addresses; disagreement rate per intent from our EAS feed; paste a signal hash and see it on the node, in our ledger, and inside an EAS-anchored Merkle root recomputed from the file |
| Known-answer test of the top outcome miners | `receipts/trap-2026-11-22.json`, `node --env-file=.env scripts/trap-run.mjs` | 6 settled markets put to the top-ranked miners and ours: 3 miners 6/6, one top-4 miner failed every ask ("Failed to get events endpoint"); results attested on the reputation schema |
| Evaluation material where a pool was one contributor short | `evaluator/data/game-result.jsonl`, `evaluator/data/sports-score.jsonl`, `node evaluator/sports-pairs.mjs`; pool status: `https://anjoman.ai/api/evalpool/status?intent_id=GAME_RESULT_GENERAL` | GAME_RESULT and SPORTS_SCORE each had 2 of the 3 contributors they need; 85 pairs to each (170 admitted, 0 refused) from games ESPN and openfootball agree on, each worse answer with one error visible from the question and answer alone; both pools now have 3. Also LOAN_INTEREST_RATE_QUOTE (2 of 3): 120 pairs from FRED rates (Freddie Mac PMMS, bank prime), 115 admitted (`evaluator/rate-pairs.mjs`) |
| Honest numbers | `receipts/scorecard-contested-2.json` | 37 contested markets, Brier 0.121 (0.076–0.176); our miner 15 right, 0 wrong |
| For miner operators | `GET /api/miner?id=takar-outcome` | per-epoch scores, silent zeros flagged, routing check from the node's request counter |
| Used by another team | `GET /api/reputation?intent=MINING_INTELLIGENCE_GENERAL&attester=0x98021b20Efdb7ae2C57366010a6E0fDE207b4466` | Praman Desk attested to our open schema with its own wallet ([EAS 0x33d85bed…](https://sepolia.easscan.org/attestation/view/0x33d85bed90eb3164c5124a7c26ca79be386003205265044d1425cea9b714e115)) and built its Gold Rush arbitrator on our dossier JSON; our dossiers call it back and it patched its scopes after our finding |
| What it costs | [docs/ECONOMICS.md](docs/ECONOMICS.md) | from our own ledger: a second opinion $0.017 (1.68 paid asks), a public dossier $0.03–0.04 in about 40 s, a deep one at most $0.17; a third opinion is bought only when two disagree, capped in code |
| The miner answers from data, not a model, where it can | [docs/RESOLVERS.md](docs/RESOLVERS.md) | one card per source: prices and Fed decisions from FRED (37/37 and 8/8 on unseen markets), dated games from ESPN (100/100 against openfootball), Wikipedia with a checked quote; every round, including the bad ones, in `receipts/` |

### How this differs from checking with several miners

Several Season II entries ask more than one miner. The difference is in what counts as independent, what is kept, and what the answer can move.

| | Majority vote over N miners | Takar |
|---|---|---|
| Independence | N miners, wherever they come from | Different fee addresses; a pair from one operator is one opinion, and an unknown operator is not counted |
| Disagreement | Outvoted | Reported field by field, never averaged; a third opinion only when asked and within a stated spend cap |
| Memory | None, or a private log | Every comparison on EAS, plus an open schema of who was right that other teams attest to (Praman has) |
| Money | Not involved | Escrow pays only when the evidence agrees; two resolvers, a bond on disputes, a panel of three on escalation |
| The provider side | Not tested | Our own miner answers from official series by code, measured on unseen markets, and known-answer tests of the top miners go on chain |

Offline: `npm ci && npm test` (494 checks; `npm run coverage`: 90.5% of lines, 79.2% of branches, 91.0% of functions in lib/, lowest in the network and payment layers telegraph.mjs and x402.mjs, which the paid ledger exercises instead), `cd onchain && forge test` (25). Everything below is detail.

---

Takar is entered in Telegraph Hackathon Season II, in all three tracks, from one repo. Everything runs on Ethereum Sepolia testnet with test USDC.

| Part | Track | Mission or Intent |
|---|---|---|
| Fleet | Apps & Agents | Mission 11, Autonomous Systems |
| Forecast scorecard | Apps & Agents | Mission 13, Asset Management |
| Country note priced per fact | Apps & Agents | Mission 05, Conflict Intelligence |
| Takar Settle, conditional escrow | Apps & Agents | Mission 14, Web3 & DeFi |
| Takar Settle, drought cover | Apps & Agents | Mission 06, Resources & Agriculture |
| Gold Rush dossiers (the lead use) | Apps & Agents | Mission 06, Resources & Agriculture (gold mines) |
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

1. `npm install && npm test` runs 364 offline checks: the payment signers (exact and escrow), the fleet, the outcome resolver, the scorecard, Settle and the Mission 05 note. `cd onchain && forge install foundry-rs/forge-std --no-git && forge test` runs the 25 contract tests. No network, no funds.
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
| Harder test | `npm run scorecard -- --contested --per-topic 8 --out receipts/scorecard-contested.json` skips, before paying, every market the crowd had already called. Signed result (`receipts/scorecard-contested-2.json`): 37 contested markets scored, Brier **0.121** (95% interval 0.076–0.176), skill 0.52 against a coin flip, against 0.248 for always forecasting the base rate. 15 rest on two miners. The same run grades our own miner after the meta-miner fix: Takar Outcome 15 right, 0 wrong, 23 unresolved (it was 1 right before). |
| Inspect | each row's `verification.attempts[].signal`. |
| Break | A miner that contradicts the market is reported, not scored. Two miners that disagree make the row `split`. No yes or no gives `unverified`. All three are tested in `lib/scorecard.test.mjs`. |

Our own miner is honest but narrow here. On Manifold's vaguer questions ("Will Google be in a winning position in the AI war?") Wikipedia settles nothing, so it answers `unresolved` and does not guess.

## Mission 05: a country note priced per fact

Two notes, framed the way the mission's build note asks: what can be proved about each claim and how firmly, with its cost and proof, never a verdict on a live event.
- India and Pakistan, April to June 2025 (`briefs/india-pakistan-2025.json`), for a desk with South Asia exposure.
- Israel and Iran, June 2025 (`briefs/israel-iran-2025.json`, added 22 Nov), for an oil and shipping desk: the planted false claim ("Iran closed the Strait of Hormuz"; its parliament backed a closure that never happened) came back **contradicted by all three checks**; the ceasefire and the Al Udeid strike were **confirmed**; the Israeli and US strikes, which Wikipedia documents, came back **disputed** because the FACT_CHECK miner (LiveCert, 4433) answered "False" against two outcome miners. The note keeps them out of the tally rather than overruling a source. $0.18 in test USDC, $0.06 per settled claim.

Each note is written as claims.
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

## Verified and watched

- All three settlement contracts (v2 `0xcb35…7187`, v3 `0xf977…502b`, v4 `0x2A61…2aBd`) are source-verified on Sourcify (exact match).
- `scripts/smoke.mjs` checks the live site's free endpoints every night (`.github/workflows/smoke.yml`); `.github/workflows/served.yml` snapshots the node's request counter every two hours.
- `scripts/anchor.mjs` puts the ledger's Merkle root and every dossier hash on EAS, every day from CI (`.github/workflows/anchor.yml`, a dedicated anchor wallet `0xf3ee…7bE5`); `--verify <count> <root>` recomputes a published root from the file.

## Mission 06: Gold Rush dossiers (gold mines are one of the mission's named buyers; built for Telegraph's Gold Rush app)

Ahmed asked the Gold Rush contributors for the verification side: show both figures, check whether they mean different periods, trace every finding to its record, and export a dossier. [goldrush.html](https://takar-telegraph.vercel.app/goldrush.html) does that from the two Gold Rush miners (goldrush-qld-history 7310050 and OathCast 64176), asked by id and paid through Telegraph.

| Check | What it found |
|---|---|
| Sum check | Mount Morgan: the survey's dated rows add up to its own site total (294.1 t). |
| Same-period conflict | Queensland Government 250 t vs survey 294 t for 1882–1990 (15% apart). Candidate explanation, offered and not applied: the survey includes 56 t from dump retreatment (1983–1990); without it, 238 t. |
| Different periods | Wikipedia's 262 t (to 1981) is "close" to 250 t, not "agree"; Brilliant Lode's 22,843 oz (Brilliant Deeps, 1908–1916) and 51,483 kg (site, to 1917) are different workings. |
| Size band | Each total against OathCast's live MINOCC band (Mount Morgan over 150 t, Brilliant Lode 50–150 t, Mount Leyshon 50–150 t): all inside. |
| Closures | Mount Morgan closed in 1927 (fire, not geological), 1981 (end of the ore body, one source) and 1990 (no reason quoted). A closure with no quoted reason becomes an open question, never "exhausted". |
| Receipts | Each structured figure is checked against the answer bought through Telegraph; the miner's rank sits next to the evidence. |

Eight mines so far, each as a page, PDF, Markdown and signed JSON. Also: **tenure today** from the Queensland register (Mount Morgan: 24 leases held by Heritage Minerals, all past their expiry date yet "Granted", which the dossier flags as a pending renewal, not free ground), native title category per authority, gold then and now in real terms (US CPI), and a warning when a name matched a small working in a crowded field (Ravenswood). Any mine: `GET /api/dossier?mine=…` (`&format=md` downloads). Tested on a site we had not looked at (Golden Plateau). Rules in `lib/dossier.mjs`, 21 offline checks; `npm run`-free: `node --env-file=.env scripts/dossier-run.mjs`.

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

TakarSettle4 (0x2A615f7D3E52e9Ee68AB8CaaE3385bcbACCB2aBd) adds escalation: once both parties have disputed, every resolver must back the decision. The first demo instance ran with threshold 1 to make the escalation visible; at threshold 1 resolver 2's own check is advisory, so `scripts/settle3.mjs` refuses to deploy below 2 without `--unsafe-single`.

**Panel of three, threshold 2 (22 Nov):** [TakarSettle4 0xA8EC319EE7DA4cDA9B45723E167219B492E92e82](https://sepolia.etherscan.io/address/0xA8EC319EE7DA4cDA9B45723E167219B492E92e82) with resolvers Takar agent, Takar server and a third key (`scripts/settle3.mjs --v4 --panel3`, `receipts/settlements4p.jsonl`). One deal (Siemens AG, a sanctions screen) went the whole way: resolver 1 proposed, resolver 2 checked both Telegraph signals and Praman's OFAC screen itself and seconded (2 of 3, window open); the payer disputed with a 0.5 bond; the resolvers decided again (2 of 3); the payee disputed too, so the contract required the **whole panel**: resolver 2 seconded, the window stayed shut at 2 of 3, and resolver 3 ran its own check and seconded (3 of 3); after the window the contract paid the supplier and the screens were attested on EAS. Same bytecode as the v4 above, so Sourcify already matches it. The three keys are all Takar's today; `--extra <address>` seats another team's key, which then signs on its own, and we have offered Praman that seat.

## Miner: Takar Outcome

- Endpoint: `POST https://takar-outcome.vercel.app/api/resolve {"event": "..."}`. Registration YAML: `miner/takar-outcome.yaml`. Node id 20261117.
- It uses four sources, in order:
  - **A settled Polymarket market.** An exact title match (ignoring a trailing "Resolution" or "Resolve this market"), or a dated fixture matched by slug, date and full event title. The market must be closed, with a final price of 0.99 or more.
  - **A published data series, for price and rate thresholds (since 22 Nov).** Bitcoin and Ether (Coinbase), S&P 500, WTI and Brent *spot*, US gasoline and US unemployment, from FRED, read by code with no model (`lib/numeric.mjs`). It does not take a deadline with no start date, a conditional, "again", a comparison with another series, oil without the word "spot" (futures can sit far from spot: Brent spot reached 138 in April 2026 while futures stayed under 100), or a window that was already past its threshold on day one. Within the series' margin of the threshold it answers `unresolved` (3% for crypto, 10% for "never crossed", since a daily close hides intraday wicks). FRED refuses data-centre IPs, so a GitHub Action copies FRED's own CSVs into `data/series/` daily and the miner reads that copy; an outage is answered `unresolved` with the reason.
    - Why: our own scorecard had left 23 of 38 contested questions unresolved, most of them prices. It now settles 15 of our 59 scorecard questions, all right.
    - Measured on resolved Manifold markets it was not tuned on (`scripts/numeric-holdout.mjs`, receipts in `receipts/numeric-holdout-*.json`). Every round is reported, including the bad one:

      | Round | Answered | Right | Wrong | Then fixed |
      |---|---|---|---|---|
      | Holdout 2 | 29 | 28 | 1 (a comparison with the Nasdaq) | comparisons not taken |
      | Holdout 3 | 57 | 50 | 7 (4 markets opened mid-window, 1 intraday crash, 1 "8000 BTC" read as a price, 1 more mid-window) | 10% miss margin, "$" needed, day-one rule |
      | **Holdout 4, final rules, never seen** | **37** | **37** | **0** | |

      Two holdout-3 questions are still answered against the market ("Bitcoin below $80K in 2025?": it closed at 76,252 on 7 April 2025; the market was opened later). The node's questions carry no creation date, so that ambiguity cannot be removed.
  - **ESPN's scoreboard, for dated games (since 22 Nov).** Football (top five leagues, UEFA, MLS), NBA, WNBA, NHL, NFL and MLB: win, avoid defeat, draw, spread and total, read by code (`lib/sports.mjs`). Exactly one game that day must name both teams; an unfinished game, a push, or a result after extra time or penalties is `unresolved`. Checked against openfootball, an independent source: 100 of 100 right (`receipts/sports-check.json`). Why: the node's recent EVENT_OUTCOME asks are mostly dated fixtures ("Did TSG Hoffenheim win the match against FSV Mainz 05 on 2024-12-01"), which Wikipedia prose does not settle; epochs 31 to 34 scored 0 while other miners scored 0.98.
  - **Wikipedia.** The prose plus the table rows that name the question's year or terms. Every yes or no carries a sentence or table row quoted word for word, checked in code; a quote may not run across two rows.
- Every answer states `confidence` (`high` for a settled market or a data series, `medium` for a checked quote, `none` for unresolved) and the `resolution_rule` it rests on.
- Network evidence: ranked #1 in epoch 16 at 0.9622, with every spot check passed. Epochs 18–28 scored 0: every graded ask came back `unresolved`. One cause was ours (the "Resolution" suffix, fixed 21 Nov). The other is asks that name no event at all, which no source can settle. Reported in [bounties#225](https://github.com/telegraphprotocol/bounties/issues/225), with data and without quoting graded material. After the fix, epoch 30 scored 0.9993 (rank #2). We do not pick epochs.
- Known gaps:
  - Titles that match several markets ("Bitcoin Up or Down - February 28" with no time).
  - Fixtures Polymarket never listed.
  - Vague questions.

  All are answered `unresolved` rather than guessed.

## Evaluator: Takar Outcome evaluator (rejected)

Details are in `evaluator/README.md`. Registration 156 was **rejected** on 20 Nov: on the node's 15 public pairs it ordered 7 correctly (46.7%, floor 70%). Our 99.8% was measured on 537 held-out pairs we generated (length baseline 50.8%, bag-of-words 62.2%), and it did not transfer to the network's material.

We did not capture or train on the node's pairs, and we did not seed the family's evaluation pool, because its hidden half grades adapters, ours included. It is kept as a documented negative result: the data, the training run and the rejection are all public. We do not claim it as a qualifying Evaluators entry.

## Seen on Anjoman

Anjoman's public Explore page lists every signal. On 22 Nov it showed our native asks to Takar Outcome the way another app would make them (`scripts/native-ask-example.mjs`): the first returned an error and cost $0.00 (our handler read GET parameters only from the query; fixed), the second succeeded for $0.01 with the Super Bowl LIX score in `data.scores` (signal 0xe8424c…ce080f). Screenshot: `media/anjoman-signal-feed.png`.

## What is not claimed

Real machines, production traffic or paying customers. The fleet is simulated, and every purchase is testnet. The scorecard is 28 markets, plus 37 contested ones; both samples are small and the intervals say so. Settle has one resolver (Takar) and no dispute bond: a dispute costs the disputer nothing but gas, and the contract cannot check on chain that a signal is Telegraph's. The Mission 05 note is one brief with eight claims. Our miner answers few of the scorecard's markets; the confirmations there come mostly from PREFLIGHT, and the board shows it.
