// Takar Settle: conditional payments on Ethereum Sepolia, settled by intelligence bought
// through Telegraph. Testnet only (test USDC).
//
//   node --env-file=.env scripts/settle.mjs deploy
//   node --env-file=.env scripts/settle.mjs open-event   --question "Did Argentina win the 2022 FIFA World Cup?" [--amount 1] [--after 2]
//   node --env-file=.env scripts/settle.mjs open-drought --location Bandung --from 2026-11-15 --to 2026-11-17 --trigger 30 [--amount 1] [--after 2]
//   node --env-file=.env scripts/settle.mjs run          settle every open deal that is due
//   node --env-file=.env scripts/settle.mjs list
//
// --after is minutes until the deal may settle. The payee is a counterparty wallet created on
// first use (its key goes to .env, so its test USDC can be recovered). Every settlement is
// appended to receipts/settlements.jsonl with the Telegraph signal it rests on.
import { appendFileSync, readFileSync, mkdirSync } from "node:fs";
import { ethers } from "ethers";
import { ask } from "../lib/telegraph.mjs";
import { eventCondition, daysOf, droughtCondition } from "../lib/settle.mjs";

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
const contract = () => {
  if (!process.env.TAKAR_SETTLE) throw new Error("no TAKAR_SETTLE in .env: run `deploy` first");
  return new ethers.Contract(process.env.TAKAR_SETTLE, artifact.abi, wallet);
};
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

/** Buy what a deal needs and decide. Returns { met, why, signal } or null (wait). */
async function decide(terms, run) {
  if (terms.kind === "event") {
    const r = await ask({ intent: "EVENT_OUTCOME_RESOLUTION_GENERAL", params: { event: terms.question }, unit: "settle-m14", run, purpose: `mission14:settle ${terms.question.slice(0, 60)}` });
    const c = eventCondition(r.result_shape === "intent" ? r.result : null);
    return c && r.signal_hash ? { ...c, signal: r.signal_hash, miner: r.ledger?.miner ?? null } : null;
  }
  if (terms.kind === "weather") {
    const days = daysOf(terms.from, terms.to);
    const readings = [];
    let signal = null;
    for (const date of days) {
      const r = await ask({ intent: "WEATHER_FORECAST_VERIFY_GENERAL", params: { location: terms.location, date }, unit: "settle-m06", run, purpose: `mission06:cover ${terms.location} ${date}` });
      if (r.result_shape === "intent" && r.result) readings.push({ date, precipitation_mm: r.result.precipitation_mm });
      signal ??= r.signal_hash; // first day's signal goes on-chain; every day's is in the ledger
    }
    const c = droughtCondition(readings, { days, triggerMm: terms.triggerMm });
    return c && signal ? { ...c, signal, readings } : null;
  }
  return null;
}

async function runDue() {
  const s = contract();
  const run = new Date().toISOString();
  const n = Number(await s.count());
  const now = Math.floor(Date.now() / 1000);
  mkdirSync("receipts", { recursive: true });
  for (let id = 0; id < n; id++) {
    const d = await s.deal(id);
    if (Number(d.state) !== 0) continue; // settled or reclaimed
    if (Number(d.resolveAfter) > now) { console.log(`deal ${id}: not due until ${new Date(Number(d.resolveAfter) * 1000).toISOString()}`); continue; }
    let terms;
    try { terms = JSON.parse(d.terms); } catch { console.log(`deal ${id}: terms are not Takar terms, skipped`); continue; }
    const c = await decide(terms, run).catch((e) => (console.log(`deal ${id}: ${e.message.slice(0, 120)}`), null));
    if (!c) { console.log(`deal ${id}: the answer cannot settle it yet, left open`); continue; }
    const t = await s.settle(id, c.met, c.signal, c.why.slice(0, 280));
    await t.wait();
    const entry = { at: new Date().toISOString(), run, deal: id, terms, met: c.met, paidTo: c.met ? "payee" : "payer", amount: ethers.formatUnits(d.amount, 6), why: c.why, signal: c.signal, readings: c.readings ?? null, miner: c.miner ?? null, tx: t.hash };
    appendFileSync("receipts/settlements.jsonl", JSON.stringify(entry) + "\n");
    console.log(`deal ${id}: ${c.met ? "PAID payee" : "REFUNDED payer"}, ${c.why}\n  ${tx(t.hash)}`);
  }
}

if (cmd === "deploy") {
  if (process.env.TAKAR_SETTLE) throw new Error(`already deployed at ${process.env.TAKAR_SETTLE}`);
  const f = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const c = await f.deploy(USDC, wallet.address);
  await c.waitForDeployment();
  remember("TAKAR_SETTLE", c.target);
  console.log(`TakarSettle at ${c.target} (resolver ${wallet.address})\n  ${tx(c.deploymentTransaction().hash)}`);
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
} else if (cmd === "list") {
  const s = contract();
  for (let id = 0, n = Number(await s.count()); id < n; id++) {
    const d = await s.deal(id);
    console.log(id, ["open", "settled", "reclaimed"][Number(d.state)], ethers.formatUnits(d.amount, 6), new Date(Number(d.resolveAfter) * 1000).toISOString(), d.terms.slice(0, 100));
  }
} else {
  console.log("commands: deploy | open-event | open-drought | run | list");
}
