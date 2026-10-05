// Research helper: prints the struck-through prices on a page (del, s, strike,
// or text-decoration line-through) with their row's text.
import { chromium } from "@playwright/test";
const [url] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try { await page.goto(url, { waitUntil: "networkidle", timeout: 45000 }); } catch {}
await page.waitForTimeout(2500);
const out = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((el) => el.children.length === 0 && /\$\d/.test(el.textContent) && (getComputedStyle(el).textDecorationLine.includes("line-through") || el.closest("del, s, strike"))).map((el) => `${el.textContent.trim()}  <-  ${(el.closest("tr, li, div")?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120)}`));
console.log(out.join("\n") || "(none struck through)");
await browser.close();
