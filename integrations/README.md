# Telegraph in OpenClaw and Hermes, through Takar

Use cases #19 (native Telegraph integration) and #20 (independent agent task verification) of the
Season II commercial use cases. One MCP server, `takar-mcp`, gives an agent:

| Tool (Hermes name / mcporter name) | What it does |
|---|---|
| `mcp_takar_second_opinion` / `takar.second_opinion` | Two Telegraph miners from different operators answer the same intent; compared field by field, never averaged: `agree`, `disagree` or `insufficient`, with both signals. No key: Takar's testnet escrow pays. |
| `mcp_takar_verify_signal` / `takar.verify_signal` | Recompute a Telegraph signal's hash from its payload on the node: the answer you used is the one that was paid for. |
| `mcp_takar_intent_ranking`, `mcp_takar_miner_reputation` | Which miners rank for an intent, and an open on-chain (EAS) record of which were right. |
| `mcp_takar_resolve_event` | Event outcomes with a verbatim quote, `unresolved` instead of a guess. |
| `mcp_takar_trade_case`, `mcp_takar_verify_countersign` | Trade Assurance case files that re-decide from their receipts; Countersign memo checks. |

## Hermes Agent

Add [`hermes/config.yaml`](hermes/config.yaml) under `mcp_servers` in `~/.hermes/config.yaml`, then
`/reload-mcp` (or a new session). `hermes mcp test takar` shows what the server answered.

```yaml
mcp_servers:
  takar:
    command: "npx"
    args: ["-y", "takar-mcp"]
    timeout: 120
```

## OpenClaw (mcporter)

Put [`openclaw/mcporter.json`](openclaw/mcporter.json) in mcporter's config (`config/mcporter.json` in the
project, or `~/.mcporter/mcporter.json`), then:

```bash
mcporter list takar --schema
mcporter call takar.second_opinion --args '{"intent":"SANCTIONS_SCREENING_MATCH_GENERAL","params":{"name":"Bank Rossiya"},"fields":["matched"]}'
mcporter call takar.second_opinion --args '{"intent":"EVENT_OUTCOME_RESOLUTION_GENERAL","params":{"event":"Did Argentina win the 2022 FIFA World Cup?"}}'
```

## The skill: when to verify (#20)

[`skills/takar-verify/SKILL.md`](skills/takar-verify/SKILL.md) tells an agent when an answer is consequential
enough to check, which tool to call, and what to do with each verdict (agree: act; disagree: hold and report
both; insufficient: unknown, never "no").

## It changes outcomes: a real run

`node scripts/agent-verify-demo.mjs` runs that policy as code over the same MCP server (stdio), so it is
reproducible without a model key; an LLM agent makes the same calls. Run of 28 Nov 2026
(`receipts/agent-verify/`), every answer a paid Telegraph ask:

| Task | Verdict | Action |
|---|---|---|
| Pay an invoice from Bank Rossiya? | agree, matched | **Block** the payment |
| Pay an invoice from Siemens AG? | agree, clear | Pay |
| Did the Fed cut rates on 18 Sep 2024? | **disagree** | **Do not state it**; report both |
| Settle: did Argentina win the 2022 World Cup? | agree, yes | Settle |

The Fed row is why the check exists: miner 4433 answered **"no"** with no source; Takar Outcome (20261117)
answered "yes" from the FRED target-rate series (the Fed did cut by 50 bp that day). An agent that took one
routed answer could have told its user the wrong thing. With the check it holds and shows both.

## Status

- takar-mcp 0.6.0 (the three Trade Assurance and verification tools, `fields` on `second_opinion`) is in
  this repository; until it is on npm, run it from a clone: `command: "node"`, `args: ["<clone>/mcp/server.mjs"]`.
- Testnet only: Ethereum Sepolia, test USDC.
