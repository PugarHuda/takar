// Takar escrow on Solana devnet (program 9TB4j4rce2Tk2PZy8XVajaZxAsqxCW3hJKqPhroSzD9k): the
// non-custodial Solana leg. Run from the repo root.
//
//   node solana/escrow.mjs open --case v5-0      buyer locks the Sepolia deal's amount in the program's vault
//   node solana/escrow.mjs settle --case v5-0    two attestors sign the Sepolia outcome; the program pays it
//   node solana/escrow.mjs check                 refusals the program must make (one attestor, sums that don't add up)
//   node solana/escrow.mjs status --case v5-0
//
// Attestors: Takar's two Solana keys and a third seat kept for a partner (threshold 2 of 3). The vault
// belongs to the program, so no attestor can take the funds: a settlement only reaches the deal's payee
// and payer, in amounts that add up to the deposit. Keys in .solana/ (git-ignored).
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { payoutFrom } from "../scripts/solana-leg.mjs";

const { AnchorProvider, Program, Wallet, BN } = anchor;
const key = (n) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`.solana/${n}.json`, "utf8"))));
const cfg = JSON.parse(readFileSync(".solana/config.json", "utf8"));
const conn = new Connection("https://api.devnet.solana.com", "confirmed");
const idl = JSON.parse(readFileSync("solana/idl/takar_escrow.json", "utf8"));
const [cmd, ...rest] = process.argv.slice(2);
const arg = (k) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : undefined; };
const buyer = key("buyer"), supplier = key("supplier"), att1 = key("escrow"), att2 = key("attestor2"), att3 = key("attestor3");
const program = (signer) => new Program(idl, new AnchorProvider(conn, new Wallet(signer), { commitment: "confirmed" }));
const mint = new PublicKey(cfg.mint);
const caseId = (c) => [...createHash("sha256").update(`takar:case-${c}`).digest()];
const pdas = (c) => {
  const [deal] = PublicKey.findProgramAddressSync([Buffer.from("deal"), buyer.publicKey.toBuffer(), Buffer.from(caseId(c))], program(buyer).programId);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), deal.toBuffer()], program(buyer).programId);
  return { deal, vault };
};
const ata = (owner) => getOrCreateAssociatedTokenAccount(conn, att1, mint, owner).then((a) => a.address);
const log = (row) => { mkdirSync("receipts/solana", { recursive: true }); appendFileSync("receipts/solana/escrow-log.jsonl", JSON.stringify({ at: new Date().toISOString(), program: idl.address, ...row }) + "\n"); };
const ex = (s) => `https://explorer.solana.com/tx/${s}?cluster=devnet`;

/** The Sepolia deal and its logged settlement, as scripts/solana-leg.mjs reads them. */
async function sepolia(c) {
  const mod = await import("../scripts/solana-leg.mjs");
  return mod.sepoliaDeal(c);
}

async function settleTx(c, toPayee, toPayer, sepoliaTx, signers) {
  const { deal, vault } = pdas(c);
  const p = program(att1);
  return p.methods.settle(new BN(toPayee.toString()), new BN(toPayer.toString()), [...Buffer.from(sepoliaTx.replace(/^0x/, ""), "hex")])
    .accountsPartial({ deal, vault, payeeToken: await ata(supplier.publicKey), payerToken: await ata(buyer.publicKey), tokenProgram: TOKEN_PROGRAM_ID })
    .remainingAccounts(signers.map((s) => ({ pubkey: s.publicKey, isSigner: true, isWritable: false })))
    .signers(signers.filter((s) => !s.publicKey.equals(att1.publicKey)))
    .rpc();
}

if (cmd === "open") {
  const c = arg("case"); const d = await sepolia(c);
  const { deal, vault } = pdas(c);
  const sig = await program(buyer).methods.open(caseId(c), new BN(d.amount.toString()), [att1.publicKey, att2.publicKey, att3.publicKey], 2, new BN(Math.floor(Date.now() / 1000) + 7 * 86400))
    .accountsPartial({ payer: buyer.publicKey, payee: supplier.publicKey, mint, deal, vault, payerToken: await ata(buyer.publicKey), tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY })
    .rpc();
  console.log(`case ${c}: ${Number(d.amount) / 1e6} locked in the program vault ${vault.toBase58()} (deal ${deal.toBase58()})\n  ${ex(sig)}`);
  log({ action: "open", case: c, amount: String(d.amount), deal: deal.toBase58(), vault: vault.toBase58(), attestors: [att1, att2, att3].map((k) => k.publicKey.toBase58()), threshold: 2, sig });
} else if (cmd === "settle") {
  const c = arg("case"); const p = payoutFrom(await sepolia(c));
  if (!p) { console.log(`case ${c}: not settled on Sepolia yet; the program would not be asked`); process.exit(0); }
  const sig = await settleTx(c, p.toSupplier, p.toBuyer, p.sepoliaTx, [att1, att2]);
  console.log(`case ${c}: the program paid supplier ${Number(p.toSupplier) / 1e6}, buyer ${Number(p.toBuyer) / 1e6}, on 2 of 3 attestors, mirroring ${p.sepoliaTx}\n  ${ex(sig)}`);
  log({ action: "settle", case: c, toSupplier: String(p.toSupplier), toBuyer: String(p.toBuyer), sepoliaTx: p.sepoliaTx, attestors: 2, sig });
} else if (cmd === "check") {
  // The program's refusals, tried on a live open deal (the transactions fail; nothing moves).
  const c = arg("case") ?? "v6-0"; const d = await sepolia(c); const amt = BigInt(d.amount);
  const tries = [
    ["one attestor only", () => settleTx(c, amt, 0n, "0x" + "00".repeat(32), [att1])],
    ["payouts that do not add up", () => settleTx(c, amt, 1n, "0x" + "00".repeat(32), [att1, att2])],
    ["a non-attestor as the second signer", () => settleTx(c, amt, 0n, "0x" + "00".repeat(32), [att1, buyer])],
  ];
  for (const [name, f] of tries) {
    try { await f(); console.log(`UNEXPECTED: ${name} was accepted`); process.exitCode = 1; }
    catch (e) { const m = String(e.error?.errorMessage ?? e.message).split("\n")[0].slice(0, 90); console.log(`refused as it should: ${name} (${m})`); }
  }
} else if (cmd === "status") {
  const c = arg("case"); const { deal } = pdas(c);
  const a = await program(buyer).account.deal.fetch(deal).catch(() => null);
  console.log(a ? JSON.stringify({ case: c, deal: deal.toBase58(), amount: a.amount.toString(), settled: a.settled, threshold: a.threshold, deadline: new Date(a.deadline.toNumber() * 1000).toISOString() }) : `case ${c}: no deal`);
} else console.log("commands: open --case X | settle --case X | check [--case X] | status --case X");
