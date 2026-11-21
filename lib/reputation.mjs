// Takar Ledger of miner reputation: an open, on-chain record of how Telegraph
// miners actually did, written as EAS attestations on Ethereum Sepolia.
//
// Why: every team on Telegraph ends up building its own cross-check because the
// ranked route sends questions to the wrong specialist (Gold Rush), treats a named
// miner as a hint (Ballast), or returns a top-ranked answer that is plainly wrong
// (FX_NOW). One shared, public record of "this miner answered this and was right /
// wrong / unusable", with the Telegraph signal as evidence, saves each team that work.
//
// Anyone can attest to the schema. Readers see every attester separately, so a
// reader can trust only the attesters it chooses.
//
// Pure helpers here; scripts/attest.mjs writes, api/reputation.js serves.

export const EAS = "0xC2679fBD37d54388Ce493F1DB75320D236e1815e"; // Ethereum Sepolia
export const SCHEMA_REGISTRY = "0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0";
export const GRAPHQL = "https://sepolia.easscan.org/graphql";
export const SCHEMA = "string intent,uint256 minerId,bytes32 signal,uint8 verdict,string truthSource";
// abstained: an honest "unresolved". It is coverage, not error, and never lowers accuracy.
export const VERDICT = { right: 1, wrong: 2, unusable: 3, wrong_place: 4, abstained: 5 };
const NAME = Object.fromEntries(Object.entries(VERDICT).map(([k, v]) => [v, k]));
const HASH = /^0x[0-9a-fA-F]{64}$/;

/** Evidence from a scorecard: each miner's yes/no held against the market's own resolution. */
export function fromScorecard(card) {
  const out = [];
  for (const r of card.rows ?? []) {
    const says = r.market?.resolution === "YES" ? "yes" : r.market?.resolution === "NO" ? "no" : null;
    if (!says) continue;
    for (const a of r.verification?.attempts ?? []) {
      if (!a.miner?.id || !HASH.test(a.signal ?? "")) continue; // no signal, no evidence
      const verdict = a.outcome === says ? VERDICT.right : a.outcome === "yes" || a.outcome === "no" ? VERDICT.wrong : a.outcome === "unresolved" ? VERDICT.abstained : VERDICT.unusable;
      out.push({ intent: "EVENT_OUTCOME_RESOLUTION_GENERAL", minerId: String(a.miner.id), signal: a.signal, verdict, truthSource: r.market.url ?? "market resolution" });
    }
  }
  return out;
}

/** Evidence from fleet decisions: answers the unit could not act on, and why. */
export function fromFleet(decisions) {
  const out = [];
  for (const d of decisions) {
    for (const u of d.unusableMiners ?? []) {
      if (!u.miner?.id || !HASH.test(u.signal ?? "")) continue;
      const verdict = /another (place|country)/.test(u.why ?? "") ? VERDICT.wrong_place : VERDICT.unusable;
      out.push({ intent: u.intent, minerId: String(u.miner.id), signal: u.signal, verdict, truthSource: `takar fleet ${d.unit} at ${d.location}: ${u.why}`.slice(0, 200) });
    }
  }
  return out;
}

/**
 * Evidence from sanctions screens with a known answer (`truth`: name -> {listed, source}).
 * A null `matched` is unusable; a "not matched" from a miner that names only a list the
 * entity is not on (e.g. the UN list for an OFAC-only bank) is the wrong place, not wrong.
 */
export function fromScreens(ledgerRows, truth) {
  const out = [];
  for (const r of ledgerRows) {
    const t = truth[r.params?.name];
    if (r.intent !== "SANCTIONS_SCREENING_MATCH_GENERAL" || !t || !r.minerId || !HASH.test(r.signalHash ?? "")) continue;
    const m = r.result?.matched;
    const lists = (r.result?.lists ?? []).join(" ");
    const verdict = r.resultShape !== "intent" || m == null ? VERDICT.unusable
      : m === t.listed ? VERDICT.right
      : t.listed && lists && !/ofac|sdn/i.test(lists) ? VERDICT.wrong_place
      : VERDICT.wrong;
    out.push({ intent: r.intent, minerId: String(r.minerId), signal: r.signalHash, verdict, truthSource: t.source.slice(0, 200) });
  }
  return out;
}

/** One record per signal: the same answer is never counted twice. */
export function dedupe(records, already = new Set()) {
  const seen = new Set(already);
  return records.filter((r) => { const k = r.signal.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

/**
 * Per-miner standing for one intent, from decoded attestations. Ranked by the
 * Wilson lower bound of accuracy over right/wrong verdicts, so one lucky answer
 * does not outrank a long record; unusable answers count against a miner too.
 */
export function rank(atts, { intent, attesters, weights } = {}) {
  const allow = attesters?.length ? new Set(attesters.map((a) => a.toLowerCase())) : null;
  // Optional weight per attester (address -> 0..1): evidence from an attester with a weaker
  // record counts for less. Unlisted attesters weigh 1. ponytail: flat weights; derive them
  // from each attester's agreement with others once there are several.
  const w = new Map(Object.entries(weights ?? {}).map(([k, v]) => [k.toLowerCase(), Math.max(0, Math.min(1, Number(v) || 0))]));
  const by = new Map();
  for (const a of atts) {
    if (intent && a.intent !== intent) continue;
    if (allow && !allow.has(String(a.attester).toLowerCase())) continue;
    const m = by.get(a.minerId) ?? { minerId: a.minerId, right: 0, wrong: 0, unusable: 0, wrong_place: 0, abstained: 0, attesters: new Set() };
    m[NAME[a.verdict] ?? "unusable"] += w.get(String(a.attester).toLowerCase()) ?? 1;
    m.attesters.add(String(a.attester).toLowerCase());
    by.set(a.minerId, m);
  }
  return [...by.values()].map((m) => {
    // Accuracy counts every answer a buyer could have acted on; abstentions are coverage.
    const n = m.right + m.wrong + m.unusable + m.wrong_place;
    return { minerId: m.minerId, right: m.right, wrong: m.wrong, unusable: m.unusable, wrong_place: m.wrong_place, abstained: m.abstained, answered: n, coverage: n + m.abstained ? +(n / (n + m.abstained)).toFixed(3) : null, attesters: m.attesters.size, score: +wilson(m.right, n).toFixed(4) };
  }).sort((a, b) => b.score - a.score || b.answered - a.answered);
}

/** Wilson score lower bound (95%): a cautious accuracy that grows with evidence. */
export function wilson(k, n, z = 1.96) {
  if (!n) return 0;
  const p = k / n;
  return (p + z * z / (2 * n) - z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / (1 + z * z / n);
}

/**
 * Read every attestation of the schema from the EAS indexer, decoded, page by page.
 * `attester` limits the read to one attester on the server side.
 */
export async function readAttestations(schemaId, { fetchImpl = fetch, attester, page = 200, max = 20_000 } = {}) {
  const query = `query($w: AttestationWhereInput, $t: Int, $s: Int) { attestations(where: $w, take: $t, skip: $s, orderBy: { time: asc }) { id attester recipient time revoked decodedDataJson } }`;
  const where = { schemaId: { equals: schemaId }, revoked: { equals: false }, ...(attester ? { attester: { equals: attester } } : {}) };
  const out = [];
  for (let skip = 0; skip < max; skip += page) {
    const res = await fetchImpl(GRAPHQL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables: { w: where, t: page, s: skip } }), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`EAS indexer ${res.status}`);
    const rows = (await res.json())?.data?.attestations ?? [];
    out.push(...rows.map((r) => decodeRow(r)).filter(Boolean));
    if (rows.length < page) break;
  }
  return out;
}

export function decodeRow(r) {
  try {
    const f = Object.fromEntries(JSON.parse(r.decodedDataJson).map((x) => [x.name, x.value?.value]));
    const minerId = typeof f.minerId === "object" ? BigInt(f.minerId.hex ?? f.minerId).toString() : String(f.minerId);
    return { uid: r.id, attester: r.attester, time: r.time, intent: f.intent, minerId, signal: f.signal, verdict: Number(f.verdict), truthSource: f.truthSource };
  } catch { return null; }
}
