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
import { berth, pair, decide } from "../lib/trade.mjs";

const provider = new ethers.JsonRpcProvider(process.env.RPC ?? "https://ethereum-sepolia-rpc.publicnode.com", 11155111, { staticNetwork: true });
const r1 = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider); // proposes, pays for the evidence
const r2 = new ethers.Wallet(process.env.SERVER_PAYER_KEY, provider); // seconds uncontested deals only
const supplier = new ethers.Wallet(process.env.TAKAR_COUNTERPARTY_KEY, provider);
const buyer = process.env.TAKAR_BUYER_KEY ? new ethers.Wallet(process.env.TAKAR_BUYER_KEY, provider) : null;
const artifact = JSON.parse(readFileSync(new URL("../onchain/TakarSettle4.artifact.json", import.meta.url), "utf8"));
const settle = (w = r1) => new ethers.Contract(process.env.TAKAR_SETTLE4P, artifact.abi, w);
const erc20 = (w) => new ethers.Contract(USDC, ["function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)", "function mint(address,uint256)", "function balanceOf(address) view returns (uint256)"], w);
const [cmd, ...rest] = process.argv.slice(2);
const arg = (k, d) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : d; };
const etherscan = (h) => `https://sepolia.etherscan.io/tx/${h}`;
const STATES = ["open", "proposed", "settled", "reclaimed"];
const DIR = "receipts/trade-assurance";
const log = (row) => { mkdirSync(DIR, { recursive: true }); appendFileSync(`${DIR}/log.jsonl`, JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n"); };

// Miner pairs, each on two different payout operators (checked against /api/miners at run time).
const VESSEL_MINERS = [8818818, 70068]; // Quay (terrestrial AIS network) | VesselWire v2 (Fintraffic Digitraffic)
const INVOICE_MINERS = [302, 20260828]; // ChainSight | PREFLIGHT
const PORTS = { "Helsinki West Harbour": { lat: 60.1497, lon: 24.9155, radiusKm: 1.5 } };

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
  const [vessel, invoice, so, praman] = await Promise.all([
    askBoth("VESSEL_TELEMETRY_VERIFY_GENERAL", VESSEL_MINERS, { vessel: t.vessel }, opOf),
    askBoth("INVOICE_LEDGER_RECONCILE_GENERAL", INVOICE_MINERS, { invoice: t.invoice, ledger: t.ledger }, opOf),
    secondOpinion({ intent: "SANCTIONS_SCREENING_MATCH_GENERAL", params: { name: t.supplier } }, { ask: (a) => ask({ ...a, unit: "trade-assurance" }), ranked, operatorOf: opOf, strictOperators: true, maxAsks: 6, unit: "trade-assurance", fields: ["matched"] }),
    pramanTool("screen_sanctions", { name: t.supplier }).catch((e) => ({ error: e.message })),
  ]);
  for (const v of vessel) v.berth = v.result ? berth(v.result, port, Date.now(), t.vessel) : { state: "unusable", why: v.error };
  const arrival = pair(vessel[0].berth.state, vessel[1].berth.state, "berthed", "away");
  const inv = pair(invoice[0].result?.reconciled, invoice[1].result?.reconciled, true, false);
  // Fail closed: clear only on an explicit no-match, a hit only on an explicit match; anything else is review.
  const verdictOf = (v) => v === false || /^(false|no|0|clear)$/i.test(String(v)) ? true : v === true || /^(true|yes|match|matched|1)$/i.test(String(v)) ? false : null;
  const takarClear = so.verdict === "agree" && so.compared.includes("matched") ? verdictOf(so.answer?.matched) : null;
  const pramanClear = typeof praman.matched === "boolean" && praman.sdn_last_loaded ? !praman.matched : null;
  const sanctions = takarClear === true && pramanClear === true ? "pass" : takarClear === false && pramanClear === false ? "fail" : "review";
  const screens = so.answers.filter((a) => a.usable).map((a) => ({ miner: a.miner?.id, signal: a.signal, matched: a.result?.matched }));
  const checks = { arrival, invoice: inv, sanctions };
  const [decision, why] = decide(checks, t.port);
  const signals = [...vessel, ...invoice, ...screens].map((x) => x.signal).filter(Boolean);
  return { decision, why, checks, vessel, invoice, sanctions: { takar: so.verdict, screens, praman }, signals: [...new Set(signals)] };
}

/** Takar's second key re-reads every signal on the node before backing: each must be an answer to
 *  one of this deal's checks, paid by Takar's agent, asking about this deal's ship or invoice.
 *  ponytail: ties evidence to the deal, does not re-derive berthed/reconciled from raw miner
 *  responses (shapes differ per miner); add per-miner parsers if the second key must re-decide. */
async function backBy(w, id, met, signals, t) {
  const expect = { VESSEL_TELEMETRY_VERIFY_GENERAL: t.vessel, INVOICE_LEDGER_RECONCILE_GENERAL: t.invoice.split(":")[0], SANCTIONS_SCREENING_MATCH_GENERAL: t.supplier };
  for (const s of signals) {
    const r = await fetch(`${NODE}/engine/v1/signal/${s}`, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return { declined: `signal ${s.slice(0, 10)} not found on the node (${r.status})` };
    const p = (await r.json()).payload ?? {};
    if (!(p.intent_id in expect)) return { declined: `signal ${s.slice(0, 10)} answers ${p.intent_id}, not one of this deal's checks` };
    if (String(p.wallet_address).toLowerCase() !== r1.address.toLowerCase()) return { declined: `signal ${s.slice(0, 10)} was not bought by Takar's agent` };
    if (!String(p.request ?? "").includes(expect[p.intent_id])) return { declined: `signal ${s.slice(0, 10)} asks about something other than this deal` };
  }
  const hash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bool", "bytes32[]"], [met, signals]));
  for (let i = 0; ; i++) {
    try { const q = await settle(w).second(id, hash); await q.wait(); return { tx: q.hash, hash }; }
    catch (e) { if (i >= 5 || !/not proposed|different proposal/.test(e.shortMessage ?? e.message)) throw e; await new Promise((r) => setTimeout(r, 4000)); }
  }
}

async function ensureAllowance(w, spender, amount) {
  if ((await erc20(w).allowance(w.address, spender)) < amount) await (await erc20(w).approve(spender, amount * 10n)).wait();
}

if (cmd === "setup") {
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
  const terms = {
    kind: "trade",
    order: "PO-7781: 1,000 stainless fasteners kits at USD 12.40, Tallinn -> Helsinki, delivered (DAP Helsinki West Harbour)",
    supplier: arg("supplier", "Harju Metal OÜ (illustrative supplier)"),
    vessel, port: "Helsinki West Harbour",
    invoice: "INV-2026-1107: 1000 units x USD 12.40 = USD 12,400.00",
    ledger: arg("ledger", "PO-7781: 1000 units x USD 12.40 = USD 12,400.00; goods received 1000 units"),
    text: `Pays the supplier when ${vessel} is berthed at Helsinki West Harbour (two vessel miners on different operators), the invoice reconciles with the PO and goods-received note (two reconcile miners), and the supplier screens clear (two screening miners + Praman). Disagreement = review, not payment. Test USDC, scaled 1:12,400.`,
  };
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
  // A buyer's dispute can come with a new goods-received note; it replaces the ledger for this round.
  const e = await evidence({ ...t, ledger: arg("ledger", t.ledger) });
  const round = { id, at: new Date().toISOString(), ledger: arg("ledger", t.ledger), ...e };
  mkdirSync(DIR, { recursive: true });
  const file = `${DIR}/deal-${id}-${round.at.replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify(round, null, 2));
  console.log(`deal ${id}: ${e.decision.toUpperCase()}: ${e.why}\n  arrival ${e.checks.arrival} (${e.vessel.map((v) => `${v.miner}: ${v.berth.state}${v.berth.km != null ? ` ${v.berth.km} km, ${v.berth.knots} kn` : ""}`).join("; ")})\n  invoice ${e.checks.invoice} (${e.invoice.map((v) => `${v.miner}: ${v.result?.reconciled ?? v.error}`).join("; ")})\n  sanctions ${e.checks.sanctions} (Takar ${e.sanctions.takar}, Praman ${e.sanctions.praman.matched ?? e.sanctions.praman.error})\n  evidence ${file}`);
  if (e.decision === "hold" || e.decision === "review") { log({ action: e.decision, id, why: e.why, file }); process.exit(0); }
  const met = e.decision === "pay";
  if (e.signals.length < 2) throw new Error("fewer than two signals: nothing to propose");
  const evidenceText = JSON.stringify({ decision: e.decision, checks: e.checks, file }).slice(0, 900);
  const p = await s.propose(id, met, e.signals, evidenceText); await p.wait();
  console.log(`  proposed ${e.decision} with ${e.signals.length} signals\n  propose ${etherscan(p.hash)}`);
  log({ action: "propose", id, decision: e.decision, signals: e.signals, file, tx: p.hash });
  const live = await s.deal(id);
  if (live.payerDisputed || live.payeeDisputed) {
    console.log(`  contested deal: Takar's second key steps aside; the decision needs the independent seat (Praman) to back it after its own check`);
    log({ action: "awaiting-independent", id, required: Number(await s.required(id)) });
  } else {
    const b = await backBy(r2, id, met, e.signals, t);
    console.log(b.declined ? `  resolver 2 declined: ${b.declined}` : `  seconded by resolver 2 after re-reading every signal; dispute window open 10 min\n  second ${etherscan(b.tx)}`);
    log({ action: b.declined ? "declined" : "second", id, ...b });
  }
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
  console.log(`deal ${id}: finalized, ${d.conditionMet ? "supplier paid" : "buyer refunded"}\n  ${etherscan(t.hash)}`);
  log({ action: "finalize", id, met: d.conditionMet, tx: t.hash });
} else if (cmd === "status") {
  const s = settle(r1);
  for (let id = 0; id < Number(await s.count()); id++) {
    const d = await s.deal(id);
    let kind; try { kind = JSON.parse(d.terms).kind; } catch { kind = "?"; }
    if (kind !== "trade") continue;
    console.log(`${id} ${STATES[Number(d.state)]} met=${d.conditionMet} approvals=${d.approvals}/${await s.required(id)} window=${d.finalizesAt ? new Date(Number(d.finalizesAt) * 1000).toISOString() : "-"} disputed buyer=${d.payerDisputed} supplier=${d.payeeDisputed}`);
  }
} else if (cmd) {
  console.log("commands: setup | open | check --id N | dispute --id N --as buyer|supplier | finalize --id N | status");
}
