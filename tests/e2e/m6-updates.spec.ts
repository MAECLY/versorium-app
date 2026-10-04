import { expect, test, type Locator, type Page } from "@playwright/test";

// M6 in the browser, after the spec §11 amendment of 2026-10-03: a check runs
// with or without a token, each answer GitHub can give is its own quiet line in
// the panel, and the Install / Later / Skip dialog appears when there is an
// offer. Runs against the mocked IPC (tests/e2e/mock-tauri.ts), where
// `window.__VERSORIUM_MOCK__.github` is what GitHub answers the next check.

type GitHub = Window["__VERSORIUM_MOCK__"]["github"];

const NEXT = { version: "0.2.0", notes: "Corkboard, focus mode.", date: "2026-10-01" };
const RESET = 1_791_054_785;

async function openUpdates(page: Page) {
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByRole("button", { name: "Application" }).click();
  // Exact: the optional token's own section is "Updates token (optional)".
  return { settings, updates: settings.getByRole("region", { name: "Updates", exact: true }) };
}

/** What GitHub answers from now on. The startup check has already run. */
async function githubWill(page: Page, answer: Partial<GitHub>) {
  await page.evaluate((next) => Object.assign(window.__VERSORIUM_MOCK__.github, next), answer);
}

function checks(page: Page): Promise<GitHub["checks"]> {
  return page.evaluate(() => window.__VERSORIUM_MOCK__.github.checks);
}

/** The reset time as the panel formats it, in the page's own time zone. */
function clock(page: Page, locale: string): Promise<string> {
  return page.evaluate(
    ([at, lang]) => new Date(Number(at) * 1000).toLocaleTimeString(String(lang), { hour: "numeric", minute: "2-digit" }),
    [RESET, locale] as const,
  );
}

/** Saving a token in the optional slot; every check after this carries it. */
async function saveToken(page: Page, settings: Locator) {
  const slot = settings.getByRole("region", { name: "Updates token (optional)" });
  await slot.getByPlaceholder("GitHub token").fill("ghp_updates_token");
  await slot.getByRole("button", { name: "Connect" }).click();
  await expect.poll(() => page.evaluate(() => window.__VERSORIUM_MOCK__.update.tokenSet)).toBe(true);
}

test("without a token a check still happens, and the token is described as optional", async ({ page }) => {
  const { settings, updates } = await openUpdates(page);

  // The startup check ran by itself — automatic updates are on by default —
  // and, with no token saved, carried none.
  await expect.poll(async () => (await checks(page)).length).toBe(1);
  expect((await checks(page))[0].authorized).toBe(false);
  await expect(updates.getByText("This is the newest release.")).toBeVisible();

  // Check now is not gated on a token. Pressing it asks GitHub again,
  // anonymously, and the panel shows the new answer: today's private
  // repository, which an outsider sees as a 404.
  await githubWill(page, { answer: "404" });
  const checkNow = updates.getByRole("button", { name: "Check now" });
  await expect(checkNow).toBeEnabled();
  await checkNow.click();
  await expect(updates.getByText(/^No published version is visible yet/)).toBeVisible();
  await expect.poll(async () => (await checks(page)).length).toBe(2);
  expect((await checks(page)).every((check) => !check.authorized)).toBe(true);

  // No sign-in wording is left anywhere in the group.
  await expect(settings.getByText(/sign in/i)).toHaveCount(0);

  // The token field stays, presented as optional, with its one-line reason.
  const slot = settings.getByRole("region", { name: "Updates token (optional)" });
  await expect(slot.getByRole("heading", { name: "Updates token (optional)" })).toBeVisible();
  await expect(slot.getByPlaceholder("GitHub token")).toBeVisible();
  await expect(
    slot.getByText(
      "Only needed while maecly/versorium-app is private, or to lift GitHub's hourly limit on checks without a token.",
    ),
  ).toBeVisible();
});

test("nothing published yet is a quiet line, not an error", async ({ page }) => {
  const { updates } = await openUpdates(page);
  await githubWill(page, { answer: "404" });
  await updates.getByRole("button", { name: "Check now" }).click();

  await expect(updates.getByText(/either nothing has been released, or the repository is still private/)).toBeVisible();
  // Not a modal, not an alert.
  await expect(updates.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the anonymous rate limit says a token lifts it, and when it resets", async ({ page }) => {
  const { updates } = await openUpdates(page);
  await githubWill(page, { answer: "rate_limited", resetsAt: RESET });
  await updates.getByRole("button", { name: "Check now" }).click();

  await expect(updates.getByText(/GitHub's limit on update checks without a token has been reached/)).toBeVisible();
  await expect(updates.getByText(/An updates token, saved in Settings → Application, lifts it\./)).toBeVisible();
  await expect(updates.getByText(`It resets at ${await clock(page, "en")}.`, { exact: false })).toBeVisible();
  await expect(updates.getByRole("alert")).toHaveCount(0);
});

test("a saved token is still sent, and a refused one is named", async ({ page }) => {
  const { settings, updates } = await openUpdates(page);
  await saveToken(page, settings);

  await updates.getByRole("button", { name: "Check now" }).click();
  await expect.poll(async () => (await checks(page)).at(-1)?.authorized).toBe(true);
  await expect(updates.getByText("This is the newest release.")).toBeVisible();

  await githubWill(page, { answer: "401" });
  await updates.getByRole("button", { name: "Check now" }).click();
  await expect(
    updates.getByText("GitHub refused the updates token: it is wrong or has been revoked.", { exact: false }),
  ).toBeVisible();

  // With a token the limit is the token's, so the advice to add one is gone.
  await githubWill(page, { answer: "rate_limited", resetsAt: null });
  await updates.getByRole("button", { name: "Check now" }).click();
  await expect(updates.getByText("GitHub's rate limit for this updates token has been reached.")).toBeVisible();
  await expect(updates.getByText(/lifts it/)).toHaveCount(0);
});

test("the panel says what it sends and how it behaves offline", async ({ page }) => {
  const { updates } = await openUpdates(page);
  await expect(updates.getByText(/Nothing about your manuscript is sent/)).toBeVisible();
  // The signing reality, stated plainly rather than hidden.
  await expect(updates.getByText(/not yet notarized by Apple or Microsoft/)).toBeVisible();
  // The offline line belongs to a failed check, so it is absent until one fails.
  await expect(updates.getByText(/no pop-up, no retry loop/)).toBeHidden();

  await githubWill(page, { answer: "offline" });
  await updates.getByRole("button", { name: "Check now" }).click();
  await expect(
    updates.getByText("GitHub could not be reached, or did not answer as expected, so nothing was checked."),
  ).toBeVisible();
  await expect(updates.getByText(/no pop-up, no retry loop/)).toBeVisible();
  // Spec §11.7, "Offline: no molestar": quiet, not an alert.
  await expect(updates.getByRole("alert")).toHaveCount(0);
});

test("the channel is a real choice and beta is marked opt-in", async ({ page }) => {
  const { updates } = await openUpdates(page);
  const channel = updates.getByLabel("Channel");
  await expect(channel).toHaveValue("stable");
  await expect(updates.getByText("Beta is opt-in and ships unfinished work.")).toBeVisible();

  await channel.selectOption("beta");
  await expect.poll(async () => page.evaluate(() => window.__VERSORIUM_MOCK__.update.channel)).toBe("beta");
  // What the stable check found says nothing about beta.
  await expect(updates.getByText("Not checked yet.")).toBeVisible();
});

test("automatic checking is on by default and can be turned off", async ({ page }) => {
  const { updates } = await openUpdates(page);
  const automatic = updates.getByRole("checkbox", { name: "Automatic updates" });
  await expect(automatic).toBeChecked();

  await automatic.uncheck();
  await expect.poll(async () => page.evaluate(() => window.__VERSORIUM_MOCK__.update.automatic)).toBe(false);
});

test("a check offers the new version, no token needed", async ({ page }) => {
  const { updates } = await openUpdates(page);
  await githubWill(page, { release: NEXT });

  await updates.getByRole("button", { name: "Check now" }).click();
  await expect(updates.getByText("Version 0.2.0 is available.")).toBeVisible();
  expect((await checks(page)).at(-1)?.authorized).toBe(false);
});

test("the dialog offers install, later and skip, and promises verification", async ({ page }) => {
  const { updates } = await openUpdates(page);
  await githubWill(page, { release: NEXT });
  await updates.getByRole("button", { name: "Check now" }).click();
  await expect(updates.getByText("Version 0.2.0 is available.")).toBeVisible();

  // The offer appears as soon as the check finds one — no need to close Settings.
  const dialog = page.getByRole("dialog", { name: "A new version of Versorium" });
  await expect(dialog).toBeVisible();

  await expect(dialog.getByText("Version 0.2.0 is ready")).toBeVisible();
  await expect(dialog.getByText("Corkboard, focus mode.")).toBeVisible();
  await expect(dialog.getByText(/checks the signature and the checksum before replacing anything/)).toBeVisible();
  for (const action of ["Download & Install", "Later", "Skip this version"]) {
    await expect(dialog.getByRole("button", { name: action })).toBeVisible();
  }

  // Skipping takes the version off the offer for good — a later check that
  // finds the same release does not bring it back.
  await dialog.getByRole("button", { name: "Skip this version" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => page.evaluate(() => window.__VERSORIUM_MOCK__.update.available)).toBe(null);
  await updates.getByRole("button", { name: "Check now" }).click();
  await expect(updates.getByText("This is the newest release.")).toBeVisible();
});

test("the Updates panel is translated, its states included", async ({ page }) => {
  await page.goto("/?mock=tauri");
  await page.getByRole("contentinfo").getByRole("button", { name: "ES", exact: true }).click();
  await page.getByRole("button", { name: "Ajustes" }).click();
  const settings = page.getByRole("region", { name: "Ajustes" });
  await settings.getByRole("button", { name: "Aplicación" }).click();
  const updates = settings.getByRole("region", { name: "Actualizaciones", exact: true });
  await expect(updates.getByRole("button", { name: "Buscar ahora" })).toBeVisible();
  await expect(settings.getByRole("region", { name: "Token de actualizaciones (opcional)" })).toBeVisible();

  // A state with a time in it, read entirely in Spanish.
  await githubWill(page, { answer: "rate_limited", resetsAt: RESET });
  await updates.getByRole("button", { name: "Buscar ahora" }).click();
  await expect(updates.getByText(/Se alcanzó el límite de GitHub para buscar actualizaciones sin token/)).toBeVisible();
  // No article before the time: "a las" would be wrong at one o'clock.
  await expect(updates.getByText(`Se restablece: ${await clock(page, "es")}.`, { exact: false })).toBeVisible();
  await expect(updates.getByText(/has been reached|lifts it|resets at/)).toHaveCount(0);
});

test("the install shows what it is doing, then asks for a restart", async ({ page }) => {
  const { updates } = await openUpdates(page);
  await githubWill(page, { release: NEXT });
  await updates.getByRole("button", { name: "Check now" }).click();

  const dialog = page.getByRole("dialog", { name: "A new version of Versorium" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Download & Install" }).click();

  // The five phases are the real steps, not an animation. Downloading carries
  // byte counts; before this the dialog showed nothing between the click and
  // either a relaunch or an error.
  await expect(dialog.getByText("Downloading…")).toBeVisible();
  await expect(dialog.getByText(/of \d+\.\d MB/)).toBeVisible();
  await expect(dialog.getByRole("progressbar")).toBeVisible();
  await expect(dialog.getByText("Checking the signature…")).toBeVisible();
  await expect(dialog.getByText("Installing…")).toBeVisible();

  // Installed. Offering "skip" or "later" now would be a lie: the new version
  // is on disk either way, so the only remaining action is restarting.
  await expect(dialog.getByText("Installed")).toBeVisible();
  await expect(dialog.getByText("Restart to open the new version.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Skip this version" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Later" })).toHaveCount(0);

  await dialog.getByRole("button", { name: "Restart now" }).click();
  await expect.poll(() => page.evaluate(() => window.__VERSORIUM_MOCK__.relaunched)).toBe(true);
});
