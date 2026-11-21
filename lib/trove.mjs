// Trove (National Library of Australia) digitised newspapers: the record for closures that no
// survey or register explains. Needs TROVE_KEY (a free API key from the NLA). Read directly,
// not a Telegraph answer, and shown as article title, date, paper and snippet with its link.

export const TROVE_API = "https://api.trove.nla.gov.au/v3/result";

/** Newspaper articles that name the mine, in the closure year (and the year after). */
export async function troveSearch(mine, year, { key = process.env.TROVE_KEY, fetchImpl = fetch, n = 5 } = {}) {
  if (!key) return null;
  const q = `"${String(mine).replace(/"/g, "")}" (closed OR closing OR closure OR suspended OR abandoned OR "ceased work" OR "shut down")`;
  const params = new URLSearchParams({ category: "newspaper", q, encoding: "json", n: String(n), reclevel: "brief", "l-decade": String(Math.floor(year / 10)) });
  const r = await fetchImpl(`${TROVE_API}?${params}`, { headers: { "X-API-KEY": key }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`Trove ${r.status}`);
  return troveArticles(await r.json(), year);
}

/** Articles from a v3 result, nearest to the closure year first, the snippet with tags removed. */
export function troveArticles(json, year) {
  const recs = json?.category?.find((c) => c.code === "newspaper")?.records?.article ?? [];
  return recs
    .map((a) => ({
      title: String(a.heading ?? "").trim(),
      date: a.date ?? null,
      paper: a.title?.title ?? a.title?.value ?? null,
      snippet: String(a.snippet ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 300),
      url: /^https?:\/\//.test(a.troveUrl ?? "") ? a.troveUrl : a.id ? `https://nla.gov.au/nla.news-article${a.id}` : null,
    }))
    .filter((a) => a.title && a.url)
    .sort((a, b) => Math.abs(Number(String(a.date).slice(0, 4)) - year) - Math.abs(Number(String(b.date).slice(0, 4)) - year));
}
