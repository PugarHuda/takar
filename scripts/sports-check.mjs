// Cross-check lib/sports.mjs (ESPN) against an independent source, openfootball's league JSON.
//   node scripts/sports-check.mjs [n per league]   -> receipts/sports-check.json
// Questions are written in the node's own phrasings with team names as openfootball spells them
// (which differ from ESPN's: "Bayer 04 Leverkusen", "FSV Mainz 05"), so name matching is tested too.
import { writeFileSync } from "node:fs";
import { sports } from "../lib/sports.mjs";

const N = Number(process.argv[2] ?? 25);
const LEAGUES = [["2024-25/de.1.json", "Bundesliga"], ["2024-25/en.1.json", "Premier League"], ["2024-25/es.1.json", "La Liga"], ["2024-25/it.1.json", "Serie A"]];
const FORMS = [
  (m, l) => [`Did ${m.team1} win the match against ${m.team2} on ${m.date} in the ${l}?`, m.score.ft[0] > m.score.ft[1]],
  (m, l) => [`Did ${m.team2} avoid defeat in the ${m.date} ${l} match against ${m.team1}?`, m.score.ft[1] >= m.score.ft[0]],
  (m, l) => [`Did the combined total of the ${m.team1} and ${m.team2} game on ${m.date} go over 2.5 goals?`, m.score.ft[0] + m.score.ft[1] > 2.5],
  (m, l) => [`Did ${m.team1} vs ${m.team2} end in a draw on ${m.date} (${l})?`, m.score.ft[0] === m.score.ft[1]],
];
const rows = [];
for (const [file, league] of LEAGUES) {
  const ms = (await fetch(`https://raw.githubusercontent.com/openfootball/football.json/master/${file}`).then((r) => r.json())).matches.filter((m) => m.score?.ft);
  // A fixed spread over the season, not a random draw, so the run is repeatable.
  for (let i = 0; i < N; i++) {
    const m = ms[Math.floor((i * ms.length) / N)];
    const [q, truth] = FORMS[i % FORMS.length](m, league);
    const a = await sports(q).catch((e) => ({ outcome: "error", note: e.message }));
    const ours = a?.outcome ?? "not taken";
    rows.push({ league, question: q, openfootball: truth ? "yes" : "no", score: m.score.ft.join("-"), ours, evidence: a?.evidence ?? a?.note ?? null, right: ["yes", "no"].includes(ours) ? (ours === "yes") === truth : null });
  }
}
const ans = rows.filter((r) => r.right !== null);
const summary = { questions: rows.length, answered: ans.length, right: ans.filter((r) => r.right).length, wrong: ans.filter((r) => !r.right).length, unresolved: rows.filter((r) => r.ours === "unresolved").length, not_taken: rows.filter((r) => r.ours === "not taken").length, errors: rows.filter((r) => r.ours === "error").length };
console.log(summary);
for (const r of rows.filter((r) => r.right === false || r.ours === "not taken" || r.ours === "error")) console.log(r.ours.toUpperCase(), "|", r.question, "| openfootball", r.score, "|", r.evidence);
writeFileSync("receipts/sports-check.json", JSON.stringify({ title: "lib/sports.mjs (ESPN) against openfootball, an independent source", generated_at: new Date().toISOString(), summary, rows }, null, 2) + "\n");
