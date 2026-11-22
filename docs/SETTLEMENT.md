# TakarSettle next to the dispute designs people already know

TakarSettle (`onchain/src/TakarSettle4.sol`) borrows the shape of an optimistic oracle and changes who answers and who may object. This page puts it next to UMA's Optimistic Oracle and Kleros, so a reader who knows those can place it quickly. Their parameters are configurable; the descriptions below are their usual shape, not a specific deployment.

| | UMA Optimistic Oracle | Kleros | TakarSettle v4 |
|---|---|---|---|
| Who proposes | Anyone, with a bond | A party opens a case | A resolver on the deal's panel, with the two Telegraph signals that back the decision |
| What the proposal rests on | The proposer's claim | Evidence the parties submit | **Two answers from miners on different operators**, each a Telegraph receipt anyone can open; a third check from outside Telegraph (OFAC screen, NASA POWER) for some deals |
| Who must agree before the clock starts | No one: the proposal stands unless disputed | A random jury | **A second resolver** re-checks both signals and backs the same proposal (threshold 2) |
| Who may dispute | Anyone, posting a bond | The parties, by appeal | **Only the payer and the payee**, once each, posting a 0.5 test USDC bond |
| Window | Hours, set per request | Days per round | 10 minutes on testnet (set per contract) |
| What a dispute does | Escalates to a token-holder vote | Adds jurors on appeal | One dispute: the resolvers re-propose on fresh evidence. **Both parties disputed: the whole panel must sign**, not two of three |
| Who pays for a wrong dispute | The loser's bond goes to the winner | Appeal fees | The disputing party's bond goes to the other party if the decision stands |
| Who the deciders are | Token holders | Staked jurors | A named panel; seat 3 on the v4 panel belongs to another team (Praman Desk), whose daemon signs only after its own checks |

## Why it is built this way

- **The evidence is bought, not argued.** A proposal points at Telegraph signals, so a resolver checks receipts rather than weighing claims. That is why two resolvers are enough in the normal case and a vote is not needed.
- **Independence is in the evidence and in the panel.** The two answers must come from different operators, and the resolvers can be different teams. A shared upstream (both miners reading the same site) is reported by the second-opinion layer that feeds the proposal.
- **Only the people with money at stake can object.** An open dispute game invites griefing on small deals; here the payer and the payee are the only ones who lose if the decision is wrong.
- **Escalation is unanimity, not a bigger vote.** When both sides object, the deal needs every seat on the panel, so no single resolver, including Takar's, can push it through.

## What it does not have

- No token, no jury and no appeal beyond the panel. A panel that will not sign leaves the deal unsettled, and the payer can reclaim after the grace period.
- Testnet only, with short windows chosen for demonstration.
- The panel is fixed at deployment.

Deals that ran this path, each step a transaction: [the board](https://takar-telegraph.vercel.app/board.html#settle-h) and the landing page's trace of deal 0.
