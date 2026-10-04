import { expect, test, type Locator, type Page } from "@playwright/test";

// M5 DoD in the browser: export in four formats with the losses named, and an
// import that shows what it cannot carry before anything is written.
// Runs against the mocked IPC (tests/e2e/mock-tauri.ts).

async function openManuscript(page: Page) {
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Create your first novel" }).click();
  const newProject = page.getByRole("dialog", { name: "New project" });
  await newProject.getByLabel("Title").fill("The Long Winter");
  await newProject.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();

  // A manuscript with text, so an export is not refused as empty.
  await page.locator(".cm-content").click();
  await page.keyboard.type("El invierno fue largo.");
  await page.waitForTimeout(1200);

  await page.getByRole("banner").getByRole("button", { name: "Manuscript" }).click();
  return page.getByRole("dialog", { name: "Manuscript" });
}

async function lastExport(page: Page) {
  return page.evaluate(() => window.__VERSORIUM_MOCK__.lastExport);
}

test("the four formats are offered with what each is for", async ({ page }) => {
  const dialog = await openManuscript(page);
  for (const name of ["Markdown", "Word (DOCX)", "EPUB 3", "PDF"]) {
    await expect(dialog.getByRole("radio", { name })).toBeVisible();
  }
  await expect(dialog.getByText("The canonical format. Nothing is lost.")).toBeVisible();
  await expect(dialog.getByText(/surname \/ title \/ page in the header/)).toBeVisible();
});

test("a running-head format needs an author before it will export", async ({ page }) => {
  const dialog = await openManuscript(page);
  await dialog.getByRole("radio", { name: "Word (DOCX)" }).check();

  await expect(dialog.getByText("Add an author to export this format.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Export" })).toBeDisabled();

  await dialog.getByLabel("Author").fill("Ursula K. Le Guin");
  await expect(dialog.getByRole("button", { name: "Export" })).toBeEnabled();
});

test("Markdown exports without an author and reports where it landed", async ({ page }) => {
  const dialog = await openManuscript(page);
  await dialog.getByRole("radio", { name: "Markdown" }).check();
  await expect(dialog.getByRole("button", { name: "Export" })).toBeEnabled();

  await dialog.getByRole("button", { name: "Export" }).click();
  await expect(dialog.getByText(/Wrote .* to /)).toBeVisible();
  await expect.poll(async () => (await lastExport(page))?.format).toBe("md");
});

test("an export that cannot carry everything says so", async ({ page }) => {
  const dialog = await openManuscript(page);
  await dialog.getByLabel("Author").fill("Ursula K. Le Guin");
  await dialog.getByRole("radio", { name: "PDF" }).check();
  await dialog.getByRole("button", { name: "Export" }).click();

  await expect(dialog.getByText("This format could not carry everything:")).toBeVisible();
  await expect(
    dialog.getByText("Some characters cannot be printed in a PDF and were replaced."),
  ).toBeVisible();
});

test("an import shows its losses and writes nothing until confirmed", async ({ page }) => {
  const dialog = await openManuscript(page);
  await dialog.getByRole("tab", { name: "Import" }).click();
  await expect(dialog.getByText("Nothing is written until you confirm.")).toBeVisible();

  await dialog.getByRole("button", { name: "Choose a file" }).click();

  // The preview names the chapters and, in warning colour, what cannot cross.
  await expect(dialog.getByLabel("Project title")).toHaveValue("The Salt Road");
  await expect(dialog.getByText("A door in the rain")).toBeVisible();
  await expect(dialog.getByText("What this import cannot carry across")).toBeVisible();
  await expect(dialog.getByText(/Scrivener labels/)).toBeVisible();

  // Still only the one project we started with: the preview wrote nothing.
  expect(await page.evaluate(() => window.__VERSORIUM_MOCK__.projects.size)).toBe(1);

  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect.poll(async () => page.evaluate(() => window.__VERSORIUM_MOCK__.projects.size)).toBe(2);
});

/** What a spec may change in the file the import reads. */
interface PreviewPatch {
  language?: string | null;
  declaredLanguage?: string | null;
  /** The first chapter's synopsis. */
  synopsis?: string;
}

/** The Import tab with a preview read, after the spec says what the file holds. */
async function previewImport(page: Page, patch: PreviewPatch = {}) {
  const dialog = await openManuscript(page);
  await page.evaluate(({ synopsis, ...declares }) => {
    const preview = window.__VERSORIUM_MOCK__.importPreview;
    Object.assign(preview, declares);
    if (synopsis !== undefined) preview.chapters[0].synopsis = synopsis;
  }, patch);
  await dialog.getByRole("tab", { name: "Import" }).click();
  await dialog.getByRole("button", { name: "Choose a file" }).click();
  await expect(dialog.getByLabel("Project title")).toHaveValue("The Salt Road");
  return dialog;
}

/**
 * Room between a control and the sides of the scroll box that holds it. A
 * scroll box clips what crosses its edges, and a focus ring (2px, 1px out)
 * needs 3px of it.
 */
function roomAround(control: Locator): Promise<{ left: number; right: number }> {
  return control.evaluate((el) => {
    let box = el.parentElement;
    while (box && getComputedStyle(box).overflowY === "visible") box = box.parentElement;
    const outer = box?.getBoundingClientRect() ?? el.getBoundingClientRect();
    const inner = el.getBoundingClientRect();
    return { left: inner.left - outer.left, right: outer.right - inner.right };
  });
}

function importedProject(page: Page) {
  return page.evaluate(() =>
    [...window.__VERSORIUM_MOCK__.projects.values()].find((p) => p.meta.title === "The Salt Road")?.meta,
  );
}

test("an import asks for the language when the file does not say, and the novel is written in the one chosen", async ({ page }) => {
  const dialog = await previewImport(page);
  const picker = dialog.getByLabel("Manuscript language");
  // The interface's language is only a preset, and the hint says why it is there.
  await expect(picker).toHaveValue("en");
  await expect(dialog.getByText(/The file does not say what language it is in/)).toBeVisible();
  // It spans the dialog's scroll box, whose edges would cut its focus ring.
  for (const control of [picker, dialog.getByLabel("Project title")]) {
    const room = await roomAround(control);
    expect(Math.min(room.left, room.right), "a focus ring is cut at the scroll box's edge").toBeGreaterThanOrEqual(3);
  }

  await picker.selectOption("es");
  await dialog.getByRole("button", { name: "Create project" }).click();

  await expect
    .poll(() =>
      page.evaluate(() => window.__VERSORIUM_MOCK__.calls.filter((c) => c.cmd === "import_apply").at(-1)?.args.language),
    )
    .toBe("es");
  await expect.poll(async () => (await importedProject(page))?.language).toBe("es");
  // The new novel opens, and its page is declared in the language chosen.
  await expect(page.getByRole("dialog", { name: "Manuscript" })).toBeHidden();
  await expect(page.locator(".cm-content")).toHaveAttribute("lang", "es");
});

test("a language the file gives is the preset, and one Versorium cannot use is named", async ({ page }) => {
  const dialog = await previewImport(page, { language: "es", declaredLanguage: "es-MX" });
  await expect(dialog.getByLabel("Manuscript language")).toHaveValue("es");
  await expect(dialog.getByText("The file gives its language as Español.", { exact: false })).toBeVisible();

  await dialog.getByRole("button", { name: "Discard" }).click();
  await page.evaluate(() =>
    Object.assign(window.__VERSORIUM_MOCK__.importPreview, { language: null, declaredLanguage: "fr" }),
  );
  await dialog.getByRole("button", { name: "Choose a file" }).click();
  await expect(dialog.getByLabel("Manuscript language")).toHaveValue("en");
  await expect(dialog.getByText(/gives its language as “fr”, which Versorium cannot use/)).toBeVisible();

  // Created as the writer left it, not as the file said.
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect.poll(async () => (await importedProject(page))?.language).toBe("en");
});

test("an imported synopsis is what the corkboard card shows", async ({ page }) => {
  // Two lines, as Scrivener's card can hold them.
  const dialog = await previewImport(page, { synopsis: "She leaves.\nAlone." });
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("dialog", { name: "Manuscript" })).toBeHidden();

  await page.getByRole("contentinfo").getByRole("button", { name: "Corkboard" }).click();
  const board = page.getByRole("list", { name: "Corkboard" });
  await expect(page.getByText("Reading chapters…")).toHaveCount(0);

  const withSynopsis = board.getByRole("listitem").filter({ hasText: "A door in the rain" });
  const synopsis = withSynopsis.locator('[data-card-text="synopsis"]');
  await expect(synopsis).toContainText("She leaves.");
  await expect(withSynopsis, "the excerpt was shown over the synopsis").not.toContainText("It rained for three days.");
  // Its lines stay lines on the card, as the browser lays them out.
  expect(await synopsis.evaluate((el) => (el as HTMLElement).innerText)).toContain("She leaves.\nAlone.");
  // Said to a screen reader as what it is.
  await expect(board.getByRole("button", { name: /A door in the rain/ })).toHaveAccessibleName(/Synopsis: She leaves\./);

  // A chapter with none falls back to its first words, marked as an excerpt.
  const without = board.getByRole("listitem").filter({ hasText: "North" });
  const opening = without.locator('[data-card-text="opening"]');
  await expect(opening).toContainText("The road bent north.");
  await expect(board.getByRole("button", { name: /North/ })).toHaveAccessibleName(/Opening lines: The road bent north\./);
  // And to the eye: a quotation in italics, quieter than the writer's own words.
  await expect(opening).toHaveCSS("font-style", "italic");
  await expect(synopsis).toHaveCSS("font-style", "normal");
  const colour = (card: Locator) => card.evaluate((el) => getComputedStyle(el).color);
  expect(await colour(synopsis), "the synopsis is set like the excerpt").not.toBe(await colour(opening));
});

test("an import in a language Versorium does not offer is refused, and nothing is made", async ({ page }) => {
  const dialog = await previewImport(page);
  const before = await page.evaluate(() => window.__VERSORIUM_MOCK__.projects.size);
  // As a stale or tampered page could send it: the picker never offers it.
  const picker = dialog.getByLabel("Manuscript language");
  await picker.evaluate((select) => {
    const option = document.createElement("option");
    option.value = "fr";
    option.textContent = "fr";
    select.append(option);
  });
  await picker.selectOption("fr");
  await dialog.getByRole("button", { name: "Create project" }).click();

  await expect(dialog.getByText("That is not a language Versorium offers for a novel.")).toBeVisible();
  expect(await page.evaluate(() => window.__VERSORIUM_MOCK__.projects.size)).toBe(before);
  // The preview is kept, so the writer can pick again and go on.
  await picker.selectOption("es");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect.poll(async () => (await importedProject(page))?.language).toBe("es");
});

/**
 * WCAG contrast of an element's text against what is painted under it: the
 * computed backgrounds from the root down to the element, composited, so the
 * open chapter's tinted card counts for what shows.
 */
function contrastOf(locator: Locator): Promise<number> {
  return locator.evaluate((el) => {
    type Rgba = [number, number, number, number];
    const parse = (css: string): Rgba => {
      const rgb = css.match(/^rgba?\(([^)]+)\)$/);
      if (rgb) {
        const [r, g, b, a = 1] = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
        return [r, g, b, a];
      }
      // What Chrome computes for color-mix(in srgb, …).
      const srgb = css.match(/^color\(srgb ([^)]+)\)$/);
      if (srgb) {
        const [r, g, b, a = 1] = srgb[1].split(/[\s/]+/).filter(Boolean).map(Number);
        return [r * 255, g * 255, b * 255, a];
      }
      throw new Error(`a colour this does not read: ${css}`);
    };
    const over = ([r, g, b, a]: Rgba, under: number[]): number[] => [r, g, b].map((c, i) => c * a + under[i] * (1 - a));
    const chain: Element[] = [];
    for (let node: Element | null = el; node; node = node.parentElement) chain.unshift(node);
    let bg = [255, 255, 255];
    for (const node of chain) bg = over(parse(getComputedStyle(node).backgroundColor), bg);
    const fg = over(parse(getComputedStyle(el).color), bg);
    const luminance = (c: number[]): number => {
      const [r, g, b] = c.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  });
}

test("a card's words hold AA contrast in every theme, on the open chapter's card too", async ({ page }) => {
  // No colour transitions to wait out between a change and its measurement.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const dialog = await previewImport(page);
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("contentinfo").getByRole("button", { name: "Corkboard" }).click();
  const board = page.getByRole("list", { name: "Corkboard" });
  await expect(board.locator('[data-card-text="opening"]')).toBeVisible();

  for (const open of ["A door in the rain", "North"]) {
    await board.getByRole("button", { name: new RegExp(open) }).click();
    await expect(board.getByRole("button", { name: new RegExp(open) })).toHaveAttribute("aria-current", "true");
    for (const theme of ["folio-light", "folio-dark", "quarry-light", "quarry-dark", "needle-light", "needle-dark"]) {
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      for (const kind of ["synopsis", "opening"]) {
        const ratio = await contrastOf(board.locator(`[data-card-text="${kind}"]`));
        expect(ratio, `${kind}, ${theme}, with "${open}" open`).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
});

test("discarding a preview leaves nothing behind", async ({ page }) => {
  const dialog = await openManuscript(page);
  await dialog.getByRole("tab", { name: "Import" }).click();
  await dialog.getByRole("button", { name: "Choose a file" }).click();
  await expect(dialog.getByText("A door in the rain")).toBeVisible();

  await dialog.getByRole("button", { name: "Discard" }).click();
  await expect(dialog.getByText("A door in the rain")).toBeHidden();
  expect(await page.evaluate(() => window.__VERSORIUM_MOCK__.projects.size)).toBe(1);
});

test("the Manuscript dialog is translated", async ({ page }) => {
  const dialog = await openManuscript(page);
  await dialog.getByRole("button", { name: "Discard" }).or(page.locator("body")).first().click({ force: true }).catch(() => {});
  await page.keyboard.press("Escape");
  await page.getByRole("contentinfo").getByRole("button", { name: "ES", exact: true }).click();
  await page.getByRole("banner").getByRole("button", { name: "Manuscrito" }).click();
  const es = page.getByRole("dialog", { name: "Manuscrito" });
  await expect(es.getByRole("tab", { name: "Exportar" })).toBeVisible();
  await expect(es.getByRole("tab", { name: "Importar" })).toBeVisible();

  // The language question too, preset to the interface's language.
  await es.getByRole("tab", { name: "Importar" }).click();
  await es.getByRole("button", { name: "Elegir un archivo" }).click();
  await expect(es.getByLabel("Idioma del manuscrito")).toHaveValue("es");
  await expect(es.getByText(/El archivo no dice en qué idioma está/)).toBeVisible();
});

test("Scrivener export asks for a folder, because a project is one", async ({ page }) => {
  const dialog = await openManuscript(page);
  await dialog.getByRole("radio", { name: /Scrivener/ }).check();
  await dialog.getByRole("button", { name: "Export" }).click();

  // A save-file dialog would offer to overwrite a file that is about to be a
  // folder, so the bundle is named after the novel inside a chosen directory.
  const exported = await lastExport(page);
  expect(exported?.format).toBe("scriv");
  expect(exported?.path).toMatch(/The Long Winter\.scriv$/);

  // The one loss worth naming, rather than a silent reshaping.
  await expect(dialog.getByText(/Scene breaks become a separator/)).toBeVisible();
});
