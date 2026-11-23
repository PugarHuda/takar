// GET /api/network?view=operators   who runs the miners: fee addresses, and per intent how many
//                                   independent operators a buyer can choose from
// GET /api/network?view=disagreement how often miners from different operators disagree, per intent,
//                                   from the comparisons Takar recorded on EAS
// GET /api/network?view=signal&hash=0x...  a signal on the node, in Takar's ledger, anchored on EAS
// GET /api/network?view=miners       answered and complete rates per miner Takar bought from, last 7 days
import { operatorMap, disagreementIndex, signalCheck, minerHealth, auditAnchors } from "../lib/network.mjs";
import { readFeed, summariseFeed } from "../lib/feed.mjs";
import { FEED_ATTESTERS } from "./feed.js";

const NODE = "https://devnode.telegraphprotocol.com";
const SITE = "https://takar-telegraph.vercel.app";
const cache = new Map(); // ponytail: per instance, 10 min; the registry and feed change slowly
const cached = async (k, ms, f) => {
  const c = cache.get(k);
  if (c && Date.now() - c.at < ms) return c.v;
  const v = await f();
  cache.set(k, { at: Date.now(), v });
  return v;
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  const view = String(req.query?.view ?? "operators");
  try {
    if (view === "operators") {
      const miners = await cached("miners", 600_000, () => fetch(`${NODE}/api/miners`, { signal: AbortSignal.timeout(20_000) }).then((r) => r.json()));
      const map = operatorMap(Array.isArray(miners) ? miners : miners.miners ?? []);
      res.setHeader("Cache-Control", "s-maxage=600");
      return res.status(200).json({ source: `${NODE}/api/miners`, read_at: new Date(cache.get("miners").at).toISOString(), note: "An operator is a fee address. Two miners paying the same address are one operator here; that may be one team or a platform account, and the registry does not say which.", ...map });
    }
    if (view === "disagreement") {
      const rows = await cached("feed", 120_000, () => readFeed(FEED_ATTESTERS));
      res.setHeader("Cache-Control", "s-maxage=120");
      return res.status(200).json({ source: "Takar's second-opinion feed on EAS (/api/feed)", note: "Each comparison is two miners from different operators on the same question; insufficient pairs (one answer unusable) are not counted.", ...disagreementIndex(summariseFeed(rows)) });
    }
    if (view === "signal") {
      const [ledgerText, anchorsText] = await Promise.all([
        cached("ledger", 120_000, () => fetch(`${SITE}/receipts/ledger.jsonl`).then((r) => r.text())),
        cached("anchors", 120_000, () => fetch(`${SITE}/receipts/anchors.jsonl`).then((r) => r.text())),
      ]);
      const anchors = anchorsText.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
      const out = await signalCheck(String(req.query?.hash ?? ""), { ledgerText, anchors, nodeFetch: (h) => fetch(`${NODE}/engine/v1/signal/${h}`, { signal: AbortSignal.timeout(15_000) }) });
      return res.status(200).json(out);
    }
    if (view === "audit") {
      const [ledgerText, anchorsText] = await Promise.all([
        cached("ledger", 120_000, () => fetch(`${SITE}/receipts/ledger.jsonl`).then((r) => r.text())),
        cached("anchors", 120_000, () => fetch(`${SITE}/receipts/anchors.jsonl`).then((r) => r.text())),
      ]);
      res.setHeader("Cache-Control", "s-maxage=300");
      return res.status(200).json({ note: "Every ledger root anchored on EAS, recomputed from today's ledger. A mismatch means an older line was edited, removed or reordered after it was anchored.", ...auditAnchors(ledgerText, anchorsText.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))) });
    }
    if (view === "miners") {
      const ledgerText = await cached("ledger", 120_000, () => fetch(`${SITE}/receipts/ledger.jsonl`).then((r) => r.text()));
      res.setHeader("Cache-Control", "s-maxage=300");
      return res.status(200).json({ source: "Takar's paid ledger, last 7 days", note: "Answered = the miner returned a paid result. Complete = every field the intent needs came back ok. Floor = lower bound of the 95% interval for complete. Measured by a paying client, not reported by the operator.", miners: minerHealth(ledgerText, { days: 7 }) });
    }
    return res.status(400).json({ error: "view must be operators, disagreement signal or miners" });
  } catch (err) {
    return res.status(err.status === 400 ? 400 : 503).json({ error: String(err.message).slice(0, 200) });
  }
}
