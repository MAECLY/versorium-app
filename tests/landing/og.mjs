// The link-preview images: docs/assets/og.png (Spanish, the x-default page)
// and docs/assets/og-en.png, 1200x630, in Needle Light (site spec §9.4).
//
// Composed from the landing page itself, nothing drawn for the card: the H1
// with its ink underline, the reassurance line and the hero's app window are
// copied from the served page loaded with JavaScript off, so the window is in
// its final state (the typed sentence there, "Guardado", the dot at rest), and
// set beside the pen-written V. The page's own stylesheet styles all of it;
// this generator page is never served, so it may use an inline <style>.
//
// Needs the docs/ server up and the new page built (it fails, saying so, if
// the served page has no .replica yet):
//   python3 -m http.server 8700 -d docs
//   node tests/landing/og.mjs            # SITE_URL=http://localhost:8741 to use another port

import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const SITE = process.env.SITE_URL ?? "http://localhost:8700";
const PAGES = {
  es: { route: "/", file: "og.png" },
  en: { route: "/en/", file: "og-en.png" },
};
// The window: the app's minimum size, 1024x640, scaled to 0.62 (site spec §9.4).
const WINDOW_SCALE = 0.62;

// The mark with its nib, as VMark.svelte draws it at 40px and above; the slit
// and breather hole are cut back to the page colour.
const MARK = `<svg class="og-v" viewBox="0 0 100 100" aria-hidden="true">
<path class="v-ink" d="M23.6 21.0L25.2 26.0L26.8 31.0L28.4 36.0L30.1 41.1L31.9 46.2L33.7 51.3L35.5 56.5L38.3 61.3L41.1 66.1L44.0 71.0L46.9 75.9L49.9 80.8L51.7 80.0L49.9 74.5L48.2 69.1L46.5 63.8L44.8 58.4L43.2 53.2L40.7 48.3L38.3 43.5L35.9 38.7L33.6 33.9L31.3 29.2L29.0 24.5L26.8 19.8Z"/>
<path class="v-ink hair" d="M52.5 81.4L54.7 77.7L56.8 73.9L58.8 70.1L60.8 66.2L62.8 62.4L64.8 58.5L66.7 54.6L68.5 50.7L70.4 46.7L72.2 42.7L74.0 38.7L74.5 37.4L72.1 36.3L71.5 37.6L69.7 41.6L67.8 45.5L65.9 49.3L63.9 53.2L61.9 57.0L59.8 60.8L57.8 64.6L55.6 68.3L53.5 72.0L51.3 75.7L49.1 79.4Z"/>
<path class="v-ink" d="M72.0 40.1L79.5 33.5L82.4 23.3L76.6 20.9L71.4 30.2Z"/>
<path class="v-cut" d="M73.5 36.6L77.2 27.7" fill="none" stroke-width="2.4" stroke-linecap="round"/>
<circle class="v-hole" cx="77.2" cy="27.7" r="1.7"/>
</svg>`;

/** The pieces of the served page the card is made of, read with JavaScript off. */
async function grab(browser, lang) {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await context.newPage();
  const url = `${SITE}${PAGES[lang].route}`;
  await page.goto(url);
  const parts = await page.evaluate(() => {
    const replica = document.querySelector(".replica");
    const h1 = document.querySelector("h1");
    if (!replica || !h1) return null;
    const assure = document.querySelector(".hero .assure");
    const defs = document.getElementById("nib-stroke")?.closest("svg");
    return {
      replica: replica.outerHTML,
      h1: h1.outerHTML,
      assure: assure ? assure.textContent.replace(/\s+/g, " ").trim() : "",
      defs: defs ? defs.outerHTML : "",
    };
  });
  await context.close();
  if (!parts) throw new Error(`${url} has no .replica or no h1: build the new landing page first (site spec §5.2, §6)`);
  return parts;
}

function card(lang, parts) {
  return `<!doctype html>
<html lang="${lang}" data-theme="needle-light">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="${SITE}/assets/site.css">
<style>
  @font-face { font-family: "Aguja Display"; src: url("${SITE}/assets/fonts/aguja-display-400.woff2") format("woff2"); font-display: block; }
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
  html body { position: relative; background: var(--bg-editor); background-image: none !important; }
  .og-text { position: absolute; left: 64px; top: 0; bottom: 0; width: 560px; display: flex; flex-direction: column; justify-content: center; }
  .og-v { display: block; width: 76px; height: 76px; margin-left: -10px; }
  .og-v .v-ink { fill: var(--accent); }
  .og-v .hair { opacity: .78; }
  .og-v .v-cut { stroke: var(--bg-editor); }
  .og-v .v-hole { fill: var(--bg-editor); }
  .og-text h1 { margin: 16px 0 0; font-family: "Aguja Display", var(--font-page); font-weight: 400; font-size: 76px;
                line-height: 1; letter-spacing: -0.02em; color: var(--text); text-wrap: balance; }
  .og-text .og-assure { margin: 28px 0 0; font: 20px/1.4 var(--font-ui); color: var(--text-mute); }
  .og-window { position: absolute; left: 640px; top: 92px; width: ${Math.round(1024 * WINDOW_SCALE)}px; }
</style>
</head>
<body>
${parts.defs}
<div class="og-text">${MARK}${parts.h1}<p class="og-assure">${parts.assure}</p></div>
<div class="og-window"><div class="replica-frame">${parts.replica}</div></div>
</body>
</html>`;
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const lang of Object.keys(PAGES)) {
    const parts = await grab(browser, lang);
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    // On the site's own origin first, so the font is a same-origin request
    // (from about:blank it is cross-origin, and the static server sends no CORS).
    await page.goto(`${SITE}/robots.txt`);
    await page.setContent(card(lang, parts), { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.load('400 76px "Aguja Display"'));
    const raw = `/tmp/versorium-landing/og-${lang}.png`;
    await page.screenshot({ path: raw });
    await page.close();
    const out = path.join(ROOT, "docs/assets", PAGES[lang].file);
    // 256 colours, with every flat colour of the card kept exact
    // (tests/landing/palette.py): invisible on interface colours and type,
    // and a third of the size.
    execFileSync("python3", [
      "-c",
      `import sys; sys.dont_write_bytecode = True; sys.path.insert(0, ${JSON.stringify(path.join(ROOT, "tests/landing"))})
from PIL import Image
from palette import palette_for
im = Image.open(${JSON.stringify(raw)}).convert("RGB")
assert im.size == (1200, 630), im.size
q = im.quantize(palette=palette_for([im], 256), dither=Image.Dither.NONE)
q.save(${JSON.stringify(out)}, optimize=True)
import os
print(${JSON.stringify(PAGES[lang].file)}, im.size, os.path.getsize(${JSON.stringify(out)}), "bytes")`,
    ], { stdio: "inherit" });
  }
} finally {
  await browser.close();
}
