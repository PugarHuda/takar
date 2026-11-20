// Build preference pairs for an EVENT_OUTCOME_RESOLUTION evaluator adapter.
//
//   node build-pairs.mjs            -> data/train.jsonl, data/val.jsonl, data/test.jsonl
//
// Prompts are real Manifold binary markets (resolved: the truth is known; open:
// the honest answer is "unresolved"). Answers are rendered as miner responses
// in the intent's own fields, because that is what the node judges.
//
// Every pair type differs in how the answer relates to the QUESTION, not in its
// surface style, so a model cannot pass by spotting words (the trainer's gate
// checks this with a bag-of-words probe that never sees the prompt):
//   topic       right event vs a well-formed answer about a different event
//   consistent  outcome agrees with its own evidence vs contradicts it
//   premature   open event: "unresolved" vs a confident made-up resolution
//   settled     resolved event: a resolution vs a "not yet decided" dodge
//   junk        right event vs a real off-topic payload a ranked miner returned
// Pure fact flips (YES vs NO with no internal tell) are left out: a 150M
// encoder cannot know who won, and such pairs only add noise.
import { readFileSync, writeFileSync } from "node:fs";

// Pinned so the pairs rebuild byte for byte on any day.
const NOW = Date.parse("2026-11-19T00:00:00Z");
const rand = mulberry32(20261119);
const pick = (a) => a[Math.floor(rand() * a.length)];
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const STOP = new Set("will what when with that this from have been before after than into over more most there their about which would could year years 2023 2024 2025 2026 2027 2028 resolve resolved market question".split(" "));
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

const markets = JSON.parse(readFileSync("data/manifold.json", "utf8")).filter((m) => m.question.length >= 16);
const feed = JSON.parse(readFileSync("data/feed-event-outcome.json", "utf8"));

// Real off-topic payloads: answers whose text shares no key term with the question.
const terms = (s) => new Set((s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((w) => !STOP.has(w)));
const junk = feed
  .filter((r) => r.execution?.result && r.question?.text)
  .map((r) => ({ q: r.question.text, a: JSON.stringify(r.execution.result) }))
  .filter(({ q, a }) => { const t = terms(q); return t.size && ![...t].some((w) => a.toLowerCase().includes(w)); })
  .map(({ a }) => a);
// Answers to other intents (prices, weather, DNS...): what a misrouted or catch-all
// miner returns. Each payload is used once, cut from its START as a miner sends it.
const misrouted = shuffle(JSON.parse(readFileSync("data/feed-other.json", "utf8")).map((o) => o.answer));
let jx = 0;
const nextJunk = () => (rand() < 0.15 ? pick(junk) : misrouted[jx++ % misrouted.length]);
const junkPair = (m, chosen) => {
  const j = nextJunk();
  add(m, "junk", chosen, j.slice(0, Math.max(60, chosen.length + Math.floor(rand() * 80) - 40)));
};

// --- answer renderers: one schema, several surface forms ----------------------
function answer({ event, outcome, winner = null, at = null, source, evidence, note = null }) {
  const resolved_yes = outcome === "yes" ? true : outcome === "no" ? false : null;
  const body = { event, outcome, resolved_yes, winner, resolved_at: at, sources: source ? [source] : [], evidence };
  if (note) body.note = note;
  const style = rand();
  if (style < 0.6) return JSON.stringify(body);
  if (style < 0.8) return JSON.stringify({ result: body });
  return `Event: ${event}\nOutcome: ${outcome}${winner ? `\nWinner: ${winner}` : ""}\nResolved at: ${at ?? "n/a"}\nEvidence: ${evidence}\nSources: ${source ?? "none"}`;
}

const resolvedEvidence = (m, says) => pick([
  `The market "${m.question}" closed and resolved ${says} on ${day(m.resolvedAt)}.`,
  `Resolved ${says} on ${day(m.resolvedAt)} by the market's own resolution criteria.`,
  `Settled ${day(m.resolvedAt)}: the question resolved ${says}.`,
]);
const resolvedAnswer = (m, overrides = {}) => {
  const says = m.resolution;
  return answer({ event: m.question, outcome: says.toLowerCase(), at: day(m.resolvedAt), source: m.url, evidence: resolvedEvidence(m, says), ...overrides });
};
const openAnswer = (m, close = m.closeTime) => answer({
  event: m.question, outcome: "unresolved", source: m.url,
  evidence: pick([`The question stays open until ${day(close)}; no outcome can be stated yet.`, `Not settled: the deciding period runs to ${day(close)}.`, `Unresolved as of today; it closes ${day(close)}.`]),
});

// --- pair types --------------------------------------------------------------
const resolved = shuffle(markets.filter((m) => m.state === "resolved"));
const open = shuffle(markets.filter((m) => m.state === "open"));
const donors = shuffle([...resolved, ...open]);
let d = 0;
const donor = (not) => { let m; do m = donors[d++ % donors.length]; while (m.id === not.id); return m; };

const pairs = [];
const add = (m, kind, chosen, rejected) => pairs.push({ prompt: m.question, chosen, rejected, kind, market: m.id });

for (const [i, m] of resolved.entries()) {
  const k = i % 10;
  if (k < 4) { // topic
    const o = donor(m);
    add(m, "topic", resolvedAnswer(m), o.state === "resolved" ? resolvedAnswer(o) : openAnswer(o));
  } else if (k < 7) { // consistent: the outcome field disagrees with its own evidence
    const flip = m.resolution === "YES" ? "no" : "yes";
    add(m, "consistent", resolvedAnswer(m), resolvedAnswer(m, { outcome: flip }));
  } else if (k === 7 || k === 8) { // settled vs dodge
    add(m, "settled", resolvedAnswer(m), openAnswer(m, NOW + (30 + Math.floor(rand() * 300)) * 864e5));
  } else { // junk (k = 9)
    junkPair(m, resolvedAnswer(m));
  }
}
for (const [i, m] of open.entries()) {
  if (i % 8 === 7) { junkPair(m, openAnswer(m)); continue; }
  if (i % 2 === 1) { const o = donor(m); add(m, "topic", openAnswer(m), o.state === "resolved" ? resolvedAnswer(o) : openAnswer(o)); continue; }
  const fake = { ...m, resolution: pick(["YES", "NO"]), resolvedAt: NOW - Math.floor(rand() * 200) * 864e5 };
  add(m, "premature", openAnswer(m), resolvedAnswer(fake));
}

// --- split by market, so no question is in two splits ----------------------------
const seen = new Set();
const uniq = shuffle(pairs).filter((p) => p.chosen !== p.rejected && !seen.has(p.rejected) && seen.add(p.rejected));
const split = (p) => { const h = hash(p.market) % 100; return h < 80 ? "train" : h < 90 ? "val" : "test"; };
for (const s of ["train", "val", "test"]) {
  const rows = uniq.filter((p) => split(p) === s);
  writeFileSync(`data/${s}.jsonl`, rows.map(({ prompt, chosen, rejected, kind }) => JSON.stringify({ prompt, chosen, rejected, kind })).join("\n") + "\n");
  const kinds = rows.reduce((a, p) => ((a[p.kind] = (a[p.kind] ?? 0) + 1), a), {});
  console.log(s, rows.length, kinds);
}
console.log("junk payloads", junk.length, "misrouted", misrouted.length, "used", jx);

function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
