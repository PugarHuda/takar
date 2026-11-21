// Buying a Gold Rush dossier: the asks, shared by scripts/dossier-run.mjs and api/dossier.js.
// `ask` and `ranked` are lib/telegraph.mjs's (or a signer-bound wrapper).
import { buildDossier } from "./dossier.mjs";

export const HISTORY = "7310050", SURVEY = "64176";
const usd = (txt) => Number(String(txt ?? "").match(/US\$\s?([\d,.]+)/)?.[1]?.replace(/,/g, "")) || null;

export async function gatherDossier(mine, { ask, ranked, run = new Date().toISOString(), unit = "goldrush", now = null }) {
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
  const receipts = [h.receipt, s.receipt, ...(price?.receipt ? [price.receipt] : []), ...(now?.receipt ? [now.receipt] : [])].map((r) => ({ ...r, rank: rankOf(r.id) }));
  const dossier = buildDossier({ mine, history, survey: s.r.result, paid: { history: h.r.result, survey: s.r.result }, price });
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
