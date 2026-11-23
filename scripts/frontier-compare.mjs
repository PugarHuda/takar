// Takar Outcome against frontier-family models on questions whose answers are already settled.
//
//   node --env-file=.env scripts/frontier-compare.mjs [--models claude-haiku-5-5,gpt-4o-mini] [--per 12]
//     -> receipts/frontier-compare.json
//
// Questions: a fixed spread of every resolved market in receipts/numeric-holdout-2..7.json (prices,
// Fed decisions, recessions; truth is the market's own resolution) and of the ESPN/openfootball
// cross-check (receipts/sports-check.json; truth is openfootball's score). Takar's answers are the
// ones recorded when each holdout ran, including the questions it declined ("unresolved"), so the
// comparison is not limited to what it answered. Each model gets the bare question, no tools, and
// may say "unknown" instead of guessing. Graded: right, wrong, or unknown/abstained.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const MODELS = arg("models", "claude-haiku-5-5,gpt-4o-mini").split(",");
const PER = Number(arg("per", "12"));
const spread = (rows, n) => (rows.length <= n ? rows : Array.from({ length: n }, (_, k) => rows[Math.floor((k * rows.length) / n)]));

const items = [];
for (const h of [2, 3, 4, 5, 6, 7]) {
  const rows = JSON.parse(readFileSync(`receipts/numeric-holdout-${h}.json`, "utf8")).rows.filter((r) => /^(yes|no)$/.test(r.market));
  for (const r of spread(rows, PER)) items.push({ set: `numeric-holdout-${h}`, question: r.question, truth: r.market, takar: /^(yes|no)$/.test(r.ours) ? r.ours : "unresolved", source: r.url });
}
const sports = JSON.parse(readFileSync("receipts/sports-check.json", "utf8")).rows;
for (const r of spread(sports, 24)) items.push({ set: "sports-check", question: r.question, truth: r.openfootball, takar: /^(yes|no)$/.test(r.ours) ? r.ours : "unresolved", source: "openfootball 2024-25" });
// --same: ask exactly the questions already in the receipt, so a new model is compared on the same set.
if (process.argv.includes("--same") && existsSync("receipts/frontier-compare.json")) {
  items.length = 0;
  for (const r of JSON.parse(readFileSync("receipts/frontier-compare.json", "utf8")).rows) items.push({ set: r.set, question: r.question, truth: r.truth, takar: r.takar, source: r.source });
}

const SYSTEM = "Answer the question from your own knowledge. You have no tools and no browsing. Reply with JSON only: {\"answer\":\"yes\"|\"no\"|\"unknown\",\"confidence\":0..1,\"reason\":\"one short sentence\"}. Say unknown rather than guess.";
async function askModel(model, q) {
  const t0 = Date.now();
  const r = await fetch("https://ai.sumopod.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.SUMOPOD_API_KEY}`, "content-type": "application/json" },
    // Thinking off: with it on, these models spent the whole token budget thinking and returned an
    // empty answer, which an earlier run wrongly counted as abstaining.
    body: JSON.stringify({ model, temperature: 0, max_tokens: 200, thinking: { type: "disabled" }, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: q }] }),
    signal: AbortSignal.timeout(60_000),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message ?? `${r.status}`);
  const text = j.choices?.[0]?.message?.content ?? "";
  let a = "unparsed", reason = text.slice(0, 160), confidence = null;
  try { const p = JSON.parse(text.replace(/^```(json)?|```$/g, "").trim()); a = String(p.answer).toLowerCase(); reason = p.reason; confidence = p.confidence; } catch { const m = /\b(yes|no|unknown)\b/i.exec(text); if (m) a = m[1].toLowerCase(); }
  if (!text.trim()) throw new Error(`empty answer (finish_reason ${j.choices?.[0]?.finish_reason})`);
  return { answer: /^(yes|no|unknown)$/.test(a) ? a : "unparsed", confidence, reason, ms: Date.now() - t0, tokens: j.usage ?? null };
}
const grade = (a, truth) => (a === truth ? "right" : a === "yes" || a === "no" ? "wrong" : a === "unparsed" ? "error" : "abstained");

// Models already in the receipt are kept, so a cheaper model can be added without re-running an
// expensive one. ponytail: matched by question text.
const prior = existsSync("receipts/frontier-compare.json") ? new Map(JSON.parse(readFileSync("receipts/frontier-compare.json", "utf8")).rows.map((r) => [r.question, r.models])) : new Map();
const rows = [];
for (const it of items) {
  const row = { ...it, takar_grade: grade(it.takar, it.truth), models: { ...(prior.get(it.question) ?? {}) } };
  for (const m of MODELS) {
    try { const out = await askModel(m, it.question); row.models[m] = { ...out, grade: grade(out.answer, it.truth) }; }
    catch (e) { row.models[m] = { error: String(e.message).slice(0, 120), grade: "error" }; }
  }
  rows.push(row);
  process.stdout.write(".");
}
const tally = (get) => rows.reduce((a, r) => ((a[get(r)] = (a[get(r)] ?? 0) + 1), a), {});
const ALL = [...new Set(rows.flatMap((r) => Object.keys(r.models)))];
const summary = { questions: rows.length, takar: tally((r) => r.takar_grade) };
for (const m of ALL) {
  summary[m] = tally((r) => r.models[m]?.grade ?? "not asked");
  summary[m].confident_wrong = rows.filter((r) => r.models[m]?.grade === "wrong" && (r.models[m]?.confidence ?? 0) >= 0.8).length;
  summary[m].tokens = rows.reduce((a, r) => a + (r.models[m]?.tokens?.total_tokens ?? 0), 0);
}
// The cases worth showing: a model answered wrongly where Takar answered rightly.
const showcase = rows.filter((r) => r.takar_grade === "right" && ALL.some((m) => r.models[m]?.grade === "wrong"))
  .map((r) => ({ question: r.question, truth: r.truth, takar: r.takar, wrong: ALL.filter((m) => r.models[m]?.grade === "wrong").map((m) => ({ model: m, said: r.models[m].answer, confidence: r.models[m].confidence, reason: r.models[m].reason })) }));
writeFileSync("receipts/frontier-compare.json", JSON.stringify({ title: "Takar Outcome vs frontier-family models on settled questions", generated_at: new Date().toISOString(), method: "Bare question, no tools, temperature 0, unknown allowed. Takar answers as recorded in each holdout run (data first, model only with a verbatim quote). Truth: the market's own resolution, or openfootball for games.", models: ALL, summary, showcase, rows }, null, 2) + "\n");
console.log("\n" + JSON.stringify(summary, null, 1));
console.log(`showcase: ${showcase.length} questions where a model was wrong and Takar right`);
