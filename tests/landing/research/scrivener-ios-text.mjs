// Research helper (2026-10-04): searches the whole text of Scrivener's store
// page (hidden tabs included) for its iOS price and App Store wording.
import { chromium } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try { await page.goto("https://www.literatureandlatte.com/store/scrivener", { waitUntil: "networkidle", timeout: 45000 }); } catch {}
await page.waitForTimeout(3000);
const t = await page.evaluate(() => document.body.textContent.replace(/\s+/g, " "));
for (const m of t.matchAll(/.{0,160}(iOS|App Store).{0,160}/g)) console.log("-", m[0]);
await browser.close();
