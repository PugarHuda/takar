// Trade Assurance video: voice-over + clip recording.
//   node make-trade.mjs vo     -> public/vo/<id>.mp3 via edge-tts, writes src-trade-scenes.json with voSec
//   node make-trade.mjs clips  -> records public/trade-*.webm from the live page, each as long as its scene
// Then: npx remotion render src/index.jsx Trade out/trade.mp4 --codec h264
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const VOICE = "en-US-AndrewNeural";
const PAGE = "https://takar-telegraph.vercel.app/trade.html";
const TX = "https://eth-sepolia.blockscout.com/tx/0x78876aca83f2827a587d7dadafe1248fefa0839c3eb84b5aa9e39626f8d3a6c5";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PAD = 0.8; // must match index.jsx

if (process.argv[2] === "vo") {
  const scenes = JSON.parse(readFileSync("trade-scenes.json", "utf8"));
  for (const s of scenes) {
    execFileSync("python", ["-m", "edge_tts", "-v", VOICE, "--rate=+4%", "-t", s.vo, "--write-media", `public/vo/${s.id}.mp3`]);
    s.voSec = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", `public/vo/${s.id}.mp3`]).toString().trim());
    console.log(s.id, s.voSec.toFixed(1), "s");
  }
  writeFileSync("src-trade-scenes.json", JSON.stringify(scenes, null, 2) + "\n");
  console.log("total", scenes.reduce((a, s) => a + s.voSec + PAD, 0).toFixed(0), "s");
}

if (process.argv[2] === "clips") {
  const scenes = Object.fromEntries(JSON.parse(readFileSync("src-trade-scenes.json", "utf8")).map((s) => [s.clip, s]));
  // Which part of the page each clip pans across: [first step heading text, step index within the case, last step index].
  const PANS = {
    "trade-c1a.webm": [0, 0, 1], // case 1: lock, first rounds at sea
    "trade-c1b.webm": [0, 3, 5], // case 1: berthed, invoice miners disagree
    "trade-c1c.webm": [0, 6, 9], // case 1: panel → Praman → settled
    "trade-c2a.webm": [1, 0, 1], // case 2: lock, partial proposal
    "trade-c2b.webm": [1, 3, 5], // case 2: dispute, re-check, Takar seats
    "trade-c2c.webm": [1, 6, 8], // case 2: waiting, Praman, settled
    "trade-c3.webm": [2, 0, 3], // case 3: lock, two unusable rounds, HOLD at sea
  };
  mkdirSync("rec", { recursive: true });
  const b = await chromium.launch({ executablePath: CHROME, headless: true });
  const rec = async (name, act) => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, recordVideo: { dir: "rec", size: { width: 1280, height: 720 } } });
    const p = await ctx.newPage();
    const secs = scenes[name].voSec + PAD + 1.5; // a little extra; Remotion trims to the scene length
    await act(p, secs * 1000);
    const v = p.video(); await ctx.close();
    renameSync(await v.path(), `public/${name}`);
    console.log(name, secs.toFixed(1), "s");
  };
  const load = async (p) => { await p.goto(PAGE, { waitUntil: "domcontentloaded" }); await p.waitForSelector("#cases section h2", { timeout: 60000 }); await p.waitForTimeout(1500); };
  const glide = (p, from, to, ms) => p.evaluate(([a, z, ms]) => new Promise((done) => {
    const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / ms); const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; scrollTo(0, a + (z - a) * e); k < 1 ? requestAnimationFrame(step) : done(); };
    requestAnimationFrame(step);
  }), [from, to, ms]);
  for (const [name, [c, i0, i1]] of Object.entries(process.argv[3] === "tx" ? {} : PANS)) {
    await rec(name, async (p, ms) => {
      await load(p);
      const ys = await p.$$eval("#cases section", (ss, c) => [ss[c].getBoundingClientRect().top + scrollY, ...[...ss[c].querySelectorAll("ol.time > li")].map((li) => li.getBoundingClientRect().top + scrollY)], c);
      const lis = await p.$$eval("#cases section", (ss, [c, i1]) => { const li = ss[c].querySelectorAll("ol.time > li")[i1]; return li.getBoundingClientRect().top + scrollY + li.getBoundingClientRect().height; }, [c, i1]);
      const start = (i0 === 0 ? ys[0] : ys[i0 + 1]) - 40;
      const end = Math.max(start, lis - 660);
      await p.evaluate((y) => scrollTo(0, y), start);
      await p.waitForTimeout(1500);
      await glide(p, start, end, ms - 3000);
      await p.waitForTimeout(1500);
    });
  }
  await rec("trade-tx.webm", async (p, ms) => {
    await p.goto(TX, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(5000);
    // Hide the explorer's sponsored slot (a casino ad has no place in a trade demo).
    await p.evaluate(() => {
      for (const el of document.querySelectorAll("iframe")) el.remove();
      for (const el of [...document.querySelectorAll("div,span")].filter((e) => e.childElementCount <= 2 && e.textContent.trim() === "Sponsored")) {
        const row = el.closest("[class*='Grid'], [class*='grid']") ? el.parentElement : el;
        el.style.display = "none"; if (row.nextElementSibling) row.nextElementSibling.style.display = "none"; row.style.display = "none";
      }
      for (const img of document.querySelectorAll("img")) if (img.naturalWidth > 300) img.closest("a")?.remove();
    });
    await p.waitForTimeout(Math.max(0, Math.min(ms, 7000) - 5000));
    await glide(p, 0, 700, Math.max(1000, ms - 7000));
  });
  await b.close();
}
