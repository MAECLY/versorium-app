// Research only: screenshots the first screen (desktop and phone) of
// competitor landing pages, plus a rendered word count of <main>/<body>
// and the hero's media, for the redesign teardown.
//   node tests/landing/research/competitor-heroes.mjs [outDir]
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const out = process.argv[2] ?? "/tmp/versorium-redesign/comp/shots";
mkdirSync(out, { recursive: true });
const sites = {
  scrivener: "https://www.literatureandlatte.com/scrivener/overview",
  ulysses: "https://ulysses.app/",
  ia: "https://ia.net/writer",
  obsidian: "https://obsidian.md/",
  novelcrafter: "https://www.novelcrafter.com/",
  sudowrite: "https://sudowrite.com/",
  atticus: "https://www.atticus.io/",
  plottr: "https://plottr.com/",
  manuskript: "https://www.theologeek.ch/manuskript/",
  bibisco: "https://bibisco.com/",
  dabble: "https://www.dabblewriter.com/",
  reedsy: "https://reedsy.com/write-a-book",
  livingwriter: "https://livingwriter.com/",
};
const browser = await chromium.launch({ channel: "chrome", headless: true });
const report = {};
for (const [name, url] of Object.entries(sites)) {
  for (const [tag, vp] of [["desk", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: "load", timeout: 45000 });
      await page.waitForTimeout(3500);
      await page.screenshot({ path: `${out}/${name}-${tag}.png` });
      if (tag === "desk") {
        report[name] = await page.evaluate(() => {
          const root = document.querySelector("main") ?? document.body;
          const words = (root.innerText || "").split(/\s+/).filter(Boolean).length;
          const bodyWords = (document.body.innerText || "").split(/\s+/).filter(Boolean).length;
          const h1 = [...document.querySelectorAll("h1")].map((h) => h.innerText.trim()).filter(Boolean).slice(0, 3);
          const fold = [...document.querySelectorAll("video,img,canvas,iframe,lottie-player,svg")]
            .filter((e) => { const r = e.getBoundingClientRect(); return r.top < 900 && r.width * r.height > 60000; })
            .map((e) => `${e.tagName.toLowerCase()} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)} ${(e.currentSrc || e.src || "").slice(0, 90)}${e.autoplay ? " autoplay" : ""}`);
          const height = document.documentElement.scrollHeight;
          return { words, bodyWords, h1, fold, height };
        });
        const reqs = [];
      }
    } catch (e) {
      report[name] = { error: String(e).slice(0, 200) };
    }
    await ctx.close();
  }
}
await browser.close();
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
