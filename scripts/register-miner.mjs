// Register the Takar Outcome miner on the V2 Diamond (Ethereum Sepolia).
//
//   node --env-file=.env scripts/register-miner.mjs            simulate, then send
//   node --env-file=.env scripts/register-miner.mjs --dry      simulate only
//   ... --update <id>   re-point an existing registration (updateMiner). Used when
//   the node never indexed the original: 5295 landed at 06:35 UTC on 17 Nov,
//   during the devnode rebuild, and /api/miners/5295 stayed "not found".
//
// The YAML URL is pinned to a commit (miner/yaml-url.txt), so the bytes behind
// it cannot change and the on-chain hash stays true. The bond is $1 in MACHINA
// at the pool price, returned on deregistration.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { ethers } from "ethers";

const DIAMOND = "0x3624EB012B5E998BB57B6bE6C9Cfc9c4bc5eb99b";
const MACHINA = "0xd68305cA83C7AF42A4F720144E7416fB53F8AaF4";
const INTENTS = ["EVENT_OUTCOME_RESOLUTION_GENERAL"];
const MIN_PRICE = 10_000n; // $0.01, the protocol floor

const provider = new ethers.JsonRpcProvider(process.env.RPC ?? "https://ethereum-sepolia-rpc.publicnode.com", 11155111);
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
const diamond = new ethers.Contract(DIAMOND, [
  "function registerMiner(string,bytes32,address,uint256,string[]) returns (uint256)",
  "function updateMiner(uint256,string,bytes32,address,uint256,string[]) returns (uint256)",
], wallet);
const machina = new ethers.Contract(MACHINA, ["function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)", "function balanceOf(address) view returns (uint256)"], wallet);

const url = readFileSync("miner/yaml-url.txt", "utf8").trim();
const res = await fetch(url);
if (!res.ok) throw new Error(`YAML not reachable: ${res.status} ${url}`);
const bytes = Buffer.from(await res.arrayBuffer());
const hash = "0x" + createHash("sha256").update(bytes).digest("hex");
const local = "0x" + createHash("sha256").update(readFileSync("miner/takar-outcome.yaml")).digest("hex");
if (hash !== local) throw new Error(`hosted YAML differs from miner/takar-outcome.yaml (${hash} vs ${local})`);
console.log(`yaml ${url}\nhash ${hash}\nfrom ${wallet.address}`);

// Allow up to 0.2 MACHINA (~$2.4 at today's pool price); only the $1 bond is taken.
const cap = ethers.parseEther("0.2");
if ((await machina.balanceOf(wallet.address)) < ethers.parseEther("0.09")) throw new Error("need ~0.09 MACHINA for the bond: run npm run fund");
if ((await machina.allowance(wallet.address, DIAMOND)) < cap) {
  const tx = await machina.approve(DIAMOND, cap);
  await tx.wait();
  console.log(`approve  https://sepolia.etherscan.io/tx/${tx.hash}`);
}

const args = [url, hash, wallet.address, MIN_PRICE, INTENTS];
const ui = process.argv.indexOf("--update");
const old = ui > 0 ? BigInt(process.argv[ui + 1]) : null;
const call = old === null ? diamond.registerMiner : diamond.updateMiner;
if (old !== null) args.unshift(old);
const id = await call.staticCall(...args); // reverts here, with its reason, before any gas
console.log(`simulated: registration id ${id}`);
if (process.argv.includes("--dry")) process.exit(0);

const tx = await call(...args);
const receipt = await tx.wait();
if (receipt.status !== 1) throw new Error(`${old === null ? "registerMiner" : "updateMiner"} reverted: ${tx.hash}`);
console.log(`registered: id ${id}  https://sepolia.etherscan.io/tx/${tx.hash}`);
console.log(`check: curl -s https://devnode.telegraphprotocol.com/api/miners/${id}`);
