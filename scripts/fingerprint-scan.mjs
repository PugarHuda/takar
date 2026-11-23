// Hidden shared feeds in answers Takar already bought (no new spend): every pair of answers to the
// same question, from miners on different payout addresses, asked within 10 minutes of each other,
// checked for identical precise values (lib/second.mjs fingerprint).
//
//   node scripts/fingerprint-scan.mjs   -> receipts/fingerprint-scan.json
import { readFileSync, writeFileSync } from "node:fs";
import { fingerprint } from "../lib/second.mjs";

const rows = readFileSync("receipts/ledger.jsonl", "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter((r) => r?.result && typeof r.result === "object" && r.miner?.id);
const registry = await fetch("https://devnode.telegraphprotocol.com/api/miners", { signal: AbortSignal.timeout(60_000) }).then((r) => r.json());
const op = new Map(registry.map((m) => [String(m.id), String(m.fee_address ?? m.wallet_address ?? "").toLowerCase()]));
const name = new Map(registry.map((m) => [String(m.id), m.name ?? m.slug]));

const groups = new Map();
for (const r of rows) {
  const k = `${r.intent}|${JSON.stringify(r.params)}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}
const pairs = [];
for (const [k, list] of groups) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
  const a = list[i], b = list[j];
  if (a.miner.id === b.miner.id) continue;
  const oa = op.get(String(a.miner.id)), ob = op.get(String(b.miner.id));
  if (!oa || !ob || oa === ob) continue;
  if (Math.abs(Date.parse(a.at) - Date.parse(b.at)) > 600_000) continue;
  pairs.push({ intent: a.intent, params: a.params, at: a.at, miners: [a.miner.id, b.miner.id].map(String), identical: fingerprint(a.result, b.result) });
}
const flagged = pairs.filter((p) => p.identical.length);
const byPair = {};
for (const p of flagged) { const k = p.miners.slice().sort().map((id) => `${name.get(id) ?? id} (${id})`).join(" + "); byPair[k] = (byPair[k] ?? 0) + 1; }
const byIntent = {};
for (const p of pairs) { const b = (byIntent[p.intent] ??= { pairs: 0, identical: 0 }); b.pairs++; if (p.identical.length) b.identical++; }
writeFileSync("receipts/fingerprint-scan.json", JSON.stringify({ title: "Identical precise values between miners on different payout addresses, in answers Takar bought", generated_at: new Date().toISOString(), method: "Pairs of answers to the same intent and params, different fee addresses, bought within 10 minutes; a field counts when both carry the same number with at least 3 decimals or 5 significant digits.", pairs: pairs.length, identical: flagged.length, by_intent: byIntent, by_pair: byPair, flagged }, null, 2) + "\n");
console.log("pairs", pairs.length, "identical", flagged.length);
console.log(byIntent);
console.log(byPair);
