// Gold Rush dossiers: one Queensland gold mine each, built from Telegraph miners.
//
//   node --env-file=.env scripts/dossier-run.mjs ["Mount Morgan" "Brilliant Lode" ...]
//
// Per mine, bought through Telegraph by id (receipts in receipts/ledger.jsonl):
// goldrush-qld-history (production, closure, owners; and the gold price in the closure
// year and the latest month), OathCast (the survey's live MINOCC record and size band),
// two company registers per owner, and research miners for closures no record explains.
// Tenure comes from the Queensland register directly (free). The structured rows come from
// goldrush's own registered endpoint (same miner, unpaid direct call); the dossier checks which
// of its figures also appear in the paid answer. Writes receipts/dossier-<slug>.json (signed),
// dossiers/<slug>.md and dossiers/index.json. A mine that fails is reported and skipped.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { ask, ranked } from "../lib/telegraph.mjs";
import { gatherDossier } from "../lib/goldrush.mjs";
import { renderMarkdown } from "../lib/dossier.mjs";
import { signDoc } from "../lib/sign.mjs";

const MINES = process.argv.slice(2).length ? process.argv.slice(2) : ["Mount Morgan", "Brilliant Lode", "Mount Leyshon"];
const key = process.env.TAKAR_SIGNING_KEY;
if (!key) throw new Error("TAKAR_SIGNING_KEY missing");
const run = new Date().toISOString();
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
mkdirSync("dossiers", { recursive: true });
const INDEX = "dossiers/index.json";
const index = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, "utf8")) : [];
let now = null;
for (const mine of MINES) {
  try {
    const g = await gatherDossier(mine, { ask, ranked, run, now });
    if (now) g.doc.receipts.push({ ...now.receipt, rank: null, shared: "latest gold price, bought once for this run" });
    now = g.now;
    writeFileSync(`receipts/dossier-${slug(mine)}.json`, JSON.stringify({ ...g.doc, attestation: signDoc(g.doc, key) }, null, 2) + "\n");
    writeFileSync(`dossiers/${slug(mine)}.md`, renderMarkdown(g.doc.dossier, { generated_at: run, receipts: g.doc.receipts }));
    const d = g.doc.dossier;
    const entry = { slug: slug(mine), name: d.identity.name ?? mine, site_no: d.identity.history_site_no, pairs: d.production.pairs.map((p) => p.relation), open: d.open_questions.length };
    const i = index.findIndex((x) => x.slug === entry.slug);
    if (i >= 0) index[i] = entry; else index.push(entry);
    console.log(`${mine}: site ${d.identity.history_site_no}, ${d.production.pairs.map((p) => p.relation).join(", ") || "one register"}; ${d.open_questions.length} open questions`);
  } catch (err) {
    console.log(`${mine}: skipped (${String(err.message).slice(0, 160)})`);
  }
}
writeFileSync(INDEX, JSON.stringify(index, null, 1) + "\n");
