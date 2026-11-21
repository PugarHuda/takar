// Takar Settle v3: two resolvers must back the same decision, and a dispute costs a bond.
// Testnet only (Ethereum Sepolia, test USDC).
//
//   node --env-file=.env scripts/settle3.mjs deploy [--liveness 10] [--bond 0.5]
//   node --env-file=.env scripts/settle3.mjs open-screen --name "Siemens AG" [--amount 1] [--after 1]
//   node --env-file=.env scripts/settle3.mjs run
//   node --env-file=.env scripts/settle3.mjs dispute --id 1 --as payee|payer
//   node --env-file=.env scripts/settle3.mjs list
//
// A screen deal pays a supplier unless the name matches a sanctions list. Deciding it takes:
//   - Takar's second opinion: two Telegraph SANCTIONS_SCREENING miners from different
//     operators, asked by id, agreeing on `matched` (their two signals go on chain);
//   - Praman's screen_sanctions (another team's OFAC SDN check, over MCP) landing the same way.
// Resolver 1 (Takar's agent) proposes; resolver 2 (a separate key) re-reads both signals on the
// node and Praman's verdict itself before it seconds. Either check failing means HOLD.
// The two resolver keys are both Takar's today; the contract takes any set, so a partner's key
// can hold the second seat in a new instance.
import { appendFileSync, readFileSync, mkdirSync } from "node:fs";
import { ethers } from "ethers";
import { ask, ranked } from "../lib/telegraph.mjs";
import { secondOpinion } from "../lib/second.mjs";

const USDC = "0xcc194e1a843B658526D0D5C431f670028582Ae17";
const NODE = "https://devnode.telegraphprotocol.com";
const PRAMAN = "https://praman-desk.vercel.app/api/mcp";
const provider = new ethers.JsonRpcProvider(process.env.RPC ?? "https://ethereum-sepolia-rpc.publicnode.com", 11155111, { staticNetwork: true });
const r1 = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider); // proposes, and is the payer of the demo deals
const r2 = new ethers.Wallet(process.env.SERVER_PAYER_KEY, provider); // seconds
const party = { payer: r1, payee: new ethers.Wallet(process.env.TAKAR_COUNTERPARTY_KEY, provider) };
// --v4: the same flow on TakarSettle4 (v3 plus escalation to the full panel once both parties disputed).
const V4 = process.argv.includes("--v4");
const ENV = V4 ? "TAKAR_SETTLE4" : "TAKAR_SETTLE3";
const artifact = JSON.parse(readFileSync(new URL(`../onchain/TakarSettle${V4 ? 4 : 3}.artifact.json`, import.meta.url), "utf8"));
const erc20 = (w) => new ethers.Contract(USDC, ["function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)"], w);
const [cmd, ...rest] = process.argv.slice(2);
const arg = (k, d) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : d; };
const tx = (h) => `https://sepolia.etherscan.io/tx/${h}`;
const STATES = ["open", "proposed", "settled", "reclaimed"];
const log = (row) => { mkdirSync("receipts", { recursive: true }); appendFileSync(V4 ? "receipts/settlements4.jsonl" : "receipts/settlements3.jsonl", JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n"); };
const settle = (w = r1) => {
  if (!process.env[ENV]) throw new Error(`no ${ENV} in .env: run deploy first`);
  return new ethers.Contract(process.env[ENV], artifact.abi, w);
};

/** Praman's OFAC SDN screen, over MCP. */
async function praman(name) {
  const r = await fetch(PRAMAN, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "screen_sanctions", arguments: { name } } }), signal: AbortSignal.timeout(30_000) });
  const body = await r.json();
  // Fail closed: anything but a clean boolean verdict over a loaded list is an error, so the deal holds.
  if (!r.ok || body.error || body.result?.isError) throw new Error(`Praman error: ${JSON.stringify(body.error ?? body.result?.content?.[0]?.text ?? r.status).slice(0, 120)}`);
  const j = JSON.parse(body.result.content[0].text);
  if (typeof j.matched !== "boolean" || j.error || !j.sdn_last_loaded) throw new Error("Praman gave no clean verdict");
  return { matched: j.matched, top: j.matches?.[0] ? `${j.matches[0].matched_name} (SDN ${j.matches[0].sdn_uid}, score ${j.matches[0].similarity_score})` : null, list_loaded: j.sdn_last_loaded };
}

/** Miner id -> payout address, so one operator's two miners count once. */
async function operators() {
  const list = await fetch(`${NODE}/api/miners`).then((x) => x.json());
  const m = new Map(list.map((x) => [String(x.id), x.fee_address ?? x.wallet_address ?? null]));
  return (id) => m.get(String(id)) ?? null;
}

async function decide(name) {
  const so = await secondOpinion({ intent: "SANCTIONS_SCREENING_MATCH_GENERAL", params: { name } }, { ask: (a) => ask({ ...a, unit: "settle3" }), ranked, operatorOf: await operators(), strictOperators: true, maxAsks: Number(arg("max-asks", "6")), unit: "settle3", fields: ["matched"] });
  const p = await praman(name).catch((e) => ({ error: e.message }));
  const yes = (v) => v === true || /^(true|yes|match|matched|1)$/i.test(String(v));
  const takar = so.verdict === "agree" ? yes(so.answer?.matched) : null;
  const out = { name, takar: so.verdict, takarMatched: takar, miners: so.answers.filter((a) => a.usable).map((a) => a.miner?.id), praman: p, signals: so.answers.filter((a) => a.usable).map((a) => a.signal) };
  // The decision field itself must have been compared, and filled by both miners.
  if (so.verdict === "agree" && !so.compared.includes("matched")) return { ...out, hold: "the two miners agreed on other fields, not on matched" };
  if (takar === null) return { ...out, hold: `Telegraph second opinion: ${so.verdict}${so.differ?.length ? ` on ${so.differ.join(", ")}` : ""}` };
  if (p.error) return { ...out, hold: `Praman unavailable: ${p.error}` };
  if (p.matched !== takar) return { ...out, hold: `Takar says matched=${takar}, Praman says matched=${p.matched}` };
  return { ...out, met: !takar }; // the supplier is paid only when not matched
}

/** Resolver 2 checks for itself before backing: both signals exist on the node, and Praman says the same. */
async function secondCheck(name, signals, met) {
  for (const s of signals) {
    const r = await fetch(`${NODE}/engine/v1/signal/${s}`, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return `signal ${s.slice(0, 10)} not found on the node (${r.status})`;
  }
  const p = await praman(name).catch((e) => ({ error: e.message }));
  if (p.error) return p.error;
  if (p.matched === met) return `Praman now says matched=${p.matched}`;
  return null;
}

/** Resolver 2 checks for itself, then seconds. The hash is computed locally: RPC reads can lag a block. */
async function back(id, name, signals, met, proposeTx) {
  const why = await secondCheck(name, signals, met);
  if (why) { console.log(`deal ${id}: resolver 2 declines to second: ${why}`); log({ action: "declined", id, why, propose: proposeTx }); return; }
  // RPC reads can lag the block that holds the proposal: wait until it is visible.
  let live = await settle(r1).deal(id);
  for (let i = 0; i < 15 && Number(live.state) !== 1; i++) { await new Promise((r) => setTimeout(r, 2000)); live = await settle(r1).deal(id); }
  if (live.finalizesAt > 0n) { console.log(`deal ${id}: the threshold is met; the window is open`); return; }
  const hash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bool", "bytes32[]"], [met, signals]));
  const q = await settle(r2).second(id, hash); await q.wait();
  console.log(`deal ${id}: seconded by resolver 2 after its own check; dispute window open\n  second  ${tx(q.hash)}`);
  log({ action: "second", id, hash, second: q.hash });
}

if (cmd === "deploy") {
  const f = new ethers.ContractFactory(artifact.abi, artifact.bytecode, r1);
  const c = await f.deploy(USDC, [r1.address, r2.address], Number(arg("threshold", V4 ? "1" : "2")), Number(arg("liveness", "10")) * 60, ethers.parseUnits(String(arg("bond", "0.5")), 6));
  await c.waitForDeployment();
  appendFileSync(".env", `\n${ENV}=${c.target}\n`);
  console.log(`TakarSettle${V4 ? 4 : 3} at ${c.target}: resolvers ${r1.address}, ${r2.address}; threshold ${arg("threshold", V4 ? "1" : "2")}\n  ${tx(c.deploymentTransaction().hash)}`);
} else if (cmd === "open-screen") {
  const name = arg("name");
  if (!name) throw new Error("--name required");
  const s = settle(r1);
  const amount = ethers.parseUnits(String(arg("amount", "1")), 6);
  if ((await erc20(r1).allowance(r1.address, s.target)) < amount) await (await erc20(r1).approve(s.target, amount * 20n)).wait();
  const terms = JSON.stringify({ kind: "screen", name, text: `Pays the supplier unless "${name}" matches a sanctions list. Needs two Telegraph screening miners from different operators to agree, Praman's OFAC SDN screen to land the same way, and two resolvers to back it.` });
  const t = await s.open(party.payee.address, amount, BigInt(Math.floor(Date.now() / 1000) + Number(arg("after", "1")) * 60), 0, terms);
  const r = await t.wait();
  const id = s.interface.parseLog(r.logs.find((l) => l.address.toLowerCase() === s.target.toLowerCase())).args.id;
  console.log(`opened deal ${id}: ${name}, ${ethers.formatUnits(amount, 6)} test USDC\n  ${tx(t.hash)}`);
  log({ action: "open", id: Number(id), name, tx: t.hash });
} else if (cmd === "run") {
  const s = settle(r1);
  let finalized = 0;
  const n = Number(await s.count());
  for (let id = 0; id < n; id++) {
    const d = await s.deal(id);
    // The contract is public: only deals this agent opened are decided, and odd terms are skipped.
    if (d.payer.toLowerCase() !== r1.address.toLowerCase()) continue;
    let terms;
    try { terms = JSON.parse(d.terms); } catch { console.log(`deal ${id}: terms are not JSON, skipped`); continue; }
    const now = Math.floor(Date.now() / 1000);
    if (STATES[Number(d.state)] === "proposed" && d.finalizesAt > 0n) {
      if (now < Number(d.finalizesAt)) { console.log(`deal ${id}: in its dispute window until ${new Date(Number(d.finalizesAt) * 1000).toISOString()}`); continue; }
      const t = await s.finalize(id); await t.wait();
      console.log(`deal ${id}: finalized, ${d.conditionMet ? "paid the supplier" : "refunded the payer"}\n  ${tx(t.hash)}`);
      log({ action: "finalize", id, met: d.conditionMet, tx: t.hash });
      finalized++;
      continue;
    }
    // A proposal still waiting for resolver 2 (e.g. an earlier run stopped): its signals come from the event.
    if (STATES[Number(d.state)] === "proposed" && d.finalizesAt === 0n && !(await s.hasBacked(id, r2.address))) {
      const ev = (await s.queryFilter(s.filters.Proposed(id), -5_000)).at(-1);
      await back(id, terms.name, [...ev.args.signals], ev.args.conditionMet, ev.transactionHash);
      continue;
    }
    if (STATES[Number(d.state)] !== "open" || now < Number(d.resolveAfter) || terms.kind !== "screen") continue;
    const dec = await decide(terms.name);
    if (dec.hold) { console.log(`deal ${id} (${terms.name}): HOLD, ${dec.hold}`); log({ action: "hold", id, ...dec }); continue; }
    const evidence = JSON.stringify({ takar: `${dec.takar}, miners ${dec.miners.join(" and ")}`, matched: dec.takarMatched, praman: dec.praman.top ?? "no match", praman_list: dec.praman.list_loaded }).slice(0, 900);
    const p = await s.propose(id, dec.met, dec.signals, evidence); await p.wait();
    console.log(`deal ${id} (${terms.name}): proposed ${dec.met ? "pay" : "refund"}; Takar ${dec.takar} (miners ${dec.miners.join(", ")}), Praman ${dec.praman.matched ? `match: ${dec.praman.top}` : "clear"}\n  propose ${tx(p.hash)}`);
    log({ action: "propose", id, ...dec, propose: p.hash });
    await back(id, terms.name, dec.signals, dec.met, p.hash);
  }
  // Settled deals feed the open record: the miners' screens go to EAS against Praman's verdict (scripts/attest.mjs).
  if (finalized) { const { execFileSync } = await import("node:child_process"); console.log(execFileSync(process.execPath, ["--env-file=.env", "scripts/attest.mjs", "--send"], { encoding: "utf8" }).split("\n").slice(-3).join("\n")); }
} else if (cmd === "dispute") {
  const id = Number(arg("id")), who = arg("as", "payee");
  const w = party[who];
  const s = settle(w);
  const bond = await s.bond();
  if ((await erc20(w).allowance(w.address, s.target)) < bond) await (await erc20(w).approve(s.target, bond * 10n)).wait();
  const t = await s.dispute(id); await t.wait();
  console.log(`deal ${id}: disputed by the ${who}, bond ${ethers.formatUnits(bond, 6)} test USDC posted\n  ${tx(t.hash)}`);
  log({ action: "dispute", id, by: who, bond: ethers.formatUnits(bond, 6), tx: t.hash });
} else if (cmd === "list") {
  const s = settle(r1);
  for (let id = 0; id < Number(await s.count()); id++) {
    const d = await s.deal(id);
    console.log(`${id} ${STATES[Number(d.state)]} ${JSON.parse(d.terms).name} met=${d.conditionMet} approvals=${d.approvals} bonds payer=${ethers.formatUnits(d.payerBond, 6)} payee=${ethers.formatUnits(d.payeeBond, 6)}`);
  }
} else {
  console.log("commands: deploy | open-screen --name X | run | dispute --id N --as payee|payer | list");
}
