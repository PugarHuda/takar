// Takar Second Opinion: one call, any Telegraph intent, two independent miners.
//
// Every team on Telegraph ends up writing its own cross-check, because the ranked
// route can send a question to the wrong specialist or return a confidently wrong
// answer. This does it once, for any intent:
//   1. order the intent's miners by the open on-chain record of who was right
//      (EAS, lib/reputation.mjs), falling back to the node's own rank;
//   2. ask the top two DIFFERENT miners directly, by id (a third if one is unusable);
//   3. compare their answers field by field and say agree / disagree / insufficient.
// It never averages and never picks a side: a disagreement comes back as both
// answers with the fields that differ.
//
// `ask`, `ranked` and `reputation` are injected so the rules are testable offline.

// Fields that describe the answer rather than state it: never compared.
const IGNORE = new Set(["sources", "source", "evidence", "note", "checked_at", "as_of", "asof", "timestamp", "fetched_at", "resolver", "cached", "confidence", "resolution_rule", "url", "urls", "raw", "provider", "miner", "id", "request_id"]);
const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}.]+/gu, " ").trim();

/** Do two scalar values agree? Numbers within 2% (or 0.01 absolute), text after normalising. */
export function same(a, b) {
  if (a == null || b == null) return a == b;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= Math.max(0.01, 0.02 * Math.max(Math.abs(a), Math.abs(b)));
  if (typeof a === "boolean" || typeof b === "boolean") return a === b;
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return norm(a) === norm(b);
}

/** Field-level comparison of two intent-shaped answers. Only fields both miners filled count. */
export function compare(a, b) {
  const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].filter((k) => !IGNORE.has(k.toLowerCase()));
  const both = keys.filter((k) => a?.[k] != null && b?.[k] != null && typeof a[k] !== "object" && typeof b[k] !== "object");
  const differ = both.filter((k) => !same(a[k], b[k]));
  return { compared: both, differ, onlyOne: keys.filter((k) => (a?.[k] == null) !== (b?.[k] == null)) };
}

/** Miners for an intent, best first: on-chain record (Wilson score) ahead of the node's rank. */
export function order(nodeRanked, reputation = [], exclude = []) {
  const skip = new Set(exclude.map(String));
  const score = new Map(reputation.filter((r) => r.answered > 0).map((r) => [String(r.minerId), r.score]));
  return nodeRanked
    .filter((m) => m?.id != null && !skip.has(String(m.id)))
    .map((m, i) => ({ ...m, id: String(m.id), onchain: score.has(String(m.id)) ? score.get(String(m.id)) : null, i }))
    .sort((a, b) => (b.onchain ?? -1) - (a.onchain ?? -1) || a.i - b.i);
}

/**
 * Ask two different miners and compare. Returns
 *   { verdict: "agree" | "disagree" | "insufficient", answer?, answers[], differ[], compared[], costUsd }
 */
export async function secondOpinion({ intent, params }, { ask, ranked, reputation = [], exclude = [], maxAsks = 3, unit = "second-opinion" }) {
  const ladder = order(await ranked(intent), reputation, exclude);
  const answers = [];
  const tried = new Set();
  let cost = 0;
  const one = async (m) => {
    tried.add(m.id);
    try {
      const r = await ask({ intent, params, minerId: m.id, unit, purpose: `second-opinion ${intent}` });
      cost += Number(r.ledger?.paidMicroUsdc ?? 0) / 1e6;
      const who = r.ledger?.miner ?? { id: m.id };
      // The node must have answered from the miner we asked; anything else is not this miner's opinion.
      if (String(who.id) !== m.id) return { miner: who, usable: false, why: `answered by ${who.id}, not ${m.id}` };
      const shaped = r.result_shape === "intent" && r.result && Object.values(r.result).some((v) => v != null);
      // "unresolved" / "unknown" is an honest abstention, not an opinion: it does not count
      // toward the pair, and the next miner is asked instead.
      const abstains = shaped && ["outcome", "status", "verdict"].some((k) => /^(unresolved|unknown|undetermined|n\/a)$/i.test(String(r.result[k] ?? "")));
      const usable = shaped && !abstains;
      return { miner: who, usable, why: usable ? null : abstains ? "abstained (unresolved)" : "no usable answer in the intent's shape", result: shaped ? r.result : null, signal: r.signal_hash ?? null };
    } catch (err) {
      return { miner: { id: m.id, name: m.slug }, usable: false, why: String(err.message).slice(0, 140) };
    }
  };
  // Two at once (latency matters to the caller), then one more if either was unusable.
  answers.push(...(await Promise.all(ladder.slice(0, 2).map(one))));
  for (const m of ladder.slice(2)) {
    if (answers.filter((a) => a.usable).length >= 2 || tried.size >= maxAsks) break;
    answers.push(await one(m));
  }
  const ok = answers.filter((a) => a.usable);
  const base = { intent, answers, costUsd: +cost.toFixed(4), miners_considered: ladder.length };
  if (ok.length < 2) return { ...base, verdict: "insufficient", differ: [], compared: [], why: ladder.length < 2 ? "fewer than two miners serve this intent" : "fewer than two usable answers" };
  const c = compare(ok[0].result, ok[1].result);
  if (!c.compared.length) return { ...base, verdict: "insufficient", differ: [], compared: [], why: "the two answers share no comparable field" };
  return c.differ.length
    ? { ...base, verdict: "disagree", differ: c.differ, compared: c.compared }
    : { ...base, verdict: "agree", answer: ok[0].result, differ: [], compared: c.compared };
}

/**
 * The meta-miner step: when Takar Outcome's own sources leave an event unresolved,
 * ask two OTHER miners and answer only if they agree on yes or no. Never asks
 * Takar Outcome itself (no loops), never runs for an event whose period has not ended.
 */
export function quorumAnswer(event, so, rule) {
  if (so.verdict !== "agree") return null;
  const o = String(so.answer?.outcome ?? "").toLowerCase();
  if (o !== "yes" && o !== "no") return null;
  const who = so.answers.filter((a) => a.usable).slice(0, 2);
  return {
    event,
    outcome: o,
    resolved_yes: o === "yes",
    winner: so.answer.winner ?? null,
    resolved_at: so.answer.resolved_at ?? null,
    sources: who.map((a) => `https://devnode.telegraphprotocol.com/engine/v1/signal/${a.signal}`),
    evidence: `Two independent Telegraph miners (${who.map((a) => a.miner?.name ?? a.miner?.id).join(" and ")}) both resolved it ${o}.`,
    confidence: "quorum",
    resolution_rule: rule,
    note: "quorum of two other miners",
  };
}
