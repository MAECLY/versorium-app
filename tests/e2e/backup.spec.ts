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
  await expect(backup.getByText(/live repository inside a synced folder gets corrupted/)).toBeVisible();
});

test("a destination says whether it actually leaves the machine", async ({ page }) => {
  await withProject(page);
  const backup = await openBackup(page);

  // The distinction the whole rule turns on: a second disk survives a dead
  // drive, not a burnt flat, and calling both "backup" hides that.
  const icloud = backup.locator(".v-card").filter({ hasText: "iCloud Drive" });
  await expect(icloud.getByText("leaves this machine")).toBeVisible();
  const disk = backup.locator(".v-card").filter({ hasText: "Another disk" });
  await expect(disk.getByText("same room as the novel")).toBeVisible();
});

test("choosing a destination then backing up lists the archive under its name", async ({ page }) => {
  await withProject(page);
  const backup = await openBackup(page);

  // Nothing happens until a destination is chosen: writing a novel somewhere
  // nobody agreed to is not a sensible default.
  await expect(backup.getByRole("button", { name: "Back up now" })).toHaveCount(0);

  await backup.getByRole("button", { name: "Use this" }).first().click();
  await expect(backup.getByText("Backups will go here too.")).toBeVisible();

  await backup.getByRole("button", { name: "Back up now" }).click();
  // Every message names its destination, because there can be three.
  await expect(backup.getByText(/^iCloud Drive: saved, /)).toBeVisible();
  await expect(backup.getByRole("button", { name: "Restore" })).toHaveCount(1);

  // Restoring never writes over the original, and says so where it is offered.
  await expect(backup.getByText(/extracts a copy beside this novel/)).toBeVisible();
  await backup.getByRole("button", { name: "Restore" }).click();
  await expect(backup.getByText(/^Restored to /)).toBeVisible();
});

test("a destination that is gone does not fail the ones that are there", async ({ page }) => {
  await withProject(page);
  const backup = await openBackup(page);

  await backup.locator(".v-card").filter({ hasText: "iCloud Drive" }).getByRole("button").click();
  // The mock treats this one as an unplugged drive.
  await backup.locator(".v-card").filter({ hasText: "Another disk" }).getByRole("button").click();
  await backup.getByRole("button", { name: "Back up now" }).click();

  await expect(backup.getByText(/^iCloud Drive: saved, /)).toBeVisible();
  // Reported as its own outcome, and as "next time" rather than as an error:
  // an unplugged disk is not a failure.
  await expect(backup.getByText(/^Another disk: not reachable right now/)).toBeVisible();
  await expect(backup.getByRole("alert")).toHaveCount(0);
});

test("three copies on one disk are not reported as three", async ({ page }) => {
  await withProject(page);
  const backup = await openBackup(page);

  // A folder on the novel's own disk: the mistake the rule exists to catch.
  await backup.locator(".v-card").filter({ hasText: "Folder" }).getByRole("button").click();
  await expect(backup.getByText("2 copies")).toBeVisible();
  await expect(backup.getByText("on 1 separate disks")).toBeVisible();
  await expect(backup.getByText("none of them off this machine")).toBeVisible();
  await expect(backup.getByText(/is on the same disk as the novel/)).toBeVisible();

  // Adding the provider fixes both halves of it.
  await backup.locator(".v-card").filter({ hasText: "iCloud Drive" }).getByRole("button").click();
  await expect(backup.getByText("3 copies")).toBeVisible();
  await expect(backup.getByText("one of them off this machine")).toBeVisible();
});

test("a fourth destination is refused rather than silently dropped", async ({ page }) => {
  await withProject(page);
  const backup = await openBackup(page);

  for (const label of ["iCloud Drive", "Another disk", "Folder"]) {
    await backup.locator(".v-card").filter({ hasText: label }).getByRole("button").click();
  }
  // Four counting the novel, which is what the rule counts.
  await expect(backup.getByText("4 copies")).toBeVisible();
  // The folder picker is the only other way in, and it closes too.
  await expect(backup.getByRole("button", { name: "Choose a folder…" })).toBeDisabled();
});

test("an archive can be checked, and says what checking means", async ({ page }) => {
  await withProject(page);
  const backup = await openBackup(page);
  await backup.getByRole("button", { name: "Use this" }).first().click();
  await backup.getByRole("button", { name: "Back up now" }).click();

  await expect(backup.getByText(/reads every file back/)).toBeVisible();
  await backup.getByRole("button", { name: "Check" }).click();
  await expect(backup.getByText("Read back in full and intact.")).toBeVisible();
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
