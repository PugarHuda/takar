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
  { re: /\b(bitcoin|btc)\b/i, id: "CBBTCUSD", name: "Bitcoin (Coinbase, USD, daily)", margin: 0.03 },
  { re: /\b(ethereum|ether|eth)\b/i, id: "CBETHUSD", name: "Ether (Coinbase, USD, daily)", margin: 0.03 },
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
  if ((m = s.match(new RegExp(String.raw`\bend of\s+${MONTH}\.?\s+(\d{4})`, "i")))) return { kind: "end", from: day(+m[2], mi(m[1]), 1), to: day(+m[2], mi(m[1]) + 1, 0) };
  if ((m = s.match(/\b(?:by|before)\s+(?:the\s+)?(?:end of\s+)?(\d{4})\b/i))) return { kind: "by", from: null, to: day(+m[1] - 1, 11, 31) };
  if ((m = s.match(/\bq([1-4])\s+(\d{4})\b/i))) return { kind: "range", from: day(+m[2], (m[1] - 1) * 3, 1), to: day(+m[2], m[1] * 3, 0) };
  if ((m = s.match(new RegExp(String.raw`\bin\s+${MONTH}\.?\s+(\d{4})`, "i")))) return { kind: "range", from: day(+m[2], mi(m[1]), 1), to: day(+m[2], mi(m[1]) + 1, 0) };
  if ((m = s.match(/\b(?:in|during|at any point in)\s+(\d{4})\b/i))) return { kind: "range", from: day(+m[1], 0, 1), to: day(+m[1], 11, 31) };
  return null;
}

export function parse(question) {
  const q = String(question ?? "");
  const series = SERIES.find((s) => s.re.test(q));
  if (!series || (series.needs && !series.needs.test(q))) return null;
  if (series.us && /\b(uk|britain|euro|germany|japan|canada|china|australia)\b/i.test(q)) return null;
  // Conditionals, compound questions, "again" and per-day moves need context this parser does not have.
  if (/\b(conditional|if|again|and|or|per day|in one day|daily)\b/i.test(q)) return null;
  const w = window(q);
  // A deadline with no start: a crossing may predate the question, so neither yes nor no is safe.
  if (!w || w.kind === "by") return null;
  if (/new all[- ]time high/i.test(q) && w.kind === "range") return { series, w, test: "ath" };
  const t = threshold(q);
  if (/\b(increase|rise|go up|gain)\b/i.test(q) && !t && !/[$%]|cents?\b/i.test(q)) return { series, w, test: "up" };
  if (!t) return null;
  if (/\b(drop|fall|decline)s?\b.*\d\s?%|\d\s?%\+?\s*(drop|fall|decline)/i.test(q)) return null; // relative moves: base unclear
  return { series, w, test: "level", ...t };
}

// ponytail: whole series from 2000 cached per instance for 6 h; FRED 403s a burst of ranged reads.
const seriesCache = new Map();
export async function readSeries(id, from, to, { fetchImpl = fetch } = {}) {
  let hit = seriesCache.get(id);
  if (!hit || Date.now() - hit.at > 6 * 3600_000 || fetchImpl !== hit.fetchImpl) {
    const text = await fetchImpl(`${FRED_CSV(id)}&cosd=2000-01-01`, { signal: AbortSignal.timeout(20_000) }).then((r) => { if (!r.ok) throw new Error(`FRED ${r.status}`); return r.text(); });
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
  const out = (yes, evidence) => ({ event: question, outcome: yes ? "yes" : "no", resolved_yes: yes, winner: null, resolved_at: null, sources, evidence, confidence: "high", resolution_rule: RULE, note: null, data: { series: id, name: series.name, window: w, test: p.test, op: p.op ?? null, threshold: p.x ?? null } });
  const unres = (why) => ({ event: question, outcome: "unresolved", resolved_yes: false, winner: null, resolved_at: null, sources, evidence: null, confidence: "none", resolution_rule: RULE, note: why });
  if (Date.parse(w.to) >= now.getTime() - 864e5) return unres("the window this question names has not ended yet");

  const from = w.from;
  // Read a little either side: the last value before the window (for "increase") and lag checks.
  const rows = await readSeries(id, p.test === "ath" ? "2000-01-01" : shift(from, -40), shift(w.to, 10), { fetchImpl });
  const inW = rows.filter((r) => r.d >= from && r.d <= w.to);
  if (!inW.length) return unres(`no ${id} values published for ${from}..${w.to}`);
  if (!rows.some((r) => r.d >= shift(w.to, id === "UNRATE" ? -31 : -7))) return unres(`${id} not yet published to ${w.to}`);
  const fmt = (r) => `${r.v} on ${r.d}`;

  if (p.test === "up") {
    const before = rows.filter((r) => r.d < from).at(-1), last = inW.at(-1);
    if (!before) return unres("no value before the window to compare with");
    const ch = (last.v - before.v) / before.v;
    if (Math.abs(ch) < 0.002) return unres(`change ${(ch * 100).toFixed(2)}% is too close to zero to call`);
    return out(ch > 0, `${series.name}: ${fmt(before)} (last before the window), ${fmt(last)} (last in it), ${(ch * 100).toFixed(2)}%.`);
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
    return out(cmp(op, r.v, x), `${series.name}: ${fmt(r)}, ${cmp(op, r.v, x) ? "" : "not "}${words} ${x}.`);
  }
  // "Hit $75" when it already stood past 75 as the window opened may mean falling back to it.
  if (p.reach && cmp(op, inW[0].v, x)) return null;
  // Any time in the window: the extreme value in the direction asked.
  const ext = inW.reduce((a, r) => (op === "<" ? (r.v < a.v ? r : a) : r.v > a.v ? r : a));
  const hit = cmp(op, ext.v, x);
  if (near(ext.v)) return unres(`the ${op === "<" ? "lowest" : "highest"} value, ${fmt(ext)}, is within ${series.margin * 100}% of ${x}; ${hit ? "another benchmark or exchange may not have crossed it" : "an intraday move may have crossed it"}`);
  return out(hit, `${series.name}: ${op === "<" ? "lowest" : "highest"} value in ${from}..${w.to} was ${fmt(ext)}, ${hit ? "" : "never "}${words} ${x}.`);
}

export const RULE = "a published data series (FRED) read by code, no model: unresolved within the series' margin of the threshold, or before the window has ended and been published";
