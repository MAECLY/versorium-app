// Gate "compare" (verify.mjs): the comparison on the landing pages (section
// IV) and on the full pages (/comparar/, /en/compare/) says exactly what
// comparison-data.mjs says, and the data keeps its own rules:
//   1. the landing table's shape, columns and links; Versorium's note is the
//      hero pill's own words, but for naming the release series (v0.1) where
//      the pill names one release (v0.1.0): every claim in the column holds
//      for the series' newest release, which the data cites;
//   2. every cell, on every table, equals its data; a dash appears exactly
//      where the website doesn't say, with its words for screen readers;
//   3. a "No" about another app is the vendor's own, quoted (and a cell that
//      reads like a "No" is marked as one);
//   4. every "three years" figure, and every other computed cell, is its
//      arithmetic;
//   5. both languages give the same amounts;
//   6. every source is listed once, dated, and every row and cell points at
//      sources that exist;
//   7. the pages carry the date the data was read; 8. it is not stale (a
//      warning after 90 days, a failure after 180);
//   9. the release facts (series, versions named, changes in the first three
//      weeks, dates) come from git; a release newer than the one the data
//      cites is a warning; 10. no logos; 11. the licence is the repository's;
//  12. the tables' layout, from 320 to 1440 px: a column at rest is never
//      partly under the pinned ones (their width is the snap padding, and a
//      table loads scrolled to its start), and no word breaks in the middle.
//
//   SITE_URL=http://localhost:8700 node tests/landing/compare-parity.mjs
//   COMPARE_TODAY=2027-06-01 …    # pretend today is another day (staleness)
//   COMPARE_WIDTHS=360,1280 …     # rule 12 at these widths only

import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { APPS, AS_OF, FOUNDING, GROUPS, LANDING, LANDING_ROWS, SOURCES, TABLE_A, TABLE_B } from "./comparison-data.mjs";
import { firstRelease, LANDING_COPY, PAGE } from "./compare-build.mjs";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const DOCS = process.env.DOCS_DIR ?? path.join(ROOT, "docs");
const SITE = process.env.SITE_URL ?? "http://localhost:8700";
const problems = [];
const warnings = [];
const bad = (where, what) => problems.push(`${where}: ${what}`);
const byId = Object.fromEntries(APPS.map((a) => [a.id, a]));
const DASH = { es: "Su web no lo dice", en: "Not stated on its website" };
const norm = (s) => s.replace(/ /g, " ").replace(/⁠/g, "").replace(/\s+/g, " ").trim();
/** What a data cell should read on the page: a dash where its website doesn't say. */
const want = (c, lang) => (!c || c.s === "ns" ? "—" : norm(c[lang]));

// ---------------------------------------------------------------- the data's own rules

const cells = [];
for (const a of APPS) {
  for (const k of ["type", ...TABLE_A, ...TABLE_B]) cells.push({ app: a, key: k, c: a[k] });
  for (const [k, c] of Object.entries(a.landing ?? {})) cells.push({ app: a, key: `landing.${k}`, c });
}
for (const r of FOUNDING.rows) for (const k of Object.keys(FOUNDING.columns)) cells.push({ app: byId[r.id], key: `founding.${k}`, c: r[k], founding: true });

for (const { app, key, c, founding } of cells) {
  const where = `data ${app?.id ?? "?"}.${key}`;
  if (!app) {
    bad(where, "names an app that is not in APPS");
    continue;
  }
  if (!c) {
    bad(where, "missing (use ns() for a fact its website doesn't state)");
    continue;
  }
  if (!["y", "n", "ns", "calc", "code"].includes(c.s)) bad(where, `unknown kind "${c.s}"`);
  if (c.s !== "ns" && (typeof c.es !== "string" || typeof c.en !== "string" || !c.es || !c.en)) bad(where, "has no text in one language");
  for (const id of c.src ?? []) if (!SOURCES[id]) bad(where, `cites "${id}", which is not a source`);
  const competitor = app.id !== "versorium";
  // Rule 3: a "No" about another app is the vendor's own words, kept verbatim.
  if (c.s === "n" && (!(c.quote ?? []).length || (!founding && !(c.src ?? []).length) || (founding && !(c.src ?? []).length))) bad(where, "a “No” about another app without the vendor’s quote and source");
  if (competitor && c.s !== "n" && c.s !== "ns" && /^(no\b|none\b|not\b)|online only|coming soon|not yet/i.test(c.en ?? "")) bad(where, `reads like a “No” (“${c.en}”) but is not marked as the vendor’s own (s "n" with its quote)`);
  if (competitor && !founding && ["y", "n", "calc"].includes(c.s) && !(c.src ?? []).length) bad(where, "states something about another app without a source");
  if (competitor && key.startsWith("landing.") && c.s !== "ns" && !(c.quote ?? []).length) bad(where, "a landing cell without the vendor’s words to re-read");
  if (c.s === "code" && competitor) bad(where, "kind “code” is for Versorium only");
}

// Rule 4: the arithmetic; rule 5: the same amounts in both languages.
// Spanish lists put one sign after the last amount: "19, 29 o 49 $" is three.
const NUM_ES = "\\d{1,3}(?:\\.\\d{3})*(?:,\\d{2})?";
const amountsEs = (s) =>
  [...(s ?? "").matchAll(new RegExp(`(?<![\\d.,])((?:${NUM_ES}(?:, | o | y ))*${NUM_ES})\\s?\\$`, "g"))].flatMap((m) => m[1].split(/, | o | y /).map((x) => Number(x.replace(/\./g, "").replace(",", "."))));
const amountsEn = (s) => [...(s ?? "").matchAll(/\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)(?:[–-](\d+(?:\.\d{2})?))?/g)].flatMap((m) => [Number(m[1].replace(/,/g, "")), ...(m[2] ? [Number(m[2])] : [])]);
const rangeEs = (s) => [...(s ?? "").matchAll(/(\d+,\d{2})–(\d+,\d{2})\s*\$/g)].flatMap((m) => [Number(m[1].replace(",", ".")), Number(m[2].replace(",", "."))]);
for (const { app, key, c } of cells) {
  if (!c || c.s === "ns") continue;
  const es = rangeEs(c.es).length ? rangeEs(c.es) : amountsEs(c.es);
  const en = amountsEn(c.en);
  if (JSON.stringify(es) !== JSON.stringify(en)) bad(`data ${app.id}.${key}`, `amounts differ between languages: ${JSON.stringify(es)} vs ${JSON.stringify(en)}`);
  if (key === "three" || key === "landing.three" || c.s === "calc") {
    if (!c.calc) {
      bad(`data ${app.id}.${key}`, "a three-year figure without its arithmetic");
      continue;
    }
    const parts = c.calc.split("–").map((x) => Math.round(Function(`"use strict"; return (${x.trim()});`)() * 100) / 100);
    if (JSON.stringify(parts) !== JSON.stringify(en)) bad(`data ${app.id}.${key}`, `${c.calc} = ${parts.join("–")}, but the cell says ${c.en}`);
  }
}

// Rule 6 (data side): every source belongs to a row or to the AI the writer may already pay for.
for (const [id, s] of Object.entries(SOURCES)) {
  if (s.app !== "ai" && !byId[s.app]) bad(`source ${id}`, `belongs to “${s.app}”, which is not a row`);
  for (const u of [s.url, s.urlEn].filter(Boolean)) if (!/^https:\/\//.test(u)) bad(`source ${id}`, `is not an https address: ${u}`);
  if (!s.es || !s.en) bad(`source ${id}`, "says what it supports in one language only");
}
const urls = Object.values(SOURCES).map((s) => s.url);
for (const u of new Set(urls)) if (urls.filter((x) => x === u).length > 1) bad("sources", `${u} is listed twice`);
for (const a of APPS) if (a.id !== "versorium" && !Object.values(SOURCES).some((s) => s.app === a.id)) bad(`data ${a.id}`, "a row with no source of its own");

// Rule 8: staleness.
const today = process.env.COMPARE_TODAY ? new Date(`${process.env.COMPARE_TODAY}T12:00:00Z`) : new Date();
const age = Math.floor((today - new Date(`${AS_OF}T12:00:00Z`)) / 86400000);
if (age > 180) bad("dates", `the comparison was read on ${AS_OF}, ${age} days ago: re-read the sources (sources-live.mjs) and re-date it`);
else if (age > 90) warnings.push(`the comparison was read on ${AS_OF}, ${age} days ago; re-date it soon`);

// Rule 9 (repository side), rule 11: the licence.
const release = firstRelease();
const git = (...a) => execFileSync("git", ["-C", ROOT, ...a], { stdio: "pipe" }).toString().trim();
const tags = git("tag", "--list", "v*", "--sort=-v:refname").split("\n").filter(Boolean);
// The landing's note names a series (v0.1); its sources cite the first release and the series' newest.
const series = byId.versorium.landing.note.en.match(/^v(\d+\.\d+) · /)?.[1];
const inSeries = tags.filter((t) => series && t.startsWith(`v${series}.`));
if (!series) bad("data versorium.landing.note", `“${byId.versorium.landing.note.en}” does not start with a release series (v0.1 · …)`);
else if (!inSeries.length) bad("data versorium.landing.note", `no release tag in v${series}`);
const cited = SOURCES["vs-release"].url.match(/\/releases\/tag\/(v[\d.]+)$/)?.[1];
if (!cited || !tags.includes(cited)) bad("source vs-release", `${SOURCES["vs-release"].url} is not a release tag of the repository`);
else if (series && !cited.startsWith(`v${series}.`)) bad("source vs-release", `cites ${cited}, outside the note's v${series}`);
else if (inSeries[0] && inSeries[0] !== cited) warnings.push(`${inSeries[0]} is newer than the release Versorium's column cites (${cited}): check the column against it, then cite it (vs-release)`);
if (!SOURCES["vs-first"].url.endsWith(`/releases/tag/${release.tag}`)) bad("source vs-first", `does not cite the first release, ${release.tag}`);
if (tags[0] && !inSeries.includes(tags[0])) warnings.push(`${tags[0]} is out: Versorium's column names v${series}`);
const licence = (await readFile(path.join(ROOT, "LICENSE"), "utf8")).slice(0, 400);
if (!/GNU AFFERO GENERAL PUBLIC LICENSE/.test(licence) || !/Version 3/.test(licence)) bad("licence", "LICENSE is not the GNU AGPL v3 the pages name");
for (const a of [byId.versorium.open, byId.versorium.landing.threeNote]) if (!/AGPL-3\.0|código abierto|open source/.test(`${a.es} ${a.en}`)) bad("licence", `Versorium's cell “${a.en}”`);

// ---------------------------------------------------------------- the pages

const MONTH = { es: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"], en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] };
const longDate = (iso, lang) => {
  const [y, m, d] = iso.split("-").map(Number);
  return lang === "es" ? `${d} de ${MONTH.es[m - 1]} de ${y}` : `${d} ${MONTH.en[m - 1]} ${y}`;
};
const monthYear = (iso, lang) => {
  const [y, m] = iso.split("-").map(Number);
  return lang === "es" ? `${MONTH.es[m - 1]} de ${y}` : `${MONTH.en[m - 1]} ${y}`;
};

/** In the page: a table's rows as text, each cell's dash folded back to "—" and its second line apart. */
function readTable(sel) {
  const table = document.querySelector(sel);
  if (!table) return null;
  const text = (el) => {
    const c = el.cloneNode(true);
    const smalls = [...c.querySelectorAll("small")].map((s) => s.textContent);
    c.querySelectorAll("small, svg").forEach((s) => s.remove());
    const dashes = [...c.querySelectorAll(".vs-dash")].map((d) => ({ shown: d.textContent, aria: d.getAttribute("aria-hidden"), sr: d.nextElementSibling?.classList.contains("sr-only") ? d.nextElementSibling.textContent : null }));
    c.querySelectorAll(".vs-dash + .sr-only").forEach((s) => s.remove());
    const sr = [...c.querySelectorAll(".sr-only")].map((s) => s.textContent);
    c.querySelectorAll(".sr-only").forEach((s) => s.remove());
    const links = [...c.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    return { text: c.textContent, smalls, dashes, links, sr };
  };
  return {
    head: [...table.querySelectorAll("thead tr > *")].map((h) => ({ tag: h.tagName, ...text(h) })),
    rows: [...table.querySelectorAll("tbody tr")].map((tr) => ({ group: tr.classList.contains("vs-group"), us: tr.classList.contains("is-us"), id: tr.id || null, cells: [...tr.children].map((c) => ({ tag: c.tagName, cls: c.className, ...text(c) })) })),
  };
}

const LAYOUT_WIDTHS = (process.env.COMPARE_WIDTHS ?? "320,360,375,390,414,430,599,600,640,700,768,959,1024,1280,1440").split(",").map(Number);

/** In the page, rule 12: what a visitor at this width would see go wrong in the comparison's tables. */
async function layoutProblems() {
  const problems = [];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const sc of document.querySelectorAll(".s-vs .vs-scroll, .vs-full")) {
    const table = sc.querySelector("table.vs");
    if (!table) continue;
    const name = `table.${table.className.split(" ").join(".")}`;
    // A word split over two lines. Breaks a word allows (a hyphen, a dash, a
    // soft hyphen, <wbr>) are not splits; Chrome counts a soft hyphen's
    // drawn "-" in the next word's first box, which is left out.
    const walker = document.createTreeWalker(table, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentElement.closest(".sr-only")) continue;
      for (const m of n.textContent.matchAll(/[\p{L}\p{N}][\p{L}\p{N}’'.,]*[\p{L}\p{N}]/gu)) {
        const range = document.createRange();
        range.setStart(n, m.index);
        range.setEnd(n, m.index + m[0].length);
        let boxes = [...range.getClientRects()].filter((q) => q.width > 0);
        if (n.textContent[m.index - 1] === "­") boxes = boxes.slice(1);
        if (new Set(boxes.map((q) => Math.round(q.top))).size > 1) problems.push(`${name}: “${m[0]}” breaks in the middle`);
      }
    }
    if (sc.scrollWidth <= sc.clientWidth + 1) continue;
    // A table that scrolls sideways loads at its start, and stays there when sent back to it.
    if (Math.round(sc.scrollLeft) !== 0) problems.push(`${name} loads scrolled ${Math.round(sc.scrollLeft)}px sideways`);
    sc.scrollLeft = sc.scrollWidth;
    await wait(120);
    sc.scrollLeft = 0;
    await wait(250);
    if (Math.round(sc.scrollLeft) !== 0) problems.push(`${name}, sent back to its start, rests ${Math.round(sc.scrollLeft)}px sideways`);
    // The pinned columns are as wide as the snap padding, so every column comes to rest beside them, not under them.
    const pinned = [...table.querySelectorAll("th, td")].filter((c) => getComputedStyle(c).position === "sticky");
    if (!pinned.length) continue;
    const left = sc.getBoundingClientRect().left + sc.clientLeft;
    const right = Math.max(...pinned.map((c) => c.getBoundingClientRect().right)) - left;
    const pad = parseFloat(getComputedStyle(sc).scrollPaddingInlineStart) || 0;
    if (Math.abs(right - pad) > 1) problems.push(`${name}: the pinned columns end at ${Math.round(right)}px but the snap padding is ${Math.round(pad)}px, so a column at rest is ${Math.round(right - pad)}px under them`);
    const first = [...table.querySelectorAll("tbody tr:not(.vs-group) > td")].find((c) => !pinned.includes(c));
    if (first && first.getBoundingClientRect().left - left < right - 1) problems.push(`${name}: its first column starts ${Math.round(right - (first.getBoundingClientRect().left - left))}px under the pinned ones`);
  }
  return problems;
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const lang of ["es", "en"]) {
    const t = LANDING_COPY[lang];
    const p = PAGE[lang];
    // ------------------------------------------------ the landing (IV)
    const landingRoute = lang === "es" ? "/" : "/en/";
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(SITE + landingRoute, { waitUntil: "load" });
    const L = await page.evaluate(readTable, ".s-vs table.vs");
    const where = `${landingRoute} comparison`;
    const extra = await page.evaluate(() => {
      const s = document.querySelector(".s-vs");
      const ld = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)["@graph"].find((n) => n["@type"] === "SoftwareApplication");
      const pill = document.querySelector(".pill");
      return {
        id: s?.id,
        cap: document.querySelector(".s-vs .vs-cap")?.textContent ?? "",
        notes: [...document.querySelectorAll(".s-vs .vs-notes p")].map((x) => x.textContent),
        more: [...document.querySelectorAll(".s-vs .vs-more a")].map((a) => a.getAttribute("href")),
        imgs: s ? s.querySelectorAll("img, picture").length : -1,
        svgs: s ? [...s.querySelectorAll("svg")].map((g) => g.getAttribute("class") || (g.closest(".ink-rule") ? "ink-rule" : "?")) : [],
        version: ld?.softwareVersion,
        pill: pill ? pill.textContent.trim() : null,
        labelled: document.querySelector(".s-vs table.vs")?.getAttribute("aria-labelledby"),
      };
    });
    if (!L) {
      bad(where, "no comparison table");
      await page.close();
      continue;
    }
    if (extra.id !== t.id) bad(where, `the section's id is “${extra.id}”, not “${t.id}”`);
    if (extra.labelled !== "vs-cap") bad(where, "the table is not named by its caption");
    // 1. Shape, columns, links.
    const [corner, us, ...them] = L.head;
    if (L.head.length !== 7) bad(where, `${L.head.length} columns, not 7`);
    if (corner?.tag !== "TD" || norm(corner.text) !== "" || corner.sr[0] !== t.corner) bad(where, "the corner cell is not a <td> whose words are for screen readers only");
    if (norm(us?.text ?? "") !== "Versorium") bad(where, `the first column is “${norm(us?.text ?? "")}”`);
    const note = norm(us?.smalls[0] ?? "");
    if (note !== want(byId.versorium.landing.note, lang)) bad(where, `Versorium's note “${note}” is not the data's`);
    // 9. The note names the series of the release in force: the hero pill's
    //    words, but for the pill's patch number; the pill's release is the
    //    JSON-LD's softwareVersion and a tag.
    const noteParts = note.match(/^v(\d+\.\d+) · (.+)$/);
    const pillParts = extra.pill?.match(/^v((\d+\.\d+)\.\d+) · (.+)$/);
    if (!noteParts || !pillParts) bad(where, `Versorium's note “${note}” and the hero pill “${extra.pill}” are not both “v<version> · <where it was tried>”`);
    else {
      if (noteParts[1] !== pillParts[2]) bad(where, `Versorium's note names v${noteParts[1]}, the hero pill v${pillParts[1]}`);
      if (noteParts[2] !== pillParts[3]) bad(where, `Versorium's note “${noteParts[2]}” is not the hero pill's “${pillParts[3]}”`);
      if (pillParts[1] !== extra.version) bad(where, `the hero pill's v${pillParts[1]} is not the JSON-LD's softwareVersion ${extra.version}`);
      if (!tags.includes(`v${pillParts[1]}`)) bad(where, `there is no tag v${pillParts[1]}`);
    }
    LANDING.slice(1).forEach((id, i) => {
      const h = them[i];
      const name = byId[id].name.replace(/ \d+$/, "");
      if (!h || norm(h.text) !== name) bad(where, `column ${i + 2} is “${norm(h?.text ?? "")}”, not ${name}`);
      else if (h.links[0] !== `${t.page}#${id}`) bad(where, `${name} links to ${h.links[0]}, not ${t.page}#${id}`);
    });
    // 2. Cells.
    if (L.rows.length !== LANDING_ROWS.length) bad(where, `${L.rows.length} rows, not ${LANDING_ROWS.length}`);
    L.rows.forEach((row, r) => {
      const key = LANDING_ROWS[r];
      if (row.cells.length !== 7) bad(where, `row ${r + 1} has ${row.cells.length} cells`);
      if (row.cells[0]?.tag !== "TH") bad(where, `row ${r + 1} has no row header`);
      LANDING.forEach((id, i) => {
        const cell = row.cells[i + 1];
        if (!cell) return;
        const l = byId[id].landing;
        const c = l[key];
        const got = norm(cell.text);
        if (got !== want(c, lang)) bad(where, `${byId[id].name} · ${key}: “${got}”, the data says “${want(c, lang)}”`);
        const second = key === "three" ? l.threeNote : key === "ai" ? l.aiNote : null;
        const gotNote = norm(cell.smalls.join(" "));
        if (gotNote !== (second ? norm(second[lang]) : "")) bad(where, `${byId[id].name} · ${key}: second line “${gotNote}”`);
        const dashes = (want(c, lang).match(/—/g) ?? []).length;
        if (cell.dashes.length !== dashes) bad(where, `${byId[id].name} · ${key}: ${cell.dashes.length} dash(es), the data has ${dashes}`);
        for (const d of cell.dashes) if (d.shown !== "—" || d.aria !== "true" || d.sr !== DASH[lang]) bad(where, `${byId[id].name} · ${key}: a dash without its words for screen readers`);
        if (i === 0 && !cell.cls.includes("is-us")) bad(where, `Versorium's ${key} cell is not on the slip`);
      });
    });
    // 7. Dated; 9. the changes count; 10. no logos.
    if (!extra.cap.includes(monthYear(AS_OF, lang))) bad(where, `the caption does not say “${monthYear(AS_OF, lang)}”`);
    const count = Number(extra.notes.join(" ").match(/(\d+) (?:cambios|changes)/)?.[1]);
    if (count !== release.commits) bad(where, `says ${count} changes; git rev-list --count ${release.tag} gives ${release.commits}`);
    if (extra.imgs !== 0) bad(where, "has pictures (no logos)");
    for (const cls of extra.svgs) if (!/^(vmark|vs-ring|ink-under|ink-rule)$/.test(cls)) bad(where, `a drawing that is not the site's own: svg.${cls}`);
    const wantMore = lang === "es" ? ["comparar/", "detalles/#por-que"] : ["compare/", "details/#why"];
    if (JSON.stringify(extra.more) !== JSON.stringify(wantMore)) bad(where, `links ${extra.more.join(", ")}`);
    await page.close();

    // ------------------------------------------------ the full page
    const route = lang === "es" ? "/comparar/" : "/en/compare/";
    const fp = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await fp.goto(SITE + route, { waitUntil: "load" });
    const fw = route;
    const A = await fp.evaluate(readTable, "table.vs-a");
    const B = await fp.evaluate(readTable, "table.vs-b");
    const F = await fp.evaluate(readTable, "table.vs-f");
    const meta = await fp.evaluate((sourcesPrefix) => ({
      lead: document.querySelector(".page-head .lead")?.textContent ?? "",
      desc: document.querySelector('meta[name="description"]')?.content ?? "",
      text: document.querySelector("main")?.textContent ?? "",
      // Versorium's own versions, as the page names them (the sources list names other apps' releases).
      ours: [...document.querySelectorAll(".prose > section")].filter((s) => s.id !== sourcesPrefix).map((s) => s.textContent).join(" "),
      imgs: document.querySelectorAll("main img, main picture, main svg").length,
      entries: [...document.querySelectorAll(".vs-sources > div")].map((d) => ({
        id: d.id,
        links: [...d.querySelectorAll("dd a")].map((a) => a.href),
        times: [...d.querySelectorAll("time")].map((x) => x.getAttribute("datetime")),
      })),
      allLinks: [...document.querySelectorAll("main a[href]")].map((a) => a.href),
      srcLinks: [...document.querySelectorAll("a.vs-src")].map((a) => a.getAttribute("href")),
      rowIds: [...document.querySelectorAll("table.vs-a tbody tr[id]")].map((tr) => tr.id),
      prefix: sourcesPrefix,
    }), p.sources);
    for (const [name, T, keys] of [
      ["price and AI", A, TABLE_A],
      ["your novel", B, TABLE_B],
    ]) {
      if (!T) {
        bad(fw, `no “${name}” table`);
        continue;
      }
      if (T.head.length !== keys.length + 1) bad(fw, `${name}: ${T.head.length} columns`);
      const expected = Object.keys(GROUPS).flatMap((g) => [...(g === "us" ? [] : [{ group: g }]), ...APPS.filter((a) => a.group === g).map((a) => ({ app: a }))]);
      if (T.rows.length !== expected.length) bad(fw, `${name}: ${T.rows.length} rows, the data has ${expected.length}`);
      T.rows.forEach((row, i) => {
        const e = expected[i];
        if (!e) return;
        if (e.group) {
          if (!row.group || norm(row.cells[0]?.text ?? "") !== GROUPS[e.group][lang]) bad(fw, `${name}: row ${i + 1} should be the group “${GROUPS[e.group][lang]}”`);
          return;
        }
        const a = e.app;
        const head = row.cells[0];
        const gotName = norm(head?.text.replace(/(fuentes|sources)$/, "") ?? "");
        if (gotName !== a.name) bad(fw, `${name}: row ${i + 1} is “${gotName}”, the data has ${a.name}`);
        if (norm(head?.smalls[0] ?? "") !== want(a.type, lang)) bad(fw, `${a.name}: its type reads “${norm(head?.smalls[0] ?? "")}”`);
        if (a.id !== "versorium" && head?.links[0] !== `#${p.sources}-${a.id}`) bad(fw, `${a.name}: its sources link is ${head?.links[0]}`);
        if ((a.id === "versorium") !== row.us) bad(fw, `${a.name}: ${row.us ? "on" : "off"} the slip`);
        keys.forEach((k, j) => {
          const cell = row.cells[j + 1];
          const got = norm(cell?.text ?? "");
          if (got !== want(a[k], lang)) bad(fw, `${a.name} · ${k}: “${got}”, the data says “${want(a[k], lang)}”`);
          const dashes = (want(a[k], lang).match(/—/g) ?? []).length;
          if ((cell?.dashes.length ?? 0) !== dashes) bad(fw, `${a.name} · ${k}: ${cell?.dashes.length} dash(es), the data has ${dashes}`);
          for (const d of cell?.dashes ?? []) if (d.aria !== "true" || d.sr !== DASH[lang]) bad(fw, `${a.name} · ${k}: a dash without its words for screen readers`);
        });
      });
    }
    // The landing's names land on their rows.
    for (const id of LANDING.slice(1)) if (!meta.rowIds.includes(id)) bad(fw, `no row #${id} for the landing's link`);
    // The founding table.
    if (!F) bad(fw, "no founding table");
    else {
      const cols = Object.keys(FOUNDING.columns);
      F.head.slice(1).forEach((h, i) => {
        if (norm(h.text) !== FOUNDING.columns[cols[i]][lang]) bad(fw, `founding column ${i + 2} is “${norm(h.text)}”`);
      });
      if (F.rows.length !== FOUNDING.rows.length) bad(fw, `founding: ${F.rows.length} rows, the data has ${FOUNDING.rows.length}`);
      F.rows.forEach((row, i) => {
        const r = FOUNDING.rows[i];
        if (!r) return;
        const a = byId[r.id];
        if (norm(row.cells[0]?.text ?? "") !== a.name) bad(fw, `founding row ${i + 1} is “${norm(row.cells[0]?.text ?? "")}”`);
        if (r.id !== "versorium" && row.cells[0]?.links[0] !== `#${r.id}`) bad(fw, `founding ${a.name} links to ${row.cells[0]?.links[0]}`);
        cols.forEach((k, j) => {
          const got = norm(row.cells[j + 1]?.text ?? "");
          if (got !== want(r[k], lang)) bad(fw, `founding ${a.name} · ${k}: “${got}”, the data says “${want(r[k], lang)}”`);
        });
      });
    }
    // 6. Sources: each listed once, under its app, dated; every row's link lands.
    const listed = meta.entries.flatMap((e) => e.links);
    for (const [id, s] of Object.entries(SOURCES)) {
      const entry = meta.entries.find((e) => e.id === `${p.sources}-${s.app}`);
      const url = (lang === "en" && s.urlEn) || s.url;
      const n = listed.filter((u) => u === url || u === new URL(url).href).length;
      if (n !== 1) bad(fw, `source ${id} (${url}) is listed ${n} times`);
      else if (!entry?.links.some((u) => u === new URL(url).href)) bad(fw, `source ${id} is not under ${p.sources}-${s.app}`);
    }
    for (const e of meta.entries) if (e.times.length !== 1 || e.times[0] !== AS_OF) bad(fw, `#${e.id} is dated ${e.times.join(",") || "nowhere"}, not ${AS_OF}`);
    for (const href of meta.srcLinks) if (!meta.entries.some((e) => `#${e.id}` === href)) bad(fw, `a row's sources link ${href} lands nowhere`);
    // 7. The full date; the counts.
    if (!meta.lead.includes(longDate(AS_OF, lang))) bad(fw, `the lead does not say “${longDate(AS_OF, lang)}”`);
    const n = APPS.length - 1;
    if (!new RegExp(`\\b${n} (alternativas|alternatives)\\b`).test(meta.lead)) bad(fw, `the lead does not count ${n} alternatives`);
    if (!new RegExp(`\\b${n - 5}\\b`).test(meta.desc)) bad(fw, `the description does not count ${n - 5} more`);
    // 9. The first release: its changes, its date and the first change's.
    const text = norm(meta.text);
    if (!text.includes(`${release.commits} ${lang === "es" ? "cambios" : "changes"}`)) bad(fw, `does not say ${release.commits} changes (git rev-list --count ${release.tag})`);
    for (const d of [release.date, release.first]) {
      const [, m, day] = d.split("-").map(Number);
      const words = lang === "es" ? `${day} de ${MONTH.es[m - 1]}` : `${day} ${MONTH.en[m - 1]}`;
      if (!text.includes(words)) bad(fw, `does not give the date ${d} (${words})`);
    }
    // A version's parts have no leading zeros ("2.000.000" credits are not one).
    for (const [, v] of meta.ours.matchAll(/(?<![\d.])v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?![\d.]*\d)/g)) if (!tags.includes(`v${v}`)) bad(fw, `names version ${v}, which has no tag`);
    if (meta.imgs !== 0) bad(fw, "has pictures or drawings in its content (no logos)");
    // 11. Versorium's licence, where the page names it, is the repository's.
    if (!text.includes("(AGPL-3.0)")) bad(fw, "does not name Versorium's licence, AGPL-3.0");
    await fp.close();
  }
  // 12. The tables' layout.
  for (const route of ["/", "/en/", "/comparar/", "/en/compare/"]) {
    for (const width of LAYOUT_WIDTHS) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      await page.goto(SITE + route, { waitUntil: "networkidle" });
      await page.waitForTimeout(250);
      for (const p of await page.evaluate(layoutProblems)) bad(`${route} at ${width}px`, p);
      await page.close();
    }
  }
} finally {
  await browser.close();
}

console.log(`compare: ${cells.length} data cells, ${Object.keys(SOURCES).length} sources, read ${AS_OF} (${age} days ago); first release ${release.tag}, ${release.commits} changes; layout at ${LAYOUT_WIDTHS.length} widths`);
for (const w of warnings) console.log(`warning: ${w}`);
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of [...new Set(problems)]) console.log(" -", p);
  process.exitCode = 1;
} else {
  // The last line is what verify.mjs prints: it carries the warnings too.
  console.log(`the comparison is what its data says${warnings.length ? ` (${warnings.length} warning${warnings.length > 1 ? "s" : ""}: ${warnings.join("; ")})` : ""}`);
}
