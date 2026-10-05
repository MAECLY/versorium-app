// Before re-dating the comparison: open every source page in Chrome and check
// that each cell's quoted words (comparison-data.mjs `quote`) are still on the
// pages that cell cites. A status code cannot tell when a page still answers
// but has changed what it says; this can. Needs the network; not a CI gate.
//
//   node tests/landing/sources-live.mjs            # every source
//   node tests/landing/sources-live.mjs dabble     # one app's cells only
//
// A missing quote means: read that page again, then fix the cell (or show a
// dash) and re-date the data (AS_OF) before running compare-build.mjs.

import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { APPS, FOUNDING, SOURCES } from "./comparison-data.mjs";

const only = process.argv[2];
const norm = (s) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[ ⁠​]/g, " ").replace(/\s+/g, " ").trim();

// Every quote, with the sources its cell cites.
const checks = [];
for (const a of APPS) {
  if (only && a.id !== only) continue;
  const cells = Object.entries(a).filter(([, c]) => c && typeof c === "object" && "s" in c);
  for (const [k, c] of [...cells, ...Object.entries(a.landing ?? {}).map(([k, c]) => [`landing.${k}`, c])]) {
    for (const q of c.quote ?? []) checks.push({ where: `${a.id}.${k}`, quote: q, src: c.src ?? [] });
  }
}
for (const r of FOUNDING.rows) {
  if (only && r.id !== only) continue;
  for (const [k, c] of Object.entries(r)) {
    if (!c || typeof c !== "object") continue;
    // A founding cell may quote one of its row's sources.
    const src = c.src?.length ? c.src : Object.entries(SOURCES).filter(([, s]) => s.app === r.id).map(([id]) => id);
    for (const q of c.quote ?? []) checks.push({ where: `founding ${r.id}.${k}`, quote: q, src });
  }
}
const needed = [...new Set(checks.flatMap((c) => c.src))];

const text = {};
const failed = {};
const tmp = await mkdtemp(path.join(os.tmpdir(), "versorium-sources-"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "en-US" });
async function read(id) {
  const url = SOURCES[id].url;
  try {
    if (/\.pdf($|\?)/.test(url)) {
      const res = await fetch(url);
      const file = path.join(tmp, `${id}.pdf`);
      await writeFile(file, Buffer.from(await res.arrayBuffer()));
      text[id] = norm(execFileSync("pdftotext", [file, "-"]).toString());
      return;
    }
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    } catch {
      /* a page that never goes idle has drawn its text by now */
    }
    await page.waitForTimeout(2500);
    // textContent: hidden tabs and closed answers count (a store's other platform, a FAQ).
    text[id] = norm(await page.evaluate(() => `${document.title} ${document.body.textContent} ${document.body.innerText}`));
    await page.close();
  } catch (e) {
    failed[id] = e.message.split("\n")[0];
  }
}
for (let i = 0; i < needed.length; i += 5) await Promise.all(needed.slice(i, i + 5).map(read));
await browser.close();

const problems = [];
for (const c of checks) {
  const pages = c.src.map((id) => text[id]).filter(Boolean);
  if (!pages.length) {
    problems.push(`${c.where}: none of its sources could be read (${c.src.map((id) => `${id}: ${failed[id] ?? "no text"}`).join("; ")})`);
    continue;
  }
  if (!pages.some((t) => t.includes(norm(c.quote)))) problems.push(`${c.where}: “${c.quote}” is no longer on ${c.src.join(", ")}`);
}
console.log(`${checks.length} quotes on ${needed.length} source pages`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(" -", p);
  process.exitCode = 1;
} else {
  console.log("every quoted fact is still on its source page");
}
