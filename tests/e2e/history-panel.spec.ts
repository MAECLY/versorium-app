import { expect, test, type Page } from "@playwright/test";

// The history panel had no end-to-end coverage at all: commits were only ever
// asserted as a side effect of an AI rewrite, so its four tabs, its commit
// flow and every label in it were unverified. It is also the surface that
// leaked the most Git vocabulary at a reader who never asked for Git, so these
// tests pin the plain wording as much as the behaviour.
//
// Runs against the mocked IPC (tests/e2e/mock-tauri.ts).

async function withProject(page: Page, title = "El faro") {
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Create your first novel" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
}

async function openHistory(page: Page) {
  await page.getByRole("contentinfo").getByRole("button", { name: "History" }).click();
  return page.getByRole("region", { name: "History" });
}

async function type(page: Page, text: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.type(text);
  // Let the autosave land, or the project has no change to show.
  await page.waitForTimeout(1200);
}

function mockCommits(page: Page) {
  return page.evaluate(() =>
    [...window.__VERSORIUM_MOCK__.projects.values()][0].commits.map((c) => c.message),
  );
}

test("the panel names snapshots, not commits, and says what changed", async ({ page }) => {
  await withProject(page);
  await type(page, "La luz giraba sobre el agua.");

  const history = await openHistory(page);
  // Every tab is plain language: no Status, no Log, no Diff.
  for (const tab of ["Changes", "Snapshots", "What changed", "Advanced"]) {
    await expect(history.getByRole("button", { name: tab, exact: true })).toBeVisible();
  }

  // The Changes tab is one list, not Git's modified / staged / untracked split.
  await expect(history.getByText(/^\d+ changed$/)).toBeVisible();
  await expect(history.getByText("Staged")).toHaveCount(0);
  await expect(history.getByText("Untracked")).toHaveCount(0);

  // Saving asks what changed and calls itself a snapshot.
  await history.getByPlaceholder("What changed").fill("La primera escena");
  await history.getByRole("button", { name: "Save snapshot" }).click();

  await expect.poll(() => mockCommits(page)).toContain("La primera escena");
  await expect(history.getByText("Everything is saved.")).toBeVisible();
});

test("a file in no snapshot yet reads as new, and an edited one as edited", async ({ page }) => {
  await withProject(page);
  await type(page, "Primera línea.");

  let history = await openHistory(page);
  // Nothing has been saved, so the chapter has never been in a snapshot.
  await expect(history.getByText("new", { exact: true }).first()).toBeVisible();

  await history.getByPlaceholder("What changed").fill("Arranque");
  await history.getByRole("button", { name: "Save snapshot" }).click();
  await expect(history.getByText("Everything is saved.")).toBeVisible();
  await history.getByRole("button", { name: "✕" }).click();

  await type(page, " Segunda línea.");
  history = await openHistory(page);
  // Now the same file has a history, so it is a change rather than a new file.
  await expect(history.getByText("edited", { exact: true }).first()).toBeVisible();
});

test("the snapshot list leads with what happened, not with a hash", async ({ page }) => {
  await withProject(page);
  await type(page, "Algo pasó.");
  const history = await openHistory(page);
  await history.getByPlaceholder("What changed").fill("Un cambio con nombre");
  await history.getByRole("button", { name: "Save snapshot" }).click();

  await history.getByRole("button", { name: "Snapshots", exact: true }).click();
  const row = history.getByRole("listitem").filter({ hasText: "Un cambio con nombre" });
  await expect(row).toBeVisible();
  // The short hash is still reachable on hover, but is no longer read first.
  await expect(row).toHaveAttribute("title", /^[0-9a-f]{7}$/);
  await expect(row).not.toContainText(/^[0-9a-f]{7}/);
});

test("Git's own vocabulary is confined to Advanced, and announced there", async ({ page }) => {
  await withProject(page);
  const history = await openHistory(page);

  // Branch, ahead and behind used to sit in the header of every tab.
  await expect(history.getByText("main")).toHaveCount(0);

  await history.getByRole("button", { name: "Advanced", exact: true }).click();
  await expect(history.getByText(/keeps your novel's history in Git/)).toBeVisible();
  await expect(history.getByText(/you never need them to write/)).toBeVisible();
  await expect(history.getByText("main").first()).toBeVisible();
  await expect(history.getByPlaceholder("New branch name")).toBeVisible();
});

test("saving without a description still produces a findable snapshot", async ({ page }) => {
  await withProject(page);
  await type(page, "Texto.");
  const history = await openHistory(page);
  // No description given. This used to store the literal word "checkpoint",
  // so a list of them was indistinguishable -- which defeats the one reason to
  // keep the list: finding a point worth returning to.
  await history.getByRole("button", { name: "Save snapshot" }).click();
  await expect.poll(async () => (await mockCommits(page))[0]).toMatch(/^Snapshot of /);
  expect(await mockCommits(page)).not.toContain("checkpoint");
});

test("the history panel is translated", async ({ page }) => {
  await withProject(page);
  await page.getByRole("contentinfo").getByRole("button", { name: "ES", exact: true }).click();
  const history = await page.getByRole("region", { name: "Historial" });
  await page.getByRole("contentinfo").getByRole("button", { name: "Historial" }).click();

  for (const tab of ["Cambios", "Instantáneas", "Qué cambió", "Avanzado"]) {
    await expect(history.getByRole("button", { name: tab, exact: true })).toBeVisible();
  }
  await expect(history.getByRole("button", { name: "Guardar instantánea" })).toBeVisible();
});
