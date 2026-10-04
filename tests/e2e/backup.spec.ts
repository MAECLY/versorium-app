import { expect, test, type Page } from "@playwright/test";
import { BACKUP_STATE_EVENT } from "../../src/lib/backup/events";

// Backup to a folder the OS already syncs, and the credential that is no longer
// kept in a file. Runs against the mocked IPC (tests/e2e/mock-tauri.ts).

async function withProject(page: Page, title = "El largo invierno") {
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Create your first novel" }).click();
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
  // Reported as its own outcome rather than as an error: an unplugged disk is
  // not a failure. And without a promise nothing keeps: no backup runs again
  // on its own yet.
  await expect(
    backup.getByText("Another disk: not reachable right now. Press Back up now again once it is connected."),
  ).toBeVisible();
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

test("pressing again with nothing changed does not fill the folder", async ({ page }) => {
  // The reported bug: three presses in under a minute produced three identical
  // archives, each one eating a slot of "keep the newest ten".
  await withProject(page);
  const backup = await openBackup(page);
  await backup.getByRole("button", { name: "Use this" }).first().click();

  await backup.getByRole("button", { name: "Back up now" }).click();
  await expect(backup.getByText(/^iCloud Drive: saved, /)).toBeVisible();

  // One file is one file, so the same state is kept twice...
  await backup.getByRole("button", { name: "Back up now" }).click();
  await expect(backup.getByText(/second copy of the same state/)).toBeVisible();

  // ...and there it stops, with the truth rather than another "saved".
  await backup.getByRole("button", { name: "Back up now" }).click();
  await expect(backup.getByText(/nothing has changed since/)).toBeVisible();
  await expect(backup.getByRole("button", { name: "Restore" })).toHaveCount(2);

  // And the panel says so before anybody presses anything.
  await expect(backup.getByText(/writes a new archive only when the novel has changed/)).toBeVisible();
});

// --- Phase 0: what a backup says when it goes wrong, and what it knows about itself ---

const ICLOUD = "/mock/Library/Mobile Documents/com~apple~CloudDocs";
const STATE_EVENT = BACKUP_STATE_EVENT;
const DISK = "/mock/Volumes/Respaldo";

/** An archive as Rust reports one, for scripted outcomes. */
function archiveAt(dir: string) {
  const name = "versorium-backup-el-largo-invierno-2026-09-28-010000-0123456789abcdef.zip";
  return {
    path: `${dir}/${name}`,
    name,
    bytes: 1_240_000,
    modified: 1_790_553_600,
    stamped: 1_790_553_600,
    print: "0123456789abcdef",
    sha256: "a".repeat(64),
  };
}

test("a destination that could not be written says why, in words, in both languages", async ({ page }) => {
  await withProject(page);
  const backup = await openBackup(page);
  await backup.locator(".v-card").filter({ hasText: "iCloud Drive" }).getByRole("button").click();
  await backup.locator(".v-card").filter({ hasText: "Another disk" }).getByRole("button").click();
  await page.evaluate(
    ({ icloud, disk, archive }) => {
      window.__VERSORIUM_MOCK__.backup.nextOutcomes = [
        { state: "ok", path: icloud, archive, pruned: 0 },
        { state: "failed", path: disk, reason: "backup_no_space" },
      ];
    },
    { icloud: ICLOUD, disk: DISK, archive: archiveAt(ICLOUD) },
  );
  await backup.getByRole("button", { name: "Back up now" }).click();

  // Each destination reports on its own line; the failed one names the cause,
  // in a sentence of its own after the destination's.
  await expect(backup.getByText(/^iCloud Drive: saved, /)).toBeVisible();
  await expect(backup.getByText("Another disk: not saved. The disk is full.")).toBeVisible();
  await expect(page.getByText("Something went wrong.")).toHaveCount(0);

  await page.getByRole("contentinfo").getByRole("button", { name: "ES", exact: true }).click();
  const respaldo = page.getByRole("region", { name: "Ajustes" }).getByRole("region", { name: "Respaldo" });
  await expect(respaldo.getByText("Otro disco: no se guardó. El disco está lleno.")).toBeVisible();
  await expect(page.getByText("Algo salió mal.")).toHaveCount(0);
});

test("a novel whose history was being written is reported busy, not failed", async ({ page }) => {
  await withProject(page);
  const backup = await openBackup(page);
  await backup.getByRole("button", { name: "Use this" }).first().click();
  await page.evaluate((icloud) => {
    window.__VERSORIUM_MOCK__.backup.nextOutcomes = [{ state: "busy", path: icloud }];
  }, ICLOUD);
  await backup.getByRole("button", { name: "Back up now" }).click();
  await expect(
    backup.getByText(
      "iCloud Drive: skipped, because the novel's history was being written. Press Back up now again in a moment.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Something went wrong.")).toHaveCount(0);
});

test("a backup that kept every older archive because of the clock says so", async ({ page }) => {
  await withProject(page);
  const backup = await openBackup(page);
  await backup.getByRole("button", { name: "Use this" }).first().click();
  await page.evaluate(
    ({ icloud, archive }) => {
      window.__VERSORIUM_MOCK__.backup.nextOutcomes = [
        { state: "ok", path: icloud, archive, pruned: 0, held: { kind: "clockBehind", stamp: 1_790_640_000 } },
      ];
    },
    { icloud: ICLOUD, archive: archiveAt(ICLOUD) },
  );
  await backup.getByRole("button", { name: "Back up now" }).click();
  // It does not assume this computer is the one that is wrong, and it says
  // how to end the wait.
  await expect(
    backup.getByText(
      /^iCloud Drive: saved, .+ A backup here is dated .+, later than this computer's clock, so no backups were deleted\. Check the date and time on this computer and on any other that backs up here, or remove that file yourself\.$/,
    ),
  ).toBeVisible();
});

test("Back up now stays off while Rust is backing up, even after Settings was left and reopened", async ({
  page,
}) => {
  await withProject(page);
  const backup = await openBackup(page);
  await backup.getByRole("button", { name: "Use this" }).first().click();

  const now = backup.getByRole("button", { name: "Back up now" });
  const state = backup.getByRole("status");
  await expect(now).toBeEnabled();
  await expect(state).toHaveText("");

  // A run that this panel did not start, or started before it was closed.
  await page.evaluate(() =>
    window.__VERSORIUM_MOCK__.setBackupRunning({ project: "/mock/Documents/Versorium/el-largo-invierno", startedAt: 1 }),
  );
  await expect(now).toBeDisabled();
  await expect(state).toHaveText("Backing up…");

  // Another group and back: a new panel, which knows only what Rust tells it.
  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByRole("button", { name: "Editor" }).click();
  const listening = () => page.evaluate((event) => window.__VERSORIUM_MOCK__.listening(event), STATE_EVENT);
  // The panel that closed stopped listening.
  await expect.poll(listening).toBe(0);
  await settings.getByRole("button", { name: "History & backup" }).click();
  await expect(now).toBeDisabled();
  await expect(state).toHaveText("Backing up…");
  await expect.poll(listening).toBe(1);

  // That run ends. This panel never saw its outcome, so it says the run has
  // ended and reads the list again, which now holds what the run made.
  const listed = () =>
    page.evaluate(() => window.__VERSORIUM_MOCK__.calls.filter((c) => c.cmd === "backup_list").length);
  const before = await listed();
  await page.evaluate(() => window.__VERSORIUM_MOCK__.setBackupRunning(null));
  await expect(now).toBeEnabled();
  await expect(state).toHaveText("The backup has finished; the list below is up to date.");
  await expect.poll(listed).toBeGreaterThan(before);
});

test("a run that ends while the panel is starting to listen is not missed", async ({ page }) => {
  // The panel asks Rust first and listens second. A run that ends in between
  // sends its event to nobody; only asking again once listening hears of it.
  await withProject(page);
  const backup = await openBackup(page);
  await backup.getByRole("button", { name: "Use this" }).first().click();
  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByRole("button", { name: "Editor" }).click();
  await page.evaluate(() => {
    window.__VERSORIUM_MOCK__.setBackupRunning({ project: "/mock/Documents/Versorium/el-largo-invierno", startedAt: 1 });
    window.__VERSORIUM_MOCK__.backup.endOnNextListen = true;
  });
  await settings.getByRole("button", { name: "History & backup" }).click();
  await expect(backup.getByRole("button", { name: "Back up now" })).toBeEnabled();
  await expect(backup.getByRole("status")).toHaveText("The backup has finished; the list below is up to date.");
});

test("Back up now says it is backing up from the moment it is pressed", async ({ page }) => {
  // Held before it starts, as a press queued behind another run is: Rust has
  // not said "running" yet, and the panel's own press is all there is.
  await withProject(page);
  const backup = await openBackup(page);
  await backup.getByRole("button", { name: "Use this" }).first().click();
  await page.evaluate(() => window.__VERSORIUM_MOCK__.holdBackup());

  const now = backup.getByRole("button", { name: "Back up now" });
  await now.click();
  await expect(backup.getByRole("status")).toHaveText("Backing up…");
  await expect(now).toBeDisabled();

  await page.evaluate(() => window.__VERSORIUM_MOCK__.releaseBackup());
  await expect(backup.getByText(/^iCloud Drive: saved, /)).toBeVisible();
  await expect(backup.getByRole("status")).toHaveText("");
  await expect(now).toBeEnabled();
});

test("a press overtaken by another run waits for it, and says so until its own ends", async ({ page }) => {
  await withProject(page);
  const backup = await openBackup(page);
  await backup.getByRole("button", { name: "Use this" }).first().click();
  const status = backup.getByRole("status");
  const saved = backup.getByText(/^iCloud Drive: saved, /);

  await page.evaluate(() => window.__VERSORIUM_MOCK__.holdBackup());
  await backup.getByRole("button", { name: "Back up now" }).click();
  // Another run starts first; this press now waits in the queue behind it.
  await page.evaluate(() =>
    window.__VERSORIUM_MOCK__.setBackupRunning({ project: "/mock/Documents/Versorium/el-largo-invierno", startedAt: 1 }),
  );
  await page.evaluate(() => window.__VERSORIUM_MOCK__.releaseBackup());
  await page.waitForTimeout(300);
  await expect(saved).toHaveCount(0);
  await expect(status).toHaveText("Backing up…");

  await page.evaluate(() => window.__VERSORIUM_MOCK__.setBackupRunning(null));
  await expect(saved).toBeVisible();
  // Its own run, not one it never saw: no "has finished" line.
  await expect(status).toHaveText("");
});

test("another novel's backup is named beside the button it keeps off", async ({ page }) => {
  // Two novels on disk; the one written last, Novela 2, is opened.
  await page.goto("/?mock=tauri&seed=2");
  await expect(page.getByText("Last written in Novela 2.")).toBeVisible();
  await page.getByRole("button", { name: /^Continue “/ }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
  const backup = await openBackup(page);
  await backup.getByRole("button", { name: "Use this" }).first().click();

  await page.evaluate(() => {
    const other = [...window.__VERSORIUM_MOCK__.projects.keys()].find((path) => path.endsWith("/novela-1"));
    window.__VERSORIUM_MOCK__.setBackupRunning({ project: String(other), startedAt: 1 });
  });
  await expect(backup.getByRole("status")).toHaveText("Backing up “Novela 1”…");
  await expect(backup.getByRole("button", { name: "Back up now" })).toBeDisabled();
});

test("Back up now saves what is on the page before it backs up", async ({ page }) => {
  await page.clock.install();
  await withProject(page);
  const backup = await openBackup(page);
  await backup.getByRole("button", { name: "Use this" }).first().click();
  await page.getByRole("button", { name: "← Back to the manuscript" }).click();

  // Time stops, so the editor's 800 ms save cannot run: whatever is on disk
  // when the backup starts is there because the press put it there.
  const pageNow = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(pageNow + 1000);
  await page.locator(".cm-content").click();
  await page.keyboard.type("Lo último que escribí.");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("region", { name: "Settings" }).getByRole("button", { name: "History & backup" }).click();
  await backup.getByRole("button", { name: "Back up now" }).click();
  await expect(backup.getByText(/^iCloud Drive: saved, /)).toBeVisible();

  const order = await page.evaluate(() =>
    window.__VERSORIUM_MOCK__.calls
      .filter(
        (c) =>
          c.cmd === "backup_now" ||
          (c.cmd === "save_chapter" && String(c.args.body ?? "").includes("Lo último que escribí.")),
      )
      .map((c) => c.cmd),
  );
  expect(order).toEqual(["save_chapter", "backup_now"]);
});
