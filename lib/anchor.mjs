// Anchors: a digest on EAS so a file cannot be changed, or a receipt deleted, without it showing.
//
//   ledger root: a Merkle root over every line of receipts/ledger.jsonl, in order. Anyone with
//   the file recomputes the root for the first `count` lines and compares it with the chain; a
//   line edited or removed changes the root.
//   dossier:     the sha256 of a signed dossier's canonical JSON (its attestation.sha256).
import { createHash } from "node:crypto";
import { ethers } from "ethers";

export const ANCHOR_SCHEMA = "string kind,bytes32 digest,uint64 count,string uri";
export const ANCHOR_UID = ethers.solidityPackedKeccak256(["string", "address", "bool"], [ANCHOR_SCHEMA, ethers.ZeroAddress, true]);

const sha = (b) => createHash("sha256").update(b).digest();

/** Merkle root (sha256, pairwise, odd node carried up) over the given lines. */
export function merkleRoot(lines) {
  if (!lines.length) return "0x" + "00".repeat(32);
  let level = lines.map((l) => sha(Buffer.from(l, "utf8")));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? sha(Buffer.concat([level[i], level[i + 1]])) : level[i]);
    level = next;
  }
  return "0x" + level[0].toString("hex");
}

/**
 * Inclusion proof for one line, as in Certificate Transparency: the sibling hashes from the leaf up,
 * built with the same rule as merkleRoot (an odd node is carried up unchanged, so it has no sibling
 * at that level). A verifier needs the line, the proof and the anchored root, not the whole file.
 */
export function merkleProof(lines, index) {
  if (index < 0 || index >= lines.length) throw new Error("line out of range");
  let level = lines.map((l) => sha(Buffer.from(l, "utf8")));
  let i = index;
  const path = [];
  while (level.length > 1) {
    const sib = i % 2 ? i - 1 : i + 1;
    if (sib < level.length) path.push({ side: i % 2 ? "left" : "right", hash: "0x" + level[sib].toString("hex") });
    const next = [];
    for (let k = 0; k < level.length; k += 2) next.push(k + 1 < level.length ? sha(Buffer.concat([level[k], level[k + 1]])) : level[k]);
    level = next;
    i = Math.floor(i / 2);
  }
  return path;
}

/** Recompute the root from one line and its proof. */
export function rootFromProof(line, path) {
  let h = sha(Buffer.from(line, "utf8"));
  for (const p of path) {
    const s = Buffer.from(p.hash.slice(2), "hex");
    h = p.side === "left" ? sha(Buffer.concat([s, h])) : sha(Buffer.concat([h, s]));
  }
  return "0x" + h.toString("hex");
}

/** Ledger lines as anchored: trimmed of the trailing newline and of CR (git on Windows adds them). */
export const ledgerLines = (text) => text.replace(/\r/g, "").split("\n").filter((l) => l.length);

export function encodeAnchor({ kind, digest, count = 0, uri = "" }) {
  return ethers.AbiCoder.defaultAbiCoder().encode(["string", "bytes32", "uint64", "string"], [kind, digest, BigInt(count), uri]);
}
