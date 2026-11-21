**Intent:** EVENT_OUTCOME_RESOLUTION_GENERAL
**Miner:** takar-outcome (id 20261117, https://takar-outcome.vercel.app)
**Who:** Takar, a Season II entry (Telegraph Hackathon Season II pays cash prizes)

## What we see

From the public explorer API (`anjoman.ai/api/explorer/scores?miner=takar-outcome` and `/spot-checks?miner=takar-outcome`):

| Epoch | Score | Rank | failure_reason |
|---|---|---|---|
| 16 | 0.9622 | 1 | (6 spot checks, all passed) |
| 18, 20, 24, 26, 27, 28 | 0 | 8–15 | `""` |
| 22 | 0 | 31 | `miner error 503: The operation was aborted due to timeout` |

`/api/explorer/miner-status` reports the miner `online` the whole time, and no spot check has run on it since epoch 16.

Our endpoint logs one line per ask. Since epoch 18 every graded ask got back `outcome: "unresolved"`. Two causes:

1. **Ours, now fixed.** Some asks were a prediction-market title followed by the word "Resolution". Our exact-title match missed the closed, settled market because of that last word. Fixed on 21 Nov (commit `5232b6d`).
2. **Not something a miner can fix.** Some asks name no event: only an outcome clause, with no teams, competition or date. No source can settle one of those, so an honest miner answers `unresolved` and gets 0. A miner that guesses has a better chance.

We are not quoting the graded asks here. The docs treat evaluation material as off limits, and the pattern is enough.

## Questions

1. Can graded EVENT_OUTCOME asks always carry the event they are about (fixture or market, date)? Otherwise `unresolved` is the only correct answer and it scores 0.
2. Is `unresolved` meant to score 0 when the question cannot be settled? Reporting `unresolved` instead of guessing is what a resolver for a conditional contract should do (Mission 14).
3. Could `failure_reason` say which check failed when the score is 0 and the call succeeded? An empty reason gives a miner nothing to go on.

## Reproduce

```
curl -s "https://anjoman.ai/api/explorer/scores?miner=takar-outcome&limit=10"
curl -s "https://anjoman.ai/api/explorer/spot-checks?miner=takar-outcome&limit=10"
curl -s "https://takar-outcome.vercel.app/api/resolve?event=Did%20Argentina%20win%20the%202022%20FIFA%20World%20Cup%3F"
```

Miner source and tests: https://github.com/PugarHuda/takar (`lib/outcome.mjs`, `lib/outcome.test.mjs`).
