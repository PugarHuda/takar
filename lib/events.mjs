// Events and people at a mine, from original records: the Queensland Heritage Register's own history
// text for each place (data/heritage-history.json), cited by record ID. Pure functions, no network.
//
// Every event is one sentence quoted word for word from a register entry, typed by fixed rules, with
// the year the sentence names. Nothing is summarised or inferred: a sentence that names no year has
// year null, and a mine with no register entry gets no events, which the caller reports as a gap.
import { readFileSync } from "node:fs";

export const REGISTER = "Queensland Heritage Register";
export const ENTRY_URL = (ref) => `https://apps.des.qld.gov.au/heritage-register/detail/?id=${ref}`;

// Order matters only for display; one sentence can carry several types.
export const TYPES = [
  ["accident or death", /\b(killed|died|death|deaths|fatal\w*|accident\w*|explosion|disaster|injur\w+|drown\w*)\b/i],
  ["fire", /\bfires?\b|\bburnt\b|\bburned\b/i],
  ["flood or weather", /\b(flood\w*|inrush|cyclone|storm|drought|water (problems?|ingress))\b/i],
  ["strike or dispute", /\b(strikes?|unrest|dispute\w*|union\w*|lock-?out|industrial action|protest\w*|petition\w*)\b/i],
  ["ownership", /\b(syndicate|compan(y|ies) (was|were) (formed|registered|floated)|formed a (new )?company|sold (their|its|the)|purchased|acquired|took over|taken over|ownership|joint venture|shareholders?|floated|liquidat\w+|receivership)\b/i],
  ["closure", /\b(closed|closure|ceased|abandoned|shut down|demise|wound up|suspended)\b/i],
  ["restart", /\b(re-?opened|restart\w*|resum\w+|revived|revival|recommenced|re-?treat\w*|tailings retreatment|new era)\b/i],
  ["workforce", /\b(\d[\d,]* (men|miners|workers|employees)|workforce|employed)\b/i],
];

const YEAR = /\b(18[4-9]\d|19\d\d|20[0-2]\d)\b/;
// Capitalised runs that are people's names in these texts: an initial or a first name, then a surname.
// ponytail: a regex with a stop list, not NER; every name keeps the sentence it came from, so a wrong
// pick is visible, and names are reported as "named in the record", never as roles.
const STOP = new Set(["Mount", "Mt", "Queensland", "Company", "Limited", "Ltd", "Mining", "Gold", "Mine", "Mines", "Charters", "Towers", "Government", "Department", "Battery", "State", "Street", "Creek", "River", "Hill", "Australia", "Australian", "British", "Rockhampton", "Brisbane", "Ravenswood", "Kidston", "Heritage", "Register", "Exchange", "School", "Works", "Smelter", "Township", "Proprietary", "Pty", "North", "South", "East", "West", "New", "Great", "World", "War", "The", "In", "By", "From", "After", "Before", "During", "This", "These", "When", "Its", "Day", "Dawn", "Joint", "Venture", "Natural", "Resources", "Mines", "Shire", "Council", "Hotel", "Bank", "Office", "Post", "Railway", "Mill", "Shaft", "Reef", "Field", "Goldfield", "United", "Kingdom", "Ironstone", "Mountain", "Agreement", "Stack", "Black", "Friday", "Great", "Depression", "Main", "Assay", "Melbourne", "London", "Board", "Directors", "Commonwealth", "Minister", "Premier", "Parliament", "Act", "Aboriginal", "Chinese", "European", "Cyanide", "Plant", "Open", "Cut", "Copper", "Downs", "Tasmania", "Queenstown", "Seam", "Blow", "Ore", "Places", "Ranges", "Range", "Valley", "Coal", "Co", "Fire", "Sunday", "Monday", "Yellow", "Big", "Little", "Industrial", "Dee", "Gully", "Flat", "Point", "Island", "Lode", "Plateau", "Leyshon", "Croydon", "Coolon", "Gympie", "Townsville", "Cairns", "Mackay", "Bowen", "Clermont", "Hall", "Hotel", "Church", "Cemetery", "Hospital", "Theatre", "Club", "Lodge", "Masonic", "Union", "Labor", "Party", "Mines", "Inspector", "Warden", "Report", "Annual", "Royal", "Commission", "Arsenic", "Chlorination", "Cyanidation", "Treatment", "Electric", "Winding", "Engine", "Power", "Station", "Dam", "Lake", "Bay", "Harbour", "Port", "Gladstone", "Bundaberg", "Maryborough", "Sydney", "Victoria", "Victorian", "Wales", "Scottish", "English", "Irish", "German", "American", "Colonial", "Exhibition", "Ingersoll", "Rand", "General"]);
export function peopleIn(sentence) {
  const out = new Set();
  const re = /\b((?:[A-Z]\.\s?){1,3}[A-Z][a-z]+(?:\s[A-Z][a-z]+)?|[A-Z][a-z]{2,}(?:\s(?:[A-Z]\.\s?)?[A-Z][a-z']+){1,2})\b/g;
  for (const m of String(sentence).matchAll(re)) {
    const words = m[1].replace(/\./g, " ").split(/\s+/).filter(Boolean);
    if (words.some((w) => STOP.has(w))) continue;
    if (words.length < 2) continue;
    // A capitalised run before "mine", "lease", "reef"... or after "the" is a working or a place, not a person.
    const before = String(sentence).slice(Math.max(0, m.index - 5), m.index);
    const after = String(sentence).slice(m.index + m[1].length, m.index + m[1].length + 24);
    if (/\bthe\s$/i.test(before) || /^\s*(mine|mines|lease|leases|reef|battery|shaft|claim|company|district|camp|area|extended|consolidated|no\.?|rush|springs|mill|tramway|lode|line|road|street|creek|hotel|building|works|group|field|goldfield|university|council)\b/i.test(after)) continue;
    if (/^(Although|However|Because|Since|While|Following|Despite|Between|Under|Within)\b/.test(m[1])) continue;
    out.add(m[1].trim());
  }
  return [...out];
}

/** Split a register history into sentences (keeps "W.K. D'Arcy" and "No. 3" whole). */
export function sentences(text) {
  return String(text ?? "")
    .replace(/\b([A-Z])\.\s?(?=[A-Z])/g, "$1.\u0000")
    .replace(/\b(No|Mt|St|Dr|Mr|Mrs|Co|Ltd|Pty)\.\s/g, "$1.\u0001")
    .split(/(?<=[.!?])\s+(?=[A-Z"'(\[])/)
    .map((s) => s.replace(/\u0000/g, "").replace(/\u0001/g, " ").trim())
    .filter((s) => s.length > 20);
}

/** Typed events from one register entry; `only` keeps sentences that name the mine (for town entries). */
export function eventsFrom(place, { only = null } = {}) {
  const events = [];
  sentences(place.history).forEach((s, i) => {
    if (only && !only.test(s)) return;
    const types = TYPES.filter(([, re]) => re.test(s)).map(([t]) => t);
    const people = peopleIn(s);
    if (!types.length && !people.length) return;
    const year = Number(s.match(YEAR)?.[1] ?? NaN);
    events.push({
      id: `qhr-${place.ref}-s${i + 1}`,
      types: types.length ? types : ["people"],
      year: Number.isFinite(year) ? year : null,
      quote: s,
      people,
      source: { register: REGISTER, record_id: String(place.ref), entry: place.name, url: ENTRY_URL(place.ref), sentence: i + 1 },
    });
  });
  return events;
}

let cache = null;
export const loadHistory = () => (cache ??= JSON.parse(readFileSync(new URL("../data/heritage-history.json", import.meta.url), "utf8")));

/**
 * Events for a mine: every sentence of the entries the dossier already matched by name, plus sentences
 * that name the mine in any other mining entry (a town's battery or exchange often tells its story).
 */
export function eventsForMine(mine, heritageRefs = [], places = loadHistory().places) {
  const word = String(mine).replace(/^(Mount|Mt)\s+/i, "").split(/\s+/)[0];
  const named = new RegExp(`\\b${String(mine).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/^Mount\b/i, "(Mount|Mt\\.?)")}\\b`, "i");
  const own = new Set(heritageRefs.filter((h) => h.why === "name").map((h) => String(h.ref)));
  const out = [];
  for (const p of places) {
    if (own.has(String(p.ref))) out.push(...eventsFrom(p));
    else if (named.test(p.history) && word.length > 3) out.push(...eventsFrom(p, { only: named }));
  }
  const seen = new Set();
  return out.filter((e) => (seen.has(e.quote) ? false : seen.add(e.quote))).sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
}
