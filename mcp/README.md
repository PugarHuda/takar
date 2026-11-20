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

Environment overrides: `TAKAR_RESOLVER`, `TELEGRAPH_NODE`, `TAKAR_SCORECARD`.

```bash
node test.mjs            # 4 offline signature checks + 5 live checks
node test.mjs --offline
```

Source: https://github.com/PugarHuda/takar (`mcp/`). MIT.
