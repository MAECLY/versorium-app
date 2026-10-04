// The HTML app window may leave app UI out but never make any up (site spec
// §12.2). For both pages, with script (after the hero has played) and without:
//   - every label in the window is a string of locales/<lang>/ui.json (its
//     {words} filled in) or comes from the sample novel (tests/landing/novel.mjs):
//     titles, chapter ids, word counts (project 701/716 and 31/30; the chapter
//     273→283 / 282→292);
//   - each paragraph is a piece of the hero chapter, the second one followed by
//     the typed sentence;
//   - the language button reads EN on / and ES on /en/;
//   - nothing a picture cannot have: a version, "Continue chapter", a button,
//     a link, a heading;
//   - every piece of text in the window outside the chapter's paragraphs is
//     checked, not only the classes known today, so a label added later is
//     caught too;
//   - the top bar and the status bar keep the app's order: their labels are a
//     subsequence of the t("…") calls in TopBar.svelte and StatusBar.svelte,
//     in template order (leaving a button out is fine; renaming, inventing
//     or reordering one is not);
//   - each binder row pairs the right title with the right status and word
//     count (ch-03 is "Suficiente" and "revisado", not any allowed string);
//   - the ring drawn round "Guardado ●" after the sequence keeps 3 app px
//     clear of the label, the dot and its neighbours in the bar, and stays
//     inside the bar (and, on a phone's strip, inside its unfaded part), at
//     1280 and on 320 and 390 px phones;
// and on the page around it:
//   - the pile's four times are the History panel's four latest snapshots,
//     written as the panel writes them (12-hour in English);
//   - the annotations are where tests/landing/out/annotations.json measured.
//
//   SITE_URL=http://localhost:8742 node tests/landing/replica-parity.mjs
//   APP_REF=HEAD …   # compare with the app as committed, not the working tree

import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { history, novels } from "./novel.mjs";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const SITE = process.env.SITE_URL ?? "http://localhost:8700";
/** A file of the app: from the working tree, or as committed at APP_REF. */
const appFile = async (rel) =>
  process.env.APP_REF ? execFileSync("git", ["-C", ROOT, "show", `${process.env.APP_REF}:${rel}`], { encoding: "utf8" }) : readFile(path.join(ROOT, rel), "utf8");
const annotations = JSON.parse(await readFile(path.join(ROOT, "tests/landing/out/annotations.json"), "utf8"));
const problems = [];
const bad = (where, what) => problems.push(`${where}: ${what}`);

function flatten(obj, out = []) {
  for (const v of Object.values(obj)) {
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object") flatten(v, out);
  }
  return out;
}

const words = (text) => text.split(/\s+/).filter(Boolean).length;

/** The History panel's time, as the English capture shows it ("5:55 PM"); Spanish is 24-hour. */
const clock = (lang, at) => {
  if (lang === "es") return at;
  const [h, m] = at.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

/** In the page, after the sequence: the ring's drawn path against what it circles and its neighbours. */
function ringRoom() {
  const ring = document.querySelector(".r-ring");
  const path = ring?.querySelector("path");
  if (!path || getComputedStyle(ring).opacity !== "1") return null;
  const r = path.getBoundingClientRect();
  const rect = (sel) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
  const status = document.querySelector(".r-status");
  const phone = getComputedStyle(document.querySelector(".replica")).display === "block";
  // One app px: the window is drawn at its frame's width / 1024; the phone strip at 1:1.
  const px = phone ? 1 : document.querySelector(".replica-frame").clientWidth / 1024;
  const text = document.createRange();
  text.selectNodeContents(document.querySelector(".r-save .is-saved"));
  const label = text.getBoundingClientRect(), dot = rect(".r-dot"), words = rect(".r-words"), next = rect(".r-save + *"), bar = status.getBoundingClientRect();
  const gaps = {
    "label left": label.left - r.left,
    "label top": label.top - r.top,
    "label bottom": r.bottom - label.bottom,
    "dot right": r.right - dot.right,
    "word count": r.left - words.right,
    "next button": next.left - r.right,
  };
  const out = Object.fromEntries(Object.entries(gaps).map(([k, v]) => [k, v / px]));
  return {
    gaps: out,
    inBar: r.top >= bar.top - 0.5 && r.bottom <= bar.bottom + 0.5,
    unfaded: !phone || r.right <= bar.left + 0.9 * status.offsetWidth + 2,
  };
}

const lookup = (ui, key) => key.split(".").reduce((o, k) => (o == null ? o : o[k]), ui);

/** The text a Svelte component renders, in template order: one slot per
    {expression} outside an attribute, holding the strings of every t("key")
    in it (a ternary between saving and saved is one slot). A component of
    $lib used in the template (StatusBar's <FocusControl>) adds its own slots
    where it stands. */
async function appOrder(file, ui, nested = false) {
  const src = await appFile(file);
  const tpl = src.slice(src.lastIndexOf("</script>") + "</script>".length).replace(/<!--[\s\S]*?-->/g, "");
  const slots = [];
  for (let i = tpl.indexOf("{"); i >= 0; i = tpl.indexOf("{", i + 1)) {
    let depth = 0;
    let j = i;
    for (; j < tpl.length; j += 1) {
      if (tpl[j] === "{") depth += 1;
      else if (tpl[j] === "}" && (depth -= 1) === 0) break;
    }
    const expr = tpl.slice(i + 1, j);
    const inAttribute = /=\s*$/.test(tpl.slice(Math.max(0, i - 3), i));
    if (!inAttribute && !/^[#/:@]/.test(expr)) {
      const keys = [...expr.matchAll(/\bt\("([^"]+)"/g)].map((m) => m[1]);
      if (keys.length) slots.push({ at: i, strings: keys.map((k) => lookup(ui, k)) });
    }
    i = j;
  }
  if (!nested) {
    for (const m of tpl.matchAll(/<([A-Z]\w*)[\s/>]/g)) {
      const from = src.match(new RegExp(`import\\s+${m[1]}\\s+from\\s+"\\$lib/([^"]+\\.svelte)"`));
      if (!from) continue;
      (await appOrder(`src/lib/${from[1]}`, ui, true)).forEach((strings, k) => slots.push({ at: m.index + k / 1000, strings }));
    }
  }
  slots.sort((a, b) => a.at - b.at);
  if (!slots.length && !nested) throw new Error(`no t("…") calls found in ${file}`);
  return slots.map((s) => s.strings);
}

/** A label against a slot's strings, {placeholders} standing for a number. */
const fits = (label, string) =>
  typeof string === "string" &&
  new RegExp(`^${string.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{\w+\}/g, "\\d+")}$`).test(label);

for (const [lang, route] of [["es", "/"], ["en", "/en/"]]) {
  const ui = JSON.parse(await appFile(`locales/${lang}/ui.json`));
  const strings = new Set(flatten(ui));
  const novel = novels[lang];
  const hero = novel.chapters[Number(novel.hero.slice(3)) - 1];
  const total = novel.chapters.reduce((a, c) => a + words(c.body), 0);
  const before = words(hero.body);
  const after = before + words(novel.typed);
  const wordsLabel = (n) => ui.binder.wordCount.replace("{words}", n);
  const order = {
    top: await appOrder("src/lib/components/TopBar.svelte", ui),
    status: await appOrder("src/lib/components/StatusBar.svelte", ui),
  };
  const allowed = new Set([
    ...strings,
    "versorium",
    novel.title,
    novel.shelf.title,
    ...novel.chapters.map((c) => c.title),
    ...novel.chapters.map((_, i) => `ch-${String(i + 1).padStart(2, "0")}`),
    `${novel.hero} · ${hero.title}`,
    wordsLabel(total),
    wordsLabel(words(novel.shelf.body)),
    ui.statusbar.words.replace("{words}", before),
    ui.statusbar.words.replace("{words}", after),
    String(before),
    String(after),
    // StatusBar.svelte writes the language button itself: the other language's code.
    lang === "es" ? "EN" : "ES",
  ]);

  for (const js of [true, false]) {
    const where = `${route} ${js ? "script" : "no script"}`;
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, javaScriptEnabled: js });
    await page.goto(SITE + route, { waitUntil: "networkidle" });
    if (js) await page.waitForTimeout(6000);
    const r = await page.evaluate(() => {
      const root = document.querySelector(".replica");
      const text = (el) => el.textContent.replace(/\s+/g, " ").trim();
      const labels = [
        ...root.querySelectorAll(".r-brand, .r-btn, .r-sec, .r-title, .r-id, .r-meta, .r-where, .r-words, .r-save-label > span, .r-bar-btn"),
      ].map(text);
      return {
        labels,
        paragraphs: [...root.querySelectorAll(".r-p")].map((p) => p.textContent),
        lang: text(root.querySelector(".r-status .r-bar-btn:last-child")),
        forbidden: root.querySelectorAll("button, a, h1, h2, h3, h4, h5, h6").length,
        raw: root.textContent,
        times: [...document.querySelectorAll(".pile .sheet-time")].map(text),
        ellipse: (() => {
          const e = document.querySelector(".step-fig-cork .annot ellipse");
          return e ? ["cx", "cy", "rx", "ry"].map((k) => Number(e.getAttribute(k))) : null;
        })(),
        bracket: document.querySelector(".step-fig-focus .annot path")?.getAttribute("d") ?? null,
        // Every element with text of its own, outside the chapter's paragraphs.
        leaves: [...root.querySelectorAll("*")]
          .filter((el) => !el.closest(".r-p, svg") && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
          .map(text),
        top: [...root.querySelectorAll(".r-top .r-brand, .r-top .r-btn")].map(text),
        status: [...root.querySelectorAll(".r-status .r-where, .r-status .r-words, .r-status .r-save-label > span, .r-status .r-bar-btn")].map(text),
        projects: [...root.querySelectorAll(".r-projects .r-item")].map((r) => [text(r.querySelector(".r-title")), text(r.querySelector(".r-meta"))]),
        chapters: [...root.querySelectorAll(".r-list:not(.r-projects) .r-item")].map((r) => [
          text(r.querySelector(".r-id")),
          text(r.querySelector(".r-title")),
          text(r.querySelector(".r-meta")),
        ]),
      };
    });
    for (const label of new Set([...r.labels, ...r.leaves])) if (!allowed.has(label)) bad(where, `"${label}" is neither the app's string nor the sample novel's`);
    // The bars keep the app's order. The status bar opens with where you are
    // (the chapter's id and title, not a t() string) and ends with the
    // language button (the other language's code).
    const sequence = (name, labels, slots) => {
      let at = 0;
      for (const label of labels) {
        const i = slots.findIndex((slot, k) => k >= at && slot.some((s) => fits(label, s)));
        if (i < 0) {
          bad(where, `${name} bar: "${label}" is out of the app's order or not in ${name === "top" ? "TopBar" : "StatusBar"}.svelte`);
          return;
        }
        at = i;
      }
    };
    sequence("top", r.top, order.top);
    const status = [...r.status];
    if (status[0] !== `${novel.hero} · ${hero.title}`) bad(where, `status bar starts with "${status[0]}", not where you are`);
    if (status.at(-1) !== (lang === "es" ? "EN" : "ES")) bad(where, `status bar ends with "${status.at(-1)}", not the language button`);
    sequence("status", status.slice(1, -1), order.status);
    // Each binder row is one real row of the sample.
    const expectProjects = [
      [novel.title, wordsLabel(total)],
      [novel.shelf.title, wordsLabel(words(novel.shelf.body))],
    ];
    r.projects.forEach((row, i) => {
      if (JSON.stringify(row) !== JSON.stringify(expectProjects[i])) bad(where, `project row ${i + 1} reads ${row.join(" / ")}, not ${expectProjects[i]?.join(" / ")}`);
    });
    for (const [id, title, meta] of r.chapters) {
      const c = novel.chapters[Number(id.slice(3)) - 1];
      const want = c && [c.title, ui.binder.status[c.status]];
      if (!c || title !== want[0] || meta !== want[1]) bad(where, `chapter row ${id} reads ${title} / ${meta}, not ${want ? want.join(" / ") : "a chapter of the sample"}`);
    }
    const body = hero.body;
    r.paragraphs.forEach((p, i) => {
      const plain = p;
      if (body.includes(plain)) return;
      if (i === 1 && plain.endsWith(novel.typed) && body.includes(plain.slice(0, -novel.typed.length))) return;
      bad(where, `paragraph ${i + 1} is not the chapter's text: "${plain.slice(0, 60)}…"`);
    });
    if (r.lang !== (lang === "es" ? "EN" : "ES")) bad(where, `language button reads ${r.lang}`);
    if (r.forbidden) bad(where, `${r.forbidden} button/link/heading inside the window`);
    if (/v\d+\.\d+/.test(r.raw)) bad(where, "a version string inside the window");
    if (r.raw.includes(ui.ai.creative)) bad(where, `"${ui.ai.creative}" inside the window`);
    const latest = history(lang).slice(-4).map((h) => clock(lang, h.at));
    if (JSON.stringify(r.times) !== JSON.stringify(latest)) bad(where, `pile times ${r.times} are not ${latest}`);
    const a = annotations[lang];
    const e = a.corkboard.ellipse;
    if (!r.ellipse || r.ellipse.some((v, i) => Math.abs(v - [e.cx, e.cy, e.rx, e.ry][i]) > 2)) bad(where, `ellipse ${r.ellipse} is not ${[e.cx, e.cy, e.rx, e.ry]}`);
    if (r.bracket !== a.focus.bracket) bad(where, `bracket ${r.bracket} is not ${a.focus.bracket}`);
    if (js) {
      const ring = await page.evaluate(ringRoom);
      checkRing(`${where} 1280`, ring);
    }
    console.log(`${where}: ${r.labels.length} labels, ${r.paragraphs.length} paragraphs checked`);
    await browser.close();
  }
}

/** The ring's room, measured; at least 3 app px on every side that matters. */
function checkRing(where, ring) {
  if (!ring) return bad(where, "the ring is not drawn after the sequence");
  for (const [side, gap] of Object.entries(ring.gaps)) if (gap < 3) bad(where, `ring: ${gap.toFixed(1)} app px from the ${side} (3 at least)`);
  if (!ring.inBar) bad(where, "ring: it leaves the status bar");
  if (!ring.unfaded) bad(where, "ring: it runs into the phone strip's fade");
}

// The ring on phones, where the status bar is a strip at 1:1 and narrows with the screen.
for (const [lang, route] of [["es", "/"], ["en", "/en/"]]) {
  for (const width of [320, 390]) {
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage({ viewport: { width, height: 740 }, deviceScaleFactor: 2 });
    await page.goto(SITE + route, { waitUntil: "networkidle" });
    await page.locator(".replica").scrollIntoViewIfNeeded();
    await page.waitForTimeout(6500);
    checkRing(`${route} script ${width}`, await page.evaluate(ringRoom));
    await browser.close();
  }
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of problems) console.log(" -", p);
  process.exitCode = 1;
} else {
  console.log("the window shows only what the app shows");
}
