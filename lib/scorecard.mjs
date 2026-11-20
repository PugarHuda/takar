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

/**
 * Buy the outcome through Telegraph and compare it with the market's resolution.
 * Returns { status: "confirmed" | "contradicted" | "unverified", ... }.
 */
export async function verifyOutcome(market, { ask, ranked, maxTries = 2, run }) {
  const tried = new Set();
  const attempts = [];
  for (let i = 0; i < maxTries; i++) {
    let minerId;
    if (i > 0) {
      const ladder = ranked ? await ranked("EVENT_OUTCOME_RESOLUTION_GENERAL").catch(() => []) : [];
      minerId = ladder.find((m) => !tried.has(String(m.id)))?.id;
      if (!minerId) break;
      tried.add(String(minerId));
    }
    try {
      const r = await ask({ intent: "EVENT_OUTCOME_RESOLUTION_GENERAL", params: { event: market.question }, minerId, unit: "scorecard", run, purpose: `mission13:verify ${market.id}` });
      if (r.ledger?.miner) tried.add(String(r.ledger.miner.id));
      const out = r.result_shape === "intent" ? r.result?.outcome : null;
      attempts.push({ miner: r.ledger?.miner ?? null, outcome: out ?? "unreadable", signal: r.signal_hash ?? null, tx: r.ledger?.settlementTx ?? null });
      if (out === "yes" || out === "no") {
        const marketSays = market.resolution === "YES" ? "yes" : "no";
        return { status: out === marketSays ? "confirmed" : "contradicted", telegraph: out, attempts };
      }
    } catch (err) {
      attempts.push({ miner: null, outcome: "error", error: String(err.message).slice(0, 140) });
    }
  }
  return { status: "unverified", telegraph: null, attempts };
}

/** Score confirmed forecasts only; contradictions and gaps are reported, not scored. */
export function summarise(rows) {
  const scored = rows.filter((r) => r.verification.status === "confirmed" && r.forecast);
  const mean = (xs) => (xs.length ? +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(4) : null);
  return {
    forecasts: rows.length,
    scored: scored.length,
    contradicted: rows.filter((r) => r.verification.status === "contradicted").length,
    unverified: rows.filter((r) => r.verification.status === "unverified").length,
    brier: mean(scored.map((r) => r.brier)),
    // Second check, reported beside the score: how many confirmed outcomes a fact-checker agreed with.
    corroborated: rows.filter((r) => r.corroboration?.verdict === "agrees").length,
    fact_check_disagreed: rows.filter((r) => r.corroboration?.verdict === "disagrees").length,
    // Always saying 50% scores 0.25: anything lower is skill.
    baseline: 0.25,
  };
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
