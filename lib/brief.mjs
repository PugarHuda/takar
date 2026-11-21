// Takar Brief: a country note priced per fact (Telegraph Season II, Mission 05
// Conflict Intelligence, route 3 "research priced per fact").
//
// An analyst's note is a list of claims. Each one is either an observation (it
// names a period that has ended) or a forecast (it does not). Observations are
// bought through Telegraph from independent checks:
//   - EVENT_OUTCOME_RESOLUTION from Takar Outcome, asked by id
//   - EVENT_OUTCOME_RESOLUTION from whoever the ranking routes to
//   - FACT_CHECK on the claim stated as a sentence
// and every check's answer, price and receipt sits next to the claim. Forecasts
// are listed and never bought: there is nothing to check yet.
//
// Checks are never averaged. A claim stands only when every check that gave a
// yes/no agrees; when they disagree the claim is "disputed" and both sides show.
// The escalation tally counts confirmed events only, and lists disputed ones apart.
//
// `ask` is injected so the rules are testable offline.
import { notYetDecidable } from "./outcome.mjs";
import { verdictOf, TAKAR_OUTCOME_ID } from "./scorecard.mjs";

export const KINDS = ["escalation", "de-escalation", "context"];

/** "observation" when the claim's period has ended, else "forecast". */
export function classify(item, now = new Date()) {
  if (/^\s*will\b/i.test(item.question) || notYetDecidable(item.question, now)) return "forecast";
  return "observation";
}

/**
 * Combine the checks on one claim. Each check reads "yes" (the claim holds),
 * "no" (it does not) or null (no usable answer).
 *   confirmed      two or more checks say yes, none says no
 *   contradicted   two or more checks say no, none says yes
 *   single-source  exactly one check gave a yes or no: reported, not counted
 *   disputed       yes and no both present
 *   unsupported    no check gave a yes or no
 * One check is not certainty: a contested claim that a single fact-checker agrees
 * with is the unsupported certainty a risk desk must not act on.
 */
export function claimStatus(checks) {
  const said = checks.map((c) => c.reads).filter((r) => r === "yes" || r === "no");
  const yes = said.filter((r) => r === "yes").length;
  const no = said.length - yes;
  const status = !said.length ? "unsupported" : yes && no ? "disputed" : said.length < 2 ? "single-source" : yes ? "confirmed" : "contradicted";
  return { status, yes, no, checked: checks.length };
}

/** Buy the checks for one observation. Every ask, failed or not, is listed with its cost. */
export async function checkClaim(item, { ask, run }) {
  const checks = [];
  const tried = new Set();
  const outcome = async (minerId) => {
    try {
      const r = await ask({ intent: "EVENT_OUTCOME_RESOLUTION_GENERAL", params: { event: item.question }, minerId, unit: "brief-m05", run, purpose: `mission05:${item.id}` });
      const miner = r.ledger?.miner ?? (minerId ? { id: String(minerId) } : null);
      // The route may land on the miner already asked: it is paid, so it is listed
      // and costed, but one miner is one vote.
      const duplicate = Boolean(miner && tried.has(String(miner.id)));
      if (miner) tried.add(String(miner.id));
      const o = r.result_shape === "intent" ? r.result?.outcome : null;
      checks.push({ via: "EVENT_OUTCOME_RESOLUTION", miner, duplicate, reads: !duplicate && (o === "yes" || o === "no") ? o : null, answer: o ?? "unreadable", evidence: r.result?.evidence ?? null, sources: r.result?.sources ?? null, signal: r.signal_hash ?? null, costUsd: Number(r.ledger?.paidMicroUsdc ?? 0) / 1e6 });
    } catch (err) {
      checks.push({ via: "EVENT_OUTCOME_RESOLUTION", miner: minerId ? { id: String(minerId) } : null, reads: null, answer: "error", error: String(err.message).slice(0, 140), costUsd: 0 });
    }
  };
  await outcome(TAKAR_OUTCOME_ID);
  await outcome(undefined);
  try {
    const r = await ask({ intent: "FACT_CHECK_GENERAL", params: { claim: item.claim }, unit: "brief-m05", run, purpose: `mission05:${item.id}:fact-check` });
    const v = r.result_shape === "intent" ? verdictOf(r.result) : "unreadable";
    checks.push({ via: "FACT_CHECK", miner: r.ledger?.miner ?? null, reads: v === "agrees" ? "yes" : v === "disagrees" ? "no" : null, answer: v, evidence: r.result?.answer ?? r.result?.verdict ?? null, signal: r.signal_hash ?? null, costUsd: Number(r.ledger?.paidMicroUsdc ?? 0) / 1e6 });
  } catch (err) {
    checks.push({ via: "FACT_CHECK", miner: null, reads: null, answer: "error", error: String(err.message).slice(0, 140), costUsd: 0 });
  }
  const cost = +checks.reduce((s, c) => s + (c.costUsd || 0), 0).toFixed(4);
  return { ...claimStatus(checks), checks, costUsd: cost };
}

/**
 * The note's summary. The escalation tally counts confirmed claims only;
 * disputed and unsupported ones are listed, never folded into the number.
 */
export function summarise(rows) {
  const obs = rows.filter((r) => r.type === "observation");
  const by = (k) => obs.filter((r) => r.result.status === k);
  const confirmed = by("confirmed");
  const count = (kind) => confirmed.filter((r) => r.kind === kind).length;
  const cost = +obs.reduce((s, r) => s + r.result.costUsd, 0).toFixed(4);
  return {
    claims: rows.length,
    observations: obs.length,
    forecasts: rows.length - obs.length,
    confirmed: confirmed.length,
    contradicted: by("contradicted").length,
    disputed: by("disputed").length,
    unsupported: by("unsupported").length,
    single_source: by("single-source").length,
    escalation: { confirmed_escalations: count("escalation"), confirmed_de_escalations: count("de-escalation"), net: count("escalation") - count("de-escalation"), disputed: by("disputed").map((r) => r.id), single_source: by("single-source").map((r) => r.id) },
    cost_usd: cost,
    cost_per_settled_claim_usd: confirmed.length + by("contradicted").length ? +(cost / (confirmed.length + by("contradicted").length)).toFixed(4) : null,
  };
}
