// Recordings and stills of the real app for the landing page (docs/).
//
// The same seeded app as capture.mjs (its boot(), steps and helpers are
// imported), driven through real input: keys, the pointer, clicks. Nothing is
// drawn over a frame and no state is set that the app could not reach by
// itself; the only adjustments are capture.mjs's three, plus a 600 ms wait on
// the adjusted ai_rewrite so the dialog's busy state is seen.
//
// Clips are frame by frame, not a screen recording. Playwright's fake clock
// is installed before the app loads and paused once it is ready; every frame
// advances it by exactly 83 ms (12 fps) and then takes a screenshot, so the
// app's own timers — the 800 ms autosave debounce, the 15 s history poll,
// CodeMirror's measure cycle, the 600 ms rewrite — run on the clip's clock and
// every run gives the same frames. CSS transitions are finished at each
// screenshot (`animations: "disabled"`), so a hover or a press shows in full on
// the frame it happens.
//
//   restore  1024x640, the app's minimum window. The caret goes to the start of
//            the second sentence of the hero chapter's second paragraph;
//            Alt+Shift+Left selects the first sentence back a word at a time
//            (at most ten frames spread over the presses); Backspace; the
//            paragraph re-wraps inside its own three lines (checked), so
//            nothing under it moves; a pause; the pointer goes to "↩ Restaurar"
//            in the status bar and clicks it, and with no selection it takes
//            the word under the caret, where the deletion is (rollback.ts
//            wordRange, take()); the sentence comes back. The pointer then
//            leaves, so the last frame, which is also the still, has no hover.
//            RESTORE_CUT=rest records the site spec's first version instead:
//            the rest of the paragraph is deleted, it drops to one line,
//            everything under it moves up, and End, Shift+Home selects it
//            before the click. Both are the same three steps in the real app;
//            "rest" redraws most of the window twice and costs about 1.6 times
//            the bytes, which no encoding brought near the clip's budget.
//   rewrite  1280x800. The passage is selected and the Rewrite dialog opened
//            (capture.mjs openRewrite); the dialog's own Rewrite button is
//            pressed; busy; the preview with the diff; the pointer goes to
//            "Aplicar"/"Apply" and presses it, and the clip stops before the
//            button is released, so nothing is applied. The still is the
//            preview before the pointer moves.
//
// Stills (reducedMotion "reduce", real time, as capture.mjs takes them):
// focus, corkboard and history; the rewrite still comes from the clip's own
// session, so the still and the clip are the same pixels.
//
// Writes:
//   $REC_DIR/<lang>/<clip>-<variant>/fNNNN.png + meta.json (crop and detail
//     boxes, per-frame hold) — default /tmp/versorium-landing/rec;
//   $RAW_DIR/<lang>/<shot>-<variant>.png + .json (crop, detail box) for
//     encode.py and crops.py — default /tmp/versorium-landing/raw;
//   tests/landing/out/annotations.json: the boxes the page's ink annotations
//     are drawn around (site §7.7), per language.
//
// Usage (the Vite dev server must be up on :1420):
//   node tests/landing/record.mjs                         # everything
//   node tests/landing/record.mjs --lang es --theme needle-light --only restore
// --only takes clip and still names: restore, rewrite, focus, corkboard, history.
// Then: python3 tests/landing/encode.py, crops.py and encode-clips.py.

import { chromium } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ALL_THEMES, SCALE, VIEWPORT, blur, boot, catalogue, dialogBox, openRewrite, rest, steps } from "./capture.mjs";
import { novels } from "./novel.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REC = process.env.REC_DIR ?? "/tmp/versorium-landing/rec";
const RAW = process.env.RAW_DIR ?? "/tmp/versorium-landing/raw";
const ANNOTATIONS = path.join(HERE, "out", "annotations.json");
const FRAME_MS = 83;
const MIN_WINDOW = { width: 1024, height: 640 };

// The restore crop, in CSS px of the 1024x640 window. Left: past the end of
// the save label in the status bar ("Guardado" ends at x 251 in Spanish), so
// no word is cut at the edge; the text column starts 22 px further in and
// ends 24 px before the right edge, so the prose sits centred. The phone
// detail ends between "↩ Restaurar" (x 587) and "Fichas" (x 635, since the
// Focus control gained its ⋯ on 2026-10-04); in English "↩ Restore" ends at
// 522 and "Corkboard" starts at 710. Both edges are checked against the DOM on
// every run. site.css fades the detail's last tenth, after "↩ Restaurar".
const RESTORE_X = 252;
const RESTORE_DETAIL_RIGHT = 630;
// What the restore clip deletes: "first", the second paragraph's first
// sentence (the default; see recordRestore), or "rest", the rest of the
// paragraph after it, as the site spec first described it.
const RESTORE_CUT = process.env.RESTORE_CUT ?? "first";

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1].split(",") : fallback;
}

/** Stop the fake clock a moment from now; under load "a moment" has to grow. */
async function pause(page) {
  for (const margin of [100, 500, 2000]) {
    const now = await page.evaluate(() => Date.now());
    try {
      await page.clock.pauseAt(now + margin);
      return;
    } catch (e) {
      if (!/to the past/.test(e.message)) throw e;
    }
  }
  throw new Error("could not pause the clock");
}

/** Frame-by-frame recorder: each frame is FRAME_MS of app time, then a screenshot. */
function recorder(page, dir) {
  const holds = [];
  return {
    holds,
    async frame(count = 1) {
      for (let i = 0; i < count; i += 1) {
        await page.clock.runFor(FRAME_MS);
        const file = path.join(dir, `f${String(holds.length).padStart(4, "0")}.png`);
        await page.screenshot({ path: file, animations: "disabled", caret: "initial" });
        holds.push(FRAME_MS);
      }
    },
  };
}

async function freshDir(dir) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
}

async function box(locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("no box");
  return b;
}

/** Move the pointer in a straight line over `count` frames. */
async function glide(page, rec, from, to, count) {
  for (let i = 1; i <= count; i += 1) {
    const t = i / count;
    // Ease out, as a hand slows onto a target.
    const e = 1 - (1 - t) * (1 - t);
    await page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
    await rec.frame();
  }
}

const centre = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

async function recordRestore(browser, lang, variant, models) {
  const novel = novels[lang];
  const dir = path.join(REC, lang, `restore-${variant}`);
  await freshDir(dir);
  const { context, page, errors } = await boot(browser, lang, variant, models, false, {
    reducedMotion: "no-preference",
    viewport: MIN_WINDOW,
    clock: true,
  });
  try {
    await rest(page);
    const hero = novel.chapters[Number(novel.hero.slice(3)) - 1].body;
    const paragraphs = hero.split("\n\n");
    const p2 = paragraphs[1];
    const firstSentence = p2.slice(0, p2.indexOf(".") + 1);
    const original = await page.locator(".cm-content").evaluate((el) => {
      const view = el.cmTile?.root?.view ?? el.cmTile?.view;
      return view.state.doc.toString();
    });
    const p2From = original.indexOf(p2);
    const anchor = p2From + firstSentence.length;
    const p2End = p2From + p2.length;
    if (p2From < 0) throw new Error("second paragraph not found in the editor");

    // Geometry, from the DOM: the crop, and the status-bar words it must not cut.
    const geo = await page.evaluate(() => {
      const lines = [...document.querySelectorAll(".cm-content .cm-line")];
      const footer = [...document.querySelector("footer").children].map((el) => {
        const r = el.getBoundingClientRect();
        return { text: el.textContent.trim(), left: r.left, right: r.right };
      });
      return { p2Top: lines[2].getBoundingClientRect().top, footer };
    });
    const top = Math.floor(geo.p2Top - 24);
    const crop = { x: RESTORE_X, y: top, width: MIN_WINDOW.width - RESTORE_X, height: MIN_WINDOW.height - top };
    const detail = { x: RESTORE_X, y: top, width: RESTORE_DETAIL_RIGHT - RESTORE_X, height: MIN_WINDOW.height - top };
    const cut = (x) => geo.footer.filter((f) => f.text && f.left < x && f.right > x).map((f) => f.text);
    for (const x of [crop.x, detail.x + detail.width]) {
      if (cut(x).length) throw new Error(`the restore crop edge at x ${x} cuts ${cut(x).join(", ")}`);
    }

    await pause(page);
    const view = (fn, arg) => page.locator(".cm-content").evaluate(fn, arg);
    const place = (at) =>
      view((el, at) => {
        const v = el.cmTile?.root?.view ?? el.cmTile?.view;
        v.dispatch({ selection: { anchor: at } });
        v.focus();
      }, at);
    const head = () => view((el) => (el.cmTile?.root?.view ?? el.cmTile?.view).state.selection.main.head);
    const selection = () =>
      view((el) => {
        const s = (el.cmTile?.root?.view ?? el.cmTile?.view).state.selection.main;
        return [s.from, s.to];
      });
    const rec = recorder(page, dir);

    // Select word by word towards `goal`, filming at most `frames` steps
    // spread evenly over the presses. A dry run counts the presses first
    // (selection only: no edit, no frame), then the caret goes back.
    async function selectTo(key, from, goal, frames) {
      let presses = 0;
      while ((await head()) !== goal) {
        await page.keyboard.press(key);
        presses += 1;
        if (presses > 80) throw new Error("the selection never reached its goal");
      }
      await place(from);
      for (let i = 1; i <= presses; i += 1) {
        await page.keyboard.press(key);
        if (Math.floor((i * frames) / presses) > Math.floor(((i - 1) * frames) / presses)) await rec.frame();
      }
      if ((await head()) !== goal) throw new Error("the filmed selection did not end where the dry run did");
      return presses;
    }

    let presses;
    if (RESTORE_CUT === "first") {
      // The paragraph's first sentence, selected back from the start of the
      // second. Without it the paragraph re-wraps inside the same three lines
      // (checked below), so nothing under it moves: only those lines change.
      const second = p2From + firstSentence.length + 1;
      await place(second);
      await rec.frame(3);
      presses = await selectTo("Alt+Shift+ArrowLeft", second, p2From, 10);
      const lines = () => page.evaluate(() => document.querySelectorAll(".cm-content .cm-line")[2].getBoundingClientRect().height);
      const tall = await lines();
      await page.keyboard.press("Backspace");
      await rec.frame(1);
      if ((await lines()) !== tall) throw new Error("the paragraph changed height; the clip would reflow the window");
      await rec.frame(9);
      // No selection: ↩ Restaurar takes the word under the caret, and the
      // deletion sits at its start (StatusBar.svelte, rollback.ts wordRange).
    } else {
      // The site spec's sequence: the rest of the paragraph after its first
      // sentence; the paragraph drops to one line and everything under it
      // moves up, and back on restore, which costs about 1.6 times the bytes.
      await place(anchor);
      await rec.frame(3);
      presses = await selectTo("Alt+Shift+ArrowRight", anchor, p2End, 10);
      await page.keyboard.press("Backspace");
      await rec.frame(10);
      await page.keyboard.press("End");
      await page.keyboard.press("Shift+Home");
      const sel = await selection();
      if (sel[0] !== p2From || sel[1] !== anchor) throw new Error(`paragraph not selected: ${sel} (want ${p2From},${anchor})`);
      await rec.frame(2);
    }

    const restore = page.getByRole("contentinfo").getByRole("button", { name: lang === "es" ? "↩ Restaurar" : "↩ Restore", exact: true });
    const target = centre(await box(restore));
    await page.mouse.move(target.x, target.y);
    await rec.frame(2);
    await page.mouse.down();
    await rec.frame(1);
    await page.mouse.up();
    await rec.frame(3);
    await rest(page);
    await rec.frame(11);

    const after = await page.locator(".cm-content").evaluate((el) => (el.cmTile?.root?.view ?? el.cmTile?.view).state.doc.toString());
    if (after !== original) throw new Error("↩ Restaurar did not bring the text back exactly");
    if (errors.length) throw new Error(`page errors: ${errors.join(" | ")}`);
    const meta = { clip: "restore", cut: RESTORE_CUT, lang, variant, scale: SCALE, viewport: MIN_WINDOW, frameMs: FRAME_MS, holds: rec.holds, crop, detail, presses };
    await writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 1));
    console.log(`restore ${lang} ${variant}: ${rec.holds.length} frames, ${presses} presses, crop ${JSON.stringify(crop)}`);
  } finally {
    await context.close();
  }
}

async function recordRewrite(browser, lang, variant, models) {
  const novel = novels[lang];
  const dir = path.join(REC, lang, `rewrite-${variant}`);
  await freshDir(dir);
  const { context, page, errors } = await boot(browser, lang, variant, models, false, {
    reducedMotion: "no-preference",
    viewport: VIEWPORT,
    rewriteDelay: 600,
    clock: true,
  });
  try {
    const dialog = await openRewrite(page, lang, novel);
    await blur(page);
    const label = lang === "es" ? "Reescribir" : "Rewrite";
    const go = dialog.getByRole("button", { name: label, exact: true });
    const apply = dialog.getByRole("button", { name: lang === "es" ? "Aplicar" : "Apply", exact: true });
    const heading = dialog.getByRole("heading", { name: label });
    // Somewhere inside the dialog that nothing reacts to: the line under the
    // title, level with the heading and clear of the close button.
    const quiet = await box(heading);
    const still = { x: quiet.x + quiet.width + 120, y: quiet.y + quiet.height / 2 };
    await page.mouse.move(still.x, still.y);
    await pause(page);
    const rec = recorder(page, dir);
    await rec.frame(4);

    const goAt = centre(await box(go));
    await glide(page, rec, still, goAt, 3);
    await page.mouse.down();
    await rec.frame(1);
    await page.mouse.up();
    // The pointer leaves the button at once, so the preview is seen without a
    // hover on it.
    await page.mouse.move(still.x, still.y);
    const preview = dialog.getByRole("region", { name: lang === "es" ? "Vista previa" : "Preview" });
    let busy = 0;
    while (!(await preview.count())) {
      await rec.frame();
      busy += 1;
      if (busy > 20) throw new Error("the preview never came");
    }
    // The preview is on screen from this frame on. The final box is measured
    // now, and the still is this frame: the preview, nothing hovered.
    const crop = await dialogBox(dialog);
    await rec.frame(1);
    const stillFrame = rec.holds.length - 1;
    await rec.frame(9);
    const applyAt = centre(await box(apply));
    await glide(page, rec, still, applyAt, 8);
    await page.mouse.down();
    await rec.frame(9);
    // Released off the button, so nothing is applied when the context closes.
    await page.mouse.move(still.x, still.y);

    if (errors.length) throw new Error(`page errors: ${errors.join(" | ")}`);
    const meta = { clip: "rewrite", lang, variant, scale: SCALE, viewport: VIEWPORT, frameMs: FRAME_MS, holds: rec.holds, crop, detail: null, stillFrame, busyFrames: busy };
    await writeFile(path.join(dir, "meta.json"), JSON.stringify(meta, null, 1));
    console.log(`rewrite ${lang} ${variant}: ${rec.holds.length} frames, busy ${busy}, crop ${JSON.stringify(crop)}`);
  } finally {
    await context.close();
  }
}

/** A still for encode.py, with the detail box crops.py cuts and the annotation box. */
async function recordStill(browser, lang, variant, models, shot) {
  const { context, page, errors, novel } = await boot(browser, lang, variant, models);
  try {
    const crop = await steps[shot](page, lang, novel);
    if (shot !== "focus") await rest(page);
    await page.waitForTimeout(250);
    let detail = null;
    let mark = null;
    if (shot === "focus") {
      // The paragraph that holds the caret: the band behind it is what focus
      // mode leaves lit, and the page's bracket is drawn beside it.
      const r = await page.evaluate(() => {
        const first = document.querySelector(".cm-content .cm-line").getBoundingClientRect();
        const active = document.querySelector(".cm-content .cm-activeLine")?.getBoundingClientRect();
        return { first: { x: first.x, y: first.y }, active: active && { x: active.x, y: active.y, w: active.width, h: active.height } };
      });
      if (!r.active) throw new Error("no active paragraph in focus mode");
      detail = { x: Math.round(r.first.x - 16), y: Math.round(r.first.y - 24), width: 420, height: 480 };
      mark = r.active;
    }
    if (shot === "corkboard") {
      const r = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('[data-item-surface="board"] li > button')].map((b) => {
          const c = b.getBoundingClientRect();
          return { x: c.x, y: c.y, w: c.width, h: c.height, current: b.getAttribute("aria-current") === "true" };
        });
        return cards;
      });
      const active = r.find((c) => c.current);
      if (!active) throw new Error("no current card on the corkboard");
      // The open chapter's card and the one under it, in the same column.
      const below = r.filter((c) => Math.abs(c.x - active.x) < 1 && c.y > active.y).sort((a, b) => a.y - b.y)[0];
      if (!below) throw new Error("no card under the current one");
      detail = {
        x: Math.round(active.x - 12),
        y: Math.round(active.y - 12),
        width: Math.round(active.w + 24),
        height: Math.round(below.y + below.h - active.y + 24),
      };
      mark = { x: active.x, y: active.y, w: active.w, h: active.h };
    }
    const base = path.join(RAW, lang, `${shot}-${variant}`);
    await mkdir(path.dirname(base), { recursive: true });
    await page.screenshot({ path: `${base}.png`, animations: "disabled" });
    await writeFile(`${base}.json`, JSON.stringify({ scale: SCALE, viewport: VIEWPORT, crop, detail, mark }));
    if (errors.length) throw new Error(`page errors: ${errors.join(" | ")}`);
    console.log(`still ${lang} ${shot}-${variant}`, detail ? `detail ${JSON.stringify(detail)}` : "");
    return mark;
  } finally {
    await context.close();
  }
}

const round1 = (v) => Math.round(v * 10) / 10;

/** The ellipse and the bracket of site §7.7, from the boxes, in the 1280x800 viewBox. */
function annotationsFor(card, para) {
  const cx = card.x + card.w / 2;
  const cy = card.y + card.h / 2;
  return {
    corkboard: {
      card: { x: round1(card.x), y: round1(card.y), w: round1(card.w), h: round1(card.h) },
      ellipse: { cx: round1(cx), cy: round1(cy), rx: round1(card.w / 2 + 14), ry: round1(card.h / 2 + 12), rotate: -3 },
    },
    focus: {
      paragraph: { x: round1(para.x), y: round1(para.y), w: round1(para.w), h: round1(para.h) },
      bracket: `M${round1(para.x - 18)} ${round1(para.y)} q-10 0 -10 10 V${round1(para.y + para.h - 10)} q0 10 10 10`,
    },
  };
}

async function pool(tasks, size) {
  const queue = [...tasks];
  let failures = 0;
  const workers = Array.from({ length: size }, async () => {
    while (queue.length) {
      const task = queue.shift();
      try {
        await task();
      } catch (e) {
        failures += 1;
        console.error("FAILED", e.message);
      }
    }
  });
  await Promise.all(workers);
  return failures;
}

async function main() {
  const langs = arg("lang", ["es", "en"]);
  const themes = arg("theme", ALL_THEMES);
  const only = new Set(arg("only", ["restore", "rewrite", "focus", "corkboard", "history"]));
  const jobs = Number(arg("jobs", ["4"])[0]);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const models = await catalogue();
  const marks = {};
  const tasks = [];
  for (const lang of langs) {
    for (const variant of themes) {
      if (only.has("restore")) tasks.push(() => recordRestore(browser, lang, variant, models));
      if (only.has("rewrite")) tasks.push(() => recordRewrite(browser, lang, variant, models));
      for (const shot of ["focus", "corkboard", "history"]) {
        if (!only.has(shot)) continue;
        tasks.push(async () => {
          const mark = await recordStill(browser, lang, variant, models, shot);
          if (mark) ((marks[lang] ??= {})[shot] ??= {})[variant] = mark;
        });
      }
    }
  }
  let failures = 0;
  try {
    failures = await pool(tasks, jobs);
  } finally {
    await browser.close();
  }

  // The annotation boxes are layout, not colour: every theme must agree, and
  // the page draws one set per language.
  if (only.has("focus") && only.has("corkboard")) {
    let file = {};
    try {
      file = JSON.parse(await readFile(ANNOTATIONS, "utf8"));
    } catch {
      file = {};
    }
    for (const lang of langs) {
      const byShot = marks[lang] ?? {};
      const pick = (shot) => {
        const all = Object.values(byShot[shot] ?? {});
        if (!all.length) return null;
        for (const m of all) {
          for (const k of ["x", "y", "w", "h"]) {
            if (Math.abs(m[k] - all[0][k]) > 0.5) throw new Error(`${lang} ${shot}: the box differs between themes`);
          }
        }
        return all[0];
      };
      const card = pick("corkboard");
      const para = pick("focus");
      if (card && para) file[lang] = annotationsFor(card, para);
    }
    file.viewBox = `0 0 ${VIEWPORT.width} ${VIEWPORT.height}`;
    file.note = "CSS px of the 1280x800 captures (record.mjs). corkboard: the current card and the ellipse drawn around it; focus: the paragraph with the caret and the bracket beside it (site spec §7.7).";
    await mkdir(path.dirname(ANNOTATIONS), { recursive: true });
    await writeFile(ANNOTATIONS, `${JSON.stringify(file, null, 2)}\n`);
    console.log("wrote", path.relative(path.resolve(HERE, "../.."), ANNOTATIONS));
  }
  process.exitCode = failures ? 1 : 0;
}

await main();
