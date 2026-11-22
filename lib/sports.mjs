// Dated fixtures ("Did TSG Hoffenheim win the match against FSV Mainz 05 on 2024-12-01 in the
// Bundesliga?", "Did the combined total of the Islanders and Stars game on 25 October 2026 go over
// 10.5 goals?", "Did OKC cover the -7.5 spread ... on 28 October 2026?") settled from ESPN's public
// scoreboard, by code, with no model. Wikipedia rarely has a regular-season result in prose.
//
// It refuses to guess: no date, no single game on that day naming both teams, a game that is not
// final, a finish after extra time or penalties for a result question, a push on a spread or total,
// or a question it cannot read -> null (fall through) or unresolved.

const ESPN = (path, ymd) => `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${ymd}`;
const LEAGUES = [
  [/bundesliga/i, "soccer/ger.1"], [/premier league|\bepl\b/i, "soccer/eng.1"], [/la ?liga/i, "soccer/esp.1"],
  [/serie a/i, "soccer/ita.1"], [/ligue 1/i, "soccer/fra.1"], [/eredivisie/i, "soccer/ned.1"],
  [/champions league|ucl/i, "soccer/uefa.champions"], [/europa league/i, "soccer/uefa.europa"], [/\bmls\b/i, "soccer/usa.1"],
  [/\bnba\b/i, "basketball/nba"], [/\bwnba\b/i, "basketball/wnba"], [/\bnhl\b/i, "hockey/nhl"], [/\bnfl\b/i, "football/nfl"], [/\bmlb\b/i, "baseball/mlb"],
];
const DEFAULT = ["soccer/eng.1", "soccer/ger.1", "soccer/esp.1", "soccer/ita.1", "soccer/fra.1", "basketball/nba", "hockey/nhl", "football/nfl", "baseball/mlb"];
const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const norm = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&amp;/g, "&").replace(/[^a-z0-9&.+-]+/g, " ").trim();
const has = (text, phrase) => phrase.length >= 4 && ` ${text} `.includes(` ${phrase} `);

/** The one date a question names: 2024-12-01, 25 October 2026, October 25, 2026. */
export function gameDate(q) {
  const s = String(q);
  let m = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const mo = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  const iso = (y, mi, d) => `${y}-${String(mi + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if ((m = s.match(new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+${mo}\.?,?\s+(20\d{2})\b`, "i")))) return iso(m[3], MON.indexOf(m[2].slice(0, 3).toLowerCase()), +m[1]);
  if ((m = s.match(new RegExp(String.raw`\b${mo}\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b`, "i")))) return iso(m[3], MON.indexOf(m[1].slice(0, 3).toLowerCase()), +m[2]);
  return null;
}

/** What is asked, about the first-named team: win, draw, avoid defeat, spread, total over/under. */
export function question(q) {
  const s = String(q);
  let m;
  if ((m = s.match(/cover(?:ed)? the ([+-−]?\d+(?:\.\d+)?)[- ]?(?:point )?spread/i))) return { kind: "spread", line: Number(m[1].replace("−", "-")) };
  if ((m = s.match(/(?:combined|total)[^?]*?\b(over|under)\s+(\d+(?:\.\d+)?)/i))) return { kind: "total", side: m[1].toLowerCase(), line: Number(m[2]) };
  if (/avoid defeat|not lose|unbeaten/i.test(s)) return { kind: "not_lose" };
  if (/end(?:ed)? (?:in )?a draw|\bdraw\b|\btie\b/i.test(s) && !/\bwin\b/i.test(s)) return { kind: "draw" };
  if (/\b(win|won|beat|defeat(?:ed)?)\b/i.test(s)) return { kind: "win" };
  // "What was the final score of A vs B on <date>": the answer is the score itself (in data.scores).
  if (/\b(final score|full[- ]time score|what was the score)\b/i.test(s)) return { kind: "score" };
  return null;
}

const variants = (t) => [t.displayName, t.shortDisplayName, t.name].filter(Boolean).map(norm).filter((v, i, a) => v.length >= 4 && a.indexOf(v) === i);
// A name variant matches as a phrase, or when every one of its words is in the question ("Celta
// Vigo" in "RC Celta de Vigo"); club prefixes like FC, CF, RC are not needed.
const GENERIC = new Set(["fc", "cf", "rc", "sc", "ac", "afc", "cd", "ud", "sd", "de", "the", "club"]);
const at = (text, v) => {
  if (has(text, v)) return ` ${text} `.indexOf(` ${v} `);
  const words = v.split(" ").filter((w) => !GENERIC.has(w));
  if (words.length < 2 || words.some((w) => w.length < 3)) return Infinity;
  const pos = words.map((w) => ` ${text} `.indexOf(` ${w} `));
  return pos.every((p) => p >= 0) ? Math.min(...pos) : Infinity;
};
const where = (text, team) => Math.min(...variants(team).map((v) => at(text, v)));

export async function readDay(path, ymd, { fetchImpl = fetch } = {}) {
  const j = await fetchImpl(ESPN(path, ymd), { signal: AbortSignal.timeout(12_000) }).then((r) => { if (!r.ok) throw new Error(`ESPN ${r.status}`); return r.json(); });
  return (j.events ?? []).map((e) => ({ path, e }));
}

export async function sports(event, { fetchImpl = fetch, now = new Date() } = {}) {
  const q = String(event ?? "");
  const date = gameDate(q), ask = question(q);
  if (!date || !ask) return null;
  if (/esports?|counter-strike|dota|valorant|league of legends/i.test(q)) return null;
  const text = norm(q);
  const paths = LEAGUES.filter(([re]) => re.test(q)).map(([, p]) => p);
  const ymd = date.replace(/-/g, "");
  const days = (await Promise.all((paths.length ? paths : DEFAULT).map((p) => readDay(p, ymd, { fetchImpl }).catch(() => [])))).flat();
  // Exactly one game that day naming both teams.
  const games = days.map(({ path, e }) => {
    const c = e.competitions?.[0];
    const teams = (c?.competitors ?? []).map((x) => ({ team: x.team, score: Number(x.score), at: where(text, x.team), home: x.homeAway === "home" }));
    return { path, e, c, teams };
  }).filter((g) => g.teams.length === 2 && g.teams.every((t) => Number.isFinite(t.at)));
  const RULE = "ESPN's public scoreboard for the named date, read by code, no model: one game naming both teams, final, no push";
  const unres = (why, sources = []) => ({ event: q, outcome: "unresolved", resolved_yes: false, winner: null, resolved_at: null, sources, evidence: null, confidence: "none", resolution_rule: RULE, note: why });
  if (!games.length) return null; // not a game ESPN lists that day: let other sources try
  if (games.length > 1) return unres("more than one game that day names both teams");
  const g = games[0];
  const st = g.e.status?.type ?? {};
  const url = g.e.links?.find((l) => /summary|gamecast|match/i.test(l.href ?? ""))?.href ?? g.e.links?.[0]?.href ?? ESPN(g.path, ymd);
  if (!st.completed) return unres(`game not final (${st.description ?? st.name ?? "status unknown"})`, [url]);
  const [a, b] = [...g.teams].sort((x, y) => x.at - y.at); // a: the team the question names first
  if (!Number.isFinite(a.score) || !Number.isFinite(b.score)) return unres("no final score listed", [url]);
  const extra = /AET|pen/i.test(st.shortDetail ?? "") || /AET|PEN/.test(st.name ?? "");
  const score = `${a.team.displayName} ${a.score}, ${b.team.displayName} ${b.score}`;
  const evidence = `ESPN scoreboard, ${date}: ${score} (${st.description ?? st.name}${st.shortDetail && st.shortDetail !== st.description ? `, ${st.shortDetail}` : ""}).`;
  const winner = a.score === b.score ? null : (a.score > b.score ? a : b).team.displayName;
  // Home and away with numeric scores, for apps that compare scores themselves (Gainsay's Evidence shape).
  const side = (t) => ({ team: t.team.displayName, score: t.score });
  const home = g.teams.find((t) => t.home) ?? b, away = g.teams.find((t) => !t.home) ?? a;
  const scores = { home: side(home), away: side(away), finished: true, status: st.name ?? null, detail: st.shortDetail ?? null, kickoff: g.e.date ?? null, date };
  let yes;
  if (ask.kind === "score") {
    // The question is the score: "yes" means the game is final and its score is reported (after extra
    // time or penalties too; the detail says which).
    return { event: q, outcome: "yes", resolved_yes: true, winner, resolved_at: g.e.date ?? date, sources: [url], evidence, confidence: "high", resolution_rule: RULE, note: "final score reported in data.scores", data: { league: g.path, game: g.e.id, ask, scores } };
  }
  if (ask.kind === "total") {
    const sum = a.score + b.score;
    if (sum === ask.line) return unres(`total ${sum} equals the line ${ask.line} (a push)`, [url]);
    yes = ask.side === "over" ? sum > ask.line : sum < ask.line;
  } else if (ask.kind === "spread") {
    const m = a.score + ask.line - b.score;
    if (m === 0) return unres(`${a.team.displayName} ${ask.line} against a ${a.score - b.score} margin is a push`, [url]);
    yes = m > 0;
  } else {
    // A result after extra time or a shootout: "win" may mean in regulation. Not taken.
    if (extra && g.path.startsWith("soccer/")) return unres(`decided after extra time or penalties (${st.shortDetail ?? st.name})`, [url]);
    yes = ask.kind === "win" ? a.score > b.score : ask.kind === "draw" ? a.score === b.score : a.score >= b.score;
  }
  return { event: q, outcome: yes ? "yes" : "no", resolved_yes: yes, winner, resolved_at: g.e.date ?? date, sources: [url], evidence, confidence: "high", resolution_rule: RULE, note: null, data: { league: g.path, game: g.e.id, ask, scores } };
}
