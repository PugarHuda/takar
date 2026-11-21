# Takar

**Machines with a budget line.** Every unit in a fleet has an intelligence budget. Before it acts, it buys the checks its task needs through [Telegraph](https://telegraphprotocol.com)'s ranked market, holds each answer against an independent instrument reading, and decides **GO / HOLD / ABORT**. Every input carries an on-chain receipt.

*Takar* is Indonesian for "to measure out": how much intelligence a machine buys, and how far that intelligence can be trusted.

**Board (no wallet needed):** https://takar-telegraph.vercel.app

Built for Telegraph Hackathon Season II, which pays cash prizes. One repo covers all three tracks:

| Part | Track | Where |
|---|---|---|
| Fleet | Apps, **Mission 11** Autonomous Systems | this page, `lib/fleet.mjs` |
| Forecast scorecard | Apps, **Mission 13** Asset Management | `lib/scorecard.mjs`, `receipts/scorecard.json` |
| Country note priced per fact | Apps, **Mission 05** Conflict Intelligence | `lib/brief.mjs`, `briefs/`, `receipts/brief-*.json` |
| Takar Settle v2, conditional escrow and drought cover (two-miner quorum, NASA POWER check, dispute window) | Apps, **Missions 14** Web3 & DeFi and **06** Resources & Agriculture | `onchain/`, `scripts/settle.mjs` |
| Takar Outcome miner | Miners, EVENT_OUTCOME_RESOLUTION_GENERAL | `api/resolve.js`, `lib/outcome.mjs` |
| Takar Outcome evaluator (rejected by the network, kept as a negative result) | Evaluators, EVENT_OUTCOME_RESOLUTION | [`evaluator/`](evaluator/README.md) |
| takar-mcp | MCP, three tools with no key or wallet | [`mcp/`](mcp/README.md), `npx -y takar-mcp` |

Reviewers: start at [JUDGE.md](JUDGE.md), which opens with what each app does **with and without** a second opinion.

[![test](https://github.com/PugarHuda/takar/actions/workflows/test.yml/badge.svg)](https://github.com/PugarHuda/takar/actions/workflows/test.yml)

> **Network:** Ethereum Sepolia testnet with test USDC. The fleet in `fleet.json` is **simulated**: the units, tasks and limits are illustrative. Every Telegraph purchase, settlement and airport-station reading in this repository is real.

## For other teams (free, testnet)

| Use | How |
|---|---|
| Second opinion on any intent | `POST /api/second-opinion {intent, params, client?}`, the Minds Bazaar Skill "Takar Second Opinion", or `npx -y takar-mcp` (set `TAKAR_PAYER_KEY` to pay from your own escrow, no limit). Every call is an EAS attestation: `GET /api/feed`. |
| Which miner to trust | `GET /api/reputation?intent=`; add your own evidence [on easscan](https://sepolia.easscan.org/attestation/attestWithSchema/0x351bc4ecf778660c8de0d42eb111e758469e1fe5ffc1b993899e399c9c056741). |
| Why did my miner score that | `GET /api/miner?id=` (`&format=svg` for a README badge). |
| Gold Rush dossier for a Queensland mine | [goldrush.html](https://takar-telegraph.vercel.app/goldrush.html), `GET /api/dossier?mine=`. |
| Escrow that needs two resolvers and a dispute bond | [TakarSettle v3](https://sepolia.etherscan.io/address/0xf977660CD28704Fa97D8f6B72835646F62E2502b), `scripts/settle3.mjs`. |

## What it does

```
unit task ──► plan: which intents this task needs
          ──► buy each through POST /engine/v1/ask ($0.01 via escrow or x402, receipt)
          ──► unusable answer? re-buy from the next-ranked miner (within budget), record who failed
          ──► hold it against the nearest airport station (METAR)
          ──► GO / HOLD / ABORT  +  cost of intelligence per operating hour
```

| Unit type | Buys | Decides on |
|---|---|---|
| `drone` | `STORM_ALERT_GENERAL` from **two different miners** | both must agree on flyability and the gust limit; then a live station-wind check (or a labelled model reading where no station is in range, which can only hold) |
| `field-robot` | `WEATHER_FORECAST_GENERAL` + `WEATHER_FORECAST_VERIFY_GENERAL` (yesterday) | rain probability over the work window, and yesterday's recorded rain |
| `rover` | `ROUTE_ETA_GENERAL` + `STORM_ALERT_GENERAL` at the destination | route time within the shift, storm risk on arrival |

**The rules fail closed.** None of these can produce a GO:
- an unreadable answer
- an exhausted budget
- a station that measures more wind than the limit

When a station contradicts a miner, the contradiction is recorded next to the decision.

## Run it

Requires Node 20+.

```bash
npm install
cp .env.example .env              # put a TESTNET key in AGENT_PRIVATE_KEY
npm run status                    # balances, sends nothing
npm run fund                      # mint test USDC, swap a little to MACHINA, fund escrow (testnet only)
npm test                          # 278 offline checks
npm run fleet                     # one fleet tick, about $0.10 of test USDC
npm run scorecard                 # Mission 13, signed scorecard (two miners per market)
npm run brief -- briefs/india-pakistan-2025.json   # Mission 05, a note priced per fact
npm run settle -- run             # Missions 14 / 06: propose, then finalize after the dispute window
npm run first-ask -- Makassar 2026-11-15   # one paid recorded-weather ask vs METAR
```

Spending limits are enforced in code, not trusted to the server:
- The signer refuses any 402 challenge over $0.10.
- It refuses any token other than the test USDC.
- It refuses any chain other than Ethereum Sepolia.
- Each unit has its own `budgetUsd`.

## Evidence

- **Purchases:** `receipts/ledger.jsonl` records every purchase, including failures and refusals. Each line carries the intent, params, miner, signal hash, settlement tx and the shaped result. Check any line with:
  - `https://sepolia.etherscan.io/tx/<settlementTx>`
  - `GET https://devnode.telegraphprotocol.com/engine/v1/signal/<signalHash>`
- **Decisions:** `receipts/decisions.jsonl` records every fleet decision, with its reasons, the station reading, and the cost per operating hour.

## What the receipts found (17 Nov 2026)

- **The #1-ranked `STORM_ALERT` miner ignores the location.** Routed asks for Makassar, Palangka Raya and Bandung all came back with Tropical Cyclone AKVAN-26 in India. Once, the node shaped that answer into `peak_gust_kmh: 296` for Bandung. Reported with receipts: [telegraphprotocol/bounties#211](https://github.com/telegraphprotocol/bounties/issues/211).
- **One storm answer was charged but empty.** The next-ranked miner answered Palangka Raya with every field null.
- **Station data disagreed with a recorded-weather answer.** For Makassar on 15 Nov, a miner reported a 31.9 °C high. The Hasanuddin airport station (METAR WAAA, 49 reports) recorded 34 °C.
- **Two independent sources agreed and the drone flew.** For the Makassar drone, the miner's storm answer forecast a 22.3 km/h gust and the WAAA station measured 17 km/h.

## Takar Outcome: a miner that refuses to guess

Takar Outcome is a Telegraph miner for `EVENT_OUTCOME_RESOLUTION_GENERAL` (registration 5295, slug `takar-outcome`). It answers "did X happen / who won X" from Wikipedia text.

A model proposes the answer, and code decides whether that answer stands:
- The evidence must be a sentence copied word for word from a single cited page.
- That quote, together with the page's title, must name the asked event.
- For "who won" questions, the winner must appear inside the quote.
- An event whose period has not ended yet is "unresolved" before any model is called.

```bash
curl -s -X POST https://takar-outcome.vercel.app/api/resolve -H 'Content-Type: application/json' \
  -d '{"event":"Did Real Madrid win the 2024-25 UEFA Champions League?"}'
# {"outcome":"no","resolved_yes":false,"winner":"Paris Saint-Germain","evidence":"Luis Enrique's Paris Saint-Germain defeated ...","sources":[...]}
```

On eight questions the network itself asked on 16 Nov, it returned:
- seven verified answers, all correct: Verstappen won the 2025 Japanese GP, the Seahawks won Super Bowl LX, Mamdani won the NYC mayoral election, Real Madrid did not win the 2024-25 Champions League, Sinner won Wimbledon 2025, Bayern won the 2024-25 Bundesliga, and Trump won the 2024 election;
- one honest "unresolved", for the September 2025 Fed decision.

The other miners on the same questions behaved like this:
- one miner answered every question with Formula 1 race data;
- several returned null.

It runs on free OpenRouter models, falling back to the next model in the list when one is unavailable.

| File | Contents |
|---|---|
| `lib/outcome.mjs` | The rules |
| `lib/outcome.test.mjs` | Tests for the rules |
| `api/resolve.js` | The endpoint |
| `miner/takar-outcome.yaml` | The registration file |
| `scripts/register-miner.mjs` | Registration on the V2 Diamond |

## Limitations

- The fleet is simulated. No real machine acts on these decisions.
- METAR stations are airports. Some places have none in range (Palangka Raya has no METAR station within about 100 km). There the fleet reads an Open-Meteo model wind, labelled as a model: it can hold a unit, but the answer stays "unconfirmed".
- Only one STORM_ALERT miner (PREFLIGHT) gave a usable answer for Indonesian places on 21 Nov, so drones that need two agreeing miners hold. That is the rule working, and a gap in the network.
- Takar Outcome answers few of the scorecard's Manifold questions: it never guesses, and Wikipedia does not settle vague ones.
- Ranking data comes from the node's public leaderboard, which only lists intents scored in a recent epoch. Takar walks back up to 12 epochs.
- Settle v3's two resolver keys are both Takar's today; the contract accepts any set, so a partner can hold the second seat in a new instance. The contract cannot check on chain that a signal is Telegraph's.
- The Gold Rush dossiers read goldrush-qld-history's structured record by a direct call to its registered endpoint (the paid Telegraph answer carries text only) and check which figures appear in the paid answer.
- Testnet only. Test USDC has no value, and nothing here is paid production usage.

## Layout

```
lib/x402.mjs        x402 "exact" signer: amount cap, token check, chain match (from the Amanat project, moved to V2)
lib/telegraph.mjs   canonical asks, ranked miners, append-only ledger
lib/observe.mjs     METAR station lookup and readings (aviationweather.gov)
lib/fleet.mjs       per-unit plan, budgeted buying with fallback, GO/HOLD/ABORT rules
scripts/            fund-v2, fleet-run, first-ask
```

MIT licensed. Disclosure: this is a hackathon entry with cash prizes.
