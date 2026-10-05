// Research helper (2026-10-04): renders a page in Chrome and prints the lines
// that match a pattern, with a line of context, for pages that build their
// text with script (pricing tables, feature grids).
// Usage: node tests/landing/research/page-lines.mjs <url> <regex> [clickText]
import { chromium } from "@playwright/test";

const [url, pattern, click] = process.argv.slice(2);
const re = new RegExp(pattern, "i");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
} catch {}
await page.waitForTimeout(2500);
if (click) {
  const loc = page.getByText(new RegExp(`^${click}$`, "i")).first();
  const box = await loc.boundingBox().catch(() => null);
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(1500);
}
const lines = (await page.evaluate(() => document.body.innerText)).split("\n").map((l) => l.trim()).filter(Boolean);
lines.forEach((l, i) => {
  if (re.test(l)) console.log(`${String(i).padStart(4)}: ${lines.slice(Math.max(0, i - 1), i + 3).join(" | ").slice(0, 300)}`);
});
await browser.close();
