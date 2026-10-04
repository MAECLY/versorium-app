import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

// Settings → Editor, judged by what the manuscript renders: attributes on
// CodeMirror's content, computed styles, the gutter, the band behind the
// current paragraph, what Tab does. The typewriter regression stayed hidden
// because its test read a constant; these read the page.
//
// `persist` keeps the mock's settings across a reload, the way settings.json
// outlives a relaunch, so "survives a reload" means read back from storage.

const SEEDED = "/?mock=tauri&seed=1&persist=1";

/**
 * A family list as names, the way an engine resolves it: Chrome hands back the
 * quotes a stack was written with and WebKit drops them, and neither is the
 * face.
 */
function families(list: string): string[] {
  return list.split(",").map((family) => family.trim().replace(/^(["'])(.*)\1$/, "$2"));
}

/** The catalogue Rust embeds: the stacks the page should render in. */
const CATALOG = JSON.parse(readFileSync("fonts/catalog.json", "utf8")) as {
  fonts: { id: string; family: string; role: string; stack: string; bundled: boolean; available: boolean }[];
};
const stackOf = (id: string): string[] => families(CATALOG.fonts.find((face) => face.id === id)!.stack);

/** What the manuscript's editing host renders right now. */
async function rendered(page: Page) {
  return page.locator(".cm-content").evaluate((el) => {
    const style = getComputedStyle(el);
    // `ch` is the width of "0" in the content's own font, so it is measured
    // in that font rather than assumed.
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;display:inline-block;width:100ch;";
    probe.style.fontFamily = style.fontFamily;
    probe.style.fontSize = style.fontSize;
    document.body.appendChild(probe);
    const ch = probe.getBoundingClientRect().width / 100;
    probe.remove();
    const band = document.querySelector(".cm-activeLine");
    // The theme's own tint, resolved the same way the stylesheet resolves it.
    const tint = document.createElement("div");
    tint.style.background = "color-mix(in srgb, var(--sel) 38%, transparent)";
    document.body.appendChild(tint);
    const themeBand = getComputedStyle(tint).backgroundColor;
    tint.remove();
    return {
      spellcheck: el.getAttribute("spellcheck"),
      lang: el.getAttribute("lang"),
      autocorrect: el.getAttribute("autocorrect"),
      autocapitalize: el.getAttribute("autocapitalize"),
      writingsuggestions: el.getAttribute("writingsuggestions"),
      fontSize: style.fontSize,
      lineHeight: Math.round((parseFloat(style.lineHeight) / parseFloat(style.fontSize)) * 100) / 100,
      measure: Math.round(parseFloat(style.maxWidth) / ch),
      width: Math.round(el.getBoundingClientRect().width),
      maxWidth: Math.round(parseFloat(style.maxWidth)),
      numbers: document.querySelector(".cm-lineNumbers") !== null,
      band: band ? getComputedStyle(band).backgroundColor : null,
      themeBand,
    };
  });
}

async function continueSeeded(page: Page, label: RegExp = /^(Continue|Continuar)/): Promise<void> {
  await page.getByRole("button", { name: label }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
}

/** Open Settings on the Editor group; `title` is the rail's name for Settings. */
async function openEditorSettings(page: Page, title = "Settings") {
  await page.getByRole("banner").getByRole("button", { name: title }).click();
  const settings = page.getByRole("region", { name: title });
  await settings.getByRole("button", { name: "Editor", exact: true }).click();
  return settings;
}

/**
 * Pins `navigator.platform` before the app loads, the way the right-click spec
 * pins it, so a platform-dependent line reads the same on this Mac and on the
 * Linux CI runner.
 */
async function onPlatform(page: Page, platform: "MacIntel" | "Linux x86_64"): Promise<void> {
  await page.addInitScript((value) => {
    Object.defineProperty(Navigator.prototype, "platform", { get: () => value });
  }, platform);
}

async function backToManuscript(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^← (Back to the manuscript|Volver al manuscrito)/ }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
}

/** The face the manuscript renders in, as the engine resolved it, covered or not. */
async function face(page: Page): Promise<string[]> {
  return families(await page.locator(".cm-content").evaluate((el) => getComputedStyle(el).fontFamily));
}

/** Settings a previous launch left behind, read by `?persist=1`; only seeded once, as chrome.spec.ts does. */
async function savedSettings(page: Page, saved: Record<string, unknown>): Promise<void> {
  await page.addInitScript((value) => {
    if (!sessionStorage.getItem("versorium.mock.settings")) {
      sessionStorage.setItem("versorium.mock.settings", JSON.stringify(value));
    }
  }, saved);
}

/**
 * Reading the face fails: the launch's read only (`once`), as a read that lost
 * a race would, so whatever reads it next gets Rust's answer; or every read.
 * Wrapped where the mock installs the IPC, before the app makes its first call.
 */
async function faceReadFails(page: Page, how: "once" | "always"): Promise<void> {
  await page.addInitScript((always) => {
    type Internals = { invoke: (cmd: string, args?: unknown, options?: unknown) => Promise<unknown> };
    let internals: Internals | undefined;
    let failed = false;
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      get: () => internals,
      set(value: Internals) {
        const invoke = value.invoke.bind(value);
        value.invoke = (cmd, args, options) => {
          if (cmd !== "editor_font" || (failed && !always)) return invoke(cmd, args, options);
          failed = true;
          return Promise.reject("io");
        };
        internals = value;
      },
    });
  }, how === "always");
}

const THEMES = ["folio-light", "folio-dark", "quarry-light", "quarry-dark", "needle-light", "needle-dark"];

/**
 * The bar `.v-list-item-active` draws down a chosen row's leading edge, as
 * WCAG contrast against the fill inside the row and against what is painted
 * around it; null when the row draws none.
 */
function markContrast(row: Locator): Promise<{ inside: number; around: number } | null> {
  return row.evaluate((el) => {
    type Rgba = [number, number, number, number];
    const parse = (css: string): Rgba => {
      const rgb = css.match(/rgba?\(([^)]+)\)/);
      if (!rgb) throw new Error(`a colour this does not read: ${css}`);
      const [r, g, b, a = 1] = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return [r, g, b, a];
    };
    const shadow = getComputedStyle(el).boxShadow;
    if (shadow === "none") return null;
    const over = ([r, g, b, a]: Rgba, under: number[]): number[] => [r, g, b].map((c, i) => c * a + under[i] * (1 - a));
    const painted = (node: Element | null): number[] => {
      const chain: Element[] = [];
      for (let n = node; n; n = n.parentElement) chain.unshift(n);
      let bg = [255, 255, 255];
      for (const n of chain) bg = over(parse(getComputedStyle(n).backgroundColor), bg);
      return bg;
    };
    const luminance = (c: number[]): number => {
      const [r, g, b] = c.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (x: number[], y: number[]): number => {
      const [hi, lo] = [luminance(x), luminance(y)].sort((a, b) => b - a);
      return (hi + 0.05) / (lo + 0.05);
    };
    const inside = painted(el);
    const around = painted(el.parentElement);
    const bar = over(parse(shadow), inside);
    return { inside: contrast(bar, inside), around: contrast(bar, around) };
  });
}

/** Each line number against its line: top and height, in CSS pixels. */
function gutterAgainstLines(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, height: r.height };
    };
    const lines = [...document.querySelectorAll(".cm-content > .cm-line")].map(box);
    // The gutter's first element is CodeMirror's hidden width spacer.
    const numbers = [...document.querySelectorAll(".cm-lineNumbers .cm-gutterElement")]
      .filter((el) => getComputedStyle(el).visibility !== "hidden")
      .map(box);
    const off = lines.map((line, i) => {
      const number = numbers[i];
      return number ? Math.max(Math.abs(line.top - number.top), Math.abs(line.height - number.height)) : Infinity;
    });
    return { lines: lines.length, numbers: numbers.length, worst: Math.max(...off), tall: lines.reduce((sum, l) => sum + l.height, 0) };
  });
}

test("a fresh install checks spelling in the novel's language, at the size the page always had", async ({ page }) => {
  await page.goto("/?mock=tauri&seed=1");
  await continueSeeded(page);
  // Put the caret in a paragraph so there is a current one to show.
  await page.locator(".cm-content").click();
  await page.keyboard.type("El invierno fue largo.");

  const page0 = await rendered(page);
  expect(page0).toMatchObject({
    spellcheck: "true",
    // The seeded novel is Spanish and the interface English: the manuscript
    // says what it is, not what the buttons speak.
    lang: "es",
    autocorrect: "off",
    autocapitalize: "sentences",
    writingsuggestions: "false",
    // The middle steps are the page as it was before these settings.
    fontSize: "21px",
    lineHeight: 1.7,
    measure: 72,
    numbers: false,
  });
  // The band is really painted, in the theme's tint: not a class with a
  // transparent background, and not CodeMirror's own light blue.
  expect(page0.band).toBe(page0.themeBand);
  expect(page0.band).not.toBe("rgba(0, 0, 0, 0)");
});

test("Tab leaves the manuscript by default and writes nothing", async ({ page }) => {
  await page.goto("/?mock=tauri&seed=1");
  await continueSeeded(page);
  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.type("Un párrafo.");
  await page.keyboard.press("Home");
  await page.keyboard.press("Tab");

  expect(await content.evaluate((el) => el.contains(document.activeElement))).toBe(false);
  // Raw text, not toHaveText: that trims, and would not see two leading spaces.
  expect(await content.evaluate((el) => el.textContent)).toBe("Un párrafo.");
});

test("every option changes the page, and survives a reload of settings", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(SEEDED);
  await continueSeeded(page);
  await page.locator(".cm-content").click();
  await page.keyboard.type("El invierno fue largo.");
  const before = await rendered(page);

  const settings = await openEditorSettings(page);
  await settings.getByLabel("Check spelling as you type").uncheck();
  await settings.getByLabel("Text size").selectOption("large");
  await settings.getByLabel("Line spacing").selectOption("airy");
  await settings.getByLabel("Text width").selectOption("narrow");
  await settings.getByLabel("Line numbers").check();
  await settings.getByLabel("Highlight the current paragraph").uncheck();
  await settings.getByLabel("Tab key").selectOption("indent");
  await backToManuscript(page);

  const expectChanged = async () => {
    await page.locator(".cm-content").click();
    const now = await rendered(page);
    expect(now).toMatchObject({
      spellcheck: "false",
      lang: "es",
      fontSize: "24px",
      lineHeight: 2,
      measure: 60,
      numbers: true,
      band: null,
    });
    // Narrow is narrow on screen too, not only in the computed style.
    expect(now.width).toBe(now.maxWidth);
    expect(now.width).toBeLessThan(before.width);

    // Tab now indents: two spaces at the start of the paragraph, focus stays.
    // Raw text, because toHaveText trims the very spaces this is about.
    const line = page.locator(".cm-line").first();
    const raw = () => line.evaluate((el) => el.textContent ?? "");
    const text = await raw();
    await page.keyboard.press("Tab");
    await expect.poll(raw).toBe(`  ${text}`);
    expect(await page.locator(".cm-content").evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Shift+Tab");
    await expect.poll(raw).toBe(text);
  };
  await expectChanged();

  // The relaunch: the page goes, the settings stay.
  await page.reload();
  await continueSeeded(page);
  await expectChanged();

  // And the panel shows what the page does.
  const again = await openEditorSettings(page);
  await expect(again.getByLabel("Check spelling as you type")).not.toBeChecked();
  await expect(again.getByLabel("Text size")).toHaveValue("large");
  await expect(again.getByLabel("Line spacing")).toHaveValue("airy");
  await expect(again.getByLabel("Text width")).toHaveValue("narrow");
  await expect(again.getByLabel("Line numbers")).toBeChecked();
  await expect(again.getByLabel("Highlight the current paragraph")).not.toBeChecked();
  await expect(again.getByLabel("Tab key")).toHaveValue("indent");
});

test("the same options in Spanish, and the language comes from the novel", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(SEEDED);
  await page.getByRole("contentinfo").getByRole("button", { name: "ES", exact: true }).click();

  // A novel written in English, in a Spanish interface.
  await page.getByRole("button", { name: "Nueva novela" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo proyecto" });
  await dialog.getByLabel("Título").fill("The Long Winter");
  await dialog.getByLabel("Idioma del manuscrito").selectOption("en");
  await dialog.getByRole("button", { name: "Crear" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
  expect((await rendered(page)).lang).toBe("en");

  const settings = await openEditorSettings(page, "Ajustes");
  await expect(settings.getByRole("heading", { name: "Editor", exact: true })).toBeVisible();
  await settings.getByLabel("Revisar la ortografía mientras escribes").uncheck();
  await settings.getByLabel("Tamaño del texto").selectOption({ label: "Pequeño" });
  await settings.getByLabel("Interlineado").selectOption({ label: "Compacto" });
  await settings.getByLabel("Ancho del texto").selectOption({ label: "Amplio" });
  await settings.getByLabel("Números de línea").check();
  await settings.getByLabel("Resaltar el párrafo actual").uncheck();
  await settings.getByLabel("Tecla Tab").selectOption({ label: "Sangra el párrafo" });
  await backToManuscript(page);

  const changed = {
    spellcheck: "false",
    lang: "en",
    fontSize: "18px",
    lineHeight: 1.5,
    measure: 84,
    numbers: true,
    band: null,
  };
  const tabIndents = async () => {
    await page.locator(".cm-content").click();
    const line = page.locator(".cm-line").first();
    const raw = () => line.evaluate((el) => el.textContent ?? "");
    const text = await raw();
    await page.keyboard.press("Tab");
    await expect.poll(raw).toBe(`  ${text}`);
  };
  await expect.poll(() => rendered(page)).toMatchObject(changed);
  await tabIndents();

  // After a reload only the seeded Spanish novel exists; it keeps its own
  // language, the interface stays Spanish, and the options stay set.
  await page.reload();
  await continueSeeded(page, /^Continuar/);
  await expect.poll(() => rendered(page)).toMatchObject({ ...changed, lang: "es" });
  await tabIndents();

  const again = await openEditorSettings(page, "Ajustes");
  await expect(again.getByLabel("Revisar la ortografía mientras escribes")).not.toBeChecked();
  await expect(again.getByLabel("Tamaño del texto")).toHaveValue("small");
  await expect(again.getByLabel("Interlineado")).toHaveValue("compact");
  await expect(again.getByLabel("Ancho del texto")).toHaveValue("wide");
  await expect(again.getByLabel("Números de línea")).toBeChecked();
  await expect(again.getByLabel("Resaltar el párrafo actual")).not.toBeChecked();
  await expect(again.getByLabel("Tecla Tab")).toHaveValue("indent");
});

test("typewriter still pads the page with the new sizes set", async ({ page }) => {
  // The options must not reopen the cascade the typewriter padding once lost.
  await page.goto(SEEDED);
  await continueSeeded(page);
  const settings = await openEditorSettings(page);
  await settings.getByLabel("Text size").selectOption("large");
  await settings.getByLabel("Line spacing").selectOption("airy");
  await settings.getByLabel("Text width").selectOption("wide");
  await backToManuscript(page);

  await page.getByRole("contentinfo").getByRole("button", { name: "Typewriter" }).click();
  const height = page.viewportSize()!.height;
  await expect
    .poll(() => page.locator(".cm-content").evaluate((el) => parseFloat(getComputedStyle(el).paddingTop)))
    .toBeGreaterThan(height * 0.6);
  expect((await rendered(page)).fontSize).toBe("24px");
});

// The spelling hint is read as the box's description, which is what a screen
// reader announces with it.

test("on Linux the spelling switch says nothing is underlined yet, in English and Spanish", async ({ page }) => {
  // WebKitGTK underlines nothing until Rust switches its checker on.
  await onPlatform(page, "Linux x86_64");
  await page.goto("/?mock=tauri&seed=1");
  await continueSeeded(page);
  const box = (await openEditorSettings(page)).getByLabel("Check spelling as you type");
  await expect(box).toHaveAccessibleDescription(/^On Linux nothing is underlined yet: /);
  // Still a switch with its state on show: the choice is kept for the day it
  // takes effect.
  await expect(box).toBeChecked();
  await expect(box).toBeEnabled();

  await page.getByRole("contentinfo").getByRole("button", { name: "ES", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Ajustes" }).getByLabel("Revisar la ortografía mientras escribes"),
  ).toHaveAccessibleDescription(/^En Linux todavía no se subraya nada: /);
});

test("where the webview checks, the spelling hint names the system's checker and not Linux", async ({ page }) => {
  await onPlatform(page, "MacIntel");
  await page.goto("/?mock=tauri&seed=1");
  await continueSeeded(page);
  await expect((await openEditorSettings(page)).getByLabel("Check spelling as you type")).toHaveAccessibleDescription(
    /^Your system's spelling checker underlines the words it does not know\./,
  );
});

test("the face chosen under Typography is the page's at once, and after a reload", async ({ page }) => {
  await page.goto(SEEDED);
  await continueSeeded(page);
  await page.locator(".cm-content").click();
  await page.keyboard.type("El invierno fue largo.");
  // Only this editor carries the mark: if Settings rebuilt it, the mark goes.
  await page.locator(".cm-editor").evaluate((el) => Object.assign(el, { sameEditor: true }));

  const typography = (await openEditorSettings(page)).getByRole("region", { name: "Typography" });
  const row = (name: string) => typography.getByRole("button", { name: new RegExp(`^${name}`) });
  await expect(row("System serif"), "a fresh install's face is marked").toHaveAttribute("aria-current", "true");
  await expect(row("Source Serif 4")).not.toHaveAttribute("aria-current", /./);
  expect(await face(page)).toEqual(stackOf("system-serif"));

  await row("Source Serif 4").click();
  await expect(row("Source Serif 4")).toHaveAttribute("aria-current", "true");
  await expect(row("System serif")).not.toHaveAttribute("aria-current", /./);
  // Live: the page under Settings is in it before anyone goes back to look.
  expect(await face(page)).toEqual(stackOf("source-serif-4"));

  await backToManuscript(page);
  expect(await page.locator(".cm-editor").evaluate((el) => (el as unknown as { sameEditor?: boolean }).sameEditor)).toBe(true);
  expect(await face(page)).toEqual(stackOf("source-serif-4"));
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".cm-content")).toHaveText("");

  // The relaunch: the page opens in the face, with nobody visiting Settings.
  await page.reload();
  await continueSeeded(page);
  expect(await face(page)).toEqual(stackOf("source-serif-4"));
  const again = (await openEditorSettings(page)).getByRole("region", { name: "Typography" });
  await expect(again.getByRole("button", { name: /^Source Serif 4/ })).toHaveAttribute("aria-current", "true");
  await expect(again.getByRole("button", { name: /^System serif/ })).not.toHaveAttribute("aria-current", /./);
});

test("a face the backend refuses leaves the page and the mark where they were, and says why", async ({ page }) => {
  await page.goto(SEEDED);
  await continueSeeded(page);
  const typography = (await openEditorSettings(page)).getByRole("region", { name: "Typography" });
  const row = (name: string) => typography.getByRole("button", { name: new RegExp(`^${name}`) });
  await expect(row("System serif")).toHaveAttribute("aria-current", "true");

  await page.evaluate(() => (window.__VERSORIUM_MOCK__.failures.set_editor_font = "io"));
  await row("Source Serif 4").click();
  await expect(typography.getByRole("alert")).toHaveText("File system error.");
  await expect(row("System serif")).toHaveAttribute("aria-current", "true");
  await expect(row("Source Serif 4")).not.toHaveAttribute("aria-current", /./);
  expect(await face(page)).toEqual(stackOf("system-serif"));

  // The next choice that goes through takes the words away with it.
  await page.evaluate(() => delete window.__VERSORIUM_MOCK__.failures.set_editor_font);
  await row("Source Serif 4").click();
  await expect(row("Source Serif 4")).toHaveAttribute("aria-current", "true");
  await expect(typography.getByRole("alert")).toHaveCount(0);
  expect(await face(page)).toEqual(stackOf("source-serif-4"));
});

test("settings that name a face this catalogue lacks show, and mark, the default", async ({ page }) => {
  // Written by a build whose catalogue had a face this one dropped. Rust's
  // fonts::resolve answers the default under its own id; the mock mirrors it.
  await savedSettings(page, { editorFont: "a-font-that-was-removed" });
  await page.goto(SEEDED);
  await continueSeeded(page);
  expect(await face(page)).toEqual(stackOf("system-serif"));
  const typography = (await openEditorSettings(page)).getByRole("region", { name: "Typography" });
  await expect(typography.getByRole("button", { name: /^System serif/ })).toHaveAttribute("aria-current", "true");
});

test("the line numbers stay level with their lines when the face changes", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(SEEDED);
  await page.getByRole("button", { name: /^Continue/ }).waitFor();
  await page.evaluate(() => {
    const mock = window.__VERSORIUM_MOCK__;
    [...mock.projects.values()][0].chapters[0].body = Array.from(
      { length: 8 },
      (_, i) =>
        `Párrafo ${i + 1}. El invierno fue largo, y la niña esperaba junto a la ventana mientras la nieve borraba ` +
        "el camino del pueblo, la cerca del huerto y las huellas que su padre había dejado al salir antes del alba.",
    ).join("\n\n");
    // A face every machine has, wider than any serif, so the same paragraphs
    // wrap into more lines in it. Only this spec offers it.
    mock.fonts.fonts.push({
      id: "test-mono", family: "Test monospace", role: "body", stack: "monospace",
      license: "test", bundled: false, available: true, note: "",
    });
  });
  await continueSeeded(page);
  await (await openEditorSettings(page)).getByLabel("Line numbers").check();
  await backToManuscript(page);
  const serif = await gutterAgainstLines(page);
  expect(serif.numbers, "control: a number for every line").toBe(serif.lines);
  expect(serif.worst).toBeLessThanOrEqual(1);

  const typography = (await openEditorSettings(page)).getByRole("region", { name: "Typography" });
  await typography.getByRole("button", { name: /^Test monospace/ }).click();
  await expect(typography.getByRole("button", { name: /^Test monospace/ })).toHaveAttribute("aria-current", "true");
  await backToManuscript(page);
  expect(await face(page)).toEqual(["monospace"]);
  await expect.poll(async () => (await gutterAgainstLines(page)).worst).toBeLessThanOrEqual(1);
  const mono = await gutterAgainstLines(page);
  expect(mono.numbers).toBe(mono.lines);
  expect(mono.tall, "control: the new face wrapped the paragraphs into more lines").toBeGreaterThan(serif.tall);
});

test("a face the launch could not read is read again in Typography, and reaches the page", async ({ page }) => {
  await savedSettings(page, { editorFont: "source-serif-4" });
  await faceReadFails(page, "once");
  await page.goto(SEEDED);
  await continueSeeded(page);
  expect(await face(page), "control: unread, the page is in the stylesheet's face").toEqual(stackOf("system-serif"));

  // The visit reads it again, as EditorGroup reads the rest of the group.
  const typography = (await openEditorSettings(page)).getByRole("region", { name: "Typography" });
  await expect(typography.getByRole("button", { name: /^Source Serif 4/ })).toHaveAttribute("aria-current", "true");
  expect(await face(page)).toEqual(stackOf("source-serif-4"));
  await expect(typography.getByRole("alert"), "the failed read says nothing once a read went through").toHaveCount(0);
});

test("with no face read at all, the page and the sample are in the stylesheet's face, and the panel says why", async ({
  page,
}) => {
  await savedSettings(page, { editorFont: "source-serif-4" });
  await faceReadFails(page, "always");
  await page.goto(SEEDED);
  await continueSeeded(page);
  expect(await face(page)).toEqual(stackOf("system-serif"));

  const typography = (await openEditorSettings(page)).getByRole("region", { name: "Typography" });
  await expect(typography.getByRole("alert")).toHaveText("File system error.");
  await expect(typography.locator('[aria-current="true"]'), "no row claims a face nobody read").toHaveCount(0);
  const sample = typography.getByText("El invierno fue largo, y la niña esperaba junto a la ventana.");
  expect(families(await sample.evaluate((el) => getComputedStyle(el).fontFamily))).toEqual(await face(page));
});

test("settings naming a face Typography does not offer mark no row, and the sample shows the page's face", async ({
  page,
}) => {
  // set_editor_font takes the catalogue's mono face, which the panel does not
  // list (TODO.md); a hand edit of settings.json stores it today.
  await savedSettings(page, { editorFont: "system-mono" });
  await page.goto(SEEDED);
  await continueSeeded(page);
  expect(await face(page)).toEqual(stackOf("system-mono"));

  const typography = (await openEditorSettings(page)).getByRole("region", { name: "Typography" });
  await expect(typography.getByRole("button", { name: /^System serif/ })).toBeVisible();
  await expect(typography.locator('[aria-current="true"]')).toHaveCount(0);
  const sample = typography.getByText("El invierno fue largo, y la niña esperaba junto a la ventana.");
  expect(families(await sample.evaluate((el) => getComputedStyle(el).fontFamily))).toEqual(stackOf("system-mono"));
});

test("Typography says which faces are sure to be on the machine, and which show only where installed", async ({
  page,
}) => {
  const offered = CATALOG.fonts.filter((font) => font.role === "body" && !font.bundled);
  expect(offered.some((font) => font.available), "control: a face sure to be there").toBe(true);
  expect(offered.some((font) => !font.available), "control: a face that may not be").toBe(true);
  await page.goto(SEEDED);
  await continueSeeded(page);
  const typography = (await openEditorSettings(page)).getByRole("region", { name: "Typography" });
  for (const font of offered) {
    const row = typography.getByRole("button", { name: new RegExp(`^${font.family}`) });
    const [says, never] = font.available
      ? ["already on this machine", "shows only where it is installed"]
      : ["shows only where it is installed", "already on this machine"];
    await expect(row, font.id).toContainText(says);
    await expect(row, font.id).not.toContainText(never);
  }
});

test("a chosen row is marked so the eye finds it, in every theme, and hover does not imitate it", async ({ page }) => {
  await page.goto(SEEDED);
  await continueSeeded(page);
  const typography = (await openEditorSettings(page)).getByRole("region", { name: "Typography" });
  const chosen = typography.getByRole("button", { name: /^System serif/ });
  const other = typography.getByRole("button", { name: /^Source Serif 4/ });
  await expect(chosen).toHaveAttribute("aria-current", "true");
  await other.hover();
  for (const theme of THEMES) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    const mark = await markContrast(chosen);
    expect(mark, `the face in use, ${theme}`).not.toBeNull();
    // WCAG 1.4.11: 3:1 for what tells a state apart.
    expect(mark!.inside, `against its row, ${theme}`).toBeGreaterThanOrEqual(3);
    expect(mark!.around, `against the panel, ${theme}`).toBeGreaterThanOrEqual(3);
    expect(await markContrast(other), `the row under the pointer, ${theme}`).toBeNull();
  }

  // The panel's open chapter is a chosen row of the same class, on its own background.
  await backToManuscript(page);
  const open = page.locator('[data-item-key^="chapter:"][aria-current="true"]');
  await expect(open).toHaveCount(1);
  for (const theme of THEMES) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    const mark = await markContrast(open);
    expect(mark, `the open chapter, ${theme}`).not.toBeNull();
    expect(mark!.inside, `against its row, ${theme}`).toBeGreaterThanOrEqual(3);
    expect(mark!.around, `against the panel, ${theme}`).toBeGreaterThanOrEqual(3);
  }
});
