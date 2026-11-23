// A cross-team check: Praman Desk's Gold Rush arbitrator (another Telegraph hackathon team).
// Its consensus production figure is set against the records in our dossier: which record it
// matches within 5%, so a reader sees what period and definition the other team's number carries.
// An external check, never a primary record, and labelled so.

export const PRAMAN_MCP = "https://praman-desk.vercel.app/api/mcp";

/** Call one of Praman Desk's MCP tools; fails closed on any error shape. */
export async function pramanTool(name, args, { fetchImpl = fetch } = {}) {
  const r = await fetchImpl(PRAMAN_MCP, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }), signal: AbortSignal.timeout(30_000) });
  const body = await r.json();
  if (!r.ok || body.error || body.result?.isError) throw new Error(`Praman ${name} error: ${JSON.stringify(body.error ?? body.result?.content?.[0]?.text ?? r.status).slice(0, 120)}`);
  return JSON.parse(body.result.content[0].text);
}

export const PRAMAN_GOLD ="https://praman-desk.vercel.app/api/gold-rush/aggregate";
const OZ_T = 31.1034768e-6;

/** Ounces or tonnes from a claim like "8.4M oz", "250 t", "1.2 million ounces". */
export function claimTonnes(text) {
  const m = String(text ?? "").toLowerCase().replace(/,/g, "").match(/([\d.]+)\s*(k|thousand|m|million)?\s*(oz|ounces?|t|tonnes?)\b/);
  if (!m) return null;
  const n = Number(m[1]) * (/^(m|million)$/.test(m[2] ?? "") ? 1e6 : m[2] ? 1e3 : 1);
  return /^o/.test(m[3]) ? n * OZ_T : n;
}

export async function pramanCheck(mine, goldRows, { fetchImpl = fetch } = {}) {
  const j = await fetchImpl(`${PRAMAN_GOLD}?mine=${encodeURIComponent(mine)}`, { signal: AbortSignal.timeout(20_000) }).then((r) => r.json());
  return compareClaim(j, goldRows);
}

/** The arbitrator's consensus against our site totals: matches within 5%, or none. */
export function compareClaim(j, goldRows) {
  const claim = j?.consensusEvidence?.primaryMetrics ?? null;
  const t = claimTonnes(claim);
  if (!j?.ok || t == null) return { source: PRAMAN_GOLD, claim, tonnes: null, matches: [], note: "no usable consensus figure" };
  const totals = goldRows.filter((g) => g.scope !== "period");
  const matches = totals.filter((g) => Math.abs(g.t - t) / Math.max(g.t, t) <= 0.05).map((g) => ({ source: g.source, t: Math.round(g.t * 10) / 10, period: `${g.from ?? "?"}–${g.to ?? "?"}` }));
  return { source: PRAMAN_GOLD, claim, tonnes: Math.round(t * 10) / 10, status: j.status ?? null, matches, note: matches.length ? `matches ${matches.map((m) => `${m.source} (${m.t} t, ${m.period})`).join(" and ")}` : "matches none of the recorded totals" };
}
