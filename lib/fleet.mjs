// Takar fleet: machines with a budget line (Telegraph Season II, Mission 11).
//
// Each unit, before it acts, buys the intelligence its task needs through
// Telegraph's ranked route, holds every answer against an independent station
// observation where one exists, and decides GO / HOLD / ABORT. Rules fail
// closed: no readable answer, no budget left, or a station that contradicts the
// answer never produces GO.
//
// Decision functions are pure (answers in, verdict out) so they are testable
// without a network; runUnit() does the buying through an injected `ask`.

export const PRICE_USD = 0.01;
const finite = (x) => (Number.isFinite(x) ? x : 0);

// Allowlist, not denylist: only these risk levels can fly. Anything else the
// shaper might produce (a new enum value, a typo, a lowercase variant) holds.
const FLYABLE = new Set(["LOW", "MODERATE"]);
const RISK_ON_FAIL = { SEVERE: "ABORT" };
const num = (x) => typeof x === "number" && Number.isFinite(x);

/** Drone / outdoor flight: storm risk for the task window, cross-checked by station wind. */
export function decideFlight(limits, storm, station) {
  const reasons = [];
  let decision = "GO";
  const worse = (d) => { if (rank(d) > rank(decision)) decision = d; };

  if (!storm || storm.risk_level == null) {
    worse("HOLD"); reasons.push("no readable storm answer: fail closed");
  } else {
    if (!FLYABLE.has(storm.risk_level)) {
      worse(RISK_ON_FAIL[storm.risk_level] ?? "HOLD"); reasons.push(`storm risk ${storm.risk_level}`);
    }
    if (!num(storm.peak_gust_kmh)) {
      worse("HOLD"); reasons.push("no readable forecast gust: fail closed");
    } else if (storm.peak_gust_kmh > limits.maxGustKmh) {
      worse("HOLD"); reasons.push(`forecast gust ${storm.peak_gust_kmh} km/h > ${limits.maxGustKmh}`);
    }
  }
  const contradictions = [];
  const measured = station && [station.wind_kmh, station.gust_kmh].filter(num);
  if (station && !measured.length) {
    reasons.push(`station ${station.icao} reported no wind value: answer unconfirmed`);
  } else if (station) {
    const observed = Math.max(...measured);
    if (observed > limits.maxGustKmh) {
      worse("HOLD"); reasons.push(`station ${station.icao} wind ${observed} km/h now > ${limits.maxGustKmh}`);
      if (storm?.risk_level === "LOW") contradictions.push(`miner said LOW risk while ${station.icao} measured ${observed} km/h`);
    } else {
      reasons.push(`station ${station.icao} measures ${observed} km/h now, within ${limits.maxGustKmh}`);
    }
  } else {
    reasons.push("no station within range: answer unconfirmed");
  }
  if (decision === "GO") reasons.push("storm risk acceptable for the window");
  return { decision, reasons, contradictions };
}

/** Field robot (spraying, harvest): rain probability over the work window. */
export function decideFieldWork(limits, forecast, recent) {
  if (!forecast || typeof forecast.precipitation_probability_pct !== "number") {
    return { decision: "HOLD", reasons: ["no readable rain probability: fail closed"], contradictions: [] };
  }
  const p = forecast.precipitation_probability_pct;
  const reasons = [];
  let decision = "GO";
  if (p > limits.maxRainPct) { decision = "HOLD"; reasons.push(`rain probability ${p}% > ${limits.maxRainPct}% (work would be wasted)`); }
  else reasons.push(`rain probability ${p}% within ${limits.maxRainPct}%`);
  // Yesterday's recorded rain: spray on soaked ground or wet leaves runs off,
  // however dry today looks. Only checked when the unit sets a limit for it.
  if (limits.maxRecentRainMm != null) {
    const mm = recent?.precipitation_mm;
    if (typeof mm !== "number") { decision = "HOLD"; reasons.push("no readable record of yesterday's rain: fail closed"); }
    else if (mm > limits.maxRecentRainMm) { decision = "HOLD"; reasons.push(`${mm} mm recorded yesterday > ${limits.maxRecentRainMm} mm (ground too wet)`); }
    else reasons.push(`${mm} mm recorded yesterday, within ${limits.maxRecentRainMm} mm`);
  }
  return { decision, reasons, contradictions: [] };
}

/** Ground cargo rover: route time plus storm risk at the destination. */
export function decideDelivery(limits, eta, storm) {
  const flight = decideFlight({ maxGustKmh: limits.maxGustKmh }, storm, null);
  const reasons = flight.reasons.filter((r) => !r.startsWith("no station"));
  let decision = flight.decision;
  if (!eta || typeof eta.duration !== "number") {
    if (decision === "GO") decision = "HOLD";
    reasons.push("no readable route time: fail closed");
  } else if (eta.duration / 3600 > limits.maxHours) {
    if (decision === "GO") decision = "HOLD";
    reasons.push(`route ${(eta.duration / 3600).toFixed(1)} h > ${limits.maxHours} h shift`);
  } else {
    reasons.push(`route ${(eta.duration / 3600).toFixed(1)} h within shift`);
  }
  return { decision, reasons, contradictions: flight.contradictions };
}

const ORDER = ["GO", "HOLD", "ABORT"];
const rank = (d) => ORDER.indexOf(d);

/** What each unit type buys before it acts. */
export function plan(unit, now = new Date()) {
  const w = unit.task.hours;
  const yesterday = new Date(now.getTime() - 864e5).toISOString().slice(0, 10);
  switch (unit.type) {
    case "drone": return [{ key: "storm", intent: "STORM_ALERT_GENERAL", params: { location: unit.location, window_hours: w } }];
    case "field-robot": return [
      { key: "forecast", intent: "WEATHER_FORECAST_GENERAL", params: { location: unit.location, window_hours: w } },
      // What actually fell yesterday (Mission 11's own intent), only when the unit cares.
      ...(unit.limits.maxRecentRainMm != null ? [{ key: "recent", intent: "WEATHER_FORECAST_VERIFY_GENERAL", params: { location: unit.location, date: yesterday } }] : []),
    ];
    case "rover": return [
      { key: "eta", intent: "ROUTE_ETA_GENERAL", params: { origin: unit.location, destination: unit.task.destination } },
      { key: "storm", intent: "STORM_ALERT_GENERAL", params: { location: unit.task.destination, window_hours: w } },
    ];
    default: throw new Error(`unknown unit type ${unit.type}`);
  }
}

// The fields a decision cannot do without, per intent. An answer missing them is
// unusable no matter how the miner ranks.
const NEEDS = {
  STORM_ALERT_GENERAL: ["risk_level"],
  WEATHER_FORECAST_GENERAL: ["precipitation_probability_pct"],
  ROUTE_ETA_GENERAL: ["duration"],
  WEATHER_FORECAST_VERIFY_GENERAL: ["precipitation_mm"],
};
export const usable = (intent, r) =>
  r?.result_shape === "intent" && (NEEDS[intent] ?? []).every((f) => r.result?.[f] != null);

/**
 * Buy what the unit needs within its budget, then decide.
 *
 * The routed answer comes first. If it is unusable (raw, or missing a field the
 * decision needs), the unit re-buys directly from the next-ranked miner it has
 * not tried, while budget lasts, and records which miner failed it: that record
 * is evidence for the network, not just a retry.
 *
 * `ask`, `observe` and `ranked` are injected: production passes lib/telegraph + lib/observe.
 */
export async function runUnit(unit, { ask, observe, ranked, run, maxTries = 3 }) {
  const bought = {};
  const receipts = [];
  const unusableMiners = [];
  let spent = 0;
  let budgetCut = false;

  for (const need of plan(unit)) {
    const tried = new Set();
    let ladder = null;
    for (let attempt = 0; attempt < maxTries && bought[need.key] == null; attempt++) {
      // Fail closed: a non-finite tally or budget stops buying rather than
      // comparing as false (NaN > x is always false).
      if (!Number.isFinite(spent) || !Number.isFinite(unit.budgetUsd) || spent + PRICE_USD > unit.budgetUsd + 1e-9) { budgetCut = true; break; }
      let minerId;
      if (attempt > 0) {
        ladder ??= ranked ? await ranked(need.intent).catch(() => []) : [];
        minerId = ladder.find((m) => !tried.has(String(m.id)))?.id;
        if (!minerId) break;
        // Mark before asking: a refusal (503) carries no miner in its reply, and
        // an unmarked miner would be asked again on the next attempt.
        tried.add(String(minerId));
      }
      try {
        const r = await ask({ intent: need.intent, params: need.params, minerId, unit: unit.id, run, purpose: `${unit.type}:${unit.task.name}` });
        // Tally what we signed, never less than the list price: a server-reported
        // cost_usd must not be able to shrink the budget we enforce.
        spent += Math.max(PRICE_USD, finite(Number(r.ledger?.paidMicroUsdc) / 1e6), finite(Number(r.cost_usd)));
        const who = r.ledger?.miner;
        if (who) tried.add(String(who.id));
        receipts.push({ intent: need.intent, miner: who, routed: !minerId, signal: r.signal_hash, tx: r.ledger?.settlementTx, shape: r.result_shape, usable: usable(need.intent, r) });
        if (usable(need.intent, r)) bought[need.key] = r.result;
        else unusableMiners.push({ intent: need.intent, miner: who, signal: r.signal_hash, why: r.result_shape === "raw" ? "raw answer, not the intent's shape" : "missing a required field" });
      } catch (err) {
        // A failed ask may still have been charged. Count it unless the node
        // refused before any payment was signed (then possiblyPaid is false and
        // nothing was paid). Unknown failure shape: assume paid.
        const e = err.entry;
        const unpaid = e && Number(e.paidMicroUsdc ?? 0) === 0 && e.possiblyPaid !== true;
        if (!unpaid) spent += Math.max(PRICE_USD, finite(Number(e?.paidMicroUsdc) / 1e6));
        if (err.entry?.miner) tried.add(String(err.entry.miner.id));
        receipts.push({ intent: need.intent, error: err.message.slice(0, 160) });
      }
    }
    bought[need.key] ??= null;
    if (budgetCut) break;
  }

  const station = unit.type === "drone" && observe ? await observe(unit.location).catch(() => null) : null;
  let verdict =
    unit.type === "drone" ? decideFlight(unit.limits, bought.storm, station)
    : unit.type === "field-robot" ? decideFieldWork(unit.limits, bought.forecast, bought.recent)
    : decideDelivery(unit.limits, bought.eta, bought.storm);
  if (budgetCut) verdict = { ...verdict, decision: verdict.decision === "ABORT" ? "ABORT" : "HOLD", reasons: [...verdict.reasons, `budget $${unit.budgetUsd} exhausted before all checks: no intelligence, no go`] };

  return {
    unit: unit.id, type: unit.type, task: unit.task.name, location: unit.location,
    ...verdict, spentUsd: +spent.toFixed(4), costPerOpHourUsd: +(spent / unit.task.hours).toFixed(4),
    // Paid-for answers the unit could not act on: the price of ranking errors, per asset.
    wastedUsd: +(unusableMiners.length * PRICE_USD).toFixed(4),
    station, bought, receipts, unusableMiners,
  };
}
