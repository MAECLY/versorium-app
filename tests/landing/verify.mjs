// Checks the site in docs/ the way a visitor meets it (site spec §12), and
// fails on anything the spec forbids. Every gate below has been broken on
// purpose once and seen to fail: tests/landing/verify-selftest.mjs does that
// again on a copy of docs/ (never on docs/ itself).
//
// Needs the static server: python3 -m http.server 8700 -d docs
//   node tests/landing/verify.mjs            # all gates, screenshots to /tmp
//   SHOTS=0 node tests/landing/verify.mjs    # checks only
//   QUICK=1 node tests/landing/verify.mjs    # Needle Light only, fewer widths
//   ONLY=links,words node tests/landing/verify.mjs   # some gates only
//   DOCS_DIR=/tmp/copy/docs SITE_URL=…       # check another copy of docs/
//   PROGRESS=1 …                             # name each page as it loads
//
// Gates (ONLY= names):
//   files     the copied tokens match src/styles.css (tokens.mjs --check),
//             theme.js's chrome colours, CNAME, the Pages workflow's pins,
//             the files the site needs;
//   links     every same-site link, anchor and resource in every file of
//             docs/ (HTML, CSS, llms.txt, agents.txt, robots.txt, sitemap,
//             manifest) resolves to a file and, with a #fragment, to an id
//             there; no page, stylesheet or manifest references a resource on
//             another server (links to other sites are links-live.mjs's job);
//   pages     every page × six variants × six widths: requests, CSP, console,
//             CLS, overflow, images, crops, rendered contrast, structure, head;
//   picker, words, fold, noscript, reduced, copy   (landing and details);
//   keyboard  Shift+Tab from the footer to the header, on the landing and
//             details pages at 1280×800, 640×400 (1280 at 200% zoom) and
//             375×667: no focused control is hidden, even in part, under the
//             sticky header (WCAG 2.2 SC 2.4.11);
//   parity    ES ↔ EN shape (language-parity.mjs) and FAQ ↔ JSON-LD
//             (faq-ld-parity.mjs);
//   replica   the HTML app window against locales/*/ui.json, the app's own
//             components and the sample novel (replica-parity.mjs);
//   budget    weights, JS, fonts, first view, LCP, throttled CLS, per-file
//             assets (budget.mjs);
//   contrast  token pairs (contrast.mjs --check) and real pixels behind text
//             in all six variants (contrast-pixels.mjs, both languages);
//   motion    nothing hidden by motion, in Chrome, WebKit and Firefox, with
//             and without script, motion allowed and reduced
//             (motion-safety.mjs, both languages);
//   compare   the comparison (landing section IV and /comparar/, /en/compare/)
//             says what tests/landing/comparison-data.mjs says: every cell,
//             dash, quote, amount, source and date, the release facts from
//             git, no logos (compare-parity.mjs).
//
// For both languages, the landing, details and comparison pages and the 404:
//   - not one request leaves the site; no CSP violation, console error or
//     page error; no horizontal overflow; no layout shift (CLS ≤ 0.001, with
//     motion allowed so the hero plays);
//   - every image has real alt text and width/height, loads, and is lazy
//     below the fold; a picture with a phone crop shows the crop below 720 px
//     and its alt describes whichever is on screen;
//   - one h1, no skipped heading levels, the landmarks, the skip link first,
//     every in-page and same-site link resolves; no style attribute or
//     <style>, no inline script but JSON-LD; the CSP string unchanged;
//   - the rendered contrast of every visible text run (the app window, a
//     picture, is left out);
//   - the head: canonical, hreflang, Open Graph, Twitter, JSON-LD with the
//     org's Person node byte for byte and the FAQ equal to the page's;
// and, on the landing page:
//   - the theme picker, the word gate (≤ 680 visible words, and ≤ 235 in the
//     comparison, in the browser and in the static count of
//     audit-wordcount.py), nothing but text above
//     the fold, the whole app window above the fold on a laptop;
//   - without script and under reduced motion: the named pieces (typed
//     sentence, limits, questions, proof line…) and, beyond them, every piece
//     of text and every image the finished page shows, compared both ways
//     with the page as the HTML ships it (no script), save what the spec
//     hides by design in that mode.

import { chromium } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const DOCS = process.env.DOCS_DIR ?? path.join(ROOT, "docs");
const SITE = process.env.SITE_URL ?? "http://localhost:8700";
const OUT = "/tmp/versorium-landing/verify";
const SHOTS = process.env.SHOTS !== "0";
const QUICK = process.env.QUICK === "1";
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
const gate = (name) => !ONLY || ONLY.includes(name);
const WORD_LIMIT = 680; // 420 until release 0.1.0 added the per-system download list, 435 until the comparison (IV) added its table
// The comparison may not creep: its own cap, by section id (browser and static counts).
const SECTION_WORDS = { comparar: 235, compare: 235 };
const RELEASE = {
  version: "0.1.0",
  base: "https://github.com/MAECLY/versorium-app/releases/download/v0.1.0/",
  installers: [
    "Versorium_0.1.0_aarch64.dmg",
    "Versorium_0.1.0_x64.dmg",
    "Versorium_0.1.0_x64-setup.exe",
    "Versorium_0.1.0_x64_en-US.msi",
    "Versorium_0.1.0_amd64.deb",
    "Versorium-0.1.0-1.x86_64.rpm",
    "Versorium_0.1.0_amd64.AppImage",
  ],
};
const PUBLIC = "https://versorium.maecly.com";

const PERSON =
  '{"@type":"Person","@id":"https://www.maecly.com/#miguel","name":"Miguel Esparza","url":"https://www.maecly.com/","email":"mailto:hola@maecly.com","jobTitle":"Full-Stack Developer & Content Creator"}';
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";

const PAGES = [
  { route: "/", lang: "es", landing: true },
  { route: "/en/", lang: "en", landing: true },
  { route: "/detalles/", lang: "es", details: true },
  { route: "/en/details/", lang: "en", details: true },
  { route: "/comparar/", lang: "es", details: true, compare: true },
  { route: "/en/compare/", lang: "en", details: true, compare: true },
  { route: "/404.html", lang: "es", is404: true },
].filter((p) => !(process.env.ROUTES ?? "").length || process.env.ROUTES.split(",").includes(p.route));
const list = (name) => (process.env[name] ? process.env[name].split(",") : null);
const ROUTES = list("ROUTES"); // e.g. ROUTES=/,/en/ to load only those pages
const VARIANTS = list("VARIANTS") ?? (QUICK ? ["needle-light"] : ["folio-light", "folio-dark", "quarry-light", "quarry-dark", "needle-light", "needle-dark"]);
const WIDTHS = (list("WIDTHS") ?? (QUICK ? [360, 1280] : [320, 360, 375, 1280, 1440, 1920])).map(Number);

const failures = [];
function fail(where, what) {
  failures.push(`${where}: ${what}`);
}

/** Installed before any page script: collects CSP violations and layout shifts. */
function probes() {
  window.__csp = [];
  window.__cls = 0;
  window.__shifts = [];
  document.addEventListener("securitypolicyviolation", (e) => {
    window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
  });
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        window.__cls += entry.value;
        window.__shifts.push(
          `${entry.value.toFixed(5)} ${entry.sources
            .map((s) => (s.node && s.node.nodeType === 1 ? `${s.node.tagName.toLowerCase()}.${[...s.node.classList].join(".")}` : "#text"))
            .join(",")}`,
        );
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {
    /* no Layout Instability API */
  }
}

/** In the page: the contrast of every visible text run against its real background. */
function contrastAudit() {
  const parse = (value) => {
    // color-mix() computes to color(srgb r g b [/ a]), channels from 0 to 1.
    const srgb = value.match(/color\(srgb ([^)]+)\)/);
    if (srgb) {
      const p = srgb[1].split(/[ /]+/).filter(Boolean).map(Number);
      return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 ? p[3] : 1 };
    }
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
    // The app window is a picture of the app (WCAG 1.4.3: part of a picture).
    if (el.closest(".replica, .sr-only, [hidden], svg")) continue;
    const style = getComputedStyle(el);
    if (style.visibility !== "visible" || style.display === "none" || Number(style.opacity) === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 2 || rect.height <= 2) continue;
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

/** In the page: visible words, by Appendix B of the spec. */
function wordCount() {
  const skip = (node) => {
    for (let e = node.parentElement; e; e = e.parentElement) {
      const tag = e.tagName.toUpperCase();
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "SVG" || tag === "TEMPLATE") return true;
      if (e.getAttribute("aria-hidden") === "true" || e.classList.contains("sr-only") || e.hasAttribute("hidden")) return true;
      const cs = getComputedStyle(e);
      if (cs.display === "none") return true;
      if (tag === "DETAILS" && !e.open && !node.parentElement.closest("summary")) return true;
    }
    return getComputedStyle(node.parentElement).visibility === "hidden";
  };
  const per = {};
  let total = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim() || skip(n)) continue;
    const words = (n.textContent.match(/\S+/g) || []).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    if (!words) continue;
    const box = n.parentElement.closest("section[id], header, footer");
    const key = box ? box.id || box.tagName.toLowerCase() : "other";
    per[key] = (per[key] || 0) + words;
    total += words;
  }
  return { total, per };
}

/** In the page: every piece of text and every picture a sighted visitor can
    see now, each tagged with the selectors that hide it by design in some
    mode. Answers are opened first, so they count; the app window's text is
    left out (a picture: its typed sentence is checked on its own). */
function shownContent(designed) {
  document.querySelectorAll("details").forEach((d) => (d.open = true));
  const opacity = (el) => {
    let o = 1;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
    return o;
  };
  const shown = (el) => {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (getComputedStyle(e).display === "none") return false;
    }
    const r = el.getBoundingClientRect();
    return getComputedStyle(el).visibility === "visible" && opacity(el) >= 0.999 && r.width > 2 && r.height > 2;
  };
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest(".replica, .sr-only, svg, script, style, template")) continue;
    let key = null;
    // A picture by its slot: script swaps the file and its alt (crop or full window), not the picture.
    if (el.tagName === "IMG") key = `img: ${el.closest("picture")?.dataset.shot ?? el.getAttribute("src")}`;
    else {
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").replace(/\s+/g, " ").trim();
      if (/[\p{L}\p{N}]/u.test(own)) key = own;
    }
    if (!key || !shown(el)) continue;
    const by = Object.entries(designed).filter(([, sel]) => el.closest(sel)).map(([mode]) => mode);
    out.push({ key, by });
  }
  return out;
}

/** What the spec hides on purpose, by the mode that hides it (§5, §12.1, §12.3). */
const DESIGNED = {
  // Shown only when script runs: the picker, the live counter, Replay, share,
  // and "your system" on the visitor's platform (theme.js detects it), which
  // the download buttons also name.
  nojs: ".picker, .proof-js, .proof-ext, .replay, .clip-replay, [data-share], .is-yours-label, .dl-mac, .dl-win, .dl-linux",
  // Shown only without script (or on a system with no file of its own).
  js: ".no-picker, .proof-nojs, .dl-any",
  // Replay exists only after a scene has played; under reduce nothing plays.
  reduce: ".replay, .clip-replay",
};

/** Which entries of `from` are missing from `to` (as multisets), unless the mode hides them by design. */
function lost(from, to, mode) {
  const left = new Map();
  for (const { key } of to) left.set(key, (left.get(key) ?? 0) + 1);
  const missing = [];
  for (const { key, by } of from) {
    if (left.get(key)) left.set(key, left.get(key) - 1);
    else if (!by.includes(mode)) missing.push(key);
  }
  return missing;
}

async function newPage(browser, { width, height, variant, scheme, reduced = false, js = true }) {
  const [theme, mode] = variant ? variant.split("-") : [null, null];
  const context = await browser.newContext({
    viewport: { width, height: height ?? (width < 700 ? 780 : 900) },
    deviceScaleFactor: 1,
    colorScheme: scheme ?? (mode === "dark" ? "dark" : "light"),
    reducedMotion: reduced ? "reduce" : "no-preference",
    javaScriptEnabled: js,
  });
  await context.addInitScript(probes);
  if (variant && js) {
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
  page.on("response", (r) => r.status() >= 400 && !r.url().endsWith("/404.html") && log.failed.push(`${r.status()} ${r.url()}`));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") log.console.push(`${m.type()}: ${m.text()}`);
  });
  page.on("pageerror", (e) => log.errors.push(e.message));
  return { context, page, log };
}

/** Scroll the whole page so lazy images load and every scene plays, then come back to the top. */
async function walk(page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 500) {
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), y);
    await page.waitForTimeout(60);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => [...document.images].every((img) => img.complete));
}

async function checkLoad(page, log, where, { width, height, requestsOnly = false }) {
  const origin = new URL(SITE).origin;
  for (const url of log.requests) {
    if (url.startsWith("data:")) continue;
    if (new URL(url).origin !== origin) fail(where, `third-party request ${url}`);
  }
  if (requestsOnly) {
    for (const v of await page.evaluate(() => window.__csp)) fail(where, `CSP violation ${v}`);
    return;
  }
  // theme.js swaps every screenshot to the visitor's theme at DOMContentLoaded;
  // a lazy image the browser had already started in the shipped theme is then
  // cancelled (net::ERR_ABORTED), more or less often depending on timing. That
  // is a superseded request, not a broken one, as long as the page no longer
  // names the file and every image it does show has loaded.
  const named = await page.evaluate(() => {
    const urls = new Set();
    for (const el of document.querySelectorAll("picture source, picture img")) {
      if (el.src) urls.add(el.src);
      for (const part of (el.getAttribute("srcset") || "").split(",")) {
        const u = part.trim().split(/\s+/)[0];
        if (u) urls.add(new URL(u, document.baseURI).href);
      }
    }
    return { urls: [...urls], broken: [...document.images].filter((img) => img.complete && img.currentSrc && !img.naturalWidth).map((img) => img.currentSrc) };
  });
  const superseded = (f) => {
    const [url, ...why] = f.split(" ");
    return why.join(" ") === "net::ERR_ABORTED" && new URL(url).pathname.includes("/assets/shots/") && !named.urls.includes(url);
  };
  for (const f of log.failed) if (!superseded(f)) fail(where, `request failed ${f}`);
  for (const b of named.broken) fail(where, `image did not load ${b}`);
  for (const c of log.console) fail(where, `console ${c}`);
  for (const e of log.errors) fail(where, `page error ${e}`);
  const csp = await page.evaluate(() => window.__csp);
  for (const v of csp) fail(where, `CSP violation ${v}`);
  const cls = await page.evaluate(() => [window.__cls, window.__shifts]);
  if (cls[0] > 0.001) fail(where, `layout shift ${cls[0].toFixed(4)}: ${cls[1].join(" | ")}`);
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
    if (img.top > height && img.loading !== "lazy") fail(where, `below-the-fold image not lazy ${img.src}`);
  }
}

/** Each picture with a phone crop: the right file for the width, and an alt
    that describes it (data-alt-detail or the written alt for the crop,
    data-alt for the window; a picture without data-alt says one thing for both). */
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
  for (const r of rows) {
    const crop = r.file.includes("-detail-");
    if (crop !== width < 720) fail(where, `${r.file}: ${crop ? "a crop on a wide screen" : "the full window on a phone"}`);
    if (crop && r.scale > 1.36) fail(where, `${r.file}: drawn at ${r.scale.toFixed(2)}x`);
    if (r.wide) {
      const want = crop ? r.detail : r.wide;
      if (want && r.alt !== want) fail(where, `${r.file}: its alt text describes the ${crop ? "full window" : "crop"}`);
    }
  }
}

async function checkStructure(page, where, { is404 }) {
  const s = await page.evaluate(() => {
    const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((h) => Number(h.tagName[1]));
    const ids = new Set([...document.querySelectorAll("[id]")].map((e) => e.id));
    const anchors = [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute("href").slice(1));
    const local = [...document.querySelectorAll("a[href]")]
      .map((a) => a.href)
      .filter((h) => h.startsWith(location.origin));
    return {
      h1: headings.filter((h) => h === 1).length,
      headings,
      banner: document.querySelectorAll("header.topbar").length,
      main: document.querySelectorAll("main").length,
      footer: document.querySelectorAll("footer").length,
      nav: document.querySelectorAll("nav").length,
      missingAnchors: anchors.filter((id) => id && !ids.has(id)),
      local: [...new Set(local)],
      inlineStyles: document.querySelectorAll("[style]").length,
      styleTags: document.querySelectorAll("style").length,
      inlineScripts: [...document.querySelectorAll("script:not([src])")].filter((s) => s.type !== "application/ld+json").length,
      lang: document.documentElement.lang,
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? "",
      skipFirst: (() => {
        const first = document.querySelector("a, button, input, [tabindex]:not([tabindex='-1'])");
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
  if (s.csp !== CSP) fail(where, "the CSP meta string changed");
  if (!s.skipFirst) fail(where, "skip link is not the first focusable element");
  // Every same-site link resolves, fragment included.
  for (const href of s.local) {
    const url = new URL(href);
    const res = await page.request.get(url.origin + url.pathname);
    if (!res.ok()) {
      fail(where, `link ${href} → ${res.status()}`);
      continue;
    }
    if (url.hash && url.pathname !== new URL(page.url()).pathname) {
      const body = await res.text();
      if (!body.includes(`id="${decodeURIComponent(url.hash.slice(1))}"`)) fail(where, `link ${href}: no such id there`);
    }
  }
}

async function checkHead(page, where, lang, { landing, compare }) {
  const head = await page.evaluate(() => {
    const meta = (sel) => document.querySelector(sel)?.getAttribute("content") ?? null;
    return {
      description: meta('meta[name="description"]'),
      canonical: document.querySelector('link[rel="canonical"]')?.href,
      hreflang: [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) => `${l.hreflang}=${l.href}`),
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
  const canonical = new URL(page.url()).pathname.replace(/^\//, base);
  if (head.canonical !== canonical) fail(where, `canonical ${head.canonical}`);
  const pair = landing ? [base, `${base}en/`] : compare ? [`${base}comparar/`, `${base}en/compare/`] : [`${base}detalles/`, `${base}en/details/`];
  for (const want of [`es=${pair[0]}`, `en=${pair[1]}`, `x-default=${pair[0]}`]) {
    if (!head.hreflang.includes(want)) fail(where, `hreflang missing ${want}`);
  }
  if (!head.description || head.description.length > 170) fail(where, "description missing or too long");
  if (head.themeColor < 1) fail(where, "theme-color missing");
  const og = head.og;
  if (!og.title || !og.description || !og.alt || og.url !== canonical) fail(where, "Open Graph incomplete");
  if (og.width !== "1200" || og.height !== "630") fail(where, "og:image size");
  const locales = { es: "es_ES", en: "en_GB" };
  if (og.locale !== locales[lang] || og.alternate !== locales[lang === "es" ? "en" : "es"]) fail(where, "og:locale");
  if (head.twitter !== "summary_large_image") fail(where, "twitter card");
  const imageFile = path.join(DOCS, new URL(og.image).pathname);
  const dims = execFileSync("python3", ["-c", `from PIL import Image;print(*Image.open(${JSON.stringify(imageFile)}).size)`]).toString().trim();
  if (dims !== "1200 630") fail(where, `og image is ${dims}`);
  if (head.ld.length !== 1) {
    fail(where, "JSON-LD block missing");
    return;
  }
  const raw = head.ld[0];
  if (!raw.includes(PERSON)) fail(where, "JSON-LD Person node differs from the org's");
  const graph = JSON.parse(raw)["@graph"];
  const types = graph.map((n) => n["@type"]);
  if (!landing) {
    for (const t of ["WebSite", "Person", "WebPage"]) if (!types.includes(t)) fail(where, `JSON-LD missing ${t}`);
    const webpage = graph.find((n) => n["@type"] === "WebPage");
    const h1 = await page.evaluate(() => document.querySelector("h1").textContent.trim());
    if (webpage?.name !== h1) fail(where, "WebPage name is not the H1");
    return;
  }
  for (const t of ["WebSite", "Person", "SoftwareApplication", "FAQPage"]) if (!types.includes(t)) fail(where, `JSON-LD missing ${t}`);
  const app = graph.find((n) => n["@type"] === "SoftwareApplication");
  if (app.license !== "https://www.gnu.org/licenses/agpl-3.0.html") fail(where, "licence URL");
  // Release 0.1.0 (site spec §5.6.2): its version, and downloadUrl lists its
  // installers, the very files the download section links to, in order.
  if (app.softwareVersion !== RELEASE.version) fail(where, `softwareVersion ${app.softwareVersion}`);
  const urls = RELEASE.installers.map((name) => RELEASE.base + name);
  if (JSON.stringify(app.downloadUrl) !== JSON.stringify(urls)) fail(where, `downloadUrl ${JSON.stringify(app.downloadUrl)}`);
  const links = await page.evaluate(() => ({
    files: [...document.querySelectorAll(".files a.file")].map((a) => a.href),
    buttons: [...document.querySelectorAll("a[data-dl]")].map((a) => a.href),
    sums: [...document.querySelectorAll("a[href$='/SHA256SUMS']")].length,
  }));
  if (JSON.stringify(links.files) !== JSON.stringify(urls)) fail(where, `the download list is not the release's installers: ${links.files.join(", ")}`);
  // Headless Chrome here reports the reference machine's system: on a Mac,
  // Linux or Windows each button gives that system's file.
  for (const href of links.buttons) if (!urls.includes(href)) fail(where, `a download button points at ${href}`);
  if (links.buttons.length !== 3) fail(where, `${links.buttons.length} download buttons`);
  if (!links.sums) fail(where, "no link to SHA256SUMS");
  if (app.operatingSystem !== "macOS, Windows, Linux") fail(where, "operatingSystem");
  if (app.isAccessibleForFree !== true || app.offers?.price !== "0") fail(where, "free offer");
  const shot = path.join(DOCS, new URL(app.screenshot).pathname);
  try {
    await readFile(shot);
  } catch {
    fail(where, `JSON-LD screenshot missing: ${app.screenshot}`);
  }
  const faq = graph.find((n) => n["@type"] === "FAQPage");
  const visible = await page.evaluate(() => [...document.querySelectorAll(".faq summary")].map((s) => s.textContent.trim()));
  const listed = faq.mainEntity.map((q) => q.name);
  if (JSON.stringify(visible) !== JSON.stringify(listed)) fail(where, "FAQ JSON-LD questions differ from the page");
  const answers = await page.evaluate(() => [...document.querySelectorAll(".faq .answer")].map((a) => a.textContent.replace(/\s+/g, " ").trim()));
  faq.mainEntity.forEach((q, i) => {
    if (q.acceptedAnswer.text !== answers[i]) fail(where, `FAQ answer ${i + 1} differs from the page`);
  });
}

async function checkPicker(browser, route) {
  const where = `${route} picker`;
  const { context, page, log } = await newPage(browser, { width: 1280, scheme: "light" });
  await page.goto(SITE + route, { waitUntil: "networkidle" });
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  const cork = () => page.evaluate(() => document.querySelector(".step-fig-cork img").currentSrc);
  if ((await theme()) !== "needle-light") fail(where, `default theme ${await theme()}`);
  // Keyboard: the radios are reachable and arrow keys move between them.
  await page.locator('#theme-picker input[value="needle"]').focus();
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(600);
  if ((await theme()) !== "quarry-light") fail(where, `arrow key gave ${await theme()}`);
  await page.locator('#theme-picker input[value="folio"]').check();
  await page.waitForTimeout(600);
  if ((await theme()) !== "folio-light") fail(where, `after Folio: ${await theme()}`);
  await page.locator('#theme-picker input[value="dark"]').check();
  await page.waitForTimeout(600);
  if ((await theme()) !== "folio-dark") fail(where, `after Dark: ${await theme()}`);
  await page.locator(".step-fig-cork").scrollIntoViewIfNeeded();
  try {
    await page.waitForFunction(() => document.querySelector(".step-fig-cork img").currentSrc.includes("corkboard-folio-dark"), null, { timeout: 5000 });
  } catch {
    fail(where, `corkboard did not follow: ${await cork()}`);
  }
  const color = await page.evaluate(() => [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.content));
  if (!color.every((c) => c === "#1c1914")) fail(where, `theme-color ${color}`);
  await page.reload({ waitUntil: "networkidle" });
  if ((await theme()) !== "folio-dark") fail(where, "choice not remembered after reload");
  const checked = await page.evaluate(() => [...document.querySelectorAll("#theme-picker input:checked")].map((i) => i.value).join(","));
  if (checked !== "folio,dark") fail(where, `picker shows ${checked}`);
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
  for (const e of log.errors) fail(where, `page error ${e}`);
  for (const c of log.console) fail(where, `console ${c}`);
  await context.close();
}

/** Focus never lands under the sticky header: Shift+Tab walks every stop from
    the footer up to the header, and each one must be wholly below it. */
async function checkKeyboard(browser, route) {
  for (const [width, height] of [
    [1280, 800],
    [640, 400],
    [375, 667],
  ]) {
    const where = `${route} keyboard ${width}x${height}`;
    const { context, page } = await newPage(browser, { width, height, variant: "needle-light", reduced: true });
    await page.goto(SITE + route, { waitUntil: "networkidle" });
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await page.locator("footer nav a").last().focus();
    let stops = 0;
    for (let i = 0; i < 120; i += 1) {
      await page.keyboard.press("Shift+Tab");
      await page.waitForTimeout(60);
      const f = await page.evaluate(() => {
        const el = document.activeElement;
        const header = document.querySelector(".topbar");
        if (!el || el === document.body || header.contains(el)) return null;
        const label = el.closest("label");
        const r = (el.type === "radio" && label ? label : el).getBoundingClientRect();
        return {
          name: (el.getAttribute("aria-label") || el.textContent || el.value || el.tagName).replace(/\s+/g, " ").trim().slice(0, 40),
          top: r.top,
          bottom: r.bottom,
          header: header.getBoundingClientRect().bottom,
        };
      });
      if (!f) break;
      stops += 1;
      if (f.bottom <= f.header) fail(where, `"${f.name}" focused wholly under the header`);
      else if (f.top < f.header - 0.5) fail(where, `"${f.name}" focused partly under the header (${Math.round(f.header - f.top)} px hidden)`);
    }
    if (stops < 5) fail(where, `only ${stops} focus stops before the header`);
    await context.close();
  }
}

async function checkCopy(browser, route) {
  const where = `${route} copy`;
  const { context, page, log } = await newPage(browser, { width: 1280, scheme: "light" });
  await page.goto(SITE + route, { waitUntil: "networkidle" });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: SITE });
  await page.locator("#instalar button[data-copy], #install button[data-copy]").click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  if (clip !== "xattr -rd com.apple.quarantine /Applications/Versorium.app") fail(where, `copied "${clip}"`);
  for (const e of log.errors) fail(where, `page error ${e}`);
  await context.close();
}

async function checkWords(browser, route) {
  const { context, page } = await newPage(browser, { width: 1280, height: 900, variant: "needle-light" });
  await page.goto(SITE + route, { waitUntil: "networkidle" });
  await walk(page);
  await page.waitForTimeout(6000);
  // The download labels follow html[data-os] (one stylesheet rule per
  // system), so the page is counted as each desktop system sees it and the
  // largest count is the one held to the cap (audit-wordcount.py does the same).
  const counts = [];
  for (const os of ["mac", "win", "linux"]) {
    await page.evaluate((os) => document.documentElement.setAttribute("data-os", os), os);
    counts.push({ os, ...(await page.evaluate(wordCount)) });
  }
  const words = counts.reduce((a, b) => (b.total > a.total ? b : a));
  console.log(`${route} visible words: ${words.total} as on ${words.os} (${counts.map((c) => `${c.os} ${c.total}`).join(", ")}; ${Object.entries(words.per).map(([k, v]) => `${k} ${v}`).join(", ")})`);
  if (words.total > WORD_LIMIT) fail(`${route} words`, `${words.total} visible words, over ${WORD_LIMIT}`);
  for (const [id, cap] of Object.entries(SECTION_WORDS)) {
    if (words.per[id] > cap) fail(`${route} words`, `${words.per[id]} visible words in #${id}, over ${cap}`);
  }
  await context.close();
  return words;
}

async function checkFold(browser, route) {
  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ]) {
    const where = `${route} fold ${width}x${height}`;
    const { context, page } = await newPage(browser, { width, height, variant: "needle-light" });
    await page.goto(SITE + route, { waitUntil: "networkidle" });
    const s = await page.evaluate(() => ({
      images: [...document.images].filter((img) => {
        const r = img.getBoundingClientRect();
        return r.width > 0 && r.top < innerHeight && r.bottom > 0;
      }).length,
      h1: (() => {
        const r = document.querySelector("h1").getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight;
      })(),
    }));
    if (s.images) fail(where, `${s.images} image(s) in the first viewport`);
    if (!s.h1) fail(where, "the H1 is not wholly inside the first viewport");
    await context.close();
  }
  for (const [width, height] of [
    [1280, 800],
    [1440, 900],
  ]) {
    const { context, page } = await newPage(browser, { width, height, variant: "needle-light" });
    await page.goto(SITE + route, { waitUntil: "networkidle" });
    const bottom = await page.evaluate(() => document.querySelector(".r-status").getBoundingClientRect().bottom);
    if (bottom > height) fail(`${route} hero fit ${width}x${height}`, `the status bar ends at ${bottom.toFixed(0)}, below the fold`);
    await context.close();
  }
}

async function checkNoScript(browser, route) {
  for (const width of [1280, 375]) {
    for (const scheme of ["light", "dark"]) {
      const where = `${route} no script ${width} ${scheme}`;
      const { context, page } = await newPage(browser, { width, scheme, js: false });
      await page.goto(SITE + route, { waitUntil: "networkidle" });
      const s = await page.evaluate(() => {
        const vis = (sel) => {
          const el = document.querySelector(sel);
          return !!el && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility === "visible";
        };
        return {
          bg: getComputedStyle(document.body).backgroundColor,
          rest: getComputedStyle(document.querySelector(".t-rest")).visibility,
          picker: getComputedStyle(document.getElementById("theme-picker")).display,
          note: vis(".no-picker"),
          share: [...document.querySelectorAll("[data-share]")].some((b) => getComputedStyle(b).display !== "none"),
          proof: vis(".proof-nojs"),
          limits: [...document.querySelectorAll(".limits li")].filter((li) => getComputedStyle(li).display !== "none").length,
          summaries: document.querySelectorAll(".faq summary").length,
          // The comparison: every row and cell there, the ring drawn, the names links.
          vsCells: [...document.querySelectorAll(".s-vs tbody tr")].map((tr) => [...tr.children].filter((c) => getComputedStyle(c).display !== "none" && getComputedStyle(c).visibility === "visible").length),
          vsRing: (() => {
            const ring = document.querySelector(".s-vs .vs-ring path");
            return ring ? parseFloat(getComputedStyle(ring).strokeDashoffset) || 0 : null;
          })(),
          vsLinks: document.querySelectorAll(".s-vs thead a[href]").length,
        };
      });
      const bg = scheme === "dark" ? "rgb(18, 28, 26)" : "rgb(244, 247, 246)";
      if (s.bg !== bg) fail(where, `background ${s.bg}`);
      if (s.rest !== "visible") fail(where, "the typed sentence is hidden");
      if (s.picker !== "none") fail(where, "picker shown without the script that runs it");
      if (!s.note) fail(where, "no-script note hidden");
      if (s.share) fail(where, "a share button shows without script");
      if (!s.proof) fail(where, "the no-script proof line is hidden");
      if (s.limits !== 5) fail(where, `${s.limits} limits visible`);
      if (s.summaries !== 5) fail(where, `${s.summaries} questions`);
      if (s.vsCells.length !== 6 || s.vsCells.some((n) => n !== 7)) fail(where, `the comparison shows ${JSON.stringify(s.vsCells)} cells per row, not 6 × 7`);
      if (s.vsRing !== 0) fail(where, `the ring around Versorium's price is not drawn (dash offset ${s.vsRing})`);
      if (s.vsLinks !== 5) fail(where, `${s.vsLinks} names link to the full comparison, not 5`);
      if (SHOTS && width === 1280) await page.screenshot({ path: `${OUT}/noscript-${route === "/" ? "es" : "en"}-${scheme}-1280.png` });
      await context.close();
    }
  }
}

async function checkReducedMotion(browser, route) {
  for (const width of [1280, 375]) {
    const where = `${route} reduced motion ${width}`;
    const { context, page, log } = await newPage(browser, { width, variant: "needle-light", reduced: true });
    await page.goto(SITE + route, { waitUntil: "networkidle" });
    await walk(page);
    await page.waitForTimeout(1000);
    const s = await page.evaluate(() => {
      const reveal = [...document.querySelectorAll("[data-reveal] svg *, svg[data-reveal] *")].filter((el) => {
        const cs = getComputedStyle(el);
        // The V's hairline is drawn at 0.78 by design (VMark.svelte).
        return Number(cs.opacity) < (el.classList.contains("hair") ? 0.78 : 1) && !el.closest("mask, defs");
      }).length;
      return {
        animations: document.getAnimations().length,
        classes: document.documentElement.className,
        rest: getComputedStyle(document.querySelector(".t-rest")).visibility,
        ribbon: getComputedStyle(document.querySelector(".ribbon-well")).display,
        reveal,
        btn: getComputedStyle(document.querySelector(".btn")).transitionDuration,
        scroll: getComputedStyle(document.documentElement).scrollBehavior,
        ring: (() => {
          const path = document.querySelector(".s-vs .vs-ring path");
          return path ? parseFloat(getComputedStyle(path).strokeDashoffset) || 0 : null;
        })(),
      };
    });
    if (s.animations) fail(where, `${s.animations} animation(s) running`);
    if (/\b(ink|motion)\b/.test(s.classes)) fail(where, `html has ${s.classes}`);
    if (s.rest !== "visible") fail(where, "the typed sentence is hidden");
    if (s.ribbon !== "none") fail(where, "the ribbon shows");
    if (s.reveal) fail(where, `${s.reveal} drawing part(s) not at full opacity`);
    if (s.btn !== "0s") fail(where, `button transition ${s.btn}`);
    if (s.scroll !== "auto") fail(where, `scroll-behavior ${s.scroll}`);
    if (s.ring !== 0) fail(where, `the ring around Versorium's price is not drawn (dash offset ${s.ring})`);
    if (log.requests.some((u) => u.includes(".anim.webp"))) fail(where, "a clip was requested");
    await context.close();
  }
}

/** Nothing is lost to script or to motion (§12.1, §12.3): the finished page
    with script and motion, the page as the HTML ships it (no script), and the
    page under reduced motion show the same text and pictures, both ways,
    save what DESIGNED hides in a mode. Read at the bottom after a full walk,
    so every reveal has fired and the header's button is in. */
async function checkNothingLost(browser, route) {
  for (const width of [1280, 375]) {
    const read = async (mode) => {
      const js = mode !== "nojs";
      const { context, page, log } = await newPage(browser, { width, variant: js ? "needle-light" : null, scheme: "light", js, reduced: mode === "reduce" });
      await page.goto(SITE + route, { waitUntil: "networkidle" });
      if (mode === "motion") await page.waitForTimeout(6000);
      await walk(page);
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
      await page.waitForTimeout(2500);
      const content = await page.evaluate(shownContent, DESIGNED);
      for (const e of log.errors) fail(`${route} ${mode} ${width}`, `page error ${e}`);
      await context.close();
      return content;
    };
    const motion = await read("motion");
    const shipped = await read("nojs");
    const reduce = await read("reduce");
    const report = (what, missing) => {
      for (const m of missing) fail(`${route} ${width}`, `${what}: "${m.slice(0, 70)}"`);
    };
    report("shown with script, lost without it", lost(motion, shipped, "nojs"));
    report("in the HTML, lost once script and motion run", lost(shipped, motion, "js"));
    report("in the HTML, lost under reduced motion", lost(shipped, reduce, "js"));
    report("shown with motion, lost under reduced motion", lost(motion, reduce, "reduce"));
    console.log(`${route} ${width}: ${motion.length} / ${shipped.length} / ${reduce.length} pieces shown (motion / no script / reduced)`);
  }
}

/** Every file of docs/, recursively. */
async function files(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(p)));
    else out.push(p);
  }
  return out;
}

const exists = async (p) => {
  try {
    return await stat(p);
  } catch {
    return null;
  }
};

/** Static: every same-site reference in every file resolves, fragments
    included, and no resource is loaded from another server. Sees what the
    rendered checks cannot: pages not in PAGES, llms.txt, agents.txt, the
    sitemap, robots.txt, the manifest, the stylesheets' url()s, and links
    that only appear on a phone or after a click. */
async function checkLinks() {
  const all = await files(DOCS);
  const ids = new Map();
  const idsOf = async (file) => {
    if (!ids.has(file)) {
      const html = await readFile(file, "utf8");
      ids.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
    }
    return ids.get(file);
  };
  /** A URL path on the site → the file GitHub Pages would serve, or null. */
  const target = async (pathname) => {
    const p = path.join(DOCS, decodeURIComponent(pathname));
    const st = await exists(p);
    if (st?.isFile()) return p;
    if (st?.isDirectory() || pathname.endsWith("/")) return (await exists(path.join(p, "index.html")))?.isFile() ? path.join(p, "index.html") : null;
    return (await exists(`${p}.html`))?.isFile() ? `${p}.html` : null;
  };
  let checked = 0;
  for (const file of all) {
    const rel = path.relative(DOCS, file);
    const ext = path.extname(file);
    if (![".html", ".css", ".txt", ".xml", ".webmanifest", ".js"].includes(ext)) continue;
    const text = await readFile(file, "utf8");
    // The URL this file is served at.
    const here = new URL(`/${rel.split(path.sep).join("/")}`, PUBLIC);
    const refs = []; // [url as written, is it a resource the page loads?]
    if (ext === ".html") {
      for (const m of text.matchAll(/<([a-z]+)\b([^>]*)>/gi)) {
        const tag = m[1].toLowerCase();
        const attrs = m[2];
        const attr = (name) => attrs.match(new RegExp(`\\s${name}="([^"]*)"`, "i"))?.[1];
        const rel = (attr("rel") ?? "").toLowerCase();
        const href = attr("href");
        if (href !== undefined) {
          // <a> and the head's canonical/alternate are links; everything else (stylesheet, icon, preload, manifest, <use>) is loaded.
          const isLink = tag === "a" || (tag === "link" && /\b(canonical|alternate)\b/.test(rel));
          refs.push([href, !isLink]);
        }
        for (const name of ["src", "poster", "data"]) {
          const v = attr(name);
          if (v !== undefined) refs.push([v, true]);
        }
        const srcset = attr("srcset");
        if (srcset) for (const part of srcset.split(",")) refs.push([part.trim().split(/\s+/)[0], true]);
        if (tag === "meta") {
          const content = attr("content") ?? "";
          if (/^https?:\/\//.test(content)) refs.push([content, /og:image|twitter:image/.test(attrs)]);
        }
      }
      // JSON-LD: every URL on this site in it must exist.
      for (const m of text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
        // "@id" values name nodes; they are not addresses.
        for (const u of m[1].matchAll(/"([@\w]+)"\s*:\s*"(https?:\/\/[^"]+)"/g)) if (u[1] !== "@id" && u[2].startsWith(PUBLIC)) refs.push([u[2], false]);
      }
    } else if (ext === ".css") {
      for (const m of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) refs.push([m[1], true]);
      for (const m of text.matchAll(/@import\s+["']([^"']+)["']/g)) refs.push([m[1], true]);
    } else if (ext === ".webmanifest") {
      const json = JSON.parse(text);
      for (const icon of json.icons ?? []) refs.push([icon.src, true]);
      for (const k of ["start_url", "scope"]) if (json[k]) refs.push([json[k], false]);
    } else if (ext === ".js") {
      // The scripts build no URLs to other servers.
      for (const m of text.matchAll(/["'`](https?:\/\/[^"'`\s]+)/g)) refs.push([m[1], true]);
    } else {
      for (const m of text.matchAll(/https?:\/\/[^\s)<>"\]]+/g)) if (m[0].startsWith(PUBLIC)) refs.push([m[0].replace(/[.,;:]+$/, ""), false]);
    }
    for (const [raw, resource] of refs) {
      if (!raw || /^(mailto:|tel:|data:)/.test(raw)) continue;
      if (/^javascript:/i.test(raw)) {
        fail(`links ${rel}`, `javascript: URL ${raw}`);
        continue;
      }
      // GitHub Pages serves 404.html at any missing path, so a relative URL there breaks one level down.
      if (rel === "404.html" && !/^(\/|#|https?:)/.test(raw)) fail(`links ${rel}`, `${raw} is relative; at /a/b/ it would not resolve`);
      const url = new URL(raw.replace(/&amp;/g, "&"), here);
      if (url.origin !== PUBLIC) {
        if (resource) fail(`links ${rel}`, `loads ${raw} from another server`);
        continue;
      }
      checked += 1;
      const file2 = url.pathname === here.pathname && raw.startsWith("#") ? file : await target(url.pathname);
      if (!file2) {
        fail(`links ${rel}`, `${raw} → no such file (${url.pathname})`);
        continue;
      }
      const frag = decodeURIComponent(url.hash.slice(1));
      if (frag && frag !== "top" && file2.endsWith(".html") && !(await idsOf(file2)).has(frag)) {
        fail(`links ${rel}`, `${raw} → no id "${frag}" in ${path.relative(DOCS, file2)}`);
      }
    }
  }
  console.log(`links: ${checked} same-site references checked in ${all.length} files`);
}

/** Runs one of the other gate scripts against the same site and copy of
    docs/; its " - " lines (or, without any, its last lines) become failures. */
function runScript(name, script, args = []) {
  const t0 = Date.now();
  const res = spawnSync("node", [path.join(ROOT, "tests/landing", script), ...args], {
    env: { ...process.env, SITE_URL: SITE, DOCS_DIR: DOCS },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const lines = out.split("\n");
  const ok = res.status === 0;
  if (!ok) {
    const listed = lines.filter((l) => /^ - |^DIFF |!\s/.test(l)).map((l) => l.replace(/^ - /, "").trim());
    const why = listed.length ? listed : [lines.filter(Boolean).slice(-3).join(" / ") || `exit ${res.status}`];
    for (const l of why) fail(`${name} (${script}${args.length ? ` ${args.join(" ")}` : ""})`, l);
  }
  const summary = lines.filter(Boolean).at(-1) ?? "";
  console.log(`[${name}] ${script} ${args.join(" ")}: ${ok ? "pass" : "FAIL"} in ${Math.round((Date.now() - t0) / 1000)} s; ${ok ? summary : `${lines.filter((l) => /^ - |^DIFF /.test(l)).length || "?"} problem line(s)`}`);
  if (process.env.VERBOSE) console.log(out);
  return out;
}

/** The static word count (audit-wordcount.py, Appendix B) agrees with the browser's and stays under the ceiling. */
function checkStaticWords() {
  const out = execFileSync("python3", [path.join(ROOT, "tests/landing/audit-wordcount.py"), path.join(DOCS, "index.html"), path.join(DOCS, "en/index.html")]).toString();
  const totals = [...out.matchAll(/TOTAL (\d+)/g)].map((m) => Number(m[1]));
  // Each page's report: its section lines, then TOTAL.
  const reports = out.split("== ").slice(1);
  ["/", "/en/"].forEach((route, i) => {
    console.log(`${route} static word count: ${totals[i]}`);
    if (!(totals[i] <= WORD_LIMIT)) fail(`${route} words (audit-wordcount.py)`, `${totals[i]} visible words, over ${WORD_LIMIT}`);
    for (const [id, cap] of Object.entries(SECTION_WORDS)) {
      const n = Number(reports[i]?.match(new RegExp(`^\\s+${id}\\s+(\\d+)$`, "m"))?.[1]);
      if (n > cap) fail(`${route} words (audit-wordcount.py)`, `${n} visible words in #${id}, over ${cap}`);
    }
  });
}

async function checkFiles() {
  try {
    execFileSync("node", [path.join(ROOT, "tests/landing/tokens.mjs"), "--check"], { stdio: "pipe" });
  } catch {
    fail("tokens", "docs/assets/site.css tokens differ from src/styles.css");
  }
  const css = await readFile(path.join(ROOT, "src/styles.css"), "utf8");
  const js = await readFile(path.join(DOCS, "assets/theme.js"), "utf8");
  for (const variant of ["folio-light", "folio-dark", "quarry-light", "quarry-dark", "needle-light", "needle-dark"]) {
    const block = css.match(new RegExp(`\\[data-theme="${variant}"\\][^{]*\\{([^}]*)\\}`))[1];
    const app = block.match(/--bg-app:\s*(#[0-9a-f]+)/)[1];
    if (!js.includes(`"${variant}": "${app}"`)) fail("theme.js", `${variant} chrome colour is not ${app}`);
  }
  const cname = (await readFile(path.join(DOCS, "CNAME"), "utf8")).trim();
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
  for (const file of ["robots.txt", "sitemap.xml", "llms.txt", "agents.txt", "site.webmanifest", "404.html", "favicon.ico", "assets/paper.svg", "assets/fonts/aguja-display-400.woff2", "assets/fonts/OFL.txt", "comparar/index.html", "en/compare/index.html"]) {
    try {
      await readFile(path.join(DOCS, file));
    } catch {
      fail("files", `docs/${file} missing`);
    }
  }
}

await mkdir(OUT, { recursive: true });
const started = Date.now();
const gatesRun = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });
let loads = 0;
let textChecked = 0;
const landings = ["/", "/en/"].filter((r) => !ROUTES || ROUTES.includes(r));
try {
  if (gate("files")) {
    gatesRun.push("files");
    await checkFiles();
  }
  if (gate("links")) {
    gatesRun.push("links");
    await checkLinks();
  }
  if (gate("pages")) {
    gatesRun.push("pages");
    for (const { route, lang, is404, landing, compare } of PAGES) {
      for (const variant of VARIANTS) {
        for (const width of WIDTHS) {
          // Every theme at phone and desktop widths; the extremes in Needle Light only.
          if ((width === 320 || width === 1920) && variant !== "needle-light") continue;
          if (is404 && ![375, 1280].includes(width)) continue;
          const where = `${route} ${variant} ${width}`;
          if (process.env.PROGRESS) console.log(`… ${where}`);
          const height = width < 700 ? 780 : 900;
          const { context, page, log } = await newPage(browser, { width, height, variant });
          await page.goto(SITE + route, { waitUntil: "networkidle" });
          const applied = await page.evaluate(() => document.documentElement.dataset.theme);
          if (applied !== variant) fail(where, `theme ${applied}`);
          // Let the hero play in full once per width, so its sequence counts towards CLS.
          if (landing && variant === "needle-light") await page.waitForTimeout(5500);
          await walk(page);
          await checkLoad(page, log, where, { width, height });
          if (landing) await checkCrops(page, where, { width });
          // Open every answer so their text is measured too.
          await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
          await page.waitForTimeout(300);
          const audit = await page.evaluate(contrastAudit);
          textChecked += audit.checked;
          for (const p of audit.problems) fail(where, `contrast ${p}`);
          // Opening the answers loads nothing from anywhere else either.
          await checkLoad(page, log, where, { width, height, requestsOnly: true });
          if (width === 1280 && variant === "needle-light") {
            await checkStructure(page, where, { is404 });
            if (!is404) await checkHead(page, where, lang, { landing: !!landing, compare: !!compare });
          }
          if (SHOTS && ["needle-light", "folio-dark", "quarry-dark"].includes(variant) && [375, 1280].includes(width)) {
            const name = `${route.replace(/\W+/g, "") || "es"}-${variant}-${width}`;
            await page.evaluate(() => document.querySelectorAll("details").forEach((d, i) => (d.open = i === 0)));
            await page.screenshot({ path: `${OUT}/${name}-top.png` });
          }
          loads += 1;
          await context.close();
        }
      }
    }
    console.log(`[pages] ${loads} page loads, ${textChecked} text runs measured for contrast`);
  }
  for (const route of landings) {
    if (gate("picker")) await checkPicker(browser, route);
    if (gate("words")) await checkWords(browser, route);
    if (gate("fold")) await checkFold(browser, route);
    if (gate("noscript")) await checkNoScript(browser, route);
    if (gate("reduced")) await checkReducedMotion(browser, route);
    if (gate("noscript") || gate("reduced")) await checkNothingLost(browser, route);
  }
  if (gate("keyboard")) {
    gatesRun.push("keyboard");
    for (const route of ["/", "/en/", "/detalles/", "/en/details/", "/comparar/", "/en/compare/"].filter((r) => !ROUTES || ROUTES.includes(r))) await checkKeyboard(browser, route);
  }
  for (const g of ["picker", "words", "fold", "noscript", "reduced"]) if (gate(g)) gatesRun.push(g);
  if (gate("words")) checkStaticWords();
  if (gate("copy")) {
    gatesRun.push("copy");
    await checkCopy(browser, "/detalles/");
    await checkCopy(browser, "/en/details/");
  }
} finally {
  await browser.close();
}

// The other gate scripts, each against the same site and copy of docs/.
if (gate("parity")) {
  gatesRun.push("parity");
  runScript("parity", "language-parity.mjs");
  runScript("parity", "faq-ld-parity.mjs", [SITE]);
}
if (gate("replica")) {
  gatesRun.push("replica");
  runScript("replica", "replica-parity.mjs");
}
if (gate("budget")) {
  gatesRun.push("budget");
  runScript("budget", "budget.mjs");
}
if (gate("contrast")) {
  gatesRun.push("contrast");
  runScript("contrast", "contrast.mjs", ["--check"]);
  for (const route of landings) runScript("contrast", "contrast-pixels.mjs", ["--route", route]);
}
if (gate("compare")) {
  gatesRun.push("compare");
  runScript("compare", "compare-parity.mjs");
}
if (gate("motion")) {
  gatesRun.push("motion");
  for (const route of landings) runScript("motion", "motion-safety.mjs", ["--route", route, ...(process.env.ENGINES ? ["--engines", process.env.ENGINES] : [])]);
}

console.log(`\ngates run: ${gatesRun.join(", ")} (${Math.round((Date.now() - started) / 60000)} min)`);
if (failures.length) {
  const unique = [...new Set(failures)];
  console.log(`\n${unique.length} problem(s):`);
  for (const f of unique) console.log(" -", f);
  process.exitCode = 1;
} else {
  console.log("every check passed");
}
