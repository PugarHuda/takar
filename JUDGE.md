# For reviewers

Takar is entered in Season II, Apps & Agents, Mission 11 (Autonomous Systems). It runs on Ethereum Sepolia testnet.

## Check it in five minutes, with no wallet

1. Open `receipts/ledger.jsonl`. Pick any line with `"status":"paid"` and open its `settlementTx` on https://sepolia.etherscan.io. You should see a 0.01 USDC transfer to the Telegraph Diamond `0x3624EB01…`.
2. Fetch `https://devnode.telegraphprotocol.com/engine/v1/signal/<signalHash>` for the same line. The stored `request` shows exactly what was asked, and the stored response shows what the miner returned.
3. Open `receipts/decisions.jsonl`. Each decision lists the purchases it used (`receipts`), any answer it rejected (`unusableMiners`), the station reading (`station`) and the reasons.
4. Run `npm install && npm test`. This runs 79 offline checks of the payment signer and the decision rules, with no network and no funds.

## Reproduce a live run (needs a testnet key)

```bash
cp .env.example .env    # AGENT_PRIVATE_KEY = a throwaway Sepolia key with a little Sepolia ETH
npm run fund            # mints test USDC (public mint), funds escrow; testnet only
npm run fleet           # about $0.05–0.09 of test USDC; prints GO/HOLD per unit with receipts
```

Try a realistic new input by editing `fleet.json`: change a unit's `location`, `limits` or `budgetUsd`.

Try a failure case by setting a unit's `budgetUsd` to `0.01` on a rover. The rover needs two purchases, so it must HOLD with "budget exhausted". Other ways to force a failure:
- Set a drone's `maxGustKmh` below the current station wind. It must HOLD and say why.
- Pick a place with no airport station nearby. The decision must be marked "unconfirmed".

## Claims and their evidence

| Claim | Where to check |
|---|---|
| The #1-ranked STORM_ALERT miner ignores the location | `receipts/ledger.jsonl` entries for miner 37007, and [bounties#211](https://github.com/telegraphprotocol/bounties/issues/211) |
| The fleet fails closed on unusable answers | `lib/fleet.test.mjs`, and the decisions for `drone-palangkaraya-1` |
| Each unit stays within its budget | `lib/fleet.test.mjs` (budget cases), and `spentUsd` against `budgetUsd` in decisions |
| Cost of intelligence per operating hour | the `costPerOpHourUsd` and `wastedUsd` fields of each decision |

**What is not claimed:** real machines, production traffic, or paying customers. The fleet is simulated, and every purchase is testnet.
