# Takar Outcome Evaluator

A Telegraph evaluator adapter for the `EVENT_OUTCOME_RESOLUTION` family. It is a
LoRA reward head on the shared Foundation Model (`modernbert-base-lora16-v1`)
that scores how well a miner's answer resolves the event that was asked.

## Why

On 19 Nov 2026 the family had no active evaluator; the one registered adapter
had been rejected. Under the default judging, ranked miners scored about 0.99
while answering with payloads that have nothing to do with the question. Two
real answers from the node's public question feed:

| Question | Answer returned by a top-7 miner |
|---|---|
| Will Heidelberg Engineering ANTERION study complete? | Bundesliga goal list (L. Sané, H. Kane, …) |
| Will Phrack 74 be released by 2027? | An NFL Polymarket listing (Commanders vs Buccaneers) |

This adapter is trained to put answers like those last.

## What it learned

Every pair differs in how the answer relates to the question, never in surface
style. The trainer's dataset gate checks that with a bag-of-words probe that
never sees the prompt.

| Kind | Better answer | Worse answer |
|---|---|---|
| topic | resolves the event asked | well-formed answer about a different event |
| consistent | outcome agrees with its own evidence | outcome contradicts its own evidence |
| premature | "unresolved" for a market still open | confident resolution with a made-up date |
| settled | resolution of a closed market | "still open" dodge |
| junk | resolves the event asked | real off-topic payload from the network feed |

Plain YES-versus-NO flips are left out. A 150M encoder cannot know who won, and
those pairs would only add noise.

Prompts are real Manifold binary markets: 3,697 resolved (truth known) and
1,865 still open. The split is by market, so no question appears in two splits.

## Results (official kit, `train_adapter.py`)

| | |
|---|---|
| Train / validation / test pairs | 4,454 / 542 / 537 |
| Dataset gate | PASS. Surface probe 62.2% (limit 65%), length shortcut 50.2%, leak 0% |
| Test pairwise accuracy (PyTorch) | 99.81% |
| "Pick the longer answer" baseline | 50.8% |
| Ordering on the real engine (WASM, 40 test pairs, `engine-check.py`) | 40/40 |
| `adapterbuild lora` (node's own checks) | pass. Class hybrid, keccak256 `0x69630036…ffd479a26` (v2.1: the v2 weights, re-hashed with an `x-takar-build` metadata key so the runnable URL could move) |

**Real answers from the network** (`real-check.py`, 10 questions from the node's feed,
scored on the engine against Takar Outcome's live answer to the same question):

| Question | Network answer | Network | Takar |
|---|---|---|---|
| Will Heidelberg Engineering ANTERION study complete? | Bundesliga goals (event-openligadb-bl1) | −3.73 | −2.45 |
| Will Phrack 74 be released by 2027? | NFL Polymarket listing (event-poly-series) | −6.48 | −2.18 |
| Will Phrack 74 be released by July 2027? | F1 Bahrain race data (event-jolpica-f1) | −9.46 | −0.93 |
| Will LeBron James win 2028 US election? | clear "unresolved" with the market cited (livecert) | +1.53 | −3.56 |

Every off-topic payload ranks below an on-topic answer. The network won 3 of 10, each one
a clearly worded "not yet decided" answer, which is a fair loss. The first version
(v1) still let the Bundesliga payload win (7.07 vs 6.96); v2 fixed that by drawing
the junk from 4,000 real answers to 123 other intents and cutting it from the start
of the payload, as a miner sends it.

The test set comes from the same generator as the training data, so these
numbers measure the five failure modes above. They do not predict accuracy on
the network's hidden pairs, which nobody outside the validators can read.

## Network result: rejected

Registration 156 (v2.1) reached the node's remote check on 20 Nov 2026. The node
sent 15 public pairs to our executor and the adapter ordered 7 correctly (46.7%,
floor 70%), so it was rejected before download. That is the honest measure of
this adapter: it learned our five failure modes, not what the network's pairs
reward. Its scores on those texts were mostly negative and close within each
pair, so it was not confidently wrong; it simply could not tell them apart.

We did not log the node's texts or train on them. The docs put evaluation
material outside the public build interface. A next version would need broader
preference data (real miner answers to real questions, judged on more than
topic), not a fit to the check.

## Reproduce

```bash
node pull-manifold.mjs        # data/manifold.json   (Manifold public API)
node pull-feed.mjs 400        # data/feed-event-outcome.json (node's public question feed)
node build-pairs.mjs          # data/{train,val,test}.jsonl, byte-identical (seeded, date pinned)

# Telegraph kit: github.com/telegraphprotocol/telegraph-wasm-baseline @ 1ed063e
# base/ = answerdotai/ModernBERT-base weights + the node's tokenizer.json (sha256 67bc76f8…)
python float_runtime/train_adapter.py --intent EVENT_OUTCOME_RESOLUTION \
  --data data/train.jsonl --val-data data/val.jsonl --test-data data/test.jsonl \
  --base-model base --batch-size 4 --grad-accum 4
python -m float_runtime.export_adapter --run runs/EVENT_OUTCOME_RESOLUTION \
  --intent EVENT_OUTCOME_RESOLUTION --class judgment --foundation foundation.json
```

The executor is Telegraph's own `cmd/adapterexec` on the official foundation
release, because validators re-score every text and reject a single differing
bit.
