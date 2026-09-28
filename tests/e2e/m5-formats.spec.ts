import { expect, test, type Page } from "@playwright/test";

// M5 DoD in the browser: export in four formats with the losses named, and an
// import that shows what it cannot carry before anything is written.
// Runs against the mocked IPC (tests/e2e/mock-tauri.ts).

async function openManuscript(page: Page) {
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Create your first project" }).click();
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
});
