// Research helper for the comparison section (2026-10-04): render vendor
// pricing pages whose prices are injected by script and print the lines that
// carry a price, so research.md can cite what the vendor's own page shows.
// Usage: node tests/landing/research/comparison-prices.mjs [url ...]
import { chromium } from "@playwright/test";

const urls = process.argv.slice(2).length ? process.argv.slice(2) : [
  "https://reedsy.com/studio/pricing/",
  "https://sudowrite.com/pricing",
  "https://www.novelcrafter.com/pricing",
  "https://www.notion.com/pricing",
  "https://www.dabblewriter.com/pricing",
  "https://novelai.net/",
];

const browser = await chromium.launch({ channel: "chrome", headless: true });
for (const url of urls) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  } catch {
    // A page that never goes idle still has its prices drawn by now.
  }
  await page.waitForTimeout(2500);
  // COMPARISON_TOGGLE="Yearly" clicks a billing toggle first, to read annual prices.
  if (process.env.COMPARISON_TOGGLE) {
    const toggle = page.getByText(new RegExp(`^${process.env.COMPARISON_TOGGLE}$`, "i")).first();
    await toggle.click({ timeout: 5000 }).catch(() => console.log("(toggle not found)"));
    await page.waitForTimeout(1500);
  }
  const text = await page.evaluate(() => document.body.innerText);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  console.log(`\n######## ${url}`);
  lines.forEach((line, i) => {
    if (/[$€£]\s?\d|\d\s?(USD|EUR)|\/\s?(mo|month|yr|year)|per (month|year)|annual|yearly|monthly|lifetime|credits/i.test(line)) {
      console.log(`${String(i).padStart(4)}: ${lines.slice(Math.max(0, i - 1), i + 2).join(" | ").slice(0, 260)}`);
    }
  });
  await page.close();
}
await browser.close();
