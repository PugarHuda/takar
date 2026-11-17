// Takar Outcome miner endpoint (Telegraph EVENT_OUTCOME_RESOLUTION_GENERAL).
//
//   POST /api/resolve   {"event": "Did Max Verstappen win the 2025 Japanese Grand Prix?"}
//   GET  /api/resolve?event=...
//
// Answers in the intent's own fields: event, outcome (yes|no|unresolved),
// resolved_yes, winner, resolved_at, sources, plus the verbatim evidence.
// 400 for a bad request, 503 when no model is available (so the caller is not
// charged for a non-answer). Resolution logic lives in lib/outcome.mjs.
import { resolve, openrouter } from "../lib/outcome.mjs";

// Per-instance memory: serverless instances are short-lived, so this only
// smooths repeats and bursts. The node's own cache_ttl_sec does the rest.
const cache = new Map(); // ponytail: in-memory per instance; Upstash if repeats get expensive
const CACHE_MS = 6 * 3600_000;
const hits = new Map();
const PER_MIN = Number(process.env.TAKAR_RATE_PER_MIN ?? 30);

function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > PER_MIN;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ error: "use POST with {\"event\": \"...\"}" });

  const ip = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return res.status(429).json({ error: `rate limit: ${PER_MIN} requests per minute` });

  // Normalise once and use the same string for the cache key and for resolving,
  // so a cached answer is always the answer to exactly this text.
  const event = String((req.method === "POST" ? req.body?.event : req.query?.event) ?? "").replace(/\s+/g, " ").trim();
  if (!event) return res.status(400).json({ error: "event is required", example: { event: "Did Max Verstappen win the 2025 Japanese Grand Prix?" } });

  const cached = cache.get(event);
  if (cached && Date.now() - cached.at < cached.ttl) return res.status(200).json({ ...cached.answer, cached: true });

  try {
    const answer = await resolve(event, { llm: openrouter() });
    answer.resolver = "takar-outcome/0.1";
    answer.checked_at = new Date().toISOString();
    // An unresolved answer may resolve later (or was a model hiccup): keep it briefly.
    cache.set(event, { at: Date.now(), ttl: answer.outcome === "unresolved" ? 15 * 60_000 : CACHE_MS, answer });
    return res.status(200).json(answer);
  } catch (err) {
    const status = err.status === 400 ? 400 : 503;
    return res.status(status).json({ error: err.message });
  }
}
