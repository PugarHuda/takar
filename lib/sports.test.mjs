// Fixture resolver rules, no network.  node lib/sports.test.mjs
import assert from "node:assert/strict";
import { gameDate, question, sports } from "./sports.mjs";

assert.equal(gameDate("Did TSG Hoffenheim win the match against FSV Mainz 05 on 2024-12-01 in the Bundesliga?"), "2024-12-01");
assert.equal(gameDate("Islanders and Stars game on 25 October 2026"), "2026-10-25");
assert.equal(gameDate("on October 25th, 2026"), "2026-10-25");
assert.equal(gameDate("Who won the 2022 FIFA World Cup final?"), null);
assert.deepEqual(question("Did OKC cover the -7.5 spread in the NBA game"), { kind: "spread", line: -7.5 });
assert.deepEqual(question("did the combined total go over 0.5 goals?"), { kind: "total", side: "over", line: 0.5 });
assert.equal(question("Did Eintracht Frankfurt avoid defeat in the match").kind, "not_lose");
assert.equal(question("Did A vs B end in a draw on 2025-01-01").kind, "draw");

const team = (displayName, shortDisplayName, score, homeAway) => ({ team: { displayName, shortDisplayName, name: shortDisplayName }, score: String(score), homeAway });
const game = (id, a, b, status = { completed: true, name: "STATUS_FULL_TIME", description: "Full Time", shortDetail: "FT" }) => ({ id, date: "2024-12-01T14:30Z", status: { type: status }, links: [{ href: `https://www.espn.com/soccer/match/_/gameId/${id}` }], competitions: [{ competitors: [a, b] }] });
const DAYS = {
  "soccer/ger.1": [game("1", team("Mainz", "Mainz", 2, "home"), team("TSG Hoffenheim", "Hoffenheim", 0, "away")), game("2", team("Celta Vigo", "Celta", 1, "home"), team("Girona", "Girona", 1, "away"), { completed: true, name: "STATUS_FINAL_PEN", description: "Final", shortDetail: "FT-Pens" })],
  "hockey/nhl": [game("3", team("Dallas Stars", "Stars", 6, "home"), team("New York Islanders", "Islanders", 3, "away")), game("4", team("Utah", "Utah", 0, "home"), team("Boston Bruins", "Bruins", 0, "away"), { completed: false, name: "STATUS_SCHEDULED", description: "Scheduled" })],
  "basketball/nba": [game("5", team("Dallas Mavericks", "Mavericks", 120, "home"), team("Oklahoma City Thunder", "Thunder", 112, "away"))],
};
const fetchImpl = async (url) => ({ ok: true, json: async () => ({ events: DAYS[url.match(/sports\/(.+?)\/scoreboard/)[1]] ?? [] }) });
const ask = (q) => sports(q, { fetchImpl });

let a = await ask("Did TSG Hoffenheim win the match against FSV Mainz 05 on 2024-12-01 in the 1. Fußball-Bundesliga 2024/2025?");
assert.equal(a.outcome, "no"); assert.equal(a.winner, "Mainz"); assert.match(a.evidence, /TSG Hoffenheim 0, Mainz 2/); assert.match(a.sources[0], /gameId\/1/);
assert.equal((await ask("Did Mainz avoid defeat in the 2024-12-01 Bundesliga match against TSG Hoffenheim?")).outcome, "yes");
assert.equal((await ask("Did the combined total of the New York Islanders and Dallas Stars game on 2024-12-01 go over 10.5 goals in the NHL?")).outcome, "no");
assert.equal((await ask("Did the combined total of the New York Islanders and Dallas Stars game on 2024-12-01 go over 9 goals in the NHL?")).outcome, "unresolved", "9 on a line of 9 is a push");
assert.equal((await ask("Did Oklahoma City Thunder cover the +8 spread in the NBA game against the Dallas Mavericks on 2024-12-01?")).outcome, "unresolved", "a push");
assert.equal((await ask("Did Oklahoma City Thunder cover the +10.5 spread in the NBA game against the Dallas Mavericks on 2024-12-01?")).outcome, "yes");
assert.match((await ask("Did RC Celta de Vigo win against Girona FC on 2024-12-01 in the Bundesliga?")).note, /extra time or penalties/, "a shootout is not taken for a result");
assert.match((await ask("Did the Boston Bruins win against Utah on 2024-12-01 in the NHL?")).note, /not final/);
assert.equal(await ask("Did Bayern Munich win against Dortmund on 2024-12-01 in the Bundesliga?"), null, "no such game: fall through");
assert.equal(await ask("Who won the 2022 FIFA World Cup final?"), null);
// The score itself, structured for apps that compare scores (home and away, numeric).
assert.deepEqual(question("What was the final score of A vs B on 2025-02-09 (NFL)?"), { kind: "score" });
const sc = await ask("What was the final score of Mainz vs TSG Hoffenheim on 2024-12-01 in the Bundesliga?");
assert.equal(sc.outcome, "yes"); assert.deepEqual([sc.data.scores.home, sc.data.scores.away], [{ team: "Mainz", score: 2 }, { team: "TSG Hoffenheim", score: 0 }]);
assert.equal((await ask("Did TSG Hoffenheim win the match against FSV Mainz 05 on 2024-12-01 in the Bundesliga?")).data.scores.home.team, "Mainz", "every game answer carries the scores");
console.log("fixture resolver: 22 checks ok");
