"""Score held-out pairs on the real engine (local adapterexec) and report ordering accuracy.

    python -I engine-check.py [N] [URL]

Texts are rendered and tokenised exactly as the node does it ("### Task:\n" + prompt +
"\n\n### Answer:\n" + answer, node tokenizer, [CLS]/[SEP], at most 512 tokens).
"""
import json, struct, sys, urllib.request
from collections import Counter
from tokenizers import Tokenizer

N = int(sys.argv[1]) if len(sys.argv) > 1 else 40
URL = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:8080/"
tok = Tokenizer.from_file("foundation/tokenizer.json")
tok.no_padding()
tok.enable_truncation(512)

def ids(prompt, answer):
    return tok.encode("### Task:\n" + prompt + "\n\n### Answer:\n" + answer).ids

def score(batch):
    req = urllib.request.Request(URL, json.dumps({"batch": [{"tokens": t} for t in batch]}).encode(), {"content-type": "application/json"})
    out = json.load(urllib.request.urlopen(req, timeout=1800))["results"]
    return [struct.unpack("<f", struct.pack("<I", r["score"]))[0] for r in out]

rows = [json.loads(l) for l in open("data/test.jsonl", encoding="utf8")]
# a fixed sample spread over the kinds
by = {}
for r in rows:
    by.setdefault(r["kind"], []).append(r)
sample = [r for k in sorted(by) for r in by[k][: max(1, N // len(by))]]
ok, kinds = 0, Counter()
for r in sample:
    c, j = score([ids(r["prompt"], r["chosen"]), ids(r["prompt"], r["rejected"])])
    good = c > j
    ok += good
    kinds[(r["kind"], good)] += 1
print(f"engine ordering: {ok}/{len(sample)} = {ok / len(sample):.1%}")
for k in sorted(by):
    print(f"  {k:10s} {kinds[(k, True)]}/{kinds[(k, True)] + kinds[(k, False)]}")
