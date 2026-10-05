// Research helper (2026-10-04, comparison build): renders help-centre pages in
// Chrome and prints only their article text (not the navigation around it),
// to read what a vendor's own documentation says.
//   node tests/landing/research/article-text.mjs <url> [<url> ...]
// SELECTOR=… overrides the guess (article, main, [role=main], body).
import { chromium } from "@playwright/test";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "en-US" });
for (const url of process.argv.slice(2)) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  } catch {
    /* drawn by now */
  }
  await page.waitForTimeout(Number(process.env.WAIT ?? 2000));
  const text = await page.evaluate((sel) => {
    document.querySelectorAll("details").forEach((d) => (d.open = true));
    const pick = sel ? document.querySelector(sel) : document.querySelector("article") || document.querySelector("main") || document.querySelector("[role=main]") || document.body;
    return `${document.title}\n${location.href}\n${(pick || document.body).innerText}`;
  }, process.env.SELECTOR || null);
  console.log(`\n######## ${url}\n${text.split("\n").map((l) => l.trim()).filter(Boolean).join("\n")}`);
  await page.close();
}
await browser.close();
