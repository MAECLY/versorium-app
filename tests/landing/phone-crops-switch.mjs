// The theme picker, used live on a phone: every crop has to follow it, the
// Appearance crop has to switch to its pinned set when Light or Dark is
// pressed and back when Follow system is, and nothing may shift.
//
//   python3 -m http.server 8730 -d docs   (in another shell)
//   node tests/landing/phone-crops-switch.mjs [baseUrl]

import { chromium } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:8730";
const browser = await chromium.launch({ channel: "chrome" });
let problems = 0;

for (const [lang, route] of [["es", "/"], ["en", "/en/"]]) {
  const context = await browser.newContext({ viewport: { width: 375, height: 780 }, deviceScaleFactor: 2, colorScheme: "light" });
  const page = await context.newPage();
  await page.goto(BASE + route, { waitUntil: "networkidle" });
  const files = () =>
    page.evaluate(() =>
      ["hero-shot", "desk-shot", "themes-shot"].map((c) => document.querySelector(`.${c} img`).currentSrc.split("/").pop()),
    );
  const expect = async (label, want) => {
    // currentSrc only changes once the new file is chosen; give it a moment.
    try {
      await page.waitForFunction(
        (want) =>
          ["hero-shot", "desk-shot", "themes-shot"].every((c, i) =>
            document.querySelector(`.${c} img`).currentSrc.split("/").pop().startsWith(want[i]),
          ),
        want,
        { timeout: 5000 },
      );
      console.log(`${lang} ${label}: ${(await files()).join(" | ")}`);
    } catch {
      problems += 1;
      console.log(`${lang} ${label}: ${(await files()).join(" | ")}  <-- wanted ${want.join(" | ")}`);
    }
  };
  // Load every image once so later swaps are measured on a settled page.
  for (const c of ["hero-shot", "desk-shot", "themes-shot"]) await page.locator(`.${c}`).scrollIntoViewIfNeeded();
  await expect("default", ["editor-detail-needle-light", "corkboard-detail-needle-light", "settings-detail-needle-light"]);
  await page.locator("#theme-picker").scrollIntoViewIfNeeded();
  await page.locator('#theme-picker input[value="quarry"]').check();
  await expect("Quarry", ["editor-detail-quarry-light", "corkboard-detail-quarry-light", "settings-detail-quarry-light"]);
  await page.locator('#theme-picker input[value="dark"]').check();
  await expect("Quarry, Dark", ["editor-detail-quarry-dark", "corkboard-detail-quarry-dark", "settings-pinned-detail-quarry-dark"]);
  await page.locator('#theme-picker input[value="folio"]').check();
  await expect("Folio, Dark", ["editor-detail-folio-dark", "corkboard-detail-folio-dark", "settings-pinned-detail-folio-dark"]);
  await page.locator('#theme-picker input[value="follow"]').check();
  await expect("Folio, following light", ["editor-detail-folio-light", "corkboard-detail-folio-light", "settings-detail-folio-light"]);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect("Folio, following dark", ["editor-detail-folio-dark", "corkboard-detail-folio-dark", "settings-detail-folio-dark"]);
  const alt = await page.evaluate(() => document.querySelector(".themes-shot img").alt);
  if (!alt.includes("Folio")) {
    problems += 1;
    console.log(`${lang} alt does not name Folio: ${alt}`);
  }
  // Widening past the phone breakpoint brings the full windows back.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect("1280, Folio, following dark", ["editor-folio-dark", "corkboard-folio-dark", "settings-folio-dark"]);
  await context.close();
}
await browser.close();
console.log(problems ? `${problems} problem(s)` : "the crops follow the picker");
process.exitCode = problems ? 1 : 0;
