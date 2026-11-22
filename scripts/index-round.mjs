// A measurement round for the disagreement index (/api/network?view=disagreement): second opinions on
// several intents besides event outcomes, through the public API, labelled client "takar-index" so they
// are counted as Takar's own measurement, not as anyone's usage. Testnet: Takar's server escrow pays.
//
//   node scripts/index-round.mjs   -> receipts/index-round-YYYY-MM-DD.json
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const API = "https://takar-telegraph.vercel.app/api/second-opinion";
const CASES = [
  ...["BTC", "ETH", "SOL", "XRP", "DOGE", "LINK"].map((s) => ({ intent: "CRYPTO_PRICE_USD", params: { symbol: s }, fields: ["price_usd"] })),
  ...["AAPL", "MSFT", "NVDA", "TSLA", "JPM"].map((t) => ({ intent: "STOCK_PRICE_US_EQUITY", params: { ticker: t }, fields: ["price_usd"] })),
  ...["Jakarta, Indonesia", "London, United Kingdom", "Sydney, Australia", "Nairobi, Kenya", "Denver, Colorado"].map((l) => ({ intent: "WEATHER_CHECK_TEMPERATURE", params: { location: l }, fields: ["temperature_c"] })),
  ...["ethereum", "base", "arbitrum", "polygon"].map((c) => ({ intent: "GAS_PRICE_GENERAL", params: { chain: c }, fields: ["gas_price_gwei"] })),
  ...["Sberbank", "Rosneft", "Siemens AG", "Nestle", "Banco Delta Asia"].map((n) => ({ intent: "SANCTIONS_SCREENING_MATCH_GENERAL", params: { name: n }, fields: ["matched"] })),
];
// Re-running keeps today's finished rows and asks only the rest; the API allows 6 calls a minute per caller.
const day = new Date().toISOString().slice(0, 10);
const file = `receipts/index-round-${day}.json`;
const done = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).rows.filter((r) => r.verdict !== "error") : [];
const rows = [...done];
for (const c of CASES) {
  if (done.some((r) => r.intent === c.intent && JSON.stringify(r.params) === JSON.stringify(c.params))) continue;
  await new Promise((r) => setTimeout(r, 11_000));
  const t0 = Date.now();
  const r = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...c, client: "takar-index" }), signal: AbortSignal.timeout(150_000) }).then((x) => x.json()).catch((e) => ({ error: e.message }));
  rows.push({ ...c, verdict: r.verdict ?? "error", differ: r.differ ?? [], spread: r.spread ?? null, independence: r.independence?.level ?? null, miners: (r.answers ?? []).filter((a) => a.usable).map((a) => a.miner?.id), costUsd: r.costUsd ?? null, ms: Date.now() - t0, error: r.error ?? r.why ?? null });
  console.log(c.intent.padEnd(34), JSON.stringify(c.params).padEnd(36), r.verdict ?? "error", (r.differ ?? []).join(","), r.independence?.level ?? "", r.error ?? "");
}
const by = {};
for (const r of rows) { const b = (by[r.intent] ??= { agree: 0, disagree: 0, insufficient: 0, error: 0 }); b[r.verdict] = (b[r.verdict] ?? 0) + 1; }
writeFileSync(file, JSON.stringify({ title: "Disagreement index measurement round (client takar-index)", generated_at: new Date().toISOString(), by_intent: by, cost_usd: +rows.reduce((a, r) => a + (r.costUsd ?? 0), 0).toFixed(3), rows }, null, 2) + "\n");
console.log(JSON.stringify(by));
