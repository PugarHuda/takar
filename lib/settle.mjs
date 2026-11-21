// Takar Settle: conditional payments settled by intelligence bought through Telegraph.
//
//   Mission 14 (Web3 & DeFi)       a conditional escrow that settles on a real-world outcome
//                                  (EVENT_OUTCOME_RESOLUTION)
//   Mission 06 (Resources & Agri)  a parametric drought cover that pays on recorded rainfall
//                                  (WEATHER_FORECAST_VERIFY, one purchase per day of the period)
//
// Both lock test USDC in the TakarSettle contract (onchain/src/TakarSettle.sol) and settle it
// with the Telegraph signal hash as evidence. The rules here are pure, so they are tested
// offline. Each returns `null` when the answer cannot settle the deal: the deal then stays
// open and is retried, and it is never paid on a guess.

/** Mission 14: did the event the deal names happen? */
export function eventCondition(result) {
  const o = String(result?.outcome ?? "").toLowerCase();
  if (o === "yes") return { met: true, why: `Telegraph resolved it yes${result.winner ? ` (${result.winner})` : ""}` };
  if (o === "no") return { met: false, why: "Telegraph resolved it no" };
  return null; // unresolved, unreadable or missing: wait, do not settle
}

/** The days a cover period spans, inclusive, as YYYY-MM-DD. */
export function daysOf(from, to) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 864e5) out.push(new Date(t).toISOString().slice(0, 10));
  if (!out.length || out.length > 31) throw new Error(`cover period ${from}..${to} must be 1 to 31 days`);
  return out;
}

/**
 * Mission 06: a drought cover pays when recorded rain over the period stays under the
 * trigger. Every day must have a readable record: one missing day would make a dry
 * period look drier than it was, so the cover waits instead of paying.
 */
export function droughtCondition(readings, { days, triggerMm }) {
  const byDay = new Map(readings.filter((r) => typeof r?.precipitation_mm === "number" && r.precipitation_mm >= 0).map((r) => [r.date, r.precipitation_mm]));
  const missing = days.filter((d) => !byDay.has(d));
  if (missing.length) return null;
  const total = +days.reduce((s, d) => s + byDay.get(d), 0).toFixed(1);
  return total < triggerMm
    ? { met: true, why: `${total} mm recorded over ${days.length} days, under the ${triggerMm} mm trigger`, totalMm: total }
    : { met: false, why: `${total} mm recorded over ${days.length} days, at or over the ${triggerMm} mm trigger`, totalMm: total };
}

/**
 * Mission 14 quorum: two different miners, both readable, agreeing. Returns the
 * decision with both signals (the contract refuses an Event proposal with fewer
 * than two), or null with the reason in `hold` when they disagree or too few
 * answered. A disagreement is never settled by picking one side.
 */
export function eventQuorum(answers) {
  const seen = new Set();
  const votes = [];
  for (const a of answers) {
    const id = String(a?.miner?.id ?? "");
    const c = eventCondition(a?.result);
    if (!id || seen.has(id) || !c || !a.signal) continue;
    seen.add(id);
    votes.push({ ...c, signal: a.signal, miner: a.miner });
  }
  if (votes.length < 2) return { hold: `${votes.length} readable answer(s) from distinct miners; two are needed` };
  if (votes.some((v) => v.met !== votes[0].met)) return { hold: `miners disagree: ${votes.map((v) => `${v.miner.name ?? v.miner.id} ${v.met ? "yes" : "no"}`).join(", ")}` };
  return { met: votes[0].met, why: `${votes.length} miners agree: ${votes[0].why}`, signals: votes.map((v) => v.signal), miners: votes.map((v) => v.miner) };
}

/**
 * Mission 06 second source: the cover stands only if an independent record (NASA
 * POWER, MERRA-2 reanalysis; Telegraph's weather miners read other models) puts the
 * period on the same side of the trigger. Missing days or a different side: hold.
 */
export function droughtAgrees(decision, independent, { days, triggerMm }) {
  if (!decision) return null;
  const byDay = new Map((independent ?? []).filter((r) => typeof r?.precipitation_mm === "number" && r.precipitation_mm >= 0).map((r) => [r.date, r.precipitation_mm]));
  if (days.some((d) => !byDay.has(d))) return { hold: "the independent record has not published every day yet" };
  const total = +days.reduce((s, d) => s + byDay.get(d), 0).toFixed(1);
  if ((total < triggerMm) !== decision.met) return { hold: `sources disagree: Telegraph ${decision.totalMm} mm, NASA POWER ${total} mm, trigger ${triggerMm} mm` };
  return { ...decision, independentMm: total, why: `${decision.why}; NASA POWER ${total} mm agrees` };
}
