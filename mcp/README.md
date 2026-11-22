# takar-mcp

Three tools for any MCP client (Claude Desktop, Claude Code, Cursor, and so on).
There are no dependencies, no API key and no wallet.

```json
{ "mcpServers": { "takar": { "command": "npx", "args": ["-y", "takar-mcp"] } } }
```

| Tool | What it returns |
|---|---|
| `resolve_event` | Whether a real-world event happened, or who won it. Every yes or no answer carries a sentence quoted word for word from the cited Wikipedia article, checked in code. Events that have not ended, or that the sources do not settle, come back as `unresolved` instead of a guess. It is the same resolver as the Takar Outcome miner on Telegraph. |
| `forecast_scorecard` | The Mission 13 forecast scorecard: prediction-market prices 7 days before close, Brier-scored against outcomes bought through Telegraph. The Ed25519 signature is checked against Takar's **pinned** public key, so an edited scorecard reports `verified: false`. |
| `intent_ranking` | Live miner ranking for any Telegraph intent, read from the node's leaderboard. It walks back through epochs, because the latest epoch lists only the intents it scored. |
| `second_opinion` | Two miners from different operators answer the same intent and are compared field by field, never averaged. Free through Takar's testnet escrow; set `TAKAR_PAYER_KEY` to pay from your own escrow with no limit. Every call is recorded on EAS. |
| `miner_reputation` | Miners ranked from an open EAS schema of who was right, with Wilson intervals; filter by intent or attester. |
| `miner_report` | Why a miner scored what it scored: per-epoch scores and failure reasons, spot checks, its paid record, and flags such as a 0 with no failure reason. |
| `network_check` | `operators`: miners grouped by fee address, and per intent how many independent operators exist. `disagreement`: how often miners from different operators disagree, per intent. `signal`: a signal hash on the node, in Takar's ledger, and inside its EAS-anchored Merkle root. |

Environment overrides: `TAKAR_RESOLVER`, `TELEGRAPH_NODE`, `TAKAR_SCORECARD`.

```bash
node test.mjs            # 4 offline signature checks + 7 live checks
node test.mjs --offline
```

Source: https://github.com/PugarHuda/takar (`mcp/`). MIT.
