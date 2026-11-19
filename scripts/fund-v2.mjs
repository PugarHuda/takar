// Fund the agent wallet for Telegraph V2 (Ethereum Sepolia, testnet only).
//
//   node --env-file=.env scripts/fund-v2.mjs            mint -> swap -> escrow, only what is missing
//   node --env-file=.env scripts/fund-v2.mjs --status   read balances, send nothing
//
// Every step reads the balance first and tops up only to the target, so a
// re-run after a partial failure never double-spends. Addresses are the V2
// ones from anjoman.ai/docs (protocol/addresses-and-params), checked 17 Nov 2026.
import { ethers } from "ethers";

const CHAIN_ID = 11155111;
const DIAMOND = "0x3624EB012B5E998BB57B6bE6C9Cfc9c4bc5eb99b";
const USDC = "0xcc194e1a843B658526D0D5C431f670028582Ae17"; // test token, public mint
const MACHINA = "0xd68305cA83C7AF42A4F720144E7416fB53F8AaF4";
const ROUTER = "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E"; // Uniswap SwapRouter02, Sepolia
const POOL_FEE = 3000;

// Bonds are USD amounts taken in MACHINA at the pool price, so the MACHINA target
// is read from the Diamond, not hardcoded (the docs' "2 USDC ≈ 2 MACHINA" was
// off by 12x on 17 Nov). Covers miner bond + contributor bond, with 50% slack
// for price moves, plus the $5 evaluator-adapter bond (EVENT_OUTCOME_RESOLUTION).
const TARGET = {
  escrow: ethers.parseUnits("5", 6), // 500 asks at $0.01
  walletUsdc: ethers.parseUnits("10", 6), // left for x402 "exact" payments
};
const SWAP_USDC = ethers.parseUnits("8", 6);
const MAX_MINT = ethers.parseUnits("50", 6); // refuse anything larger: a units bug, not a plan

const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function mint(address,uint256)",
];
const DIAMOND_ABI = [
  "function depositUSDC(uint256)",
  "function effectiveBalance(address) view returns (uint256)",
  "function usdcToken() view returns (address)",
  "function machinaToken() view returns (address)",
  "function entityBonds() view returns (uint64,uint64,uint256,uint256)",
];
const ROUTER_ABI = [
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)",
];

const provider = new ethers.JsonRpcProvider(process.env.RPC ?? "https://ethereum-sepolia-rpc.publicnode.com", CHAIN_ID);
if (!process.env.AGENT_PRIVATE_KEY) throw new Error("AGENT_PRIVATE_KEY is not set in .env");
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
const usdc = new ethers.Contract(USDC, ERC20, wallet);
const machina = new ethers.Contract(MACHINA, ERC20, wallet);
const diamond = new ethers.Contract(DIAMOND, DIAMOND_ABI, wallet);
const router = new ethers.Contract(ROUTER, ROUTER_ABI, wallet);

const fmt = (v, d) => ethers.formatUnits(v, d);
const txs = [];

async function send(label, promise) {
  const tx = await promise;
  const r = await tx.wait();
  if (r.status !== 1) throw new Error(`${label} reverted: ${tx.hash}`);
  txs.push({ label, hash: tx.hash });
  console.log(`  ok  ${label}  https://sepolia.etherscan.io/tx/${tx.hash}`);
}

async function ensureAllowance(token, spender, amount, label) {
  if ((await token.allowance(wallet.address, spender)) < amount) await send(`approve ${label}`, token.approve(spender, amount));
}

async function status() {
  const [eth, u, m, e] = await Promise.all([
    provider.getBalance(wallet.address),
    usdc.balanceOf(wallet.address),
    machina.balanceOf(wallet.address),
    diamond.effectiveBalance(wallet.address),
  ]);
  console.log(`wallet ${wallet.address}  ETH ${fmt(eth, 18)}  USDC ${fmt(u, 6)}  MACHINA ${fmt(m, 18)}  escrow ${fmt(e, 6)}`);
  return { eth, u, m, e };
}

// The docs table can drift; the Diamond is the source of truth.
const [dUsdc, dMachina] = await Promise.all([diamond.usdcToken(), diamond.machinaToken()]);
if (ethers.getAddress(dUsdc) !== USDC || ethers.getAddress(dMachina) !== MACHINA) {
  throw new Error(`Diamond reports usdc=${dUsdc} machina=${dMachina}; addresses here are stale — stop`);
}

// entityBonds: [adapterUsd, contributorUsd, adapterMachina, contributorMachina]; $1 miner bond == $1 contributor bond
const bonds = await diamond.entityBonds();
TARGET.machina = ((bonds[3] * 2n + bonds[2]) * 3n) / 2n;
console.log(`bond target ${fmt(TARGET.machina, 18)} MACHINA (miner + contributor + adapter, +50%)`);

let s = await status();
if (process.argv.includes("--status")) process.exit(0);
if (s.eth < ethers.parseEther("0.005")) throw new Error("under 0.005 Sepolia ETH for gas — top up from a faucet first");

const needMachina = s.m < TARGET.machina;
const needEscrow = s.e < TARGET.escrow ? TARGET.escrow - s.e : 0n;
const needUsdc = (needMachina ? SWAP_USDC : 0n) + needEscrow + TARGET.walletUsdc;
if (s.u < needUsdc) {
  const mint = needUsdc - s.u;
  if (mint > MAX_MINT) throw new Error(`would mint ${fmt(mint, 6)} USDC, over the ${fmt(MAX_MINT, 6)} cap`);
  await send(`mint ${fmt(mint, 6)} test USDC`, usdc.mint(wallet.address, mint));
}

if (needMachina) {
  await ensureAllowance(usdc, ROUTER, SWAP_USDC, "router");
  // ponytail: amountOutMinimum 0 is fine for a testnet pool we only need bond money from;
  // set a floor from quoter if this ever touches real funds
  await send(`swap ${fmt(SWAP_USDC, 6)} USDC -> MACHINA`, router.exactInputSingle({
    tokenIn: USDC, tokenOut: MACHINA, fee: POOL_FEE, recipient: wallet.address,
    amountIn: SWAP_USDC, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n,
  }));
}

if (needEscrow > 0n) {
  await ensureAllowance(usdc, DIAMOND, needEscrow, "Diamond");
  await send(`deposit ${fmt(needEscrow, 6)} USDC to escrow`, diamond.depositUSDC(needEscrow));
}

s = await status();
if (s.m < TARGET.machina) console.log(`  warn MACHINA ${fmt(s.m, 18)} is under the ${fmt(TARGET.machina, 18)} target (pool price moved); re-run to swap again`);
console.log(txs.length ? `${txs.length} transaction(s) sent` : "nothing to do");
