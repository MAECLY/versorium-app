import { expect, test, type Page } from "@playwright/test";

// Backup to a folder the OS already syncs, and the credential that is no longer
// kept in a file. Runs against the mocked IPC (tests/e2e/mock-tauri.ts).

async function withProject(page: Page, title = "El largo invierno") {
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Create your first project" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
}

async function openBackup(page: Page) {
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByRole("button", { name: "History & backup" }).click();
  return settings.getByRole("region", { name: "Backup" });
}

test("a synced folder is offered, and one that is not installed says so", async ({ page }) => {
  await withProject(page);
  const backup = await openBackup(page);

  await expect(backup.getByText("iCloud Drive", { exact: true })).toBeVisible();
  // Offered even though it is absent: "not found" corrects an assumption,
  // silence looks like a missing feature.
  await expect(backup.getByText("Dropbox", { exact: true })).toBeVisible();
  await expect(backup.getByText("not found on this machine")).toBeVisible();

  // And the promise that makes this safe at all.
  await expect(backup.getByText(/a live repository inside a synced folder gets corrupted/)).toBeVisible();
});

test("choosing a destination then backing up lists the archive", async ({ page }) => {
  await withProject(page);
  const backup = await openBackup(page);

  // Nothing happens until a destination is chosen: writing a novel somewhere
  // nobody agreed to is not a sensible default.
  await expect(backup.getByRole("button", { name: "Back up now" })).toHaveCount(0);

  await backup.getByRole("button", { name: "Use this" }).first().click();
  await expect(backup.getByText("Backups will go here.")).toBeVisible();

  await backup.getByRole("button", { name: "Back up now" }).click();
  await expect(backup.getByText(/^Saved, /)).toBeVisible();
  await expect(backup.getByText("Stored backups")).toBeVisible();
  await expect(backup.getByRole("button", { name: "Restore" })).toHaveCount(1);

  // Restoring never writes over the original, and says so where it is offered.
  await expect(backup.getByText(/extracts a copy beside this novel/)).toBeVisible();
  await backup.getByRole("button", { name: "Restore" }).click();
  await expect(backup.getByText(/^Restored to /)).toBeVisible();
});

test("an absent destination cannot be chosen", async ({ page }) => {
  await withProject(page);
  const backup = await openBackup(page);
  // Dropbox is not installed in the mock; offering a button that would fail
  // later is worse than disabling it.
  const dropbox = backup.locator(".v-card").filter({ hasText: "Dropbox" });
  await expect(dropbox.getByRole("button", { name: "Use this" })).toBeDisabled();
});

test("GitHub is the advanced option, and the token is never shown back", async ({ page }) => {
  await withProject(page);
  const backup = await openBackup(page);

  // Collapsed, because it needs an account and a token that a synced folder
  // does not.
  await expect(backup.getByPlaceholder("GitHub token")).toHaveCount(0);
  await backup.getByRole("button", { name: "GitHub backup (advanced)" }).click();

  const field = backup.getByPlaceholder("GitHub token");
  await expect(field).toBeVisible();
  await expect(backup.getByText(/never in a file/)).toBeVisible();

  await field.fill("ghp_a_real_looking_token");
  await backup.getByRole("button", { name: "Connect" }).click();

  // Connected, and the field is gone rather than redisplaying the secret.
  await expect(backup.getByText("Connected.")).toBeVisible();
  await expect(backup.getByPlaceholder("GitHub token")).toHaveCount(0);
  await expect(backup.getByText("ghp_a_real_looking_token")).toHaveCount(0);

  // Sending needs a remote, and says which is missing rather than failing as a
  // network error.
  await backup.getByRole("button", { name: "Send to GitHub" }).click();
  await expect(backup.getByRole("alert")).toContainText("no GitHub backup set up yet");
});

test("the backup panel is translated", async ({ page }) => {
  await withProject(page);
  await page.getByRole("contentinfo").getByRole("button", { name: "ES", exact: true }).click();
  await page.getByRole("button", { name: "Ajustes" }).click();
  const settings = page.getByRole("region", { name: "Ajustes" });
  await settings.getByRole("button", { name: "Historial y respaldo" }).click();
  const backup = settings.getByRole("region", { name: "Respaldo" });

  await expect(backup.getByRole("button", { name: "Elegir carpeta…" })).toBeVisible();
  await expect(backup.getByRole("button", { name: "Respaldo en GitHub (avanzado)" })).toBeVisible();
});
