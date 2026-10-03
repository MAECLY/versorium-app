import { expect, test, type Page } from "@playwright/test";

// Settings → Editor, judged by what the manuscript renders: attributes on
// CodeMirror's content, computed styles, the gutter, the band behind the
// current paragraph, what Tab does. The typewriter regression stayed hidden
// because its test read a constant; these read the page.
//
// `persist` keeps the mock's settings across a reload, the way settings.json
// outlives a relaunch, so "survives a reload" means read back from storage.

const SEEDED = "/?mock=tauri&seed=1&persist=1";

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
