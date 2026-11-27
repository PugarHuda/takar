// Trade Assurance case files: one per deal, the whole case in a form someone outside can check.
//
//   node scripts/case-file.mjs              -> receipts/trade-assurance/case-<v>-<id>.{json,md}
//   node scripts/case-file.mjs --signals    also fetches every Telegraph signal from the node
//
// Each case holds the order, every step with its transaction, every evidence round re-decided from
// its stored answers (lib/trade.mjs replay: must match what was recorded), and the deal's state read
// from the contract now. Nothing here needs a key.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { ethers } from "ethers";
import { replay } from "../lib/trade.mjs";

const NODE = process.env.TELEGRAPH_NODE ?? "https://devnode.telegraphprotocol.com";
const RPC = process.env.RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
const DIR = "receipts/trade-assurance";
const V4 = "0x310275e6D66818E068245326bB9e398822304248";
const CONTRACTS = { [V4.toLowerCase()]: 4, "0xa6d0482cbf29fe43fb644f33f7a020766af4a42b": 5 };
const PORT = { lat: 60.1497, lon: 24.9155, radiusKm: 1.5, locode: "FIHEL", area: "LS" };
const STATES = ["open", "proposed", "settled", "reclaimed"];
const tx = (h) => (h ? `https://sepolia.etherscan.io/tx/${h}` : null);
const usdc = (u) => (u == null ? "-" : (Number(u) / 1e6).toFixed(2));

const rows = readFileSync(`${DIR}/log.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const key = (r) => `${(r.contract ?? V4).toLowerCase()}:${r.id}`;
const deals = new Map();
for (const r of rows) {
  if (r.action === "setup" || r.action === "deploy" || r.id == null) continue;
  const c = (r.contract ?? V4).toLowerCase();
  if (!CONTRACTS[c]) continue;
  if (!deals.has(key(r))) deals.set(key(r), []);
  deals.get(key(r)).push(r);
}

const provider = new ethers.JsonRpcProvider(RPC, 11155111, { staticNetwork: true });
const withSignals = process.argv.includes("--signals");
const index = [];

for (const [k, steps] of deals) {
  const open = steps.find((s) => s.action === "open");
  if (!open) continue; // a deal opened on an older instance
  const [contract, id] = k.split(":");
  const v = CONTRACTS[contract];
  const t = open.terms;
  const abi = JSON.parse(readFileSync(`onchain/TakarSettle${v}.artifact.json`, "utf8")).abi;
  const d = await new ethers.Contract(contract, abi, provider).deal(Number(id));
  const chain = { state: STATES[Number(d.state)], amount: usdc(d.amount), approvals: Number(d.approvals), payerDisputed: d.payerDisputed, payeeDisputed: d.payeeDisputed };

  const rounds = [];
  for (const s of steps.filter((x) => x.file && /^(hold|review|propose)$/.test(x.action))) {
    if (!existsSync(s.file)) continue;
    const r = JSON.parse(readFileSync(s.file, "utf8"));
    const x = replay(r, t, PORT, d.amount);
    const round = { at: r.at, file: s.file, decision: r.decision, why: r.why, payout: r.payout ?? null, replayed: x.decision, replayMatches: x.decision === r.decision && (x.payout ?? null) === (r.payout ?? null), checks: r.checks, port: r.port ?? null, identity: r.identity ? { state: r.identity.state, lei: r.identity.lei ?? null } : null, signals: r.signals };
    if (withSignals) {
      round.signalsOnNode = 0;
      for (const sig of r.signals) { const res = await fetch(`${NODE}/engine/v1/signal/${sig}`, { signal: AbortSignal.timeout(15_000) }).catch(() => null); if (res?.ok) round.signalsOnNode++; }
    }
    rounds.push(round);
  }
  const timeline = steps.map((s) => ({ at: s.at, step: s.action, decision: s.decision ?? null, by: s.by ?? null, toSupplier: s.toSupplier ? usdc(s.toSupplier) : undefined, toBuyer: s.toBuyer ? usdc(s.toBuyer) : undefined, bond: s.bond ? `${usdc(s.bond.amount)} from the ${s.bond.from} to the ${s.bond.to}` : undefined, reason: s.reason ?? undefined, tx: tx(s.tx) }));
  const name = `case-v${v}-${id}`;
  const doc = {
    title: `Trade Assurance case: TakarSettle${v} deal ${id}`,
    contract: `https://sepolia.etherscan.io/address/${contract}`,
    generated_at: new Date().toISOString(),
    order: t.order, supplier: t.supplier, vessel: t.vessel, port: t.port, invoice: t.invoice, terms_on_chain: t.text,
    note: "Illustrative order (the supplier is not a real company; test USDC scaled 1:12,400). The ship, the miners, every paid answer and every transaction are real, on Ethereum Sepolia.",
    chain_now: chain,
    timeline, rounds,
    replay: { rule: "lib/trade.mjs replay(): each round re-decided from the answers it stored", all_match: rounds.every((r) => r.replayMatches) },
  };
  writeFileSync(`${DIR}/${name}.json`, JSON.stringify(doc, null, 2) + "\n");
  const md = [
    `# ${doc.title}`, "", `Contract: ${doc.contract} · state now: **${chain.state}** · escrow ${chain.amount} test USDC`, "",
    `**Order:** ${t.order}  `, `**Supplier:** ${t.supplier} · **Ship:** ${t.vessel} → ${t.port}  `, `**Terms on chain:** ${t.text}`, "", `_${doc.note}_`, "",
    "## Steps", "", "| When (UTC) | Step | Outcome | Tx |", "|---|---|---|---|",
    ...timeline.map((s) => `| ${s.at.slice(0, 16).replace("T", " ")} | ${s.step} | ${[s.decision, s.toSupplier && `supplier ${s.toSupplier}, buyer ${s.toBuyer}`, s.bond && `bond ${s.bond}`, s.by && `by ${s.by}`].filter(Boolean).join("; ") || ""} | ${s.tx ? `[${s.tx.slice(-66, -56)}…](${s.tx})` : ""} |`),
    "", "## Evidence rounds, re-decided", "", "| When (UTC) | Recorded | Replayed | Arrival / Goods / Supplier | Port record | Identity | Signals |", "|---|---|---|---|---|---|---|",
    ...rounds.map((r) => `| ${r.at.slice(0, 16).replace("T", " ")} | ${r.decision}${r.payout ? ` (${usdc(r.payout)})` : ""} | ${r.replayed} ${r.replayMatches ? "✓" : "✗"} | ${r.checks.arrival} / ${r.checks.invoice} / ${r.checks.sanctions} | ${r.port ? `${r.port.state}${r.port.ata ? ` (ATA ${r.port.ata})` : ""}` : "-"} | ${r.identity?.state ?? "-"} | ${r.signals.length}${r.signalsOnNode != null ? ` (${r.signalsOnNode} on the node)` : ""} |`),
    "", `Replay: ${doc.replay.all_match ? "every round re-decides to what was recorded" : "**a round does not re-decide to what was recorded**"}. Re-run: \`node scripts/case-file.mjs --signals\`. Each signal: \`${NODE}/engine/v1/signal/<hash>\`.`, "",
  ].join("\n");
  writeFileSync(`${DIR}/${name}.md`, md);
  index.push({ case: name, contract, id: Number(id), state: chain.state, rounds: rounds.length, replay_all_match: doc.replay.all_match });
  console.log(`${name}: ${chain.state}, ${rounds.length} rounds, replay ${doc.replay.all_match ? "all match" : "MISMATCH"}${withSignals ? `, signals on node ${rounds.reduce((a, r) => a + r.signalsOnNode, 0)}/${rounds.reduce((a, r) => a + r.signals.length, 0)}` : ""}`);
}
writeFileSync(`${DIR}/cases.json`, JSON.stringify(index, null, 2) + "\n");
