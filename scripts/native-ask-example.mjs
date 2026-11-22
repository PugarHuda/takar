// How another app asks Takar Outcome (miner 20261117) through the Telegraph node, paid by x402.
//
//   node --env-file=.env scripts/native-ask-example.mjs "What was the final score of Kansas City Chiefs vs Philadelphia Eagles on 2025-02-09 (NFL)?"
//
// Two shapes, both through /engine/v1/ask/20261117:
//   - intent shape {intent, params}: the node maps the answer to EVENT_OUTCOME's fields
//     (outcome, resolved_yes, winner, resolved_at, sources);
//   - native shape {method, endpoint, payload}: the miner's own JSON, with the verbatim evidence and,
//     for games, data.scores (home and away, numeric). This is how Gainsay calls its providers.
// Costs $0.01 test USDC per ask on Ethereum Sepolia; needs AGENT_PRIVATE_KEY (or your own key) funded.
import { ethers } from "ethers";
import { fetchWithPayment } from "../lib/x402.mjs";
import { CHAIN_ID, USDC, CIRCLE_USDC, ESCROW } from "../lib/telegraph.mjs";

const event = process.argv[2] ?? "What was the final score of Kansas City Chiefs vs Philadelphia Eagles on 2025-02-09 (NFL)?";
const shape = process.argv.includes("--intent") ? "intent" : "native";
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY);
const body = shape === "intent"
  ? { intent: "EVENT_OUTCOME_RESOLUTION_GENERAL", params: { event } }
  : { method: "GET", endpoint: "/resolve", payload: { event } };
const out = await fetchWithPayment("https://devnode.telegraphprotocol.com/engine/v1/ask/20261117", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, wallet, { chainId: CHAIN_ID, asset: [USDC, CIRCLE_USDC], escrow: ESCROW, maxAmount: 20_000n });
const json = await out.response.json().catch(() => null);
console.log(`HTTP ${out.response.status}, paid ${out.paid}`);
console.log(JSON.stringify(json, null, 2).slice(0, 3000));
