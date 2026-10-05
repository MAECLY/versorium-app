// Research helper (2026-10-04): opens the iOS tab of Scrivener's store and
// prints what it says about the iOS price and where it is sold.
// Usage: node tests/landing/research/scrivener-ios.mjs
import { chromium } from "@playwright/test";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await page.goto("https://www.literatureandlatte.com/store/scrivener", { waitUntil: "networkidle", timeout: 45000 });
} catch {}
await page.waitForTimeout(2500);
const tabs = await page.evaluate(() =>
  [...document.querySelectorAll("a, button, li, [role=tab]")]
    .filter((e) => /^(macOS|Windows|iOS|Bundles)$/.test(e.textContent.trim()))
    .map((e) => `${e.tagName} ${e.getAttribute("href") || ""} ${e.textContent.trim()}`),
);
console.log(tabs.join("\n"));
const box = await page.evaluate(() => {
  const all = [...document.querySelectorAll("body *")].filter((e) => e.childElementCount === 0 && e.textContent.trim() === "iOS");
  const el = all[0];
  if (!el) return null;
  el.scrollIntoView({ block: "center" });
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, tag: el.tagName, cls: String(el.className).slice(0, 60) };
});
console.log("iOS element", JSON.stringify(box));
if (box) await page.mouse.click(box.x, box.y);
await page.waitForTimeout(2000);
const lines = (await page.evaluate(() => document.body.innerText)).split("\n").map((l) => l.trim()).filter(Boolean);
lines.forEach((l, i) => {
  if (/US\$|iOS|App Store|iPad|iPhone/i.test(l)) console.log(`${i}: ${l.slice(0, 200)}`);
});
const links = await page.evaluate(() => [...document.querySelectorAll("a[href*='apps.apple.com']")].map((a) => a.href));
console.log("app store links", links.join(" "));
await browser.close();
