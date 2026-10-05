// Research helper (2026-10-04, comparison build): lists the links to terms,
// licence and privacy pages that a vendor's page renders (they are often
// drawn by script), to find the page behind an open-source "No".
//   node tests/landing/research/legal-links.mjs <url> [<url> ...]
import { chromium } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
for (const url of process.argv.slice(2)) {
  try { await page.goto(url, { waitUntil: "networkidle", timeout: 40000 }); } catch {}
  await page.waitForTimeout(1500);
  const links = await page.evaluate(() => [...new Set([...document.querySelectorAll("a[href]")].map((a) => a.href).filter((h) => /terms|legal|eula|licen|privacy/i.test(h)))]);
  console.log("##", url, "\n" + links.join("\n"));
}
await browser.close();
