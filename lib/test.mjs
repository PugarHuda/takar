// Money-path checks for the x402 signer. No network, no funds: a random wallet
// signs a fabricated challenge.  node lib/test.mjs
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { signPayment } from "./x402.mjs";

const USDC = "0xcc194e1a843B658526D0D5C431f670028582Ae17";
const w = ethers.Wallet.createRandom();
const opt = (network, extra = {}) => ({
  scheme: "exact", network, amount: "10000", asset: USDC,
  payTo: "0x3624EB012B5E998BB57B6bE6C9Cfc9c4bc5eb99b", maxTimeoutSeconds: 60, extra: { name: "USD Coin", version: "2" }, ...extra,
});

// V2 lists Base Sepolia first; we must still sign for Ethereum Sepolia.
const challenge = { x402Version: 2, accepts: [opt("eip155:84532", { asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" }), { scheme: "escrow", network: "eip155:11155111" }, opt("eip155:11155111")] };
const p = await signPayment(challenge, w, { asset: USDC });
const sent = JSON.parse(Buffer.from(p.header, "base64").toString("utf8"));
assert.equal(sent.network, "eip155:11155111");
assert.equal(sent.accepted.asset, USDC);
assert.equal(p.amount, "10000");

// No option for our chain -> refuse, naming what was offered.
await assert.rejects(signPayment({ accepts: [opt("eip155:84532")] }, w), /no exact option for eip155:11155111.*84532/);
// Over the ceiling -> refuse before signing.
await assert.rejects(signPayment({ accepts: [opt("eip155:11155111", { amount: "5000000" })] }, w, { maxAmount: 100_000n }), /refusing to sign/);
// Wrong token -> refuse.
await assert.rejects(signPayment({ accepts: [opt("eip155:11155111", { asset: "0x0000000000000000000000000000000000000001" })] }, w, { asset: USDC }), /not the expected/);

console.log("x402 signer: 4 checks ok");
