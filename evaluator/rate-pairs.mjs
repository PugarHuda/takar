// Evaluation material for LOAN_INTEREST_RATE_QUOTE_GENERAL from official published rates (FRED copies,
// evaluator/data/fred/*.csv, fetched 22 Nov 2026): the Freddie Mac 30-year and 15-year fixed mortgage
// averages (weekly, PMMS) and the bank prime loan rate (daily, Federal Reserve H.15).
//
//   node evaluator/rate-pairs.mjs   -> evaluator/data/loan-rate.jsonl
//
// The better answer gives the published value for the rate and date asked, with its source. The worse
// answer has one error a judge can see from the question and the answer alone: a different date, the
// other mortgage term, a percent written as a fraction, a missing rate, an impossible value, or a rate
// that is not the one asked for. Upload form: prompt, chosen and rejected only.
import { readFileSync, writeFileSync } from "node:fs";

const csv = (id) => readFileSync(new URL(`./data/fred/${id}.csv`, import.meta.url), "utf8").trim().split("\n").slice(1)
  .map((l) => l.split(",")).filter(([, v]) => v && v !== ".").map(([d, v]) => ({ date: d, v: Number(v) }));
const S = {
  MORTGAGE30US: { rows: csv("MORTGAGE30US"), name: "30-year fixed mortgage average", src: "Freddie Mac Primary Mortgage Market Survey (FRED MORTGAGE30US)", other: "MORTGAGE15US", otherName: "15-year fixed mortgage average" },
  MORTGAGE15US: { rows: csv("MORTGAGE15US"), name: "15-year fixed mortgage average", src: "Freddie Mac Primary Mortgage Market Survey (FRED MORTGAGE15US)", other: "MORTGAGE30US", otherName: "30-year fixed mortgage average" },
  DPRIME: { rows: csv("DPRIME"), name: "bank prime loan rate", src: "Federal Reserve H.15, bank prime loan rate (FRED DPRIME)", other: "MORTGAGE30US", otherName: "30-year fixed mortgage average" },
};
const at = (id, date) => S[id].rows.filter((r) => r.date <= date).at(-1);
const ASK = [
  (n, d) => `What was the US ${n} published for ${d}?`,
  (n, d) => `Give the ${n} as of ${d}, in percent.`,
  (n, d) => `Rate check: the ${n} on ${d}?`,
];
const J = (o) => JSON.stringify(o);
const pairs = [];
let i = 0;
for (const id of Object.keys(S)) {
  const rows = S[id].rows;
  // About 40 dates per series, spread evenly over 2018-2025, so the set covers rising and falling rates.
  for (let k = 0; k < 40; k++, i++) {
    const row = rows[Math.floor((k * rows.length) / 40)];
    const s = S[id];
    const right = { rate_pct: row.v, rate: s.name, as_of: row.date, source: s.src };
    // About a year away: earlier, or later when the series has no year before this date.
    const step = id === "DPRIME" ? 260 : 52, idx = rows.indexOf(row);
    const prev = rows[idx >= step ? idx - step : idx + step];
    const o = at(s.other, row.date) ?? { v: NaN }; // the other series may start a few days later
    const errors = [
      ["date a year away", { ...right, rate_pct: prev.v, as_of: prev.date }],
      ["the other rate", { ...right, rate_pct: o.v, rate: s.otherName, source: S[s.other].src }],
      ["percent written as a fraction", { ...right, rate_pct: +(row.v / 100).toFixed(4) }],
      ["missing rate", (({ rate_pct, ...x }) => x)(right)],
      ["impossible value", { ...right, rate_pct: +(row.v * 100).toFixed(0) }],
    ];
    let [why, wrong] = errors[i % errors.length];
    // A year-earlier value equal to today's is not visibly wrong by value, but its date still is; keep it.
    if (why === "the other rate" && !(Number.isFinite(o.v) && o.v !== row.v)) [why, wrong] = errors[2];
    pairs.push({ prompt: ASK[i % ASK.length](s.name, row.date), chosen: J(right), rejected: J(wrong), why });
  }
}
writeFileSync(new URL("./data/loan-rate.jsonl", import.meta.url), pairs.map((p) => J({ prompt: p.prompt, chosen: p.chosen, rejected: p.rejected })).join("\n") + "\n");
const tally = Object.entries(pairs.reduce((a, p) => ((a[p.why] = (a[p.why] ?? 0) + 1), a), {})).map(([k, v]) => `${k} ${v}`).join("; ");
console.log(`loan-rate.jsonl ${pairs.length} pairs, ${new Set(pairs.map((p) => p.prompt)).size} unique prompts: ${tally}`);
