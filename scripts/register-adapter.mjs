// Register the Takar Outcome evaluator adapter on the V2 Diamond (Ethereum Sepolia).
//
//   node --env-file=.env scripts/register-adapter.mjs --url <package URL> --runnable <executor URL> [--dry]
//
// The package URL must serve the exact bytes of evaluator/EVENT_OUTCOME_RESOLUTION.safetensors
// (pin it to a commit); its keccak256 is the registered hash. The node first sends
// 15 public pairs to the runnable URL, then downloads the package and re-scores them
// bit for bit.
//
// The node moved to a new Diamond (0x72a7…) on 17 Nov; registrations on the old
// one (0x3624…) are never indexed. On the new Diamond, entityBonds() is in test
// USDC (6 decimals): $5 for an adapter, returned on deregistration.
import { readFileSync } from "node:fs";
import { ethers } from "ethers";

const DIAMOND = "0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b";
const BOND_TOKEN = "0xcc194e1a843B658526D0D5C431f670028582Ae17"; // test USDC, public mint
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
const bondToken = new ethers.Contract(BOND_TOKEN, ["function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)", "function balanceOf(address) view returns (uint256)"], wallet);

const local = readFileSync(PKG);
const hosted = Buffer.from(await (await fetch(url)).arrayBuffer());
const hash = ethers.keccak256(local);
if (ethers.keccak256(hosted) !== hash) throw new Error(`hosted package differs from ${PKG}`);
const probe = await fetch(runnable, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ batch: [{ tokens: [50281, 50282] }] }) });
if (probe.status !== 200) throw new Error(`runnable URL answered ${probe.status}: ${(await probe.text()).slice(0, 200)}`);
console.log(`package ${url}\nkeccak  ${hash}\nrunner  ${runnable}\nfrom    ${wallet.address}`);

const bond = (await diamond.entityBonds())[2];
if ((await bondToken.balanceOf(wallet.address)) < bond) throw new Error(`need ${ethers.formatUnits(bond, 6)} test USDC for the bond: run npm run fund`);
if ((await bondToken.allowance(wallet.address, DIAMOND)) < bond) {
  const tx = await bondToken.approve(DIAMOND, (bond * 3n) / 2n);
  await tx.wait();
  console.log(`approve  https://sepolia.etherscan.io/tx/${tx.hash}`);
}

const args = [hash, url, PREFIX, wallet.address, runnable];
const id = await diamond.registerWasm.staticCall(...args); // reverts here, with its reason, before any gas
console.log(`simulated: registration id ${id} (bond ${ethers.formatUnits(bond, 6)} test USDC)`);
if (process.argv.includes("--dry")) process.exit(0);
const tx = await diamond.registerWasm(...args);
const receipt = await tx.wait();
if (receipt.status !== 1) throw new Error(`registerWasm reverted: ${tx.hash}`);
console.log(`registered  https://sepolia.etherscan.io/tx/${tx.hash}`);
console.log(`check: curl -s https://devnode.telegraphprotocol.com/api/wasm  (look under ${PREFIX})`);
