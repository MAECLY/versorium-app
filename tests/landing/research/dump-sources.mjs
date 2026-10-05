// Research helper (2026-10-04, comparison build): renders every source page
// of comparison-data.mjs in Chrome and saves its visible text, so each cell
// can be checked against what the vendor's page says today.
//   node tests/landing/research/dump-sources.mjs [id,id,...]
// Writes /tmp/versorium-landing/sources/<id>.txt (and <id>.err on failure).
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { SOURCES } from "../comparison-data.mjs";

const OUT = "/tmp/versorium-landing/sources";
await mkdir(OUT, { recursive: true });
const only = process.argv[2]?.split(",");
const ids = Object.keys(SOURCES).filter((id) => !only || only.includes(id));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "en-US" });

async function dump(id) {
  const page = await context.newPage();
  try {
    try {
      await page.goto(SOURCES[id].url, { waitUntil: "networkidle", timeout: 45000 });
    } catch {
      /* a page that never goes idle has drawn its text by now */
    }
    await page.waitForTimeout(2500);
    // Open collapsed FAQ answers and accordions, so their text is read too.
    await page.evaluate(() => {
      document.querySelectorAll("details").forEach((d) => (d.open = true));
    });
    const text = await page.evaluate(() => `${document.title}\n${location.href}\n${document.body.innerText}`);
    await writeFile(`${OUT}/${id}.txt`, text);
    console.log(`${id.padEnd(16)} ${String(text.length).padStart(7)} chars  ${SOURCES[id].url}`);
  } catch (e) {
    await writeFile(`${OUT}/${id}.err`, String(e));
    console.log(`${id.padEnd(16)} FAILED ${e.message.split("\n")[0]}`);
  } finally {
    await page.close();
  }
}

for (let i = 0; i < ids.length; i += 5) await Promise.all(ids.slice(i, i + 5).map(dump));
await browser.close();
