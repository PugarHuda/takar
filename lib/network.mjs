// Three views of the Telegraph network that need Takar's data, pure functions over public inputs:
//   operatorMap      who really runs the miners: miners grouped by the fee address they pay out to,
//                    and per intent how many independent operators a buyer can actually choose from;
//   disagreementIndex how often two miners from different operators disagree, per intent, from the
//                    comparisons Takar recorded on EAS (insufficient pairs are not counted);
//   signalCheck      for any Telegraph signal hash: on the node, in Takar's paid ledger, and anchored
//                    on EAS (the Merkle root over the ledger prefix that holds it, recomputed).
import { wilson } from "./reputation.mjs";
import { merkleRoot, ledgerLines } from "./anchor.mjs";

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
  return {
    miners: live.length,
    operators: operators.length,
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
      anchored = { tx: a.tx, at: a.at, count: Number(item.count), digest: item.digest, recomputed, matches: recomputed === item.digest };
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
