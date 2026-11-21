// GET /api/feed -> every second opinion Takar has given, from EAS: how many calls, which
// intents, which self-declared clients, and the latest disagreements with both signals.
import { readFeed, summariseFeed, FEED_UID } from "../lib/feed.mjs";

// Only Takar's own payer writes the feed; anyone can attest to an open schema, so the reader filters.
export const FEED_ATTESTERS = (process.env.TAKAR_FEED_ATTESTERS ?? "0x9cBDD9Cac5382d2cfe65669e5045C2D3dee6327E").split(",").map((a) => a.trim()).filter(Boolean);
let cache = { at: 0, rows: [] };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  try {
    if (Date.now() - cache.at > 60_000) cache = { at: Date.now(), rows: await readFeed(FEED_ATTESTERS) };
    res.setHeader("Cache-Control", "s-maxage=60");
    return res.status(200).json({ schema: `https://sepolia.easscan.org/schema/view/${FEED_UID}`, attesters: FEED_ATTESTERS, ...summariseFeed(cache.rows) });
  } catch (err) {
    return res.status(503).json({ error: String(err.message).slice(0, 200) });
  }
}
