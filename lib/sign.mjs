// Ed25519 signatures over canonical JSON, so a published scorecard cannot be
// edited after the fact without the signature failing. The public key lives in
// keys/takar-ed25519.pub (SPKI, base64); the private key only in .env.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, createHash } from "node:crypto";

/** Stable JSON: object keys sorted, so the same data always hashes the same. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

export function newKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateB64: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    publicB64: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  };
}

export function signDoc(doc, privateB64) {
  const key = createPrivateKey({ key: Buffer.from(privateB64, "base64"), format: "der", type: "pkcs8" });
  const body = canonical(doc);
  return {
    algorithm: "ed25519",
    sha256: createHash("sha256").update(body).digest("hex"),
    signature: sign(null, Buffer.from(body), key).toString("base64"),
    public_key: createPublicKey(key).export({ type: "spki", format: "der" }).toString("base64"),
  };
}

export function verifyDoc(doc, att) {
  const key = createPublicKey({ key: Buffer.from(att.public_key, "base64"), format: "der", type: "spki" });
  return verify(null, Buffer.from(canonical(doc)), key, Buffer.from(att.signature, "base64"));
}
