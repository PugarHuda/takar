#!/usr/bin/env node
// Takar as an MCP server: three tools over stdio, no dependencies, no wallet.
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
];

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
