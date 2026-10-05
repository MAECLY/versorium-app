// Language lens: the Spanish and English pages say the same things in the same
// shape (site spec §12.7): the same sections in the same order, the same
// headings per level, the same FAQ and limits counts, the same pictures per
// section, the same buttons and links per section; and each page's FAQ
// JSON-LD equals its visible answers. Also the details pages. Per section,
// also: the same picture files (shots/es/x ↔ shots/en/x), the same links to
// other sites, the same behaviour hooks (data-reveal, data-clip, data-share,
// data-phone, data-desktop, data-os) and the same number of ids; per page,
// hreflang pointing at each other, the same JSON-LD node types, and the same
// <head> resources.
//
//   node tests/landing/language-parity.mjs [baseUrl]   (or SITE_URL=…)

import { chromium } from "@playwright/test";

const base = process.argv[2] || process.env.SITE_URL || "http://localhost:8700";
const browser = await chromium.launch({ channel: "chrome" });
const problems = [];

async function shape(route) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(base + route, { waitUntil: "networkidle" });
  const data = await page.evaluate(() => {
    const q = (root, s) => [...root.querySelectorAll(s)];
    const sections = q(document, "main section, main > .wrap > .prose > section").map((s) => ({
      tag: s.className.split(" ").find((c) => c.startsWith("s-") || c === "hero" || c === "closing") || "section",
      h: q(s, "h1, h2, h3").map((h) => h.tagName),
      p: s.querySelectorAll("p").length,
      li: s.querySelectorAll("li").length,
      img: s.querySelectorAll("img").length,
      picture: s.querySelectorAll("picture").length,
      details: s.querySelectorAll("details").length,
      buttons: s.querySelectorAll("button").length,
      links: s.querySelectorAll("a").length,
      svg: s.querySelectorAll("svg").length,
      files: q(s, "img, source")
        .map((e) => (e.getAttribute("src") || e.getAttribute("srcset") || "").split(/[\s,]+/)[0])
        .map((u) => new URL(u, location.href).pathname.replace(/\/(es|en)\//, "/<lang>/").split("/").slice(-2).join("/")),
      external: q(s, "a[href]")
        .map((a) => a.href)
        // This site's own pages, even linked by their public address (the
        // comparison's sources cite the details page in each page's language).
        .filter((h) => !h.startsWith(location.origin) && !h.startsWith("https://versorium.maecly.com/"))
        // A mail's subject and body are in the page's language.
        .map((h) => (h.startsWith("mailto:") ? "mailto:" : h))
        .sort(),
      hooks: ["data-reveal", "data-clip", "data-share", "data-phone", "data-desktop", "data-os"].map((h) => `${h}:${s.querySelectorAll(`[${h}]`).length}`),
      ids: s.querySelectorAll("[id]").length,
    }));
    const ld = document.querySelector('script[type="application/ld+json"]');
    let faq = null;
    if (ld) {
      const node = JSON.parse(ld.textContent)["@graph"].find((n) => n["@type"] === "FAQPage");
      if (node) {
        document.querySelectorAll(".faq details").forEach((d) => (d.open = true));
        const visible = q(document, ".faq details").map((d) => ({ q: d.querySelector("summary").textContent.trim(), a: d.querySelector(".answer").textContent.replace(/\s+/g, " ").trim() }));
        faq = node.mainEntity.map((f, i) => f.name === visible[i]?.q && f.acceptedAnswer.text === visible[i]?.a);
      }
    }
    const graph = ld ? JSON.parse(ld.textContent)["@graph"].map((n) => n["@type"]) : [];
    return {
      graph,
      canonical: document.querySelector('link[rel="canonical"]')?.href,
      alternates: Object.fromEntries(q(document, 'link[rel="alternate"][hreflang]').map((l) => [l.hreflang, l.href])),
      headResources: q(document, "head link[href], head script[src]")
        .filter((e) => !["canonical", "alternate"].includes(e.getAttribute("rel")))
        .map((e) => `${e.tagName}:${e.getAttribute("rel") || ""}:${new URL(e.getAttribute("href") || e.getAttribute("src"), location.href).pathname.replace(/^\/en\//, "/")}`),
      lang: document.documentElement.lang,
      sections,
      limits: q(document, ".limits li, .limit-list li").length,
      faq,
      headerLinks: q(document, ".topbar a").length,
      footerLinks: q(document, ".footer a").length,
    };
  });
  data.errors = errors;
  await page.close();
  return data;
}

// Section ids are translated (#comparar, #compare…): their counts are compared, not their names.
for (const [es, en] of [
  ["/", "/en/"],
  ["/detalles/", "/en/details/"],
  ["/comparar/", "/en/compare/"],
]) {
  const a = await shape(es);
  const b = await shape(en);
  const where = `${es} ↔ ${en}`;
  if (a.lang !== "es" || b.lang !== "en") problems.push(`${where}: lang ${a.lang}/${b.lang}`);
  if (a.sections.length !== b.sections.length) problems.push(`${where}: ${a.sections.length} vs ${b.sections.length} sections`);
  a.sections.forEach((s, i) => {
    const t = b.sections[i];
    if (!t) return;
    for (const k of Object.keys(s)) {
      if (JSON.stringify(s[k]) !== JSON.stringify(t[k])) problems.push(`${where}: section ${i + 1} (${s.tag}) ${k}: ${JSON.stringify(s[k])} vs ${JSON.stringify(t[k])}`);
    }
  });
  for (const k of ["limits", "headerLinks", "footerLinks"]) if (a[k] !== b[k]) problems.push(`${where}: ${k} ${a[k]} vs ${b[k]}`);
  for (const k of ["graph", "headResources"]) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) problems.push(`${where}: ${k} ${JSON.stringify(a[k])} vs ${JSON.stringify(b[k])}`);
  // Each page names the other as its translation, and itself as its own.
  if (a.alternates.es !== a.canonical || a.alternates.en !== b.canonical) problems.push(`${es}: hreflang es=${a.alternates.es} en=${a.alternates.en}`);
  if (b.alternates.en !== b.canonical || b.alternates.es !== a.canonical) problems.push(`${en}: hreflang es=${b.alternates.es} en=${b.alternates.en}`);
  if (JSON.stringify(a.alternates) !== JSON.stringify(b.alternates)) problems.push(`${where}: the hreflang sets differ`);
  for (const [route, d] of [
    [es, a],
    [en, b],
  ]) {
    if (d.faq && d.faq.some((ok) => !ok)) problems.push(`${route}: FAQ JSON-LD differs from the visible answers`);
    for (const e of d.errors) problems.push(`${route}: ${e}`);
  }
  console.log(`${where}: ${a.sections.length} sections, ${a.limits} limits each`);
}
await browser.close();
if (problems.length) {
  console.log(`\n${problems.length} difference(s):`);
  for (const p of problems) console.log(" -", p);
  process.exitCode = 1;
} else {
  console.log("both languages have the same shape");
}
