// Takar Scorecard: forecast accountability, scored by machines (Telegraph
// Season II, Mission 13 Asset Management).
//
// A forecast is what a public crowd (Manifold prediction markets) said a fixed
// number of days before an event resolved: the probability is read from the
// market's own bet history, so the timestamp is public and not ours. The
// outcome is then bought through Telegraph (EVENT_OUTCOME_RESOLUTION_GENERAL)
// and held against the market's own resolution. Only forecasts whose outcome a
// Telegraph answer confirmed are scored; the rest are listed, never dropped.
//
// fetch and ask are injected so the scoring rules are testable offline.

const MANIFOLD = "https://api.manifold.markets/v0";
const UA = { headers: { "User-Agent": "takar-scorecard/0.1 (+https://github.com/PugarHuda/takar)" } };

export const brier = (p, happened) => (p - (happened ? 1 : 0)) ** 2;

/** Resolved binary markets on a topic, most traded first. */
export async function resolvedMarkets(term, { fetchImpl = fetch, minTraders = 100, limit = 5, since = 0 } = {}) {
  const url = `${MANIFOLD}/search-markets?term=${encodeURIComponent(term)}&filter=resolved&sort=most-popular&contractType=BINARY&limit=${limit * 3}`;
  const ms = await (await fetchImpl(url, UA)).json();
  return ms
    .filter((m) => ["YES", "NO"].includes(m.resolution) && m.uniqueBettorCount >= minTraders && m.resolutionTime >= since)
    .slice(0, limit)
    .map((m) => ({ id: m.id, question: m.question, url: m.url, resolution: m.resolution, resolvedAt: m.resolutionTime, traders: m.uniqueBettorCount, topic: term }));
}

/** The crowd's probability `days` before resolution, from the last bet before then. */
export async function forecastAt(market, { days = 7, fetchImpl = fetch } = {}) {
  const at = market.resolvedAt - days * 86_400_000;
  const bets = await (await fetchImpl(`${MANIFOLD}/bets?contractId=${market.id}&beforeTime=${at}&limit=1`, UA)).json();
  const b = bets?.[0];
  if (!b || typeof b.probAfter !== "number") return null;
  return { p: +b.probAfter.toFixed(4), asOf: new Date(b.createdTime).toISOString(), betId: b.id, daysBefore: days };
}

// Takar's own EVENT_OUTCOME miner. Asked directly next to the ranked route, so each
// outcome rests on two miners and our miner's answers are graded like any other's.
export const TAKAR_OUTCOME_ID = "20261117";

/**
 * Buy the outcome through Telegraph from several miners and compare each answer
 * with the market's resolution. `miners` lists miner ids to ask; null means the
 * node's ranked route. If no miner gives a yes/no, the next-ranked untried miner
 * is asked once. Status:
 *   confirmed     every readable answer matches the market
 *   contradicted  every readable answer differs from it
 *   split         the miners disagree with each other (listed, not scored)
 *   unverified    no miner gave a yes or no
 */
export async function verifyOutcome(market, { ask, ranked, miners = [TAKAR_OUTCOME_ID, null], run }) {
  const tried = new Set();
  const attempts = [];
  const marketSays = market.resolution === "YES" ? "yes" : "no";
  const once = async (minerId) => {
    if (minerId) tried.add(String(minerId));
    try {
      const r = await ask({ intent: "EVENT_OUTCOME_RESOLUTION_GENERAL", params: { event: market.question }, minerId: minerId ?? undefined, unit: "scorecard", run, purpose: `mission13:verify ${market.id}` });
      const miner = r.ledger?.miner ?? (minerId ? { id: String(minerId) } : null);
      // The route may land on a miner already asked: one miner counts once.
      if (!minerId && miner && tried.has(String(miner.id))) return;
      if (miner) tried.add(String(miner.id));
      const out = r.result_shape === "intent" ? r.result?.outcome : null;
      attempts.push({ miner, outcome: out ?? "unreadable", signal: r.signal_hash ?? null, tx: r.ledger?.settlementTx ?? null });
    } catch (err) {
      attempts.push({ miner: minerId ? { id: String(minerId) } : null, outcome: "error", error: String(err.message).slice(0, 140) });
    }
  };
  for (const m of miners) await once(m);
  const readable = () => attempts.filter((a) => a.outcome === "yes" || a.outcome === "no");
  if (!readable().length && ranked) {
    const ladder = await ranked("EVENT_OUTCOME_RESOLUTION_GENERAL").catch(() => []);
    const next = ladder.find((m) => !tried.has(String(m.id)));
    if (next) await once(next.id);
  }
  const yn = readable();
  if (!yn.length) return { status: "unverified", telegraph: null, agreeing: 0, attempts };
  const agree = yn.filter((a) => a.outcome === marketSays).length;
  const status = agree === yn.length ? "confirmed" : agree === 0 ? "contradicted" : "split";
  return { status, telegraph: status === "split" ? null : yn[0].outcome, agreeing: agree, answered: yn.length, attempts };
}

/** Score confirmed forecasts only; contradictions, splits and gaps are reported, not scored. */
export function summarise(rows) {
  const scored = rows.filter((r) => r.verification.status === "confirmed" && r.forecast);
  const mean = (xs) => (xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4) : null);
  const b = mean(scored.map((r) => r.brier));
  const happened = (r) => r.market.resolution === "YES";
  return {
    forecasts: rows.length,
    scored: scored.length,
    contradicted: rows.filter((r) => r.verification.status === "contradicted").length,
    split: rows.filter((r) => r.verification.status === "split").length,
    unverified: rows.filter((r) => r.verification.status === "unverified").length,
    confirmed_by_two_or_more: scored.filter((r) => (r.verification.agreeing ?? 1) >= 2).length,
    brier: b,
    // Always saying 50% scores 0.25: anything lower is skill.
    baseline: 0.25,
    // 1 is perfect, 0 is no better than always saying 50%, below 0 is worse.
    brier_skill: b === null ? null : +(1 - b / 0.25).toFixed(4),
    // Mean log loss (natural log, p clipped to [0.01, 0.99]); always saying 50% scores 0.6931.
    log_loss: scored.length ? mean(scored.map((r) => logLoss(r.forecast.p, happened(r)))) : null,
    calibration: calibration(scored.map((r) => ({ p: r.forecast.p, y: happened(r) }))),
    // Second check, reported beside the score: how many confirmed outcomes a fact-checker agreed with.
    corroborated: rows.filter((r) => r.corroboration?.verdict === "agrees").length,
    fact_check_disagreed: rows.filter((r) => r.corroboration?.verdict === "disagrees").length,
    miners: minerIndex(rows),
  };
}

export const logLoss = (p, happened) => { const q = Math.min(0.99, Math.max(0.01, p)); return -Math.log(happened ? q : 1 - q); };

/** Forecasts in five probability bins: what the crowd said against how often it happened. */
export function calibration(points, bins = 5) {
  return Array.from({ length: bins }, (_, i) => {
    const lo = i / bins, hi = (i + 1) / bins;
    const inBin = points.filter(({ p }) => p >= lo && (i === bins - 1 ? p <= hi : p < hi));
    return { bin: `${lo.toFixed(1)}-${hi.toFixed(1)}`, n: inBin.length, said: inBin.length ? +(inBin.reduce((s, x) => s + x.p, 0) / inBin.length).toFixed(3) : null, happened: inBin.length ? +(inBin.filter((x) => x.y).length / inBin.length).toFixed(3) : null };
  });
}

/**
 * Miner reliability, from the same receipts: for each miner asked, how often its
 * yes/no matched the market's own resolution. The scorecard grades the miners too.
 */
export function minerIndex(rows) {
  const by = new Map();
  for (const r of rows) {
    const says = r.market.resolution === "YES" ? "yes" : "no";
    for (const a of r.verification.attempts ?? []) {
      const id = a.miner?.name ?? a.miner?.id ?? "unknown";
      const m = by.get(id) ?? { miner: id, asked: 0, right: 0, wrong: 0, no_answer: 0 };
      m.asked++;
      if (a.outcome === says) m.right++;
      else if (a.outcome === "yes" || a.outcome === "no") m.wrong++;
      else m.no_answer++;
      by.set(id, m);
    }
  }
  return [...by.values()].map((m) => ({ ...m, accuracy: m.right + m.wrong ? +(m.right / (m.right + m.wrong)).toFixed(3) : null })).sort((a, b) => b.right - a.right || a.wrong - b.wrong);
}

/**
 * A fact-checker's verdict, reduced to agree / disagree / unclear. Miners phrase
 * it as a `verdict` field or as the first word of `answer` ("False. The claim…").
 */
export function verdictOf(result) {
  const text = String(result?.verdict ?? result?.rating ?? result?.answer ?? "").trim().toLowerCase();
  if (/^(true|supported|correct|accurate|confirmed|mostly true|yes)\b/.test(text)) return "agrees";
  if (/^(false|refuted|incorrect|inaccurate|unsupported|mostly false|no)\b/.test(text)) return "disagrees";
  return "unclear";
}

/**
 * A second, independent check of a confirmed outcome through FACT_CHECK (as the
 * Mission 13 example build buys it). Informational: it never changes the score,
 * and a disagreement is reported next to the row, not hidden.
 */
export async function corroborate(market, outcome, { ask, run }) {
  const claim = `The answer to the question "${market.question}" is ${outcome}.`;
  try {
    const r = await ask({ intent: "FACT_CHECK_GENERAL", params: { claim }, unit: "scorecard", run, purpose: `mission13:corroborate ${market.id}` });
    const result = r.result_shape === "intent" ? r.result : null;
    return { claim, verdict: result ? verdictOf(result) : "unreadable", miner: r.ledger?.miner ?? null, signal: r.signal_hash ?? null };
  } catch (err) {
    return { claim, verdict: "error", error: String(err.message).slice(0, 140) };
  }
}
