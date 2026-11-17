// First Takar purchase: buy a recorded-weather answer through Telegraph's
// ranked route, then hold it against a free official record (Open-Meteo).
//
//   node --env-file=.env scripts/first-ask.mjs [place] [YYYY-MM-DD]
//
// Costs one $0.01 test-USDC ask on Ethereum Sepolia.
import { ask } from "../lib/telegraph.mjs";
import { geocode, nearestStation, reports, dayExtremes } from "../lib/observe.mjs";

const place = process.argv[2] ?? "Jakarta";
const date = process.argv[3] ?? new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
const TOL_C = 2; // ponytail: same ±2 °C bar other weather builders publish; tune per climate

// Measured at an airport station (METAR), not modelled: a miner that copies a
// weather model cannot agree with this by construction. (The first run used
// Open-Meteo and matched TxLens to the decimal, which proved nothing.)
async function officialRecord(name, day) {
  const g = await geocode(name);
  const s = await nearestStation(g);
  if (!s) throw new Error(`no METAR station near ${name}`);
  const hours = Math.min(360, Math.ceil((Date.now() - Date.parse(day)) / 3_600_000) + 30);
  const ext = dayExtremes(await reports(s.icao, hours), day, g.timezone);
  if (!ext) throw new Error(`no ${s.icao} reports on ${day}`);
  return { source: `METAR ${s.icao} (${s.site}, ${s.km} km)`, ...ext };
}

const [bought, official] = await Promise.all([
  ask({ intent: "WEATHER_FORECAST_VERIFY_GENERAL", params: { location: place, date }, purpose: "takar first integration: recorded weather vs official record" }),
  officialRecord(place, date),
]);

const r = bought.result ?? {};
const diff = typeof r.temp_max_c === "number" ? +Math.abs(r.temp_max_c - official.temp_max_c).toFixed(1) : null;
const verdict = diff === null ? "UNKNOWN (no readable temp_max_c)" : diff <= TOL_C ? "AGREES" : "CONTRADICTED";

console.log(JSON.stringify({
  asked: { intent: "WEATHER_FORECAST_VERIFY_GENERAL", location: place, date },
  bought: { miner: bought.ledger.miner, result: r, field_status: bought.field_status, cost_usd: bought.cost_usd, signal_hash: bought.signal_hash },
  receipt: { settlement_tx: bought.ledger.settlementTx && `https://sepolia.etherscan.io/tx/${bought.ledger.settlementTx}`, signal: bought.signal_hash && `https://devnode.telegraphprotocol.com/engine/v1/signal/${bought.signal_hash}` },
  official,
  check: { temp_max_diff_c: diff, tolerance_c: TOL_C, verdict },
}, null, 2));
