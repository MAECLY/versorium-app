// Research helper (2026-10-04, comparison build): prints the links of a page
// whose text or address matches a pattern (to find a vendor's terms page).
//   node tests/landing/research/link-texts.mjs <url> [regex]
import { chromium } from "@playwright/test";
const [url, pattern = "terms|privacy|legal|licen"] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
try { await page.goto(url, { waitUntil: "networkidle", timeout: 40000 }); } catch {}
await page.waitForTimeout(1500);
const re = new RegExp(pattern, "i");
console.log((await page.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => `${a.textContent.trim()} -> ${a.href}`))).filter((s) => re.test(s)).join("\n"));
await browser.close();
