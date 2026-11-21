// Native title and Traditional Owners at a point, from the public registers (read directly, not
// Telegraph answers): the National Native Title Tribunal (claims, determinations, ILUAs, bodies
// corporate, representative bodies) and Queensland's cultural heritage parties and bodies.
// A register entry is not legal advice; it says who to talk to and what to confirm.

export const NNTT = "https://services2.arcgis.com/rzk7fNEt0xoEp3cX/arcgis/rest/services/NNTT_Custodial_AGOL/FeatureServer";
export const QLD_CH = "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Boundaries/CulturalHeritageBoundaries/MapServer";
const LAYERS = [
  [NNTT, 7, "registered claim"],
  [NNTT, 8, "claim application"],
  [NNTT, 5, "determination"],
  [NNTT, 4, "Indigenous Land Use Agreement"],
  [NNTT, 0, "registered native title body corporate"],
  [NNTT, 9, "representative body area"],
  [QLD_CH, 1, "cultural heritage party"],
  [QLD_CH, 5, "cultural heritage body"],
];
const day = (ms) => (Number.isFinite(Number(ms)) && ms != null ? new Date(Number(ms)).toISOString().slice(0, 10) : null);

export async function readNativeTitle({ lat, lon }, { fetchImpl = fetch } = {}) {
  const geometry = encodeURIComponent(JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }));
  const out = [];
  for (const [base, layer, kind] of LAYERS) {
    const url = `${base}/${layer}/query?geometry=${geometry}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json`;
    const j = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) }).then((r) => r.json()).catch((e) => ({ error: { message: e.message } }));
    if (j.error) { out.push({ kind, error: String(j.error.message).slice(0, 100) }); continue; }
    for (const f of j.features ?? []) out.push({ kind, ...f.attributes });
  }
  return out;
}

/** One line per entry: who, what, status and dates, with the register it came from. */
export function summariseNativeTitle(features, { checkedAt = new Date().toISOString() } = {}) {
  const pick = (a, ...keys) => keys.map((k) => a[k]).find((v) => v != null && v !== "") ?? null;
  const rows = features.filter((f) => !f.error).map((a) => ({
    kind: a.kind,
    name: pick(a, "Name", "NAME", "name", "Party_Name", "PARTY_NAME", "party_name", "body_name", "BODY_NAME", "Organisation", "RNTBC_Name", "Rep_Body", "ORG_NAME"),
    id: pick(a, "Tribunal_ID", "TRIBUNAL_ID", "qc_ref_num_or_tribunal_id", "chb_number", "FC_No", "ILUA_ID", "party_id", "PARTY_ID"),
    status: pick(a, "Status", "STATUS", "status", "RT_Status", "Determination_Outcome", "DETOUTCOME"),
    lodged: day(pick(a, "Date_Lodged", "DATE_LODGED")),
    determined: day(pick(a, "Date_Determined", "DET_DATE", "DATEDETERMINED", "approved_date")),
    // Contact details (names, phones, emails of people) are deliberately not copied.
  }));
  const seen = new Set();
  const unique = rows.filter((r) => { const k = `${r.kind}|${r.name}|${r.id}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const claims = unique.filter((r) => /claim/.test(r.kind));
  return {
    checked_at: checkedAt,
    sources: [`${NNTT} (National Native Title Tribunal)`, `${QLD_CH} (Queensland Government)`],
    entries: unique,
    errors: features.filter((f) => f.error).map((f) => `${f.kind}: ${f.error}`),
    active_claims: claims.filter((r) => /active|accepted/i.test(`${r.status}`)).length,
    note: claims.length ? "A registered native title claim covers this point. A lease's own native-title category describes the position when it was granted; today's claim still matters for any new grant or access. Confirm with the claimants' representative and a lawyer." : null,
  };
}
