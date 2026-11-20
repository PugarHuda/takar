// Register the Takar Outcome evaluator adapter on the V2 Diamond (Ethereum Sepolia).
//
//   node --env-file=.env scripts/register-adapter.mjs --url <package URL> --runnable <executor URL> [--dry]
//
// The package URL must serve the exact bytes of evaluator/EVENT_OUTCOME_RESOLUTION.safetensors
// (pin it to a commit); its keccak256 is the registered hash. The node first sends
// 15 public pairs to the runnable URL, then downloads the package and re-scores them
// bit for bit. Bond: $5 in MACHINA at the pool price, returned on deregistration.
import { readFileSync } from "node:fs";
import { ethers } from "ethers";

const DIAMOND = "0x3624EB012B5E998BB57B6bE6C9Cfc9c4bc5eb99b";
const MACHINA = "0xd68305cA83C7AF42A4F720144E7416fB53F8AaF4";
const PREFIX = "EVENT_OUTCOME_RESOLUTION";
const PKG = "evaluator/EVENT_OUTCOME_RESOLUTION.safetensors";

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const url = arg("--url"), runnable = arg("--runnable");
if (!url || !runnable) throw new Error("usage: --url <package URL> --runnable <executor URL> [--dry]");

const provider = new ethers.JsonRpcProvider(process.env.RPC ?? "https://ethereum-sepolia-rpc.publicnode.com", 11155111);
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
const diamond = new ethers.Contract(DIAMOND, [
  "function registerWasm(bytes32,string,string,address,string) returns (uint256)",
  "function entityBonds() view returns (uint64,uint64,uint256,uint256)",
], wallet);
const machina = new ethers.Contract(MACHINA, ["function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)", "function balanceOf(address) view returns (uint256)"], wallet);

const local = readFileSync(PKG);
const hosted = Buffer.from(await (await fetch(url)).arrayBuffer());
const hash = ethers.keccak256(local);
if (ethers.keccak256(hosted) !== hash) throw new Error(`hosted package differs from ${PKG}`);
const probe = await fetch(runnable, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ batch: [{ tokens: [50281, 50282] }] }) });
if (probe.status !== 200) throw new Error(`runnable URL answered ${probe.status}: ${(await probe.text()).slice(0, 200)}`);
console.log(`package ${url}\nkeccak  ${hash}\nrunner  ${runnable}\nfrom    ${wallet.address}`);

const bond = (await diamond.entityBonds())[2];
if ((await machina.balanceOf(wallet.address)) < bond) throw new Error(`need ${ethers.formatEther(bond)} MACHINA for the bond: run npm run fund`);
if ((await machina.allowance(wallet.address, DIAMOND)) < bond) {
  const tx = await machina.approve(DIAMOND, (bond * 3n) / 2n);
  await tx.wait();
  console.log(`approve  https://sepolia.etherscan.io/tx/${tx.hash}`);
}

const args = [hash, url, PREFIX, wallet.address, runnable];
const id = await diamond.registerWasm.staticCall(...args); // reverts here, with its reason, before any gas
console.log(`simulated: registration id ${id} (bond ${ethers.formatEther(bond)} MACHINA)`);
if (process.argv.includes("--dry")) process.exit(0);
const tx = await diamond.registerWasm(...args);
const receipt = await tx.wait();
if (receipt.status !== 1) throw new Error(`registerWasm reverted: ${tx.hash}`);
console.log(`registered  https://sepolia.etherscan.io/tx/${tx.hash}`);
console.log(`check: curl -s https://devnode.telegraphprotocol.com/api/wasm  (look under ${PREFIX})`);
