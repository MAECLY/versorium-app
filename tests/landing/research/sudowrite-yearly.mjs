// Research helper (2026-10-04): reads Sudowrite's pricing in both billing
// modes. Screenshots the toggle as the page loads, then clicks "Monthly" and
// "Yearly" in turn with a real pointer, printing the prices shown after each
// and saving screenshots to /tmp/versorium-landing/research/.
// Usage: node tests/landing/research/sudowrite-yearly.mjs
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const OUT = "/tmp/versorium-landing/research";
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await page.goto("https://sudowrite.com/pricing", { waitUntil: "networkidle", timeout: 45000 });
} catch {}
await page.waitForTimeout(3000);
const prices = () =>
  page.evaluate(() =>
    document.body.innerText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /\$\s?\d|per (month|year)|billed|annual/i.test(l))
      .slice(0, 20),
  );
const shot = async (name) => {
  const box = await page.getByText(/^Monthly$/).first().boundingBox();
  await page.screenshot({ path: `${OUT}/${name}.png`, clip: { x: 200, y: Math.max(0, (box?.y ?? 300) - 40), width: 1040, height: 560 } });
};
console.log("LOAD", JSON.stringify(await prices()));
await shot("sudowrite-load");
for (const label of ["Monthly", "Yearly", "Monthly"]) {
  const box = await page.getByText(new RegExp(`^${label}$`)).first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(2000);
  console.log(`AFTER ${label}`, JSON.stringify(await prices()));
  await shot(`sudowrite-after-${label.toLowerCase()}`);
}
await browser.close();
