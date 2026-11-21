// GET /api/reputation?intent=EVENT_OUTCOME_RESOLUTION_GENERAL[&attester=0x...]
//
// Which miner to ask: Telegraph miners for an intent, ranked by the open EAS
// record of how their answers held up (Wilson lower bound of accuracy; honest
// abstentions are coverage, not error). Free, read-only.
import { readAttestations, rank } from "../lib/reputation.mjs";
import { SCHEMA_UID } from "./second-opinion.js";

let cache = { at: 0, atts: [] };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  const intent = req.query?.intent ? String(req.query.intent) : undefined;
  const attester = req.query?.attester ? String(req.query.attester) : undefined;
  if (intent && !/^[A-Z][A-Z0-9_]{2,80}$/.test(intent)) return res.status(400).json({ error: "bad intent name" });
  if (attester && !/^0x[0-9a-fA-F]{40}$/.test(attester)) return res.status(400).json({ error: "bad attester address" });
  try {
    if (Date.now() - cache.at > 5 * 60_000) cache = { at: Date.now(), atts: await readAttestations(SCHEMA_UID) };
    const intents = [...new Set(cache.atts.map((a) => a.intent))];
    res.setHeader("Cache-Control", "s-maxage=300");
    return res.status(200).json({
      schema: `https://sepolia.easscan.org/schema/view/${SCHEMA_UID}`,
      attestations: cache.atts.length,
      intents,
      ranking: intent ? rank(cache.atts, { intent, attesters: attester ? [attester] : undefined }) : undefined,
      how_to_add_evidence: "Attest to the schema on Ethereum Sepolia with (intent, minerId, signal, verdict 1 right / 2 wrong / 3 unusable / 4 wrong place / 5 abstained, truthSource). Readers can filter by attester.",
    });
  } catch (err) {
    return res.status(503).json({ error: String(err.message).slice(0, 200) });
  }
}
