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

// How far two numbers may differ and still agree, by what the field measures. First match wins;
// anything unnamed gets 2%. ponytail: field-name rules; per-intent schema units if these misfire.
export const TOLERANCE = [
  [/price|usd|usdc|eur|cost|fee|amount|balance|supply|market_?cap|tvl/i, { rel: 0.005 }],
  [/temp|celsius|fahrenheit|dew/i, { abs: 1 }],
  [/wind|gust|speed/i, { rel: 0.1, abs: 1 }],
  [/prob|percent|pct|share|chance|humidity/i, { abs: 2 }],
  [/precip|rain|_mm$/i, { rel: 0.2, abs: 1 }],
  [/^(lat|lon|lng|latitude|longitude)$/i, { abs: 0.01 }],
];
const tol = (field) => TOLERANCE.find(([re]) => re.test(field ?? ""))?.[1] ?? { rel: 0.02, abs: 0.01 };

/** Do two scalar values agree? Numbers within the field's tolerance, text after normalising. */
export function same(a, b, field) {
  if (a == null || b == null) return a == b;
  if (typeof a === "number" && typeof b === "number") { const t = tol(field); return Math.abs(a - b) <= Math.max(t.abs ?? 0, (t.rel ?? 0) * Math.max(Math.abs(a), Math.abs(b))); }
  if (typeof a === "boolean" || typeof b === "boolean") return a === b;
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return norm(a) === norm(b);
}

/** Nested objects become dotted fields (four levels at most), so they are compared too. */
export function flatten(o, pre = "", out = {}) {
  for (const [k, v] of Object.entries(o ?? {})) {
    if (IGNORE.has(k.toLowerCase())) continue;
    // Nested objects are opened up; arrays (lists checked, matches, sources) stay whole and are not compared item by item.
    if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length && pre.split(".").length < 4) flatten(v, `${pre}${k}.`, out);
    else out[pre + k] = v;
  }
  return out;
}

/** Field-level comparison of two intent-shaped answers. Only fields both miners filled count. */
export function compare(rawA, rawB) {
  const a = flatten(rawA), b = flatten(rawB);
  const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].filter((k) => !IGNORE.has(k.toLowerCase()));
  const both = keys.filter((k) => a?.[k] != null && b?.[k] != null && typeof a[k] !== "object" && typeof b[k] !== "object");
  const differ = both.filter((k) => !same(a[k], b[k], k.split(".").at(-1)));
  // How far apart the two numbers were, even when within tolerance: agreement has a width.
  const spread = Object.fromEntries(both.filter((k) => typeof a[k] === "number" && typeof b[k] === "number").map((k) => [k, +Math.abs(a[k] - b[k]).toPrecision(3)]));
  return { compared: both, differ, spread, onlyOne: keys.filter((k) => (a?.[k] == null) !== (b?.[k] == null)) };
}

// Where an answer says it came from: hosts of any URL in the source fields, and named providers.
// Adopted from Gainsay (another team), which screens evidence by upstream: two miners on different
// operators that both read ESPN are two relays of one source, not two sources.
const SOURCE_KEYS = /^(source|sources|source_url|source_urls|data_source|provider|providers|attribution|origin|url|urls|evidence|references?)$/i;
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").split(".").slice(-2).join("."); } catch { return null; } };
export function upstreams(result) {
  const out = new Set();
  const take = (v) => {
    if (v == null) return;
    if (Array.isArray(v)) return v.forEach(take);
    if (typeof v === "object") return Object.values(v).forEach(take);
    const s = String(v);
    const urls = s.match(/https?:\/\/[^\s"'<>)]+/g);
    if (urls) urls.forEach((u) => { const h = host(u); if (h) out.add(h); });
    // A short bare name ("ESPN", "Polymarket", "NOAA") is a provider; prose is not.
    else if (s.length <= 40 && /^[\p{L}][\p{L}\p{N} .&-]*$/u.test(s.trim())) out.add(norm(s).split(" ")[0]);
  };
  const walk = (o, depth = 0) => {
    for (const [k, v] of Object.entries(o ?? {})) {
      if (SOURCE_KEYS.test(k)) take(v);
      else if (v && typeof v === "object" && !Array.isArray(v) && depth < 3) walk(v, depth + 1);
    }
  };
  walk(result);
  return out;
}
/**
 * How independent a pair is: by operator always (that is how the pair was chosen), and by source when
 * both say. When an answer names no source, the host its registry entry calls stands in: 21 miners on
 * different operators wrap api.coingecko.com, so two of them agreeing is one source relayed twice.
 */
export function independence(resultA, resultB, endpointA = null, endpointB = null) {
  // A miner's own server on a hosting platform says nothing about where its data comes from.
  const HOSTING = /(^|\.)(vercel\.app|workers\.dev|pages\.dev|sslip\.io|nip\.io|onrender\.com|railway\.app|up\.railway\.app|herokuapp\.com|netlify\.app|fly\.dev|duckdns\.org|github\.io|ngrok(-free)?\.(app|io|dev)|trycloudflare\.com|replit\.(app|dev)|deno\.dev|amazonaws\.com|azurewebsites\.net|run\.app|appspot\.com|localhost)$/i;
  const site = (h) => (h && !HOSTING.test(h) && !/^\d+\.\d+\.\d+\.\d+$/.test(h) ? h.replace(/^www\./, "").split(".").slice(-2).join(".") : null);
  endpointA = site(endpointA); endpointB = site(endpointB);
  const a = upstreams(resultA), b = upstreams(resultB);
  // Where each side's source came from: the answer itself, or the registry endpoint as a stand-in.
  const basis = { a: a.size ? "stated in the answer" : endpointA ? "registry endpoint" : "none", b: b.size ? "stated in the answer" : endpointB ? "registry endpoint" : "none" };
  if (!a.size && endpointA) a.add(endpointA);
  if (!b.size && endpointB) b.add(endpointB);
  const identical = fingerprint(resultA, resultB);
  const fp = identical.length ? { identical } : {};
  const shared = a.size && b.size ? [...a].filter((x) => b.has(x)) : [];
  if (shared.length) return { level: "operator, shared upstream", shared, a: [...a], b: [...b], basis, ...fp };
  // Two operators returning the same precise number (97234.18, 0.000412) almost surely read one feed,
  // whatever the registry or the answers say: rounding and timing differ between independent sources.
  if (identical.length) return { level: "operator, identical values", a: [...a], b: [...b], basis, ...fp };
  if (!a.size || !b.size) return { level: "operator", sources: "not stated by both", a: [...a], b: [...b], basis };
  return { level: "operator and source", a: [...a], b: [...b], basis };
}

/**
 * Fields where both answers carry the same precise number: at least 5 significant digits, or 3 decimals.
 * Round values (27, 0.5, 100) are excluded, since independent sources agree on those all the time.
 */
export function fingerprint(resultA, resultB) {
  const leaves = (o, p = "", out = new Map()) => {
    if (typeof o === "number" && Number.isFinite(o)) out.set(p, o);
    else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) leaves(v, p ? `${p}.${k}` : k, out);
    return out;
  };
  const precise = (n) => {
    const s = String(Math.abs(n)).replace(/e.*$/, "");
    const decimals = (s.split(".")[1] ?? "").length;
    const digits = s.replace(".", "").replace(/^0+/, "").replace(/0+$/, "").length;
    return decimals >= 3 || (digits >= 5 && decimals >= 1);
  };
  const A = leaves(resultA), B = leaves(resultB);
  return [...A].filter(([p, v]) => B.get(p) === v && precise(v)).map(([p, v]) => ({ field: p, value: v }));
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
export async function secondOpinion({ intent, params }, { ask, ranked, reputation = [], exclude = [], maxAsks = 3, unit = "second-opinion", operatorOf = () => null, upstreamOf = () => null, strictOperators = false, fields = null, escalate = false, maxUsd = 0.05, askUsd = 0.01 }) {
  const ladder = order(await ranked(intent), reputation, exclude);
  const answers = [];
  const tried = new Set();
  let cost = 0;
  // Budget checks use the worst case: every attempt, paid or failed, counts at askUsd (fails closed).
  const worst = () => Math.max(cost, tried.size * askUsd);
  const one = async (m) => {
    tried.add(m.id);
    try {
      // The payment layer refuses any price above askUsd, so every attempt costs at most askUsd.
      const r = await ask({ intent, params, minerId: m.id, unit, purpose: `second-opinion ${intent}`, maxAmount: BigInt(Math.round(askUsd * 1e6)) });
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
  // Two miners run by the same operator (same payout address) are one opinion, not two.
  const independent = () => {
    const seen = new Set();
    return answers.filter((a) => {
      if (!a.usable) return false;
      const op = operatorOf(String(a.miner?.id))?.toLowerCase();
      // Fail closed: with strictOperators, an answer whose operator cannot be established
      // (registry down, no payout address) is not counted as an independent opinion.
      // Limit: the payout address is chosen by the operator; the registry offers nothing stronger.
      if (!op && strictOperators) { a.usable = false; a.why = "operator unknown, not counted as independent"; return false; }
      if (op && seen.has(op)) { a.usable = false; a.why = "same operator as another answer"; return false; }
      if (op) seen.add(op);
      return true;
    });
  };
  // Two usable answers that share no filled field (one miner left the key field null) are not a
  // pair: the sparser one is set aside and the next miner is asked, within maxAsks.
  const filled = (a) => Object.values(flatten(a.result)).filter((v) => v != null).length;
  let ok, c;
  for (let i = 2; ; ) {
    ok = independent();
    if (ok.length >= 2) {
      c = compare(ok[0].result, ok[1].result);
      // `fields`: only these decide the verdict, and both answers must fill every one of them.
      if (fields) {
        const all = c; c = { ...all, compared: all.compared.filter((k) => fields.includes(k)), differ: all.differ.filter((k) => fields.includes(k)), other_differences: all.differ.filter((k) => !fields.includes(k)) };
        if (fields.every((f) => c.compared.includes(f))) break;
      } else if (c.compared.length) break;
      const sparse = filled(ok[0]) < filled(ok[1]) ? ok[0] : ok[1];
      sparse.usable = false; sparse.why = "no filled field in common with the other answer";
      continue;
    }
    if (i >= ladder.length || tried.size >= maxAsks || worst() + askUsd > maxUsd + 1e-9) break;
    answers.push(await one(ladder[i++]));
  }
  const base = { intent, answers, costUsd: +cost.toFixed(4), miners_considered: ladder.length };
  if (ok.length < 2) return { ...base, verdict: "insufficient", differ: [], compared: [], why: ladder.length < 2 ? "fewer than two miners serve this intent" : answers.some((a) => a.why === "no filled field in common with the other answer") ? "the usable answers share no comparable field" : "fewer than two usable answers" };
  if (c.differ.length && escalate) {
    // Adopted from Colony (another team): buy more only where two sources already disagree, capped in
    // code. A third independent opinion is reported with the side it matches on the differing fields;
    // the verdict stays "disagree" (never a vote), and the buyer sees where the extra evidence points.
    const [a, b] = ok;
    let third = null;
    for (let i = tried.size; i < ladder.length && tried.size < maxAsks && worst() + askUsd <= maxUsd + 1e-9; i++) {
      if (tried.has(ladder[i].id)) continue;
      const t = await one(ladder[i]);
      answers.push(t);
      const ops = new Set([a, b].map((x) => operatorOf(String(x.miner?.id))?.toLowerCase()).filter(Boolean));
      const op = operatorOf(String(t.miner?.id))?.toLowerCase();
      if (!t.usable || (op && ops.has(op)) || (!op && strictOperators)) { if (t.usable) { t.usable = false; t.why = "same operator as an earlier answer, or operator unknown"; } continue; }
      const sides = (x) => compare(x.result, t.result).differ.filter((k) => c.differ.includes(k)).length === 0 && c.differ.every((k) => compare(x.result, t.result).compared.includes(k));
      third = { miner: t.miner, signal: t.signal, sides_with: sides(a) ? "first" : sides(b) ? "second" : "neither" };
      break;
    }
    const cost2 = +cost.toFixed(4);
    return { ...base, costUsd: cost2, verdict: "disagree", differ: c.differ, compared: c.compared, spread: c.spread, independence: independence(a.result, b.result, upstreamOf(String(a.miner?.id)), upstreamOf(String(b.miner?.id))), escalation: third ?? { sides_with: null, why: worst() + askUsd > maxUsd + 1e-9 ? "budget reached" : tried.size >= maxAsks ? "ask limit reached" : "no third independent usable answer" } };
  }
  return c.differ.length
    ? { ...base, verdict: "disagree", differ: c.differ, compared: c.compared, spread: c.spread, independence: independence(ok[0].result, ok[1].result, upstreamOf(String(ok[0].miner?.id)), upstreamOf(String(ok[1].miner?.id))) }
    : { ...base, verdict: "agree", answer: ok[0].result, differ: [], compared: c.compared, spread: c.spread, independence: independence(ok[0].result, ok[1].result, upstreamOf(String(ok[0].miner?.id)), upstreamOf(String(ok[1].miner?.id))), ...(c.other_differences?.length ? { other_differences: c.other_differences } : {}) };
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
    // A real name only: some miners echo the outcome ("yes") as the winner.
    winner: so.answer.winner && !/^(yes|no|true|false|unresolved)$/i.test(String(so.answer.winner).trim()) ? String(so.answer.winner) : null,
    resolved_at: so.answer.resolved_at ?? null,
    sources: who.map((a) => `https://devnode.telegraphprotocol.com/engine/v1/signal/${a.signal}`),
    evidence: `Two independent Telegraph miners (${who.map((a) => a.miner?.name ?? a.miner?.id).join(" and ")}) both resolved it ${o}.`,
    // The same confidence scale as every other answer (high / medium / none); how it was reached is in note and resolution_rule.
    confidence: "medium",
    resolution_rule: rule,
    note: "quorum of two other miners",
  };
}
