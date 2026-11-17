// Takar Outcome: resolves "did X happen / who won X" from Wikipedia text, and
// refuses to guess.
//
// A language model reads the retrieved text and proposes an answer, but code
// decides whether it stands:
//   - the evidence the model quotes must appear in the retrieved text, word for
//     word (whitespace and case aside), or the answer becomes "unresolved";
//   - a named winner must appear in that text too;
//   - an event whose period has not ended yet is "unresolved" before any model
//     is called, whatever the model would have said.
//
// fetch and the model call are injected so the rules are testable offline.

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const norm = (s) => String(s ?? "").toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

/**
 * End of the latest period a question names ("December 2026" -> 2027-01-01,
 * "2025" -> 2026-01-01, "2024-25" -> 2026-01-01), or null if it names none.
 */
export function latestPeriodEnd(question) {
  const q = norm(question);
  let end = null;
  const push = (d) => { if (!end || d > end) end = d; };
  const monthYear = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/g;
  for (const m of q.matchAll(monthYear)) {
    const mi = MONTHS.indexOf(m[1]);
    push(new Date(Date.UTC(+m[2], mi + 1, 1)));
  }
  // A year already pinned to a month ("February 2026") must not widen to the whole year.
  for (const m of q.replace(monthYear, " ").matchAll(/\b(19|20)(\d{2})(?:[-/](\d{2}))?\b/g)) {
    const y = +(m[1] + m[2]);
    push(new Date(Date.UTC(m[3] ? Math.floor(y / 100) * 100 + +m[3] + 1 : y + 1, 0, 1)));
  }
  return end;
}

/** True when the question is about a period that has not finished at `now`. */
export const notYetDecidable = (question, now = new Date()) => {
  const end = latestPeriodEnd(question);
  return end !== null && end > now;
};

/**
 * The event's own name, as Wikipedia titles it: "2025 Japanese Grand Prix",
 * "2024-25 UEFA Champions League", "2025 Wimbledon men's singles".
 */
export function eventPhrase(question) {
  const m = String(question).match(/\b((?:19|20)\d{2}(?:[-–/]\d{2,4})?)\s+((?:[A-Z][\w'’.&-]*|of|the|de|men's|women's|mayoral|presidential|general)(?:\s+(?:[A-Z][\w'’.&-]*|of|the|de|men's|women's|singles|doubles|election|title|final|championship|mayoral|presidential|general))*)/);
  return m ? `${m[1]} ${m[2]}`.replace(/\s+(title|in|at)$/i, "") : null;
}

const MAX_CHARS = 9000; // per page; enough for a results section, small enough for a free model

export async function wikipedia(question, { fetchImpl = fetch, maxPages = 3 } = {}) {
  const api = "https://en.wikipedia.org/w/api.php?format=json&origin=*&";
  const ua = { headers: { "User-Agent": "takar-outcome/0.1 (https://github.com/PugarHuda/takar)" } };
  const search = async (q) => ((await (await fetchImpl(`${api}action=query&list=search&srlimit=5&srsearch=${encodeURIComponent(q)}`, ua)).json()).query?.search ?? []).map((s) => s.title);

  // The event's name finds its article; the full question finds context pages.
  const phrase = eventPhrase(question);
  const found = [...new Set([...(phrase ? await search(phrase) : []), ...(await search(question))])];
  // Prefer titles carrying the year the question asks about.
  const year = String(question).match(/\b(19|20)\d{2}\b/)?.[0];
  const titles = found.sort((a, b) => Number(year && b.includes(year)) - Number(year && a.includes(year))).slice(0, maxPages);

  const pages = [];
  for (const title of titles) {
    // No exchars: it silently caps plain-text extracts near 1,200 characters,
    // which cuts off the results. Take the article and trim it here.
    const r = await (await fetchImpl(`${api}action=query&prop=extracts|info&inprop=url&explaintext=1&titles=${encodeURIComponent(title)}`, ua)).json();
    const p = Object.values(r.query?.pages ?? {})[0];
    if (p?.extract) pages.push({ title: p.title, url: p.fullurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`, text: p.extract.slice(0, MAX_CHARS) });
  }
  return pages;
}

export const PROMPT = (question, today, pages) => `Today is ${today}. Resolve this event using ONLY the sources below.

Event: ${question}

Reply with one JSON object and nothing else:
{"outcome": "yes" | "no" | "unresolved", "winner": string or null, "resolved_at": string or null, "source_title": string or null, "evidence": string or null}

Rules:
- "yes" means the event happened / passed / the named party won. "no" means it was settled the other way.
- For "who won ..." questions: outcome "yes" if the sources name a winner, and put the winner's name in "winner".
- "evidence" must be ONE sentence copied word for word from a source that settles the outcome.
- If the sources do not clearly settle it, or it has not happened yet, answer "unresolved" with evidence null.
- Do not use anything you know that is not in the sources.

${pages.map((p, i) => `--- Source ${i + 1}: ${p.title} (${p.url})\n${p.text}`).join("\n\n")}`;

// Reasoning models may think aloud before the answer, braces included. Take the
// last parseable object that carries an "outcome" key.
function parseJson(text) {
  const s = String(text ?? "");
  for (let end = s.lastIndexOf("}"); end > 0; end = s.lastIndexOf("}", end - 1)) {
    for (let start = s.lastIndexOf("{", end); start >= 0; start = s.lastIndexOf("{", start - 1)) {
      try { const o = JSON.parse(s.slice(start, end + 1)); if (o && typeof o === "object" && "outcome" in o) return o; } catch { /* keep looking */ }
    }
  }
  return null;
}

const unresolved = (event, why, sources = []) => ({ event, outcome: "unresolved", resolved_yes: false, winner: null, resolved_at: null, sources, evidence: null, note: why });

/**
 * Resolve one event. `llm(prompt) -> string` and `fetchImpl` are injected.
 */
export async function resolve(event, { llm, fetchImpl = fetch, now = new Date() } = {}) {
  const q = String(event ?? "").trim();
  if (!q) throw Object.assign(new Error("event is required"), { status: 400 });
  if (q.length > 500) throw Object.assign(new Error("event must be at most 500 characters"), { status: 400 });

  if (notYetDecidable(q, now)) return unresolved(q, "the period this event names has not ended yet");

  const pages = await wikipedia(q, { fetchImpl });
  if (!pages.length) return unresolved(q, "no source found");
  const sources = pages.map((p) => p.url);

  const proposed = parseJson(await llm(PROMPT(q, now.toISOString().slice(0, 10), pages)));
  if (!proposed || !["yes", "no", "unresolved"].includes(proposed.outcome)) return unresolved(q, "model gave no usable answer", sources);
  if (proposed.outcome === "unresolved") return unresolved(q, "sources do not settle it", sources);

  // Code, not the model, decides whether the answer stands.
  const corpus = norm(pages.map((p) => p.text).join("\n"));
  const ev = norm(proposed.evidence);
  if (ev.length < 20 || !corpus.includes(ev)) return unresolved(q, "quoted evidence not found in the sources", sources);
  const winner = proposed.winner ? String(proposed.winner).trim() : null;
  if (winner && !corpus.includes(norm(winner))) return unresolved(q, "named winner not found in the sources", sources);

  const cited = pages.find((p) => norm(p.text).includes(ev));
  return {
    event: q,
    outcome: proposed.outcome,
    resolved_yes: proposed.outcome === "yes",
    winner,
    resolved_at: proposed.resolved_at ? String(proposed.resolved_at) : null,
    sources: cited ? [cited.url, ...sources.filter((s) => s !== cited.url)] : sources,
    evidence: proposed.evidence,
    note: null,
  };
}

// Free models are shared queues that go 429 without warning, so try a short list
// in order. Override with TAKAR_LLM_MODELS (comma separated), e.g. a paid model
// once the OpenRouter key has credits and its own spend limit.
const FREE_MODELS = ["nvidia/nemotron-3-ultra-550b-a55b:free", "nvidia/nemotron-3.5-super-vl:free", "inclusionai/ling-3.2-flash:free", "google/gemma-4-31b-it:free"];

/** OpenRouter chat call that falls through the model list on 429 / 5xx. */
export function openrouter({ key = process.env.OPENROUTER_API_KEY, models = (process.env.TAKAR_LLM_MODELS ?? "").split(",").filter(Boolean), fetchImpl = fetch } = {}) {
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  const list = models.length ? models : FREE_MODELS;
  return async (prompt) => {
    let last = 0;
    for (const model of list) {
      const res = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "https://github.com/PugarHuda/takar", "X-Title": "Takar Outcome" },
        body: JSON.stringify({ model, temperature: 0, max_tokens: 2000, messages: [{ role: "user", content: prompt }] }),
        signal: AbortSignal.timeout(25_000),
      }).catch(() => null);
      if (res?.ok) {
        const content = (await res.json()).choices?.[0]?.message?.content ?? "";
        if (content.trim()) return content;
        last = "empty"; // a reasoning model spent its tokens thinking; try the next one
        continue;
      }
      last = res?.status ?? 0;
      if (res && res.status !== 429 && res.status < 500) break; // auth/billing: another model won't help
    }
    throw Object.assign(new Error(`no model answered (last status ${last})`), { status: 503 });
  };
}
