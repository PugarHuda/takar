// Paid corroboration for the register events (scripts/events-run.mjs). Each dated event of a kind an
// investor cares about becomes one yes/no question, put to two EVENT_OUTCOME miners from different
// operators through Takar's second opinion. The capsule is re-signed with what came back:
//   corroborated   the register says it happened and two independent miners agree it did
//   contradicted   two independent miners agree it did not (the register and the network disagree)
//   disputed       the two miners disagree with each other
//   register only  fewer than two usable answers
// Research miners (RESEARCH_QUERY) were tried first on 23 Nov and gave nothing usable: one answered
// "No authoritative public index entry returned" with confidence 1, two returned source_unavailable.
// Testnet, about $0.02 to $0.03 an event.
//
//   node --env-file=.env scripts/events-corroborate.mjs [mine-slug ...] [--per 5]
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { ask, ranked } from "../lib/telegraph.mjs";
import { secondOpinion } from "../lib/second.mjs";
import { signDoc } from "../lib/sign.mjs";

const key = process.env.TAKAR_SIGNING_KEY;
if (!key) throw new Error("TAKAR_SIGNING_KEY is not set");
const args = process.argv.slice(2);
const per = Number(args[args.indexOf("--per") + 1] ?? 5) || 5;
const wanted = args.filter((a) => !a.startsWith("--") && !/^\d+$/.test(a));
const registry = await fetch("https://devnode.telegraphprotocol.com/api/miners", { signal: AbortSignal.timeout(30_000) }).then((x) => x.json());
const ops = new Map(registry.map((m) => [String(m.id), m.fee_address ?? m.wallet_address ?? null]));
const run = new Date().toISOString();

// Most telling first; one question per event, phrased from its kind and year only, so the miners are
// not handed the register's wording.
const QUESTION = [
  ["accident or death", (m, y) => `Were miners killed or injured in an accident at the ${m} mine in Queensland in ${y}?`],
  ["fire", (m, y) => `Was there a fire at the ${m} mine in Queensland in ${y}?`],
  ["flood or weather", (m, y) => `Was the ${m} mine in Queensland flooded or damaged by weather in ${y}?`],
  ["strike or dispute", (m, y) => `Was there a strike or industrial dispute at the ${m} mine in Queensland in ${y}?`],
  ["restart", (m, y) => `Was mining at ${m} in Queensland restarted or reopened in ${y}?`],
  ["closure", (m, y) => `Did mining at ${m} in Queensland stop or close in ${y}?`],
];
export const questionFor = (mine, e) => { const q = QUESTION.find(([k]) => e.types.includes(k)); return q ? { kind: q[0], text: q[1](mine, e.year) } : null; };

const files = readdirSync("receipts").filter((n) => /^events-[a-z0-9-]+\.json$/.test(n)).filter((n) => !wanted.length || wanted.includes(n.slice(7, -5)));
let spent = 0;
for (const f of files) {
  const doc = JSON.parse(readFileSync(`receipts/${f}`, "utf8"));
  const own = new Set(doc.capsules.filter((c) => c.finding.source.entry && new RegExp(doc.mine.split(" ").pop(), "i").test(c.finding.source.entry)).map((c) => c.finding.source.record_id));
  const rank = (c) => QUESTION.findIndex(([k]) => c.finding.types.includes(k));
  const seen = new Set();
  const pick = doc.capsules
    .filter((c) => c.finding.year && rank(c) >= 0 && !c.finding.corroboration)
    .sort((a, b) => (own.has(b.finding.source.record_id) - own.has(a.finding.source.record_id)) || rank(a) - rank(b) || a.finding.year - b.finding.year)
    .filter((c) => { const q = questionFor(doc.mine, c.finding).text; return seen.has(q) ? false : seen.add(q); })
    .slice(0, per);
  for (const c of pick) {
    const e = c.finding;
    const q = questionFor(doc.mine, e);
    const so = await secondOpinion({ intent: "EVENT_OUTCOME_RESOLUTION_GENERAL", params: { event: q.text } }, { ask: (a) => ask({ ...a, run, unit: "goldrush-events", purpose: `goldrush:events ${doc.mine} ${e.year}` }), ranked, operatorOf: (id) => ops.get(String(id)) ?? null, strictOperators: true, maxAsks: 4, unit: "goldrush-events", fields: ["outcome"] }).catch((err) => ({ verdict: "error", answers: [], why: err.message }));
    spent += so.costUsd ?? 0;
    const said = String(so.answer?.outcome ?? "").toLowerCase();
    const status = so.verdict === "agree" ? (said === "yes" ? "corroborated (register and two independent miners)" : said === "no" ? "contradicted (two independent miners say no)" : `register only (miners agree: ${said || "unresolved"})`)
      : so.verdict === "disagree" ? "disputed (the two miners disagree)" : "register only (fewer than two usable answers)";
    const answers = (so.answers ?? []).map((a) => ({ miner: a.miner?.name ?? String(a.miner?.id), miner_id: String(a.miner?.id ?? ""), usable: !!a.usable, outcome: a.result?.outcome ?? null, signal: a.signal ?? null, why: a.why ?? null }));
    const finding = { ...e, status, corroboration: { question: q.text, kind: q.kind, at: run, verdict: so.verdict ?? null, independence: so.independence?.level ?? null, answers, cost_usd: +(so.costUsd ?? 0).toFixed(4) } };
    c.finding = finding;
    c.attestation = signDoc(finding, key);
    console.log(doc.mine.padEnd(14), e.year, q.kind.padEnd(18), status, answers.filter((a) => a.usable).map((a) => `${a.miner_id}:${a.outcome}`).join(" "));
  }
  const st = doc.capsules.map((c) => c.finding.status ?? "");
  doc.summary.checked_by_miners = doc.capsules.filter((c) => c.finding.corroboration).length;
  for (const k of ["corroborated", "contradicted", "disputed"]) doc.summary[k] = st.filter((s) => s.startsWith(k)).length;
  writeFileSync(`receipts/${f}`, JSON.stringify(doc, null, 2) + "\n");
}
console.log(`spent $${spent.toFixed(3)} test USDC`);
