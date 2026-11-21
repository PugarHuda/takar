// GET /api/miner?id=20261117            -> why a Telegraph miner scored what it scored
// GET /api/miner?id=20261117&format=svg -> a README badge
//
// The scorer's own numbers (anjoman explorer), spot checks and node status, next to the
// open EAS record of how the miner's paid answers held up. Free, read-only.
import { readAttestations, rank } from "../lib/reputation.mjs";
import { minerReport, badge } from "../lib/minerreport.mjs";
import { SCHEMA_UID } from "./second-opinion.js";

const EXPLORER = "https://anjoman.ai/api/explorer";
let reg = { at: 0, list: [] };
let rep = { at: 0, atts: [] };
let served = { at: 0, snaps: [] };
const SERVED = "https://raw.githubusercontent.com/PugarHuda/takar/main/receipts/served.jsonl";
const get = (u) => fetch(u, { signal: AbortSignal.timeout(10_000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const q = String(req.query?.id ?? req.query?.miner ?? "");
  if (!/^[a-z0-9-]{1,64}$/i.test(q)) return res.status(400).json({ error: "?id=<miner id or slug>" });
  if (Date.now() - reg.at > 3600_000) { const l = await get("https://devnode.telegraphprotocol.com/api/miners"); if (Array.isArray(l)) reg = { at: Date.now(), list: l }; }
  const m = reg.list.find((x) => String(x.id) === q || x.slug === q);
  if (!m) return res.status(404).json({ error: "no such miner in the node's registry" });
  if (Date.now() - rep.at > 10 * 60_000) rep = { at: Date.now(), atts: await readAttestations(SCHEMA_UID).catch(() => rep.atts) };

  const slug = encodeURIComponent(m.slug);
  // The node's request counter, snapshotted every two hours by .github/workflows/served.yml.
  if (Date.now() - served.at > 30 * 60_000) { const t = await fetch(SERVED, { signal: AbortSignal.timeout(10_000) }).then((r) => (r.ok ? r.text() : "")).catch(() => ""); served = { at: Date.now(), snaps: t.split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) }; }
  const [scores, checks, statuses, epochs] = await Promise.all([
    get(`${EXPLORER}/scores?miner=${slug}&limit=100`), get(`${EXPLORER}/spot-checks?miner=${slug}&limit=100`), get(`${EXPLORER}/miner-status?miner=${slug}`), get(`${EXPLORER}/epochs?limit=100`),
  ]);
  const intents = [...new Set(rep.atts.filter((a) => a.minerId === String(m.id)).map((a) => a.intent))];
  const evidence = intents.flatMap((intent) => rank(rep.atts, { intent }).filter((r) => r.minerId === String(m.id)).map((r) => ({ ...r, intent })));
  const report = minerReport({ scores: scores?.scores ?? [], checks: checks?.checks ?? [], statuses: statuses?.statuses ?? [], evidence, minerId: m.id, snapshots: served.snaps, epochs: epochs?.epochs ?? [] });

  res.setHeader("Cache-Control", "s-maxage=600");
  if (req.query?.format === "svg") {
    const top = report.filter((r) => r.latest).sort((a, b) => b.latest.score - a.latest.score)[0];
    const paid = report.reduce((s, r) => s + (r.paid_record?.right ?? 0), 0), n = report.reduce((s, r) => s + (r.paid_record ? r.paid_record.right + r.paid_record.wrong + r.paid_record.unusable : 0), 0);
    const value = [top ? `${top.latest.score.toFixed(3)} ep${top.latest.epoch}` : "unscored", n ? `paid ${paid}/${n} right` : null].filter(Boolean).join(" · ");
    res.setHeader("Content-Type", "image/svg+xml");
    return res.status(200).send(badge(`telegraph ${m.slug}`.slice(0, 40), value, !!top && top.latest.score > 0));
  }
  return res.status(200).json({
    miner: { id: String(m.id), slug: m.slug, name: m.name },
    intents: report,
    badge: `https://takar-telegraph.vercel.app/api/miner?id=${m.id}&format=svg`,
    sources: { scores: `${EXPLORER}/scores?miner=${m.slug}`, evidence: `https://sepolia.easscan.org/schema/view/${SCHEMA_UID}` },
  });
}
