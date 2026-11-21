// The public record of every second opinion: one EAS attestation per call, so the
// usage count and the list of disagreements are on chain, not in a log only we hold.
//
// Schema (Ethereum Sepolia): which intent, which two miners and signals, the verdict,
// the fields that differed, and an optional self-declared client name.
import { ethers } from "ethers";
import { EAS, GRAPHQL } from "./reputation.mjs";

export const FEED_SCHEMA = "string intent,uint256 minerA,uint256 minerB,bytes32 signalA,bytes32 signalB,uint8 verdict,string differ,string client";
export const FEED_UID = ethers.solidityPackedKeccak256(["string", "address", "bool"], [FEED_SCHEMA, ethers.ZeroAddress, true]);
export const FEED_VERDICT = { agree: 1, disagree: 2, insufficient: 3 };
const NAME = Object.fromEntries(Object.entries(FEED_VERDICT).map(([k, v]) => [v, k]));
const coder = ethers.AbiCoder.defaultAbiCoder();
const b32 = (s) => (/^0x[0-9a-fA-F]{64}$/.test(String(s ?? "")) ? s : ethers.ZeroHash);
const id = (a) => (/^\d+$/.test(String(a?.miner?.id ?? "")) ? BigInt(a.miner.id) : 0n);

/** ABI-encode one second-opinion result. The two answers shown are the compared pair, or the first two tried. */
export function encodeFeed(so, client = "") {
  const pair = so.answers.filter((a) => a.usable).slice(0, 2);
  const [a, b] = pair.length === 2 ? pair : so.answers.slice(0, 2);
  return coder.encode(["string", "uint256", "uint256", "bytes32", "bytes32", "uint8", "string", "string"],
    [so.intent, id(a), id(b), b32(a?.signal), b32(b?.signal), FEED_VERDICT[so.verdict] ?? 3, (so.differ ?? []).join(","), String(client).slice(0, 40)]);
}

/** Write it. Sent, not waited for: the caller gets the tx hash, the chain does the rest. */
export async function recordFeed(so, client, signer) {
  const eas = new ethers.Contract(EAS, ["function attest(tuple(bytes32 schema, tuple(address recipient, uint64 expirationTime, bool revocable, bytes32 refUID, bytes data, uint256 value) data)) payable returns (bytes32)"], signer);
  const tx = await eas.attest({ schema: FEED_UID, data: { recipient: ethers.ZeroAddress, expirationTime: 0n, revocable: true, refUID: ethers.ZeroHash, data: encodeFeed(so, client), value: 0n } });
  return tx.hash;
}

export function decodeFeed(r) {
  try {
    const f = Object.fromEntries(JSON.parse(r.decodedDataJson).map((x) => [x.name, x.value?.value]));
    const n = (v) => (typeof v === "object" ? BigInt(v.hex ?? v).toString() : String(v));
    return { uid: r.id, attester: r.attester, time: r.time, intent: f.intent, minerA: n(f.minerA), minerB: n(f.minerB), signalA: f.signalA, signalB: f.signalB, verdict: NAME[Number(f.verdict)] ?? "insufficient", differ: f.differ ? String(f.differ).split(",") : [], client: f.client || null };
  } catch { return null; }
}

/** Read the feed, newest first, from the given attesters only (anyone can attest to an open schema). */
export async function readFeed(attesters, { fetchImpl = fetch, take = 500 } = {}) {
  const query = `query($w: AttestationWhereInput, $t: Int) { attestations(where: $w, take: $t, orderBy: { time: desc }) { id attester time decodedDataJson } }`;
  const where = { schemaId: { equals: FEED_UID }, revoked: { equals: false }, attester: { in: attesters } };
  const res = await fetchImpl(GRAPHQL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables: { w: where, t: take } }), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`EAS indexer ${res.status}`);
  return ((await res.json())?.data?.attestations ?? []).map(decodeFeed).filter(Boolean);
}

/** Counts by verdict, intent and client, plus the latest disagreements. */
export function summariseFeed(rows, latest = 10) {
  const count = (key) => rows.reduce((m, r) => ((m[r[key] ?? "unnamed"] = (m[r[key] ?? "unnamed"] ?? 0) + 1), m), {});
  return {
    calls: rows.length,
    verdicts: count("verdict"),
    intents: count("intent"),
    clients: count("client"),
    // Verdicts per intent: where the network agrees with itself, and where it does not.
    by_intent: rows.reduce((m, r) => { const e = (m[r.intent] ??= { agree: 0, disagree: 0, insufficient: 0 }); e[r.verdict] = (e[r.verdict] ?? 0) + 1; return m; }, {}),
    since: rows.length ? new Date(rows.at(-1).time * 1000).toISOString() : null,
    disagreements: rows.filter((r) => r.verdict === "disagree").slice(0, latest).map((r) => ({
      intent: r.intent, miners: [r.minerA, r.minerB], differ: r.differ, at: new Date(r.time * 1000).toISOString(),
      signals: [r.signalA, r.signalB].filter((s) => s && s !== ethers.ZeroHash).map((s) => `https://devnode.telegraphprotocol.com/engine/v1/signal/${s}`),
      attestation: `https://sepolia.easscan.org/attestation/view/${r.uid}`,
    })),
  };
}
