// Anchor the ledger root and every signed dossier on EAS (Ethereum Sepolia). Gas only.
//
//   node --env-file=.env scripts/anchor.mjs            # dry run
//   node --env-file=.env scripts/anchor.mjs --send
//   node scripts/anchor.mjs --verify <count> <root>    # recompute a published root from the file
//
// Registers the anchor schema once. Appends what it anchored to receipts/anchors.jsonl.
import { readFileSync, readdirSync, appendFileSync } from "node:fs";
import { ethers } from "ethers";
import { EAS, SCHEMA_REGISTRY } from "../lib/reputation.mjs";
import { ANCHOR_SCHEMA, ANCHOR_UID, merkleRoot, ledgerLines, encodeAnchor } from "../lib/anchor.mjs";

const lines = ledgerLines(readFileSync("receipts/ledger.jsonl", "utf8"));
if (process.argv[2] === "--verify") {
  const n = Number(process.argv[3]), want = String(process.argv[4]).toLowerCase();
  const got = merkleRoot(lines.slice(0, n));
  console.log(got === want ? `ok: the first ${n} lines match ${want}` : `MISMATCH: the first ${n} lines give ${got}, the chain says ${want}`);
  process.exit(got === want ? 0 : 1);
}

const REPO = "https://github.com/PugarHuda/takar/blob/main";
const items = [{ kind: "ledger-root", digest: merkleRoot(lines), count: lines.length, uri: `${REPO}/receipts/ledger.jsonl` }];
for (const f of readdirSync("receipts").filter((x) => /^dossier-.*\.json$/.test(x))) {
  const d = JSON.parse(readFileSync(`receipts/${f}`, "utf8"));
  items.push({ kind: `dossier:${f.slice(8, -5)}`, digest: "0x" + d.attestation.sha256, count: d.receipts?.length ?? 0, uri: `${REPO}/receipts/${f}` });
}
console.table(items.map((i) => ({ kind: i.kind, digest: i.digest.slice(0, 18) + "…", count: i.count })));
if (!process.argv.includes("--send")) { console.log("dry run; add --send"); process.exit(0); }

const wallet = new ethers.Wallet(process.env.AGENT_PRIVATE_KEY, new ethers.JsonRpcProvider("https://ethereum-sepolia-rpc.publicnode.com", 11155111, { staticNetwork: true }));
const reg = new ethers.Contract(SCHEMA_REGISTRY, ["function register(string,address,bool) returns (bytes32)", "function getSchema(bytes32) view returns (tuple(bytes32 uid, address resolver, bool revocable, string schema))"], wallet);
if ((await reg.getSchema(ANCHOR_UID)).uid === ethers.ZeroHash) { const t = await reg.register(ANCHOR_SCHEMA, ethers.ZeroAddress, true); await t.wait(); console.log(`registered anchor schema ${ANCHOR_UID}`); }
const eas = new ethers.Contract(EAS, ["function multiAttest(tuple(bytes32 schema, tuple(address recipient, uint64 expirationTime, bool revocable, bytes32 refUID, bytes data, uint256 value)[] data)[] multiRequests) payable returns (bytes32[])"], wallet);
const t = await eas.multiAttest([{ schema: ANCHOR_UID, data: items.map((i) => ({ recipient: ethers.ZeroAddress, expirationTime: 0n, revocable: true, refUID: ethers.ZeroHash, data: encodeAnchor(i), value: 0n })) }]);
await t.wait();
appendFileSync("receipts/anchors.jsonl", JSON.stringify({ at: new Date().toISOString(), tx: t.hash, schema: ANCHOR_UID, items }) + "\n");
console.log(`anchored ${items.length}: https://sepolia.etherscan.io/tx/${t.hash}\nschema https://sepolia.easscan.org/schema/view/${ANCHOR_UID}`);
