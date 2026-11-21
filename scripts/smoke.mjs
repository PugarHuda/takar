// Smoke test of the live site: free, read-only endpoints only (no paid asks, no keys).
//   node scripts/smoke.mjs [https://takar-telegraph.vercel.app]
import assert from "node:assert/strict";

const SITE = (process.argv[2] ?? "https://takar-telegraph.vercel.app").replace(/\/+$/, "");
const get = async (p, type = "json") => {
  const r = await fetch(SITE + p, { signal: AbortSignal.timeout(60_000) });
  assert.equal(r.status, 200, `${p} -> ${r.status}`);
  return type === "json" ? r.json() : r.text();
};
const checks = [
  ["feed counts calls from EAS", async () => { const f = await get("/api/feed"); assert.ok(f.calls > 0 && f.schema); }],
  ["reputation lists intents", async () => { const r = await get("/api/reputation"); assert.ok(r.attestations > 0 && r.intents.length > 0); }],
  ["miner report for takar-outcome", async () => { const m = await get("/api/miner?id=takar-outcome"); assert.equal(m.miner.slug, "takar-outcome"); assert.ok(m.intents.length); }],
  ["miner badge is an SVG", async () => { const s = await get("/api/miner?id=20261117&format=svg", "text"); assert.match(s, /^<svg/); }],
  ["outcome miner resolves a settled event", async () => { const r = await fetch(SITE + "/api/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "Did Argentina win the 2022 FIFA World Cup?" }), signal: AbortSignal.timeout(60_000) }).then((x) => x.json()); assert.equal(r.outcome, "yes"); }],
  ["dossier index and a signed dossier", async () => { const i = await get("/dossiers/index.json"); assert.ok(i.length >= 3); const d = await get(`/receipts/dossier-${i[0].slug}.json`); assert.ok(d.attestation?.signature); }],
  ["pages load", async () => { for (const p of ["/", "/goldrush.html", "/videos.html", "/openapi.json"]) await get(p, "text"); }],
];
let failed = 0;
for (const [name, fn] of checks) {
  try { await fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}: ${String(e.message).slice(0, 160)}`); }
}
console.log(`${checks.length - failed}/${checks.length} live checks ok`);
process.exit(failed ? 1 : 0);
