// Where every finding in a dossier came from, in W3C PROV-JSON (https://www.w3.org/Submission/prov-json/):
// entities (the figures and records), activities (a paid Telegraph ask with its signal hash, or a
// direct read of a public register with its time), and agents (the miner, the register's publisher,
// another team's check, Takar). An auditor's tool can walk it without knowing Takar.

const id = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

export function provenance(doc) {
  const d = doc.dossier ?? {};
  const P = { prefix: { prov: "http://www.w3.org/ns/prov#", takar: "https://takar-telegraph.vercel.app/ns#", tg: "https://devnode.telegraphprotocol.com/engine/v1/signal/" }, entity: {}, activity: {}, agent: {}, wasGeneratedBy: {}, wasAssociatedWith: {}, wasDerivedFrom: {}, wasAttributedTo: {} };
  let n = 0;
  const rel = (kind, body) => { P[kind][`_:r${++n}`] = body; };
  P.agent["takar:takar"] = { "prov:type": "prov:SoftwareAgent", "prov:label": "Takar dossier builder (lib/dossier.mjs)" };

  // Paid Telegraph asks: one activity per receipt, associated with the miner that answered.
  for (const r of doc.receipts ?? []) {
    const a = `tg:${r.signal}`;
    const ag = `takar:miner-${r.id}`;
    P.agent[ag] ??= { "prov:type": "prov:SoftwareAgent", "prov:label": `${r.miner} (Telegraph miner ${r.id})` };
    P.activity[a] = { "prov:type": "takar:PaidTelegraphAsk", "takar:intent": r.intent, "takar:costUsd": r.cost ?? null, "takar:rank": r.rank ?? null };
    rel("wasAssociatedWith", { "prov:activity": a, "prov:agent": ag });
  }
  const firstAsk = (doc.receipts ?? [])[0]?.signal;

  // Production figures: each row is an entity attributed to its cited source, carried by the paid record.
  for (const g of d.production?.gold ?? []) {
    const e = `takar:production-${id(g.source)}-${g.from ?? "x"}-${g.to ?? "x"}`;
    P.entity[e] = { "prov:type": "takar:ProductionFigure", "takar:tonnes": g.t, "takar:scope": g.scope ?? null, "takar:period": `${g.from ?? "?"}-${g.to ?? "?"}`, "prov:label": g.source_title ?? g.source };
    if (g.source_url) { const src = `takar:source-${id(g.source)}`; P.entity[src] ??= { "prov:type": "takar:CitedSource", "prov:location": g.source_url }; rel("wasDerivedFrom", { "prov:generatedEntity": e, "prov:usedEntity": src }); }
    if (firstAsk) rel("wasGeneratedBy", { "prov:entity": e, "prov:activity": `tg:${firstAsk}` });
  }

  // Direct register reads: tenure, native title, heritage. Not Telegraph answers, and typed so.
  const read = (key, label, url, at, publisher, entities) => {
    if (!url) return;
    const a = `takar:read-${key}`;
    const ag = `takar:publisher-${id(publisher)}`;
    P.agent[ag] ??= { "prov:type": "prov:Organization", "prov:label": publisher };
    P.activity[a] = { "prov:type": "takar:DirectRegisterRead", "prov:location": url, "prov:startedAtTime": at ?? null, "prov:label": label };
    rel("wasAssociatedWith", { "prov:activity": a, "prov:agent": "takar:takar" });
    for (const [eid, body] of entities) { P.entity[eid] = body; rel("wasGeneratedBy", { "prov:entity": eid, "prov:activity": a }); rel("wasAttributedTo", { "prov:entity": eid, "prov:agent": ag }); }
  };
  const t = d.tenure;
  if (t && !t.error) read("tenure", "Queensland resource authorities within 500 m", String(t.source ?? "").split(" ")[0], t.checked_at, "Queensland Government (Department of Resources)",
    (t.rows ?? []).map((r) => [`takar:tenure-${id(r.id)}`, { "prov:type": "takar:Tenure", "prov:label": r.id, "takar:holder": r.holder, "takar:status": r.status, "takar:expiry": r.expiry }]));
  const nt = d.native_title;
  if (nt && !nt.error) read("native-title", "Native title and cultural heritage at the site point", Array.isArray(nt.sources) ? nt.sources[0] : nt.sources ?? nt.source, nt.checked_at, "National Native Title Tribunal and Queensland Government",
    (nt.entries ?? []).filter((e) => e.id).map((e) => [`takar:native-title-${id(e.id)}-${id(e.kind)}`, { "prov:type": "takar:NativeTitleRecord", "prov:label": `${e.id} (${e.kind})`, "takar:name": e.name ?? null, "takar:status": e.status ?? null }]));
  if ((d.heritage ?? []).length) read("heritage", "Queensland Heritage Register (extract)", "https://www.data.qld.gov.au/dataset/the-queensland-heritage-register", null, "Queensland Government (Heritage Register)",
    d.heritage.map((p) => [`takar:heritage-${id(p.ref)}`, { "prov:type": "takar:HeritagePlace", "prov:label": p.name, "takar:ref": p.ref }]));

  // Other teams' checks: attributed to them, and typed as cross-checks, never records.
  const cross = (key, c, label) => {
    if (!c?.source || c.error) return;
    const ag = `takar:team-${key}`;
    P.agent[ag] = { "prov:type": "prov:SoftwareAgent", "prov:label": label };
    const e = `takar:cross-check-${key}`;
    P.entity[e] = { "prov:type": "takar:CrossCheck", "prov:location": c.source, "prov:value": c.note ?? null };
    rel("wasAttributedTo", { "prov:entity": e, "prov:agent": ag });
  };
  cross("praman", d.cross_check, "Praman Desk Gold Rush arbitrator (another hackathon team)");
  cross("nftking-land", d.land_check, "goldrush-qld-history land and rights, NFT KING (another hackathon team)");

  // The dossier itself: generated by Takar from all of the above, signed.
  P.entity["takar:dossier"] = { "prov:type": "takar:Dossier", "prov:label": d.mine ?? doc.title, "prov:generatedAtTime": doc.rederived_at ?? doc.generated_at };
  rel("wasAttributedTo", { "prov:entity": "takar:dossier", "prov:agent": "takar:takar" });
  for (const e of Object.keys(P.entity)) if (e !== "takar:dossier") rel("wasDerivedFrom", { "prov:generatedEntity": "takar:dossier", "prov:usedEntity": e });
  const count = (k) => Object.keys(P[k]).length;
  return { ...P, summary: { entities: count("entity"), activities: count("activity"), agents: count("agent"), paid_asks: (doc.receipts ?? []).length } };
}
