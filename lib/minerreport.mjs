// "Why did my miner score 0?" One page per Telegraph miner: the scorer's own numbers
// (anjoman explorer), its spot checks, and the open EAS record of how its answers held
// up when someone paid for them. Pure functions here; the fetching is in api/miner.js.

/**
 * scores: explorer rows {epoch_id, intent_id, score, rank, failure_reason}
 * checks: spot-check rows {epoch_id, intent_id, passed}
 * statuses: {intent_id, status, reason}
 * evidence: rank() rows for this miner, one per intent
 */
export function minerReport({ scores = [], checks = [], statuses = [], evidence = [] }) {
  const intents = [...new Set([...scores.map((s) => s.intent_id), ...statuses.map((s) => s.intent_id), ...evidence.map((e) => e.intent)])].filter(Boolean);
  return intents.map((intent) => {
    const rows = scores.filter((s) => s.intent_id === intent).sort((a, b) => b.epoch_id - a.epoch_id);
    const spot = checks.filter((c) => c.intent_id === intent);
    const status = statuses.find((s) => s.intent_id === intent);
    const ev = evidence.find((e) => e.intent === intent);
    const silentZeros = rows.filter((r) => Number(r.score) === 0 && !r.failure_reason);
    const flags = [];
    if (status && status.status !== "online") flags.push(`node lists it as ${status.status}${status.reason ? `: ${status.reason}` : ""}`);
    if (silentZeros.length) flags.push(`${silentZeros.length} epoch(s) scored 0 with no failure reason. Check whether a graded ask reached your endpoint in the window before each scored_at; if none did, it was not routed, not answered badly (telegraphprotocol/bounties#225).`);
    const failedSpot = spot.filter((c) => !c.passed).length;
    if (failedSpot) flags.push(`${failedSpot} of ${spot.length} spot checks failed`);
    if (ev && ev.wrong + ev.unusable > ev.right) flags.push(`paid answers held up less often than not (${ev.right} right, ${ev.wrong} wrong, ${ev.unusable} unusable)`);
    const pick = (r) => (r ? { epoch: r.epoch_id, score: Number(r.score), rank: r.rank } : null);
    return {
      intent,
      status: status?.status ?? null,
      latest: pick(rows[0]),
      best: pick(rows.reduce((b, r) => (!b || Number(r.score) > Number(b.score) ? r : b), null)),
      epochs: rows.slice(0, 12).map((r) => ({ epoch: r.epoch_id, score: Number(r.score), rank: r.rank, reason: r.failure_reason || null })),
      spot_checks: { run: spot.length, failed: failedSpot },
      paid_record: ev ? { right: ev.right, wrong: ev.wrong, unusable: ev.unusable, abstained: ev.abstained, score: ev.score } : null,
      flags,
    };
  });
}

/** A small shields-style SVG: "telegraph | <intent short> <score> · paid <r>/<n>". */
export function badge(label, value, ok = true) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const w = (s) => 10 + String(s).length * 6.5; // ponytail: monospace-ish width estimate, no font metrics
  const a = w(label), b = w(value);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${a + b}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}"><title>${esc(label)}: ${esc(value)}</title><rect width="${a}" height="20" fill="#444"/><rect x="${a}" width="${b}" height="20" fill="${ok ? "#2b7a4b" : "#a3472a"}"/><g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11"><text x="${a / 2}" y="14" text-anchor="middle">${esc(label)}</text><text x="${a + b / 2}" y="14" text-anchor="middle">${esc(value)}</text></g></svg>`;
}
