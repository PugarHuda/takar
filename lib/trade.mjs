// Trade Assurance rules (scripts/trade-assurance.mjs): pure, so they are tested offline.

export function km(a, b) {
  const r = (d) => (d * Math.PI) / 180, dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** One vessel reading -> berthed / away / unusable, against the port and a 60-minute freshness bound. */
export function berth(result, port, now = Date.now(), vessel = null) {
  const { latitude: lat, longitude: lon, speed_knots: kn, observed_at } = result ?? {};
  if (typeof lat !== "number" || typeof lon !== "number" || typeof kn !== "number") return { state: "unusable", why: "no position" };
  const norm = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (vessel && norm(result.vessel) !== norm(vessel)) return { state: "unusable", why: `reading is for ${result.vessel ?? "an unnamed vessel"}, not ${vessel}` };
  const age = (now - Date.parse(observed_at)) / 60_000;
  // Fresh means 0-60 min old, with 2 min of clock skew; a future timestamp is not fresh.
  if (!(age >= -2 && age <= 60)) return { state: "unusable", why: `reading ${Number.isFinite(age) ? Math.round(age) + " min old" : "has no time"}` };
  const d = km({ lat, lon }, port);
  return { state: d <= port.radiusKm && kn <= 1 ? "berthed" : "away", km: Math.round(d * 100) / 100, knots: kn, ageMin: Math.round(age) };
}

/** Two independent verdicts -> pass (both passWhen) / fail (both failWhen) / review (anything else). */
export function pair(a, b, passWhen, failWhen) {
  if (a === passWhen && b === passWhen) return "pass";
  if (a === failWhen && b === failWhen) return "fail";
  return "review";
}

/** Checks -> decision, most cautious first: sanctions hit refunds, any doubt goes to review. */
export function decide({ arrival, invoice, sanctions }, port = "the port") {
  if (sanctions === "fail") return ["refund", "supplier matched a sanctions list in both Takar's and Praman's screens"];
  const doubt = Object.entries({ arrival, invoice, sanctions }).filter(([, v]) => v === "review").map(([k]) => k);
  if (doubt.length) return ["review", `checks disagree or are unusable: ${doubt.join(", ")}`];
  if (invoice === "fail") return ["refund", "both reconcile miners say the invoice does not match the PO and goods received"];
  if (arrival === "fail") return ["hold", `the ship is not berthed at ${port} yet (both vessel miners agree)`];
  return ["pay", `berthed at ${port}, invoice reconciles, supplier clear`];
}

/** Quantity dispute: what the supplier is owed for the accepted part, in token units.
 *  The two reconcile miners must report the same shortfall (within 1 currency unit) and Praman's
 *  own three-way reconciliation must land on it too; otherwise null (review). */
export function payable(amount, invoiceTotal, discrepancies, pramanDelta) {
  const ds = discrepancies.map((d) => Math.abs(Number(d)));
  if (ds.length < 2 || ds.some((d) => !Number.isFinite(d) || d <= 0)) return null;
  if (Math.max(...ds) - Math.min(...ds) > 1 || !(Math.abs(Math.abs(Number(pramanDelta)) - ds[0]) <= 1)) return null;
  if (!(invoiceTotal > ds[0])) return null;
  const share = Math.round(((invoiceTotal - ds[0]) / invoiceTotal) * 1e6); // parts per million
  return (BigInt(amount) * BigInt(share)) / 1_000_000n;
}
