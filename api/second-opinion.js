// POST /api/second-opinion  {"intent": "WEATHER_FORECAST_VERIFY_GENERAL", "params": {...}}
//
// One call, any Telegraph intent: two different miners, chosen by the open
// on-chain record of who was right, asked directly and compared field by field.
// Free to call; Takar pays the two asks ($0.02 test USDC) from a separate testnet
// wallet whose escrow balance is the hard spending cap. Testnet only.
import { ethers } from "ethers";
import { ask, ranked } from "../lib/telegraph.mjs";
import { secondOpinion } from "../lib/second.mjs";
import { readAttestations, rank } from "../lib/reputation.mjs";

export const SCHEMA_UID = "0x351bc4ecf778660c8de0d42eb111e758469e1fe5ffc1b993899e399c9c056741";
const PER_MIN = 6, PER_DAY = 300; // per IP, and per instance per day: the escrow balance is the real cap
const hits = new Map();
let day = { d: "", n: 0 };
let repCache = { at: 0, atts: [] };
let opCache = { at: 0, map: new Map() };

// Only these attesters order paid asks: the schema is open, so anyone else's
// attestations are shown by /api/reputation but never steer where money goes.
export const TRUSTED = (process.env.TAKAR_TRUSTED_ATTESTERS ?? "0x39D2bae5EAedA9283535dDC98F1991c81eD5Cd7E").split(",").map((a) => a.trim().toLowerCase()).filter(Boolean);

/** Miner id -> payout address, from the node's public registry (cached an hour). */
export async function operatorOf() {
  if (Date.now() - opCache.at > 3600_000) {
    const list = await fetch("https://devnode.telegraphprotocol.com/api/miners", { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null);
    if (Array.isArray(list)) opCache = { at: Date.now(), map: new Map(list.map((m) => [String(m.id), m.fee_address ?? m.wallet_address ?? null])) };
  }
  return (id) => opCache.map.get(String(id)) ?? null;
}

/** One spend guard for every paid path (second opinion and the meta-miner). */
const spend = new Map();
let spendDay = { d: "", n: 0 };
export function overBudget(ip, perMin, perDay) {
  const now = Date.now();
  const recent = (spend.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  spend.set(ip, recent);
  const d = new Date().toISOString().slice(0, 10);
  if (spendDay.d !== d) spendDay = { d, n: 0 };
  return recent.length > perMin || ++spendDay.n > perDay;
}

function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  const d = new Date().toISOString().slice(0, 10);
  if (day.d !== d) day = { d, n: 0 };
  return recent.length > PER_MIN || ++day.n > PER_DAY;
}

export async function reputationFor(intent) {
  if (Date.now() - repCache.at > 10 * 60_000) {
    repCache = { at: Date.now(), atts: await readAttestations(SCHEMA_UID).catch(() => repCache.atts) };
  }
  return rank(repCache.atts, { intent, attesters: TRUSTED });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: 'POST {"intent": "...", "params": {...}}', spec: "https://takar-telegraph.vercel.app/openapi.json" });

  const intent = String(req.body?.intent ?? "");
  const params = req.body?.params;
  if (!/^[A-Z][A-Z0-9_]{2,80}$/.test(intent)) return res.status(400).json({ error: "intent must be a Telegraph intent name, e.g. EVENT_OUTCOME_RESOLUTION_GENERAL" });
  if (!params || typeof params !== "object" || Array.isArray(params) || JSON.stringify(params).length > 2000) return res.status(400).json({ error: "params must be an object of the intent's request params, at most 2,000 characters" });
  const ip = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return res.status(429).json({ error: `rate limit: ${PER_MIN} per minute per caller` });
  if (!process.env.SERVER_PAYER_KEY) return res.status(503).json({ error: "payer not configured" });

  const signer = new ethers.Wallet(process.env.SERVER_PAYER_KEY, new ethers.JsonRpcProvider("https://ethereum-sepolia-rpc.publicnode.com", 11155111, { staticNetwork: true }));
  const t0 = Date.now();
  try {
    const reputation = await reputationFor(intent);
    const out = await secondOpinion({ intent, params }, { ask: (a) => ask({ ...a, signer }), ranked, reputation, operatorOf: await operatorOf() });
    console.log(JSON.stringify({ intent, verdict: out.verdict, ms: Date.now() - t0, cost: out.costUsd }));
    return res.status(200).json({
      ...out,
      how: "Two different Telegraph miners, ordered by the open EAS record of who was right (then the node's rank), asked directly by id and compared field by field. Never averaged.",
      reputation_schema: `https://sepolia.easscan.org/schema/view/${SCHEMA_UID}`,
      signals: out.answers.filter((a) => a.signal).map((a) => `https://devnode.telegraphprotocol.com/engine/v1/signal/${a.signal}`),
      ms: Date.now() - t0,
    });
  } catch (err) {
    console.log(JSON.stringify({ intent, error: String(err.message).slice(0, 200) }));
    return res.status(503).json({ error: String(err.message).slice(0, 200) });
  }
}
