// Solana settlement leg for Takar Trade Assurance (devnet).
//
//   node scripts/solana-leg.mjs setup                  mint a devnet test-USDC (6 dp), fund the buyer
//   node scripts/solana-leg.mjs lock --case v6-0       the buyer locks the deal's amount with Takar's Solana escrow
//   node scripts/solana-leg.mjs settle --case v6-0     pays out exactly what the Sepolia contract settled, nothing before
//   node scripts/solana-leg.mjs status
//
// The decision is not made here. It is made on Ethereum Sepolia by the Trade Assurance panel
// (TakarSettle4/5/6, with Praman's independent seat). This leg reads that contract and mirrors its
// outcome on Solana: to the supplier what the contract paid the supplier, to the buyer what it
// refunded. Every transfer carries an SPL memo with the case id, the Sepolia settlement tx and the
// sha256 of the case file, so a Solana payment links to evidence anyone can re-decide.
// Honest limit: the Solana side is custodial (Takar's escrow key holds the locked funds). A Solana
// program that verifies the Sepolia outcome itself would remove that; this is the bridge before it.
//
// Uses the solana and spl-token CLIs (devnet). Keys live in .solana/ (git-ignored).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ethers } from "ethers";

const URL_ = "https://api.devnet.solana.com";
const K = (n) => `.solana/${n}.json`;
const CFG = ".solana/config.json";
const LOG = "receipts/solana/log.jsonl";
const RPC = process.env.RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
const CONTRACTS = { 4: "0x310275e6D66818E068245326bB9e398822304248", 5: "0xa6D0482cBF29FE43fB644F33f7a020766AF4A42B", 6: "0x789844606ca3c8693E2cEbf2e1B065314F1E8013" };
const [cmd, ...rest] = process.argv.slice(2);
const arg = (k) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : undefined; };

const cli = (bin, args) => execFileSync(bin, [...args, "--url", URL_], { encoding: "utf8" }).trim();
const addr = (n) => execFileSync("solana", ["address", "-k", K(n)], { encoding: "utf8" }).trim();
const log = (row) => { mkdirSync("receipts/solana", { recursive: true }); appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n"); };
const cfg = () => { if (!existsSync(CFG)) throw new Error("run setup first"); return JSON.parse(readFileSync(CFG, "utf8")); };
const explorer = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

/** Transfer test-USDC from one Takar-held keypair to an address, with a memo; returns the signature. */
function transfer(from, to, uiAmount, memo) {
  const out = cli("spl-token", ["transfer", cfg().mint, String(uiAmount), to, "--owner", K(from), "--fee-payer", K(from), "--fund-recipient", "--allow-unfunded-recipient", "--with-memo", memo, "--output", "json"]);
  return JSON.parse(out).signature;
}

/** The deal as the Sepolia contract holds it, plus the settlement rows Takar logged for it. */
async function sepolia(caseId) {
  const [, v, id] = caseId.match(/^v([456])-(\d+)$/) ?? [];
  if (!v) throw new Error('case must look like "v6-0"');
  const abi = JSON.parse(readFileSync(`onchain/TakarSettle${v}.artifact.json`, "utf8")).abi;
  const d = await new ethers.Contract(CONTRACTS[v], abi, new ethers.JsonRpcProvider(RPC, 11155111, { staticNetwork: true })).deal(Number(id));
  const rows = readFileSync("receipts/trade-assurance/log.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((r) => (r.contract ?? CONTRACTS[4]).toLowerCase() === CONTRACTS[v].toLowerCase() && r.id === Number(id));
  const settled = rows.filter((r) => /^(finalize|release|confirm)$/.test(r.action)).at(-1) ?? null;
  return { v: Number(v), id: Number(id), state: ["open", "proposed", "settled", "reclaimed"][Number(d.state)], amount: d.amount, settled };
}

export const sepoliaDeal = (c) => sepolia(c);
const caseDigest = (caseId) => { const f = `receipts/trade-assurance/case-${caseId}.json`; return existsSync(f) ? createHash("sha256").update(readFileSync(f)).digest("hex") : null; };

/** What the Solana leg owes, from the Sepolia outcome only. Pure, so it is tested. */
export function payoutFrom(deal) {
  if (deal.state !== "settled" || !deal.settled) return null;
  const toSupplier = BigInt(deal.settled.toSupplier ?? 0), toBuyer = BigInt(deal.settled.toBuyer ?? 0);
  if (toSupplier + toBuyer !== BigInt(deal.amount)) throw new Error("the logged settlement does not add up to the deal amount");
  return { toSupplier, toBuyer, sepoliaTx: deal.settled.tx };
}

async function main() {
  if (cmd === "setup") {
    let c = existsSync(CFG) ? JSON.parse(readFileSync(CFG, "utf8")) : {};
    if (!c.mint) {
      const out = JSON.parse(cli("spl-token", ["create-token", "--decimals", "6", "--mint-authority", K("escrow"), "--fee-payer", K("escrow"), "--output", "json"]));
      c.mint = out.commandOutput?.address ?? out.address;
    }
    Object.assign(c, { escrow: addr("escrow"), buyer: addr("buyer"), supplier: addr("supplier") });
    writeFileSync(CFG, JSON.stringify(c, null, 2));
    try { cli("spl-token", ["create-account", c.mint, "--owner", c.buyer, "--fee-payer", K("escrow")]); } catch { /* exists */ }
    cli("spl-token", ["mint", c.mint, "10", "--recipient-owner", c.buyer, "--mint-authority", K("escrow"), "--fee-payer", K("escrow")]);
    console.log(`test-USDC mint ${c.mint}; buyer ${c.buyer} funded with 10; escrow ${c.escrow}; supplier ${c.supplier}`);
    log({ action: "setup", ...c });
  } else if (cmd === "lock") {
    const caseId = arg("case"); const d = await sepolia(caseId);
    const ui = ethers.formatUnits(d.amount, 6);
    const sig = transfer("buyer", cfg().escrow, ui, `takar:lock case-${caseId} sepolia:${CONTRACTS[d.v]}:${d.id}`);
    console.log(`case ${caseId}: buyer locked ${ui} test-USDC with Takar's Solana escrow\n  ${explorer(sig)}`);
    log({ action: "lock", case: caseId, amount: String(d.amount), sig });
  } else if (cmd === "settle") {
    const caseId = arg("case"); const d = await sepolia(caseId);
    const locked = existsSync(LOG) && readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).some((r) => r.action === "lock" && r.case === caseId);
    if (!locked) throw new Error(`case ${caseId} was never locked on Solana`);
    if (existsSync(LOG) && readFileSync(LOG, "utf8").includes(`"action":"settle","case":"${caseId}"`)) throw new Error(`case ${caseId} is already settled on Solana`);
    const p = payoutFrom(d);
    if (!p) { console.log(`case ${caseId}: Sepolia says ${d.state}; nothing moves on Solana until the panel's decision settles there`); return; }
    const digest = caseDigest(caseId);
    const memo = (who) => `takar:settle case-${caseId} to:${who} sepolia-tx:${p.sepoliaTx} case-sha256:${digest ?? "none"}`;
    const sigs = {};
    if (p.toSupplier > 0n) sigs.supplier = transfer("escrow", cfg().supplier, ethers.formatUnits(p.toSupplier, 6), memo("supplier"));
    if (p.toBuyer > 0n) sigs.buyer = transfer("escrow", cfg().buyer, ethers.formatUnits(p.toBuyer, 6), memo("buyer"));
    console.log(`case ${caseId}: mirrored the Sepolia settlement: supplier ${ethers.formatUnits(p.toSupplier, 6)}, buyer ${ethers.formatUnits(p.toBuyer, 6)}`);
    for (const s of Object.values(sigs)) console.log(`  ${explorer(s)}`);
    log({ action: "settle", case: caseId, toSupplier: String(p.toSupplier), toBuyer: String(p.toBuyer), sepoliaTx: p.sepoliaTx, caseSha256: digest, sigs });
  } else if (cmd === "status") {
    const c = cfg();
    for (const n of ["buyer", "escrow", "supplier"]) {
      let b = "0";
      try { b = cli("spl-token", ["balance", c.mint, "--owner", c[n]]).split("\n").pop(); } catch { /* no token account yet */ }
      console.log(n.padEnd(9), c[n], b);
    }
  } else console.log("commands: setup | lock --case v6-0 | settle --case v6-0 | status");
}

if (process.argv[1]?.endsWith("solana-leg.mjs")) await main();
