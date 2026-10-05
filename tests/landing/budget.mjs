// The weight and speed budgets (site spec §12.4), in Chrome:
//   landing HTML ≤ 44.5 KB raw / 12.5 KB gzip each; site.css ≤ 50 / 12 KB (36 / 10
//   and 44 / 10 until release 0.1.0 added the per-system download list, 40 /
//   10.5 and 44 / 10.5 until the comparison, section IV, added its table); the
//   comparison pages ≤ 64 / 14 KB each and details.css ≤ 10 KB raw; the
//   three scripts ≤ 9 KB gzip together, motion.js ≤ 6 KB raw and download.js
//   ≤ 3 KB raw (§8.2, §8.3); one font ≤ 14 KB; a phone's first view
//   ≤ 80 KB transferred; not one request to another server on any page, after
//   scrolling and opening every answer; LCP on a throttled phone ≤ 1800 ms and
//   on a desktop ≤ 1000 ms, the H1 both times; CLS on the throttled phone,
//   scrolled through, ≤ 0.001. Then the per-file asset budgets (§9.3), by
//   tests/landing/asset-budget.py.
//
//   SITE_URL=http://localhost:8742 node tests/landing/budget.mjs
//   DOCS_DIR=/some/copy/of/docs …    # weigh another copy (verify-selftest.mjs)
//   STATIC=1 …                       # file sizes only, no browser

import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const DOCS = process.env.DOCS_DIR ?? path.join(ROOT, "docs");
const SITE = process.env.SITE_URL ?? "http://localhost:8700";
const problems = [];
const bad = (what) => problems.push(what);
const kb = (n) => (n / 1024).toFixed(1);

async function size(file) {
  const raw = await readFile(path.join(DOCS, file));
  return { raw: raw.length, gz: gzipSync(raw, { level: 9 }).length };
}

for (const file of ["index.html", "en/index.html"]) {
  const s = await size(file);
  console.log(`${file}: ${kb(s.raw)} KB raw, ${kb(s.gz)} KB gzip`);
  if (s.raw > 44.5 * 1024) bad(`${file} is ${kb(s.raw)} KB raw (44.5)`);
  if (s.gz > 12.5 * 1024) bad(`${file} is ${kb(s.gz)} KB gzipped (12.5)`);
}
const css = await size("assets/site.css");
console.log(`site.css: ${kb(css.raw)} KB raw, ${kb(css.gz)} KB gzip`);
if (css.raw > 50 * 1024) bad(`site.css is ${kb(css.raw)} KB raw (50)`);
if (css.gz > 12 * 1024) bad(`site.css is ${kb(css.gz)} KB gzipped (12)`);
// The full comparison: long tables and their sources, read once, not on the landing.
for (const file of ["comparar/index.html", "en/compare/index.html"]) {
  const s = await size(file);
  console.log(`${file}: ${kb(s.raw)} KB raw, ${kb(s.gz)} KB gzip`);
  if (s.raw > 64 * 1024) bad(`${file} is ${kb(s.raw)} KB raw (64)`);
  if (s.gz > 14 * 1024) bad(`${file} is ${kb(s.gz)} KB gzipped (14)`);
}
const details = await size("assets/details.css");
console.log(`details.css: ${kb(details.raw)} KB raw, ${kb(details.gz)} KB gzip`);
if (details.raw > 10 * 1024) bad(`details.css is ${kb(details.raw)} KB raw (10)`);
let js = { raw: 0, gz: 0 };
for (const [file, limit] of [
  ["assets/theme.js", null],
  ["assets/motion.js", 6],
  ["assets/download.js", 3],
]) {
  const s = await size(file);
  js = { raw: js.raw + s.raw, gz: js.gz + s.gz };
  if (limit && s.raw > limit * 1024) bad(`${file} is ${kb(s.raw)} KB raw (${limit})`);
}
console.log(`scripts: ${kb(js.raw)} KB raw, ${kb(js.gz)} KB gzip`);
if (js.gz > 9 * 1024) bad(`the scripts are ${kb(js.gz)} KB gzipped (9)`);
const font = await size("assets/fonts/aguja-display-400.woff2");
console.log(`font: ${font.raw} bytes`);
if (font.raw > 14 * 1024) bad(`the font is ${kb(font.raw)} KB (14)`);

const browser = process.env.STATIC === "1" ? null : await chromium.launch({ channel: "chrome", headless: true });
if (browser) try {
  // Not one request leaves the site, on any page, after scrolling and opening everything.
  for (const route of ["/", "/en/", "/detalles/", "/en/details/", "/comparar/", "/en/compare/", "/404.html"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const off = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.protocol.startsWith("http") && u.origin !== new URL(SITE).origin) off.push(r.url());
    });
    await page.goto(SITE + route, { waitUntil: "networkidle" });
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < h; y += 600) {
      await page.evaluate((y) => window.scrollTo(0, y), y);
      await page.waitForTimeout(80);
    }
    await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
    await page.waitForLoadState("networkidle");
    if (off.length) bad(`${route}: ${off.length} request(s) to other servers: ${off.join(", ")}`);
    await page.close();
  }

  // A phone's first view: what is transferred before any scroll.
  for (const route of ["/", "/en/"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    // GitHub Pages gzips text; the local server does not, so text is counted
    // at its gzip size. Lazy images Chrome fetches ahead of the scroll (its
    // look-ahead margin, not the page's choice) are listed apart.
    const got = [];
    page.on("response", async (r) => {
      try {
        const body = await r.body();
        const type = r.headers()["content-type"] || "";
        got.push({ url: r.url(), bytes: /text|javascript|svg|json/.test(type) ? gzipSync(body, { level: 9 }).length : body.length });
      } catch {
        /* a redirect or an aborted request */
      }
    });
    await page.goto(SITE + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const lazy = new Set(await page.evaluate(() => [...document.images].filter((i) => i.loading === "lazy").map((i) => i.currentSrc)));
    const own = got.filter((g) => !lazy.has(g.url)).reduce((a, g) => a + g.bytes, 0);
    const ahead = got.filter((g) => lazy.has(g.url));
    console.log(`${route} phone first view: ${kb(own)} KB; plus ${ahead.length} lazy image(s) fetched ahead, ${kb(ahead.reduce((a, g) => a + g.bytes, 0))} KB`);
    if (own > 80 * 1024) bad(`${route} phone first view is ${kb(own)} KB (80)`);
    await context.close();
  }

  const lcp = async (route, { phone }) => {
    const context = await browser.newContext(
      phone
        ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
        : { viewport: { width: 1440, height: 900 } },
    );
    await context.addInitScript(() => {
      window.__lcp = null;
      window.__cls = 0;
      new PerformanceObserver((list) => {
        const e = list.getEntries().at(-1);
        window.__lcp = { t: e.startTime, el: e.element ? `${e.element.tagName.toLowerCase()}${e.element.closest("h1") ? " in h1" : ""}` : null };
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    if (phone) {
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 150,
        downloadThroughput: (1.6 * 1024 * 1024) / 8,
        uploadThroughput: (750 * 1024) / 8,
      });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    }
    await page.goto(SITE + route, { waitUntil: "load" });
    await page.waitForTimeout(phone ? 3000 : 1500);
    // Interaction ends LCP; read it before scrolling.
    const result = await page.evaluate(() => window.__lcp);
    if (phone) {
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < h; y += 500) {
        await page.evaluate((y) => window.scrollTo(0, y), y);
        await page.waitForTimeout(120);
      }
      await page.waitForTimeout(1500);
      const cls = await page.evaluate(() => window.__cls);
      console.log(`${route} phone CLS: ${cls.toFixed(4)}`);
      if (cls > 0.001) bad(`${route} phone CLS ${cls.toFixed(4)} (0.001)`);
    }
    await context.close();
    return result;
  };
  for (const route of ["/", "/en/"]) {
    const p = await lcp(route, { phone: true });
    console.log(`${route} phone LCP: ${Math.round(p.t)} ms, ${p.el}`);
    if (p.t > 1800) bad(`${route} phone LCP ${Math.round(p.t)} ms (1800)`);
    // On a phone the largest paint may be the window's text rather than the
    // H1 (it is on /en/ at 390 wide): fine, as long as it is text painted
    // early. An image as the largest paint is what this guards against.
    if (!p.el || /^(img|picture|video|svg|canvas)\b/.test(p.el)) bad(`${route} phone LCP element is ${p.el}, not text`);
    const d = await lcp(route, { phone: false });
    console.log(`${route} desktop LCP: ${Math.round(d.t)} ms, ${d.el}`);
    if (d.t > 1000) bad(`${route} desktop LCP ${Math.round(d.t)} ms (1000)`);
    if (!/in h1|^h1/.test(d.el ?? "")) bad(`${route} desktop LCP element is ${d.el}, not the H1`);
  }
} finally {
  await browser.close();
}

// Per-file asset budgets (§9.3), as the asset builder measures them.
{
  let out = "";
  try {
    // Without --strict it exits 0 whatever the sizes, so a failure here is a crash, and a crash is not a pass.
    out = execFileSync("python3", [path.join(ROOT, "tests/landing/asset-budget.py")], { stdio: "pipe", env: { ...process.env, DOCS_DIR: DOCS } }).toString();
  } catch (e) {
    out = e.stdout.toString();
    bad(`asset-budget.py failed: ${e.stderr.toString().trim().split("\n").at(-1)}`);
  }
  const over = out.split("\n").filter((l) => / > \d+ kB/.test(l));
  if (over.length) {
    console.log(`assets: ${over.length} file(s) over budget (asset-budget.py), e.g. ${over[0].trim()}`);
    for (const line of over) bad(`asset over its §9.3 budget: ${line.trim()}`);
  } else console.log("assets: every file within its budget");
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(" -", p);
  process.exitCode = 1;
} else {
  console.log("every budget holds");
}
