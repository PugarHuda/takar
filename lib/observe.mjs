// Independent ground truth for weather answers: airport station reports (METAR)
// from aviationweather.gov. These are measured by instruments at a named station,
// not produced by a model, so they can contradict a miner that copies one.
//
// Free, no key. Geocoding is Open-Meteo's (name -> lat/lon/timezone only).
const UA = { "User-Agent": "takar/0.1 (+telegraph hackathon s2)" };
const KT_TO_KMH = 1.852;

async function json(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  if (res.status === 204) return []; // aviationweather: nothing in range
  return res.json();
}

export async function geocode(place) {
  const find = async (q) => (await json(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1`)).results?.[0];
  // Open-Meteo misses some multi-word names ("Palangka Raya") that it finds joined.
  const g = (await find(place)) ?? (place.includes(" ") ? await find(place.replace(/\s+/g, "")) : null);
  if (!g) throw new Error(`cannot geocode "${place}"`);
  return { name: g.name, lat: g.latitude, lon: g.longitude, timezone: g.timezone };
}

/** Nearest METAR station within ~100 km, or null. */
export async function nearestStation({ lat, lon }) {
  const d = 0.9;
  // The API answers 400 to long float noise like 106.84513000000001.
  const bbox = [lat - d, lon - d, lat + d, lon + d].map((x) => x.toFixed(2)).join(",");
  const list = await json(`https://aviationweather.gov/api/data/stationinfo?bbox=${bbox}&format=json`);
  const metar = list.filter((s) => s.siteType?.includes("METAR"));
  if (!metar.length) return null;
  const dist = (s) => Math.hypot(s.lat - lat, (s.lon - lon) * Math.cos((lat * Math.PI) / 180)) * 111;
  const s = metar.sort((a, b) => dist(a) - dist(b))[0];
  return { icao: s.icaoId, site: s.site, km: Math.round(dist(s)) };
}

export async function reports(icao, hours = 72) {
  return json(`https://aviationweather.gov/api/data/metar?ids=${icao}&format=json&hours=${hours}`);
}

/** Latest observation: wind and gust in km/h, temp in °C. */
export function latest(obs) {
  const m = [...obs].sort((a, b) => Date.parse(b.reportTime) - Date.parse(a.reportTime))[0];
  if (!m) return null;
  const kmh = (kt) => (typeof kt === "number" ? Math.round(kt * KT_TO_KMH) : null);
  return { at: m.reportTime, temp_c: m.temp ?? null, wind_kmh: kmh(m.wspd), gust_kmh: kmh(m.wgst), raw: m.rawOb };
}

/** Max/min temperature over one local calendar day, with how many reports backed it. */
export function dayExtremes(obs, date, timezone) {
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const temps = obs.filter((m) => typeof m.temp === "number" && local.format(new Date(m.reportTime)) === date).map((m) => m.temp);
  if (!temps.length) return null;
  return { temp_max_c: Math.max(...temps), temp_min_c: Math.min(...temps), reports: temps.length };
}
