# Moving Takar to mainnet

Telegraph's co-founder said in #hackathon on 23 Nov 2026 that mainnet is planned for December or January. This page lists what changes for Takar when it does, what stays the same, and what a check would cost a paying user. Nothing here has run on mainnet yet.

## What switches with configuration

The paid path (`lib/telegraph.mjs`, and the three paid endpoints that import it: `/api/second-opinion`, `/api/resolve`, `/api/dossier`) reads every network value from the environment. The defaults are Ethereum Sepolia.

| Variable | Sepolia default | Set on mainnet to |
|---|---|---|
| `TELEGRAPH_NODE` | `https://devnode.telegraphprotocol.com` | the mainnet node URL |
| `TELEGRAPH_CHAIN_ID` | `11155111` | the chain Telegraph settles on |
| `RPC` | publicnode Sepolia | an RPC for that chain |
| `TELEGRAPH_USDC`, `TELEGRAPH_CIRCLE_USDC` | the two test USDC tokens | the USDC the node's 402 names |
| `TELEGRAPH_ESCROW` | the ledger Diamond `0x72a7…a08b` | the mainnet escrow |
| `SERVER_PAYER_KEY` | the testnet payer | a funded mainnet payer with a spend cap |

Spend guards do not change: the per-call cap, the per-caller rate limit (6 a minute) and the daily budget in `api/second-opinion.js` apply to real money exactly as they do to test USDC.

## What has to be redone

- **Our miner (Takar Outcome, 20261117)**: register it on the mainnet node with `scripts/register-miner.mjs` against the new node and chain. The YAML and the endpoint stay the same.
- **Settlement contracts (TakarSettle v3 and v4)**: deploy again on the mainnet chain. Resolver seats are new addresses; Praman's seat is theirs to re-take.
- **Reputation on EAS**: the schema has to be registered on the mainnet EAS (`lib/reputation.mjs` holds the Sepolia EAS, registry and indexer addresses). Testnet history does not carry over; the scorecards start again from zero.
- **The daily Merkle anchor**: point `scripts/anchor.mjs` at the new chain.
- **Helper scripts** (`scripts/settle*.mjs`, `fund-v2.mjs`, `register-*.mjs`) still name Sepolia in their provider line; they are operator tools, run by hand, and are switched one by one when they are needed.

## What a check costs a paying user

From `docs/ECONOMICS.md`, at today's devnode price of $0.01 an ask (mainnet prices are not set yet):

| Unit | Asks | Cost at $0.01 an ask |
|---|---|---|
| Second opinion, two operators agree | 2 | $0.02 |
| With escalation, when they disagree | 3 at most | $0.03 cap |
| Fleet, per operating hour | about 0.1 to 0.4 | $0.001 to $0.006 |
| Gold Rush dossier, public API | 3 to 4 | $0.03 to $0.04 |

The user pays the miners through Telegraph; Takar adds no fee today. A mainnet version could add a small fee on top of the asks, charged only when the check returns `agree` or `disagree` (not `insufficient`), so a user never pays Takar for a check it could not make.

## Where Takar fits what Telegraph asked for

In the same message Telegraph asked builders for "specialist intelligence that solves real commercial problems" from "live data, actual records, technical systems and independently verifiable findings", and named AI agents and autonomous systems (Missions 07, 09, 10, 11, 15) among the areas. Takar is the step an agent runs before acting on such an answer:

- **Autonomous systems (Mission 11)**: the fleet buys two checks and an airport station before a drone flies, and `receipts/fleet-outcomes.json` scores those decisions against the weather that then happened.
- **Independently verifiable findings**: two miners from different operators, a check that they do not read the same upstream, and every comparison attested on EAS with a Merkle-anchored receipt.
- **Other teams' agents**: Gainsay's NFL and Champions League proposals call Takar Outcome (merged 22 Nov), and Praman's resolver signed a settlement on our panel.
