// The theme picker, used live on a phone: every crop has to follow it (the
// Restore recording's still, the corkboard and the Focus crops), the phone
// breakpoint has to bring the full windows back, and nothing may shift.
//
//   python3 -m http.server 8730 -d docs   (in another shell)
//   node tests/landing/phone-crops-switch.mjs [baseUrl]

import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:8730";
const FIGURES = ["s-restore", "step-fig-cork", "step-fig-focus"];
const SHOTS = ["restore", "corkboard", "focus"];
const browser = await chromium.launch({ channel: "chrome" });
let problems = 0;

for (const [lang, route] of [["es", "/"], ["en", "/en/"]]) {
  // Reduced motion, so the Restore figure keeps its still (no clip swap).
  const context = await browser.newContext({ viewport: { width: 375, height: 780 }, deviceScaleFactor: 2, colorScheme: "light", reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(BASE + route, { waitUntil: "networkidle" });
  const files = () => page.evaluate((figures) => figures.map((c) => document.querySelector(`.${c} img`).currentSrc.split("/").pop()), FIGURES);
  const expect = async (label, crop, variant) => {
    const want = SHOTS.map((s) => `${s}${crop ? "-detail" : ""}-${variant}`);
    try {
      await page.waitForFunction(
        ({ figures, want }) => figures.every((c, i) => document.querySelector(`.${c} img`).currentSrc.split("/").pop().startsWith(want[i] + ".") || document.querySelector(`.${c} img`).currentSrc.split("/").pop().startsWith(want[i] + "@")),
        { figures: FIGURES, want },
        { timeout: 5000 },
      );
      console.log(`${lang} ${label}: ${(await files()).join(" | ")}`);
    } catch {
      problems += 1;
      console.log(`${lang} ${label}: ${(await files()).join(" | ")}  <-- wanted ${want.join(" | ")}`);
    }
  };
  for (const c of FIGURES) await page.locator(`.${c}`).scrollIntoViewIfNeeded();
  await expect("default", true, "needle-light");
  await page.locator("#theme-picker").scrollIntoViewIfNeeded();
  await page.locator('#theme-picker input[value="quarry"]').check();
  await expect("Quarry", true, "quarry-light");
  await page.locator('#theme-picker input[value="dark"]').check();
  await expect("Quarry, Dark", true, "quarry-dark");
  await page.locator('#theme-picker input[value="folio"]').check();
  await expect("Folio, Dark", true, "folio-dark");
  await page.locator('#theme-picker input[value="follow"]').check();
  await expect("Folio, following light", true, "folio-light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect("Folio, following dark", true, "folio-dark");
  // Widening past the phone breakpoint brings the full windows back.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect("1280, Folio, following dark", false, "folio-dark");
  await context.close();
}
await browser.close();
console.log(problems ? `${problems} problem(s)` : "the crops follow the picker");
process.exitCode = problems ? 1 : 0;
