import { expect, test, type Page } from "@playwright/test";

// Per-project export settings: the title page and the colophon, and a preview
// of what the first page will look like. Runs against the mocked IPC.

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
  await expect(settings.getByText("Sobre este libro")).toBeVisible();
});
