// takar-mcp: offline signature rules, then one live session over stdio.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { verifyScorecard } from "./server.mjs";

const card = JSON.parse(readFileSync(new URL("../receipts/scorecard.json", import.meta.url), "utf8"));
assert.equal(verifyScorecard(card), true, "the published scorecard verifies against the pinned key");
assert.equal(verifyScorecard({ ...card, summary: { ...card.summary, brier: 0.001 } }), false, "an edited summary fails");
assert.equal(verifyScorecard({ ...card, attestation: undefined }), false, "an unsigned card fails");
// A card re-signed with someone else's key still fails: the key is pinned, not read from the card.
assert.equal(verifyScorecard(card, "MCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDFw4rXAxZuE="), false);

if (process.argv.includes("--offline")) { console.log("takar-mcp: 4 offline checks ok"); process.exit(0); }

const child = spawn(process.execPath, [fileURLToPath(new URL("./server.mjs", import.meta.url))], { stdio: ["pipe", "pipe", "inherit"] });
const frames = [];
child.stdout.on("data", (d) => frames.push(...d.toString().trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))));
const call = (id, method, params) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
call(1, "initialize", { protocolVersion: "2024-11-05" });
call(2, "tools/list");
call(3, "tools/call", { name: "forecast_scorecard", arguments: {} });
call(4, "tools/call", { name: "intent_ranking", arguments: { intent: "EVENT_OUTCOME_RESOLUTION_GENERAL", top: 3 } });
call(5, "tools/call", { name: "intent_ranking", arguments: { intent: "not an intent" } });
call(6, "tools/call", { name: "network_check", arguments: { view: "operators" } });
call(7, "tools/call", { name: "network_check", arguments: { view: "signal", hash: "0x12" } });
child.stdin.end();
await new Promise((r) => child.on("exit", r));
const by = Object.fromEntries(frames.map((f) => [f.id, f]));
assert.equal(by[1].result.serverInfo.name, "takar");
assert.deepEqual(by[2].result.tools.map((t) => t.name), ["resolve_event", "forecast_scorecard", "intent_ranking", "second_opinion", "miner_reputation", "miner_report", "network_check"]);
assert.equal(JSON.parse(by[3].result.content[0].text).verified, true);
assert.ok(JSON.parse(by[4].result.content[0].text).miners.length > 0);
assert.equal(by[5].result.isError, true);
assert.ok(JSON.parse(by[6].result.content[0].text).operators > 1, "operators counted");
assert.equal(by[7].result.isError, true, "a malformed hash is refused before any request");
console.log("takar-mcp: 11 checks ok (4 offline, 7 live)");
