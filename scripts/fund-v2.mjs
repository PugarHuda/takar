// Fund the agent wallet for Telegraph V2 (Ethereum Sepolia, testnet only).
//
//   node --env-file=.env scripts/fund-v2.mjs            mint -> escrow, only what is missing
//   node --env-file=.env scripts/fund-v2.mjs --status   read balances, send nothing
//
// Every step reads the balance first and tops up only to the target, so a
// re-run after a partial failure never double-spends.
//
// The node moved to a new Diamond on 17 Nov 2026 (the docs still named 0x3624…,
// which the node no longer reads). On it, bonds are test USDC and there is no
// MACHINA, and the escrow balance lives in the node's ledger roots, read over HTTP.
import { ethers } from "ethers";

const CHAIN_ID = 11155111;
const DIAMOND = "0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b";
const USDC = "0xcc194e1a843B658526D0D5C431f670028582Ae17"; // test token, public mint
const LEDGER = "https://devnode.telegraphprotocol.com/v1/ledger/account/";

const TARGET = {
  escrow: ethers.parseUnits("2", 6), // 200 asks at $0.01
  walletUsdc: ethers.parseUnits("10", 6), // bonds ($5 adapter, $1 miner) and x402 "exact" payments
};
const MAX_MINT = ethers.parseUnits("50", 6); // refuse anything larger: a units bug, not a plan

const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function mint(address,uint256)",
];
const DIAMOND_ABI = ["function depositUSDC(uint256)", "function usdcToken() view returns (address)"];

const provider = new ethers.JsonRpcProvider(process.env.RPC ?? "https://ethereum-sepolia-rpc.publicnode.com", CHAIN_ID);
if (!process.env.AGENT_PRIVATE_KEY) throw new Error("AGENT_PRIVATE_KEY is not set in .env");
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
const usdc = new ethers.Contract(USDC, ERC20, wallet);
const diamond = new ethers.Contract(DIAMOND, DIAMOND_ABI, wallet);

const fmt = (v, d) => ethers.formatUnits(v, d);
const txs = [];

async function send(label, promise) {
  const tx = await promise;
  const r = await tx.wait();
  if (r.status !== 1) throw new Error(`${label} reverted: ${tx.hash}`);
  txs.push({ label, hash: tx.hash });
  console.log(`  ok  ${label}  https://sepolia.etherscan.io/tx/${tx.hash}`);
}

async function status() {
  const [eth, u, e] = await Promise.all([
    provider.getBalance(wallet.address),
    usdc.balanceOf(wallet.address),
    fetch(LEDGER + wallet.address.toLowerCase()).then((r) => r.json()).then((l) => BigInt(l.available ?? 0)),
  ]);
  console.log(`wallet ${wallet.address}  ETH ${fmt(eth, 18)}  USDC ${fmt(u, 6)}  escrow ${fmt(e, 6)}`);
  return { eth, u, e };
}

// The docs table can drift; the Diamond is the source of truth.
const dUsdc = await diamond.usdcToken();
if (ethers.getAddress(dUsdc) !== USDC) throw new Error(`Diamond reports usdc=${dUsdc}; the address here is stale — stop`);

let s = await status();
if (process.argv.includes("--status")) process.exit(0);
if (s.eth < ethers.parseEther("0.005")) throw new Error("under 0.005 Sepolia ETH for gas — top up from a faucet first");

const needEscrow = s.e < TARGET.escrow ? TARGET.escrow - s.e : 0n;
const needUsdc = needEscrow + TARGET.walletUsdc;
if (s.u < needUsdc) {
  const mint = needUsdc - s.u;
  if (mint > MAX_MINT) throw new Error(`would mint ${fmt(mint, 6)} USDC, over the ${fmt(MAX_MINT, 6)} cap`);
  await send(`mint ${fmt(mint, 6)} test USDC`, usdc.mint(wallet.address, mint));
}
if (needEscrow > 0n) {
  if ((await usdc.allowance(wallet.address, DIAMOND)) < needEscrow) await send("approve Diamond", usdc.approve(DIAMOND, needEscrow));
  await send(`deposit ${fmt(needEscrow, 6)} USDC to escrow`, diamond.depositUSDC(needEscrow));
}

s = await status();
console.log(txs.length ? `${txs.length} transaction(s) sent (the ledger credits a deposit at the next root)` : "nothing to do");
