import { expect, test, type Locator, type Page } from "@playwright/test";

// The notices (src/lib/notices/): one stack above the status bar for what the
// app says in passing. Hints and confirmations go by themselves and wait while
// they are read; errors stay until closed or cleared; what belongs to a place
// stays in it. The store's timing is tests/unit/notices.test.ts; these drive
// the callers that were routed to it, on the mocked IPC, with failures
// injected through __VERSORIUM_MOCK__.failures.

/** A novel on disk, opened on its first chapter. */
async function openSeeded(page: Page): Promise<void> {
  await page.goto("/?mock=tauri&seed=1");
  await page.getByRole("button", { name: /^Continue/ }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
}

async function typeInManuscript(page: Page, text: string): Promise<void> {
  await page.locator(".cm-content").click();
  await page.keyboard.type(text);
}

const region = (page: Page, name = "Notifications") => page.getByRole("region", { name });
const notice = (page: Page, text: string | RegExp) => region(page).getByRole("listitem").filter({ hasText: text });
const dismiss = (item: Locator, name = "Close") => item.getByRole("button", { name });
const polite = (page: Page) => page.locator('[data-notices="polite"]');
const assertive = (page: Page) => page.locator('[data-notices="assertive"]');
const statusBar = (page: Page) => page.getByRole("contentinfo");
const rewrite = (page: Page) => page.getByRole("banner").getByRole("button", { name: "Rewrite" });
const focusButton = (page: Page) => statusBar(page).getByRole("button", { name: "Focus", exact: true });

/** Every call to `command` from here on fails with `code`, as a Rust rejection does. */
function failing(page: Page, command: string, code: string): Promise<unknown> {
  return page.evaluate(([c, k]) => (window.__VERSORIUM_MOCK__.failures[c] = k), [command, code]);
}

function healed(page: Page, command: string): Promise<unknown> {
  return page.evaluate((c) => delete window.__VERSORIUM_MOCK__.failures[c], command);
}

function calls(page: Page, command: string): Promise<number> {
  return page.evaluate((c) => window.__VERSORIUM_MOCK__.calls.filter((call) => call.cmd === c).length, command);
}

/** What the mock has on disk for the open novel's first chapter: a save that went through. */
function onDisk(page: Page): Promise<string> {
  return page.evaluate(() => [...window.__VERSORIUM_MOCK__.projects.values()][0].chapters[0].body);
}

function caretInManuscript(page: Page): Promise<boolean> {
  return page.evaluate(() => !!document.activeElement?.closest(".cm-content"));
}

test("a hint goes by itself after five seconds, and waits while the pointer is on it", async ({ page }) => {
  await page.clock.install();
  await openSeeded(page);
  await typeInManuscript(page, "Hola.");

  await rewrite(page).click();
  const hint = notice(page, "Select a passage first.");
  await expect(hint).toBeVisible();
  // A hint, said politely: not the alert it used to be.
  await expect(polite(page)).toHaveText("Select a passage first.");
  await expect(assertive(page)).toHaveText("");
  await page.clock.fastForward(5100);
  await expect(hint).toHaveCount(0);
  // No empty landmark left behind.
  await expect(region(page)).toHaveCount(0);

  await rewrite(page).click();
  await expect(hint).toBeVisible();
  await hint.hover();
  await page.clock.fastForward(10_000);
  await expect(hint, "read for ten seconds, still there").toBeVisible();
  await page.mouse.move(500, 300);
  await page.clock.fastForward(5100);
  await expect(hint).toHaveCount(0);
});

test("a hint closed with the pointer on it still goes by itself the next time", async ({ page }) => {
  await page.clock.install();
  await openSeeded(page);
  await typeInManuscript(page, "Hola.");
  await rewrite(page).click();
  const hint = notice(page, "Select a passage first.");
  await hint.hover();
  await dismiss(hint).click();
  await expect(hint).toHaveCount(0);

  // The pointer never left the notice it closed, so its hold has to go with it.
  await rewrite(page).click();
  await expect(hint).toBeVisible();
  await page.clock.fastForward(5100);
  await expect(hint).toHaveCount(0);
});

test("from the keyboard: Tab reaches a notice after the page, holds it, and Escape closes only it", async ({
  page,
  browserName,
}) => {
  // WebKit's Tab skips buttons unless macOS keyboard navigation is on;
  // Option+Tab is how a default Mac reaches them.
  const tab = browserName === "webkit" ? "Alt+Tab" : "Tab";
  await page.clock.install();
  await openSeeded(page);
  await typeInManuscript(page, "Hola.");
  await focusButton(page).click();
  await expect(focusButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => caretInManuscript(page)).toBe(true);

  await page.keyboard.press("Control+Shift+R");
  const hint = notice(page, "Select a passage first.");
  await expect(hint).toBeVisible();
  expect(await caretInManuscript(page), "a notice never takes focus").toBe(true);

  await page.keyboard.press(tab);
  await expect(dismiss(hint)).toBeFocused();
  await page.clock.fastForward(10_000);
  await expect(hint, "focus on it keeps it").toBeVisible();

  await page.keyboard.press("Escape");
  await expect(hint).toHaveCount(0);
  await expect(focusButton(page), "the Escape was the notice's: Focus stays on").toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => caretInManuscript(page), "and focus goes back where it came from").toBe(true);
});

test("Restore pressed twice with nothing to restore says it once, as a hint that goes", async ({ page }) => {
  await page.clock.install();
  await openSeeded(page);
  await page.locator(".cm-content").click();
  const restore = statusBar(page).getByRole("button", { name: "↩ Restore" });
  await restore.click();
  await restore.click();
  const hint = notice(page, "Nothing to roll back here.");
  await expect(hint).toBeVisible();
  await expect(region(page).getByRole("listitem")).toHaveCount(1);
  await expect(polite(page)).toHaveText("Nothing to roll back here.");
  await expect(assertive(page), "a hint, not an alert").toHaveText("");
  await page.clock.fastForward(5100);
  await expect(hint).toHaveCount(0);
});

test("a snapshot that fails stays until the writer closes it, once however often it is pressed", async ({ page }) => {
  await page.clock.install();
  await openSeeded(page);
  await typeInManuscript(page, "Hola.");
  await failing(page, "git_commit", "repo_busy");
  const snapshot = statusBar(page).getByRole("button", { name: "Save snapshot" });

  await snapshot.click();
  const words = "A backup is reading the novel's history. Try again in a moment.";
  const error = notice(page, words);
  await expect(error).toBeVisible();
  await expect(assertive(page)).toHaveText(words);
  await snapshot.click();
  await expect.poll(() => calls(page, "git_commit")).toBe(2);
  await expect(region(page).getByRole("listitem")).toHaveCount(1);

  await page.clock.fastForward(120_000);
  await expect(error, "two minutes later").toBeVisible();

  // A snapshot that goes through takes the failure's place.
  await healed(page, "git_commit");
  await typeInManuscript(page, " Y más.");
  await snapshot.click();
  await expect.poll(() => calls(page, "git_commit")).toBe(3);
  await expect(error).toHaveCount(0);

  // Or the writer closes it.
  await failing(page, "git_commit", "repo_busy");
  await snapshot.click();
  await expect(error).toBeVisible();
  await dismiss(error).click();
  await expect(error).toHaveCount(0);
  await expect(assertive(page), "nothing stale left for a screen reader").toHaveText("");
});

test("a snapshot with nothing new is an answer that goes, not an error that stays", async ({ page }) => {
  await page.clock.install();
  await openSeeded(page);
  await typeInManuscript(page, "Hola.");
  const snapshot = statusBar(page).getByRole("button", { name: "Save snapshot" });
  await snapshot.click();
  await expect.poll(() => calls(page, "git_commit")).toBe(1);
  await expect(region(page)).toHaveCount(0);

  await snapshot.click();
  const nothing = notice(page, "Nothing has changed since the last snapshot.");
  await expect(nothing).toBeVisible();
  await expect(polite(page)).toHaveText("Nothing has changed since the last snapshot.");
  await page.clock.fastForward(5100);
  await expect(nothing).toHaveCount(0);
});

test("the minute's snapshot that keeps failing is one notice, gone with the first minute that works", async ({ page }) => {
  await page.clock.install();
  await openSeeded(page);
  await typeInManuscript(page, "Hola.");
  await failing(page, "git_auto_checkpoint", "io");

  await page.clock.fastForward(60_000);
  const error = notice(page, "File system error.");
  await expect(error).toBeVisible();
  await page.clock.fastForward(60_000);
  await expect.poll(() => calls(page, "git_auto_checkpoint")).toBe(2);
  await expect(region(page).getByRole("listitem")).toHaveCount(1);

  await healed(page, "git_auto_checkpoint");
  await page.clock.fastForward(60_000);
  await expect.poll(() => calls(page, "git_auto_checkpoint")).toBe(3);
  await expect(error).toHaveCount(0);
});

test("a chapter that cannot be saved says so until a save goes through", async ({ page }) => {
  await openSeeded(page);
  await failing(page, "save_chapter", "io");
  await typeInManuscript(page, "Hola.");
  const error = notice(page, "File system error.");
  await expect(error).toBeVisible();
  await expect(statusBar(page).getByText("Unsaved changes")).toBeVisible();

  await healed(page, "save_chapter");
  await page.keyboard.type(" Otra vez.");
  await expect.poll(() => onDisk(page)).toContain("Otra vez.");
  await expect(error).toHaveCount(0);
  await expect(statusBar(page).getByText("Saved", { exact: true })).toBeVisible();
});

test("a change log that cannot be written says so until it is written again", async ({ page }) => {
  await page.clock.install();
  await openSeeded(page);
  await failing(page, "ops_append", "not_found");
  await typeInManuscript(page, "Hola.");
  await page.clock.fastForward(600);
  const error = notice(page, "Not found.");
  await expect(error).toBeVisible();
  // It retries every 1.5 s, and stays one notice.
  await page.clock.fastForward(3100);
  await expect(region(page).getByRole("listitem")).toHaveCount(1);

  await healed(page, "ops_append");
  await page.clock.fastForward(1600);
  await expect(error).toHaveCount(0);
});

test("one failure that stops the save and the change log at once is one notice", async ({ page }) => {
  await page.clock.install();
  await openSeeded(page);
  for (const command of ["save_chapter", "ops_append"]) await failing(page, command, "io");
  await typeInManuscript(page, "Hola.");
  await page.clock.fastForward(1000);
  await expect.poll(() => calls(page, "ops_append")).toBeGreaterThan(0);
  await expect.poll(() => calls(page, "save_chapter")).toBeGreaterThan(0);
  await expect(notice(page, "File system error.")).toBeVisible();
  await expect(region(page).getByRole("listitem"), "two failures, one sentence, one notice").toHaveCount(1);
});

test("Settings' confirmations are notices that go; a backup's outcomes stay in their section", async ({ page }) => {
  await page.clock.install();
  await openSeeded(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });

  await settings.getByRole("button", { name: "Author" }).click();
  const author = settings.getByRole("region", { name: "Author" });
  await author.getByLabel("Name").fill("Ana Ruiz");
  await author.getByLabel("Name").blur();
  // Named: a bare "Saved." sat over the status bar's "Saved", about the chapter.
  const saved = notice(page, "Author profile saved.");
  await expect(saved).toBeVisible();
  await expect(author.getByText("Author profile saved.")).toHaveCount(0);
  await page.clock.fastForward(5100);
  await expect(saved, "it used to stay for as long as the page was open").toHaveCount(0);

  await settings.getByRole("button", { name: "History & backup" }).click();
  const backup = settings.getByRole("region", { name: "Backup" });
  await backup.getByRole("button", { name: "Use this" }).first().click();
  // "Here" pointed at nothing once the words were in the corner.
  await expect(notice(page, "iCloud Drive: backups will go there too.")).toBeVisible();

  await backup.getByRole("button", { name: "Back up now" }).click();
  await expect(backup.getByText(/^iCloud Drive: saved, /)).toBeVisible();
  await expect(region(page).getByText(/^iCloud Drive: saved, /), "an outcome stays where its destination is").toHaveCount(0);

  await backup.getByRole("button", { name: "Turn backups off" }).click();
  await expect(notice(page, "Backups are off.")).toBeVisible();
  await expect(backup.getByText("Backups are off.")).toHaveCount(0);
});

test("the updates token: connected is a notice, a refusal stays beside the field as an error", async ({ page }) => {
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByRole("button", { name: "Application" }).click();
  const slot = settings.getByRole("region", { name: "Updates token (optional)" });

  await failing(page, "secrets_connect", "bad_token");
  await slot.getByPlaceholder("GitHub token").fill("ghp_not_this_one");
  await slot.getByRole("button", { name: "Connect" }).click();
  // It used to be drawn in the accent, in a polite region: a refusal that
  // read as a success.
  await expect(slot.getByRole("alert")).toHaveText("GitHub rejected this token.");
  await expect(region(page)).toHaveCount(0);

  await healed(page, "secrets_connect");
  await slot.getByRole("button", { name: "Connect" }).click();
  // Which token: the novel's GitHub backup connects the same account.
  await expect(notice(page, "Updates token connected as @versorium-writer.")).toBeVisible();
  await expect(slot.getByText(/connected as/)).toHaveCount(0);
  await expect(slot.getByRole("alert")).toHaveCount(0);
});

test("a setting that cannot be written stays on screen until a write goes through", async ({ page }) => {
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByRole("button", { name: "Local AI" }).click();
  const censorship = settings.getByRole("checkbox", { name: "Censorship" });

  await failing(page, "set_settings", "io");
  await censorship.check();
  const error = notice(page, "File system error.");
  await expect(error).toBeVisible();

  await healed(page, "set_settings");
  await censorship.uncheck();
  await expect.poll(() => calls(page, "set_settings")).toBeGreaterThan(1);
  await expect(error).toHaveCount(0);
});

test("a binder action that fails the same way twice is one notice that stays", async ({ page }) => {
  await page.clock.install();
  await openSeeded(page);
  await failing(page, "update_chapter", "io");
  for (const title of ["Uno", "Dos"]) {
    await page.getByRole("button", { name: "Actions for chapter Novela 1" }).click();
    await page.getByRole("menuitem", { name: "Rename chapter…" }).click();
    const dialog = page.getByRole("dialog", { name: "Rename chapter" });
    await dialog.getByLabel("Title").fill(title);
    await dialog.getByRole("button", { name: "Rename" }).click();
    await expect(dialog).toBeHidden();
  }
  const error = notice(page, "File system error.");
  await expect(error).toBeVisible();
  await expect(region(page).getByRole("listitem")).toHaveCount(1);
  await page.clock.fastForward(60_000);
  await expect(error).toBeVisible();

  // The same action working takes it away.
  await healed(page, "update_chapter");
  await page.getByRole("button", { name: "Actions for chapter Novela 1" }).click();
  await page.getByRole("menuitem", { name: "Rename chapter…" }).click();
  const rename = page.getByRole("dialog", { name: "Rename chapter" });
  await rename.getByLabel("Title").fill("Tres");
  await rename.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByRole("button", { name: "Actions for chapter Tres" })).toBeVisible();
  await expect(error).toHaveCount(0);
});

test("a rename that fails is said once its dialog has closed, where a screen reader can hear it", async ({ page }) => {
  await openSeeded(page);
  // Whether a modal dialog was open when the alert got its words: while one
  // is, the page under it is inert, the alert region with it.
  await page.evaluate(() => {
    window.__alerts = [];
    const alert = document.querySelector('[data-notices="assertive"]')!;
    new MutationObserver(() => {
      if (alert.textContent) window.__alerts.push(!!document.querySelector("dialog[open]"));
    }).observe(alert, { childList: true, characterData: true, subtree: true });
  });
  await failing(page, "update_chapter", "io");
  await page.getByRole("button", { name: "Actions for chapter Novela 1" }).click();
  await page.getByRole("menuitem", { name: "Rename chapter…" }).click();
  const dialog = page.getByRole("dialog", { name: "Rename chapter" });
  await dialog.getByLabel("Title").fill("Uno");
  await dialog.getByRole("button", { name: "Rename" }).click();
  await expect(notice(page, "File system error.")).toBeVisible();
  await expect(assertive(page)).toHaveText("File system error.");
  expect(await page.evaluate(() => window.__alerts), "written with no dialog open").toEqual([false]);
});

test("the New chapter dialog shows its own failure, not an older one, and posts nothing", async ({ page }) => {
  await openSeeded(page);
  await failing(page, "update_chapter", "io");
  await page.getByRole("button", { name: "Actions for chapter Novela 1" }).click();
  await page.getByRole("menuitem", { name: "Rename chapter…" }).click();
  const rename = page.getByRole("dialog", { name: "Rename chapter" });
  await rename.getByLabel("Title").fill("Uno");
  await rename.getByRole("button", { name: "Rename" }).click();
  await expect(notice(page, "File system error.")).toBeVisible();

  await page.getByRole("button", { name: "New chapter" }).click();
  const dialog = page.getByRole("dialog", { name: "New chapter" });
  // The rename's failure used to open with it, as if it were this dialog's.
  await expect(dialog.getByRole("alert")).toHaveCount(0);

  await failing(page, "create_chapter", "not_found");
  await dialog.getByLabel("Chapter title").fill("Segundo");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Not found.");
  await expect(region(page).getByText("Not found.")).toHaveCount(0);
});

test("the New project dialog shows its own failure, and posts nothing", async ({ page }) => {
  await page.goto("/?mock=tauri&seed=1");
  await page.getByRole("button", { name: "New novel" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByLabel("Title").fill("Novela 1");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("A project with that name already exists.");
  // Behind the backdrop it would be inert, and never read.
  await expect(region(page)).toHaveCount(0);
});

test("Project settings says why a box did not change under that box, and posts nothing", async ({ page }) => {
  await openSeeded(page);
  await page.getByRole("button", { name: "Actions for the novel Novela 1" }).click();
  await page.getByRole("menuitem", { name: "Project settings…" }).click();
  const dialog = page.getByRole("dialog", { name: "Project" });
  const cover = dialog.getByRole("checkbox", { name: "Open exports with a title page" });
  await expect(cover).toBeChecked();

  await failing(page, "update_project", "io");
  await cover.click();
  await expect(dialog.getByRole("alert")).toHaveText("File system error.");
  await expect(cover, "the box springs back: nothing changed").toBeChecked();
  await expect(cover).toHaveAccessibleDescription(/File system error\./);
  await expect(region(page)).toHaveCount(0);

  await healed(page, "update_project");
  await cover.click();
  await expect(cover).not.toBeChecked();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
});

test("the first-run tour says why a project could not be made, in the writer's words", async ({ page }) => {
  await page.goto("/?mock=tauri&fresh=1&seed=1");
  const tour = page.getByRole("dialog", { name: "Welcome to Versorium" });
  await tour.getByRole("button", { name: "Next" }).click();
  await tour.getByRole("button", { name: "Next" }).click();
  await tour.getByLabel("Title").fill("Novela 1");
  await tour.getByRole("button", { name: "Create it" }).click();
  // The binder's sentence, shown as it is: read again as an error code it
  // became "Something went wrong.".
  await expect(tour.getByRole("alert")).toHaveText("A project with that name already exists.");
  await expect(region(page)).toHaveCount(0);
});

test("GitHub backup: connected, sent and up to date are one notice at a time, and go", async ({ page }) => {
  await page.clock.install();
  await openSeeded(page);
  await page.evaluate(() => {
    for (const project of window.__VERSORIUM_MOCK__.projects.values()) {
      project.remotes.push({ name: "origin", url: "https://github.com/mock-writer/novela-1.git" });
    }
  });
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByRole("button", { name: "History & backup" }).click();
  const backup = settings.getByRole("region", { name: "Backup" });
  await backup.getByRole("button", { name: "GitHub backup (advanced)" }).click();
  await backup.getByPlaceholder("GitHub token").fill("ghp_a_real_looking_token");
  await backup.getByRole("button", { name: "Connect" }).click();
  await expect(notice(page, "GitHub backup connected as @versorium-writer.")).toBeVisible();

  await backup.getByRole("button", { name: "Send to GitHub" }).click();
  await expect(notice(page, "Sent main to GitHub.")).toBeVisible();
  await backup.getByRole("button", { name: "Bring from GitHub" }).click();
  await expect(notice(page, "Already up to date with GitHub.")).toBeVisible();
  // One answer from GitHub at a time: the newest replaced the others.
  await expect(region(page).getByRole("listitem")).toHaveCount(1);
  await expect(backup.getByText("Already up to date with GitHub.")).toHaveCount(0);
  await page.clock.fastForward(5100);
  await expect(region(page)).toHaveCount(0);
});

test("a quit the last save stopped says so, and stays", async ({ page }) => {
  await page.clock.install();
  await openSeeded(page);
  await failing(page, "save_chapter", "io");
  await typeInManuscript(page, "Lo último.");
  await page.evaluate(() => window.__VERSORIUM_MOCK__.emit("versorium://quit-requested", null));

  const error = notice(page, "Versorium did not quit: the chapter could not be saved. File system error.");
  await expect(error).toBeVisible();
  const answers = await page.evaluate(() =>
    window.__VERSORIUM_MOCK__.calls.filter((c) => c.cmd === "quit_ready").map((c) => c.args.saved),
  );
  expect(answers).toEqual([false]);
  await page.clock.fastForward(60_000);
  await expect(error).toBeVisible();
});

test("a window close the last save stopped says so, and still says so after the save recovers", async ({ page }) => {
  await openSeeded(page);
  await failing(page, "save_chapter", "io");
  await typeInManuscript(page, "Lo último.");
  // The save's own notice: these words and nothing else.
  const saveError = region(page).getByText("File system error.", { exact: true });
  await expect(saveError).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__VERSORIUM_MOCK__.listening("tauri://close-requested"))).toBe(1);
  await page.evaluate(() => window.__VERSORIUM_MOCK__.emit("tauri://close-requested", null));

  // Closing the one window is quitting, and it says why it did not: a bare
  // "File system error." outlived the save's and said nothing of a window.
  const words = "Versorium did not quit: the chapter could not be saved. File system error.";
  const closeError = notice(page, words);
  await expect(closeError).toBeVisible();
  await expect(assertive(page)).toHaveText(words);

  // The save works again and clears its own notice; the close has not
  // happened, and its notice, which says so, stays.
  await healed(page, "save_chapter");
  await page.keyboard.type(" Más.");
  await expect.poll(() => onDisk(page)).toContain("Más.");
  await expect(saveError).toHaveCount(0);
  await expect(closeError).toBeVisible();
  expect(await calls(page, "plugin:window|destroy")).toBe(0);
});

test("an author field that could not be saved stays, and the next save that works takes its place", async ({ page }) => {
  await page.clock.install();
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByRole("button", { name: "Author" }).click();
  const author = settings.getByRole("region", { name: "Author" });

  await failing(page, "set_settings", "io");
  await author.getByLabel("Name").fill("Ana Ruiz");
  await author.getByLabel("Name").blur();
  const error = notice(page, "File system error.");
  await expect(error).toBeVisible();
  await page.clock.fastForward(60_000);
  await expect(error).toBeVisible();

  await healed(page, "set_settings");
  await author.getByLabel("Publisher or company").fill("Minotauro");
  await author.getByLabel("Publisher or company").blur();
  await expect(notice(page, "Author profile saved.")).toBeVisible();
  await expect(error, "one notice per field group: the save that worked replaced it").toHaveCount(0);
  await expect(region(page).getByRole("listitem")).toHaveCount(1);
});

test("an author save that fails right after one that worked stays past the confirmation's five seconds", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByRole("button", { name: "Author" }).click();
  const author = settings.getByRole("region", { name: "Author" });

  await author.getByLabel("Name").fill("Ana Ruiz");
  await author.getByLabel("Name").blur();
  await expect(notice(page, "Author profile saved.")).toBeVisible();
  await page.clock.fastForward(2000);

  await failing(page, "set_settings", "io");
  await author.getByLabel("Publisher or company").fill("Minotauro");
  await author.getByLabel("Publisher or company").blur();
  const error = notice(page, "File system error.");
  await expect(error).toBeVisible();
  // The confirmation it replaced had three seconds left; an error has no clock.
  await page.clock.fastForward(60_000);
  await expect(error).toBeVisible();
});

test("unticking one of two destinations says nothing, rather than an empty notice", async ({ page }) => {
  await page.clock.install();
  await openSeeded(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByRole("button", { name: "History & backup" }).click();
  const backup = settings.getByRole("region", { name: "Backup" });
  const icloud = backup.locator(".v-card").filter({ hasText: "iCloud Drive" });
  const disk = backup.locator(".v-card").filter({ hasText: "Another disk" });
  await icloud.getByRole("button", { name: "Use this" }).click();
  await disk.getByRole("button", { name: "Use this" }).click();
  await expect(notice(page, "Another disk: backups will go there too.")).toBeVisible();
  await page.clock.fastForward(5100);
  await expect(region(page)).toHaveCount(0);

  await disk.getByRole("button", { name: "Stop using" }).click();
  await expect.poll(() => calls(page, "backup_configure")).toBe(3);
  // The panel is free again only once the save has said whatever it says.
  await expect(icloud.getByRole("button", { name: "Stop using" })).toBeEnabled();
  await expect(disk.getByRole("button", { name: "Use this" })).toBeEnabled();
  await expect(region(page), "nothing to say, so nothing said: no empty box").toHaveCount(0);
});

test("a backup press whose save failed says so beside the button, not in the stack", async ({ page }) => {
  await openSeeded(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByRole("button", { name: "History & backup" }).click();
  const backup = settings.getByRole("region", { name: "Backup" });
  await backup.getByRole("button", { name: "Use this" }).first().click();
  await settings.getByRole("button", { name: "← Back to the manuscript" }).click();

  await failing(page, "save_chapter", "io");
  await typeInManuscript(page, "Lo último.");
  await expect(notice(page, "File system error.")).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await settings.getByRole("button", { name: "History & backup" }).click();
  await backup.getByRole("button", { name: "Back up now" }).click();

  const why = /^Not backed up: the chapter could not be saved first\./;
  await expect(backup.getByRole("alert")).toHaveText(why);
  await expect(region(page).getByText(why)).toHaveCount(0);
});

test("a notice never sits on the line being written", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await openSeeded(page);
  await page.locator(".cm-content").click();
  for (let i = 1; i <= 24; i += 1) await page.keyboard.type(`Línea ${i} de un capítulo largo.\n`);
  await page.keyboard.type("La última, la que se está escribiendo");
  const scroller = page.locator(".cm-scroller");
  // The editor's own scroll to the caret, and the save, have landed.
  await page.waitForTimeout(1000);
  const before = await scroller.evaluate((el) => el.scrollTop);

  // Three at once: two errors and a hint, taller than the page's 120px foot.
  await failing(page, "ops_append", "not_found");
  await failing(page, "save_chapter", "io");
  await page.keyboard.type(".");
  await expect(notice(page, "Not found.")).toBeVisible();
  await expect(notice(page, "File system error.")).toBeVisible();
  await page.keyboard.press("Control+Shift+R");
  await expect(region(page).getByRole("listitem")).toHaveCount(3);

  const clear = () =>
    page.evaluate(() => {
      const line = document.querySelector(".cm-activeLine")!.getBoundingClientRect();
      const stack = document.querySelector(".v-notes-list")!.getBoundingClientRect();
      const across = stack.left < line.right && stack.right > line.left;
      return { across, gap: Math.round(stack.top - line.bottom) };
    });
  // With air to spare (CLEARANCE in cover.ts), not flush: flush failed on
  // Linux CI, whose fonts rounded the line a pixel taller.
  await expect.poll(async () => (await clear()).gap, "the caret's line ends above the stack").toBeGreaterThanOrEqual(4);
  expect((await clear()).across, "control: the stack is over the text column").toBe(true);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);

  // Typing on keeps it there.
  await page.keyboard.type(" Y sigue.");
  expect((await clear()).gap).toBeGreaterThanOrEqual(0);

  // The failures heal and clear themselves, and the hint goes by itself. The
  // page's foot stays as tall as it grew: shrunk, it would drop the page under
  // a writer at the end of the chapter.
  await healed(page, "ops_append");
  await healed(page, "save_chapter");
  await page.mouse.move(10, 10);
  await page.keyboard.type(".");
  const foot = () => page.locator(".cm-content").evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
  const grown = await foot();
  const at = await scroller.evaluate((el) => el.scrollTop);
  expect(grown, "control: the foot grew past its 120px").toBeGreaterThan(120);
  await expect(region(page)).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(300);
  expect(await foot()).toBe(grown);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThanOrEqual(at);
});

test("a notice that lands where the writer is not looking moves nothing", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await openSeeded(page);
  await page.locator(".cm-content").click();
  for (let i = 1; i <= 30; i += 1) await page.keyboard.type(`Línea ${i}.\n`);
  const scroller = page.locator(".cm-scroller");
  // The editor's own scroll to the last keystroke lands a frame or two later,
  // and the save after 800 ms: both done before the page is moved away.
  await page.waitForTimeout(1000);
  await scroller.evaluate((el) => (el.scrollTop = 0));
  await page.waitForTimeout(300);
  expect(await scroller.evaluate((el) => el.scrollTop), "control: nothing else moves it").toBe(0);

  await page.keyboard.press("Control+Shift+R");
  await expect(notice(page, "Select a passage first.")).toBeVisible();
  await page.waitForTimeout(300);
  expect(await scroller.evaluate((el) => el.scrollTop), "the caret is off screen: the page stays put").toBe(0);
});

test("in Focus, a hint leaves the caret in the text and the bars asleep; closing it never takes the caret", async ({ page }) => {
  await openSeeded(page);
  await typeInManuscript(page, "Hola.");
  await focusButton(page).click();
  await expect.poll(() => caretInManuscript(page)).toBe(true);

  await page.keyboard.press("Control+Shift+R");
  const hint = notice(page, "Select a passage first.");
  await expect(hint).toBeVisible();
  await expect(page.locator(".v-shell")).not.toHaveAttribute("data-awake", /.*/);
  expect(await caretInManuscript(page)).toBe(true);

  await page.evaluate(() => {
    window.__blurs = 0;
    document.querySelector(".cm-content")!.addEventListener("blur", () => (window.__blurs += 1));
  });
  await dismiss(hint).click();
  await expect(hint).toHaveCount(0);
  expect(await page.evaluate(() => window.__blurs), "the press never moved focus out of the text").toBe(0);
  expect(await caretInManuscript(page)).toBe(true);
  await expect(focusButton(page)).toHaveAttribute("aria-pressed", "true");
});

test("Focus options, opened from the status bar, covers a notice rather than hide under it", async ({ page }) => {
  await openSeeded(page);
  await failing(page, "save_chapter", "io");
  await typeInManuscript(page, "Hola.");
  await page.keyboard.press("Control+Shift+R");
  await expect(region(page).getByRole("listitem")).toHaveCount(2);
  await page.getByRole("button", { name: "Focus options" }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();

  // A point inside both the menu and a notice itself: the list around the
  // notices lets clicks through, so it proves nothing.
  const hit = await page.evaluate(() => {
    const a = document.querySelector(".v-menu-pop")!.getBoundingClientRect();
    for (const note of document.querySelectorAll(".v-note")) {
      const b = note.getBoundingClientRect();
      const left = Math.max(a.left, b.left);
      const right = Math.min(a.right, b.right);
      const top = Math.max(a.top, b.top);
      const bottom = Math.min(a.bottom, b.bottom);
      if (left >= right || top >= bottom) continue;
      const el = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
      return el?.closest(".v-menu-pop") ? "menu" : el?.closest(".v-note") ? "notice" : "other";
    }
    return null;
  });
  expect(hit, "control: the two overlap at all").not.toBeNull();
  expect(hit).toBe("menu");
});

test("with reduced motion a notice appears without moving", async ({ page }) => {
  await openSeeded(page);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Shift+R");
  const hint = notice(page, "Select a passage first.");
  // Control: it does fade in otherwise.
  await expect(hint).toHaveCSS("animation-name", "v-note-in");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.keyboard.press("Control+Shift+R");
  await expect(hint).toHaveCSS("animation-name", "none");
});

test("the stack and its button are translated", async ({ page }) => {
  await openSeeded(page);
  await statusBar(page).getByRole("button", { name: "ES", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Shift+R");
  const hint = region(page, "Notificaciones").getByRole("listitem").filter({ hasText: "Selecciona un pasaje primero." });
  await expect(hint).toBeVisible();
  // "Cerrar", not "Descartar": that is the word for throwing a rewrite away.
  await expect(dismiss(hint, "Cerrar")).toBeVisible();
});

/** WCAG contrast of an element's text against the backgrounds painted under it. */
function contrastOf(locator: Locator): Promise<number> {
  return locator.evaluate((el) => {
    type Rgba = [number, number, number, number];
    const parse = (css: string): Rgba => {
      const rgb = css.match(/^rgba?\(([^)]+)\)$/);
      if (!rgb) throw new Error(`a colour this does not read: ${css}`);
      const [r, g, b, a = 1] = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return [r, g, b, a];
    };
    const over = ([r, g, b, a]: Rgba, under: number[]): number[] => [r, g, b].map((c, i) => c * a + under[i] * (1 - a));
    const chain: Element[] = [];
    for (let node: Element | null = el; node; node = node.parentElement) chain.unshift(node);
    let bg = [255, 255, 255];
    for (const node of chain) bg = over(parse(getComputedStyle(node).backgroundColor), bg);
    const fg = over(parse(getComputedStyle(el).color), bg);
    const luminance = (c: number[]): number => {
      const [r, g, b] = c.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
    return (hi + 0.05) / (lo + 0.05);
  });
}

test("a notice's words and its ✕ hold AA contrast in every theme", async ({ page }) => {
  await openSeeded(page);
  await failing(page, "save_chapter", "io");
  await typeInManuscript(page, "Hola.");
  await page.keyboard.press("Control+Shift+R");
  const error = notice(page, "File system error.");
  const hint = notice(page, "Select a passage first.");
  await expect(error).toBeVisible();
  await expect(hint).toBeVisible();

  for (const theme of ["folio-light", "folio-dark", "quarry-light", "quarry-dark", "needle-light", "needle-dark"]) {
    await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
    for (const item of [error, hint]) {
      expect(await contrastOf(item.locator("p")), `words, ${theme}`).toBeGreaterThanOrEqual(4.5);
      expect(await contrastOf(dismiss(item)), `✕, ${theme}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});
