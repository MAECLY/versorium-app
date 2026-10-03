// Language lens: compares the Spanish and English landing pages structurally.
// Usage: node tests/landing/language-parity.mjs [baseUrl]
import { chromium } from "@playwright/test";

const base = process.argv[2] || "http://localhost:8715";
const browser = await chromium.launch({ channel: "chrome" });
const out = {};

for (const [lang, path] of [["es", "/"], ["en", "/en/"]]) {
  const page = await browser.newPage();
  const errors = [];
  const failed = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("requestfailed", (r) => failed.push(r.url()));
  page.on("response", (r) => r.status() >= 400 && failed.push(r.status() + " " + r.url()));
  await page.goto(base + path, { waitUntil: "networkidle" });
  // Force-load lazy images.
  await page.evaluate(() => document.querySelectorAll("img").forEach((i) => (i.loading = "eager")));
  await page.waitForTimeout(500);
  const data = await page.evaluate(() => {
    const q = (s) => [...document.querySelectorAll(s)];
    const sections = q("main section").map((s) => ({
      id: s.id,
      h: q.call(null, "#" + (s.id || "x") + " h1, #" + (s.id || "x") + " h2").map((h) => h.textContent.trim()),
      paras: s.querySelectorAll("p").length,
      li: s.querySelectorAll("li").length,
      dt: s.querySelectorAll("dt").length,
      details: s.querySelectorAll("details").length,
      imgs: s.querySelectorAll("img").length,
      pre: s.querySelectorAll("pre").length,
      notes: s.querySelectorAll(".note").length,
      links: s.querySelectorAll("a").length,
      kbd: s.querySelectorAll("kbd").length,
      code: s.querySelectorAll("code").length,
      b: s.querySelectorAll("b, strong").length,
      words: s.innerText.split(/\s+/).filter(Boolean).length,
    }));
    const imgs = q("img").map((i) => ({ alt: i.alt, src: i.currentSrc, ok: i.complete && i.naturalWidth > 0 }));
    const aria = q("[aria-label]").map((e) => e.getAttribute("aria-label"));
    const ld = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);
    const faq = ld["@graph"].find((n) => n["@type"] === "FAQPage").mainEntity;
    const visibleFaq = q(".faq details").map((d) => ({
      q: d.querySelector("summary").textContent.trim(),
      a: [...d.querySelectorAll(".answer p")].map((p) => p.textContent.trim()).join(" "),
    }));
    const faqMatch = faq.map((f, i) => ({
      qSame: f.name === visibleFaq[i]?.q,
      aSame: f.acceptedAnswer.text === visibleFaq[i]?.a,
    }));
    return {
      lang: document.documentElement.lang,
      title: document.title,
      ogLocale: document.querySelector('meta[property="og:locale"]').content,
      ogAlt: document.querySelector('meta[property="og:locale:alternate"]').content,
      hreflang: q('link[rel="alternate"][hreflang]').map((l) => l.hreflang + "=" + l.href),
      canonical: document.querySelector('link[rel="canonical"]').href,
      langLinks: q("a[hreflang]").map((a) => a.hreflang + "->" + a.href),
      sections,
      imgs,
      aria,
      faqMatch,
      themeAttr: document.documentElement.getAttribute("data-theme"),
    };
  });
  // Exercise the picker and capture the localized dynamic alt.
  await page.click('#theme-picker input[name="theme"][value="quarry"]', { force: true });
  await page.click('#theme-picker input[name="mode"][value="dark"]', { force: true });
  data.dynamicAlt = await page.evaluate(() => document.querySelector("picture[data-shot-pinned] img").alt);
  data.dynamicSrc = await page.evaluate(() => document.querySelector("picture[data-shot-pinned] img").getAttribute("src"));
  await page.click('#theme-picker input[name="mode"][value="follow"]', { force: true });
  await page.click('#theme-picker input[name="theme"][value="needle"]', { force: true });
  // Copy button status text.
  data.errors = errors;
  data.failed = failed;
  out[lang] = data;
  await page.close();
}
await browser.close();

console.log(JSON.stringify(out, null, 1));
