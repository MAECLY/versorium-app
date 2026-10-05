// Research helper (2026-10-04): renders a page and prints a range of its text
// lines (to read which plan a feature belongs to on a pricing page).
// Usage: node tests/landing/research/page-range.mjs <url> <from> <to> [clickText]
import { chromium } from "@playwright/test";

const [url, from, to, click] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
} catch {}
await page.waitForTimeout(2500);
if (click) {
  const box = await page.getByText(new RegExp(`^${click}$`, "i")).first().boundingBox().catch(() => null);
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(1500);
}
const lines = (await page.evaluate(() => document.body.innerText)).split("\n").map((l) => l.trim()).filter(Boolean);
for (let i = Number(from); i <= Math.min(Number(to), lines.length - 1); i += 1) console.log(`${String(i).padStart(4)}: ${lines[i].slice(0, 160)}`);
await browser.close();
