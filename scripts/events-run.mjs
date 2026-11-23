// Events and people for every Gold Rush dossier, from the Queensland Heritage Register's history text,
// each event shipped as a verifiable capsule: the finding, its quote and record ID, signed on its own
// with Takar's Ed25519 key, so an app can show and re-check one finding without the whole dossier.
//
//   node --env-file=.env scripts/events-run.mjs [mine-slug ...]   -> receipts/events-<slug>.json
//
// No paid asks here: these are records. scripts/events-corroborate.mjs (paid) adds research answers.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { eventsForMine, REGISTER, loadHistory } from "../lib/events.mjs";
import { signDoc } from "../lib/sign.mjs";

const key = process.env.TAKAR_SIGNING_KEY;
if (!key) throw new Error("TAKAR_SIGNING_KEY is not set");
const wanted = process.argv.slice(2);
const files = readdirSync("receipts").filter((n) => /^dossier-[a-z0-9-]+\.json$/.test(n)).filter((n) => !wanted.length || wanted.includes(n.slice(8, -5)));
const source = loadHistory();

for (const f of files) {
  const slug = f.slice(8, -5);
  const d = JSON.parse(readFileSync(`receipts/${f}`, "utf8")).dossier;
  const events = eventsForMine(d.mine, d.heritage ?? []);
  // A capsule is self-contained: what is claimed, the exact words it rests on, where to find them.
  const capsules = events.map((e) => {
    const finding = { mine: d.mine, site_no: d.identity?.history_site_no ?? null, id: e.id, types: e.types, year: e.year, people: e.people, quote: e.quote, source: e.source, status: "recorded (one register entry)", source_snapshot: { file: "data/heritage-history.json", extracted_at: source.extracted_at, from: source.source } };
    return { finding, attestation: signDoc(finding, key) };
  });
  const byType = {};
  for (const e of events) for (const t of e.types) byType[t] = (byType[t] ?? 0) + 1;
  const people = [...new Set(events.flatMap((e) => e.people))];
  const gaps = [];
  if (!events.length) gaps.push(`No ${REGISTER} entry tells this mine's story, and no other mining entry names it: events and people are not established from this register. Trove newspapers and mining journals are the next source.`);
  if (events.length && !events.some((e) => e.types.includes("accident or death"))) gaps.push("No accident or death is recorded in the register entries; that is not evidence that none happened.");
  gaps.push("Political connections and donations are not in the register; not established.");
  writeFileSync(`receipts/events-${slug}.json`, JSON.stringify({
    title: `${d.mine}: events and people from original records`,
    mine: d.mine,
    method: `Every sentence of the ${REGISTER} entries matched to this mine (by name), plus sentences in other mining entries that name the mine, typed by fixed rules (lib/events.mjs). Quoted word for word with the record ID; nothing summarised. People are candidate names picked from the quoted sentences by a rule (a run of capitalised words that is not a place, a working or a company); a mine or place name can slip through, so each name keeps its sentence. Each event is a capsule signed on its own (Ed25519 over canonical JSON); verify one with lib/sign.mjs verifyDoc(capsule.finding, capsule.attestation).`,
    generated_at: new Date().toISOString(),
    summary: { events: events.length, by_type: byType, people_named: people.length, records: [...new Set(events.map((e) => e.source.record_id))] },
    people,
    gaps,
    capsules,
  }, null, 2) + "\n");
  console.log(d.mine.padEnd(16), events.length, "events", people.length, "people", JSON.stringify(byType));
}
