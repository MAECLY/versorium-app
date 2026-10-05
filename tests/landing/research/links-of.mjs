// Research helper (2026-10-04): prints the links on a rendered page whose text
// or address matches a pattern (to find a vendor's terms, privacy or help pages).
// Usage: node tests/landing/research/links-of.mjs <url> <regex>
import { chromium } from "@playwright/test";

const [url, pattern] = process.argv.slice(2);
const re = new RegExp(pattern, "i");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
} catch {}
await page.waitForTimeout(2000);
const links = await page.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => [a.textContent.trim().replace(/\s+/g, " "), a.href]));
for (const [t, h] of links) if (re.test(t) || re.test(h)) console.log(`${t.slice(0, 60)} -> ${h}`);
await browser.close();
