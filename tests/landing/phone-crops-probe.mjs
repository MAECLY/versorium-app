// Which file each screenshot draws at each width, and at what scale: the
// full-window shots must switch to their crop below 720px, follow the theme
// (pinned or not), never be blown up past 1.25x, and not shift the layout.
//
//   python3 -m http.server 8730 -d docs   (in another shell)
//   node tests/landing/phone-crops-probe.mjs [baseUrl]
// Screenshots of the three figures at 360 go to /tmp/versorium-landing/crops.

import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const BASE = process.argv[2] ?? "http://localhost:8730";
const OUT = "/tmp/versorium-landing/crops";
await mkdir(OUT, { recursive: true });

const CASES = [
  // [route, width, dpr, variant ("theme-mode" pinned, or "theme-follow:scheme")]
  ["/", 360, 1, "needle-follow:light"],
  ["/", 360, 3, "folio-dark"],
  ["/en/", 375, 2, "quarry-light"],
  ["/en/", 375, 2, "needle-follow:dark"],
  ["/", 600, 2, "needle-light"],
  ["/", 719, 2, "folio-light"],
  ["/en/", 720, 2, "needle-dark"],
  ["/", 768, 2, "quarry-dark"],
  ["/en/", 1280, 1, "folio-follow:dark"],
];

const browser = await chromium.launch({ channel: "chrome" });
let problems = 0;
for (const [route, width, dpr, variant] of CASES) {
  const [themeMode, scheme] = variant.split(":");
  const [theme, mode] = themeMode.split("-");
  const context = await browser.newContext({
    viewport: { width, height: 800 },
    deviceScaleFactor: dpr,
    colorScheme: scheme ?? (mode === "dark" ? "dark" : "light"),
  });
  await context.addInitScript(([t, m]) => {
    localStorage.setItem("versorium.site.theme", t);
    localStorage.setItem("versorium.site.mode", m);
    window.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  }, [theme, mode]);
  const page = await context.newPage();
  await page.goto(BASE + route, { waitUntil: "networkidle" });
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 400) {
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await page.waitForTimeout(30);
  }
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  const rows = await page.evaluate(() =>
    ["hero-shot", "desk-shot", "themes-shot"].map((cls) => {
      const img = document.querySelector(`.${cls} img`);
      const r = img.getBoundingClientRect();
      const file = img.currentSrc.split("/").slice(-1)[0];
      // The file's own proportions: a crop's are on its <source>, a full
      // shot's on the <img>. naturalWidth is density-corrected and rounded.
      const crop = file.includes("-detail-");
      const dims = crop ? img.closest("picture").querySelector("source[data-shot]") : img;
      const fw = Number(dims.getAttribute("width"));
      const fh = Number(dims.getAttribute("height"));
      return {
        cls,
        file,
        drawn: `${Math.round(r.width)}x${Math.round(r.height)}`,
        natural: `${img.naturalWidth}x${img.naturalHeight}`,
        ratioOk: Math.abs(r.height - (r.width * fh) / fw) < 1,
        scale: +(r.width / fw).toFixed(2),
      };
    }),
  );
  const cls = await page.evaluate(() => window.__cls);
  const theme_ = await page.evaluate(() => document.documentElement.dataset.theme);
  console.log(`${route} ${width}@${dpr}x ${variant} -> ${theme_}  cls=${cls.toFixed(4)}`);
  for (const row of rows) {
    const wantCrop = width < 720;
    const isCrop = row.file.includes("-detail-");
    const wantVariant = theme_;
    const bad = [];
    if (wantCrop !== isCrop) bad.push(wantCrop ? "full window on a phone" : "crop on a wide screen");
    if (!row.file.includes(wantVariant)) bad.push(`not ${wantVariant}`);
    if (row.cls === "themes-shot" && mode !== "follow" && !row.file.includes("pinned")) bad.push("not the pinned set");
    if (row.cls === "themes-shot" && mode === "follow" && row.file.includes("pinned")) bad.push("pinned set while following");
    if (!row.ratioOk) bad.push("aspect ratio differs from the file");
    if (isCrop && row.scale > 1.26) bad.push(`blown up ${row.scale}x`);
    if (cls > 0.001) bad.push("layout shift");
    problems += bad.length;
    console.log(`   ${row.cls.padEnd(12)} ${row.file.padEnd(44)} drawn ${row.drawn.padEnd(9)} natural ${row.natural.padEnd(9)} scale ${row.scale}${bad.length ? "  <-- " + bad.join("; ") : ""}`);
  }
  if (width === 360) {
    for (const cls of ["hero-shot", "desk-shot", "themes-shot"]) {
      const fig = page.locator(`.${cls}`);
      await fig.scrollIntoViewIfNeeded();
      await fig.screenshot({ path: `${OUT}/${route === "/" ? "es" : "en"}-${width}-${themeMode}-${cls}.png` });
    }
  }
  await context.close();
}
await browser.close();
console.log(problems ? `${problems} problem(s)` : "every crop is where it should be");
process.exitCode = problems ? 1 : 0;
