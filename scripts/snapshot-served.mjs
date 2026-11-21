// Snapshot the node's own request counter for every miner (total_requests_served), appended to
// receipts/served.jsonl. Run every two hours by .github/workflows/served.yml. With two snapshots
// around an epoch, a score of 0 with no reason can be told apart: did any request reach the miner?
//   node scripts/snapshot-served.mjs
import { appendFileSync } from "node:fs";

const list = await fetch("https://devnode.telegraphprotocol.com/api/miners", { signal: AbortSignal.timeout(30_000) }).then((r) => r.json());
const served = Object.fromEntries(list.filter((m) => Number(m.total_requests_served) > 0).map((m) => [String(m.id), Number(m.total_requests_served)]));
appendFileSync("receipts/served.jsonl", JSON.stringify({ at: new Date().toISOString(), served }) + "\n");
console.log(`${Object.keys(served).length} miners with requests`);
