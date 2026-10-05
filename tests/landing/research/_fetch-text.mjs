import { chromium } from "@playwright/test";
const [url] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try { await page.goto(url, { waitUntil: "networkidle", timeout: 45000 }); } catch {}
await page.waitForTimeout(2500);
console.log(await page.evaluate(() => document.body.innerText));
await browser.close();
