// Takar Settle v2: conditional payments on Ethereum Sepolia, settled by intelligence bought
// through Telegraph, with a quorum of answers and a dispute window. Testnet only (test USDC).
//
//   node --env-file=.env scripts/settle.mjs deploy       [--liveness 10]   minutes a proposal can be disputed
//   node --env-file=.env scripts/settle.mjs open-event   --question "Did Argentina win the 2022 FIFA World Cup?" [--amount 1] [--after 2]
//   node --env-file=.env scripts/settle.mjs open-drought --location Bandung --from 2026-11-15 --to 2026-11-17 --trigger 30 [--amount 1] [--after 2]
//   node --env-file=.env scripts/settle.mjs run          propose for every due deal, finalize every undisputed proposal
//   node --env-file=.env scripts/settle.mjs dispute --id 3 --as payee|payer
//   node --env-file=.env scripts/settle.mjs list
//
// An event deal is proposed only when two different miners agree (our own miner asked by id,
// plus the ranked route); the contract refuses fewer than two signals. A drought cover is
// proposed only when NASA POWER puts the period on the same side of the trigger as Telegraph.
//
// --after is minutes until the deal may settle. The payee is a counterparty wallet created on
// first use (its key goes to .env, so its test USDC can be recovered). Every settlement is
// appended to receipts/settlements.jsonl with the Telegraph signal it rests on.
import { appendFileSync, readFileSync, mkdirSync } from "node:fs";
import { ethers } from "ethers";
import { ask, ranked } from "../lib/telegraph.mjs";
import { daysOf, droughtCondition, eventQuorum, droughtAgrees } from "../lib/settle.mjs";
import { geocode, nasaPowerRain } from "../lib/observe.mjs";
import { TAKAR_OUTCOME_ID } from "../lib/scorecard.mjs";

const USDC = "0xcc194e1a843B658526D0D5C431f670028582Ae17";
const provider = new ethers.JsonRpcProvider(process.env.RPC ?? "https://ethereum-sepolia-rpc.publicnode.com", 11155111);
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
const artifact = JSON.parse(readFileSync(new URL("../onchain/TakarSettle.artifact.json", import.meta.url), "utf8"));
const usdc = new ethers.Contract(USDC, ["function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)", "function balanceOf(address) view returns (uint256)"], wallet);
const KIND = { event: 0, weather: 1 };

const [cmd, ...rest] = process.argv.slice(2);
const arg = (k, d) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : d; };
const tx = (h) => `https://sepolia.etherscan.io/tx/${h}`;

function remember(key, value) {
  appendFileSync(".env", `\n${key}=${value}\n`);
  process.env[key] = value;
}
// v1 (0xfB5E…2808, one answer, no dispute window) stays in TAKAR_SETTLE with its receipts.
const ADDR = "TAKAR_SETTLE2";
const contract = (signer = wallet) => {
  if (!process.env[ADDR]) throw new Error(`no ${ADDR} in .env: run \`deploy\` first`);
  return new ethers.Contract(process.env[ADDR], artifact.abi, signer);
};
const STATES = ["open", "proposed", "settled", "reclaimed"];
function counterparty() {
  if (!process.env.TAKAR_COUNTERPARTY_KEY) remember("TAKAR_COUNTERPARTY_KEY", ethers.Wallet.createRandom().privateKey);
  return new ethers.Wallet(process.env.TAKAR_COUNTERPARTY_KEY).address;
}

async function open(kind, terms) {
  const s = contract();
  const amount = ethers.parseUnits(String(arg("amount", "1")), 6);
  if (amount > ethers.parseUnits("5", 6)) throw new Error("testnet demo: at most 5 test USDC per deal");
  const after = BigInt(Math.floor(Date.now() / 1000) + Number(arg("after", "2")) * 60);
  if ((await usdc.allowance(wallet.address, s.target)) < amount) await (await usdc.approve(s.target, amount * 10n)).wait();
  const t = await s.open(counterparty(), amount, after, KIND[kind], JSON.stringify(terms));
  const r = await t.wait();
  const id = s.interface.parseLog(r.logs.find((l) => l.address.toLowerCase() === s.target.toLowerCase())).args.id;
  console.log(`opened deal ${id} (${kind}), ${ethers.formatUnits(amount, 6)} test USDC, settles after ${new Date(Number(after) * 1000).toISOString()}\n  ${tx(t.hash)}`);
}

/** Buy what a deal needs and decide. Returns { met, why, signals } or { hold } (wait). */
async function decide(terms, run) {
  if (terms.kind === "event") {
    const answers = [];
    const one = async (minerId) => {
      try {
        const r = await ask({ intent: "EVENT_OUTCOME_RESOLUTION_GENERAL", params: { event: terms.question }, minerId, unit: "settle-m14", run, purpose: `mission14:settle ${terms.question.slice(0, 60)}` });
        answers.push({ miner: r.ledger?.miner ?? { id: String(minerId) }, result: r.result_shape === "intent" ? r.result : null, signal: r.signal_hash ?? null });
      } catch (e) { console.log(`  ask ${minerId ?? "routed"}: ${e.message.slice(0, 100)}`); }
    };
    await one(TAKAR_OUTCOME_ID);
    await one(undefined); // the ranked route
    // The route can land on our own miner: then ask the best-ranked other miner.
    const ids = new Set(answers.map((x) => String(x.miner?.id)));
    if (ids.size < 2) {
      const next = (await ranked("EVENT_OUTCOME_RESOLUTION_GENERAL").catch(() => [])).find((m) => !ids.has(String(m.id)));
      if (next) await one(next.id);
    }
    const q = eventQuorum(answers);
    return { ...q, answers: answers.map((x) => ({ miner: x.miner, outcome: x.result?.outcome ?? null, signal: x.signal })) };
  }
  if (terms.kind === "weather") {
    const days = daysOf(terms.from, terms.to);
    const readings = [];
    const signals = [];
    for (const date of days) {
      const r = await ask({ intent: "WEATHER_FORECAST_VERIFY_GENERAL", params: { location: terms.location, date }, unit: "settle-m06", run, purpose: `mission06:cover ${terms.location} ${date}` });
      if (r.result_shape === "intent" && r.result) readings.push({ date, precipitation_mm: r.result.precipitation_mm });
      if (r.signal_hash && !signals.includes(r.signal_hash)) signals.push(r.signal_hash); // every day's signal goes on-chain
    }
    const c = droughtCondition(readings, { days, triggerMm: terms.triggerMm });
    if (!c) return { hold: "Telegraph has no readable record for every day yet", readings };
    const place = await geocode(terms.location);
    const independent = await nasaPowerRain(place, terms.from, terms.to);
    const agreed = droughtAgrees(c, independent, { days, triggerMm: terms.triggerMm });
    return agreed.hold ? { ...agreed, readings, independent } : { ...agreed, signals, readings, independent };
  }
  return { hold: "unknown deal kind" };
}

// The contract is public: anyone can open a deal on it. Settling one costs this
// agent paid asks, so it only works for payers it serves (itself by default, or
// TAKAR_SETTLE_PAYERS), and stops after MAX_ASKS paid asks per run. A deal from
// anyone else stays open; its payer can still reclaim it after the grace period.
const PAYERS = new Set((process.env.TAKAR_SETTLE_PAYERS ?? wallet.address).split(",").map((a) => ethers.getAddress(a.trim())));
const MAX_ASKS = Number(process.env.TAKAR_SETTLE_MAX_ASKS ?? 40);
const asksFor = (terms) => (terms.kind === "weather" ? daysOf(terms.from, terms.to).length : 3);

async function runDue() {
  const s = contract();
  const run = new Date().toISOString();
  const n = Number(await s.count());
  const now = Math.floor(Date.now() / 1000);
  let budget = MAX_ASKS;
  mkdirSync("receipts", { recursive: true });
  const log = (entry) => appendFileSync("receipts/settlements.jsonl", JSON.stringify({ at: new Date().toISOString(), run, contract: s.target, ...entry }) + "\n");
  for (let id = 0; id < n; id++) {
    const d = await s.deal(id);
    const state = STATES[Number(d.state)];
    if (state === "proposed") {
      // Anyone may finalize once the dispute window is over; the agent does it for its deals.
      if (Number(d.finalizesAt) > now) { console.log(`deal ${id}: proposed, disputable until ${new Date(Number(d.finalizesAt) * 1000).toISOString()}`); continue; }
      const t = await s.finalize(id);
      await t.wait();
      log({ deal: id, action: "finalize", met: d.conditionMet, paidTo: d.conditionMet ? "payee" : "payer", amount: ethers.formatUnits(d.amount, 6), tx: t.hash });
      console.log(`deal ${id}: FINALIZED, ${d.conditionMet ? "PAID payee" : "REFUNDED payer"}\n  ${tx(t.hash)}`);
      continue;
    }
    if (state !== "open") continue;
    if (!PAYERS.has(ethers.getAddress(d.payer))) { console.log(`deal ${id}: payer ${d.payer} is not one this agent serves, skipped`); continue; }
    if (Number(d.resolveAfter) > now) { console.log(`deal ${id}: not due until ${new Date(Number(d.resolveAfter) * 1000).toISOString()}`); continue; }
    let terms;
    try { terms = JSON.parse(d.terms); } catch { console.log(`deal ${id}: terms are not Takar terms, skipped`); continue; }
    let cost;
    try { cost = asksFor(terms); } catch (e) { console.log(`deal ${id}: ${e.message}, skipped`); continue; }
    if (cost > budget) { console.log(`deal ${id}: needs ${cost} paid asks, ${budget} left in this run's cap, left for the next run`); continue; }
    budget -= cost;
    const c = await decide(terms, run).catch((e) => ({ hold: e.message.slice(0, 160) }));
    if (c.hold) {
      log({ deal: id, action: "hold", terms, why: c.hold, answers: c.answers ?? null, readings: c.readings ?? null });
      console.log(`deal ${id}: HOLD, ${c.hold}`);
      continue;
    }
    const t = await s.propose(id, c.met, c.signals, c.why.slice(0, 280));
    await t.wait();
    log({ deal: id, action: "propose", terms, met: c.met, paysTo: c.met ? "payee" : "payer", amount: ethers.formatUnits(d.amount, 6), why: c.why, signals: c.signals, answers: c.answers ?? null, readings: c.readings ?? null, independent: c.independent ? { source: "NASA POWER", totalMm: c.independentMm } : null, tx: t.hash });
    console.log(`deal ${id}: PROPOSED ${c.met ? "pay payee" : "refund payer"}, ${c.why}\n  ${tx(t.hash)}`);
  }
}

if (cmd === "deploy") {
  if (process.env[ADDR]) throw new Error(`already deployed at ${process.env[ADDR]}`);
  const liveness = Number(arg("liveness", "10")) * 60; // a demo window; a real deal would use hours
  const f = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const c = await f.deploy(USDC, wallet.address, liveness);
  await c.waitForDeployment();
  remember(ADDR, c.target);
  console.log(`TakarSettle v2 at ${c.target} (resolver ${wallet.address}, liveness ${liveness} s)\n  ${tx(c.deploymentTransaction().hash)}`);
} else if (cmd === "open-event") {
  const question = String(arg("question", "")).trim();
  if (!question) throw new Error("--question is required");
  await open("event", { kind: "event", question, text: `Pays the payee if Telegraph resolves "${question}" as yes; refunds the payer if no.` });
} else if (cmd === "open-drought") {
  const location = arg("location"), from = arg("from"), to = arg("to"), triggerMm = Number(arg("trigger"));
  if (!location || !from || !to || !(triggerMm > 0)) throw new Error("--location, --from, --to and --trigger are required");
  daysOf(from, to); // validates the period
  await open("weather", { kind: "weather", location, from, to, triggerMm, text: `Drought cover for ${location}, ${from} to ${to}. Pays the payee if recorded rain over the period is under ${triggerMm} mm; refunds the payer otherwise.` });
} else if (cmd === "run") {
  await runDue();
} else if (cmd === "dispute") {
  // Demo of the dispute window: the payee is the counterparty wallet, the payer is the agent.
  const id = Number(arg("id"));
  const as = arg("as", "payee");
  counterparty();
  const signer = as === "payee" ? new ethers.Wallet(process.env.TAKAR_COUNTERPARTY_KEY, provider) : wallet;
  if (as === "payee" && (await provider.getBalance(signer.address)) < ethers.parseEther("0.0005")) {
    await (await wallet.sendTransaction({ to: signer.address, value: ethers.parseEther("0.002") })).wait(); // gas for the testnet counterparty
  }
  const t = await contract(signer).dispute(id);
  await t.wait();
  appendFileSync("receipts/settlements.jsonl", JSON.stringify({ at: new Date().toISOString(), contract: process.env[ADDR], deal: id, action: "dispute", by: as, tx: t.hash }) + "\n");
  console.log(`deal ${id}: DISPUTED by the ${as}; the resolver must propose again with other evidence\n  ${tx(t.hash)}`);
} else if (cmd === "list") {
  const s = contract();
  for (let id = 0, n = Number(await s.count()); id < n; id++) {
    const d = await s.deal(id);
    console.log(id, STATES[Number(d.state)], ethers.formatUnits(d.amount, 6), new Date(Number(d.resolveAfter) * 1000).toISOString(), d.terms.slice(0, 100));
  }
} else {
  console.log("commands: deploy | open-event | open-drought | run | dispute | list");
}
