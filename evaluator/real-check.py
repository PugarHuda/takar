"""Real answers from the node's feed vs Takar Outcome's live answer to the same question, scored on the engine."""
import json, re, struct, sys, urllib.request
from tokenizers import Tokenizer
tok = Tokenizer.from_file("foundation/tokenizer.json"); tok.no_padding(); tok.enable_truncation(512)
def score(texts):
    b = [{"tokens": tok.encode(t).ids} for t in texts]
    out = json.load(urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:8080/", json.dumps({"batch": b}).encode(), {"content-type": "application/json"}), timeout=1800))["results"]
    return [struct.unpack("<f", struct.pack("<I", r["score"]))[0] for r in out]
def ours(q):
    req = urllib.request.Request("https://takar-outcome.vercel.app/api/resolve", json.dumps({"event": q}).encode(), {"content-type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=120))
feed = json.load(open("data/feed-event-outcome.json", encoding="utf8"))
seen, rows = set(), []
for r in feed:
    q = r["question"]["text"]; a = r.get("execution", {}).get("result")
    if not a or q in seen or q.startswith("[intent]"): continue
    seen.add(q); rows.append((q, r["routing"].get("miner_slug"), json.dumps(a)))
n = int(sys.argv[1]) if len(sys.argv) > 1 else 8
wins = 0
for q, slug, theirs in rows[:n]:
    mine = json.dumps(ours(q))
    s_theirs, s_mine = score(["### Task:\n" + q + "\n\n### Answer:\n" + x for x in (theirs, mine)])
    wins += s_mine > s_theirs
    print(f"{s_mine:+7.2f} takar | {s_theirs:+7.2f} {slug:28s} | {q[:70]}\n         their answer: {theirs[:110]}")
print(f"takar ranked above the network's answer on {wins}/{n}")
