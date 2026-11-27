// Gold Rush: who controls each mine today, from Sadiq's two miners (identity 731005, sanctions 731002).
// The current tenure holders come from the Queensland register (already in each dossier); each is
// resolved to a registered entity and screened, both direct asks by id, each with its own receipt.
// Scope, as Sadiq states it: the current registered entity only, lists as published (no ownership
// chain, PEP or adverse media).
//
//   node --env-file=.env scripts/controller-run.mjs [mine-slug ...]   -> receipts/controller-<slug>.json
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { ask, NODE } from "../lib/telegraph.mjs";
import { sameEntity } from "../lib/trade.mjs";

const wanted = process.argv.slice(2);
const files = readdirSync("receipts").filter((n) => /^dossier-[a-z0-9-]+\.json$/.test(n)).filter((n) => !wanted.length || wanted.includes(n.slice(8, -5)));

/** The node shapes the answer to the intent; the miner's own fields (LEI, status) are in the signal's raw response. */
async function raw(signal) {
  if (!signal) return {};
  const r = await fetch(`${NODE}/engine/v1/signal/${signal}`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  return r?.ok ? (await r.json()).payload?.response ?? {} : {};
}

const COMPANY = /\b(pty|ltd|limited|inc|corp|corporation|company|co|plc|llc|nl|holdings|group|trust)\b/i;

async function controller(holder) {
  const row = { holder_name: holder, legal_name: null, entity_id: null, jurisdiction: null, status: null, screened: null, source_ref: "miner:731005+731002", receipts: [], checked_at: new Date().toISOString() };
  // A natural person on the register ("Surname, Given") is not an entity to resolve, and screening a
  // private individual's name is not this report's job.
  if (!COMPANY.test(holder) && /,/.test(holder)) return { holder_name: "an individual (name withheld)", individual: true, note: "an individual holds this tenure: not resolved to a company and not screened", checked_at: row.checked_at };
  try {
    const id = await ask({ intent: "B2B_IDENTITY_ENRICHMENT_GENERAL", params: { company: holder }, minerId: 731005, unit: "goldrush-controller", purpose: `goldrush:controller ${holder}` });
    const x = await raw(id.signal_hash);
    Object.assign(row, { legal_name: x.legal_name ?? null, entity_id: x.lei ?? null, jurisdiction: x.jurisdiction ?? null, status: x.status ?? null, headquarters: id.result?.headquarters ?? x.headquarters ?? null });
    row.receipts.push({ miner: 731005, signal: id.signal_hash ?? null });
    if (row.legal_name && !sameEntity(holder, row.legal_name)) {
      row.identity_mismatch = `731005 returned ${row.legal_name} (${row.entity_id}), which is not the register's holder: not used`;
      Object.assign(row, { legal_name: null, entity_id: null, jurisdiction: null, status: null });
    }
  } catch (e) { row.identity_error = e.message.slice(0, 160); }
  try {
    const sc = await ask({ intent: "SANCTIONS_SCREENING_MATCH_GENERAL", params: { name: row.legal_name ?? holder }, minerId: 731002, unit: "goldrush-controller", purpose: `goldrush:controller-screen ${holder}` });
    row.screened = { result: sc.result?.matched === false ? "no match" : sc.result?.matched === true ? "match" : "unclear", match_score: sc.result?.match_score ?? null, lists: sc.result?.lists ?? [], note: "lists as published; not ownership or adverse media" };
    row.receipts.push({ miner: 731002, signal: sc.signal_hash ?? null });
  } catch (e) { row.screen_error = e.message.slice(0, 160); }
  return row;
}

for (const f of files) {
  const slug = f.slice(8, -5);
  const d = JSON.parse(readFileSync(`receipts/${f}`, "utf8")).dossier;
  const holders = Object.keys(d.tenure?.holders ?? {});
  const rows = [];
  for (const h of holders) rows.push(await controller(h));
  const doc = { title: `Who controls ${d.mine} today`, mine: d.mine, method: "Current tenure holders from the Queensland register (MinesPermitsCurrent), each resolved by Sadiq's identity miner 731005 and screened by 731002, direct asks by id.", scope: "current registered entity only; the historical company chain is not established here", generated_at: new Date().toISOString(), controller_identity: rows, gaps: holders.length ? [] : ["no current tenure over the site in the Queensland register"] };
  writeFileSync(`receipts/controller-${slug}.json`, JSON.stringify(doc, null, 2) + "\n");
  console.log(`${d.mine.padEnd(16)} ${rows.map((r) => `${r.holder_name} -> ${r.legal_name ?? "?"} ${r.entity_id ?? ""} ${r.status ?? ""}; screen ${r.screened?.result ?? r.screen_error}`).join(" | ") || "no current holder"}`);
}
