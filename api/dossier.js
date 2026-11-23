// GET /api/dossier?mine=Mount%20Morgan[&format=md]
//
// A Gold Rush dossier for any Queensland gold mine the survey records, on demand: Telegraph's
// Gold Rush miners asked by id, every finding traced to its record, conflicts shown side by
// side, open questions listed, signed. Takar pays the asks (about $0.04 test USDC), so it is
// rate limited. Testnet only.
import { ethers } from "ethers";
import { ask, ranked, RPC, CHAIN_ID } from "../lib/telegraph.mjs";
import { gatherDossier } from "../lib/goldrush.mjs";
import { renderMarkdown } from "../lib/dossier.mjs";
import { signDoc } from "../lib/sign.mjs";
import { overBudget } from "./second-opinion.js";

const cache = new Map(); // ponytail: per instance, 6 h; a mine's history does not change hourly

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const mine = String(req.query?.mine ?? "").trim();
  if (!/^[\p{L}\p{N} .,'()&-]{2,80}$/u.test(mine)) return res.status(400).json({ error: "?mine=<a Queensland gold mine, e.g. Mount Morgan>" });
  const md = req.query?.format === "md";
  const k = mine.toLowerCase();
  let out = cache.get(k)?.at > Date.now() - 6 * 3600_000 ? cache.get(k).out : null;
  if (!out) {
    const ip = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || "unknown";
    if (overBudget(`dossier:${ip}`, 2, 60)) return res.status(429).json({ error: "rate limit: 2 dossiers a minute per caller" });
    if (!process.env.SERVER_PAYER_KEY) return res.status(503).json({ error: "payer not configured" });
    const signer = new ethers.Wallet(process.env.SERVER_PAYER_KEY, new ethers.JsonRpcProvider(RPC, CHAIN_ID, { staticNetwork: true }));
    try {
      const g = await gatherDossier(mine, { ask: (a) => ask({ ...a, signer }), ranked, unit: "dossier-api", deep: false }) // the public path buys 3-4 asks, never the registry/research fan-out;
      out = process.env.TAKAR_SIGNING_KEY ? { ...g.doc, attestation: signDoc(g.doc, process.env.TAKAR_SIGNING_KEY) } : g.doc;
      cache.set(k, { at: Date.now(), out });
    } catch (err) {
      return res.status(502).json({ error: String(err.message).slice(0, 200) });
    }
  }
  if (md) {
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${k.replace(/[^a-z0-9]+/g, "-")}-dossier.md"`);
    return res.status(200).send(renderMarkdown(out.dossier, { generated_at: out.generated_at, receipts: out.receipts }));
  }
  res.setHeader("Content-Type", "application/json");
  return res.status(200).json(out);
}
