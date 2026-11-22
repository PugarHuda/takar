# Give your Mind a second opinion in three messages

Your Mind can already ask Telegraph a question. This adds the step a careful analyst takes before acting on the answer: ask a second provider run by a different operator, see whether the two agree field by field, and see whether they read the same upstream source.

It needs no key, no wallet and no balance. Takar pays the Telegraph asks from its testnet escrow during the hackathon. Each call is recorded on EAS, so you can show afterwards what was checked.

The format follows Chrysolite's [Connect a Mind to Anjoman](https://github.com/investor567768/telegraph-supplier-detective/blob/main/SETUP.md) guide, which is the clearest way we have seen to teach a Mind a skill.

There is also a ready-made skill in the Minds Bazaar called **Takar Second Opinion**. If you equip that, skip to step 3.

---

## Step 1. Teach the skill

Paste this into your Mind as one message:

```
Save this as a skill called "Second Opinion".
Before you act on any Telegraph answer that matters (money, a compliance decision, a published claim), make this HTTP call:
POST https://takar-telegraph.vercel.app/api/second-opinion
Header: Content-Type: application/json
Body: {"intent": "<the Telegraph intent name>", "params": {<the same params you asked with>}, "fields": ["<the one field your decision depends on>"], "client": "<your Mind's name>"}
Read four things from the reply:
1. verdict: "agree", "disagree" or "insufficient".
2. differ: the fields where the two providers gave different answers.
3. independence.level: "operator and source" is strongest. "operator, shared upstream" means both providers read the same source (for example both read Wikipedia), so treat the agreement as one source, not two. "operator" means the sources were not stated.
4. signals: the two Telegraph receipts.
Rules:
- Only "agree" with independence "operator and source" counts as confirmed.
- On "disagree", report both answers and the differing fields. Never average them and never pick one.
- On "insufficient", say so and do not act.
- One call per decision. The call is free; do not retry it more than once.
```

## Step 2. Know the intent names

The intent is the name Telegraph routes on. Common ones:

| You want | Intent | Params | Decision field |
|---|---|---|---|
| Is this company or person sanctioned? | `SANCTIONS_SCREENING_MATCH_GENERAL` | `{"name": "Bank Rossiya"}` | `matched` |
| Did this event happen, or who won? | `EVENT_OUTCOME_RESOLUTION_GENERAL` | `{"event": "Did Argentina win the 2022 FIFA World Cup?"}` | `outcome` |
| A crypto price now | `CRYPTO_PRICE_USD` | `{"symbol": "BTC"}` | `price_usd` |

The full list of intents is on [Anjoman](https://anjoman.ai/dashboard/hackathon/season-2/intents). The [OpenAPI spec](https://takar-telegraph.vercel.app/openapi.json) describes every Takar endpoint, if your Mind reads OpenAPI.

## Step 3. Test it

Ask your Mind:

```
Use Second Opinion on EVENT_OUTCOME_RESOLUTION_GENERAL with {"event": "Did Argentina win the 2022 FIFA World Cup?"} and decision field outcome. Report the verdict, the independence level and both signals.
```

On 23 Nov 2026 this came back `agree` with independence `operator, shared upstream`: two providers on different operators both answered from wikipedia.org. That is the point of the third check. The answer is right, but it was one source relayed twice, not two sources.

---

## Optional: a rule for money

If your Mind moves funds or approves payments, add:

```
Save this as a standing rule: never release a payment or approve a counterparty on a single Telegraph answer. Run Second Opinion first. Proceed only on "agree" with independence "operator and source"; otherwise hold and tell me why.
```

For payments that should wait for evidence on chain, Takar's escrow contract does the same thing with two resolvers and a dispute bond: see [the board](https://takar-telegraph.vercel.app/board.html#settle-h).

## Limits

- Testnet only (Ethereum Sepolia, test USDC). Takar pays the asks, so a busy hour can hit its budget; the reply then says why.
- Independence by operator means different payout addresses. Two addresses can still belong to one team.
- Independence by source works only when both providers name their source. Many do not, and the reply says so.
