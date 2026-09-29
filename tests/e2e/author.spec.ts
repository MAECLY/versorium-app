import { expect, test, type Page } from "@playwright/test";

// Author metadata: two profiles, and each field saying where it lands. Runs
// against the mocked IPC (tests/e2e/mock-tauri.ts).

async function openAuthor(page: Page) {
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Create your first project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Title").fill("El largo invierno");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByRole("button", { name: "Writing" }).click();
  return settings.getByRole("region", { name: "Author" });
}

function stored(page: Page) {
  return page.evaluate(() => {
    const calls = window.__VERSORIUM_MOCK__.calls.filter((c) => c.cmd === "set_settings");
    return calls.at(-1)?.args as Record<string, unknown> | undefined;
  });
}

test("every field says where it ends up", async ({ page }) => {
  const author = await openAuthor(page);

  // A metadata field whose destination is unstated is one somebody finds out
  // about from a publisher.
  await expect(author.getByText(/Written as the author into EPUB, DOCX, PDF and Markdown/)).toBeVisible();
  await expect(author.getByText(/EPUB only, as a MARC relator code/)).toBeVisible();
  await expect(author.getByText(/The publisher in EPUB, the company in DOCX/)).toBeVisible();
  // And the promise that keeps this local-first.
  await expect(author.getByText(/Nothing here is sent anywhere/)).toBeVisible();
});

test("the two profiles are kept apart", async ({ page }) => {
  const author = await openAuthor(page);

  await author.getByLabel("Name").fill("Ana Ruiz");
  await author.getByLabel("Publisher or company").fill("Minotauro");
  await author.getByLabel("Publisher or company").blur();
  await expect(author.getByText("Saved.")).toBeVisible();

  await author.getByRole("button", { name: /Personal/ }).click();
  // The whole point: filling one leaves the other empty.
  await expect(author.getByLabel("Name")).toHaveValue("");
  await author.getByLabel("Name").fill("A. R. Nocturna");

  await author.getByRole("button", { name: /Work/ }).click();
  await expect(author.getByLabel("Name")).toHaveValue("Ana Ruiz");
  await expect(author.getByLabel("Publisher or company")).toHaveValue("Minotauro");

  const patch = await stored(page);
  const profiles = (patch?.patch as { authorProfiles: Record<string, { name: string }> }).authorProfiles;
  expect(profiles.work.name).toBe("Ana Ruiz");
  expect(profiles.hobby.name).toBe("A. R. Nocturna");
});

test("the sort name shows the guess it would use rather than leaving it a mystery", async ({ page }) => {
  const author = await openAuthor(page);
  await author.getByLabel("Name").fill("Ursula K. Le Guin");
  // Blank does not mean absent: it means this.
  await expect(author.getByLabel("Sort as")).toHaveAttribute("placeholder", "Guin, Ursula K. Le");
});

test("only one profile is used for exports, and switching says which", async ({ page }) => {
  const author = await openAuthor(page);
  const use = author.getByRole("checkbox");

  // Work is in use, so its own checkbox is already on and cannot be unset:
  // exports need a profile, and none is not one of the two answers.
  await expect(use).toBeChecked();
  await expect(use).toBeDisabled();

  await author.getByRole("button", { name: /Personal/ }).click();
  await expect(use).not.toBeChecked();
  await use.check();
  expect(((await stored(page))?.patch as { authorProfile: string }).authorProfile).toBe("hobby");
});

test("the author section is translated", async ({ page }) => {
  await openAuthor(page);
  await page.getByRole("contentinfo").getByRole("button", { name: "ES", exact: true }).click();
  const author = page.getByRole("region", { name: "Autor" });
  await expect(author.getByLabel("Línea de copyright")).toBeVisible();
  await expect(author.getByText(/Solo EPUB, como código MARC/)).toBeVisible();
});
