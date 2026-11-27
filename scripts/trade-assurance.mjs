// Trade Assurance on Takar Settle: a buyer and a supplier disagree on whether payment conditions
// are met, and independent checks decide pay / hold / review. Testnet only (Ethereum Sepolia,
// test USDC). The order is illustrative; the ship, its AIS readings, the miners, the receipts and
// the escrowed money are real.
//
//   node --env-file=.env scripts/trade-assurance.mjs setup                 buyer key + test funds
//   node --env-file=.env scripts/trade-assurance.mjs open [--vessel MEGASTAR] [--amount 1]
//   node --env-file=.env scripts/trade-assurance.mjs check --id N          one evidence round
//   node --env-file=.env scripts/trade-assurance.mjs dispute --id N --as buyer|supplier
//   node --env-file=.env scripts/trade-assurance.mjs finalize --id N
//   node --env-file=.env scripts/trade-assurance.mjs status
//
// The deal pays the supplier only when, at the time of the check:
//   1. arrival: two vessel miners on different operators both put the ship berthed at the
//      destination port (within radiusKm, under 1 knot, reading under 60 min old);
//   2. invoice: two reconcile miners on different operators both say the invoice reconciles
//      with the PO and the goods-received note;
//   3. sanctions: two screening miners on different operators agree the supplier is clear,
//      and Praman's own OFAC SDN screen lands the same way.
// Both arrival miners saying "not there yet" = HOLD. Any disagreement or unusable answer =
// REVIEW (nothing is proposed; a person or the panel looks). Both invoice miners saying it does
// not reconcile = proposal to REFUND the buyer.
// Contract: TakarSettle4 panel at TAKAR_SETTLE4P (resolvers: Takar agent, Takar server key,
// Praman), threshold 2. Takar policy on top: once either party has disputed, Takar's second key
// steps aside, so a contested decision needs the independent seat (Praman) to back it.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ethers } from "ethers";
import { ask, ranked, NODE, USDC } from "../lib/telegraph.mjs";
import { secondOpinion } from "../lib/second.mjs";
import { pramanTool } from "../lib/praman.mjs";
import { existsSync } from "node:fs";
import { memoVerdict, memoUrl } from "../lib/countersign.mjs";
import { berth, pair, decide, payable, portCall, arrivalWith, sameFix, lateBy, latePayout, identity, verifyDocs, verifyInspection, DOC_TYPES, docDomain } from "../lib/trade.mjs";

const provider = new ethers.JsonRpcProvider(process.env.RPC ?? "https://ethereum-sepolia-rpc.publicnode.com", 11155111, { staticNetwork: true });
const r1 = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider); // proposes, pays for the evidence
const r2 = new ethers.Wallet(process.env.SERVER_PAYER_KEY, provider); // seconds uncontested deals only
const supplier = new ethers.Wallet(process.env.TAKAR_COUNTERPARTY_KEY, provider);
const buyer = process.env.TAKAR_BUYER_KEY ? new ethers.Wallet(process.env.TAKAR_BUYER_KEY, provider) : null;
// --v5: TakarSettle5 (split settlement) for quantity disputes; default is the v4 panel (pay or refund).
const V5 = process.argv.includes("--v5");
const ENV = V5 ? "TAKAR_SETTLE5" : "TAKAR_SETTLE4P";
const PRAMAN_SEAT = "0x98021b20Efdb7ae2C57366010a6E0fDE207b4466";
const artifact = JSON.parse(readFileSync(new URL(`../onchain/TakarSettle${V5 ? 5 : 4}.artifact.json`, import.meta.url), "utf8"));
const settle = (w = r1) => { if (!process.env[ENV]) throw new Error(`no ${ENV} in .env`); return new ethers.Contract(process.env[ENV], artifact.abi, w); };
// The decision as the contract takes it: v4 a bool, v5 the payee's amount.
const decisionArg = (payout, amount) => (V5 ? payout : payout === amount);
const proposalHash = (payout, amount, signals) => ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode([V5 ? "uint96" : "bool", "bytes32[]"], [decisionArg(payout, amount), signals]));
const erc20 = (w) => new ethers.Contract(USDC, ["function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)", "function mint(address,uint256)", "function balanceOf(address) view returns (uint256)"], w);
const [cmd, ...rest] = process.argv.slice(2);
const arg = (k, d) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : d; };
const etherscan = (h) => `https://sepolia.etherscan.io/tx/${h}`;
const STATES = ["open", "proposed", "settled", "reclaimed"];
const DIR = "receipts/trade-assurance";
const log = (row) => { mkdirSync(DIR, { recursive: true }); appendFileSync(`${DIR}/log.jsonl`, JSON.stringify({ at: new Date().toISOString(), contract: process.env[ENV] ?? null, ...row }) + "\n"); };

// Miner pairs, each on two different payout operators (checked against /api/miners at run time).
const VESSEL_MINERS = [8818818, 70068]; // Quay (terrestrial AIS network) | VesselWire v2 (Fintraffic Digitraffic)
// TradeWire | ChainSight. PREFLIGHT (20260828) was the second miner until its model stopped answering in
// time on 23 Nov (rounds 2-3 of case 1 show it); evidence files record which miners each round used.
// TAKAR_INVOICE_MINERS="a,b" swaps the pair when one stops answering (302 returned upstream 404s on 27 Nov).
const INVOICE_MINERS = process.env.TAKAR_INVOICE_MINERS ? process.env.TAKAR_INVOICE_MINERS.split(",").map(Number) : [7455, 302];
// locode/area: the port authority's own record of the call (Portnet via Digitraffic), LS = Länsisatama.
const PORTS = { "Helsinki West Harbour": { lat: 60.1497, lon: 24.9155, radiusKm: 1.5, locode: "FIHEL", area: "LS" } };
const IDENTITY_MINER = 731005; // Sadiq's B2B identity miner: legal name + LEI (Ahmed asked for it in Takar's flow)

/** Port calls for the vessel over the last three days, from Fintraffic Digitraffic (Portnet). Free, no key.
 *  The same agency also publishes AIS, but this is a different record: arrivals and departures
 *  declared by the ship's agent and the port, not the ship's own transponder. */
async function portCalls(vessel) {
  const from = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const url = `https://meri.digitraffic.fi/api/port-call/v1/port-calls?vesselName=${encodeURIComponent(vessel)}&from=${from}`;
  const r = await fetch(url, { headers: { "Digitraffic-User": "takar/trade-assurance", "Accept-Encoding": "gzip" }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`port calls ${r.status}`);
  return { url, calls: (await r.json()).portCalls ?? [] };
}

/** The miner's own fields (legal_name, lei) are in the signal's raw response. */
async function rawOf(signal) {
  if (!signal) return {};
  const r = await fetch(`${NODE}/engine/v1/signal/${signal}`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  return r?.ok ? (await r.json()).payload?.response ?? {} : {};
}
const supplierName = (s) => String(s ?? "").replace(/\(.*?\)/g, "").trim();
const docFile = (id, kind) => `${DIR}/doc-v${V5 ? 5 : 4}-${id}-${kind}.json`;
const loadDocs = (id) => Object.fromEntries(["grn", "invoice", "inspection"].filter((k) => existsSync(docFile(id, k))).map((k) => [k, JSON.parse(readFileSync(docFile(id, k), "utf8"))]));

async function operators() {
  const list = await fetch(`${NODE}/api/miners`).then((x) => x.json());
  const m = new Map(list.map((x) => [String(x.id), x.fee_address ?? x.wallet_address ?? null]));
  return (id) => m.get(String(id)) ?? null;
}

async function askBoth(intent, miners, params, opOf) {
  if (opOf(miners[0]) && opOf(miners[0]) === opOf(miners[1])) throw new Error(`${intent}: miners ${miners.join(", ")} share an operator`);
  return Promise.all(miners.map((minerId) => ask({ intent, params, minerId, unit: "trade-assurance", purpose: `trade-assurance ${intent}` })
    .then((r) => ({ miner: minerId, operator: opOf(minerId), signal: r.signal_hash ?? null, result: r.result, fieldStatus: r.field_status ?? null }))
    .catch((e) => ({ miner: minerId, operator: opOf(minerId), signal: null, error: e.message.slice(0, 200) }))));
}

async function evidence(t) {
  const opOf = await operators();
  const port = PORTS[t.port];
  const [vessel, invoice, so, praman, calls, who] = await Promise.all([
    askBoth("VESSEL_TELEMETRY_VERIFY_GENERAL", VESSEL_MINERS, { vessel: t.vessel }, opOf),
    askBoth("INVOICE_LEDGER_RECONCILE_GENERAL", INVOICE_MINERS, { invoice: t.invoice, ledger: t.ledger }, opOf),
    secondOpinion({ intent: "SANCTIONS_SCREENING_MATCH_GENERAL", params: { name: t.supplier } }, { ask: (a) => ask({ ...a, unit: "trade-assurance" }), ranked, operatorOf: opOf, strictOperators: true, maxAsks: 6, unit: "trade-assurance", fields: ["matched"] }),
    pramanTool("screen_sanctions", { name: t.supplier }).catch((e) => ({ error: e.message })),
    portCalls(t.vessel).catch((e) => ({ error: e.message, calls: null })),
    ask({ intent: "B2B_IDENTITY_ENRICHMENT_GENERAL", params: { company: supplierName(t.supplier) }, minerId: IDENTITY_MINER, unit: "trade-assurance", purpose: "trade-assurance identity" })
      .then(async (r) => ({ miner: IDENTITY_MINER, signal: r.signal_hash ?? null, ...identity(await rawOf(r.signal_hash), t.supplier) }))
      .catch((e) => ({ miner: IDENTITY_MINER, signal: null, state: "unverified", why: e.message.slice(0, 160) })),
  ]);
  for (const v of vessel) v.berth = v.result ? berth(v.result, port, Date.now(), t.vessel) : { state: "unusable", why: v.error };
  const ais = pair(vessel[0].berth.state, vessel[1].berth.state, "berthed", "away");
  const portRecord = calls.calls ? { source: calls.url, ...portCall(calls.calls, port, Date.now()) } : { state: "unknown", why: calls.error };
  const arrival = arrivalWith(ais, portRecord.state);
  const oneBroadcast = sameFix(vessel[0].result, vessel[1].result);
  // Identity gates payment only when the buyer's terms ask for a registered entity (requireLei);
  // otherwise it is shown as evidence. The demo suppliers are illustrative, so they are not found.
  const identityCheck = t.requireLei ? (who.state === "verified" ? "pass" : "review") : "pass";
  const late = arrival === "pass" ? lateBy(portRecord.ata, t.deliverBy) : 0;
  const inv = pair(invoice[0].result?.reconciled, invoice[1].result?.reconciled, true, false);
  // Fail closed: clear only on an explicit no-match, a hit only on an explicit match; anything else is review.
  const verdictOf = (v) => v === false || /^(false|no|0|clear)$/i.test(String(v)) ? true : v === true || /^(true|yes|match|matched|1)$/i.test(String(v)) ? false : null;
  const takarClear = so.verdict === "agree" && so.compared.includes("matched") ? verdictOf(so.answer?.matched) : null;
  const pramanClear = typeof praman.matched === "boolean" && praman.sdn_last_loaded ? !praman.matched : null;
  const sanctions = takarClear === true && pramanClear === true ? "pass" : takarClear === false && pramanClear === false ? "fail" : "review";
  const screens = so.answers.filter((a) => a.usable).map((a) => ({ miner: a.miner?.id, signal: a.signal, matched: a.result?.matched }));
  // Signed documents gate payment only when the terms ask for them (signedDocs); always shown.
  const documents = t.signedDocs ? (t.documents?.state === "signed" ? "pass" : "review") : "pass";
  // A Countersign memo, when given for this round, can hold payment (HOLD, unsigned, another order) but never pays alone.
  const countersign = t.countersign ? (t.countersign.state === "release" ? "pass" : "review") : "pass";
  // An inspection certificate is required only when the terms name an inspector; a failed or missing one is review.
  const quality = !t.inspector || t.inspection?.state === "pass" ? "pass" : "review";
  const checks = { arrival, invoice: inv, sanctions, identity: identityCheck, documents, countersign, quality, late };
  let [decision, why] = decide(checks, t.port);
  let payout = decision === "pay" ? t.amount : decision === "refund" ? 0n : null, reconcile = null;
  // Quantity deals: an invoice that does not match the goods-received note is paid for the accepted
  // part, when both miners and Praman's three-way reconciliation agree on the shortfall.
  // Quantity deals are decided on the shortfall figure, not the reconciled flag (miners phrase a
  // partial acceptance differently). Only goods that arrived from a clear supplier can be paid at all.
  if (t.qty && arrival === "pass" && sanctions === "pass" && identityCheck === "pass" && documents === "pass" && countersign === "pass" && quality === "pass" && !late) {
    reconcile = await pramanTool("reconcile_invoice", { invoice_id: t.qty.invoiceId, po_number: t.qty.po, billed_qty: t.qty.billed, accepted_qty: t.qty.accepted, unit_price: t.qty.unitPrice, tax_rate_pct: 0, currency: "USD" }).catch((e) => ({ error: e.message }));
    const p = payable(t.amount, t.qty.billed * t.qty.unitPrice, invoice.map((x) => x.result?.discrepancy), reconcile?.details?.delta_total);
    if (p !== null) [decision, why, payout] = ["partial", `pay for the accepted units only: both reconcile miners and Praman put the shortfall at USD ${Math.abs(Number(invoice[0].result.discrepancy))}`, p];
    else if (inv === "pass" && reconcile?.reconciled === true) [decision, why, payout] = ["pay", "every unit accepted: both miners and Praman reconcile the invoice", t.amount];
    else [decision, why, payout] = ["review", "the miners and Praman do not agree on what was accepted", null];
  }
  // Late, everything else clean, and the terms carry a penalty: settle the split now instead of the panel.
  const lp = !t.qty && late && arrival === "pass" && inv === "pass" && sanctions === "pass" && identityCheck === "pass" && documents === "pass" && countersign === "pass" && quality === "pass" ? latePayout(t.amount, late, t.latePenaltyPctPerDay, t.latePenaltyCapPct) : null;
  if (lp) [decision, why, payout] = ["partial", `delivered ${late} h after the agreed date (${lp.days} started day${lp.days > 1 ? "s" : ""}): ${lp.cutPct}% off, per the terms`, lp.payout];
  const signals = [...vessel, ...invoice, ...screens, who].map((x) => x.signal).filter(Boolean);
  return { decision, why, payout: payout === null ? null : String(payout), checks: { ...checks, ais }, vessel, oneBroadcast, port: portRecord, invoice, sanctions: { takar: so.verdict, screens, praman }, identity: who, documents: t.documents ?? null, countersign: t.countersign ?? null, inspection: t.inspection ?? null, reconcile, signals: [...new Set(signals)] };
}

/** Takar's second key re-reads every signal on the node before backing: each must be an answer to
 *  one of this deal's checks, paid by Takar's agent, asking about this deal's ship or invoice.
 *  ponytail: ties evidence to the deal, does not re-derive berthed/reconciled from raw miner
 *  responses (shapes differ per miner); add per-miner parsers if the second key must re-decide. */
async function backBy(w, id, payout, amount, signals, t) {
  const expect = { VESSEL_TELEMETRY_VERIFY_GENERAL: t.vessel, INVOICE_LEDGER_RECONCILE_GENERAL: t.invoice.split(":")[0], SANCTIONS_SCREENING_MATCH_GENERAL: t.supplier, B2B_IDENTITY_ENRICHMENT_GENERAL: supplierName(t.supplier) };
  for (const s of signals) {
    const r = await fetch(`${NODE}/engine/v1/signal/${s}`, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return { declined: `signal ${s.slice(0, 10)} not found on the node (${r.status})` };
    const p = (await r.json()).payload ?? {};
    if (!(p.intent_id in expect)) return { declined: `signal ${s.slice(0, 10)} answers ${p.intent_id}, not one of this deal's checks` };
    if (String(p.wallet_address).toLowerCase() !== r1.address.toLowerCase()) return { declined: `signal ${s.slice(0, 10)} was not bought by Takar's agent` };
    if (!String(p.request ?? "").includes(expect[p.intent_id])) return { declined: `signal ${s.slice(0, 10)} asks about something other than this deal` };
  }
  const hash = proposalHash(payout, amount, signals);
  for (let i = 0; ; i++) {
    try { const q = await settle(w).second(id, hash); await q.wait(); return { tx: q.hash, hash }; }
    catch (e) { if (i >= 5 || !/not proposed|different proposal/.test(e.shortMessage ?? e.message)) throw e; await new Promise((r) => setTimeout(r, 4000)); }
  }
}

async function ensureAllowance(w, spender, amount) {
  if ((await erc20(w).allowance(w.address, spender)) < amount) await (await erc20(w).approve(spender, amount * 10n)).wait();
}

if (cmd === "deploy") {
  if (!V5) throw new Error("deploy is for --v5; the v4 panel already exists");
  const f = new ethers.ContractFactory(artifact.abi, artifact.bytecode, r1);
  const panel = [r1.address, r2.address, PRAMAN_SEAT];
  const c = await f.deploy(USDC, panel, 2, 600, 500_000);
  await c.waitForDeployment();
  appendFileSync(".env", `\nTAKAR_SETTLE5=${c.target}\n`);
  process.env.TAKAR_SETTLE5 = c.target;
  console.log(`TakarSettle5 at ${c.target}: resolvers ${panel.join(", ")}; threshold 2, liveness 10 min, bond 0.5\n  ${etherscan(c.deploymentTransaction().hash)}`);
  log({ action: "deploy", resolvers: panel, tx: c.deploymentTransaction().hash });
} else if (cmd === "setup") {
  let key = process.env.TAKAR_BUYER_KEY;
  if (!key) { key = ethers.Wallet.createRandom().privateKey; appendFileSync(".env", `\nTAKAR_BUYER_KEY=${key}\n`); }
  const b = new ethers.Wallet(key, provider);
  for (const a of [b.address, supplier.address]) {
    if ((await provider.getBalance(a)) < ethers.parseEther("0.002")) await (await r1.sendTransaction({ to: a, value: ethers.parseEther("0.004") })).wait();
  }
  if ((await erc20(r1).balanceOf(b.address)) < 3_000_000n) await (await erc20(r1).mint(b.address, 5_000_000n)).wait();
  console.log(`buyer ${b.address}, supplier ${supplier.address}: funded with test ETH and test USDC`);
  log({ action: "setup", buyer: b.address, supplier: supplier.address });
} else if (cmd === "open") {
  if (!buyer) throw new Error("run setup first");
  const s = settle(buyer);
  const amount = ethers.parseUnits(String(arg("amount", "1")), 6);
  await ensureAllowance(buyer, s.target, amount);
  const vessel = arg("vessel", "MEGASTAR");
  // --qty: the quantity case. The supplier invoices the full order; the buyer's goods-received note
  // accepts part of it. The contract pays for accepted goods, so arrival alone never pays.
  const qty = rest.includes("--qty") ? { invoiceId: "INV-2026-1201", po: "PO-7790", billed: 1000, accepted: Number(arg("accepted", "960")), unitPrice: 12.4 } : null;
  const terms = qty ? {
    kind: "trade", qty,
    order: "PO-7790: 1,000 stainless fastener kits at USD 12.40, Tallinn -> Helsinki, paid on goods accepted at the buyer's warehouse",
    supplier: arg("supplier", "Harju Metal OÜ (illustrative supplier)"),
    vessel, port: "Helsinki West Harbour",
    invoice: "INV-2026-1201: 1000 units x USD 12.40 = USD 12,400.00",
    ledger: `GRN-5541 for PO-7790 and INV-2026-1201: ${qty.accepted} units accepted at USD 12.40 = USD ${(qty.accepted * 12.4).toLocaleString("en-US", { minimumFractionDigits: 2 })}; ${qty.billed - qty.accepted} units rejected`,
    text: `Ship arrival is not delivery: the supplier is paid for the units the buyer's goods-received note accepts. Needs ${vessel} berthed (two vessel miners), the shortfall agreed by two reconcile miners and Praman's three-way reconciliation, and the supplier clear. Test USDC, scaled 1:12,400.`,
  } : {
    kind: "trade",
    order: "PO-7781: 1,000 stainless fasteners kits at USD 12.40, Tallinn -> Helsinki, delivered (DAP Helsinki West Harbour)",
    supplier: arg("supplier", "Harju Metal OÜ (illustrative supplier)"),
    vessel, port: "Helsinki West Harbour",
    invoice: "INV-2026-1107: 1000 units x USD 12.40 = USD 12,400.00",
    ledger: arg("ledger", "PO-7781: 1000 units x USD 12.40 = USD 12,400.00; goods received 1000 units"),
    text: `Pays the supplier when ${vessel} is berthed at Helsinki West Harbour (two vessel miners on different operators), the invoice reconciles with the PO and goods-received note (two reconcile miners), and the supplier screens clear (two screening miners + Praman). Disagreement = review, not payment. Test USDC, scaled 1:12,400.`,
  };
  // --deliver-by <ISO>: arriving after it (by the port's actual arrival time) sends the deal to the panel.
  // --require-lei: payment also needs the supplier resolved to a registered entity with an LEI.
  if (arg("deliver-by")) { terms.deliverBy = new Date(arg("deliver-by")).toISOString(); terms.text += ` Latest delivery ${terms.deliverBy} by the port's actual arrival time; later goes to the panel.`; }
  // --late-penalty <pct per day>[,<cap pct>] (TakarSettle5 only): a late delivery settles as a split instead of going to the panel.
  if (arg("late-penalty")) {
    if (!V5) throw new Error("--late-penalty needs --v5 (split settlement)");
    const [pct, cap = 30] = arg("late-penalty").split(",").map(Number);
    Object.assign(terms, { latePenaltyPctPerDay: pct, latePenaltyCapPct: cap });
    terms.text += ` Late delivery: ${pct}% off per started day, at most ${cap}%.`;
  }
  // --inspector <address>: payment also needs that inspector's signed certificate with every inspected unit passing.
  if (arg("inspector")) { terms.inspector = ethers.getAddress(arg("inspector")); terms.text += ` Quality: needs a passing inspection certificate signed by ${terms.inspector}.`; }
  if (rest.includes("--require-lei")) { terms.requireLei = true; terms.text += " The supplier must resolve to a registered entity with an LEI."; }
  const t = await s.open(supplier.address, amount, BigInt(Math.floor(Date.now() / 1000) + 60), 0, JSON.stringify(terms));
  const r = await t.wait();
  const id = Number(s.interface.parseLog(r.logs.find((l) => l.address.toLowerCase() === s.target.toLowerCase())).args.id);
  console.log(`opened deal ${id}: buyer ${buyer.address} locked ${ethers.formatUnits(amount, 6)} test USDC for the supplier\n  ${etherscan(t.hash)}`);
  log({ action: "open", id, terms, tx: t.hash });
} else if (cmd === "check") {
  const id = Number(arg("id"));
  const s = settle(r1);
  const d = await s.deal(id);
  const t = JSON.parse(d.terms);
  if (t.kind !== "trade") throw new Error(`deal ${id} is not a trade deal`);
  if (STATES[Number(d.state)] !== "open" && !(STATES[Number(d.state)] === "proposed" && d.finalizesAt === 0n)) throw new Error(`deal ${id} is ${STATES[Number(d.state)]}${d.finalizesAt ? " with its window open" : ""}`);
  // The parties' signed documents, when present: the buyer's signed note is what the miners reconcile.
  const docs = loadDocs(id);
  const documents = verifyDocs(docs, { contract: s.target, dealId: id, payer: d.payer, payee: d.payee });
  const inspection = verifyInspection(docs.inspection, { contract: s.target, dealId: id, po: t.order.split(':')[0], inspector: t.inspector });
  // A buyer's dispute can come with a new goods-received note; it replaces the ledger for this round.
  const ledger = arg("ledger", documents.state === "signed" ? documents.note : t.ledger);
  // --countersign <memo id>: Countersign's signed shipment report for this order, verified here
  // (digest and signature recomputed, signer pinned, PO must match the deal's).
  const memo = arg("countersign");
  const countersign = memo ? await fetch(memoUrl(memo), { signal: AbortSignal.timeout(20_000) }).then((r) => r.json())
    .then((m) => ({ url: memoUrl(memo), ...memoVerdict(m, { po: t.order.match(/PO-[\w-]+/)?.[0] }) }))
    .catch((err) => ({ url: memoUrl(memo), state: "unusable", why: err.message })) : null;
  const e = await evidence({ ...t, amount: d.amount, ledger, documents, countersign, inspection });
  const round = { id, at: new Date().toISOString(), ledger, ...e };
  mkdirSync(DIR, { recursive: true });
  const file = `${DIR}/deal-${id}-${round.at.replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify(round, null, 2));
  console.log(`deal ${id}: ${e.decision.toUpperCase()}: ${e.why}\n  arrival ${e.checks.arrival} (${e.vessel.map((v) => `${v.miner}: ${v.berth.state}${v.berth.km != null ? ` ${v.berth.km} km, ${v.berth.knots} kn` : ""}`).join("; ")})\n  invoice ${e.checks.invoice} (${e.invoice.map((v) => `${v.miner}: ${v.result?.reconciled ?? v.error}`).join("; ")})\n  sanctions ${e.checks.sanctions} (Takar ${e.sanctions.takar}, Praman ${e.sanctions.praman.matched ?? e.sanctions.praman.error})\n  evidence ${file}`);
  if (e.decision === "hold" || e.decision === "review") { log({ action: e.decision, id, why: e.why, file }); process.exit(0); }
  const payout = BigInt(e.payout);
  if (!V5 && payout !== 0n && payout !== d.amount) throw new Error("a split payout needs the v5 contract");
  if (e.signals.length < 2) throw new Error("fewer than two signals: nothing to propose");
  const evidenceText = JSON.stringify({ decision: e.decision, checks: e.checks, file }).slice(0, 900);
  const p = await s.propose(id, decisionArg(payout, d.amount), e.signals, evidenceText); await p.wait();
  console.log(`  proposed ${e.decision} with ${e.signals.length} signals\n  propose ${etherscan(p.hash)}`);
  log({ action: "propose", id, decision: e.decision, payout: String(payout), signals: e.signals, file, tx: p.hash });
  const live = await s.deal(id);
  if (V5 && (live.payerDisputed || live.payeeDisputed)) {
    // TakarSettle5 needs every resolver once contested: Takar's second key checks and backs, and the
    // window still cannot open without Praman's seat.
    const b = await backBy(r2, id, payout, d.amount, e.signals, t);
    console.log(b.declined ? `  resolver 2 declined: ${b.declined}` : `  seconded by resolver 2; contested, so the contract also needs Praman's seat (${Number(await s.required(id))} of 3)\n  second ${etherscan(b.tx)}`);
    log({ action: b.declined ? "declined" : "second", id, ...b });
    log({ action: "awaiting-independent", id, required: Number(await s.required(id)) });
  } else if (live.payerDisputed || live.payeeDisputed) {
    console.log(`  contested deal: Takar's second key steps aside; the decision needs the independent seat (Praman) to back it after its own check`);
    log({ action: "awaiting-independent", id, required: Number(await s.required(id)) });
  } else if (!(await s.isResolver(r2.address))) {
    // Takar's second key is not on this machine (it stayed on another device on 27 Nov): rather than
    // fail half-way, the proposal waits for the other seat that can back it, Praman's.
    console.log(`  Takar's second key is not available here; the proposal waits for Praman's seat (${Number(await s.required(id))} of 3)`);
    log({ action: "awaiting-independent", id, required: Number(await s.required(id)), note: "second key unavailable" });
  } else {
    const b = await backBy(r2, id, payout, d.amount, e.signals, t);
    console.log(b.declined ? `  resolver 2 declined: ${b.declined}` : `  seconded by resolver 2 after re-reading every signal; dispute window open 10 min\n  second ${etherscan(b.tx)}`);
    log({ action: b.declined ? "declined" : "second", id, ...b });
  }
} else if (cmd === "panel") {
  // A REVIEW goes to the panel: Takar proposes a decision on a round's evidence with its reason in
  // the open, and Takar's second key does not back its own review call, so the window opens only
  // when Praman's seat agrees after its own check.
  const id = Number(arg("id")), file = arg("file"), reason = arg("reason");
  if (!file || !reason || !["pay", "refund"].includes(arg("decision"))) throw new Error("panel --id N --file <evidence.json> --decision pay|refund --reason <text>");
  const s = settle(r1);
  const d = await s.deal(id);
  const ev = JSON.parse(readFileSync(file, "utf8"));
  if (ev.id !== id) throw new Error(`${file} is evidence for deal ${ev.id}, not ${id}`);
  const payout = arg("decision") === "pay" ? d.amount : 0n;
  const p = await s.propose(id, decisionArg(payout, d.amount), ev.signals, JSON.stringify({ panel: arg("decision"), reason, file }).slice(0, 900)); await p.wait();
  const hash = proposalHash(payout, d.amount, ev.signals);
  console.log(`deal ${id}: panel proposal ${arg("decision")} on ${ev.signals.length} signals; waiting for Praman's seat\n  hash ${hash}\n  propose ${etherscan(p.hash)}`);
  log({ action: "panel-propose", id, decision: arg("decision"), payout: String(payout), reason, file, hash, signals: ev.signals, tx: p.hash });
  log({ action: "awaiting-independent", id, required: Number(await s.required(id)) });
} else if (cmd === "sign") {
  // sign --id N --doc grn [--accepted n] [--note "..."]   the buyer signs what it received
  // sign --id N --doc invoice                             the supplier signs what it billed
  // Numbers come from the deal's terms on chain, so a document cannot drift from the order.
  const id = Number(arg("id")), kind = arg("doc");
  const d = await settle(r1).deal(id);
  const t = JSON.parse(d.terms);
  const po = t.order.match(/PO-\d+/)?.[0], inv = t.invoice.match(/INV-[\d-]+/)?.[0];
  const units = Number(t.invoice.match(/(\d+) units/)?.[1]), cents = Math.round(Number(t.invoice.match(/USD ([\d.]+)/)?.[1]) * 100);
  if (!po || !inv || !units || !cents) throw new Error("cannot read PO, invoice, units and price from the terms");
  const [w, type, message] = kind === "grn"
    ? [buyer, "GoodsReceipt", { dealId: id, po, invoice: inv, acceptedUnits: Number(arg("accepted", t.qty?.accepted ?? units)), rejectedUnits: units - Number(arg("accepted", t.qty?.accepted ?? units)), note: arg("note", t.ledger) }]
    : kind === "invoice" ? [supplier, "Invoice", { dealId: id, invoice: inv, po, units, unitPriceCents: cents, totalCents: units * cents }]
    : kind === "inspection" ? [process.env.INSPECTOR_KEY ? new ethers.Wallet(process.env.INSPECTOR_KEY) : null, "Inspection", { dealId: id, po, standard: arg("standard", "ISO 2859-1 AQL 2.5"), inspectedUnits: Number(arg("inspected", 125)), passedUnits: Number(arg("passed", arg("inspected", 125))), note: arg("note", "arrival inspection") }] : [];
  if (!w) throw new Error("--doc grn|invoice|inspection (grn needs TAKAR_BUYER_KEY, inspection needs INSPECTOR_KEY)");
  if (kind === "inspection" && w.address.toLowerCase() !== String(t.inspector ?? "").toLowerCase()) throw new Error(`inspector key ${w.address} is not the inspector the terms name (${t.inspector ?? "none"})`);
  if (kind !== "inspection" && w.address.toLowerCase() !== (kind === "grn" ? d.payer : d.payee).toLowerCase()) throw new Error(`${kind === "grn" ? "buyer" : "supplier"} key ${w.address} is not this deal's ${kind === "grn" ? "payer" : "payee"}`);
  const signature = await w.signTypedData(docDomain(settle(r1).target), { [type]: DOC_TYPES[type] }, message);
  writeFileSync(docFile(id, kind), JSON.stringify({ type, domain: docDomain(settle(r1).target), message, signer: w.address, signature }, null, 2) + "\n");
  console.log(`deal ${id}: ${type} signed by ${w.address} -> ${docFile(id, kind)}`);
  log({ action: "sign", id, doc: kind, signer: w.address, file: docFile(id, kind) });
} else if (cmd === "dispute") {
  const id = Number(arg("id")), who = arg("as");
  const w = who === "buyer" ? buyer : who === "supplier" ? supplier : null;
  if (!w) throw new Error("--as buyer|supplier");
  const s = settle(w);
  await ensureAllowance(w, s.target, await s.bond());
  const t = await s.dispute(id); await t.wait();
  console.log(`deal ${id}: disputed by the ${who}, bond posted\n  ${etherscan(t.hash)}`);
  log({ action: "dispute", id, by: who, reason: arg("reason", null), tx: t.hash });
} else if (cmd === "finalize") {
  const id = Number(arg("id"));
  const d = await settle(r1).deal(id);
  const t = await settle(r1).finalize(id); await t.wait();
  const paid = V5 ? d.payout : d.conditionMet ? d.amount : 0n;
  console.log(`deal ${id}: finalized: supplier ${ethers.formatUnits(paid, 6)}, buyer refunded ${ethers.formatUnits(d.amount - paid, 6)}\n  ${etherscan(t.hash)}`);
  log({ action: "finalize", id, toSupplier: String(paid), toBuyer: String(d.amount - paid), tx: t.hash });
} else if (cmd === "status") {
  const s = settle(r1);
  for (let id = 0; id < Number(await s.count()); id++) {
    const d = await s.deal(id);
    let kind; try { kind = JSON.parse(d.terms).kind; } catch { kind = "?"; }
    if (kind !== "trade") continue;
    console.log(`${id} ${STATES[Number(d.state)]} decision=${V5 ? ethers.formatUnits(d.payout, 6) : d.conditionMet} approvals=${d.approvals}/${await s.required(id)} window=${d.finalizesAt ? new Date(Number(d.finalizesAt) * 1000).toISOString() : "-"} disputed buyer=${d.payerDisputed} supplier=${d.payeeDisputed}`);
  }
} else if (cmd) {
  console.log("commands: setup | open | check --id N | dispute --id N --as buyer|supplier | finalize --id N | status");
}
