// Append the node's recent EVENT_OUTCOME questions (its public question feed) to
// receipts/questions.jsonl, once each, so "scored 0 in epoch N" can be read against what was asked
// in that window. Vercel keeps our own request logs only briefly. Run by .github/workflows/served.yml.
import { readFileSync, appendFileSync, existsSync } from "node:fs";

const FILE = "receipts/questions.jsonl";
const B = "https://devnode.telegraphprotocol.com/daemon/api/questions";
const seen = new Set(existsSync(FILE) ? readFileSync(FILE, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).id) : []);
let added = 0;
for (let p = 0; p < 20; p++) {
  const rows = (await fetch(`${B}?limit=100&offset=${p * 100}`).then((r) => r.json()).catch(() => null))?.results ?? [];
  if (!rows.length) break;
  for (const r of rows) {
    if (!(r.routing?.intent ?? "").startsWith("EVENT_OUTCOME") || seen.has(r.id)) continue;
    const text = String(r.question?.text ?? "");
    const event = (() => { try { return JSON.parse(text.slice(text.indexOf("{"))).event ?? null; } catch { return null; } })();
    const res = r.execution?.result ?? null;
    appendFileSync(FILE, JSON.stringify({ id: r.id, at: r.created_at, intent: r.routing?.intent, event: event ?? text.slice(0, 300), source: r.source, outcome: res?.outcome ?? null, answered_by_shape: res ? (res.outcome ? "outcome" : Object.keys(res).slice(0, 3).join(",")) : null, signal: r.signal_hash ?? null }) + "\n");
    seen.add(r.id);
    added++;
  }
}
console.log(`questions: ${added} new, ${seen.size} total`);
