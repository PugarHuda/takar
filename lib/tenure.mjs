// Who holds the ground today: Queensland's current resource authorities around a mine, read
// directly from the Queensland Government register (Economy/MinesPermitsCurrent, open data).
// Not a Telegraph answer, and labelled so. A tenure record is not legal advice: an expiry date in
// the past with a "Granted" status usually means a renewal is pending, not that the ground is free.

export const TENURE_SERVICE = "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Economy/MinesPermitsCurrent/MapServer";
// Feature layers: granted mining leases (permit, surface area, access), ML applications, mineral
// development licences, mining claims, exploration permits (minerals, coal).
export const TENURE_LAYERS = { 44: "ML granted", 45: "ML granted (surface area)", 46: "ML granted (access)", 40: "ML application", 41: "ML application (surface area)", 25: "MDL granted", 36: "MC granted", 3: "EPM granted", 9: "EPC granted" };
const FIELDS = "displayname,permitstatus,approvedate,expirydate,authorisedholdername,nativetitlecategory,permitminerals,permitpurpose,permittypeabbreviation";

/** Raw features for one point and radius, layer by layer. */
export async function readTenure({ lat, lon }, { radius = 500, fetchImpl = fetch } = {}) {
  const geometry = encodeURIComponent(JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }));
  const out = [];
  for (const [layer, kind] of Object.entries(TENURE_LAYERS)) {
    const url = `${TENURE_SERVICE}/${layer}/query?geometry=${geometry}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&distance=${radius}&units=esriSRUnit_Meter&outFields=${FIELDS}&returnGeometry=false&f=json`;
    const j = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) }).then((r) => r.json()).catch((e) => ({ error: { message: e.message } }));
    if (j.error) throw new Error(`tenure register layer ${layer}: ${j.error.message}`);
    for (const f of j.features ?? []) out.push({ kind, ...f.attributes });
  }
  return out;
}

const day = (ms) => (Number.isFinite(Number(ms)) && ms != null ? new Date(Number(ms)).toISOString().slice(0, 10) : null);

/** Holders, expiry and native-title categories, with the expired-but-granted case called out. */
export function summariseTenure(features, { now = Date.now(), checkedAt = new Date(now).toISOString() } = {}) {
  const by = new Map();
  for (const f of features) if (!by.has(f.displayname)) by.set(f.displayname, f); // one row per authority
  const rows = [...by.values()].map((f) => ({ id: String(f.displayname ?? ""), kind: f.kind, status: f.permitstatus ?? null, holder: f.authorisedholdername ?? null, approved: day(f.approvedate), expiry: day(f.expirydate), native_title: f.nativetitlecategory ?? null, minerals: f.permitminerals ?? null }));
  const count = (k) => rows.reduce((m, r) => ((m[r[k] ?? "not recorded"] = (m[r[k] ?? "not recorded"] ?? 0) + 1), m), {});
  const lapsed = rows.filter((r) => /granted/i.test(r.status ?? "") && r.expiry && Date.parse(r.expiry) < now);
  return {
    checked_at: checkedAt,
    source: `${TENURE_SERVICE} (Queensland Government, open data), read directly`,
    authorities: rows.length,
    holders: count("holder"),
    kinds: count("kind"),
    native_title: count("native_title"),
    expired_but_granted: lapsed.length,
    note: lapsed.length ? `${lapsed.length} authorities show an expiry date in the past with status "Granted": usually a renewal is pending. The ground is not available on the register's word alone; confirm with the Department of Resources.` : null,
    rows: rows.slice(0, 60),
  };
}
