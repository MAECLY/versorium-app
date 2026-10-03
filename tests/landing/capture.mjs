// Screenshots of the real app for the landing page (docs/).
//
// Drives the Svelte UI in a plain browser with the Tauri IPC mocked
// (tests/e2e/mock-tauri.ts, loaded by src/main.ts on `?mock=tauri`). Nothing
// here is a mockup: every pixel is the app's own markup and its own
// stylesheet. What this script adds is the state a writer would have after a
// week with a novel — chapters, statuses, a snapshot history — built through the
// mock's own commands, so the IPC contracts stay exactly the Rust ones.
//
// Three replies are adjusted, and only so the picture matches the shipped app
// rather than the test fixture:
//   - app_info reports 0.1.0 (the fixture says 0.1.0-mock);
//   - models_view lists the real catalogue (models/catalog.json) instead of the
//     fixture's invented models, so no screenshot shows a model the app does not
//     offer;
//   - ai_rewrite returns a written alternative of the selected passage instead
//     of the fixture's "— rewritten by …" echo.
//
// Usage (the Vite dev server must be up on :1420; it is reused if running):
//   node tests/landing/capture.mjs                     # everything
//   node tests/landing/capture.mjs --lang es --theme needle-light --shot editor
// Raw PNGs (and the crop box of each, as JSON) go to $RAW_DIR, default
// /tmp/versorium-landing/raw; encode.py turns them into docs/assets/shots/.

import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { history, novels } from "./novel.mjs";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const APP = process.env.APP_URL ?? "http://localhost:1420/";
const RAW = process.env.RAW_DIR ?? "/tmp/versorium-landing/raw";

const VIEWPORT = { width: 1280, height: 800 };
const SCALE = 2;

const ALL_THEMES = ["folio", "quarry", "needle"].flatMap((t) => [`${t}-light`, `${t}-dark`]);
const ALL_SHOTS = ["editor", "settings", "settings-pinned", "rewrite", "corkboard", "history", "focus"];
// Shots taken with the mode chosen explicitly (Light or Dark pressed) rather
// than following the system, so the landing page can show the picker in the
// same state as its own.
const PINNED = new Set(["settings-pinned"]);

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1].split(",") : fallback;
}

const langs = arg("lang", ["es", "en"]);
const themes = arg("theme", ALL_THEMES);
const shots = arg("shot", ALL_SHOTS);

/** The real catalogue, shaped as the models_view command returns it. */
async function catalogue() {
  const raw = JSON.parse(await readFile(path.join(ROOT, "models/catalog.json"), "utf8"));
  // Two writing models on disk, the rest offered for download: a machine a
  // week into using the app, not one that downloaded everything.
  const ready = new Set(["qwen3-4b-instruct-2507-q4km", "gemma4-12b-it-q5km"]);
  return raw.models.map((m) => ({
    id: m.id,
    family: m.family,
    label: m.label,
    task: m.task,
    tier: m.tier,
    params: m.params,
    quant: m.quant,
    sizeBytes: m.sizeBytes,
    ramHintGB: m.ramHintGB,
    ctx: m.ctx,
    speed: m.speed,
    quality: m.quality,
    badge: m.badge ?? null,
    uncensored: Boolean(m.uncensored),
    license: m.license,
    repo: m.repo,
    state: ready.has(m.id) ? "ready" : "missing",
    receivedBytes: 0,
    fits: m.ramHintGB * 1.2 <= 36,
  }));
}

/**
 * Runs in the page before any app code. Wraps the mock's invoke the moment the
 * mock installs it, and builds the novel on the first call the app makes.
 */
function installSeed(seed) {
  let internals;
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    enumerable: true,
    get() {
      return internals;
    },
    set(value) {
      const invoke = value.invoke.bind(value);
      let ready;

      async function build() {
        const dir = "/mock/Documents/Versorium";
        await invoke("set_settings", { patch: seed.settings });

        // The other novel on the desk, written to days ago.
        const shelf = await invoke("create_project", {
          args: { path: dir, title: seed.shelf.title, language: seed.language },
        });
        await invoke("save_chapter", {
          path: shelf.path,
          file: shelf.chapters[0].file,
          body: seed.shelf.body,
          status: "draft",
        });
        await invoke("git_commit", { path: shelf.path, message: "checkpoint: autosave" });

        const project = await invoke("create_project", {
          args: { path: dir, title: seed.title, language: seed.language },
        });
        const root = project.path;
        const files = [project.chapters[0].file];
        await invoke("update_chapter", { path: root, file: files[0], title: seed.chapters[0].title });
        for (const chapter of seed.chapters.slice(1)) {
          const meta = await invoke("create_chapter", { path: root, title: chapter.title });
          files.push(meta.file);
        }

        // One save per snapshot, so each commit has something in it, exactly
        // as the autosave interval only snapshots a changed project. The last
        // snapshot comes after the last save, so the novel ends clean.
        const later = seed.history.slice(1);
        for (let i = 0; i < later.length; i += 1) {
          const c = i % seed.chapters.length;
          await invoke("save_chapter", {
            path: root,
            file: files[c],
            body: seed.chapters[c].body,
            status: seed.chapters[c].status,
          });
          await invoke("git_commit", { path: root, message: later[i].message });
        }

        const at = (day, hhmm) => {
          const d = new Date();
          d.setDate(d.getDate() - day);
          const [h, m] = hhmm.split(":").map(Number);
          d.setHours(h, m, 0, 0);
          return Math.floor(d.getTime() / 1000);
        };
        const state = window.__VERSORIUM_MOCK__.projects.get(root);
        // git log order: newest first.
        const newestFirst = [...seed.history].reverse();
        state.commits.forEach((c, i) => {
          const h = newestFirst[i];
          if (h) c.time = at(h.day, h.at);
        });
        // "Continue where you left off" opens the chapter written last.
        const last = at(0, "18:52");
        state.chapters.forEach((c) => {
          c.mtime = last - 3600;
        });
        const hero = state.chapters.find((c) => c.id === seed.hero);
        if (hero) hero.mtime = last;
        const other = window.__VERSORIUM_MOCK__.projects.get(shelf.path);
        other.chapters.forEach((c) => {
          c.mtime = at(3, "21:30");
        });
        other.commits.forEach((c, i) => {
          c.time = at(3, i === 0 ? "21:30" : "19:05");
        });
      }

      value.invoke = async (cmd, args = {}) => {
        ready ??= build();
        await ready;
        if (cmd === "app_info") return { version: "0.1.0", os: "macos", family: "unix" };
        if (cmd === "models_view") {
          const view = await invoke(cmd, args);
          const models = seed.catalogue;
          return {
            ...view,
            models,
            slots: { ...view.slots, rewrite: { kind: "builtin", id: seed.rewriteModel } },
            diskUsedBytes: models.filter((m) => m.state === "ready").reduce((a, m) => a + m.sizeBytes, 0),
          };
        }
        if (cmd === "ai_rewrite") {
          await new Promise((r) => setTimeout(r, 150));
          return seed.rewrite.result;
        }
        return invoke(cmd, args);
      };
      internals = value;
    },
  });
}

async function boot(browser, lang, variant, catalogueModels, pinned = false) {
  const [theme, mode] = variant.split("-");
  const novel = novels[lang];
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    locale: lang === "es" ? "es-ES" : "en-US",
    timezoneId: "Europe/Madrid",
    // The app follows the system, as it does on a fresh install; the system is
    // what picks light or dark.
    colorScheme: mode,
    reducedMotion: "reduce",
  });
  await context.addInitScript(installSeed, {
    title: novel.title,
    language: novel.language,
    hero: novel.hero,
    chapters: novel.chapters,
    shelf: novel.shelf,
    history: history(lang),
    rewrite: novel.rewrite,
    rewriteModel: "qwen3-4b-instruct-2507-q4km",
    catalogue: catalogueModels,
    settings: { uiLocale: lang, theme, themeMode: pinned ? mode : "follow", onboarded: true },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${APP}?mock=tauri`);
  const resume = page.getByRole("button", { name: lang === "es" ? /^Continuar «/ : /^Continue “/ });
  await resume.click();
  const hero = novel.chapters[Number(novel.hero.slice(3)) - 1];
  await page.locator(".cm-content").getByText(hero.body.slice(0, 40)).waitFor();
  await page.waitForTimeout(400);
  const applied = await page.evaluate(() => document.documentElement.dataset.theme);
  if (applied !== variant) throw new Error(`theme is ${applied}, wanted ${variant}`);
  return { context, page, errors, novel };
}

/** Park the pointer where it hovers nothing, so no control shows a hover state. */
async function rest(page) {
  await page.mouse.move(VIEWPORT.width - 4, 300);
}

async function blur(page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

/** Each step brings the app to the state it shows and returns the crop, in CSS px. */
const steps = {
  async editor(page) {
    await blur(page);
    return null;
  },

  async settings(page, lang) {
    await page.getByRole("button", { name: lang === "es" ? "Ajustes" : "Settings", exact: true }).click();
    await page.getByRole("button", { name: lang === "es" ? "Apariencia" : "Appearance", exact: true }).click();
    await page.getByRole("radiogroup").first().waitFor();
    await blur(page);
    const select = await page.locator("select").last().boundingBox();
    return { x: 0, y: 0, width: VIEWPORT.width, height: Math.ceil(select.y + select.height + 40) };
  },

  async "settings-pinned"(page, lang) {
    return steps.settings(page, lang);
  },

  async rewrite(page, lang, novel) {
    const { from, to } = novel.rewrite;
    await page.locator(".cm-content").evaluate(
      (el, range) => {
        // EditorView.findFromDOM, without being able to import it here.
        const tile = el.cmTile;
        const view = tile?.root?.view ?? tile?.view;
        const doc = view.state.doc.toString();
        const start = doc.indexOf(range.from);
        const end = doc.indexOf(range.to, start) + range.to.length;
        view.dispatch({ selection: { anchor: start, head: end } });
        view.focus();
      },
      { from, to },
    );
    const label = lang === "es" ? "Reescribir" : "Rewrite";
    await page.getByRole("banner").getByRole("button", { name: label, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: label });
    await dialog.waitFor();
    await page.waitForFunction(() => {
      const select = document.querySelector("dialog[open] select");
      return select && select.options.length > 0;
    });
    await dialog.getByRole("button", { name: label, exact: true }).click();
    await dialog.getByRole("region", { name: lang === "es" ? "Vista previa" : "Preview" }).waitFor();
    await blur(page);
    // The dialog alone. Any margin around it shows the prose behind the scrim
    // cut off mid-line and mid-word, because the dialog is narrower than the
    // text column it covers. The box is rounded inward to whole device pixels,
    // so no backdrop shows along the straight edges; the page rounds the
    // corners to the dialog's own radius, recorded here.
    const box = await dialog.boundingBox();
    const radius = await dialog.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));
    const inward = (v, up) => (up ? Math.ceil(v * SCALE) : Math.floor(v * SCALE)) / SCALE;
    const x = inward(box.x, true);
    const y = inward(box.y, true);
    return {
      x,
      y,
      width: inward(box.x + box.width, false) - x,
      height: inward(box.y + box.height, false) - y,
      radius,
    };
  },

  async corkboard(page, lang) {
    await page.getByRole("button", { name: lang === "es" ? "Fichas" : "Corkboard", exact: true }).click();
    await page.getByRole("list", { name: lang === "es" ? "Fichas" : "Corkboard" }).waitFor();
    await page.waitForFunction(
      () => !/Leyendo capítulos|Reading chapters/.test(document.body.innerText),
    );
    await blur(page);
    return null;
  },

  async history(page, lang) {
    await blur(page);
    await page
      .getByRole("contentinfo")
      .getByRole("button", { name: lang === "es" ? "Historial" : "History", exact: true })
      .click();
    const panel = page.getByRole("region", { name: lang === "es" ? "Historial" : "History" });
    await panel.getByRole("button", { name: lang === "es" ? "Instantáneas" : "Snapshots", exact: true }).click();
    await panel.getByText("m0: project created").waitFor();
    await blur(page);
    const box = await panel.boundingBox();
    const rows = await panel.locator("li").evaluateAll((items) =>
      items.map((li) => {
        const r = li.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, bottom: r.bottom };
      }),
    );
    // Stop at the last row the panel shows whole; a row cut in half reads as a
    // rendering fault rather than as "there is more".
    const whole = rows.filter((r) => r.bottom <= box.y + box.height - 2);
    const left = Math.min(...rows.map((r) => r.x));
    const right = Math.max(...rows.map((r) => r.x + r.w));
    // One pixel past the last whole row keeps its rule and none of the next row.
    const bottom = Math.max(...whole.map((r) => r.bottom)) + 1;
    return {
      x: Math.floor(left - 40),
      y: Math.floor(box.y),
      width: Math.ceil(right - left + 80),
      height: Math.ceil(bottom - box.y),
    };
  },

  async focus(page, lang) {
    await page.getByRole("button", { name: lang === "es" ? "Concentración" : "Focus", exact: true }).click();
    // The status bar stays lit while its own button has focus (that is the
    // :focus-within escape hatch working); a writer's focus is on the page.
    await blur(page);
    await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
    await page.waitForTimeout(300);
    return null;
  },
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const catalogueModels = await catalogue();
let failures = 0;
try {
  for (const lang of langs) {
    await mkdir(path.join(RAW, lang), { recursive: true });
    for (const variant of themes) {
      for (const shot of shots) {
        const { context, page, errors, novel } = await boot(browser, lang, variant, catalogueModels, PINNED.has(shot));
        const base = path.join(RAW, lang, `${shot}-${variant}`);
        try {
          const crop = await steps[shot](page, lang, novel);
          if (shot !== "focus") await rest(page);
          await page.waitForTimeout(250);
          await page.screenshot({ path: `${base}.png`, animations: "disabled" });
          await writeFile(`${base}.json`, JSON.stringify({ scale: SCALE, viewport: VIEWPORT, crop }));
          if (errors.length) throw new Error(`page errors: ${errors.join(" | ")}`);
          console.log("wrote", `${lang}/${shot}-${variant}.png`, crop ? JSON.stringify(crop) : "");
        } catch (e) {
          failures += 1;
          console.error(`FAILED ${lang} ${variant} ${shot}:`, e.message);
          await page.screenshot({ path: path.join(RAW, `FAILED-${lang}-${shot}-${variant}.png`) }).catch(() => {});
        } finally {
          await context.close();
        }
      }
    }
  }
} finally {
  await browser.close();
}
process.exitCode = failures ? 1 : 0;
