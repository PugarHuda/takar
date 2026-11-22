// Land and rights, second source: NFT KING's goldrush-qld-history (7310050, another hackathon team)
// answers "land and rights at site <n>" with tenure and native title rows read from the same
// registers. We read those registers ourselves (lib/tenure.mjs, lib/nativetitle.mjs), so the two
// readings are set side by side: which IDs both found, which one only, and where a field differs.
// The structured rows come from the miner's own public endpoint (the node passes only the text);
// a cross-check, never a record.

/** Compare their rows with ours. Pure, for tests. Ours: tenure within 500 m, native title at the point. */
export function compareLand(theirs, { tenure, nativeTitle }) {
  const ours = new Map((tenure?.rows ?? []).map((r) => [r.id, r]));
  // They read the site point and 2 km around it, and may list only the first 25 per layer.
  const all = new Map((theirs?.tenure ?? []).map((t) => [t.tenure_id, t]));
  const atPoint = (theirs?.tenure ?? []).filter((t) => t.relation === "contains_site_point").map((t) => t.tenure_id);
  const truncated = (theirs?.notes ?? []).some((n) => /first \d+ .* are listed/i.test(String(n)));
  const both = [...ours.keys()].filter((id) => all.has(id));
  const onlyOurs = [...ours.keys()].filter((id) => !all.has(id));
  const accessOnly = onlyOurs.length > 0 && onlyOurs.every((id) => /access/i.test(ours.get(id).kind ?? ""));
  const pointMissedByUs = atPoint.filter((id) => !ours.has(id));
  const dayApart = both.filter((id) => {
    const a = ours.get(id).expiry, b = all.get(id).expiry_date;
    return a && b && Math.abs(Date.parse(a) - Date.parse(b)) === 864e5;
  });
  const sameExpiry = both.filter((id) => ours.get(id).expiry && ours.get(id).expiry === all.get(id).expiry_date).length;
  const renewal = both.filter((id) => /renewal/i.test(all.get(id).sub_status ?? ""));
  const set = (xs) => new Set(xs.filter(Boolean));
  const ntOurs = set((nativeTitle?.entries ?? []).filter((e) => /claim|determin/i.test(e.kind ?? "")).map((e) => e.id));
  const ntTheirs = set((theirs?.native_title ?? []).filter((n) => n.relation === "contains_site_point" && /^QC/.test(n.tribunal_id ?? "")).map((n) => n.tribunal_id));
  return {
    tenure: { ours: ours.size, theirs: all.size, both: both.length, only_ours: onlyOurs, at_point_missed_by_us: pointMissedByUs, their_list_truncated: truncated, only_ours_are_access_leases: accessOnly },
    expiry: { same: sameExpiry, one_day_apart: dayApart },
    renewal_lodged: renewal.length,
    native_title_at_point: { both: [...ntTheirs].filter((id) => ntOurs.has(id)), only_theirs: [...ntTheirs].filter((id) => !ntOurs.has(id)), only_ours: [...ntOurs].filter((id) => !ntTheirs.has(id)) },
    checked_at: theirs?.checked_at ?? null,
  };
}

export function landNote(c) {
  if (!c) return null;
  const t = c.tenure;
  const parts = [`${t.both} of our ${t.ours} tenure IDs within 500 m are also in theirs (${t.theirs} rows to 2 km${t.their_list_truncated ? ", some layers cut at 25" : ""})`];
  if (t.only_ours.length) parts.push(`not in theirs: ${t.only_ours.slice(0, 6).join(", ")}${t.only_ours.length > 6 ? ` and ${t.only_ours.length - 6} more` : ""}${t.only_ours_are_access_leases ? " (access-area leases, a register layer their reading does not cover)" : t.their_list_truncated ? " (their list is cut, so absence there is not a disagreement)" : ""}`);
  if (t.at_point_missed_by_us.length) parts.push(`over the site point in theirs but not in our read: ${t.at_point_missed_by_us.join(", ")}`);
  if (c.native_title_at_point.both.length) parts.push(`native title ${c.native_title_at_point.both.join(", ")} at the site in both`);
  if (c.native_title_at_point.only_theirs.length) parts.push(`native title only in theirs: ${c.native_title_at_point.only_theirs.join(", ")}`);
  if (c.renewal_lodged) parts.push(`their sub-status "Renewal Lodged" on ${c.renewal_lodged} shared lease(s) confirms the renewal our reading inferred`);
  if (c.expiry.one_day_apart.length) parts.push(`${c.expiry.one_day_apart.length} expiry date(s) one day apart (${c.expiry.one_day_apart.slice(0, 3).join(", ")}): the register stores midnight Brisbane time (UTC+10), so a date cut in UTC lands on the day before; ours are read in Brisbane time`);
  else if (c.expiry.same) parts.push(`${c.expiry.same} expiry dates identical`);
  return parts.join("; ");
}

export async function landCheck(base, siteNo, ours, { fetchImpl = fetch } = {}) {
  const url = `${base}/ask?question=${encodeURIComponent(`land and rights at site ${siteNo}`)}`;
  const theirs = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) }).then((r) => r.json());
  if (!theirs?.tenure && !theirs?.native_title) return { source: url, note: "no structured land rows returned" };
  const c = compareLand(theirs, ours);
  return { source: url, miner: "7310050 goldrush-qld-history (NFT KING)", ...c, note: landNote(c) };
}
