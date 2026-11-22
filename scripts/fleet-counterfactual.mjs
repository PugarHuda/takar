// What the fleet would have done with one answer per check instead of Takar's rules.
//
//   node scripts/fleet-counterfactual.mjs   -> receipts/fleet-counterfactual.json
//
// For every recorded decision (receipts/decisions.jsonl), the decision a naive unit would make: it
// takes the first routed answer that has the fields it needs, skips the second miner, the place check
// and the station check, and goes unless that one answer itself says no. Classified from the reasons
// the real decision recorded, so the comparison uses exactly what was bought.
import { readFileSync, writeFileSync } from "node:fs";

const decisions = readFileSync("receipts/decisions.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
// Reasons only Takar's rules produce: a naive unit acting on one answer would have gone anyway.
const OURS = [
  [/miners disagree/i, "a second miner disagreed"],
  [/only \d+ usable .* no go on one miner/i, "only one miner gave a usable answer"],
  [/answered for another (place|country)/i, "the answer was about another place"],
  [/no station within range: answer unconfirmed/i, "no station could confirm the answer"],
  [/station .* measures? .* (above|over|exceeds)/i, "the airport station contradicted the miner"],
];
// Reasons a naive unit would also stop on: the one answer itself said no, or there was nothing to act on.
const BOTH = /storm risk (high|severe|moderate)|rain probability .* >|recorded yesterday > |budget .* exhausted|no readable|fail closed|outside shift|exceeds shift/i;

const rows = decisions.map((d) => {
  const reasons = d.reasons ?? [];
  const all = [...reasons, ...(d.contradictions ?? [])];
  const ours = OURS.filter(([re]) => all.some((r) => re.test(r))).map(([, why]) => why);
  // When two miners disagree the real unit merges them at the riskier level, so "storm risk HIGH" and a
  // missing gust can come from the second miner. The naive unit only has the first answer: if that one
  // said LOW ("X LOW/... vs Y HIGH"), or the single usable answer was acceptable, it would have gone.
  const firstSaidGo = all.some((r) => /miners disagree: [^/]+ LOW\//i.test(r)) || (reasons.some((r) => /only \d+ usable/i.test(r)) && reasons.some((r) => /storm risk acceptable/i.test(r)));
  const both = !firstSaidGo && reasons.some((r) => BOTH.test(r));
  const naive = d.decision === "GO" ? "GO" : firstSaidGo ? "GO" : both ? d.decision : ours.length ? "GO" : d.decision;
  return { run: d.run, unit: d.unit, location: d.location, takar: d.decision, naive, why: d.decision !== naive ? ours : [], spentUsd: d.spentUsd };
});
const differ = rows.filter((r) => r.takar !== r.naive);
const summary = {
  decisions: rows.length,
  takar_go: rows.filter((r) => r.takar === "GO").length,
  naive_go: rows.filter((r) => r.naive === "GO").length,
  went_on_one_answer: differ.length,
  why: Object.entries(differ.flatMap((r) => r.why).reduce((a, w) => ((a[w] = (a[w] ?? 0) + 1), a), {})).map(([why, n]) => ({ why, n })),
};
writeFileSync("receipts/fleet-counterfactual.json", JSON.stringify({ title: "Fleet decisions with Takar's checks against one answer per check", generated_at: new Date().toISOString(), method: "A naive unit takes the first usable routed answer, skips the second miner, the place check and the station check, and goes unless that one answer says no. Classified from each decision's recorded reasons.", summary, differ, rows }, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 1));
for (const r of differ) console.log(r.run.slice(0, 16), r.unit, r.takar, "-> naive GO:", r.why.join("; "));
