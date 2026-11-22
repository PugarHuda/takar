// Evaluation material for URL_SAFE_GENERAL from public lists (evaluator/data/url/selected.json, 22 Nov 2026):
//   Malicious: hosts on BOTH Phishing.Database's active phishing domains and the Phishing Army blocklist,
//              brand-impersonating hosts first. Phishing Army aggregates several feeds, so the two lists
//              may share upstream sources; two listings are still stronger than one.
//   Safe:      Tranco top-300 domains that are on neither phishing list.
//
//   node evaluator/url-pairs.mjs   -> evaluator/data/url-safe.jsonl
//
// The better answer echoes the URL, gives the verdict, the number of lists flagging it and a summary that
// names them. The worse answer has one error a judge can see from the question and the answer alone:
// a verdict that contradicts its own detections and summary, a different URL than the one asked,
// an impossible detection count, a verdict outside the allowed set, or a missing verdict.
// Upload form: prompt, chosen and rejected only.
import { readFileSync, writeFileSync } from "node:fs";

const sel = JSON.parse(readFileSync(new URL("./data/url/selected.json", import.meta.url), "utf8"));
const J = (o) => JSON.stringify(o);
const ASK = [(u) => `Is ${u} safe to open?`, (u) => `Check this link before I click it: ${u}`, (u) => `URL reputation for ${u}?`];
const cases = [
  ...sel.malicious.slice(0, 60).map((d) => ({ url: `https://${d}/`, right: { verdict: "Malicious", detections: 2, summary: `Listed as an active phishing host by Phishing.Database and by the Phishing Army blocklist (checked ${sel.fetched}).` } })),
  ...sel.safe.slice(0, 60).map(({ rank, domain }) => ({ url: `https://${domain}/`, right: { verdict: "Safe", detections: 0, summary: `On neither phishing list checked (Phishing.Database, Phishing Army); Tranco rank ${rank} (${sel.fetched}).` } })),
];
const pairs = cases.map((c, i) => {
  const right = { url: c.url, ...c.right };
  const flip = right.verdict === "Safe" ? "Malicious" : "Safe";
  const decoy = cases[(i + 7) % cases.length].url;
  const errors = [
    ["verdict contradicts its own evidence", { ...right, verdict: flip }],
    ["a different URL than the one asked", { ...right, url: decoy }],
    ["impossible detection count", { ...right, detections: -1 }],
    ["verdict outside the allowed set", { ...right, verdict: right.verdict === "Safe" ? "Clean" : "Dangerous" }],
    ["missing verdict", (({ verdict, ...r }) => r)(right)],
  ];
  const [why, wrong] = errors[i % errors.length];
  return { prompt: ASK[i % ASK.length](c.url), chosen: J(right), rejected: J(wrong), why };
});
writeFileSync(new URL("./data/url-safe.jsonl", import.meta.url), pairs.map((p) => J({ prompt: p.prompt, chosen: p.chosen, rejected: p.rejected })).join("\n") + "\n");
const tally = Object.entries(pairs.reduce((a, p) => ((a[p.why] = (a[p.why] ?? 0) + 1), a), {})).map(([k, v]) => `${k} ${v}`).join("; ");
console.log(`url-safe.jsonl ${pairs.length} pairs, ${new Set(pairs.map((p) => p.prompt)).size} unique prompts: ${tally}`);
