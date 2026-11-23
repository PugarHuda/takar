// Three views of the Telegraph network that need Takar's data, pure functions over public inputs:
//   operatorMap      who really runs the miners: miners grouped by the fee address they pay out to,
//                    and per intent how many independent operators a buyer can actually choose from;
//   disagreementIndex how often two miners from different operators disagree, per intent, from the
//                    comparisons Takar recorded on EAS (insufficient pairs are not counted);
//   signalCheck      for any Telegraph signal hash: on the node, in Takar's paid ledger, and anchored
//                    on EAS (the Merkle root over the ledger prefix that holds it, recomputed).
import { wilson } from "./reputation.mjs";
import { merkleRoot, merkleProof, rootFromProof, ledgerLines } from "./anchor.mjs";

const intentsOf = (m) => (m.supported_intents ?? []).map((x) => (typeof x === "string" ? x : x?.intent ?? x?.name)).filter(Boolean);
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : null);

export function operatorMap(miners, { top = 12 } = {}) {
  const live = miners.filter((m) => !m.activation_status || /^active$/i.test(m.activation_status));
  const ops = new Map();
  for (const m of live) {
    const k = String(m.fee_address ?? m.wallet_address ?? "").toLowerCase() || "unknown";
    if (!ops.has(k)) ops.set(k, []);
    ops.get(k).push(m);
  }
  const operators = [...ops.entries()]
    .map(([address, ms]) => ({ address, short: short(address), miners: ms.length, share: +(ms.length / live.length).toFixed(4), intents: new Set(ms.flatMap(intentsOf)).size, sample: ms.slice(0, 5).map((m) => m.slug) }))
    .sort((a, b) => b.miners - a.miners);
  const byIntent = new Map();
  for (const m of live) for (const it of intentsOf(m)) {
    if (!byIntent.has(it)) byIntent.set(it, new Map());
    const k = String(m.fee_address ?? m.wallet_address ?? "").toLowerCase() || "unknown";
    byIntent.get(it).set(k, (byIntent.get(it).get(k) ?? 0) + 1);
  }
  const intents = [...byIntent.entries()].map(([intent, counts]) => {
    const n = [...counts.values()].reduce((a, b) => a + b, 0);
    const shares = [...counts.values()].map((c) => c / n);
    return {
      intent,
      miners: n,
      operators: counts.size,
      top_operator_share: +Math.max(...shares).toFixed(2),
      // Inverse Herfindahl: how many equal-sized operators the market is worth.
      effective_operators: +(1 / shares.reduce((a, s) => a + s * s, 0)).toFixed(1),
      // A second opinion needs two operators; one operator means no independent pair exists.
      independent_pair_possible: counts.size >= 2,
    };
  }).sort((a, b) => b.miners - a.miners);
  // Endpoints several operators call: different payout addresses, same upstream API underneath.
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; } };
  const hosts = new Map();
  for (const m of live) {
    const h = hostOf(m.base_url);
    if (!h) continue;
    if (!hosts.has(h)) hosts.set(h, { host: h, miners: 0, ops: new Set() });
    const e = hosts.get(h);
    e.miners++;
    e.ops.add(String(m.fee_address ?? m.wallet_address ?? "").toLowerCase());
  }
  const shared_endpoints = [...hosts.values()].filter((e) => e.ops.size > 1).map((e) => ({ host: e.host, miners: e.miners, operators: e.ops.size })).sort((a, b) => b.miners - a.miners);
  return {
    miners: live.length,
    operators: operators.length,
    shared_endpoints,
    top_operators: operators.slice(0, top),
    top_two_share: +(((operators[0]?.miners ?? 0) + (operators[1]?.miners ?? 0)) / Math.max(live.length, 1)).toFixed(4),
    intents,
  };
}

/** Disagreement rate per intent from the feed's verdict counts, with a 95% Wilson interval. */
export function disagreementIndex(feed) {
  const rows = Object.entries(feed?.by_intent ?? {}).map(([intent, v]) => {
    const d = v.disagree ?? 0, a = v.agree ?? 0, n = a + d;
    const lo = wilson(d, n), hi = n ? 1 - wilson(a, n) : 0;
    return { intent, compared: n, agree: a, disagree: d, insufficient: v.insufficient ?? 0, rate: n ? +(d / n).toFixed(3) : null, interval: n ? [+lo.toFixed(3), +hi.toFixed(3)] : null };
  }).sort((x, y) => y.compared - x.compared);
  const pairs = new Map();
  for (const x of feed?.disagreements ?? []) {
    const k = [...(x.miners ?? [])].sort().join(" vs ");
    pairs.set(k, (pairs.get(k) ?? 0) + 1);
  }
  return { since: feed?.since ?? null, calls: feed?.calls ?? 0, intents: rows, pairs: [...pairs.entries()].map(([pair, n]) => ({ pair, disagreements: n })).sort((a, b) => b.disagreements - a.disagreements) };
}

/**
 * A status page for the miners Takar has bought from, from its own ledger: how often each was
 * reachable (answered at all) and how often a paid answer was complete (every field ok). Statuspage
 * style, but measured by a paying client rather than reported by the operator.
 */
export function minerHealth(ledgerText, { days = 7, now = Date.now(), min = 3 } = {}) {
  const since = now - days * 86_400_000;
  const by = new Map();
  for (const l of ledgerLines(ledgerText ?? "")) {
    let r; try { r = JSON.parse(l); } catch { continue; }
    const id = r.miner?.id ?? r.minerId;
    if (!/^\d+$/.test(String(id ?? "")) || Date.parse(r.at) < since) continue; // model calls are logged too; miners only
    // A payment the buyer's side refused or could not fund says nothing about the miner.
    if (!/^paid/.test(r.status ?? "") && /payment|escrow challenge|budget|spend cap|insufficient/i.test(String(r.error ?? ""))) continue;
    if (!by.has(String(id))) by.set(String(id), { id: String(id), name: r.miner?.name ?? null, intents: new Set(), asks: 0, answered: 0, complete: 0, last: null, last_problem: null });
    const m = by.get(String(id));
    m.asks++; m.intents.add(r.intent);
    if (!m.last || r.at > m.last) m.last = r.at;
    const answered = /^paid/.test(r.status ?? "") && r.result != null;
    if (answered) m.answered++;
    // A field can be empty for a good reason (no winner when the event did not happen), so only a field
    // the miner got wrong (rejected), could not fill (unavailable), or an answer half empty or worse counts.
    const fields = Object.entries(r.fieldStatus ?? {});
    const bad = fields.filter(([, v]) => v === "rejected" || v === "unavailable");
    const empty = fields.filter(([, v]) => v === "missing");
    if (fields.length && empty.length * 2 >= fields.length) bad.push(...empty);
    if (answered && !bad.length) m.complete++;
    else m.last_problem = answered ? `${bad.map(([k, v]) => `${k} ${v}`).slice(0, 3).join(", ")}` : String(r.error ?? r.status ?? "no answer").slice(0, 80);
  }
  return [...by.values()].filter((m) => m.asks >= min).map((m) => ({
    ...m, intents: [...m.intents],
    answered_rate: +(m.answered / m.asks).toFixed(2),
    complete_rate: +(m.complete / m.asks).toFixed(2),
    // Lower bound of the 95% interval, so three lucky asks do not outrank thirty steady ones.
    complete_floor: +wilson(m.complete, m.asks).toFixed(2),
  })).sort((a, b) => b.complete_floor - a.complete_floor || b.asks - a.asks);
}

/**
 * Append-only audit, as Certificate Transparency checks a log: every ledger root Takar anchored on
 * EAS is recomputed from today's ledger. If any older line had been edited, removed or reordered,
 * that anchor's root would no longer match.
 */
export function auditAnchors(ledgerText, anchors) {
  const lines = ledgerLines(ledgerText ?? "");
  const checks = (anchors ?? []).flatMap((a) => (a.items ?? []).filter((x) => x.kind === "ledger-root").map((x) => {
    const count = Number(x.count);
    const recomputed = count <= lines.length ? merkleRoot(lines.slice(0, count)) : null;
    return { at: a.at, tx: a.tx, count, digest: x.digest, matches: recomputed === x.digest, ...(recomputed === x.digest ? {} : { recomputed, why: count > lines.length ? "ledger is shorter than the anchored prefix" : "prefix changed since it was anchored" }) };
  }));
  return { ledger_lines: lines.length, anchors: checks.length, all_match: checks.length > 0 && checks.every((c) => c.matches), checks };
}

/** Where a signal hash appears: the node, Takar's ledger, and the earliest anchor covering it. */
export async function signalCheck(hash, { ledgerText, anchors, nodeFetch }) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(String(hash ?? ""))) throw Object.assign(new Error("hash must be 0x and 64 hex characters"), { status: 400 });
  const h = hash.toLowerCase();
  const node = await nodeFetch(h).then((r) => ({ found: r.ok, status: r.status })).catch((e) => ({ found: null, error: String(e.message).slice(0, 80) }));
  const lines = ledgerLines(ledgerText ?? "");
  const index = lines.findIndex((l) => l.toLowerCase().includes(h));
  const row = index >= 0 ? JSON.parse(lines[index]) : null;
  let anchored = null;
  if (index >= 0) {
    for (const a of anchors ?? []) {
      const item = (a.items ?? []).find((x) => x.kind === "ledger-root" && Number(x.count) > index);
      if (!item) continue;
      const recomputed = merkleRoot(lines.slice(0, Number(item.count)));
      // The inclusion proof lets a client check this one line against the anchored root without the file.
      const proof = merkleProof(lines.slice(0, Number(item.count)), index);
      anchored = { tx: a.tx, at: a.at, count: Number(item.count), digest: item.digest, recomputed, matches: recomputed === item.digest, line: lines[index], proof, proof_matches: rootFromProof(lines[index], proof) === item.digest };
      break;
    }
  }
  return {
    hash: h,
    on_node: node,
    in_takar_ledger: row ? { line: index + 1, at: row.at, intent: row.intent, miner: row.miner ?? null, paid_usd: Number(row.paidMicroUsdc ?? 0) / 1e6, status: row.status } : null,
    anchored,
  };
}
