// Use case #20 (OpenClaw & Hermes: independent agent task verification), run as code.
//
//   node scripts/agent-verify-demo.mjs        -> receipts/agent-verify/run-<time>.json
//
// An agent gets tasks whose answer decides an action. Before acting it follows the takar-verify skill
// (integrations/skills/takar-verify/SKILL.md): it calls the `takar` MCP server over stdio, the same server
// and the same tool calls Hermes (mcp_takar_second_opinion) or OpenClaw (mcporter call takar.second_opinion)
// would make, and acts on the verdict: agree -> act on the answer, disagree -> hold, insufficient -> unknown.
// The policy is code here so the run is reproducible without a model key; with an LLM agent the model makes
// the same calls. Every answer is a paid Telegraph ask with its signal.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TASKS = [
  { id: "pay-sanctioned", ask: "Pay supplier invoice from Bank Rossiya?", intent: "SANCTIONS_SCREENING_MATCH_GENERAL", params: { name: "Bank Rossiya" }, fields: ["matched"],
    act: (v) => (v.verdict === "agree" ? (v.answer?.matched === true ? "BLOCK the payment: both operators match a sanctions list" : "PAY: both operators clear") : v.verdict === "disagree" ? "HOLD: the screens disagree" : "HOLD: not enough usable answers") },
  { id: "pay-clear", ask: "Pay supplier invoice from Siemens AG?", intent: "SANCTIONS_SCREENING_MATCH_GENERAL", params: { name: "Siemens AG" }, fields: ["matched"],
    act: (v) => (v.verdict === "agree" ? (v.answer?.matched === false ? "PAY: both operators clear" : "BLOCK the payment: both operators match") : v.verdict === "disagree" ? "HOLD: the screens disagree" : "HOLD: not enough usable answers") },
  { id: "state-fact", ask: "Tell the user whether the Fed cut rates at the 18 September 2024 FOMC meeting.", intent: "EVENT_OUTCOME_RESOLUTION_GENERAL", params: { event: "Did the Fed cut rates at the September 18 2024 FOMC meeting?" },
    act: (v) => (v.verdict === "agree" ? `STATE it, citing both signals: ${JSON.stringify(v.answer?.outcome ?? v.answer?.answer ?? v.answer)}` : v.verdict === "disagree" ? "DO NOT state it: the sources disagree; report both" : "SAY it is not established") },
  { id: "settle-market", ask: "Settle a market: did Argentina win the 2022 FIFA World Cup?", intent: "EVENT_OUTCOME_RESOLUTION_GENERAL", params: { event: "Did Argentina win the 2022 FIFA World Cup?" },
    act: (v) => (v.verdict === "agree" ? `SETTLE on ${JSON.stringify(v.answer?.outcome ?? v.answer?.answer ?? v.answer)}${v.sameSource ? " (note: both cite one source)" : ""}` : v.verdict === "disagree" ? "HOLD the settlement: the sources disagree" : "HOLD: not enough usable answers") },
];

function mcp() {
  const child = spawn(process.execPath, [fileURLToPath(new URL("../mcp/server.mjs", import.meta.url))], { stdio: ["pipe", "pipe", "inherit"] });
  const waiting = new Map(); let buf = "", id = 0;
  child.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue; const m = JSON.parse(line); waiting.get(m.id)?.(m); waiting.delete(m.id); } });
  const call = (method, params) => new Promise((ok) => { const n = ++id; waiting.set(n, ok); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n"); });
  return { call, close: () => child.stdin.end() };
}

const s = mcp();
await s.call("initialize", { protocolVersion: "2024-11-05" });
const runs = [];
for (const t of TASKS) {
  const r = await s.call("tools/call", { name: "second_opinion", arguments: { intent: t.intent, params: t.params, ...(t.fields ? { fields: t.fields } : {}), client: "takar-agent-demo" } });
  const text = r.result?.content?.[0]?.text ?? "";
  let v; try { v = JSON.parse(text); } catch { v = { verdict: "error", error: text.slice(0, 200) }; }
  const signals = (v.answers ?? []).filter((a) => a.signal).map((a) => ({ miner: a.miner?.id ?? a.miner, signal: a.signal, usable: a.usable }));
  const row = { task: t.id, ask: t.ask, intent: t.intent, verdict: v.verdict, differing: v.differing ?? v.diff ?? null, answer: v.answer ?? null, action: t.act(v), costUsd: v.costUsd ?? null, signals, record: v.record ?? null };
  runs.push(row);
  console.log(`${t.id.padEnd(15)} ${String(v.verdict).padEnd(12)} -> ${row.action}`);
}
s.close();
mkdirSync("receipts/agent-verify", { recursive: true });
const at = new Date().toISOString();
writeFileSync(`receipts/agent-verify/run-${at.replace(/[:.]/g, "-")}.json`, JSON.stringify({ at, method: "takar-verify skill policy, run as code over the takar MCP server (stdio)", runs }, null, 2) + "\n");
