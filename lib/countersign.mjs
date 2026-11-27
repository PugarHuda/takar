// Countersign (another Season II team, Anthony) as one more independent input to Trade Assurance.
// A Countersign memo is a signed report that links an order to shipment evidence and recommends
// release or hold. Takar checks it on its own before using it:
//   digest    = keccak256 of the memo as JSON with sorted keys, without `digest` and `signature`
//   signature = EIP-191 personal signature over the 32 digest bytes, recovering to `agent`
// (worked out from their published memos and confirmed on both; see lib/countersign.test.mjs).
import { ethers } from "ethers";
import { canonJson as canon } from "./trade.mjs";

/** The agent Countersign signs with (their published memos, Nov 2026). Pinned, not read from the memo. */
export const COUNTERSIGN_AGENT = "0x77301A935d97F9c08d1F50829060B0Eb31346d5E";
export const memoUrl = (id) => `https://countersign.ink/api/memos/${encodeURIComponent(id)}`;

/** Recompute the digest and recover the signer. Valid only if both hold and the signer is pinned. */
export function verifyMemo(memo, agent = COUNTERSIGN_AGENT) {
  const { digest, signature, ...body } = memo ?? {};
  const computed = ethers.keccak256(ethers.toUtf8Bytes(canon(body)));
  let signer = null;
  try { signer = ethers.verifyMessage(ethers.getBytes(digest), signature); } catch { /* malformed */ }
  const digestOk = computed === digest, signerOk = !!signer && signer.toLowerCase() === String(agent).toLowerCase() && signer.toLowerCase() === String(body.agent).toLowerCase();
  return { valid: digestOk && signerOk, digestOk, signerOk, signer, computed };
}

/** What the memo means for one deal: release (pass), hold (review), or unusable (review) when it is
 *  unsigned, signed by someone else, or about another order. Never a reason to pay on its own. */
export function memoVerdict(memo, { po, agent = COUNTERSIGN_AGENT } = {}) {
  const v = verifyMemo(memo, agent);
  if (!v.valid) return { state: "unusable", why: !v.digestOk ? "the memo's digest does not match its contents" : "the memo is not signed by Countersign's agent", ...v };
  let packet = null;
  try { packet = JSON.parse(memo.subject?.fields?.["order-packet"] ?? "null"); } catch { /* not JSON */ }
  const memoPo = packet?.purchaseOrder?.id ?? null;
  if (po && memoPo !== po) return { state: "unusable", why: `the memo is about ${memoPo ?? "an unknown order"}, not ${po}`, memoPo, ...v };
  const label = String(memo.decision_label ?? "").toUpperCase();
  const state = /^(PROCEED|RELEASE|PAY)$/.test(label) ? "release" : "hold";
  return { state, label, why: (memo.reasons ?? [])[0] ?? null, reasons: memo.reasons ?? [], memoPo, shipment: memo.payment_conditions?.document_decision ?? null, id: memo.id, ...v };
}
