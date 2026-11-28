#!/usr/bin/env node
// Takar as an MCP server: ten tools over stdio, no wallet.
//
//   npx -y takar-mcp
//   node mcp/server.mjs
//
//   { "mcpServers": { "takar": { "command": "npx", "args": ["-y", "takar-mcp"] } } }
//
// Every tool is a free read over plain HTTPS. Nothing here signs or spends; the
// paid Telegraph rails (x402, escrow) live in lib/ of the repo.
//
// ponytail: JSON-RPC by hand rather than @modelcontextprotocol/sdk, same as
// amanat-mcp. Four methods over newline-delimited JSON; swap in the SDK if this
// ever needs sampling, resources or prompts.

import { createInterface } from "node:readline";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicKey, verify } from "node:crypto";

const RESOLVER = (process.env.TAKAR_RESOLVER ?? "https://takar-outcome.vercel.app").replace(/\/+$/, "");
const NODE = (process.env.TELEGRAPH_NODE ?? "https://devnode.telegraphprotocol.com").replace(/\/+$/, "");
const SCORECARD = process.env.TAKAR_SCORECARD ?? "https://raw.githubusercontent.com/PugarHuda/takar/main/receipts/scorecard.json";
// Pinned, not read from the document: a scorecard that carries its own key can be
// re-signed by anyone. This is keys/takar-ed25519.pub in the repo.
const TAKAR_KEY = "MCowBQYDK2VwAyEA3Hx7R/RFow5HcbXTPXlbw0gS4eX7xliuos4D9uyQa5I=";
const NAME = "takar";
const SITE = process.env.TAKAR_SITE ?? "https://takar-telegraph.vercel.app";
const VERSION = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
const PROTOCOL = "2024-11-05";

const TOOLS = [
  {
    name: "resolve_event",
    description:
      "Resolve whether a real-world event happened, or who won it, from Wikipedia text. Every yes/no " +
      "answer carries a sentence quoted word for word from the cited article, checked in code. An " +
      "event whose period has not ended, or that the sources do not settle, is answered \"unresolved\" " +
      "instead of guessed. Same resolver as the Takar Outcome miner on Telegraph.",
    inputSchema: {
      type: "object",
      properties: {
        event: { type: "string", description: 'The event as a question, with its year, e.g. "Did Argentina win the 2022 FIFA World Cup?". At most 500 characters.' },
      },
      required: ["event"],
    },
  },
  {
    name: "forecast_scorecard",
    description:
      "Takar's Mission 13 forecast scorecard: prediction-market crowd prices 7 days before each market " +
      "closed, scored (Brier) against outcomes bought through Telegraph. The Ed25519 signature is " +
      "checked here against Takar's pinned public key, so an edited scorecard reports verified: false.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "intent_ranking",
    description:
      "Live miner ranking for one Telegraph intent (e.g. EVENT_OUTCOME_RESOLUTION_GENERAL, " +
      "WEATHER_FORECAST_VERIFY_GENERAL): rank, miner slug and score from the most recent epoch that " +
      "scored it. Walks back through epochs, because the latest one lists only the intents it scored.",
    inputSchema: {
      type: "object",
      properties: {
        intent: { type: "string", description: "Exact intent name, e.g. EVENT_OUTCOME_RESOLUTION_GENERAL." },
        top: { type: "integer", minimum: 1, maximum: 50, description: "How many miners to return. Default 10." },
      },
      required: ["intent"],
    },
  },
  {
    name: "second_opinion",
    description:
      "Before acting on intelligence from Telegraph, get a second opinion: Takar asks two DIFFERENT miners " +
      "the same question (any intent), chosen by an open on-chain record of who was right, and compares their " +
      "answers field by field. verdict 'agree' -> act on 'answer'. 'disagree' -> do not act on either alone; " +
      "report both and the differing fields. 'insufficient' -> fewer than two usable answers. Takar pays the asks " +
      "in test USDC; no key or wallet needed. Testnet only.",
    inputSchema: {
      type: "object",
      properties: {
        intent: { type: "string", description: "Exact Telegraph intent name, e.g. WEATHER_FORECAST_VERIFY_GENERAL or EVENT_OUTCOME_RESOLUTION_GENERAL." },
        params: { type: "object", description: "The intent's request params, as its schema defines them." },
        fields: { type: "array", items: { type: "string" }, description: "Optional: the answer fields that decide your action (e.g. [\"matched\"]); agreement is judged on these." },
      },
      required: ["intent", "params"],
    },
  },
  {
    name: "miner_reputation",
    description:
      "Which Telegraph miner to trust for an intent, from an open on-chain record (EAS on Ethereum Sepolia) of how " +
      "each miner's paid answers held up against independent truth: right, wrong, unusable, wrong place, abstained. " +
      "Ranked by the Wilson lower bound of accuracy. Anyone can add evidence to the same schema.",
    inputSchema: {
      type: "object",
      properties: {
        intent: { type: "string", description: "Exact intent name. Omit to list the intents with evidence." },
        attester: { type: "string", description: "Only count evidence from this attester address." },
      },
    },
  },
  {
    name: "miner_report",
    description:
      "Why a Telegraph miner scored what it scored: the scorer's per-epoch scores and failure reasons, spot checks, " +
      "node status, and the open EAS record of its paid answers, with flags such as a 0 that came with no failure " +
      "reason (often: never asked in the window). Also returns a README badge URL.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string", description: "Miner id or slug, e.g. takar-outcome" } } },
  },
  {
    name: "network_check",
    description:
      "Three views of the Telegraph network. operators: miners grouped by the fee address they pay out to, and per intent how " +
      "many independent operators a buyer can actually choose from (two miners on one address are one opinion). disagreement: " +
      "how often miners from different operators disagree per intent, from Takar's comparisons on EAS, with 95% Wilson intervals. " +
      "signal: one Telegraph signal hash checked on the node, in Takar's paid ledger, and inside the EAS-anchored Merkle root of that ledger.",
    inputSchema: {
      type: "object",
      properties: {
        view: { type: "string", enum: ["operators", "disagreement", "signal"], default: "operators" },
        hash: { type: "string", description: "Signal hash (0x + 64 hex), for view=signal" },
      },
    },
  },
  {
    name: "trade_case",
    description:
      "Takar Trade Assurance (an Alibaba-style escrow on Sepolia, with Praman Desk holding an independent seat): a deal's " +
      "whole case file. The order, every step with its transaction, and every evidence round (ship in port by two AIS miners " +
      "and the port's own record, the parties' signed documents, invoice reconciliation, sanctions, supplier identity) " +
      "re-decided from its stored answers with the same rules, plus the deal's state on chain. Omit `case` to list the cases.",
    inputSchema: { type: "object", properties: { case: { type: "string", description: 'Case id such as "v5-0" (TakarSettle5 deal 0) or "v4-1". Omit to list.' } } },
  },
  {
    name: "verify_signal",
    description:
      "Check one Telegraph signal without trusting anyone: fetch it from the node and recompute its hash from the payload " +
      "(keccak256 of canonical JSON). matches: true means the stored request and answer are exactly what the signal committed to. " +
      "The node does not sign, so this proves integrity, not who produced the answer.",
    inputSchema: { type: "object", required: ["hash"], properties: { hash: { type: "string", description: "Signal hash, 0x + 64 hex" } } },
  },
  {
    name: "verify_countersign",
    description:
      "Verify a Countersign shipment report (another team's signed memo recommending release or hold): recompute its digest, " +
      "recover the EIP-191 signer and compare it with Countersign's pinned agent, and optionally check it is about a given PO. " +
      "Returns release, hold or unusable, the way Takar's escrow uses it (a hold sends a deal to review; a release never pays alone).",
    inputSchema: { type: "object", required: ["memo"], properties: { memo: { type: "string", description: "Memo id, e.g. commodities-2026-11-23-3435f1fa" }, po: { type: "string", description: "Optional PO number the memo must be about" } } },
  },
];

/** lib/ inside the npm package (copied at pack time), or the repo's lib/ when run from the repo. */
async function lib(name) {
  const dir = (await import("node:fs")).existsSync(new URL(`./lib/${name}.mjs`, import.meta.url)) ? "./lib/" : "../lib/";
  return import(`${dir}${name}.mjs`);
}

/**
 * Self-pay mode (TAKAR_PAYER_KEY set): the same rules run here and the caller's own Telegraph
 * escrow pays the asks, so there is no rate limit and no dependence on Takar's wallet. Miners
 * are still ordered by the open EAS record (read from Takar's API) and one operator counts once.
 * Loaded only in this mode, so the default stays dependency-free in practice.
 */
async function selfPay(intent, params) {
  process.env.TAKAR_LEDGER ??= (await import("node:path")).join((await import("node:os")).tmpdir(), "takar-mcp-ledger.jsonl");
  // The npm package carries lib/ (copied at pack time); run from the repo, it uses the repo's lib/.
  const dir = (await import("node:fs")).existsSync(new URL("./lib/second.mjs", import.meta.url)) ? "./lib/" : "../lib/";
  const [{ ethers }, t, { secondOpinion }] = await Promise.all([import("ethers"), import(`${dir}telegraph.mjs`), import(`${dir}second.mjs`)]);
  const signer = new ethers.Wallet(process.env.TAKAR_PAYER_KEY, new ethers.JsonRpcProvider(process.env.RPC ?? "https://ethereum-sepolia-rpc.publicnode.com", 11155111, { staticNetwork: true }));
  const [rep, miners] = await Promise.all([
    getJson(`${SITE}/api/reputation?intent=${encodeURIComponent(intent)}`).catch(() => ({})),
    getJson(`${NODE}/api/miners`).catch(() => []),
  ]);
  const ops = new Map((Array.isArray(miners) ? miners : []).map((m) => [String(m.id), m.fee_address ?? m.wallet_address ?? null]));
  const out = await secondOpinion({ intent, params }, { ask: (a) => t.ask({ ...a, signer }), ranked: t.ranked, reputation: rep.ranking ?? [], operatorOf: (id) => ops.get(String(id)) ?? null, strictOperators: true, unit: "takar-mcp" });
  return { ...out, mode: "self-pay", paid_by: signer.address, signals: out.answers.filter((a) => a.signal).map((a) => `${NODE}/engine/v1/signal/${a.signal}`) };
}

async function getJson(url, init) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(90_000) });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`${r.status} from ${url}: not JSON`); }
  if (!r.ok) throw new Error(body.error ?? body.message ?? `${r.status} from ${url}`);
  return body;
}

/** Stable JSON with sorted keys: what the scorecard was signed over. */
const canonical = (v) =>
  Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`
  : JSON.stringify(v ?? null);

export function verifyScorecard(card, pinned = TAKAR_KEY) {
  const { attestation, ...doc } = card;
  if (!attestation?.signature) return false;
  try {
    const key = createPublicKey({ key: Buffer.from(pinned, "base64"), format: "der", type: "spki" });
    return verify(null, Buffer.from(canonical(doc)), key, Buffer.from(attestation.signature, "base64"));
  } catch {
    return false;
  }
}

const CALLS = {
  async resolve_event({ event }) {
    const e = String(event ?? "").trim();
    if (!e) throw new Error("event is required");
    if (e.length > 500) throw new Error("event must be at most 500 characters");
    return getJson(`${RESOLVER}/api/resolve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: e }) });
  },

  async forecast_scorecard() {
    const card = await getJson(SCORECARD);
    return {
      verified: verifyScorecard(card),
      signer: TAKAR_KEY,
      generated_at: card.generated_at,
      method: card.method,
      summary: card.summary,
      rows: card.rows,
    };
  },

  async second_opinion({ intent, params, client, fields }) {
    const name = String(intent ?? "").trim();
    if (!/^[A-Z][A-Z0-9_]{2,80}$/.test(name)) throw new Error("intent must be an exact intent name");
    if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("params must be an object");
    if (process.env.TAKAR_PAYER_KEY) return selfPay(name, params);
    return getJson(`${SITE}/api/second-opinion`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: name, params, ...(Array.isArray(fields) && fields.length ? { fields: fields.map(String).slice(0, 10) } : {}), ...(client ? { client: String(client).slice(0, 40) } : {}) }) });
  },

  async miner_reputation({ intent, attester } = {}) {
    const q = new URLSearchParams();
    if (intent) q.set("intent", String(intent));
    if (attester) q.set("attester", String(attester));
    return getJson(`${SITE}/api/reputation?${q}`);
  },

  async network_check({ view = "operators", hash } = {}) {
    const v = String(view);
    if (!["operators", "disagreement", "signal"].includes(v)) throw new Error("view must be operators, disagreement or signal");
    if (v === "signal" && !/^0x[0-9a-fA-F]{64}$/.test(String(hash ?? ""))) throw new Error("hash must be 0x and 64 hex characters");
    return getJson(`${SITE}/api/network?view=${v}${v === "signal" ? `&hash=${hash}` : ""}`);
  },

  async trade_case({ case: c } = {}) {
    const base = `${SITE}/receipts/trade-assurance`;
    if (!c) return { cases: await getJson(`${base}/cases.json`), page: `${SITE}/trade.html` };
    if (!/^v[45]-\d{1,4}$/.test(String(c))) throw new Error('case must look like "v5-0" or "v4-1"');
    return getJson(`${base}/case-${c}.json`);
  },

  async verify_signal({ hash }) {
    const h = String(hash ?? "");
    if (!/^0x[0-9a-fA-F]{64}$/.test(h)) throw new Error("hash must be 0x and 64 hex characters");
    const s = await getJson(`${NODE}/engine/v1/signal/${h}`);
    const { signalHashOf } = await lib("trade");
    const recomputed = signalHashOf(s.payload);
    return { hash: h, on_node: true, recomputed, matches: recomputed.toLowerCase() === h.toLowerCase(), intent: s.payload?.intent_id, miner: s.payload?.miner_slug, paid_by: s.payload?.wallet_address, at: s.payload?.timestamp, request: s.payload?.request, response: s.payload?.response, note: "integrity of the committed payload; the node does not sign" };
  },

  async verify_countersign({ memo, po }) {
    const id = String(memo ?? "");
    if (!/^[\w.-]{3,120}$/.test(id)) throw new Error("memo must be a Countersign memo id");
    const { memoVerdict, memoUrl } = await lib("countersign");
    const m = await getJson(memoUrl(id));
    const { computed, ...v } = memoVerdict(m, { po: po ? String(po) : undefined });
    return { memo: memoUrl(id), ...v };
  },

  async miner_report({ id }) {
    return getJson(`${SITE}/api/miner?id=${encodeURIComponent(String(id ?? ""))}`);
  },

  async intent_ranking({ intent, top = 10 }) {
    const name = String(intent ?? "").trim();
    if (!/^[A-Z0-9_]{3,80}$/.test(name)) throw new Error("intent must be an exact intent name such as EVENT_OUTCOME_RESOLUTION_GENERAL");
    const latest = await getJson(`${NODE}/leaderboard/miners`);
    for (let e = latest.epoch, seen = 0; e > 0 && seen < 24; e--, seen++) {
      const board = e === latest.epoch ? latest : await getJson(`${NODE}/leaderboard/miners/epoch/${e}`).catch(() => null);
      const rows = board?.intents?.[name];
      if (rows?.length) return { intent: name, epoch: e, miners: rows.slice(0, Math.min(50, Math.max(1, top))) };
    }
    return { intent: name, epoch: null, miners: [], note: "not scored in the last 24 epochs" };
  },
};

// ── JSON-RPC (from amanat-mcp) ───────────────────────────────────────────────

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;
  switch (method) {
    case "initialize":
      return reply(id, { protocolVersion: params?.protocolVersion ?? PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: NAME, version: VERSION } });
    case "notifications/initialized":
    case "notifications/cancelled":
      return;
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, { tools: TOOLS });
    case "tools/call": {
      const fn = CALLS[params?.name];
      if (!fn) return fail(id, -32602, `no tool called ${params?.name}`);
      try {
        const out = await fn(params.arguments ?? {});
        return reply(id, { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] });
      } catch (e) {
        // A refusal is a result the model can act on, not a dead session.
        return reply(id, { content: [{ type: "text", text: `error: ${e.message}` }], isError: true });
      }
    }
    default:
      if (isNotification) return;
      return fail(id, -32601, `unknown method ${method}`);
  }
}

// Only run the stdio loop when started directly, so the test can import verifyScorecard.
const main = (() => { try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (main) {
  let pending = 0;
  let leaving = false;
  const leaveIfIdle = () => { if (leaving && pending === 0) process.exit(0); };
  createInterface({ input: process.stdin }).on("line", (line) => {
    const text = line.trim();
    if (!text) return;
    let msg;
    try { msg = JSON.parse(text); } catch { return fail(null, -32700, "parse error"); }
    pending++;
    handle(msg)
      .catch((e) => { if (msg.id !== undefined && msg.id !== null) fail(msg.id, -32603, e.message); })
      .finally(() => { pending--; leaveIfIdle(); });
  });
  // Answer what was already asked before leaving: piping frames then closing must still get replies.
  process.stdin.on("close", () => { leaving = true; leaveIfIdle(); });
}
