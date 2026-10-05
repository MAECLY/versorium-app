// Research helper (2026-10-04, comparison build): renders a page in Chrome and
// prints the passages of its whole textContent (hidden tabs included) that
// match a pattern, with context.
//   node tests/landing/research/page-textcontent.mjs <url> <regex> [context=160]
import { chromium } from "@playwright/test";
const [url, pattern, ctx = "160"] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try { await page.goto(url, { waitUntil: "networkidle", timeout: 45000 }); } catch {}
await page.waitForTimeout(3000);
const t = await page.evaluate(() => document.body.textContent.replace(/\s+/g, " "));
const re = new RegExp(`.{0,${ctx}}(?:${pattern}).{0,${ctx}}`, "gi");
for (const m of t.matchAll(re)) console.log("-", m[0]);
await browser.close();
