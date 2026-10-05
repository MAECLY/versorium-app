// Gate G3 (site spec §12.6): every link that leaves the site answers, and the
// site itself is served on its domain with a valid certificate. It cannot pass
// while the repository is private (G1) and Pages is off (G2); it is the check
// to run before promoting the page, not a CI step until then.
//
//   node tests/landing/links-live.mjs

import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const FILES = ["docs/index.html", "docs/en/index.html", "docs/detalles/index.html", "docs/en/details/index.html", "docs/comparar/index.html", "docs/en/compare/index.html", "docs/404.html", "docs/llms.txt", "docs/agents.txt"];
const SITE_PAGES = ["https://versorium.maecly.com/", "https://versorium.maecly.com/en/", "https://versorium.maecly.com/detalles/", "https://versorium.maecly.com/en/details/", "https://versorium.maecly.com/comparar/", "https://versorium.maecly.com/en/compare/"];

const links = new Set();
for (const file of FILES) {
  const text = await readFile(path.join(ROOT, file), "utf8");
  for (const m of text.matchAll(/https:\/\/[^\s"'<>)\]]+/g)) {
    const url = m[0].replace(/[.,;:]+$/, "").replace(/&amp;/g, "&");
    // Identifiers, not links: schema.org types and the JSON-LD @ids.
    if (url.startsWith("https://schema.org") || url.includes("#website") || url.includes("#miguel") || url.includes("#software") || url.includes("#faq") || url.includes("#webpage")) continue;
    links.add(url.split("#")[0]);
  }
}
for (const page of SITE_PAGES) links.add(page);

// A page behind a bot check (403 or 429 to a script) is opened in Chrome: it
// counts if a browser gets the page itself, not the check.
let browser = null;
async function inBrowser(url) {
  if (!browser) {
    const { chromium } = await import("@playwright/test");
    browser = await chromium.launch({ channel: "chrome", headless: true });
  }
  const page = await browser.newPage();
  try {
    const res = await page.goto(url, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(3000);
    const title = await page.title();
    return res && res.status() < 400 && !/just a moment|attention required|access denied/i.test(title) ? 200 : res?.status() ?? 0;
  } catch (e) {
    return e.message.split("\n")[0];
  } finally {
    await page.close();
  }
}

const problems = [];
for (const url of [...links].sort()) {
  let status = 0;
  let how = "";
  try {
    let res = await fetch(url, { method: "HEAD", redirect: "follow" });
    // Some hosts refuse or mishandle HEAD (405, 403, even 404 on a page that
    // exists); ask again with GET before calling it broken.
    if (res.status !== 200) res = await fetch(url, { method: "GET", redirect: "follow" });
    status = res.status;
  } catch (e) {
    status = `${e.cause?.code ?? e.message}`;
  }
  if (status === 403 || status === 429) {
    status = await inBrowser(url);
    how = " (in a browser)";
  }
  console.log(`${`${status}${how}`.padEnd(24)} ${url}`);
  if (status !== 200) problems.push(`${url} → ${status}`);
}
if (browser) await browser.close();

if (problems.length) {
  console.log(`\n${problems.length} link(s) do not answer 200 (expected until gates G1 and G2 pass):`);
  for (const p of problems) console.log(" -", p);
  process.exitCode = 1;
} else {
  console.log("every link answers");
}
