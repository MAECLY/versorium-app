import { expect, test, type Locator, type Page } from "@playwright/test";

// Per-project settings: the novel's language, which a new novel and an import
// also set, and the export's title page and colophon, with a preview of what
// the first and last pages will say. Runs against the mocked IPC.

async function openProjectSettings(page: Page) {
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Create your first novel" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Title").fill("El largo invierno");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();

  await page.getByRole("button", { name: "Actions for the novel El largo invierno" }).click();
  await page.getByRole("menuitem", { name: "Project settings…" }).click();
  return page.getByRole("dialog", { name: "Project" });
}

function meta(page: Page) {
  return page.evaluate(() => [...window.__VERSORIUM_MOCK__.projects.values()][0].meta);
}

/** The languages `update_project` was sent, in order. */
function languagesSent(page: Page) {
  return page.evaluate(() =>
    window.__VERSORIUM_MOCK__.calls.filter((c) => c.cmd === "update_project").map((c) => c.args.language),
  );
}

/**
 * Put a code on a picker that the app never offers there, as a stale or
 * tampered page could send it, so what Rust (and the mock, which mirrors it)
 * refuses can be seen refused.
 */
async function offerUnlisted(picker: Locator, code: string) {
  await picker.evaluate((select, value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  }, code);
}

test("both are on by default, and the dialog shows what the title page will say", async ({ page }) => {
  const settings = await openProjectSettings(page);

  const boxes = settings.getByRole("checkbox");
  await expect(boxes).toHaveCount(2);
  await expect(boxes.nth(0)).toBeChecked();
  await expect(boxes.nth(1)).toBeChecked();

  // A setting whose effect you can see is a setting you can decide about.
  await expect(settings.getByText("Title page", { exact: true })).toBeVisible();
  await expect(settings.getByText("El largo invierno").first()).toBeVisible();
});

test("turning the colophon off leaves no trace of the app in the file", async ({ page }) => {
  const settings = await openProjectSettings(page);

  // The preview of the last page is visible while it is on...
  await expect(settings.getByText("About this book")).toBeVisible();
  await settings.getByRole("checkbox").nth(1).uncheck();

  // ...and gone when it is off, because the page itself will be.
  await expect(settings.getByText("About this book")).toHaveCount(0);
  await expect.poll(async () => (await meta(page)).exportColophon).toBe(false);
  // And the other one is untouched.
  expect((await meta(page)).exportCover).toBe(true);
});

test("the settings live with the novel, so they survive reopening it", async ({ page }) => {
  const settings = await openProjectSettings(page);
  await settings.getByRole("checkbox").nth(0).uncheck();
  await expect.poll(async () => (await meta(page)).exportCover).toBe(false);

  await settings.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Actions for the novel El largo invierno" }).click();
  await page.getByRole("menuitem", { name: "Project settings…" }).click();

  const again = page.getByRole("dialog", { name: "Project" });
  await expect(again.getByRole("checkbox").nth(0)).not.toBeChecked();
  await expect(again.getByRole("checkbox").nth(1)).toBeChecked();
});

test("the project settings are translated", async ({ page }) => {
  await openProjectSettings(page);
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("contentinfo").getByRole("button", { name: "ES", exact: true }).click();
  await page.getByRole("button", { name: /Acciones de la novela/ }).first().click();
  await page.getByRole("menuitem", { name: "Ajustes del proyecto…" }).click();
  const settings = page.getByRole("dialog", { name: "Proyecto" });
  await expect(settings.getByText("Abrir las exportaciones con una portada")).toBeVisible();
  // Called what New project calls it: one name for one setting.
  await expect(settings.getByLabel("Idioma del manuscrito")).toHaveValue("en");
  await expect(settings.getByText(/Los lectores de pantalla leen la página en este idioma/)).toBeVisible();
  // The closing page is read by whoever opens the book, so its preview is in
  // the novel's language (English here), not the interface's.
  await expect(settings.getByText("About this book")).toBeVisible();
  await expect(settings.getByText("Sobre este libro")).toHaveCount(0);
});

test("the closing page's preview is in the novel's language, and follows the picker", async ({ page }) => {
  const settings = await openProjectSettings(page);
  // The one part of the dialog in the novel's language, so marked for a screen reader.
  const card = settings.locator(".v-card[lang]");
  await expect(card.getByText("About this book")).toBeVisible();
  await expect(card).toHaveAttribute("lang", "en");

  await settings.getByLabel("Manuscript language").selectOption("es");
  await expect(card).toHaveAttribute("lang", "es");
  await expect(card.getByText("Sobre este libro")).toBeVisible();
  // As colophon_lines writes the row: the label in the novel's language, then the code.
  await expect(card.getByText("Idioma: es", { exact: true })).toBeVisible();
  await expect(card.getByText("Título: El largo invierno", { exact: true })).toBeVisible();
  await expect(card.getByText("Gracias por escribirlo aquí.")).toBeVisible();
  // The dialog's own words stay in the interface's language.
  await expect(settings.getByText("Open exports with a title page")).toBeVisible();
});

test("the closing page's preview carries the profile's publisher and rights, as the export writes them", async ({
  page,
}) => {
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Create your first novel" }).click();
  const create = page.getByRole("dialog", { name: "New project" });
  await create.getByLabel("Title").fill("El largo invierno");
  await create.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
  // The dialog reads the author profile when it opens.
  await page.evaluate(() => {
    window.__VERSORIUM_MOCK__.settings.authorProfiles.work = {
      name: "Ana Ruiz",
      sortAs: "",
      role: "",
      organization: "Editorial Norte",
      rights: "© 2026 Ana Ruiz",
    };
  });
  await page.getByRole("button", { name: "Actions for the novel El largo invierno" }).click();
  await page.getByRole("menuitem", { name: "Project settings…" }).click();
  const card = page.getByRole("dialog", { name: "Project" }).locator(".v-card[lang]");

  await expect(card.getByText("Author: Ana Ruiz", { exact: true })).toBeVisible();
  await expect(card.getByText("Publisher: Editorial Norte", { exact: true })).toBeVisible();
  await expect(card.getByText("Rights: © 2026 Ana Ruiz", { exact: true })).toBeVisible();
});

/** The page's editable text, and a mark on it that a rebuilt editor would not carry. */
async function markEditor(page: Page) {
  const content = page.locator(".cm-content");
  await content.evaluate((el) => Object.assign(el, { versoriumMark: true }));
  return {
    content,
    stillMarked: () => content.evaluate((el) => (el as HTMLElement & { versoriumMark?: boolean }).versoriumMark === true),
  };
}

test("the novel's language can be changed, and the open page follows it without being rebuilt", async ({ page }) => {
  const settings = await openProjectSettings(page);
  const { content, stillMarked } = await markEditor(page);
  await expect(content).toHaveAttribute("lang", "en");

  const picker = settings.getByLabel("Manuscript language");
  await expect(picker).toHaveValue("en");
  await picker.selectOption("es");

  // The page is declared Spanish at once, in the same editor.
  await expect(content).toHaveAttribute("lang", "es");
  await expect.poll(async () => (await meta(page)).language).toBe("es");
  expect(await stillMarked(), "the editor was rebuilt for a change of language").toBe(true);
  // And the closing page every export carries says so too, in Spanish.
  await expect(settings.getByText("Idioma: es")).toBeVisible();

  // It lives with the novel, so the dialog shows it when it opens again.
  await settings.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Actions for the novel El largo invierno" }).click();
  await page.getByRole("menuitem", { name: "Project settings…" }).click();
  await expect(page.getByRole("dialog", { name: "Project" }).getByLabel("Manuscript language")).toHaveValue("es");
});

test("a language the backend refuses springs back, and says why under the picker", async ({ page }) => {
  const settings = await openProjectSettings(page);
  await page.evaluate(() => {
    window.__VERSORIUM_MOCK__.failures.update_project = "io";
  });

  const picker = settings.getByLabel("Manuscript language");
  await picker.selectOption("es");
  await expect(settings.getByText("File system error.")).toBeVisible();
  await expect(picker, "the picker shows what the novel is actually in").toHaveValue("en");
  await expect(picker).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(".cm-content")).toHaveAttribute("lang", "en");
  expect((await meta(page)).language).toBe("en");

  // Once the change can be saved it is, and the error goes with it.
  await page.evaluate(() => {
    delete window.__VERSORIUM_MOCK__.failures.update_project;
  });
  await picker.selectOption("es");
  await expect(page.locator(".cm-content")).toHaveAttribute("lang", "es");
  await expect(settings.getByText("File system error.")).toHaveCount(0);

  // A code Rust refuses is refused here too, with its own reason, and the
  // novel stays in the language it was in.
  await offerUnlisted(picker, "fr");
  await picker.selectOption("fr");
  await expect(settings.getByText("That is not a language Versorium offers for a novel.")).toBeVisible();
  await expect(picker).toHaveValue("es");
  await expect(picker).toHaveAttribute("aria-invalid", "true");
  expect((await meta(page)).language).toBe("es");
  expect(await languagesSent(page)).toEqual(["es", "es", "fr"]);
});

test("the last language picked is the one kept, even when the first is still being written", async ({ page }) => {
  const settings = await openProjectSettings(page);
  const picker = settings.getByLabel("Manuscript language");
  await page.evaluate(() => window.__VERSORIUM_MOCK__.hold("update_project"));

  await picker.focus();
  await picker.selectOption("es");
  await expect.poll(() => languagesSent(page)).toEqual(["es"]);
  // Changed back before the first answer came: it waits for that answer, then goes.
  await picker.selectOption("en");
  await expect(picker).toHaveValue("en");
  expect(await languagesSent(page), "two writes to versorium.json at once").toEqual(["es"]);
  // The first answer lands, and the second write is held in its turn.
  await page.evaluate(() => {
    window.__VERSORIUM_MOCK__.release("update_project");
    window.__VERSORIUM_MOCK__.hold("update_project");
  });
  await expect.poll(() => languagesSent(page)).toEqual(["es", "en"]);
  expect((await meta(page)).language).toBe("es");
  await expect(picker, "the picker went back to the pick the writer had already undone").toHaveValue("en");

  await page.evaluate(() => window.__VERSORIUM_MOCK__.release("update_project"));
  await expect.poll(async () => (await meta(page)).language).toBe("en");
  await expect(picker).toHaveValue("en");
  await expect(page.locator(".cm-content")).toHaveAttribute("lang", "en");
  await expect(picker, "the picker was never taken from the writer").toBeFocused();
});

test("a language the novel holds outside the list shows as itself, not as the first one offered", async ({ page }) => {
  // As a versorium.json edited by hand would hold it.
  await page.goto("/?mock=tauri&seed=1&seedLanguage=fr");
  await page.getByRole("button", { name: "Actions for the novel Novela 1" }).click();
  await page.getByRole("menuitem", { name: "Project settings…" }).click();
  const picker = page.getByRole("dialog", { name: "Project" }).getByLabel("Manuscript language");
  await expect(picker).toHaveValue("fr");
  await expect(picker.locator("option:checked")).toHaveText("fr (not offered)");
});

test("a new novel in a language Versorium does not offer is refused, and nothing is made", async ({ page }) => {
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Create your first novel" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Title").fill("Le phare");
  const picker = dialog.getByLabel("Manuscript language");
  await offerUnlisted(picker, "fr");
  await picker.selectOption("fr");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("That is not a language Versorium offers for a novel.");
  expect(await page.evaluate(() => window.__VERSORIUM_MOCK__.projects.size)).toBe(0);
});

test("the settings scroll inside the dialog: Done stays in view, and no focus ring is cut", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openProjectSettings(page);
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("contentinfo").getByRole("button", { name: "ES", exact: true }).click();
  await page.getByRole("button", { name: /Acciones de la novela/ }).first().click();
  await page.getByRole("menuitem", { name: "Ajustes del proyecto…" }).click();
  const settings = page.getByRole("dialog", { name: "Proyecto" });
  const done = settings.getByRole("button", { name: "Listo" });
  // The settings scroll inside the dialog; the button that closes it does not.
  await expect(done).toBeInViewport({ ratio: 1 });

  await page.evaluate(() => {
    window.__VERSORIUM_MOCK__.failures.update_project = "io";
  });
  const picker = settings.getByLabel("Idioma del manuscrito");
  await picker.selectOption("es");
  await expect(settings.getByText("Error del sistema de archivos.")).toBeVisible();
  await expect(done).toBeInViewport({ ratio: 1 });

  // A scroll box clips what crosses its edges, and the picker reaches the
  // right one: its focus ring (2px, 1px out) still has to fit.
  const room = await picker.evaluate((select) => {
    let box = select.parentElement;
    while (box && getComputedStyle(box).overflowY === "visible") box = box.parentElement;
    return (box?.getBoundingClientRect().right ?? 0) - select.getBoundingClientRect().right;
  });
  expect(room, "the picker's focus ring is cut at the scroll box's edge").toBeGreaterThanOrEqual(3);
});

test("picking a regional language back during a write sends it once, not forever", async ({ page }) => {
  await page.goto("/?mock=tauri&seed=1&seedLanguage=es-MX");
  await page.getByRole("button", { name: "Actions for the novel Novela 1" }).click();
  await page.getByRole("menuitem", { name: "Project settings…" }).click();
  const picker = page.getByRole("dialog", { name: "Project" }).getByLabel("Manuscript language");
  await expect(picker).toHaveValue("es-MX");
  // As over real IPC: each answer arrives on a later task, not a microtask.
  await page.evaluate(() => {
    const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__;
    const invoke = internals.invoke.bind(internals);
    internals.invoke = async (cmd: string, args: unknown) => {
      if (cmd === "update_project") await new Promise((r) => setTimeout(r, 20));
      return invoke(cmd, args);
    };
    window.__VERSORIUM_MOCK__.hold("update_project");
  });
  await picker.selectOption("en");
  await picker.selectOption("es-MX");
  await page.evaluate(() => window.__VERSORIUM_MOCK__.release("update_project"));
  await page.waitForTimeout(1500);
  const sent = await page.evaluate(() =>
    window.__VERSORIUM_MOCK__.calls.filter((c) => c.cmd === "update_project").length,
  );
  await page.waitForTimeout(1000);
  const sent2 = await page.evaluate(() =>
    window.__VERSORIUM_MOCK__.calls.filter((c) => c.cmd === "update_project").length,
  );
  expect(sent2, "writes stopped").toBe(sent);
  expect(sent2).toBeLessThanOrEqual(2);
});

test("New project, the welcome guide and Project settings offer the languages from one list, in one order", async ({
  page,
}) => {
  const optionsOf = (picker: Locator) => picker.locator("option").allTextContents();
  // New project, as the first novel is made.
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Create your first novel" }).click();
  const create = page.getByRole("dialog", { name: "New project" });
  const offered = await optionsOf(create.getByLabel("Manuscript language"));
  await page.keyboard.press("Escape");

  // Project settings: the list Project settings and the import share.
  const settings = await openProjectSettings(page);
  const expected = await optionsOf(settings.getByLabel("Manuscript language"));
  expect(expected).toEqual(["English", "Español"]);
  expect(offered).toEqual(expected);

  // The welcome guide's last step, on a fresh install.
  await page.goto("/?mock=tauri&fresh=1");
  const tour = page.getByRole("dialog", { name: "Welcome to Versorium" });
  const language = tour.getByLabel("Manuscript language");
  for (let step = 0; step < 5 && !(await language.isVisible()); step += 1) {
    await tour.getByRole("button", { name: "Next" }).click();
  }
  expect(await optionsOf(language)).toEqual(expected);
});
