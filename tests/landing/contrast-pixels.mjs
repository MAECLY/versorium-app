// Contrast measured on the pixels actually behind the text (site spec §12.5),
// which the DOM audit in verify.mjs cannot see: the paper grain, the lamp
// behind the hero window, the accent band. For each element, in all six
// variants at 375 and 1440: the text is made transparent (and its own dots and
// underlines hidden), its box is screenshotted, and the text colour is
// compared with every pixel left; the worst one counts. Text needs 4.5:1, or
// 3:1 from 24px. Also: "Guardado" in the app window (--ok on --bg-app) needs
// 3:1, and the S4 annotations are reported against what they are drawn over.
//
// Injects a stylesheet, so the context bypasses the page's CSP (tests only).
//   SITE_URL=http://localhost:8742 node tests/landing/contrast-pixels.mjs [--route /en/]

import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const route = args.includes("--route") ? args[args.indexOf("--route") + 1] : "/";
const SITE = process.env.SITE_URL ?? "http://localhost:8700";
const VARIANTS = ["folio-light", "folio-dark", "quarry-light", "quarry-dark", "needle-light", "needle-dark"];
const SELECTORS = [
  ".pill",
  "h1",
  ".sub",
  ".hero .assure",
  ".picker-label",
  ".hero-figure .caption-row > span",
  ".stage figcaption",
  ".s-restore .caption-row > span",
  ".s-head .lead",
  ".dial-labels li",
  ".tile p",
  ".step-text p",
  ".step-text .small",
  ".chips",
  ".hint",
  ".files-os",
  ".file",
  ".file-meta",
  ".limits li",
  ".faq summary",
  ".closing h2",
  ".closing .assure",
  ".closing .btn",
  ".footer .proof",
  ".footer .legal p",
  ".tagline",
  // The comparison (IV): caption, hint, the slip and the other columns, the
  // ledger amounts, second lines, the notes and links under the table.
  ".vs-cap",
  ".vs-hint",
  ".vs thead th",
  ".vs thead small",
  ".vs tbody th",
  ".vs tbody td",
  ".vs td.is-us",
  ".vs tbody tr:nth-child(4) td",
  ".vs tbody small",
  ".vs-num",
  ".vs-notes p",
  ".vs-more a",
];

const DIR = "/tmp/versorium-landing/contrast";
await mkdir(DIR, { recursive: true });
// Screenshots are measured afterwards by Python (PIL), in one pass.
const jobs = [];
let shotN = 0;
async function save(buffer) {
  const file = `${DIR}/${String(shotN++).padStart(5, "0")}.png`;
  await writeFile(file, buffer);
  return file;
}

const HIDE = `
.__probe, .__probe * { color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; }
.__probe .pill-dot, .__probe .os-dot, .__probe .ink-under, .__probe::before, .__probe::after, .__probe *::before, .__probe *::after { visibility: hidden !important; }
.annot.__off { visibility: hidden !important; }
.__probe .vs-ring, .__probe .vs-dash, .__probe .vmark { visibility: hidden !important; }
.topbar, .ribbon-well { visibility: hidden !important; }
`;

const browser = await chromium.launch({ channel: "chrome", headless: true });
const problems = [];
let measured = 0;
try {
  for (const variant of VARIANTS) {
    const [theme, mode] = variant.split("-");
    for (const width of [375, 1440]) {
      const context = await browser.newContext({
        viewport: { width, height: width < 700 ? 812 : 900 },
        deviceScaleFactor: 1,
        colorScheme: mode,
        reducedMotion: "reduce",
        bypassCSP: true,
      });
      await context.addInitScript(({ theme, mode }) => {
        localStorage.setItem("versorium.site.theme", theme);
        localStorage.setItem("versorium.site.mode", mode);
      }, { theme, mode });
      const page = await context.newPage();
      await page.goto(SITE + route, { waitUntil: "networkidle" });
      await page.addStyleTag({ content: HIDE });
      for (const selector of SELECTORS) {
        const handles = await page.$$(selector);
        for (const handle of handles.slice(0, 3)) {
          const info = await handle.evaluate((el) => {
            const cs = getComputedStyle(el);
            const visible = cs.display !== "none" && cs.visibility === "visible" && el.getBoundingClientRect().width > 0;
            // color-mix() computes to color(srgb r g b) with channels from 0 to 1.
            const m = cs.color.match(/-?\d*\.?\d+/g).map(Number);
            const colour = cs.color.startsWith("color(") ? m.slice(0, 3).map((v) => Math.round(v * 255)) : m.slice(0, 3);
            return { visible, colour, size: parseFloat(cs.fontSize), bold: Number(cs.fontWeight) >= 700, text: el.textContent.trim().slice(0, 30) };
          });
          if (!info.visible) continue;
          await handle.scrollIntoViewIfNeeded();
          await handle.evaluate((el) => el.classList.add("__probe"));
          // Inside its border and rounded corners: only what is behind the text.
          const clip = await handle.evaluate((el) => {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            // Past the rounded ends (a pill's radius is half its height), inside the border.
            const border = parseFloat(cs.borderTopWidth) || 0;
            const radius = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, r.height / 2);
            const across = Math.ceil(border + radius) + 1;
            const down = Math.ceil(border) + 1;
            const x = Math.max(0, r.left + across);
            const y = Math.max(0, r.top + down);
            const right = Math.min(innerWidth, r.right - across);
            const bottom = Math.min(innerHeight, r.bottom - down);
            return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
          });
          let shot;
          try {
            shot = await save(await page.screenshot({ clip }));
          } catch (e) {
            problems.push(`${variant} ${width} ${selector} "${info.text}": could not be measured (${JSON.stringify(clip)})`);
            await handle.evaluate((el) => el.classList.remove("__probe"));
            continue;
          }
          await handle.evaluate((el) => el.classList.remove("__probe"));
          const need = info.size >= 24 || (info.size >= 18.66 && info.bold) ? 3 : 4.5;
          measured += 1;
          jobs.push({ kind: "text", file: shot, colour: info.colour, need, label: `${variant} ${width} ${selector} "${info.text}"` });
        }
      }
      // "Guardado" in the app window: --ok on --bg-app, 3:1 (it is part of a picture).
      const saved = await page.$(".r-save-label .is-saved");
      if (saved) {
        const colour = await saved.evaluate((el) => getComputedStyle(el).color.match(/\d+/g).map(Number).slice(0, 3));
        await saved.scrollIntoViewIfNeeded();
        await saved.evaluate((el) => el.classList.add("__probe"));
        const file = await save(await saved.screenshot());
        await saved.evaluate((el) => el.classList.remove("__probe"));
        measured += 1;
        jobs.push({ kind: "text", file, colour, need: 3, label: `${variant} ${width} replica "Guardado"` });
      }
      // The S4 annotations, against what they are drawn over: report the 5th percentile.
      if (width === 1440) {
        for (const fig of [".step-fig-cork", ".step-fig-focus"]) {
          const box = await page.$(`${fig} .window`);
          await box.scrollIntoViewIfNeeded();
          await page.waitForTimeout(150);
          const on = await save(await box.screenshot());
          await page.$eval(`${fig} .annot`, (el) => el.classList.add("__off"));
          const off = await save(await box.screenshot());
          await page.$eval(`${fig} .annot`, (el) => el.classList.remove("__off"));
          const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
          const rgb = accent.match(/[0-9a-f]{2}/gi).map((h) => parseInt(h, 16));
          jobs.push({ kind: "annot", on, off, colour: rgb, label: `${variant} ${fig} annotation` });
        }
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}
await writeFile(`${DIR}/jobs.json`, JSON.stringify(jobs));
const results = JSON.parse(
  execFileSync("python3", ["-c", `
import json
from PIL import Image
def lum(c):
    def f(v):
        s = v / 255
        return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
def ratio(a, b):
    x, y = sorted([lum(a), lum(b)], reverse=True)
    return (x + 0.05) / (y + 0.05)
out = []
for job in json.load(open("${DIR}/jobs.json")):
    if job["kind"] == "text":
        colours = Image.open(job["file"]).convert("RGB").getcolors(1 << 24)
        out.append(min(ratio(job["colour"], c) for _, c in colours))
    else:
        on = Image.open(job["on"]).convert("RGB"); off = Image.open(job["off"]).convert("RGB")
        rs = sorted(ratio(job["colour"], b) for a, b in zip(on.get_flattened_data(), off.get_flattened_data()) if sum(abs(p - q) for p, q in zip(a, b)) > 60)
        out.append(rs[len(rs) // 20] if rs else 0)
print(json.dumps(out))
`], { maxBuffer: 1 << 26 }).toString(),
);
jobs.forEach((job, i) => {
  const need = job.kind === "text" ? job.need : 3;
  if (results[i] < need) problems.push(`${job.label}: ${results[i].toFixed(2)} < ${need}${job.kind === "annot" ? " (5th percentile of the stroke)" : ""}`);
});
console.log(`${route}: ${measured} boxes measured`);
if (problems.length) {
  console.log(`${problems.length} problem(s):`);
  for (const p of problems) console.log(" -", p);
  process.exitCode = 1;
} else {
  console.log("every text has its contrast on the pixels behind it");
}
