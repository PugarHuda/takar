// GET /api/memo?id=<countersign memo id> -> the memo's bytes, unchanged, with CORS.
//
// Countersign's API does not send CORS headers, so a browser cannot fetch a memo directly. This only
// relays it; the digest and signature are checked in the browser (verify.html), so a relay that
// altered the memo would be caught there.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const id = String(req.query?.id ?? "");
  if (!/^[\w.-]{3,120}$/.test(id)) return res.status(400).json({ error: "?id=<countersign memo id>" });
  const r = await fetch(`https://countersign.ink/api/memos/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!r) return res.status(502).json({ error: "countersign did not answer" });
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(r.status).send(await r.text());
}
