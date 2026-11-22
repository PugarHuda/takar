// Evaluation material for INVOICE_LEDGER_RECONCILE_GENERAL. The invoice and ledger figures are stated in
// the question, so the right answer is arithmetic anyone can redo from the prompt alone: no outside data.
// Cases are the usual reconciliation problems: an exact match, transposed digits, tax left off, a partial
// payment, a duplicate payment, an early-payment discount taken within terms (reconciles) or after them
// (does not), a credit note that closes the gap, and an FX rounding difference inside the stated tolerance.
//
//   node evaluator/invoice-pairs.mjs   -> evaluator/data/invoice-reconcile.jsonl
//
// The better answer gives reconciled, the discrepancy (ledger minus invoice, in the invoice currency) and
// an explanation that names the cause. The worse answer has one error checkable from the prompt: a verdict
// that contradicts its own discrepancy, a wrong discrepancy, the sign reversed, a missing verdict, or an
// explanation that blames the wrong cause. Pinned seed, so the file rebuilds byte for byte.
import { writeFileSync } from "node:fs";

let seed = 20261122;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (a) => a[Math.floor(rand() * a.length)];
const money = (x) => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (x) => Math.round(x * 100) / 100;
const CUR = ["USD", "EUR", "GBP", "AUD", "SGD"];
const LEDGERS = ["accounts receivable", "AR control account", "customer sub-ledger", "bank receipts journal"];

function makeCase(kind, n) {
  const cur = pick(CUR), inv = `INV-${2024}-${String(1000 + n).padStart(5, "0")}`, ledger = pick(LEDGERS);
  const net = r2(int(80_000, 4_900_000) / 100), taxRate = pick([0, 5, 7, 10, 20]);
  const gross = r2(net * (1 + taxRate / 100));
  const head = `Invoice ${inv}: net ${cur} ${money(net)}, tax ${taxRate}%, total ${cur} ${money(gross)}.`;
  let line, paid, explain, ok = null, tolerance = 0;
  switch (kind) {
    case "match": paid = gross; line = `The ${ledger} shows one receipt against ${inv} of ${cur} ${money(paid)}.`; explain = "The receipt equals the invoice total."; break;
    case "transposed": {
      const s = gross.toFixed(2); const d = s.replace(".", ""); let i = int(0, d.length - 2);
      while (d[i] === d[i + 1] && i > 0) i--;
      const sw = d.slice(0, i) + d[i + 1] + d[i] + d.slice(i + 2);
      paid = r2(Number(sw) / 100);
      if (paid === gross) return null;
      line = `The ${ledger} shows one receipt against ${inv} of ${cur} ${money(paid)}.`;
      explain = `Two digits are transposed: the gap of ${money(Math.abs(r2(paid - gross)))} is divisible by 9, the usual sign of a transposition.`; break;
    }
    case "no_tax": if (!taxRate) return null; paid = net; line = `The ${ledger} shows one receipt against ${inv} of ${cur} ${money(paid)}.`; explain = `The customer paid the net amount; the ${taxRate}% tax (${cur} ${money(r2(gross - net))}) is outstanding.`; break;
    case "partial": { const pct = pick([25, 40, 50, 60, 75]); paid = r2(gross * pct / 100); line = `The ${ledger} shows one receipt against ${inv} of ${cur} ${money(paid)}, marked "instalment 1 of 2".`; explain = `A partial payment of ${pct}%; ${cur} ${money(r2(gross - paid))} remains open.`; break; }
    case "duplicate": paid = r2(gross * 2); line = `The ${ledger} shows two receipts against ${inv}, each of ${cur} ${money(gross)}.`; explain = `The invoice was paid twice; ${cur} ${money(gross)} is an overpayment to refund or credit.`; break;
    case "discount_in_terms": { const days = int(3, 10); paid = r2(gross * 0.98); line = `Terms are 2/10 net 30. The ${ledger} shows one receipt of ${cur} ${money(paid)}, ${days} days after the invoice date, and a 2% early-payment discount of ${cur} ${money(r2(gross - paid))} posted to discounts allowed.`; explain = `Paid within the 10-day window, so the 2% discount was earned; receipt plus the posted discount equals the total.`; ok = true; break; }
    case "discount_late": { const days = int(14, 28); paid = r2(gross * 0.98); line = `Terms are 2/10 net 30. The ${ledger} shows one receipt of ${cur} ${money(paid)}, ${days} days after the invoice date, with no discount posted.`; explain = `The customer took a 2% discount after the 10-day window; ${cur} ${money(r2(gross - paid))} is still owed.`; ok = false; break; }
    case "credit_note": { const cn = r2(gross * pick([0.05, 0.1, 0.15])); paid = r2(gross - cn); line = `The ${ledger} shows a receipt of ${cur} ${money(paid)} and credit note CN-${1000 + n} of ${cur} ${money(cn)}, both against ${inv}.`; explain = `The credit note closes the gap: receipt plus credit note equals the invoice total.`; ok = true; break; }
    case "fx_rounding": { tolerance = 1; const d = pick([-0.37, 0.42, -0.08, 0.66]); paid = r2(gross + d); line = `The ${ledger} shows one receipt of ${cur} ${money(paid)} after conversion from the customer's currency; differences under ${cur} 1.00 are written off to FX rounding.`; explain = `A ${cur} ${money(Math.abs(d))} FX rounding difference, inside the stated tolerance.`; ok = true; break; }
  }
  const disc = ok === true && kind !== "fx_rounding" ? 0 : r2(paid - gross);
  const reconciled = ok ?? Math.abs(disc) <= tolerance;
  return { prompt: `${head} ${line} Does it reconcile?`, inv, ledger, right: { reconciled, discrepancy: disc, explanation: explain }, kind, gross, cur };
}

const KINDS = ["match", "transposed", "no_tax", "partial", "duplicate", "discount_in_terms", "discount_late", "credit_note", "fx_rounding"];
const cases = [];
for (let n = 0; cases.length < 108; n++) { const c = makeCase(KINDS[n % KINDS.length], n); if (c) cases.push(c); }
const WRONG_CAUSE = { match: "The customer short-paid the tax.", transposed: "An early-payment discount explains the gap.", no_tax: "Two digits are transposed.", partial: "The invoice was paid twice.", duplicate: "A partial payment; the balance is still open.", discount_in_terms: "The discount was taken after the window, so the balance is owed.", discount_late: "Paid within terms, so the discount was earned.", credit_note: "An FX rounding difference.", fx_rounding: "The customer paid the net amount and left the tax unpaid." };
const J = (o) => JSON.stringify(o);
const pairs = cases.map((c, i) => {
  const right = c.right;
  const errors = [
    ["verdict contradicts its own discrepancy", { ...right, reconciled: !right.reconciled }],
    ["wrong discrepancy", { ...right, discrepancy: r2(right.discrepancy + (right.discrepancy === 0 ? c.gross * 0.1 : right.discrepancy * 0.5)) }],
    ["sign reversed", right.discrepancy !== 0 ? { ...right, discrepancy: -right.discrepancy } : { ...right, reconciled: false, discrepancy: r2(-c.gross * 0.02) }],
    ["missing verdict", (({ reconciled, ...x }) => x)(right)],
    ["wrong cause", { ...right, explanation: WRONG_CAUSE[c.kind] }],
  ];
  const [why, wrong] = errors[i % errors.length];
  return { prompt: c.prompt, chosen: J(right), rejected: J(wrong), why, kind: c.kind };
});
writeFileSync(new URL("./data/invoice-reconcile.jsonl", import.meta.url), pairs.map((p) => J({ prompt: p.prompt, chosen: p.chosen, rejected: p.rejected })).join("\n") + "\n");
const count = (k) => Object.entries(pairs.reduce((a, p) => ((a[p[k]] = (a[p[k]] ?? 0) + 1), a), {})).map(([a, b]) => `${a} ${b}`).join("; ");
console.log(`invoice-reconcile.jsonl ${pairs.length} pairs, ${new Set(pairs.map((p) => p.prompt)).size} unique prompts`);
console.log(`cases: ${count("kind")}`);
console.log(`errors: ${count("why")}`);
