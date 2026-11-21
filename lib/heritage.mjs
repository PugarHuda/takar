// Heritage-listed places that belong to a mine: the Queensland Heritage Register (extract in
// data/heritage-mining.json, from data.qld.gov.au). The register has no coordinates, so a place
// matches by name, or by town when the survey puts the mine within 5 km of that town.
import { readFileSync } from "node:fs";

export const QHR_SEARCH = "https://qhr.detsi.qld.gov.au/map";
let cache = null;
const load = () => (cache ??= JSON.parse(readFileSync(new URL("../data/heritage-mining.json", import.meta.url), "utf8")));
const norm = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** The town the survey's locality names, if the mine is within `maxKm` of it ("1.1 KM ESE OF CHARTERS TOWERS"). */
export function nearTown(locality, maxKm = 5) {
  const m = String(locality ?? "").toUpperCase().match(/([\d.]+)\s*KM\s+[A-Z-]+\s+OF\s+([A-Z' ]+?)(?:[.,]|$)/);
  if (!m) return null;
  return Number(m[1]) <= maxKm ? norm(m[2]) : null;
}

export function heritageFor(mine, locality, places = load().places) {
  const name = norm(mine);
  const town = nearTown(locality);
  const hits = places.filter((p) => {
    const names = [p.name, ...(p.alt ?? [])].map(norm);
    return names.some((n) => n.includes(name)) || norm(p.suburb) === name || (town && norm(p.suburb) === town);
  });
  return hits.map((p) => ({ ref: p.ref, name: p.name, suburb: p.suburb, entered: p.entered, why: [p.name, ...(p.alt ?? [])].map(norm).some((n) => n.includes(name)) || norm(p.suburb) === name ? "name" : `town (${town})` }));
}
