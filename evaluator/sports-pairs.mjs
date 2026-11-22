// Evaluation material for GAME_RESULT_GENERAL and SPORTS_SCORE_GENERAL, from games two independent
// sources agree on: ESPN's scoreboard (read by lib/sports.mjs) and openfootball's league JSON
// (receipts/sports-check.json, 100 of 100 matched). A game is used only when both give the same score.
//
//   node evaluator/sports-pairs.mjs   -> evaluator/data/game-result.jsonl, evaluator/data/sports-score.jsonl
//
// The better answer is the full, correct record in the intent's own fields. The worse answer has
// exactly one error a judge can see from the question and the answer alone, with no outside knowledge:
// a winner that contradicts the score, the wrong date, the wrong opponent, a missing score,
// an impossible value, or a finished game reported as not played.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const dir = new URL("./data/", import.meta.url);
const rows = JSON.parse(readFileSync(new URL("../receipts/sports-check.json", import.meta.url), "utf8")).rows;
const RE = /^ESPN scoreboard, (\d{4}-\d{2}-\d{2}): (.+) (\d+), (.+) (\d+) \(/;
const SOURCE = "https://github.com/openfootball/football.json (2024-25), cross-checked against ESPN's scoreboard";

const games = [];
for (const r of rows) {
  const m = RE.exec(r.evidence ?? "");
  if (!m || !r.right) continue;
  const g = { league: r.league, date: m[1], home: m[2], hs: Number(m[3]), away: m[4], as: Number(m[5]) };
  if (`${g.hs}-${g.as}` !== r.score) continue; // the two sources must give the same score
  games.push(g);
}
// A different real opponent from the same league, for the wrong-fixture error.
const other = (g, i) => games.filter((x) => x.league === g.league && x.away !== g.away && x.home !== g.away && x.away !== g.home)[i % 5]?.away;
const dayBefore = (d) => new Date(Date.parse(d) - 86_400_000).toISOString().slice(0, 10);
const winner = (g) => (g.hs > g.as ? g.home : g.as > g.hs ? g.away : "draw");
const J = (o) => JSON.stringify(o);

const gameResult = [], sportsScore = [];
games.forEach((g, i) => {
  // GAME_RESULT_GENERAL: winner, teams, final score, date.
  const right = { winner: winner(g), home_team: g.home, away_team: g.away, home_score: g.hs, away_score: g.as, date: g.date, status: "final", source: "ESPN scoreboard; openfootball" };
  const errors = [
    ["winner contradicts the score", { ...right, winner: g.hs >= g.as ? g.away : g.home }],
    ["wrong date", { ...right, date: dayBefore(g.date) }],
    ["wrong opponent", { ...right, away_team: other(g, i) ?? "Unknown FC" }],
    ["missing away score", (({ away_score, ...x }) => x)(right)],
    ["impossible score", { ...right, home_score: -1 }],
    ["finished game reported as not played", { ...right, winner: null, home_score: null, away_score: null, status: "scheduled" }],
  ];
  const [why, wrong] = errors[i % errors.length];
  gameResult.push({ prompt: `Who won ${g.home} vs ${g.away} in the ${g.league} on ${g.date}, and what was the final score?`, chosen: J(right), rejected: J(wrong), source: SOURCE, note: why });

  // SPORTS_SCORE_GENERAL: teams, score, status, date (no winner field).
  const s = { home_team: g.home, away_team: g.away, home_score: g.hs, away_score: g.as, status: "final", date: g.date, source: "ESPN scoreboard; openfootball" };
  const serr = [
    ["finished game reported as scheduled", { ...s, home_score: null, away_score: null, status: "scheduled" }],
    ["wrong date", { ...s, date: dayBefore(g.date) }],
    ["wrong opponent", { ...s, home_team: other(g, i + 2) ?? "Unknown FC" }],
    ["missing home score", (({ home_score, ...x }) => x)(s)],
    ["fractional goals", { ...s, away_score: g.as + 0.5 }],
    ["score inside the wrong team's field", { ...s, home_score: g.as, away_score: g.hs, status: "final", note: `${g.home} ${g.hs}, ${g.away} ${g.as}` }],
  ];
  const [swhy, swrong] = serr[(i + 3) % serr.length];
  // A swap is only visible when the score is not level.
  const [w2, r2] = swhy.startsWith("score inside") && g.hs === g.as ? serr[1] : [swhy, swrong];
  sportsScore.push({ prompt: `What was the final score of ${g.home} vs ${g.away} (${g.league}, ${g.date})?`, chosen: J(s), rejected: J(r2), source: SOURCE, note: w2 });
});

mkdirSync(dir, { recursive: true });
const out = (name, list) => writeFileSync(new URL(name, dir), list.map((p) => J({ prompt: p.prompt, chosen: p.chosen, rejected: p.rejected, source: p.source })).join("\n") + "\n");
out("game-result.jsonl", gameResult);
out("sports-score.jsonl", sportsScore);
const tally = (l) => Object.entries(l.reduce((a, p) => ((a[p.note] = (a[p.note] ?? 0) + 1), a), {})).map(([k, v]) => `${k} ${v}`).join("; ");
console.log(`${games.length} games agreed by both sources`);
console.log(`game-result.jsonl ${gameResult.length} pairs: ${tally(gameResult)}`);
console.log(`sports-score.jsonl ${sportsScore.length} pairs: ${tally(sportsScore)}`);
