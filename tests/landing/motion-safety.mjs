// Motion never costs content (site spec §12.3). In Chrome, WebKit and Firefox,
// with motion allowed and reduced, with and without script, at 375 and 1280:
// walk the page in 400px steps, wait, and at the bottom check that
//   - every heading, paragraph, list item, image and button is fully opaque
//     and visible, save what is hidden by design;
//   - with script and motion: every [data-reveal] has been revealed, and the
//     typed sentence finished within 7 s of the window being half in view;
//   - in Firefox (no scroll timelines): the underlines and rules are drawn and
//     the desk is stacked;
//   - under reduced motion: no animation exists at all.
// Plus, in WebKit, the header V at 1.5 s against its reduced-motion render
// (§7.1: over 1% of pixels apart would mean replacing the masks), and the
// clips' replay restarting in Chrome and WebKit.
//
//   SITE_URL=http://localhost:8742 node tests/landing/motion-safety.mjs [--route /en/] [--engines chrome,webkit,firefox]

import { chromium, firefox, webkit } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import os from "node:os";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const SITE = process.env.SITE_URL ?? "http://localhost:8700";
const route = opt("route", "/");
const engines = opt("engines", "chrome,webkit,firefox").split(",");
const PW = `${os.homedir()}/Library/Caches/ms-playwright`;
const OUT = "/tmp/versorium-landing/motion";
await mkdir(OUT, { recursive: true });

const LAUNCH = {
  chrome: () => chromium.launch({ channel: "chrome", headless: true }),
  webkit: () => webkit.launch({ executablePath: `${PW}/webkit-2336/pw_run.sh` }),
  firefox: () => firefox.launch({ executablePath: `${PW}/firefox-1538/firefox/Nightly.app/Contents/MacOS/firefox` }),
};

const problems = [];
const bad = (where, what) => problems.push(`${where}: ${what}`);

/** In the page, at the bottom: what is not fully shown, minus what is hidden by design. */
function audit({ js, reduce }) {
  const html = document.documentElement;
  const phone = html.classList.contains("phone");
  const designed = (el) =>
    el.closest(".sr-only, [hidden], template, svg") ||
    (el.closest(".replay, .clip-replay") && (reduce || !el.closest(".is-played"))) ||
    (el.closest("[data-phone]") && !phone) ||
    (el.closest("[data-desktop]") && phone) ||
    (js && el.closest(".no-picker, .proof-nojs")) ||
    (!js && el.closest(".picker, .proof-js")) ||
    el.closest("details:not([open]) > :not(summary)") ||
    // On a phone the window is two clippings: the page shows its second paragraph only (§6.6).
    (el.matches(".r-p:not(.is-active)") && innerWidth < 720) ||
    // The comparison's "swipe" hint shows only where its table scrolls sideways.
    (el.closest(".vs-hint") && innerWidth >= 960);
  const opacity = (el) => {
    let o = 1;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
    return o;
  };
  const hidden = [];
  for (const el of document.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li, img, button")) {
    if (designed(el)) continue;
    const cs = getComputedStyle(el);
    const gone = cs.display === "none" || [...function* () { for (let e = el.parentElement; e; e = e.parentElement) yield getComputedStyle(e).display; }()].includes("none");
    if (gone || cs.visibility !== "visible" || opacity(el) < 0.999) {
      hidden.push(`${el.tagName.toLowerCase()}.${[...el.classList].join(".")} "${(el.textContent || el.alt || "").trim().slice(0, 30)}" (opacity ${opacity(el).toFixed(2)}, ${cs.visibility}, ${gone ? "display none" : ""})`);
    }
  }
  const unrevealed = [...document.querySelectorAll("[data-reveal]")].filter((el) => !el.classList.contains("is-in")).length;
  const drawn = (sel) =>
    [...document.querySelectorAll(sel)].every((el) => Math.abs(parseFloat(getComputedStyle(el).strokeDashoffset) || 0) < 0.001);
  return {
    hidden,
    unrevealed,
    animations: document.getAnimations().length,
    underlines: drawn("h2 .ink-under use"),
    rules: drawn(".ink-rule use"),
    stacked: getComputedStyle(document.querySelector(".step")).display !== "contents",
    typed: (() => {
      const rest = document.querySelector(".t-rest");
      return getComputedStyle(rest).visibility === "visible" || rest.textContent === "";
    })(),
  };
}

for (const engine of engines) {
  const browser = await LAUNCH[engine]();
  try {
    for (const reduce of [false, true]) {
      for (const js of [true, false]) {
        for (const width of [375, 1280]) {
          const where = `${engine} ${route} ${reduce ? "reduce" : "motion"} ${js ? "js" : "no-js"} ${width}`;
          const context = await browser.newContext({
            viewport: { width, height: width < 700 ? 812 : 800 },
            reducedMotion: reduce ? "reduce" : "no-preference",
            javaScriptEnabled: js,
          });
          if (js) {
            await context.addInitScript(() => {
              window.__typedAt = null;
              window.__halfAt = null;
              const start = performance.now();
              document.addEventListener("DOMContentLoaded", () => {
                const replica = document.querySelector(".replica");
                if (!replica) return;
                new IntersectionObserver((entries) => {
                  if (entries.some((e) => e.isIntersecting) && window.__halfAt === null) window.__halfAt = performance.now() - start;
                }, { threshold: 0.5 }).observe(replica);
                new MutationObserver(() => {
                  if (replica.classList.contains("idle") && window.__typedAt === null) window.__typedAt = performance.now() - start;
                }).observe(replica, { attributes: true, attributeFilter: ["class"] });
              });
            });
          }
          const page = await context.newPage();
          const errors = [];
          page.on("pageerror", (e) => errors.push(e.message));
          await page.goto(SITE + route, { waitUntil: "load" });
          const height = await page.evaluate(() => document.documentElement.scrollHeight);
          for (let y = 0; y <= height; y += 400) {
            await page.evaluate((y) => window.scrollTo(0, y), y);
            await page.waitForTimeout(250);
          }
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          await page.waitForTimeout(2000);
          const r = await page.evaluate(audit, { js, reduce });
          for (const h of r.hidden) bad(where, `not shown: ${h}`);
          if (js && !reduce && r.unrevealed) bad(where, `${r.unrevealed} [data-reveal] never revealed`);
          if (!r.typed) bad(where, "the typed sentence is not all there");
          if (js && !reduce) {
            const t = await page.evaluate(() => [window.__halfAt, window.__typedAt]);
            if (t[0] === null) bad(where, "the window was never half in view");
            else if (t[1] === null || t[1] - t[0] > 7000) bad(where, `typing finished ${t[1] === null ? "never" : `${Math.round(t[1] - t[0])} ms`} after the window was half in view`);
          }
          if (reduce && r.animations) bad(where, `${r.animations} animation(s) under reduced motion`);
          if (engine === "firefox") {
            if (!r.underlines) bad(where, "an underline is not drawn");
            if (!r.rules) bad(where, "a rule is not drawn");
            if (!r.stacked) bad(where, "the desk is pinned without scroll timelines");
          }
          for (const e of errors) bad(where, `page error ${e}`);
          console.log(`${where}: ${r.hidden.length ? r.hidden.length + " hidden" : "ok"}`);
          await context.close();
        }
      }
    }

    // §7.1: the header V mid-motion against its finished render, in WebKit.
    if (engine === "webkit") {
      const shots = [];
      for (const reduce of [false, true]) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 4, reducedMotion: reduce ? "reduce" : "no-preference" });
        const page = await context.newPage();
        await page.goto(SITE + route, { waitUntil: "load" });
        await page.waitForTimeout(1500);
        const file = `${OUT}/vmark-${reduce ? "still" : "drawn"}.png`;
        await page.locator(".topbar .vmark").screenshot({ path: file });
        shots.push(file);
        await context.close();
      }
      const diff = Number(
        execFileSync("python3", ["-c", `
from PIL import Image, ImageChops
a = Image.open("${shots[0]}").convert("RGB"); b = Image.open("${shots[1]}").convert("RGB")
d = ImageChops.difference(a, b).convert("L").point(lambda v: 255 if v > 24 else 0)
print(sum(1 for v in d.get_flattened_data() if v) / (a.width * a.height))`]).toString(),
      );
      console.log(`webkit header V at 1.5 s: ${(diff * 100).toFixed(2)}% of pixels from the finished V`);
      if (diff > 0.01) bad("webkit V", `${(diff * 100).toFixed(2)}% of pixels differ (§7.1: switch to the clip-path wipe)`);
    }

    // The clips' replay restarts the play-once animation (Chrome and WebKit).
    if (engine === "chrome" || engine === "webkit") {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      await page.goto(SITE + route, { waitUntil: "load" });
      const fig = page.locator(".s-restore");
      await fig.scrollIntoViewIfNeeded();
      await page.waitForTimeout(5500);
      const still = await fig.locator(".window").screenshot();
      // From the keyboard, where focus matters (Safari does not focus a clicked button).
      await fig.locator(".clip-replay").focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1600);
      const mid = await fig.locator(".window").screenshot();
      const focused = await page.evaluate(() => document.activeElement?.classList.contains("clip-replay"));
      if (Buffer.compare(still, mid) === 0) bad(`${engine} replay`, "the Restore clip did not restart");
      if (!focused) bad(`${engine} replay`, "focus left the replay button");
      console.log(`${engine} replay: ${Buffer.compare(still, mid) === 0 ? "did not restart" : "restarted"}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s):`);
  for (const p of [...new Set(problems)]) console.log(" -", p);
  process.exitCode = 1;
} else {
  console.log("motion never hides anything");
}
