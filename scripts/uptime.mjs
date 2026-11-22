// Hourly availability and latency of the Takar Outcome miner, from outside (GitHub's runners), on
// questions it answers from data, so a probe costs nothing and needs no model. Appends one line to
// receipts/uptime.jsonl: status, outcome, milliseconds, and whether the answer was the known one.
// Run by .github/workflows/uptime.yml.
import { appendFileSync } from "node:fs";

const URL = "https://takar-outcome.vercel.app/api/resolve";
const PROBES = [
  { event: "Will Bitcoin reach $90000 in 2024", expect: "yes" },
  { event: "Did TSG Hoffenheim win the match against FSV Mainz 05 on 2024-12-01 in the Bundesliga?", expect: "no" },
  { event: "Did the US Federal Reserve cut its policy rate at the September 18 2024 FOMC meeting?", expect: "yes" },
];
const at = new Date().toISOString();
for (const p of PROBES) {
  const t0 = Date.now();
  let status = 0, outcome = null, error = null;
  try {
    const r = await fetch(`${URL}?event=${encodeURIComponent(p.event)}`, { signal: AbortSignal.timeout(60_000) });
    status = r.status;
    outcome = (await r.json().catch(() => null))?.outcome ?? null;
  } catch (e) { error = String(e.message).slice(0, 120); }
  const row = { at, event: p.event, status, outcome, right: outcome === p.expect, ms: Date.now() - t0, ...(error ? { error } : {}) };
  appendFileSync("receipts/uptime.jsonl", JSON.stringify(row) + "\n");
  console.log(JSON.stringify(row));
}
