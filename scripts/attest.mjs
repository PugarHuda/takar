// Write Takar's evidence about Telegraph miners to EAS on Ethereum Sepolia.
//
//   node --env-file=.env scripts/attest.mjs            # dry run: what would be attested
//   node --env-file=.env scripts/attest.mjs --send     # register the schema once, then attest
//
// Sources: receipts/scorecard.json (each miner's yes/no against the market's own
// resolution) and receipts/decisions.jsonl (answers the fleet could not use, and
// why). One attestation per Telegraph signal; signals already attested are skipped.
// The recipient is the miner's fee wallet from the node's registry, so a miner's
// record follows its wallet. Gas only, testnet.
import { readFileSync, appendFileSync, existsSync, readdirSync } from "node:fs";
import { ethers } from "ethers";
import { EAS, SCHEMA_REGISTRY, SCHEMA, fromScorecard, fromFleet, fromScreens, dedupe, readAttestations } from "../lib/reputation.mjs";

const send = process.argv.includes("--send");
const provider = new ethers.JsonRpcProvider(process.env.RPC ?? "https://ethereum-sepolia-rpc.publicnode.com", 11155111, { staticNetwork: true });
const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, provider);
const registry = new ethers.Contract(SCHEMA_REGISTRY, [
  "function register(string schema, address resolver, bool revocable) returns (bytes32)",
  "function getSchema(bytes32 uid) view returns (tuple(bytes32 uid, address resolver, bool revocable, string schema))",
], wallet);
const eas = new ethers.Contract(EAS, [
  "function multiAttest(tuple(bytes32 schema, tuple(address recipient, uint64 expirationTime, bool revocable, bytes32 refUID, bytes data, uint256 value)[] data)[] multiRequests) payable returns (bytes32[])",
], wallet);

// The schema UID is fixed by its text, resolver and revocability.
const uid = ethers.solidityPackedKeccak256(["string", "address", "bool"], [SCHEMA, ethers.ZeroAddress, true]);
const exists = (await registry.getSchema(uid)).uid !== ethers.ZeroHash;
console.log(`schema ${uid} ${exists ? "registered" : "not registered yet"}`);

const card = JSON.parse(readFileSync("receipts/scorecard.json", "utf8"));
const decisions = readFileSync("receipts/decisions.jsonl", "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
// Skip only what THIS wallet already attested (on chain, plus the local log): the schema
// is open, so another attester's record of a signal must never suppress ours.
const mine = exists ? await readAttestations(uid, { attester: wallet.address }) : [];
const logged = existsSync("receipts/attestations.jsonl") ? readFileSync("receipts/attestations.jsonl", "utf8").trim().split("\n").filter(Boolean).flatMap((l) => JSON.parse(l).signals ?? []) : [];
const already = new Set([...mine.map((a) => String(a.signal)), ...logged].map((x) => x.toLowerCase()));
// Sanctions screens bought for Settle v3, held against what the lists say (checked 21 Nov 2026).
const TRUTH = {
  "Bank Rossiya": { listed: true, source: "US Treasury OFAC SDN list, UID 16681 (UKRAINE-EO13661), https://sanctionssearch.ofac.treas.gov/" },
  "Siemens AG": { listed: false, source: "not on the US Treasury OFAC SDN list as of 21 Nov 2026, https://sanctionssearch.ofac.treas.gov/" },
};
// Every screen Settle v3 decided also carries Praman's OFAC SDN verdict, a check outside Telegraph:
// a name Praman screened cleanly becomes known truth for the miners asked about it.
if (existsSync("receipts/settlements3.jsonl")) {
  for (const l of readFileSync("receipts/settlements3.jsonl", "utf8").split(/\r?\n/).filter(Boolean)) {
    const r = JSON.parse(l);
    if (r.name && typeof r.praman?.matched === "boolean" && r.praman.list_loaded && !TRUTH[r.name])
      TRUTH[r.name] = { listed: r.praman.matched, source: `Praman OFAC SDN screen (list loaded ${r.praman.list_loaded}), outside Telegraph${r.praman.top ? `: ${r.praman.top}` : ""}` };
  }
}
const ledger = readFileSync("receipts/ledger.jsonl", "utf8").trim().split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
// Known-answer tests (scripts/trap-run.mjs) share the scorecard shape.
const traps = readdirSync("receipts").filter((n) => /^trap-(hard-)?\d{4}-\d{2}-\d{2}\.json$/.test(n)).flatMap((n) => fromScorecard(JSON.parse(readFileSync(`receipts/${n}`, "utf8"))));
const records = dedupe([...fromScorecard(card), ...traps, ...fromFleet(decisions), ...fromScreens(ledger, TRUTH)], already);
console.log(`${records.length} new records (${already.size} signals already attested)`);

// Miner id -> fee wallet, from the node's public registry.
const miners = await fetch("https://devnode.telegraphprotocol.com/api/miners").then((r) => r.json()).catch(() => []);
const wallets = new Map((Array.isArray(miners) ? miners : miners.miners ?? []).map((m) => [String(m.id), m.fee_address ?? m.wallet_address]));
const recipient = (id) => (ethers.isAddress(wallets.get(id) ?? "") ? ethers.getAddress(wallets.get(id)) : ethers.ZeroAddress);

const coder = ethers.AbiCoder.defaultAbiCoder();
const encode = (r) => coder.encode(["string", "uint256", "bytes32", "uint8", "string"], [r.intent, BigInt(r.minerId), r.signal, r.verdict, r.truthSource]);
const counts = {};
for (const r of records) counts[`${r.minerId} ${r.intent.replace(/_GENERAL$/, "")}`] = (counts[`${r.minerId} ${r.intent.replace(/_GENERAL$/, "")}`] ?? 0) + 1;
console.table(counts);
if (!send) { console.log("dry run; add --send to write"); process.exit(0); }

if (!exists) {
  const t = await registry.register(SCHEMA, ethers.ZeroAddress, true);
  await t.wait();
  console.log(`registered schema ${uid}\n  https://sepolia.etherscan.io/tx/${t.hash}`);
}
const CHUNK = 20;
for (let i = 0; i < records.length; i += CHUNK) {
  const part = records.slice(i, i + CHUNK);
  const t = await eas.multiAttest([{ schema: uid, data: part.map((r) => ({ recipient: recipient(r.minerId), expirationTime: 0n, revocable: true, refUID: ethers.ZeroHash, data: encode(r), value: 0n })) }]);
  await t.wait();
  appendFileSync("receipts/attestations.jsonl", JSON.stringify({ at: new Date().toISOString(), schema: uid, count: part.length, tx: t.hash, signals: part.map((r) => r.signal) }) + "\n");
  console.log(`attested ${part.length}  https://sepolia.etherscan.io/tx/${t.hash}`);
}
console.log(`schema on easscan: https://sepolia.easscan.org/schema/view/${uid}`);
