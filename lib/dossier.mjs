// Gold Rush dossier: one Queensland gold mine, every finding traced to its record,
// conflicts shown side by side and explained only as far as the records allow.
//
// Inputs are what Telegraph miners return: goldrush-qld-history (production, closure,
// years worked, ownership, conflicts, not_found, each with source and quote) and
// OathCast (the survey's live MINOCC record: site number, status, size band). Takar adds
// the checks a reader would otherwise do by hand. It never merges or estimates a figure.

const OZ_T = 31.1034768e-6; // one troy ounce in tonnes
const PER_T = { t: 1, tonne: 1, tonnes: 1, kg: 1e-3, g: 1e-6, oz: OZ_T, "troy oz": OZ_T, moz: OZ_T * 1e6 };

/** Amount in tonnes, or null for a unit we do not convert. */
export function tonnes(amount, unit) {
  const k = PER_T[String(unit ?? "").toLowerCase().trim()];
  return k && Number.isFinite(Number(amount)) ? Number(amount) * k : null;
}
/** A year from a miner: an integer or nothing, so it can never carry markup. */
export const year = (v) => (v != null && v !== "" && Number.isInteger(Number(v)) ? Number(v) : null);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const span = (p) => (p.from == null && p.to == null ? "period not stated" : `${p.from ?? "?"}–${p.to ?? "?"}`);

/** Gold rows in tonnes, with where each came from. */
export function goldRows(production = []) {
  return production
    .filter((p) => p.commodity === "gold" && tonnes(p.amount, p.unit) != null)
    .map((p) => ({ t: tonnes(p.amount, p.unit), amount: p.amount, unit: p.unit, from: year(p.period_from), to: year(p.period_to), entity: p.entity ?? null, scope: p.scope ?? null, source: p.source_ref, source_title: p.source_title, source_url: p.source_url, record: p.record_id ?? null, quote: p.quote ?? null }));
}

/**
 * Production checks:
 *  - sum: dated rows of one register against that register's own site total;
 *  - pairs: every two site totals from different sources, as agree (within 5%),
 *    conflict (same period, or a shorter period reporting more gold), or not comparable
 *    (different periods or workings), never averaged;
 *  - cumulative: the register's dated rows summed up to each other source's end year,
 *    so a reader can compare like with like.
 */
export function reconcileProduction(production) {
  const gold = goldRows(production);
  const totals = gold.filter((g) => g.scope === "site_total" || g.scope == null);
  const periods = gold.filter((g) => g.scope === "period");
  const reg = (s) => String(s).split(":").slice(0, 1).join(":"); // MINOCC-2017:Production:… -> MINOCC-2017
  const sums = [...new Set(periods.map((p) => reg(p.source)))].map((r) => {
    const rows = periods.filter((p) => reg(p.source) === r);
    const total = totals.find((t) => reg(t.source) === r);
    const sum = rows.reduce((s, p) => s + p.t, 0);
    return { register: r, rows: rows.length, sum_t: r1(sum), site_total_t: total ? r1(total.t) : null, consistent: total ? Math.abs(sum - total.t) <= 0.01 * total.t : null, to: Math.max(...rows.map((p) => p.to ?? 0)) || null };
  });
  // A register's total with no stated period covers what its dated rows cover.
  for (const t of totals) if (t.to == null) { const s = sums.find((x) => x.register === reg(t.source)); if (s?.to) { t.to = s.to; t.derived_to = true; } }
  const pairs = [];
  for (let i = 0; i < totals.length; i++) for (let j = i + 1; j < totals.length; j++) {
    const [a, b] = [totals[i], totals[j]];
    if (reg(a.source) === reg(b.source)) continue;
    const gap = Math.abs(a.t - b.t) / Math.max(a.t, b.t);
    const samePeriod = a.from === b.from && a.to === b.to || (a.to === b.to && (a.from == null || b.from == null));
    const [short, long] = (a.to ?? 9999) - (a.from ?? 0) <= (b.to ?? 9999) - (b.from ?? 0) ? [a, b] : [b, a];
    const nested = short.from != null && long.from != null && short.from >= long.from && short.to != null && long.to != null && short.to <= long.to;
    let relation, why;
    if (gap <= 0.05 && samePeriod) { relation = "agree"; why = `same period, within 5% (${r1(a.t)} t and ${r1(b.t)} t)`; }
    else if (gap <= 0.05) { relation = "close"; why = `within 5% (${r1(a.t)} t and ${r1(b.t)} t) over different periods (${span(a)} and ${span(b)})${nested && short.t > long.t ? "; the shorter period reports slightly more, so they may count differently" : ""}`; }
    else if (samePeriod) { relation = "conflict"; why = `same period (${span(a)}), ${r1(a.t)} t against ${r1(b.t)} t, ${Math.round(gap * 100)}% apart`; }
    else if (nested && short.t > long.t) { relation = "conflict"; why = `the shorter period (${span(short)}, ${r1(short.t)} t) reports more gold than the longer one (${span(long)}, ${r1(long.t)} t)`; }
    else { relation = "not comparable"; why = `different periods (${span(a)} and ${span(b)})`; }
    // A candidate explanation, offered and never applied: a register that includes dump or
    // tailings retreatment, compared again without those rows.
    if (relation === "conflict") for (const reg2 of [reg(a.source), reg(b.source)]) {
      const tail = periods.filter((p) => reg(p.source) === reg2 && /dump|tailing/i.test(p.quote ?? ""));
      const total = [a, b].find((x) => reg(x.source) === reg2), other = [a, b].find((x) => x !== total);
      if (!tail.length || !total) continue;
      const without = total.t - tail.reduce((s, p) => s + p.t, 0);
      why += `. Candidate explanation: ${reg2} includes ${r1(tail.reduce((s, p) => s + p.t, 0))} t from dumps or tailings (${tail.map(span).join(", ")}); without it, ${r1(without)} t, ${Math.round((Math.abs(without - other.t) / other.t) * 100)}% from ${r1(other.t)} t. Needs the record to confirm`;
    }
    pairs.push({ a: a.source, b: b.source, relation, why });
  }
  const cumulative = sums.flatMap((s) => totals.filter((t) => reg(t.source) !== s.register && t.to).map((t) => {
    const upTo = periods.filter((p) => reg(p.source) === s.register && (p.to == null || p.to <= t.to + 1));
    return { register: s.register, to: Math.max(...upTo.map((p) => p.to ?? 0)) || t.to, cumulative_t: r1(upTo.reduce((x, p) => x + p.t, 0)), against: t.source, against_t: r1(t.t) };
  }));
  return { gold, sums, pairs, cumulative };
}

/** The survey's size band ("OVER 150 TONNES", "50 - 150 TONNES", "giant, over 150 tonnes") against a total in tonnes. */
export function bandCheck(totalT, bandText) {
  const s = String(bandText ?? "").toLowerCase().replace(/,/g, "");
  let lo = null, hi = null, m;
  if ((m = s.match(/(\d+(?:\.\d+)?)\s*(?:-|to|–)\s*(\d+(?:\.\d+)?)\s*(?:t|tonnes)\b/))) [lo, hi] = [+m[1], +m[2]];
  else if ((m = s.match(/(?:over|more than|>)\s*(\d+(?:\.\d+)?)\s*(?:t|tonnes)\b/))) lo = +m[1];
  else if ((m = s.match(/(?:under|less than|<)\s*(\d+(?:\.\d+)?)\s*(?:t|tonnes)\b/))) hi = +m[1];
  if (lo == null && hi == null) return { band: bandText ?? null, consistent: null };
  return { band: bandText, range_t: [lo, hi], total_t: r1(totalT), consistent: totalT == null ? null : (lo == null || totalT >= lo * 0.95) && (hi == null || totalT <= hi * 1.05) };
}

const NOT_GEOLOGY = /\b(fire|flood|war|strike|labou?r|shortage|capital|liquidat|price|cost|legal|dispute|cyclone|accident)\w*/i;
/** Closures grouped by year: how many sources state it, and whether the stated reason is geological. */
export function closures(list = []) {
  const by = new Map();
  for (const c of list) {
    const k = year(c.year) ?? "unknown";
    const e = by.get(k) ?? { year: year(c.year), sources: [], reasons: [] };
    e.sources.push({ source: c.source_ref, title: c.source_title, url: c.source_url, quote: c.quote, entity: c.entity });
    if (c.reason_text) e.reasons.push({ text: c.reason_text, cls: c.reason_class === "exhausted" ? "geological exhaustion" : NOT_GEOLOGY.test(c.reason_text) ? `not geological (${c.reason_text.match(NOT_GEOLOGY)[0].toLowerCase()})` : c.reason_class ?? "unclassified", source: c.source_ref });
    by.set(k, e);
  }
  return [...by.values()].sort((a, b) => (a.year ?? 0) - (b.year ?? 0)).map((e) => ({
    ...e,
    status: new Set(e.sources.map((s) => String(s.source).split(":")[0])).size >= 2 ? "two sources" : "single source",
    reason: e.reasons.length ? e.reasons : "no source states a reason",
  }));
}

/** Does the paid Telegraph answer carry this figure? Ties a structured row to the receipt. */
export function inPaidAnswer(amount, text) {
  const t = String(text ?? "").replace(/\s+/g, " ");
  const n = Number(amount);
  const forms = [n.toLocaleString("en-US", { maximumFractionDigits: 2 }), String(n), n.toLocaleString("en-US")];
  return forms.some((f) => t.includes(f));
}

/** The whole dossier from the miners' answers. Pure: the run script does the buying. */
export function buildDossier({ mine, history, survey, paid = {}, price = null, control = [], research = [], tenure = null, exploring = null }) {
  const rec = reconcileProduction(history.production ?? []);
  const siteTotal = rec.gold.find((g) => g.scope === "site_total" && /MINOCC/.test(g.source)) ?? rec.gold.find((g) => g.scope === "site_total");
  const surveyBand = survey?.answer?.match(/(?:giant|large|medium|small|very small)?,?\s*(?:over|under)?\s*[\d.]+\s*(?:-|to|–)?\s*[\d.]*\s*(?:tonnes|t)\b/i)?.[0] ?? null;
  const surveySite = String(survey?.sources?.join(" ") ?? "").match(/site_no%3D(\d+)|site (\d+)/);
  const surveySiteNo = surveySite ? Number(surveySite[1] ?? surveySite[2]) : null;
  const tied = rec.gold.map((g) => ({ source: g.source, amount: g.amount, unit: g.unit, in_paid_answer: inPaidAnswer(g.amount, paid.history?.answer) }));
  // A name can match one small working inside a whole field: say how many share the 5 km around it.
  const nearby = year(String(survey?.answer ?? "").match(/within 5 km it records (\d+) other/i)?.[1]);
  const open = [
    // Only a small working in a crowded field: a giant mine with neighbours is not ambiguous.
    ...(nearby >= 20 && /under 0\.5|<\s*0\.5|\b0\.5\s*-\s*5\b/i.test(history.gsq_record?.size_definition ?? "") ? [`identity: the name matched GSQ site ${history.site_no ?? "?"}, one of ${nearby + 1} historical workings within 5 km; if you meant the field or a larger operation, ask for it by its site number`] : []),
    ...(history.not_found ?? []).map((n) => (typeof n === "string" ? n : `${n.field ?? n.item ?? "item"}: ${n.why ?? n.reason ?? n.note ?? ""}`.trim())),
    ...closures(history.closure).filter((c) => c.reason === "no source states a reason").map((c) => `why it stopped in ${c.year}: no source quotes a reason; do not assume exhaustion`),
    ...(new Set(rec.gold.filter((g) => g.scope !== "period").map((g) => String(g.source).split(":")[0])).size === 1 ? [`production rests on one register (${String(rec.gold[0].source).split(":")[0]}); no second source to check it against`] : []),
    ...(tenure?.note ? [`tenure: ${tenure.note}`] : []),
    ...control.filter((c) => c.active === null).map((c) => `who controls it: ${c.company} could not be confirmed in two company registers (${c.why ?? c.verdict}); check ASIC directly`),
    ...rec.pairs.filter((p) => p.relation === "conflict").map((p) => `production: ${p.a} and ${p.b} conflict (${p.why}); check whether they count recovered or contained gold, and whether tailings retreatment is included`),
  ];
  return {
    mine,
    identity: { history_site_no: history.site_no ?? null, survey_site_no: surveySiteNo, same_site: history.site_no != null && surveySiteNo != null ? history.site_no === surveySiteNo : null, name: history.site_name ?? mine, location: history.gsq_record?.locality ?? null, status: history.gsq_record?.mine_status ?? null, nearby_workings: nearby, size_band: history.gsq_record?.size_definition ?? null },
    production: { ...rec, band: bandCheck(siteTotal?.t, surveyBand ?? history.gsq_record?.size_definition), band_source: surveyBand ? "OathCast (live MINOCC)" : "goldrush-qld-history (MINOCC 2017)" },
    closures: closures(history.closure),
    years_worked: history.years_worked ?? [],
    ownership: (history.ownership ?? []).map((o) => ({ owner: o.owner, role: o.role, from: year(o.period_from), to: year(o.period_to), entity: o.entity, source: o.source_ref, quote: o.quote })),
    references: history.references ?? [],
    gold_price: price,
    control,
    closure_research: research,
    tenure,
    nearby: exploring,
    receipts_tie: { checked: tied.length, in_paid_answer: tied.filter((x) => x.in_paid_answer).length, rows: tied },
    open_questions: [...new Set(open)].filter(Boolean),
    miner_conflicts: history.conflicts ?? [],
  };
}

/** The downloadable dossier, as Markdown: every finding with its record and receipt. */
/** Text from miners goes into Markdown that a page renders: its control characters are escaped. */
export const md = (s) => String(s ?? "").replace(/\s+/g, " ").replace(/[\\`*_{}[\]()#+!|<>]/g, (c) => "\\" + c);

/** A Markdown link only to an http(s) URL; anything else is shown as plain escaped text. */
const link = (text, u) => (/^https?:\/\/[^\s()<>]+$/i.test(String(u ?? "")) ? `[${md(text)}](${u})` : md(text));

export function renderMarkdown(d, meta = {}) {
  const L = [];
  const q = (s) => (s ? ` "${md(s)}"` : "");
  L.push(`# ${md(d.identity.name)}: Gold Rush dossier`, "");
  L.push(`Built by Takar from Telegraph miners on ${meta.generated_at ?? ""}. Every finding names its record; figures are never merged or estimated; conflicts are shown side by side. Signed with Ed25519 (see the JSON).`, "");
  L.push("## Identity", "");
  L.push(`- GSQ site ${year(d.identity.history_site_no) ?? "?"} (goldrush-qld-history) and ${year(d.identity.survey_site_no) ?? "?"} (OathCast, live MINOCC): ${d.identity.same_site === true ? "**same site**" : d.identity.same_site === false ? "**different sites: check the name match**" : "not checked"}.`);
  L.push(`- ${md(d.identity.status ?? "")}${d.identity.location ? `, ${md(d.identity.location)}` : ""}${d.identity.size_band ? `; gold size band ${md(d.identity.size_band)}` : ""}.`);
  if (d.identity.nearby_workings != null) L.push(`- ${d.identity.nearby_workings} other historical workings within 5 km (OathCast).${d.open_questions.some((q) => q.startsWith("identity:")) ? " **A small working in a crowded field: check this is the one you mean.**" : ""}`);
  L.push("");
  L.push("## Gold production", "");
  L.push("| Tonnes | As recorded | Period | Working | Source | Quote |", "|---|---|---|---|---|---|");
  for (const g of d.production.gold) L.push(`| ${Math.round(g.t * 10) / 10} | ${md(g.amount)} ${md(g.unit)} | ${g.from ?? "?"}–${g.to ?? "?"}${g.derived_to ? " (end year from its dated rows)" : ""} | ${md(g.entity ?? "")} (${md(g.scope ?? "")}) | ${link(g.source, g.source_url)} | ${q(g.quote)} |`);
  L.push("");
  for (const s of d.production.sums) L.push(`- **Sum check (${s.register}):** ${s.rows} dated rows add up to ${s.sum_t} t; the register's site total is ${s.site_total_t ?? "absent"} t: ${s.consistent === true ? "consistent" : s.consistent === false ? "**inconsistent**" : "no total to check"}.`);
  for (const p of d.production.pairs) L.push(`- **${p.relation}:** ${p.a} vs ${p.b}: ${p.why}.`);
  for (const c of d.production.cumulative) L.push(`- Like for like: ${c.register}'s dated rows to ${c.to} sum to ${c.cumulative_t} t, against ${c.against_t} t in ${c.against}.`);
  const b = d.production.band;
  L.push(`- **Size band** (${d.production.band_source}): ${b.band ?? "none"}; the register's total ${b.total_t ?? "?"} t is ${b.consistent === true ? "inside it" : b.consistent === false ? "**outside it**" : "not checkable"}.`, "");
  L.push("## Why it stopped", "");
  for (const c of d.closures) {
    L.push(`- **${c.year ?? "year unknown"}** (${c.status}): ${Array.isArray(c.reason) ? c.reason.map((r) => `${r.text} *[${r.cls}, ${r.source}]*`).join(" ") : `*${c.reason}*`}`);
    for (const s of c.sources) L.push(`  - ${link(s.source, s.url)} on ${md(s.entity ?? "the site")}:${q(s.quote)}`);
  }
  L.push("");
  if (d.closure_research?.length) {
    L.push("### What research miners say about the unexplained closures (not records)", "");
    for (const r of d.closure_research) {
      L.push(`- **${r.year}**: ${r.status}${r.shared.length ? ` (${r.shared.join(", ")})` : ""}.`);
      for (const a of r.answers) L.push(`  - ${md(a.miner)}, naming ${a.causes.join(", ")}: "${md(a.quote)}"${/^0x[0-9a-f]{64}$/i.test(a.signal ?? "") ? ` [signal ${String(a.signal).slice(0, 10)}…](https://devnode.telegraphprotocol.com/engine/v1/signal/${a.signal})` : ""}`);
    }
    for (const r of d.closure_research) if (Array.isArray(r.newspapers) && r.newspapers.length) {
      L.push(`- **${r.year}, in the newspapers of the time** (Trove, National Library of Australia; records, not answers):`);
      for (const a of r.newspapers.slice(0, 4)) L.push(`  - ${link(`${a.title} (${a.paper ?? "newspaper"}, ${a.date ?? "?"})`, a.url)}: "${md(a.snippet)}"`);
    }
    L.push("", "Two research answers naming the same kind of cause is a lead to check in the record, not a finding.", "");
  }
  if (d.gold_price) {
    L.push("## Gold price then and now", "");
    L.push(`- At the last closure year (${d.gold_price.year}): ${d.gold_price.then ?? "not found"}.`);
    L.push(`- Latest: ${d.gold_price.now ?? "not established"}.`);
    if (d.gold_price.ratio) L.push(`- About ${d.gold_price.ratio}x the closure-year price. ${d.gold_price.note}`);
    if (d.gold_price.real) L.push(`- In real terms (US CPI, [FRED CPIAUCNS](${d.gold_price.cpi_source}); prices rose ${d.gold_price.real.inflation}x since ${d.gold_price.year}): about **${d.gold_price.real.real_ratio}x**.`);
    L.push("");
  }
  if (d.control?.length) {
    L.push("## Who controls it today (company registers)", "");
    for (const c of d.control) L.push(`- **${md(c.company)}**: ${c.active === true ? `active, per two registers from different operators (${c.miners.map(md).join(" and ")})${c.legal_name ? `, registered as ${md(c.legal_name)}` : ""}` : c.active === false ? `**not active**, per two registers (${c.miners.map(md).join(" and ")})` : `not established (${md(c.why ?? c.verdict)})`}${c.other_differences?.length ? `; the registers differ only on ${c.other_differences.map(md).join(", ")}` : ""}.`);
    L.push("", "A register's status is not a mining tenure: who holds the lease today needs the tenure register.", "");
  }
  if (d.tenure && !d.tenure.error) {
    const t = d.tenure;
    L.push("## Tenure today (Queensland register, read directly, not a Telegraph answer)", "");
    L.push(`Checked ${md(t.checked_at)} within 500 m of the survey's point: **${t.authorities}** current authorities.`, "");
    L.push(`- Holders: ${Object.entries(t.holders).map(([k, n]) => `${md(k)} (${n})`).join(", ")}.`);
    L.push(`- Types: ${Object.entries(t.kinds).map(([k, n]) => `${md(k)} (${n})`).join(", ")}.`);
    L.push(`- Native title category: ${Object.entries(t.native_title).map(([k, n]) => `${md(k)} (${n})`).join(", ")}.`);
    if (t.note) L.push(`- **${md(t.note)}**`);
    L.push("", "| Authority | Holder | Status | Expiry | Native title |", "|---|---|---|---|---|", ...t.rows.slice(0, 12).map((r) => `| ${md(r.id)} | ${md(r.holder)} | ${md(r.status)} | ${md(r.expiry ?? "")} | ${md(r.native_title ?? "")} |`));
    L.push("", `Source: ${link("Queensland MinesPermitsCurrent", t.source.split(" ")[0])}. A register entry is not legal advice; native title and access need legal confirmation.`, "");
  }
  if (d.nearby && !d.nearby.error && d.nearby.authorities) {
    const n = d.nearby;
    L.push(`## Who is exploring within ${n.radius_km} km (Queensland register)`, "");
    L.push(`${n.authorities} exploration permits and applications. By holder: ${n.holders.map((h) => `${md(h.holder)} (${h.granted} granted${h.applications ? `, ${h.applications} applied` : ""})`).join("; ")}.`, "");
    if (n.newest.length) L.push("Newest:", ...n.newest.map((r) => `- ${md(r.id)} (${md(r.kind)}), ${md(r.holder)}, ${r.approved ? `granted ${r.approved}` : `lodged ${r.lodged}`}${r.minerals ? `, ${md(r.minerals)}` : ""}`), "");
  }
  L.push("## Who held it", "");
  for (const o of d.ownership) L.push(`- ${md(o.owner)} (${o.from ?? "?"}–${o.to ?? "?"}${o.role ? `, ${md(o.role)}` : ""}) [${md(o.source)}]${q(o.quote)}`);
  L.push("");
  // GSQ company reports open on the GSQ Open Data Portal (cr + six digits).
  const cr = (n) => (Number.isInteger(Number(n)) ? link(`CR ${n}`, `https://geoscience.data.qld.gov.au/data/report/cr${String(n).padStart(6, "0")}`) : md(n));
  if (d.references.length) L.push("## Company reports to read next", "", ...d.references.map((r) => `- ${(r.cr_numbers ?? []).map(cr).join(", ")} [${md(r.source_ref)}]`), "");
  L.push("## Open questions (what the records do not settle)", "", ...d.open_questions.map((x) => `- ${md(x)}`), "");
  L.push("## Receipts", "");
  L.push(`${d.receipts_tie.in_paid_answer} of ${d.receipts_tie.checked} production figures from the miner's structured record also appear word for word in the answer bought through Telegraph.`, "");
  for (const r of meta.receipts ?? []) L.push(`- ${md(r.miner)} (${md(r.id)}), ${r.intent}: [Telegraph signal ${String(r.signal).slice(0, 10)}…](https://devnode.telegraphprotocol.com/engine/v1/signal/${r.signal}), $${r.cost}${r.rank ? `; node rank for the intent: ${r.rank}` : ""}`);
  L.push("", "Rank is shown next to the evidence, never in place of it.");
  return L.join("\n") + "\n";
}

// What a free-text answer says the cause was. Coarse on purpose: two sources agree only if they
// name the same kind of cause. ponytail: keyword classes; an LLM judge if these misfire.
const CAUSES = [
  ["ore exhausted", /\b(exhaust|worked out|end of (its|the) ore|ore bod(y|ies) (ran|was|were) (out|depleted)|depleted|declining grade|low[- ]grade|grades? (fell|declined))/i],
  ["fire", /\bfire\b/i],
  ["flooding or water", /\b(flood|inrush|water (problems?|ingress)|pumping)/i],
  ["war", /\b(world war|wartime|the war\b|enlist)/i],
  ["labour", /\b(strike|labou?r (shortage|dispute)|workforce|miners left)/i],
  ["price, cost or capital", /\b(price|cost|uneconomic|unprofitable|capital|financ|liquidat|receivership|insolven)/i],
];
export function causesIn(text) { return CAUSES.filter(([, re]) => re.test(String(text ?? ""))).map(([c]) => c); }

/** Two research answers about one closure: corroborated (a shared cause), disputed (causes, none shared), single or none. */
export function closureFinding(answers) {
  const withCauses = answers.map((a) => ({ ...a, causes: causesIn(a.text) })).filter((a) => a.causes.length);
  const shared = withCauses.length >= 2 ? withCauses[0].causes.filter((c) => withCauses.slice(1).every((a) => a.causes.includes(c))) : [];
  const status = withCauses.length < 1 ? "none named" : withCauses.length < 2 ? "single source" : shared.length ? "corroborated" : "disputed";
  return { status, shared, answers: withCauses.map(({ miner, causes, text, signal }) => ({ miner, causes, quote: String(text).slice(0, 300), signal })) };
}

/** US CPI (FRED CPIAUCNS, monthly) as { "YYYY-MM": index }. */
export function cpiSeries(csv) {
  const m = {};
  for (const line of String(csv).split(/\r?\n/).slice(1)) { const [d, v] = line.split(","); if (d && Number(v)) m[d.slice(0, 7)] = Number(v); }
  return m;
}
/** Gold then and now in real terms: the nominal ratio divided by US CPI's ratio. Null if a CPI point is missing. */
export function realRatio(series, thenYear, thenUsd, nowMonth, nowUsd) {
  const yr = Object.entries(series).filter(([k]) => k.startsWith(`${thenYear}-`)).map(([, v]) => v);
  const cpiThen = yr.length ? yr.reduce((a, b) => a + b, 0) / yr.length : null;
  const cpiNow = series[nowMonth] ?? null;
  if (!cpiThen || !cpiNow || !thenUsd || !nowUsd) return null;
  return { cpi_then: +cpiThen.toFixed(2), cpi_now: cpiNow, inflation: +(cpiNow / cpiThen).toFixed(2), real_ratio: +((nowUsd / thenUsd) / (cpiNow / cpiThen)).toFixed(2) };
}
