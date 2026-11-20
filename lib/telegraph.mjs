// Telegraph V2 client for Takar: canonical asks ({intent, params}), paid over
// x402 on Ethereum Sepolia, every purchase written to an append-only ledger.
//
// The ledger is the product as much as the answer: a judge (or an operator)
// reads receipts/ledger.jsonl and can check each line against Etherscan and the
// node's /engine/v1/signal/{hash} without trusting us.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { fetchWithPayment } from "./x402.mjs";

export const CHAIN_ID = 11155111;
export const NODE = process.env.TELEGRAPH_NODE ?? "https://devnode.telegraphprotocol.com";
export const RPC = process.env.RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
export const USDC = "0xcc194e1a843B658526D0D5C431f670028582Ae17"; // Telegraph test USDC (the Diamond's token)
// Circle's USDC on Ethereum Sepolia: what the node's 402 asks for since 17 Nov 2026.
export const CIRCLE_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const PAYABLE = [USDC, CIRCLE_USDC];
// The ledger Diamond the node reads since 17 Nov 2026; escrow asks are billed there.
export const ESCROW = "0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b";
export const LEDGER = process.env.TAKAR_LEDGER ?? join(dirname(fileURLToPath(import.meta.url)), "..", "receipts", "ledger.jsonl");

// An Engine ask is $0.01. Anything at ten times that is a bug on one side and is
// refused before it is signed.
const ASK_CEILING = 100_000n;
// The node sends 403 to default client User-Agents (Cloudflare 1010), so name ourselves.
const HEADERS = { "Content-Type": "application/json", "User-Agent": "takar/0.1 (+telegraph hackathon s2)" };

export function wallet() {
  const key = process.env.AGENT_PRIVATE_KEY;
  if (!key) throw new Error("AGENT_PRIVATE_KEY is not set in .env");
  return new ethers.Wallet(key, new ethers.JsonRpcProvider(RPC, CHAIN_ID));
}

/** An intent's request params and response fields. Free. */
export async function intent(name) {
  const res = await fetch(`${NODE}/engine/v1/intents/${encodeURIComponent(name)}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`intent ${name}: ${res.status}`);
  const { miners, ...rest } = await res.json();
  return { ...rest, miner_count: miners?.length ?? rest.miner_count };
}

/**
 * Miners for an intent in current rank order, with the ids /ask/{id} needs.
 * Free. The leaderboard names miners by slug; the intent lists slug -> id.
 */
export async function ranked(name, { lookbackEpochs = 12 } = {}) {
  const get = (path) => fetch(`${NODE}${path}`, { headers: HEADERS }).then((r) => (r.ok ? r.json() : null));
  const [lb, info] = await Promise.all([get("/leaderboard/miners"), get(`/engine/v1/intents/${encodeURIComponent(name)}`)]);
  const ids = new Map((info?.miners ?? []).map((m) => [m.slug, m.id]));
  // /leaderboard/miners only carries the intents scored in the latest epoch, so
  // an intent scored a few epochs ago is absent there. Walk back until found.
  let rows = lb?.intents?.[name];
  for (let e = (lb?.epoch ?? 0) - 1; !rows && e > (lb?.epoch ?? 0) - 1 - lookbackEpochs; e--) {
    rows = (await get(`/leaderboard/miners/epoch/${e}`))?.intents?.[name];
  }
  return (rows ?? [])
    .filter((r) => r.activation_status === "active" && ids.has(r.miner_slug))
    .sort((a, b) => a.rank - b.rank)
    .map((r) => ({ id: ids.get(r.miner_slug), slug: r.miner_slug, score: r.score, rank: r.rank }));
}

function decodeSettlement(header) {
  if (!header) return null;
  try { return JSON.parse(Buffer.from(header, "base64").toString("utf8")); } catch { return { raw: header }; }
}

function record(entry) {
  mkdirSync(dirname(LEDGER), { recursive: true });
  appendFileSync(LEDGER, JSON.stringify(entry) + "\n");
}

/**
 * Buy one answer. Routed by rank unless `minerId` is given.
 *
 * Every outcome is recorded, including refusals and failures after payment:
 * "possibly paid" must never vanish from the books.
 */
export async function ask({ intent: name, params, minerId, purpose, unit, run, signer, maxAmount = ASK_CEILING }) {
  if (!name || !params) throw new Error("ask needs intent and params");
  const w = signer ?? wallet();
  const url = `${NODE}/engine/v1/ask${minerId ? `/${minerId}` : ""}`;
  const at = new Date().toISOString();
  const base = { at, run: run ?? null, unit: unit ?? null, intent: name, params, minerId: minerId ?? null, purpose: purpose ?? null, payer: w.address, chain: CHAIN_ID };

  let out;
  try {
    out = await fetchWithPayment(url, { method: "POST", headers: HEADERS, body: JSON.stringify({ intent: name, params }) }, w, {
      chainId: CHAIN_ID, asset: PAYABLE, escrow: ESCROW, maxAmount,
    });
  } catch (err) {
    // A throw after signing may still have settled (lost response). Book it as
    // such, and hand the entry to the caller so its budget counts it too.
    const entry = { ...base, status: "failed", paidMicroUsdc: "0", possiblyPaid: /refused|fetch failed|aborted|timeout/i.test(err.message), error: err.message };
    record(entry);
    err.entry = entry;
    throw err;
  }
  const { response, amount, settlement, rail } = out;
  // Escrow bills only a delivered ask; an exact payment settles before the miner runs.
  const paid = out.paid && (rail !== "escrow" || response.ok);
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }

  const receipt = decodeSettlement(settlement);
  const entry = {
    ...base,
    status: response.ok ? "paid" : paid ? "failed_paid" : "refused",
    http: response.status,
    paidMicroUsdc: paid ? String(amount) : "0",
    rail: out.paid ? rail : null,
    // Signed and sent but not delivered: escrow should not bill it, yet the budget
    // counts it until the ledger says otherwise (fail closed, not open).
    possiblyPaid: out.paid && !paid,
    settlementTx: receipt?.transaction ?? receipt?.txHash ?? null,
    miner: body.miner_id ? { id: body.miner_id, name: body.miner_name } : null,
    signalHash: body.signal_hash ?? null,
    resultShape: body.result_shape ?? null,
    fieldStatus: body.field_status ?? null,
    result: body.result ?? null,
    costUsd: body.cost_usd ?? null,
    durationMs: body.duration_ms ?? null,
    error: response.ok ? null : body.error ?? body.message ?? body.raw ?? null,
  };
  record(entry);
  if (!response.ok) {
    const err = new Error(`ask ${name} -> ${response.status}: ${entry.error}`);
    err.entry = entry;
    throw err;
  }
  return { ...body, ledger: entry };
}
