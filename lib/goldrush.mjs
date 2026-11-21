// Buying a Gold Rush dossier: the asks, shared by scripts/dossier-run.mjs and api/dossier.js.
// `ask` and `ranked` are lib/telegraph.mjs's (or a signer-bound wrapper).
import { buildDossier, closures, closureFinding } from "./dossier.mjs";
import { secondOpinion } from "./second.mjs";

export const HISTORY = "7310050", SURVEY = "64176";
const usd = (txt) => Number(String(txt ?? "").match(/US\$\s?([\d,.]+)/)?.[1]?.replace(/,/g, "")) || null;

export async function gatherDossier(mine, { ask, ranked, run = new Date().toISOString(), unit = "goldrush", now = null, maxCompanies = 3 }) {
  const buy = async (params, minerId, why) => {
    const r = await ask({ intent: "RESEARCH_QUERY_GENERAL", params, minerId, unit, run, purpose: `goldrush:${why}` });
    return { r, receipt: { miner: r.ledger?.miner?.name ?? r.miner_name, id: String(r.ledger?.miner?.id ?? minerId), intent: "RESEARCH_QUERY_GENERAL", signal: r.signal_hash, cost: Number(r.ledger?.paidMicroUsdc ?? 10000) / 1e6, shape: r.result_shape } };
  };
  const ladder = await ranked("RESEARCH_QUERY_GENERAL").catch(() => []);
  const rankOf = (id) => { const i = ladder.findIndex((m) => String(m.id) === id); return i < 0 ? "not in the current ranking" : `#${i + 1} of ${ladder.length}`; };
  const registry = await fetch("https://devnode.telegraphprotocol.com/api/miners", { signal: AbortSignal.timeout(15_000) }).then((x) => x.json());
  const base = registry.find((m) => String(m.id) === HISTORY)?.base_url;
  if (!base) throw new Error("goldrush-qld-history is not in the node's registry");

  const question = `How much gold did ${mine} produce, when and why did it close, and who owned it?`.slice(0, 250);
  const [h, s, history] = await Promise.all([
    buy({ question }, HISTORY, `history ${mine}`),
    buy({ question: `Tell me about the ${mine} gold mine`.slice(0, 250) }, SURVEY, `survey ${mine}`),
    fetch(`${base}/ask?question=${encodeURIComponent(question)}`, { signal: AbortSignal.timeout(45_000) }).then((x) => x.json()),
  ]);
  if (!history?.site_no && !(history?.production ?? []).length) throw new Error(`goldrush-qld-history has no record for "${mine}"`);
  // Latest monthly price, unless the caller already has it (one source: no Telegraph intent quotes spot gold).
  if (!now) for (let back = 1; back <= 3 && !now; back++) {
    const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - back);
    const month = d.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    const p = await buy({ question: `What was the price of gold in ${month}?` }, HISTORY, `price ${month}`);
    const v = usd(p.r.result?.answer);
    if (v) now = { month, usd: v, text: String(p.r.result.answer).split(". Prices:")[0].slice(0, 200), receipt: p.receipt };
  }
  const lastYear = Math.max(...(history.closure ?? []).map((c) => c.year ?? 0)) || null;
  let price = null;
  if (lastYear) {
    const p = await buy({ question: `What was the price of gold in ${lastYear}?` }, HISTORY, `price ${lastYear}`);
    const then = usd(p.r.result?.answer);
    price = {
      year: lastYear,
      then: then ? `US$${then} per ounce (${String(p.r.result?.answer).split(/\. Prices:|\(source/)[0].slice(0, 180).trim()})` : "not found",
      now: now ? `US$${now.usd} per ounce in ${now.month} (${now.text}), single source` : "not found",
      ratio: then && now ? +(now.usd / then).toFixed(1) : null,
      note: "Nominal dollars, not adjusted for inflation; the closure-year figure may be an official price rather than a market one (see its text).",
      receipt: p.receipt,
    };
  }
  // Who controls it today: each company in the ownership record, put to two company registers
  // (CORPORATE_REGISTRY_LOOKUP, different operators). Only `active` decides; nothing is assumed
  // about a company the registers cannot find.
  const ops = new Map(registry.map((m) => [String(m.id), m.fee_address ?? m.wallet_address ?? null]));
  const companies = [...new Set((history.ownership ?? [])
    .sort((a, b) => (b.period_from ?? 9999) - (a.period_from ?? 9999))
    .map((o) => String(o.owner ?? "").replace(/\s*\(.*?\)\s*/g, " ").trim())
    .filter((n) => /\b(limited|ltd|pty|corporation|company|inc|plc|nl)\b/i.test(n)))].slice(0, maxCompanies);
  const control = [];
  for (const company of companies) {
    const so = await secondOpinion({ intent: "CORPORATE_REGISTRY_LOOKUP_GENERAL", params: { company, jurisdiction: "Australia" } }, { ask: (a) => ask({ ...a, run, purpose: `goldrush:registry ${company}` }), ranked, operatorOf: (id) => ops.get(String(id)) ?? null, strictOperators: true, maxAsks: 4, unit, fields: ["active"] }).catch((e) => ({ verdict: "insufficient", why: e.message, answers: [] }));
    const used = (so.answers ?? []).filter((a) => a.usable);
    control.push({
      company, verdict: so.verdict,
      active: so.verdict === "agree" ? so.answer.active === true : null,
      legal_name: so.verdict === "agree" ? so.answer.legal_name ?? null : null,
      registration_id: so.verdict === "agree" ? so.answer.registration_id ?? null : null,
      other_differences: so.other_differences ?? [],
      why: so.why ?? (so.verdict === "disagree" ? `registers differ on ${so.differ.join(", ")}` : null),
      miners: used.map((a) => a.miner?.id), signals: used.map((a) => a.signal).filter(Boolean), cost: so.costUsd ?? 0,
    });
  }
  // Closures no record explains: two research miners from different operators (not the Gold Rush
  // miners) are asked why. What they say is reported as research, never as a record.
  const research = [];
  for (const c of closures(history.closure).filter((x) => x.year && x.reason === "no source states a reason").slice(-2)) {
    const so = await secondOpinion({ intent: "RESEARCH_QUERY_GENERAL", params: { question: `Why did the ${mine} gold mine in Queensland stop operating in ${c.year}? Cite sources.`.slice(0, 250) } }, { ask: (a) => ask({ ...a, run, purpose: `goldrush:closure ${mine} ${c.year}` }), ranked, exclude: [HISTORY, SURVEY], operatorOf: (id) => ops.get(String(id)) ?? null, strictOperators: true, maxAsks: 4, unit, fields: [] }).catch((e) => ({ answers: [], why: e.message }));
    const answers = (so.answers ?? []).filter((a) => a.usable).map((a) => ({ miner: a.miner?.name ?? a.miner?.id, text: a.result?.answer ?? "", signal: a.signal }));
    research.push({ year: c.year, ...closureFinding(answers), cost: so.costUsd ?? 0 });
  }
  const receipts = [h.receipt, s.receipt, ...(price?.receipt ? [price.receipt] : []), ...(now?.receipt ? [now.receipt] : [])].map((r) => ({ ...r, rank: rankOf(r.id) }));
  const dossier = buildDossier({ mine, history, survey: s.r.result, paid: { history: h.r.result, survey: s.r.result }, price, control, research });
  return {
    now,
    doc: {
      title: `Gold Rush dossier: ${mine}`,
      method: "Telegraph miners asked directly by id; structured rows from goldrush-qld-history's registered endpoint, tied to the paid answer; checks by Takar (lib/dossier.mjs). Figures are never merged or estimated.",
      generated_at: run,
      network: "Ethereum Sepolia testnet (test USDC)",
      dossier,
      receipts,
      paid_answers: { history: h.r.result, survey: s.r.result },
      structured_record: history, // goldrush-qld-history, direct call: lets anyone re-derive the dossier offline
    },
  };
}
