// Extract mining-related places from the Queensland Heritage Register XML (data.qld.gov.au,
// "The Queensland heritage register", 28 MB) into data/heritage-mining.json (name, suburb,
// LGA, register number, entry date). Run when the register is updated:
//   node scripts/heritage-extract.mjs <path to heritage-register-2025.xml>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const xml = readFileSync(process.argv[2], "utf8");
const MINING = /\b(mine|mines|mining|gold|battery|shaft|shafts|mill|smelter|smelters|works|poppet|headframe|diggings|goldfield|tramway|reef|lode|dredge|cyanide|assay|treatment|crusher)\b/i;
const tag = (b, t) => (b.match(new RegExp(`<${t}>([^<]*)</${t}>`)) ?? [])[1]?.replace(/&amp;/g, "&").trim() ?? null;
const places = [];
for (const m of xml.matchAll(/<place [^>]*>[\s\S]*?<\/place>/g)) {
  const b = m[0];
  const name = tag(b, "name");
  const alt = [...b.matchAll(/<alternate_name>([^<]*)<\/alternate_name>/g)].map((x) => x[1].replace(/&amp;/g, "&").trim());
  if (!MINING.test([name, ...alt].join(" "))) continue;
  places.push({ ref: tag(b, "place_ref"), name, alt, suburb: tag(b, "suburb"), lga: tag(b, "lga"), entered: tag(b, "register_entry_date")?.slice(0, 10) ?? null });
}
mkdirSync("data", { recursive: true });
writeFileSync("data/heritage-mining.json", JSON.stringify({ source: "https://www.data.qld.gov.au/dataset/the-queensland-heritage-register", extracted_at: new Date().toISOString(), places }) + "\n");
console.log(`${places.length} mining-related heritage places`);
