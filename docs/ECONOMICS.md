# What Takar costs to run

Measured from `receipts/ledger.jsonl` (826 asks, 628 paid, $6.38 in total on Ethereum Sepolia test USDC, 17–22 Nov 2026). Every ask on the node is priced at $0.01 today; a failed ask is not charged. Mainnet prices will be set by miners, so read the dollar figures as "asks × price", and the ask counts as the durable part.

| Unit of work | Paid asks | Cost at $0.01 | Time | Measured how |
|---|---|---|---|---|
| **Second opinion** (one decision checked by two operators) | 1.68 on average (2.89 attempts; failures not charged) | **$0.017** | a few seconds | 19 calls in the ledger |
| Second opinion with `escalate`, when two disagree | +1 independent opinion, capped in code | $0.03 at most (server cap) | +1 ask | `lib/second.mjs`, tests |
| **Gold Rush dossier, public API** (`/api/dossier`) | 3–4 (history, survey, price) | **$0.03–0.04** | about 40 s | API path, `deep: false` |
| Gold Rush dossier, deep (registry second opinion, closure research) | about 15–20 | **≤ $0.17** a mine (upper bound: $1.38 over 8 mines, reruns included) | about 10 min | 195 goldrush rows |
| Free layers in every dossier (tenure, native title, heritage, two other teams' cross-checks, CPI) | 0 | $0 | seconds | public registers and endpoints |
| **Forecast scorecard**, per market checked | about 1 | **$0.0103** | — | 459 rows, 113 not charged |
| Country note priced per fact | 36 | $0.36 for one note | — | `mission05` rows |
| Conditional escrow (Settle), per settlement | evidence asks + gas | about $0.01–0.03 plus Sepolia gas | — | `mission14`, `mission06` rows |
| Fleet, per unit-hour of operation | 37 asks over 92.6 h for 4 units | about $0.001 an operating hour | — | `drone`, `rover`, `field-robot` rows |

## Who pays what, and against what

- **A due-diligence analyst** (the lead buyer for Gold Rush) pays cents for a dossier that reconciles a government record, a survey, company reports and four registers, and keeps the conflicts visible. The cost that matters is their time, not the asks: the dossier is built in about 40 s (public) or about 10 min (deep), and every figure carries its source in W3C PROV-JSON, so the review is checking, not re-collecting.
- **An agent that moves money** pays $0.017 to know whether two independent operators agree before it acts. In our own receipts a single answer would have been wrong often enough to matter: one event miner was wrong on 7 of 15 market questions, and a drought cover would have paid out on a wet week.
- **Escalation is bought only on disagreement** (adopted from Colony, another team): agreement costs two asks; only a disagreement buys a third, and never above the cap. Average cost therefore tracks how often sources disagree, not how cautious the buyer is.

## Takar's own running cost

Vercel (hobby), GitHub Actions (free minutes), EAS on Sepolia (test ETH for attestations and the daily Merkle anchor), and a model for Wikipedia quotes only: `claude-haiku-5-5` through SumoPod at about $0.0005 a question, on a key capped at $2 (spent so far: about $0.11, most of it on replay tests). The data resolvers (FRED, ESPN) cost nothing per question.

## What is not claimed

These are testnet prices and our own usage, not paying customers. Mainnet ask prices, real-world dossier demand and an analyst's hourly rate are not measured here; the point of the table is the unit of work and how many asks it takes, which carries over.
