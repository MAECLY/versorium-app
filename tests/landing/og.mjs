// The link-preview images: docs/assets/og.png (Spanish, the x-default page)
// and docs/assets/og-en.png, 1200x630.
//
// Composed from the site's own stylesheet and the real editor capture, so the
// card shows the app and the page's type and colour, nothing drawn for it.
// Needs the docs/ server up (python3 -m http.server 8700 -d docs).
//
//   node tests/landing/og.mjs

import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const SITE = process.env.SITE_URL ?? "http://localhost:8700";

const COPY = {
  es: {
    file: "og.png",
    // Not "de novela local": after "novela", "local" reads as describing the
    // novel. Same line as the page's eyebrow.
    eyebrow: "El estudio de novela en tu ordenador",
    tagline: "Un escritorio tranquilo,<br>una aguja fina.",
    meta: "Libre y de código abierto · macOS, Windows y Linux",
  },
  en: {
    file: "og-en.png",
    eyebrow: "The local novel studio",
    tagline: "A quiet desk,<br>a sharp needle.",
    meta: "Free and open source · macOS, Windows and Linux",
  },
};

// The mark with its nib, as VMark.svelte draws it at 40px and above.
const MARK = `<svg viewBox="0 0 100 100" width="76" height="76" aria-hidden="true">
  <path fill="var(--accent)" d="M23.6 21.0L25.2 26.0L26.8 31.0L28.4 36.0L30.1 41.1L31.9 46.2L33.7 51.3L35.5 56.5L38.3 61.3L41.1 66.1L44.0 71.0L46.9 75.9L49.9 80.8L51.7 80.0L49.9 74.5L48.2 69.1L46.5 63.8L44.8 58.4L43.2 53.2L40.7 48.3L38.3 43.5L35.9 38.7L33.6 33.9L31.3 29.2L29.0 24.5L26.8 19.8Z"/>
  <path fill="var(--accent)" opacity="0.78" d="M52.5 81.4L54.7 77.7L56.8 73.9L58.8 70.1L60.8 66.2L62.8 62.4L64.8 58.5L66.7 54.6L68.5 50.7L70.4 46.7L72.2 42.7L74.0 38.7L74.5 37.4L72.1 36.3L71.5 37.6L69.7 41.6L67.8 45.5L65.9 49.3L63.9 53.2L61.9 57.0L59.8 60.8L57.8 64.6L55.6 68.3L53.5 72.0L51.3 75.7L49.1 79.4Z"/>
  <path fill="var(--accent)" d="M72.0 40.1L79.5 33.5L82.4 23.3L76.6 20.9L71.4 30.2Z"/>
  <path d="M73.5 36.6L77.2 27.7" stroke="var(--bg-app)" stroke-width="2.4" stroke-linecap="round"/>
  <circle cx="77.2" cy="27.7" r="1.7" fill="var(--bg-app)"/>
</svg>`;

function html(lang) {
  const c = COPY[lang];
  return `<!doctype html>
<html lang="${lang}" data-theme="needle-light">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="${SITE}/assets/site.css">
<style>
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
  body { background: var(--bg-app); position: relative; }
  .text { position: absolute; left: 72px; top: 0; bottom: 0; width: 470px;
          display: flex; flex-direction: column; justify-content: center; }
  .text svg { margin-left: -10px; }
  .text .eyebrow { margin-top: 18px; font-size: 15px; }
  h1 { margin: 6px 0 0; font-family: var(--font-page); font-weight: 400; font-size: 88px;
       line-height: 1; letter-spacing: -0.01em; color: var(--text); }
  .tagline { margin-top: 18px; font-family: var(--font-page); font-size: 31px; line-height: 1.25;
             color: var(--text); }
  .meta { margin-top: 26px; font-size: 19px; color: var(--text); }
  .shot { position: absolute; left: 600px; top: 72px; width: 960px; height: 600px; overflow: hidden;
          border: 1px solid var(--border); border-radius: 14px; background: var(--bg-editor);
          box-shadow: 0 30px 60px -28px rgb(0 0 0 / 0.35); }
  .shot img { display: block; width: 960px; height: 600px; }
</style>
</head>
<body>
  <div class="text">
    ${MARK}
    <p class="eyebrow">${c.eyebrow}</p>
    <h1>Versorium</h1>
    <p class="tagline">${c.tagline}</p>
    <p class="meta">${c.meta}</p>
  </div>
  <div class="shot"><img src="${SITE}/assets/shots/${lang}/editor-needle-light.webp" alt=""></div>
</body>
</html>`;
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const lang of Object.keys(COPY)) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    await page.setContent(html(lang), { waitUntil: "networkidle" });
    const raw = `/tmp/versorium-landing/og-${lang}.png`;
    await page.screenshot({ path: raw });
    const out = path.join(ROOT, "docs/assets", COPY[lang].file);
    // A 256-colour palette is invisible on flat interface colours and type,
    // and it is a third of the size.
    execFileSync("python3", [
      "-c",
      `from PIL import Image
im = Image.open(${JSON.stringify(raw)}).convert("RGB")
q = im.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
q.save(${JSON.stringify(out)}, optimize=True)
print(${JSON.stringify(COPY[lang].file)}, im.size)`,
    ], { stdio: "inherit" });
    await page.close();
  }
} finally {
  await browser.close();
}
