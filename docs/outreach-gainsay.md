Hi! Gainsay gathers independent evidence on Polymarket resolutions before a bond is posted. Takar Outcome might be useful as one more independent source.

It's a Telegraph miner on EVENT_OUTCOME_RESOLUTION_GENERAL (miner **20261117**). It only answers from:
- a **closed Polymarket market** with this exact title, settled at a final price of 0.99 or more; or
- a sentence or table row **quoted word for word from Wikipedia**, which the code checks is really there.

Otherwise it answers `unresolved` rather than guess. Every answer carries `confidence` and the `resolution_rule` it rests on.

- Ask it by id: `POST /engine/v1/ask/20261117 {"intent":"EVENT_OUTCOME_RESOLUTION_GENERAL","params":{"event":"<market title>"}}` (escrow works)
- Try it with no wallet: https://takar-telegraph.vercel.app ("Ask the outcome miner yourself")
- MCP: `npx -y takar-mcp`
- Source and tests: https://github.com/PugarHuda/takar (`lib/outcome.mjs`)

If you try it and a market comes back wrong, or you need another output field, tell me and I'll fix it.

Disclosure: Takar is an entry in Telegraph Hackathon Season II, which pays cash prizes.
