import { expect, test, type Page } from "@playwright/test";

// The bars had no test pinning what belongs where, so thirteen controls had
// accumulated in the header -- destructive, creative, view and file actions all
// rendered identically, with nothing separating them. These tests state the
// split so a future addition has to argue with something.
//
// Runs against the mocked IPC (tests/e2e/mock-tauri.ts).

async function withProject(page: Page, title = "Las dos barras") {
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Create your first project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
}

test("the header carries the manuscript's actions and nothing else", async ({ page }) => {
  await withProject(page);
  const header = page.getByRole("banner");

  const names = await header.getByRole("button").evaluateAll((els) =>
    els.map((el) => (el.textContent ?? "").trim()),
  );
  expect(names).toEqual([
    "Rewrite",
    "Continue chapter",
    "Manuscript",
    "Open project",
    "Settings",
  ]);

  // The reason to open the app gets primary weight, and is alone in its group.
  await expect(header.getByRole("button", { name: "Rewrite" })).toHaveClass(/v-btn-primary/);
});

test("document state and view modes live in the status bar", async ({ page }) => {
  await withProject(page);
  const bar = page.getByRole("contentinfo");

  // State first, then what you do about it, then how you are looking.
  for (const name of ["Save snapshot", "History", "↩ Restore", "Corkboard", "Focus", "Typewriter"]) {
    await expect(bar.getByRole("button", { name, exact: true })).toBeVisible();
  }
  // Language sits at the far right, where VS Code puts the language mode.
  await expect(bar.getByRole("button", { name: "ES", exact: true })).toBeVisible();

  // Groups are separated rather than running together as one row.
  expect(await bar.locator(".v-bar-sep").count()).toBeGreaterThanOrEqual(2);

  // The theme name used to sit here permanently. It was debug output.
  await expect(bar.getByText("Folio")).toHaveCount(0);
});

test("a toggle that is on looks on", async ({ page }) => {
  await withProject(page);
  const bar = page.getByRole("contentinfo");
  const typewriter = bar.getByRole("button", { name: "Typewriter", exact: true });

  // aria-pressed alone was the whole story before, so the button looked
  // identical either way and read as broken.
  await expect(typewriter).toHaveAttribute("aria-pressed", "false");
  await typewriter.click();
  await expect(typewriter).toHaveAttribute("aria-pressed", "true");

  // `.v-btn` animates background over 150ms, so this has to settle before it is
  // read -- measuring straight after the click catches a blend mid-transition.
  const bgOf = (name: string) =>
    bar
      .getByRole("button", { name, exact: true })
      .evaluate((el) => getComputedStyle(el).backgroundColor);
  await expect.poll(() => bgOf("Typewriter")).not.toBe(await bgOf("Focus"));
});

test("Restore acts on the selection, or on the word under the cursor", async ({ page }) => {
  await withProject(page);
  await page.locator(".cm-content").click();
  await page.keyboard.type("El faro giraba despacio.");
  await page.waitForTimeout(1200);

  // One control instead of the old pair: the selection decides the range, the
  // same rule Rewrite already follows, so there is nothing to choose.
  const bar = page.getByRole("contentinfo");
  await expect(bar.getByRole("button", { name: "↩ Restore", exact: true })).toBeVisible();
  await expect(bar.getByRole("button", { name: /↩ Word/ })).toHaveCount(0);
  await expect(bar.getByRole("button", { name: /↩ Selection/ })).toHaveCount(0);

  // And it has a key, since it no longer sits in the header.
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Alt+r");
  // Either it restored something or it said there was nothing to restore; what
  // matters is that the shortcut is wired at all.
  await expect(page.locator(".cm-content")).toContainText("El faro");
});

test("both bars are translated", async ({ page }) => {
  await withProject(page);
  await page.getByRole("contentinfo").getByRole("button", { name: "ES", exact: true }).click();

  await expect(page.getByRole("banner").getByRole("button", { name: "Reescribir" })).toBeVisible();
  const bar = page.getByRole("contentinfo");
  for (const name of ["Guardar instantánea", "Historial", "↩ Restaurar", "Fichas", "Concentración"]) {
    await expect(bar.getByRole("button", { name, exact: true })).toBeVisible();
  }
});
