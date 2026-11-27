// Keeper: finalize Trade Assurance deals whose dispute window has passed.
//
//   node scripts/keeper.mjs            read only: lists what is due
//   node scripts/keeper.mjs --send     finalizes what is due (TAKAR_KEEPER_KEY pays gas)
//
// finalize() is permissionless on TakarSettle4/5, so the keeper needs no resolver seat: a wallet
// with a little test ETH and nothing else. On 24 Nov a session-bound watcher died and both deals sat
// finalizable for three days; this runs from GitHub Actions instead (.github/workflows/keeper.yml).
import { appendFileSync, readFileSync } from "node:fs";
import { ethers } from "ethers";

const RPC = process.env.RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";
const DEALS = [
  { v: 4, address: "0x310275e6D66818E068245326bB9e398822304248" }, // panel with Praman's seat
  { v: 5, address: "0xa6D0482cBF29FE43fB644F33f7a020766AF4A42B" },
  { v: 6, address: "0x789844606ca3c8693E2cEbf2e1B065314F1E8013" }, // arrival record + automatic release
];
const LOG = "receipts/trade-assurance/log.jsonl";
// The public /api/second-opinion pays from this Telegraph escrow account. On 25 Nov it ran dry and every call
// came back "insufficient" (Chrysolite reported it); the keeper now tops it up before that happens.
const PUBLIC_PAYER = "0x9cBDD9Cac5382d2cfe65669e5045C2D3dee6327E";
const DIAMOND = "0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b", TUSDC = "0xcc194e1a843B658526D0D5C431f670028582Ae17";
const TOPUP_BELOW = 2_000_000n, TOPUP = 10_000_000n; // test USDC, 6 dp

/** Top up when the escrow's available balance is under the floor. Pure, so it is tested. */
export const needsTopUp = (available) => BigInt(available ?? 0) < TOPUP_BELOW;
const STATES = ["open", "proposed", "settled", "reclaimed"];

/** Due = proposed, threshold met (finalizesAt set) and the window passed. Pure, so it is tested. */
export function due(d, nowSec) {
  return STATES[Number(d.state)] === "proposed" && BigInt(d.finalizesAt) !== 0n && BigInt(nowSec) >= BigInt(d.finalizesAt);
}

/** v6: arrival recorded, the buyer stayed silent and did not object, and its window has ended. */
export function releasable(d, nowSec) {
  return STATES[Number(d.state)] === "open" && BigInt(d.acceptWindow ?? 0) !== 0n && BigInt(d.arrivedAt ?? 0) !== 0n && !d.payerDisputed && BigInt(nowSec) >= BigInt(d.arrivedAt) + BigInt(d.acceptWindow);
}

/** The log row the trade page renders, from the Settled and BondPaid events of a finalize receipt. */
export function settledRow({ contract, id, v, d, logs, iface, tx }) {
  const ev = logs.map((l) => { try { return iface.parseLog(l); } catch { return null; } }).filter(Boolean);
  const s = ev.find((e) => e.name === "Settled");
  const toSupplier = v >= 5 ? s.args.toPayee : s.args.conditionMet ? s.args.amount : 0n;
  const toBuyer = v >= 5 ? s.args.toPayer : s.args.conditionMet ? 0n : s.args.amount;
  const row = { contract, action: "finalize", id, toSupplier: String(toSupplier), toBuyer: String(toBuyer), tx, by: "keeper" };
  const lost = ev.find((e) => e.name === "BondPaid" && !e.args.returned);
  if (lost) {
    const to = lost.args.to.toLowerCase() === d.payer.toLowerCase() ? "buyer" : "supplier";
    row.bond = { amount: String(lost.args.amount), from: to === "buyer" ? "supplier" : "buyer", to, reason: "the disputed decision stood" };
  }
  return row;
}

async function main() {
  const send = process.argv.includes("--send");
  const provider = new ethers.JsonRpcProvider(RPC, 11155111, { staticNetwork: true });
  let signer = null; // made only when something is due, so a missing key fails only when it matters
  const now = (await provider.getBlock("latest")).timestamp;
  let n = 0;
  for (const { v, address } of DEALS) {
    const abi = JSON.parse(readFileSync(new URL(`../onchain/TakarSettle${v}.artifact.json`, import.meta.url), "utf8")).abi;
    const c = new ethers.Contract(address, abi, provider);
    for (let id = 0; id < Number(await c.count()); id++) {
      const d = await c.deal(id);
      let kind; try { kind = JSON.parse(d.terms).kind; } catch { kind = null; }
      const release = v === 6 && releasable(d, now);
      if (kind !== "trade" || !(due(d, now) || release)) continue;
      n++;
      console.log(`v${v} deal ${id}: ${release ? "buyer's window over, release" : `due since ${new Date(Number(d.finalizesAt) * 1000).toISOString()}`}`);
      if (!send) continue;
      if (!process.env.TAKAR_KEEPER_KEY) throw new Error("TAKAR_KEEPER_KEY is not set");
      signer ??= new ethers.Wallet(process.env.TAKAR_KEEPER_KEY, provider);
      const t = await (release ? c.connect(signer).autoRelease(id) : c.connect(signer).finalize(id)); const r = await t.wait();
      const row = { ...settledRow({ contract: address, id, v, d, logs: r.logs, iface: c.interface, tx: t.hash }), ...(release ? { action: "release" } : {}) };
      appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n");
      console.log(`  finalized: supplier ${ethers.formatUnits(row.toSupplier, 6)}, buyer ${ethers.formatUnits(row.toBuyer, 6)}  https://sepolia.etherscan.io/tx/${t.hash}`);
    }
  }
  if (!n) console.log("nothing due");
  // Public payer escrow (the node's ledger, read over HTTP).
  const acct = await fetch(`https://devnode.telegraphprotocol.com/v1/ledger/account/${PUBLIC_PAYER}`).then((r) => r.json()).catch(() => null);
  if (acct && needsTopUp(acct.available)) {
    console.log(`public payer escrow low: ${ethers.formatUnits(acct.available, 6)} available`);
    if (send && process.env.TAKAR_KEEPER_KEY) {
      signer ??= new ethers.Wallet(process.env.TAKAR_KEEPER_KEY, provider);
      const u = new ethers.Contract(TUSDC, ["function mint(address,uint256)", "function approve(address,uint256) returns (bool)"], signer);
      await (await u.mint(signer.address, TOPUP)).wait(); // test token, public mint
      await (await u.approve(DIAMOND, TOPUP)).wait();
      const t = await new ethers.Contract(DIAMOND, ["function depositUSDCFor(address,uint256)"], signer).depositUSDCFor(PUBLIC_PAYER, TOPUP); await t.wait();
      appendFileSync("receipts/ledger-topups.jsonl", JSON.stringify({ at: new Date().toISOString(), for: PUBLIC_PAYER, amount: String(TOPUP), by: signer.address, tx: t.hash, why: "keeper: available under 2 USDC" }) + "\n");
      console.log(`  topped up 10 test USDC  https://sepolia.etherscan.io/tx/${t.hash}`);
    }
  }
}

if (process.argv[1]?.endsWith("keeper.mjs")) await main();
