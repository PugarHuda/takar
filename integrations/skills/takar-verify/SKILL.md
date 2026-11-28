---
name: takar-verify
description: Check a consequential claim with Telegraph before acting on it. Use when an answer will move money, block or approve a counterparty, settle a bet or market, or be stated to a user as fact (sanctions hits, event outcomes, prices, weather that decides an action, a supplier's identity, a shipment's arrival). Takar asks two Telegraph miners run by different operators and compares their answers field by field; it never averages.
---

# Takar: verify before you act

Takar is a verification layer over Telegraph's paid intelligence network. It is reached as an MCP server
(`takar`), from Hermes as `mcp_takar_<tool>` and from OpenClaw through mcporter as `takar.<tool>`.

## When to verify

Verify when the answer is **consequential** and **checkable**:

- it decides a payment, a refusal, an escalation or a published statement;
- a wrong answer would be expensive or embarrassing;
- it is a fact about the world that a specialist source can settle (sanctions, an event's outcome, a price,
  a ship's position, weather at a place and time, a company's identity).

Do not verify opinions, plans, or things only the user can know.

## How

1. Call `second_opinion` with the Telegraph intent and its params, and the field that decides your action:
   - sanctions: `{"intent": "SANCTIONS_SCREENING_MATCH_GENERAL", "params": {"name": "<entity>"}, "fields": ["matched"]}`
   - event outcome: `{"intent": "EVENT_OUTCOME_RESOLUTION_GENERAL", "params": {"event": "<question with its date>"}}`
   - If you do not know the intent name, call `intent_ranking` with a likely name or ask the user.
2. Act on the verdict:
   - `agree`: two operators gave the same answer on the deciding field. Use `answer`, and cite both signals.
   - `disagree`: **do not act on either answer.** Say which fields differ and what each source said. Hold,
     ask the user, or look for a third independent source.
   - `insufficient`: fewer than two usable answers. Treat it as unknown, not as "no". Say so.
3. Keep the receipts: every answer has a Telegraph signal hash. `verify_signal` recomputes a signal's hash
   from its payload on the node, so anyone can confirm the answer you used is the one that was paid for.

## Worked rules

- A sanctions screen that comes back `disagree` or `insufficient` is never "clear". Stop the payment.
- An event marked `unresolved` by a miner is an abstention: the next miner is asked; never guess.
- Two miners from the same operator are one opinion; Takar already refuses to count them twice.

## Trade Assurance

For an order paid only when independent checks agree (ship in port, goods accepted, supplier clear), read a
case with `trade_case` (omit `case` to list them). Each case's evidence rounds re-decide from their stored
answers with the same rules. `verify_countersign` checks a Countersign shipment memo's digest and signer.
