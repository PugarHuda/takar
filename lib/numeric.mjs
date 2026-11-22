// Price and rate questions ("Will Bitcoin reach $90000 in 2024?", "Will the S&P 500 be above
// 5000 at the end of Feb 2024?", "US unemployment above 4% in November 2023?") settled from a
// published data series (FRED), by code, with no model. Wikipedia rarely carries the number.
//
// It refuses to guess:
//   - a question it cannot parse fully (series, comparison, threshold, window) returns null,
//     and the caller falls through to its other sources;
//   - "by <date>" with no start, conditionals, "again", compound questions: not taken (null);
//   - a value within the series' margin of the threshold is unresolved (a daily close is not
//     the intraday high, and a crypto "close" is one exchange's 24h snapshot);
//   - a window that has not ended, or whose data is not published yet, is unresolved.
// Measured on 251 resolved Manifold markets it had never seen: see scripts/numeric-holdout.mjs.

const FRED_CSV = (id) => `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`;
const FRED_PAGE = (id) => `https://fred.stlouisfed.org/series/${id}`;

// margin: fraction of the threshold inside which the answer is unresolved. Oil: the series is the
// spot price, so only questions that say "spot" are taken; others may settle on futures, and in
// April 2026 Brent spot reached 138 while futures stayed under 100.
export const SERIES = [
  // Crypto: a price needs a "$", "k" or "USD" (not "8000 BTC of capacity"), and "never crossed" needs
  // 10% of room: on 5 Aug 2024 Bitcoin traded near 49k intraday but closed the day at 54k.
  { re: /\b(bitcoin|btc)\b/i, id: "CBBTCUSD", name: "Bitcoin (Coinbase, USD, daily)", margin: 0.03, missMargin: 0.1, crypto: true },
  { re: /\b(ethereum|ether|eth)\b/i, id: "CBETHUSD", name: "Ether (Coinbase, USD, daily)", margin: 0.03, missMargin: 0.1, crypto: true },
  { re: /s&p\s?500|\bspx\b/i, id: "SP500", name: "S&P 500 (daily close)", margin: 0.01 },
  { re: /\bwti\b/i, needs: /\bspot\b/i, id: "DCOILWTICO", name: "WTI crude spot (USD/bbl, daily)", margin: 0.01 },
  { re: /\bbrent\b/i, needs: /\bspot\b/i, id: "DCOILBRENTEU", name: "Brent crude spot (USD/bbl, daily)", margin: 0.01 },
  { re: /^(?!.*(natural gas|cubic|mmbtu|therm)).*(\bgas(oline)? price|\/\s?gallon|per gallon)/i, id: "GASREGW", name: "US regular gasoline, all formulations (USD/gal, weekly)", margin: 0.01 },
  { re: /\bunemployment rate\b/i, id: "UNRATE", name: "US unemployment rate (%, monthly)", margin: 0, us: true },
];

const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const day = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const mi = (s) => MON.indexOf(s.slice(0, 3).toLowerCase());

/** "$69,420", "$100K", "5000", "4%", "$4/gallon" after a comparison word, as {op, x, reach}. */
export function threshold(q) {
  const num = String.raw`\$?\s?(\d[\d,]*(?:\.\d+)?)\s?(k|m)?\b`;
  const pats = [
    [new RegExp(String.raw`${num}\s?%?\s+or\s+(?:higher|more|above|greater)`, "i"), ">="],
    [new RegExp(String.raw`(?:above|higher than|over|exceed(?:s|ing)?|greater than|at least|reach(?:es)?|hit|trade at|worth|close above)\s+${num}`, "i"), null],
    [new RegExp(String.raw`(?:below|under|lower than|less than|close below)\s+${num}`, "i"), "<"],
    [new RegExp(String.raw`^(?:will\s+)?(?:bitcoin|btc|ethereum|eth)\s+${num}\s+(?:in|by|before)\b`, "i"), ">="],
  ];
  for (const [re, fixed] of pats) {
    const m = q.match(re);
    if (!m) continue;
    const x = Number(m[1].replace(/,/g, "")) * (m[2]?.toLowerCase() === "k" ? 1e3 : m[2]?.toLowerCase() === "m" ? 1e6 : 1);
    const op = fixed ?? (/at least|reach|hit|trade at|worth/i.test(m[0]) ? ">=" : ">");
    return { op, x, reach: /reach|hit|trade at/i.test(m[0]) };
  }
  return null;
}

/** The window a question names: a single date, a month, a quarter, a year, or a deadline ("by"). */
export function window(q) {
  const s = q.replace(/(\d)(st|nd|rd|th)\b/gi, "$1");
  let m;
  if ((m = s.match(new RegExp(String.raw`\b(on|by(?: the)?(?: end of)?|before)\s+${MONTH}\.?,?\s+(\d{1,2}),?\s+(\d{4})`, "i")))) {
    const d = day(+m[4], mi(m[2]), +m[3]);
    return /^on/i.test(m[1]) ? { kind: "point", from: d, to: d } : { kind: "by", from: null, to: d };
  }
  // "before/by the end of <month year>" is a deadline, not the month's last value.
  if ((m = s.match(new RegExp(String.raw`\b(?:by|before)\s+(?:the\s+)?end of\s+${MONTH}\.?\s+(\d{4})`, "i")))) return { kind: "by", from: null, to: day(+m[2], mi(m[1]) + 1, 0) };
  if ((m = s.match(/\b(?:at|on)\s+the\s+(?:end|close)\s+of\s+(\d{4})\b/i))) return { kind: "end", from: day(+m[1], 11, 1), to: day(+m[1], 11, 31) };
  if ((m = s.match(new RegExp(String.raw`\b(?:end|close) of\s+${MONTH}\.?\s+(\d{4})`, "i")))) return { kind: "end", from: day(+m[2], mi(m[1]), 1), to: day(+m[2], mi(m[1]) + 1, 0) };
  if ((m = s.match(/\b(?:by|before)\s+(?:the\s+)?(?:end of\s+)?(\d{4})\b/i))) return { kind: "by", from: null, to: day(+m[1] - 1, 11, 31) };
  if ((m = s.match(/\bq([1-4])\s+(\d{4})\b/i))) return { kind: "range", from: day(+m[2], (m[1] - 1) * 3, 1), to: day(+m[2], m[1] * 3, 0) };
  if ((m = s.match(new RegExp(String.raw`\bin\s+${MONTH}\.?\s+(\d{4})`, "i")))) return { kind: "range", from: day(+m[2], mi(m[1]), 1), to: day(+m[2], mi(m[1]) + 1, 0) };
  if ((m = s.match(/\b(?:in|during|at any point in)\s+(\d{4})\b/i))) return { kind: "range", from: day(+m[1], 0, 1), to: day(+m[1], 11, 31) };
  return null;
}

// Fed decisions: the upper bound of the federal funds target range (FRED DFEDTARU), before and
// after the meeting a question names. A cut lowers it, a hike raises it, a hold leaves it.
const FED = { id: "DFEDTARU", name: "Federal funds target range, upper bound (%, daily)", margin: 0 };
export function fomc(question) {
  const q = String(question ?? "");
  if (!/\b(fed|federal reserve|fomc)\b/i.test(q) || /emergency|inter-?meeting|\bif\b|conditional/i.test(q)) return null;
  // One meeting only: a deadline ("by May 2025"), a span ("from May to end of 2025"), a count of cuts
  // or a statement, projection or dot plot is another question.
  if (new RegExp(String.raw`\bby\s+(the\s+)?(end\b|${MONTH}|20\d{2})`, "i").test(q)) return null; // "by May 2025", not "by 25 bps"
  if (/\b(before|until|through|from|during|any|end of|statement|indicat\w*|projection|dot plot|forecast|expect\w*|signal\w*)\b|\b\d+\s+(rate\s+)?(cuts?|hikes?)\b/i.test(q)) return null;
  const dir = /\b(cut|cuts|lower|lowers|reduce|reduces|decrease)\b/i.test(q) ? "down" : /\b(raise|raises|hike|hikes|increase|increases)\b/i.test(q) ? "up" : /\b(hold|holds|pause|pauses|unchanged|keep|keeps|leave|leaves)\b/i.test(q) ? "hold" : null;
  if (!dir) return null;
  const s = q.replace(/(\d)(st|nd|rd|th)\b/gi, "$1");
  let m, w = null;
  // A named meeting day: the decision lands on that day or the next (two-day meetings), so read
  // two days either side.
  if ((m = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/))) w = { kind: "meeting", at: `${m[1]}-${m[2]}-${m[3]}` };
  else if ((m = s.match(new RegExp(String.raw`\b${MONTH}\.?,?\s+(\d{1,2}),?\s+(20\d{2})\b`, "i")))) w = { kind: "meeting", at: day(+m[3], mi(m[1]), +m[2]) };
  else if ((m = s.match(new RegExp(String.raw`\b(\d{1,2})\s+${MONTH}\.?,?\s+(20\d{2})\b`, "i")))) w = { kind: "meeting", at: day(+m[3], mi(m[2]), +m[1]) };
  else if ((m = s.match(new RegExp(String.raw`\b${MONTH}\.?\s+(20\d{2})\b`, "i")))) w = { kind: "month", from: day(+m[2], mi(m[1]), 1), to: day(+m[2], mi(m[1]) + 1, 0) };
  if (!w) return null;
  if (w.kind === "meeting") { const t = Date.parse(w.at); w = { kind: "meeting", from: new Date(t - 2 * 864e5).toISOString().slice(0, 10), to: new Date(t + 2 * 864e5).toISOString().slice(0, 10) }; }
  const size = (m = q.match(/(\d+(?:\.\d+)?)\s*(bps|basis points?|bp)\b/i)) ? Number(m[1]) / 100 : (m = q.match(/(\d+(?:\.\d+)?)\s*(percentage points?|%)/i)) ? Number(m[1]) : null;
  return { series: FED, w, test: "fed", dir, size };
}

// Technical recession: two consecutive quarters of falling real GDP, only when the question names
// that definition. Both quarters must fall inside the window; a pair across its edge is unresolved.
const GDP = [
  { re: /\b(us|u\.s\.|united states|american|america)\b/i, id: "GDPC1", name: "US real GDP (quarterly, seasonally adjusted)", margin: 0 },
  { re: /\b(germany|german)\b/i, id: "CLVMNACSCAB1GQDE", name: "Germany real GDP (quarterly, seasonally adjusted)", margin: 0 },
];
export function recession(question) {
  const q = String(question ?? "");
  if (!/two (consecutive )?quarters|consecutive quarters|negative (gdp|economic) growth/i.test(q)) return null;
  if (/\b(forecast|expect|predict|economists|survey)\w*/i.test(q)) return null; // about beliefs, not the data
  const series = GDP.find((g) => g.re.test(q));
  if (!series) return null;
  const s = q.replace(/(\d)(st|nd|rd|th)\b/gi, "$1");
  let m, w = null;
  if ((m = s.match(/\b(?:first half|h1) (?:of )?(20\d{2})\b/i))) w = { from: day(+m[1], 0, 1), to: day(+m[1], 5, 30) };
  else if ((m = s.match(/\b(?:second half|h2) (?:of )?(20\d{2})\b/i))) w = { from: day(+m[1], 6, 1), to: day(+m[1], 11, 31) };
  else if ((m = s.match(/\b(?:in|during)\s+(20\d{2})\b/i))) w = { from: day(+m[1], 0, 1), to: day(+m[1], 11, 31) };
  if (!w || /\b(by|before|until)\b/i.test(s.replace(/\b(by|before) (the )?end of\b/gi, (x) => x))) {
    // A deadline ("by first half of 2025", "before the end of 2024") has no start: not taken.
    if (!w || /\b(by|before|until)\s+(the\s+)?(first|second|end|h[12]|20\d{2})/i.test(s)) return null;
  }
  return { series, w: { kind: "range", ...w }, test: "recession" };
}

export function parse(question) {
  const fed = fomc(question);
  if (fed) return fed;
  const gdp = recession(question);
  if (gdp) return gdp;
  const q = String(question ?? "");
  const series = SERIES.find((s) => s.re.test(q));
  if (!series || (series.needs && !series.needs.test(q))) return null;
  if (series.us && /\b(uk|britain|euro|germany|japan|canada|china|australia)\b/i.test(q)) return null;
  const plain = q.replace(/\bor (higher|more|above|greater|lower|less|below)\b/gi, "");
  // A one-day move: "increase by over 6% on any day in March 2024". Close to close, in either direction.
  const mv = q.match(/\b(increase|rise|gain|go up|jump|climb|drop|fall|decline|go down|lose)s?\s+(?:by\s+)?(over|more than|at least|above|greater than)?\s*(\d+(?:\.\d+)?)\s?%\s+(?:on|in)\s+(?:any|a single|one)\s+(?:trading\s+)?day\b/i);
  if (mv && !/\b(conditional|if|again|and|or)\b/i.test(plain.replace(mv[0], ""))) {
    const w = window(q);
    if (!w || w.kind !== "range") return null;
    return { series, w, test: "move", dir: /drop|fall|decline|go down|lose/i.test(mv[1]) ? "down" : "up", x: Number(mv[3]) / 100, op: /at least/i.test(mv[2] ?? "") ? ">=" : ">" };
  }
  // Conditionals, compound questions, "again" and other per-day wordings need context this parser does not have.
  if (/\b(conditional|if|again|and|or|per day|in one day|daily)\b/i.test(plain)) return null;
  const w = window(q);
  // A deadline with no start: a crossing may predate the question, so neither yes nor no is safe.
  if (!w || w.kind === "by") return null;
  // "Close at / reach / set a new all-time high", not "drop 25% below its all-time high".
  if (/(new|close at an?|reach an?|hit an?|set an?|make an?|record an?)\s+all[- ]time high/i.test(q) && !/%|\bbelow\b|\bdrop|\bfall/i.test(q) && w.kind === "range") return { series, w, test: "ath" };
  const t = threshold(q);
  // "Increase more than the Nasdaq" is a comparison with another series: not taken.
  if (/\b(increase|rise|go up|gain)\b/i.test(q) && !t && !/[$%]|cents?\b|\bthan\b|\bvs\.?\b|versus|outperform/i.test(q)) return { series, w, test: "up" };
  if (!t) return null;
  if (series.crypto && !/\$\s?\d|\d\s?k\b|\d\s?(usd|(?:us )?dollars?)\b/i.test(q)) return null;
  if (/\b(drop|fall|decline)s?\b.*\d\s?%|\d\s?%\+?\s*(drop|fall|decline)/i.test(q)) return null; // relative moves: base unclear
  return { series, w, test: "level", ...t };
}

// FRED refuses data-centre IPs (Vercel included), so a GitHub Action copies FRED's own CSVs into
// the repo daily (.github/workflows/series.yml). Read that copy first, FRED itself second.
export const SNAPSHOT = (id) => `https://raw.githubusercontent.com/PugarHuda/takar/main/data/series/${id}.csv`;
export async function seriesText(id, { fetchImpl = fetch } = {}) {
  const get = (url) => fetchImpl(url, { signal: AbortSignal.timeout(15_000) }).then(async (r) => { const t = r.ok ? await r.text() : ""; if (!t.startsWith("observation_date")) throw new Error(`FRED ${r.status}`); return t; });
  return get(SNAPSHOT(id)).catch(() => get(`${FRED_CSV(id)}&cosd=2000-01-01`));
}

// ponytail: whole series cached per instance for 6 h; FRED 403s a burst of ranged reads.
const seriesCache = new Map();
export async function readSeries(id, from, to, { fetchImpl = fetch } = {}) {
  let hit = seriesCache.get(id);
  if (!hit || Date.now() - hit.at > 6 * 3600_000 || fetchImpl !== hit.fetchImpl) {
    const text = await seriesText(id, { fetchImpl });
    const rows = text.trim().split("\n").slice(1).map((l) => l.split(",")).filter(([, v]) => v && v !== ".").map(([d, v]) => ({ d, v: Number(v) })).filter((o) => Number.isFinite(o.v));
    seriesCache.set(id, (hit = { at: Date.now(), rows, fetchImpl }));
  }
  return hit.rows.filter((r) => r.d >= from && r.d <= to);
}

const shift = (iso, days) => new Date(Date.parse(iso) + days * 864e5).toISOString().slice(0, 10);
const cmp = (op, v, x) => (op === "<" ? v < x : op === ">" ? v > x : v >= x);

/** Settle a parsed question from a series. Returns an answer object, or null to fall through. */
export async function numeric(question, { fetchImpl = fetch, now = new Date() } = {}) {
  const p = parse(question);
  if (!p) return null;
  const { series, w } = p;
  const id = series.id;
  const sources = [FRED_PAGE(id)];
  // `measure`: the value that decided it and how far it sat from the line, so a buyer can see a near call.
  const out = (yes, evidence, measure = null) => ({ event: question, outcome: yes ? "yes" : "no", resolved_yes: yes, winner: null, resolved_at: null, sources, evidence, confidence: "high", resolution_rule: RULE, note: null, data: { series: id, name: series.name, window: w, test: p.test, op: p.op ?? null, threshold: p.x ?? null, measure } });
  const unres = (why) => ({ event: question, outcome: "unresolved", resolved_yes: false, winner: null, resolved_at: null, sources, evidence: null, confidence: "none", resolution_rule: RULE, note: why });
  if (Date.parse(w.to) >= now.getTime() - 864e5) return unres("the window this question names has not ended yet");

  const from = w.from;
  // Read a little either side: the last value before the window (for "increase") and lag checks.
  const rows = await readSeries(id, p.test === "ath" ? "2000-01-01" : shift(from, p.test === "recession" ? -200 : -40), shift(w.to, 10), { fetchImpl });
  const inW = rows.filter((r) => r.d >= from && r.d <= w.to);
  if (!inW.length) return unres(`no ${id} values published for ${from}..${w.to}`);
  if (!rows.some((r) => r.d >= shift(w.to, p.test === "recession" ? -100 : id === "UNRATE" ? -31 : -7))) return unres(`${id} not yet published to ${w.to}`);
  const fmt = (r) => `${r.v} on ${r.d}`;

  if (p.test === "recession") {
    // Quarter-on-quarter growth for every quarter whose date falls in the window, plus the one before.
    const all = rows;
    const growth = all.slice(1).map((r, i) => ({ d: r.d, g: (r.v - all[i].v) / all[i].v }));
    const inside = growth.filter((x) => x.d >= from && x.d <= w.to);
    if (!inside.length) return unres(`no ${id} quarters published for ${from}..${w.to}`);
    const lastQ = shift(w.to, -92);
    if (!growth.some((x) => x.d >= lastQ)) return unres(`${id} not yet published for the window's last quarter`);
    const pct = (x) => `${x.d.slice(0, 7)} ${(x.g * 100).toFixed(2)}%`;
    // GDP is revised for years, often by 0.2 to 0.3 points: Germany Q2 2023 was first 0.0% and later -0.1%,
    // which flipped a resolved market. A quarter within 0.3% of zero is not settled by the current vintage.
    if (inside.some((x) => Math.abs(x.g) < 0.003)) return unres(`a quarter within 0.3% of zero (${inside.filter((x) => Math.abs(x.g) < 0.003).map(pct).join(", ")}); GDP revisions could flip it`);
    const pairs = inside.slice(1).filter((x, i) => x.g < 0 && inside[i].g < 0);
    if (pairs.length) return out(true, `${series.name}: two consecutive falling quarters inside ${from}..${w.to}: ${inside.map(pct).join(", ")}.`);
    const before = growth.filter((x) => x.d < from).at(-1);
    if (before && before.g < 0 && inside[0].g < 0) return unres(`the only two-quarter fall crosses the window's start (${pct(before)}, ${pct(inside[0])})`);
    return out(false, `${series.name}: no two consecutive falling quarters inside ${from}..${w.to}: ${inside.map(pct).join(", ")}.`);
  }
  if (p.test === "fed") {
    const before = rows.filter((r) => r.d < from).at(-1), after = inW.at(-1);
    if (!before) return unres("no target rate before the meeting to compare with");
    const ch = Math.round((after.v - before.v) * 100) / 100;
    const did = ch < 0 ? "down" : ch > 0 ? "up" : "hold";
    const yes = did === p.dir && (p.size == null || p.dir === "hold" || Math.abs(Math.abs(ch) - p.size) < 0.001);
    return out(yes, `${series.name}: ${fmt(before)} before, ${fmt(after)} after, a change of ${ch > 0 ? "+" : ""}${ch} points${p.size != null ? ` (asked about ${p.size} points)` : ""}.`);
  }
  if (p.test === "up") {
    const before = rows.filter((r) => r.d < from).at(-1), last = inW.at(-1);
    if (!before) return unres("no value before the window to compare with");
    const ch = (last.v - before.v) / before.v;
    if (Math.abs(ch) < 0.002) return unres(`change ${(ch * 100).toFixed(2)}% is too close to zero to call`);
    return out(ch > 0, `${series.name}: ${fmt(before)} (last before the window), ${fmt(last)} (last in it), ${(ch * 100).toFixed(2)}%.`);
  }
  if (p.test === "move") {
    // Each day's close against the close before it; the first day in the window uses the last close before it.
    const moves = rows.slice(1).map((r, i) => ({ d: r.d, prev: rows[i].d, m: (r.v - rows[i].v) / rows[i].v })).filter((o) => o.d >= from && o.d <= w.to);
    if (!moves.length) return unres(`no ${id} day-to-day changes for ${from}..${w.to}`);
    const best = moves.reduce((a, o) => (p.dir === "down" ? (o.m < a.m ? o : a) : o.m > a.m ? o : a));
    const size = p.dir === "down" ? -best.m : best.m;
    const pct = (x) => `${(x * 100).toFixed(2)}%`;
    // Close to close is not intraday, and a market may use another exchange's close: crypto needs 10% room
    // above and 25% below the threshold, an index 0.10 and 0.15 points.
    const [upRoom, downRoom] = series.crypto ? [p.x * 0.1, p.x * 0.25] : [0.001, 0.0015];
    const yes = size >= p.x + upRoom, no = size <= p.x - downRoom;
    const ev = `${series.name}: largest one-day ${p.dir === "down" ? "fall" : "rise"} in ${from}..${w.to} was ${pct(size)} (close ${best.prev} to close ${best.d}), against ${pct(p.x)}.`;
    if (!yes && !no) return unres(`${ev} Too close to call from daily closes.`);
    return out(yes, ev, { value: +size.toFixed(5), threshold: p.x, distance: +(size - p.x).toFixed(5), unit: "fraction" });
  }
  if (p.test === "ath") {
    const prior = rows.filter((r) => r.d < from).reduce((a, r) => (r.v > a.v ? r : a), { v: -Infinity });
    const top = inW.reduce((a, r) => (r.v > a.v ? r : a));
    if (!Number.isFinite(prior.v)) return unres("no history before the window");
    const gap = (top.v - prior.v) / prior.v;
    if (Math.abs(gap) < 0.002) return unres(`window high is within 0.2% of the prior high (closes, not intraday)`);
    return out(gap > 0, `${series.name}: highest close in ${w.from}..${w.to} was ${fmt(top)}; highest before it was ${fmt(prior)} (FRED history from ${rows[0].d}).`);
  }

  // Level against a threshold.
  const { op, x } = p;
  // A threshold far off the series' scale is a misread number ("$2.500,-" read as 2.5): fall through.
  const mid = [...inW].sort((m, n) => m.v - n.v)[inW.length >> 1].v;
  if (x < mid / 10 || x > mid * 10) return null;
  const near = (v) => series.margin > 0 && Math.abs(v - x) / x < series.margin;
  const words = op === "<" ? "below" : op === ">" ? "above" : "at or above";
  if (w.kind === "point" || w.kind === "end") {
    const r = w.kind === "point" ? inW.find((o) => o.d === w.to) : inW.at(-1);
    if (!r) return unres(`no ${id} value for ${w.to} (market closed that day?)`);
    if (near(r.v)) return unres(`${fmt(r)} is within ${series.margin * 100}% of ${x}; a daily close cannot settle that`);
    return out(cmp(op, r.v, x), `${series.name}: ${fmt(r)}, ${cmp(op, r.v, x) ? "" : "not "}${words} ${x}.`, { value: r.v, threshold: x, distance: +((r.v - x) / x).toFixed(5), unit: "fraction of the threshold" });
  }
  // Already past the threshold as the window opened ("go below 48K in 2024" with Bitcoin at 44K on
  // 1 Jan): taken literally the question is trivial, so it was likely asked later in the window, or
  // "hit $75" means falling back to it. Not taken. (Monthly and weekly windows hold too few values.)
  if (inW.length > 5 && cmp(op, inW[0].v, x)) return null;
  // Any time in the window: the extreme value in the direction asked.
  const ext = inW.reduce((a, r) => (op === "<" ? (r.v < a.v ? r : a) : r.v > a.v ? r : a));
  const hit = cmp(op, ext.v, x);
  if (!hit && series.missMargin && Math.abs(ext.v - x) / x < series.missMargin) return unres(`the ${op === "<" ? "lowest" : "highest"} daily close, ${fmt(ext)}, is within ${series.missMargin * 100}% of ${x}; an intraday move may have crossed it`);
  if (near(ext.v)) return unres(`the ${op === "<" ? "lowest" : "highest"} value, ${fmt(ext)}, is within ${series.margin * 100}% of ${x}; ${hit ? "another benchmark or exchange may not have crossed it" : "an intraday move may have crossed it"}`);
  return out(hit, `${series.name}: ${op === "<" ? "lowest" : "highest"} value in ${from}..${w.to} was ${fmt(ext)}, ${hit ? "" : "never "}${words} ${x}.`, { value: ext.v, threshold: x, distance: +((ext.v - x) / x).toFixed(5), unit: "fraction of the threshold" });
}

export const RULE = "a published data series (FRED) read by code, no model: unresolved within the series' margin of the threshold, or before the window has ended and been published";
