// Gate G3 (site spec §12.6): every link that leaves the site answers, and the
// site itself is served on its domain with a valid certificate. It cannot pass
// while the repository is private (G1) and Pages is off (G2); it is the check
// to run before promoting the page, not a CI step until then.
//
//   node tests/landing/links-live.mjs

import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const FILES = ["docs/index.html", "docs/en/index.html", "docs/detalles/index.html", "docs/en/details/index.html", "docs/404.html", "docs/llms.txt", "docs/agents.txt"];
const SITE_PAGES = ["https://versorium.maecly.com/", "https://versorium.maecly.com/en/", "https://versorium.maecly.com/detalles/", "https://versorium.maecly.com/en/details/"];

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

const problems = [];
for (const url of [...links].sort()) {
  let status = 0;
  try {
    let res = await fetch(url, { method: "HEAD", redirect: "follow" });
    // Some hosts refuse HEAD; ask again with GET before calling it broken.
    if (res.status === 405 || res.status === 403) res = await fetch(url, { method: "GET", redirect: "follow" });
    status = res.status;
  } catch (e) {
    status = `${e.cause?.code ?? e.message}`;
  }
  console.log(`${String(status).padEnd(24)} ${url}`);
  if (status !== 200) problems.push(`${url} → ${status}`);
}

if (problems.length) {
  console.log(`\n${problems.length} link(s) do not answer 200 (expected until gates G1 and G2 pass):`);
  for (const p of problems) console.log(" -", p);
  process.exitCode = 1;
} else {
  console.log("every link answers");
}
