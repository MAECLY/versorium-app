// Checks the landing page in docs/ the way a visitor meets it.
//
// Needs the static server: python3 -m http.server 8700 -d docs
//   node tests/landing/verify.mjs            # all checks, screenshots to /tmp
//   SHOTS=0 node tests/landing/verify.mjs    # checks only
//
// What is checked, for both languages, every theme variant and four widths:
//   - not one request leaves the site (no fonts, CDNs, analytics, embeds);
//   - no CSP violation, console error or page error;
//   - no horizontal overflow from 360 px to 1920 px, and no layout shift;
//   - every image has alt text, explicit width/height, and loads; everything
//     below the fold is lazy and the hero is not;
//   - a screenshot with a phone crop shows the crop below 720 px and the full
//     window above, never blown up past 1.25x, and its alt text describes
//     whichever of the two is on screen;
//   - one h1, no skipped heading levels, the landmarks, a working skip link,
//     every in-page link resolves;
//   - the rendered contrast of every visible piece of text against what is
//     actually behind it (WCAG AA: 4.5, or 3 for large text);
//   - the head: canonical, hreflang, Open Graph, Twitter, JSON-LD with the org's
//     Person node byte for byte;
//   - the theme picker changes the page and the screenshots, and remembers;
//   - reduced motion removes transitions;
//   - the copied tokens still match src/styles.css.

import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const SITE = process.env.SITE_URL ?? "http://localhost:8700";
const OUT = "/tmp/versorium-landing/verify";
const SHOTS = process.env.SHOTS !== "0";

const PERSON =
  '{"@type":"Person","@id":"https://www.maecly.com/#miguel","name":"Miguel Esparza","url":"https://www.maecly.com/","email":"mailto:hola@maecly.com","jobTitle":"Full-Stack Developer & Content Creator"}';

const PAGES = [
  { route: "/", lang: "es" },
  { route: "/en/", lang: "en" },
  { route: "/404.html", lang: "es", is404: true },
];
const VARIANTS = ["folio-light", "folio-dark", "quarry-light", "quarry-dark", "needle-light", "needle-dark"];
const WIDTHS = [360, 375, 1280, 1920];

const failures = [];
function fail(where, what) {
  failures.push(`${where}: ${what}`);
}

/** Installed before any page script: collects CSP violations and layout shifts. */
function probes() {
  window.__csp = [];
  window.__cls = 0;
  document.addEventListener("securitypolicyviolation", (e) => {
    window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
  });
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value;
    }).observe({ type: "layout-shift", buffered: true });
  } catch {
    /* no Layout Instability API */
  }
}

/** In the page: the contrast of every visible text run against its real background. */
function contrastAudit() {
  const parse = (value) => {
    const m = value.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const over = (top, under) => ({
    r: top.r * top.a + under.r * (1 - top.a),
    g: top.g * top.a + under.g * (1 - top.a),
    b: top.b * top.a + under.b * (1 - top.a),
    a: 1,
  });
  const lum = (c) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const background = (el) => {
    const layers = [];
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0) layers.push(bg);
      if (bg && bg.a >= 1) break;
    }
    let colour = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i -= 1) colour = over(layers[i], colour);
    return colour;
  };
  const problems = [];
  let checked = 0;
  for (const el of document.querySelectorAll("body *")) {
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const style = getComputedStyle(el);
    if (style.visibility !== "visible" || style.display === "none") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 2 || rect.height <= 2) continue;
    if (el.closest(".sr-only, [hidden]")) continue;
    const fg = parse(style.color);
    const bg = background(el);
    const colour = fg.a < 1 ? over(fg, bg) : fg;
    const size = parseFloat(style.fontSize);
    const bold = Number(style.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const min = large ? 3 : 4.5;
    const r = ratio(colour, bg);
    checked += 1;
    if (r < min) {
      problems.push(`${r.toFixed(2)} < ${min} for "${el.textContent.trim().slice(0, 40)}" (${el.tagName.toLowerCase()}.${[...el.classList].join(".")})`);
    }
  }
  return { checked, problems };
}

async function newPage(browser, { width, variant, scheme, reduced = false }) {
  const [theme, mode] = variant ? variant.split("-") : [null, null];
  const context = await browser.newContext({
    viewport: { width, height: width < 700 ? 780 : 900 },
    deviceScaleFactor: 1,
    colorScheme: scheme ?? (mode === "dark" ? "dark" : "light"),
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  await context.addInitScript(probes);
  if (variant) {
    await context.addInitScript(
      ({ theme, mode }) => {
        localStorage.setItem("versorium.site.theme", theme);
        localStorage.setItem("versorium.site.mode", mode);
      },
      { theme, mode },
    );
  }
  const page = await context.newPage();
  const log = { requests: [], console: [], errors: [], failed: [] };
  page.on("request", (r) => log.requests.push(r.url()));
  page.on("requestfailed", (r) => log.failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") log.console.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => log.errors.push(e.message));
  return { context, page, log };
}

/** Scroll the whole page so lazy images load, then come back to the top. */
async function walk(page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 500) {
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await page.waitForTimeout(40);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => [...document.images].every((img) => img.complete));
}

async function checkLoad(page, log, where, { width }) {
  const origin = new URL(SITE).origin;
  for (const url of log.requests) {
    if (url.startsWith("data:")) continue;
    if (new URL(url).origin !== origin) fail(where, `third-party request ${url}`);
  }
  for (const f of log.failed) fail(where, `request failed ${f}`);
  for (const c of log.console) fail(where, `console ${c}`);
  for (const e of log.errors) fail(where, `page error ${e}`);
  const csp = await page.evaluate(() => window.__csp);
  for (const v of csp) fail(where, `CSP violation ${v}`);
  const cls = await page.evaluate(() => window.__cls);
  if (cls > 0.001) fail(where, `layout shift ${cls.toFixed(4)}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) {
    const culprits = await page.evaluate(() =>
      [...document.querySelectorAll("body *")]
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5)
        .slice(0, 5)
        .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`),
    );
    fail(where, `horizontal overflow ${overflow}px at ${width}: ${culprits.join(", ")}`);
  }
  const images = await page.evaluate(() =>
    [...document.images].map((img) => ({
      src: img.currentSrc || img.src,
      alt: img.getAttribute("alt"),
      width: img.getAttribute("width"),
      height: img.getAttribute("height"),
      loading: img.getAttribute("loading"),
      natural: img.naturalWidth,
      top: img.getBoundingClientRect().top + window.scrollY,
    })),
  );
  for (const img of images) {
    if (!img.alt || img.alt.trim().length < 20) fail(where, `image without real alt text ${img.src}`);
    if (!img.width || !img.height) fail(where, `image without width/height ${img.src}`);
    if (!img.natural) fail(where, `image did not load ${img.src}`);
    const belowFold = img.top > 900;
    if (belowFold && img.loading !== "lazy") fail(where, `below-the-fold image not lazy ${img.src}`);
    if (!belowFold && img.loading === "lazy" && width >= 1280) fail(where, `above-the-fold image is lazy ${img.src}`);
  }
}

/** Each picture with a phone crop: the right file for the width, and an alt
    that describes it (data-alt-detail for the crop, data-alt for the window;
    either may name the picked theme and mode). */
async function checkCrops(page, where, { width }) {
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll("picture")]
      .filter((p) => p.querySelector("source[data-shot]"))
      .map((p) => {
        const img = p.querySelector("img");
        const source = p.querySelector("source[data-shot]");
        return {
          file: img.currentSrc.split("/").pop(),
          alt: img.alt,
          detail: img.dataset.altDetail ?? null,
          wide: img.dataset.alt ?? null,
          scale: img.getBoundingClientRect().width / Number(source.getAttribute("width")),
        };
      }),
  );
  const describes = (template, alt) => {
    if (!template) return false;
    const pattern = template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{(theme|mode)\\\}/g, ".+?");
    return new RegExp(`^${pattern}$`).test(alt);
  };
  for (const r of rows) {
    const crop = r.file.includes("-detail-");
    if (crop !== width < 720) fail(where, `${r.file}: ${crop ? "a crop on a wide screen" : "the full window on a phone"}`);
    if (crop && r.scale > 1.26) fail(where, `${r.file}: drawn at ${r.scale.toFixed(2)}x`);
    if (!describes(crop ? r.detail : r.wide, r.alt)) fail(where, `${r.file}: its alt text describes the ${crop ? "full window" : "crop"}`);
  }
}

async function checkStructure(page, where, { is404 }) {
  const s = await page.evaluate(() => {
    const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) => Number(h.tagName[1]));
    const ids = new Set([...document.querySelectorAll("[id]")].map((e) => e.id));
    const anchors = [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute("href").slice(1));
    return {
      h1: headings.filter((h) => h === 1).length,
      headings,
      banner: document.querySelectorAll("header.topbar").length,
      main: document.querySelectorAll("main").length,
      footer: document.querySelectorAll("footer").length,
      nav: document.querySelectorAll("nav").length,
      missingAnchors: anchors.filter((id) => id && !ids.has(id)),
      inlineStyles: document.querySelectorAll("[style]").length,
      styleTags: document.querySelectorAll("style").length,
      inlineScripts: [...document.querySelectorAll("script:not([src])")].filter(
        (s) => s.type !== "application/ld+json",
      ).length,
      lang: document.documentElement.lang,
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? "",
      skipFirst: (() => {
        const first = document.querySelector("a, button, input, [tabindex]");
        return first?.classList.contains("skip") ?? false;
      })(),
    };
  });
  if (s.h1 !== 1) fail(where, `${s.h1} h1 elements`);
  for (let i = 1; i < s.headings.length; i += 1) {
    if (s.headings[i] > s.headings[i - 1] + 1) fail(where, `heading jumps from h${s.headings[i - 1]} to h${s.headings[i]}`);
  }
  if (!s.banner || s.main !== 1) fail(where, "missing banner or main landmark");
  if (!is404 && (!s.footer || s.nav < 2)) fail(where, "missing footer or navigation");
  for (const id of s.missingAnchors) fail(where, `in-page link to missing #${id}`);
  if (s.inlineStyles || s.styleTags) fail(where, "inline styles present (the CSP forbids them)");
  if (s.inlineScripts) fail(where, "inline scripts present (the CSP forbids them)");
  if (!s.csp.includes("default-src 'self'")) fail(where, "CSP meta missing default-src 'self'");
  if (!s.skipFirst) fail(where, "skip link is not the first focusable element");
}

async function checkHead(page, where, lang) {
  const head = await page.evaluate(() => {
    const meta = (sel) => document.querySelector(sel)?.getAttribute("content") ?? null;
    return {
      description: meta('meta[name="description"]'),
      canonical: document.querySelector('link[rel="canonical"]')?.href,
      hreflang: [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map(
        (l) => `${l.hreflang}=${l.href}`,
      ),
      themeColor: document.querySelectorAll('meta[name="theme-color"]').length,
      og: {
        title: meta('meta[property="og:title"]'),
        description: meta('meta[property="og:description"]'),
        image: meta('meta[property="og:image"]'),
        width: meta('meta[property="og:image:width"]'),
        height: meta('meta[property="og:image:height"]'),
        alt: meta('meta[property="og:image:alt"]'),
        locale: meta('meta[property="og:locale"]'),
        alternate: meta('meta[property="og:locale:alternate"]'),
        url: meta('meta[property="og:url"]'),
      },
      twitter: meta('meta[name="twitter:card"]'),
      ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent),
    };
  });
  const base = "https://versorium.maecly.com/";
  const canonical = lang === "es" ? base : `${base}en/`;
  if (head.canonical !== canonical) fail(where, `canonical ${head.canonical}`);
  for (const want of [`es=${base}`, `en=${base}en/`, `x-default=${base}`]) {
    if (!head.hreflang.includes(want)) fail(where, `hreflang missing ${want}`);
  }
  if (!head.description || head.description.length > 170) fail(where, "description missing or too long");
  if (head.themeColor < 1) fail(where, "theme-color missing");
  const og = head.og;
  if (!og.title || !og.description || !og.alt || og.url !== canonical) fail(where, "Open Graph incomplete");
  if (og.width !== "1200" || og.height !== "630") fail(where, "og:image size");
  // The English page is written in British English (licence, catalogue,
  // labelled), so it says en_GB, and the Spanish page names it as such.
  const locales = { es: "es_ES", en: "en_GB" };
  if (og.locale !== locales[lang] || og.alternate !== locales[lang === "es" ? "en" : "es"]) fail(where, "og:locale");
  if (head.twitter !== "summary_large_image") fail(where, "twitter card");
  const imageFile = path.join(ROOT, "docs", new URL(og.image).pathname);
  const dims = execFileSync("python3", ["-c", `from PIL import Image;print(*Image.open(${JSON.stringify(imageFile)}).size)`])
    .toString()
    .trim();
  if (dims !== "1200 630") fail(where, `og image is ${dims}`);
  if (head.ld.length !== 1) fail(where, "JSON-LD block missing");
  else {
    const raw = head.ld[0];
    if (!raw.includes(PERSON)) fail(where, "JSON-LD Person node differs from the org's");
    const graph = JSON.parse(raw)["@graph"];
    const types = graph.map((n) => n["@type"]);
    for (const t of ["WebSite", "Person", "SoftwareApplication", "FAQPage"]) {
      if (!types.includes(t)) fail(where, `JSON-LD missing ${t}`);
    }
    const app = graph.find((n) => n["@type"] === "SoftwareApplication");
    if (app.license !== "https://www.apache.org/licenses/LICENSE-2.0") fail(where, "licence URL");
    if (app.downloadUrl !== "https://github.com/MAECLY/versorium-app/releases/latest") fail(where, "downloadUrl");
    if (app.operatingSystem !== "macOS, Windows, Linux") fail(where, "operatingSystem");
    if (app.isAccessibleForFree !== true || app.offers?.price !== "0") fail(where, "free offer");
    const faq = graph.find((n) => n["@type"] === "FAQPage");
    const visible = await page.evaluate(() => [...document.querySelectorAll(".faq summary")].map((s) => s.textContent.trim()));
    const listed = faq.mainEntity.map((q) => q.name);
    if (JSON.stringify(visible) !== JSON.stringify(listed)) fail(where, "FAQ JSON-LD questions differ from the page");
    const answers = await page.evaluate(() =>
      [...document.querySelectorAll(".faq .answer")].map((a) => a.textContent.replace(/\s+/g, " ").trim()),
    );
    faq.mainEntity.forEach((q, i) => {
      if (q.acceptedAnswer.text !== answers[i]) fail(where, `FAQ answer ${i + 1} differs from the page`);
    });
  }
}

async function checkPicker(browser, route, lang) {
  const where = `${route} picker`;
  const { context, page, log } = await newPage(browser, { width: 1280, scheme: "light" });
  await page.goto(SITE + route, { waitUntil: "networkidle" });
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  const hero = () => page.evaluate(() => document.querySelector(".hero img").currentSrc);
  if ((await theme()) !== "needle-light") fail(where, `default theme ${await theme()}`);
  // Keyboard: the radios are reachable and arrow keys move between them.
  await page.locator('#theme-picker input[value="needle"]').focus();
  await page.keyboard.press("ArrowLeft");
  if ((await theme()) !== "quarry-light") fail(where, `arrow key gave ${await theme()}`);
  await page.locator('#theme-picker input[value="folio"]').check();
  if ((await theme()) !== "folio-light") fail(where, `after Folio: ${await theme()}`);
  await page.waitForFunction(() => document.querySelector(".hero img").currentSrc.includes("folio-light"));
  await page.locator('#theme-picker input[value="dark"]').check();
  if ((await theme()) !== "folio-dark") fail(where, `after Dark: ${await theme()}`);
  await page.waitForFunction(() => document.querySelector(".hero img").currentSrc.includes("folio-dark"));
  const alt = await page.evaluate(() => document.querySelector(".themes-shot img").alt);
  if (!alt.includes("Folio")) fail(where, "themes screenshot alt does not name the chosen theme");
  if (!alt.includes(lang === "es" ? "«Oscuro»" : "“Dark”")) fail(where, "themes screenshot alt does not name the chosen mode");
  // The app's own picker, pictured with Dark pressed, as this page's is.
  await page.locator(".themes-shot").scrollIntoViewIfNeeded();
  await page.waitForFunction(() =>
    document.querySelector(".themes-shot img").currentSrc.includes("settings-pinned-folio-dark"),
  );
  const color = await page.evaluate(() => [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.content));
  if (!color.every((c) => c === "#1c1914")) fail(where, `theme-color ${color}`);
  await page.reload({ waitUntil: "networkidle" });
  if ((await theme()) !== "folio-dark") fail(where, "choice not remembered after reload");
  const checked = await page.evaluate(() =>
    [...document.querySelectorAll("#theme-picker input:checked")].map((i) => i.value).join(","),
  );
  if (checked !== "folio,dark") fail(where, `picker shows ${checked}`);
  if (!(await hero()).includes("editor-folio-dark")) fail(where, `hero after reload ${await hero()}`);
  // Following the system follows it live.
  await page.locator('#theme-picker input[value="follow"]').check();
  const follows = async (want) => {
    try {
      await page.waitForFunction((w) => document.documentElement.dataset.theme === w, want, { timeout: 3000 });
    } catch {
      fail(where, `follow system: wanted ${want}, got ${await theme()}`);
    }
  };
  await page.emulateMedia({ colorScheme: "dark" });
  await follows("folio-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await follows("folio-light");
  await page.waitForFunction(() => document.querySelector(".hero img").currentSrc.includes("folio-light"));
  await page.waitForFunction(() => {
    const src = document.querySelector(".themes-shot img").currentSrc;
    return src.includes("settings-folio-light") && !src.includes("pinned");
  });
  // The copy button.
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: SITE });
  await page.locator("button[data-copy]").click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  if (clip !== "xattr -rd com.apple.quarantine /Applications/Versorium.app") fail(where, `copied "${clip}"`);
  for (const e of log.errors) fail(where, `page error ${e}`);
  await context.close();
}

async function checkReducedMotion(browser) {
  const { context, page } = await newPage(browser, { width: 1280, variant: "needle-light", reduced: true });
  await page.goto(SITE + "/", { waitUntil: "networkidle" });
  const t = await page.evaluate(() => ({
    btn: getComputedStyle(document.querySelector(".btn")).transitionDuration,
    scroll: getComputedStyle(document.documentElement).scrollBehavior,
  }));
  if (t.btn !== "0s") fail("reduced motion", `button transition ${t.btn}`);
  if (t.scroll !== "auto") fail("reduced motion", `scroll-behavior ${t.scroll}`);
  await context.close();
}

async function checkNoScript(browser) {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  const page = await context.newPage();
  await page.goto(SITE + "/", { waitUntil: "networkidle" });
  const s = await page.evaluate(() => ({
    bg: getComputedStyle(document.body).backgroundColor,
    picker: getComputedStyle(document.getElementById("theme-picker")).display,
    note: getComputedStyle(document.querySelector(".no-picker")).display,
  }));
  // Needle Dark's --bg-editor, with no script at all.
  if (s.bg !== "rgb(18, 28, 26)") fail("no script", `background ${s.bg}`);
  if (s.picker !== "none") fail("no script", "picker shown without the script that runs it");
  if (s.note === "none") fail("no script", "no-script note hidden");
  if (SHOTS) await page.screenshot({ path: `${OUT}/noscript-dark-1280.png` });
  await context.close();
}

async function checkFiles() {
  try {
    execFileSync("node", [path.join(ROOT, "tests/landing/tokens.mjs"), "--check"], { stdio: "pipe" });
  } catch {
    fail("tokens", "docs/assets/site.css tokens differ from src/styles.css");
  }
  const css = await readFile(path.join(ROOT, "src/styles.css"), "utf8");
  const js = await readFile(path.join(ROOT, "docs/assets/theme.js"), "utf8");
  for (const variant of VARIANTS) {
    const block = css.match(new RegExp(`\\[data-theme="${variant}"\\][^{]*\\{([^}]*)\\}`))[1];
    const app = block.match(/--bg-app:\s*(#[0-9a-f]+)/)[1];
    if (!js.includes(`"${variant}": "${app}"`)) fail("theme.js", `${variant} chrome colour is not ${app}`);
  }
  const cname = (await readFile(path.join(ROOT, "docs/CNAME"), "utf8")).trim();
  if (cname !== "versorium.maecly.com") fail("CNAME", cname);
  const workflow = await readFile(path.join(ROOT, ".github/workflows/pages.yml"), "utf8");
  for (const pin of [
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
    "actions/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d # v6.0.0",
    "actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5.0.0",
    "actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346 # v5.0.1",
  ]) {
    if (!workflow.includes(pin)) fail("pages.yml", `missing ${pin}`);
  }
  for (const file of ["robots.txt", "sitemap.xml", "llms.txt", "agents.txt", "site.webmanifest", "404.html", "favicon.ico"]) {
    try {
      await readFile(path.join(ROOT, "docs", file));
    } catch {
      fail("files", `docs/${file} missing`);
    }
  }
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
let loads = 0;
let textChecked = 0;
try {
  await checkFiles();
  for (const { route, lang, is404 } of PAGES) {
    for (const variant of VARIANTS) {
      for (const width of WIDTHS) {
        // Every theme at both phone and desktop width; the extremes in Needle only.
        if ((width === 360 || width === 1920) && !variant.startsWith("needle")) continue;
        const where = `${route} ${variant} ${width}`;
        const { context, page, log } = await newPage(browser, { width, variant });
        await page.goto(SITE + route, { waitUntil: "networkidle" });
        const applied = await page.evaluate(() => document.documentElement.dataset.theme);
        if (applied !== variant) fail(where, `theme ${applied}`);
        await walk(page);
        await checkLoad(page, log, where, { width });
        if (!is404) await checkCrops(page, where, { width });
        // Open every answer so their text is measured too.
        await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
        const audit = await page.evaluate(contrastAudit);
        textChecked += audit.checked;
        for (const p of audit.problems) fail(where, `contrast ${p}`);
        if (width === 1280 && variant === "needle-light") {
          await checkStructure(page, where, { is404 });
          if (!is404) await checkHead(page, where, lang);
        }
        if (SHOTS && (variant === "needle-light" || variant === "folio-dark" || variant === "quarry-dark") && (width === 375 || width === 1280)) {
          const name = `${lang}${is404 ? "-404" : ""}-${variant}-${width}`;
          await page.evaluate(() => document.querySelectorAll("details").forEach((d, i) => (d.open = i === 0)));
          await page.screenshot({ path: `${OUT}/${name}-top.png` });
          await page.screenshot({ path: `${OUT}/${name}-full.png`, fullPage: true });
        }
        loads += 1;
        await context.close();
      }
    }
  }
  await checkPicker(browser, "/", "es");
  await checkPicker(browser, "/en/", "en");
  await checkReducedMotion(browser);
  await checkNoScript(browser);
} finally {
  await browser.close();
}

console.log(`${loads} page loads, ${textChecked} text runs measured for contrast`);
if (failures.length) {
  console.log(`\n${failures.length} problem(s):`);
  for (const f of [...new Set(failures)]) console.log(" -", f);
  process.exitCode = 1;
} else {
  console.log("every check passed");
}
