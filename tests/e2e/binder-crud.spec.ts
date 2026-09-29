import { expect, test, type Page } from "@playwright/test";

// Renaming, restatusing and deleting a novel or a chapter. Until now the binder
// could only create and read: a mistyped chapter title was permanent, a chapter
// could never be removed, and the status the UI displayed could not be changed
// by anything. Runs against the mocked IPC (tests/e2e/mock-tauri.ts).

async function withProject(page: Page, title = "El largo invierno") {
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Create your first project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
}

async function addChapter(page: Page, title: string) {
  await page.getByRole("button", { name: "New chapter" }).click();
  const dialog = page.getByRole("dialog", { name: "New chapter" });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByRole("button", { name: "Create" }).click();
}

function chapterMenu(page: Page, title: string) {
  return page.getByRole("button", { name: `Actions for chapter ${title}` });
}

/** The row itself, not the menu button that names the same chapter. */
function chapterRow(page: Page, title: string) {
  return page.getByRole("button", { name: title, exact: false }).filter({ hasText: title }).first();
}

test("a chapter can be renamed, and its file does not move", async ({ page }) => {
  await withProject(page);
  const before = await page.evaluate(
    () => [...window.__VERSORIUM_MOCK__.projects.values()][0].chapters.map((c) => c.file),
  );

  await chapterMenu(page, "El largo invierno").click();
  await page.getByRole("menuitem", { name: "Rename chapter…" }).click();

  const dialog = page.getByRole("dialog", { name: "Rename chapter" });
  // The question somebody renaming a chapter actually has.
  await expect(dialog.getByText(/The file keeps its name/)).toBeVisible();
  await dialog.getByLabel("Title").fill("La llegada");
  await dialog.getByRole("button", { name: "Rename" }).click();

  await expect(dialog).toBeHidden();
  await expect(chapterMenu(page, "La llegada")).toBeVisible();

  const after = await page.evaluate(
    () => [...window.__VERSORIUM_MOCK__.projects.values()][0].chapters.map((c) => c.file),
  );
  expect(after, "renaming moved the file, which would orphan its history").toEqual(before);
});

test("the status can finally be changed, and never offers the one it already is", async ({ page }) => {
  await withProject(page);
  await chapterMenu(page, "El largo invierno").click();

  // A chapter starts as a draft, so the menu offers the other two only.
  await expect(page.getByRole("menuitem", { name: "Mark as revised" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Mark as final" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Mark as draft" })).toHaveCount(0);

  await page.getByRole("menuitem", { name: "Mark as revised" }).click();
  await expect.poll(async () =>
    page.evaluate(() => [...window.__VERSORIUM_MOCK__.projects.values()][0].chapters[0].status),
  ).toBe("revised");

  // And now "revised" is the one that disappears.
  await chapterMenu(page, "El largo invierno").click();
  await expect(page.getByRole("menuitem", { name: "Mark as draft" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Mark as revised" })).toHaveCount(0);
});

test("deleting a chapter says where it went, and takes a snapshot first", async ({ page }) => {
  await withProject(page);
  await addChapter(page, "Segundo");
  await expect(chapterMenu(page, "Segundo")).toBeVisible();

  await chapterMenu(page, "Segundo").click();
  await page.getByRole("menuitem", { name: "Delete chapter" }).click();

  const confirm = page.getByRole("dialog", { name: /Delete “Segundo”/ });
  // Not "are you sure": what the recovery is.
  await expect(confirm.getByText(/stays in the novel's history and can be brought back/)).toBeVisible();
  await confirm.getByRole("button", { name: "Delete chapter" }).click();

  await expect(chapterMenu(page, "Segundo")).toHaveCount(0);
  const commits = await page.evaluate(
    () => [...window.__VERSORIUM_MOCK__.projects.values()][0].commits.map((c) => c.message),
  );
  expect(commits.some((m) => m.includes("before deleting"))).toBe(true);
});

test("cancelling a delete leaves the chapter alone", async ({ page }) => {
  await withProject(page);
  await addChapter(page, "Se queda");
  await chapterMenu(page, "Se queda").click();
  await page.getByRole("menuitem", { name: "Delete chapter" }).click();
  await page.getByRole("dialog", { name: /Delete/ }).getByRole("button", { name: "Cancel" }).click();
  await expect(chapterMenu(page, "Se queda")).toBeVisible();
});

test("a novel can be renamed, and deleting it says it goes to the Trash", async ({ page }) => {
  await withProject(page, "Nombre viejo");

  await page.getByRole("button", { name: "Actions for the novel Nombre viejo" }).click();
  await page.getByRole("menuitem", { name: "Rename novel…" }).click();
  const rename = page.getByRole("dialog", { name: "Rename novel" });
  // The folder not moving is what keeps backups and a GitHub remote pointing at it.
  await expect(rename.getByText(/The folder keeps its name/)).toBeVisible();
  await rename.getByLabel("Title").fill("Nombre nuevo");
  await rename.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByRole("button", { name: "Actions for the novel Nombre nuevo" })).toBeVisible();

  await page.getByRole("button", { name: "Actions for the novel Nombre nuevo" }).click();
  await page.getByRole("menuitem", { name: "Move to Trash" }).click();
  const confirm = page.getByRole("dialog", { name: /Move “Nombre nuevo” to the Trash/ });
  // Git cannot recover a deleted repository, so the recovery named is the one
  // the writer already knows.
  await expect(confirm.getByText(/system Trash, including its history/)).toBeVisible();
  await confirm.getByRole("button", { name: "Move to Trash" }).click();

  await expect.poll(async () =>
    page.evaluate(() => window.__VERSORIUM_MOCK__.projects.size),
  ).toBe(0);
});

test("an empty title is refused rather than saved", async ({ page }) => {
  await withProject(page);
  await chapterMenu(page, "El largo invierno").click();
  await page.getByRole("menuitem", { name: "Rename chapter…" }).click();
  const dialog = page.getByRole("dialog", { name: "Rename chapter" });

  await dialog.getByLabel("Title").fill("   ");
  // Refused in the dialog, so a chapter nobody can identify never reaches disk.
  await expect(dialog.getByRole("button", { name: "Rename" })).toBeDisabled();
  // And so is a rename to the same thing, which would be a no-op commit.
  await dialog.getByLabel("Title").fill("El largo invierno");
  await expect(dialog.getByRole("button", { name: "Rename" })).toBeDisabled();
});

test("the binder actions are translated", async ({ page }) => {
  await withProject(page);
  await page.getByRole("contentinfo").getByRole("button", { name: "ES", exact: true }).click();
  await page.getByRole("button", { name: /Acciones de la novela/ }).first().click();
  await expect(page.getByRole("menuitem", { name: "Renombrar novela…" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Mover a la papelera" })).toBeVisible();
});
