// Money-path checks for the x402 signer. No network, no funds: a random wallet
// signs a fabricated challenge.  node lib/test.mjs
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { signPayment, signEscrow } from "./x402.mjs";

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

// An allowlist accepts either listed token and still refuses others.
const CIRCLE = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const both = [USDC, CIRCLE];
assert.equal((await signPayment({ accepts: [opt("eip155:11155111", { asset: CIRCLE, extra: { name: "USDC", version: "2" } })] }, w, { asset: both })).asset, CIRCLE);
await assert.rejects(signPayment({ accepts: [opt("eip155:11155111", { asset: "0x0000000000000000000000000000000000000002" })] }, w, { asset: both }), /not the expected/);

// Missing or empty allowlist: refuse rather than sign for any token.
await assert.rejects(signPayment({ accepts: [opt("eip155:11155111")] }, w, { asset: [] }), /no expected payment token/);
await assert.rejects(signPayment({ accepts: [opt("eip155:11155111")] }, w), /no expected payment token/);


// escrow: personal_sign over the node's template; the node rebuilds the message with the wallet lowercased
const LEDGER = "0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b";
const esc = (over = {}) => ({ scheme: "escrow", network: "eip155:11155111", payTo: LEDGER, amount: "10000",
  extra: { message: ["Telegraph Escrow Payment", "", "Wallet: {from}", "Pay To: " + LEDGER.toLowerCase(), "Network: eip155:11155111", "Amount: 10000 uUSDC", "Resource: /v1/ask", "Nonce: {nonce}", "Valid After: {validAfter}", "Valid Before: {validBefore}"].join(String.fromCharCode(10)), resource: "/v1/ask" }, ...over });
const e = await signEscrow({ accepts: [opt("eip155:11155111"), esc()] }, w, { escrow: LEDGER });
const env = JSON.parse(Buffer.from(e.header, "base64").toString());
assert.equal(env.scheme, "escrow");
const a = env.payload.authorization;
const rebuilt = esc().extra.message.replaceAll("{from}", a.from.toLowerCase()).replaceAll("{nonce}", a.nonce).replaceAll("{validAfter}", a.validAfter).replaceAll("{validBefore}", a.validBefore);
assert.equal(ethers.verifyMessage(rebuilt, env.payload.signature), w.address);
assert.ok(Number(a.validBefore) - Number(a.validAfter) < 120, "window under the node's 2-minute maximum");
assert.equal(await signEscrow({ accepts: [opt("eip155:11155111")] }, w, { escrow: LEDGER }), null); // no escrow offered: fall back to exact
await assert.rejects(signEscrow({ accepts: [esc({ payTo: "0x0000000000000000000000000000000000000003" })] }, w, { escrow: LEDGER }), /not the funded/);
await assert.rejects(signEscrow({ accepts: [esc({ amount: "5000000" })] }, w, { escrow: LEDGER, maxAmount: 100_000n }), /refusing to sign/);
await assert.rejects(signEscrow({ accepts: [esc()] }, w, {}), /no expected escrow/);
// the node's text is never signed as given: any other message, or another resource, is refused
const forged = esc(); forged.extra = { ...forged.extra, message: "Sign in to example.com" + String.fromCharCode(10) + "Nonce: {nonce}" };
await assert.rejects(signEscrow({ accepts: [forged] }, w, { escrow: LEDGER }), /not the known Telegraph template/);
const other = esc(); other.extra = { ...other.extra, resource: "/v1/withdraw" };
await assert.rejects(signEscrow({ accepts: [other] }, w, { escrow: LEDGER }), /refusing to sign/);
// a direct ask to one miner signs exactly that miner's resource, and only it
const direct = esc(); direct.extra = { message: direct.extra.message.replace("Resource: /v1/ask", "Resource: /v1/ask/20261117"), resource: "/v1/ask/20261117" };
assert.ok(await signEscrow({ accepts: [direct] }, w, { escrow: LEDGER, resources: ["/v1/ask/20261117"] }));
await assert.rejects(signEscrow({ accepts: [direct] }, w, { escrow: LEDGER, resources: ["/v1/ask/9002"] }), /refusing to sign/);

console.log("x402 signer: 19 checks ok");
