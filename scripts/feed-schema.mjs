// Register the second-opinion feed schema on EAS (Ethereum Sepolia), once. Gas only.
//   node --env-file=.env scripts/feed-schema.mjs
import { ethers } from "ethers";
import { SCHEMA_REGISTRY } from "../lib/reputation.mjs";
import { FEED_SCHEMA, FEED_UID } from "../lib/feed.mjs";

const wallet = new ethers.Wallet(process.env.SERVER_PAYER_KEY, new ethers.JsonRpcProvider("https://ethereum-sepolia-rpc.publicnode.com", 11155111, { staticNetwork: true }));
const reg = new ethers.Contract(SCHEMA_REGISTRY, ["function register(string,address,bool) returns (bytes32)", "function getSchema(bytes32) view returns (tuple(bytes32 uid, address resolver, bool revocable, string schema))"], wallet);
if ((await reg.getSchema(FEED_UID)).uid !== ethers.ZeroHash) console.log(`already registered ${FEED_UID}`);
else { const t = await reg.register(FEED_SCHEMA, ethers.ZeroAddress, true); await t.wait(); console.log(`registered ${FEED_UID}\n  https://sepolia.etherscan.io/tx/${t.hash}`); }
