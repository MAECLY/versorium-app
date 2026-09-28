import { expect, test, type Page } from "@playwright/test";

// M6 DoD in the browser: no check without a token, a check that offers a
// version, and the Install / Later / Skip dialog.
// Runs against the mocked IPC (tests/e2e/mock-tauri.ts).

async function openUpdates(page: Page) {
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByRole("button", { name: "Application" }).click();
  return { settings, updates: settings.getByRole("region", { name: "Updates" }) };
}

/** Saving a token in the Updates slot is what signs the updater in. */
async function signIn(page: Page, settings: ReturnType<Page["getByRole"]>) {
  // No filtering needed any more: the novel's credential lives in another
  // group entirely, so there is only one card here to confuse it with.
  const slot = settings.getByRole("region", { name: "Updates login" });
  await slot.getByPlaceholder("GitHub token").fill("ghp_updates_token");
  await slot.getByRole("button", { name: "Connect" }).click();
  await expect.poll(async () => page.evaluate(() => window.__VERSORIUM_MOCK__.update.signedIn)).toBe(true);
}

test("without a token Versorium does not check at all", async ({ page }) => {
  const { updates } = await openUpdates(page);

  await expect(updates.getByText(/Without it Versorium does not check at all/)).toBeVisible();
  await expect(updates.getByRole("button", { name: "Check now" })).toBeDisabled();
  await expect(updates.getByText("Installed version")).toBeVisible();

  // Not a single check was attempted.
  expect(await page.evaluate(() => window.__VERSORIUM_MOCK__.calls.some((c) => c.cmd === "update_check"))).toBe(false);
});

test("the panel says what it sends and how it behaves offline", async ({ page }) => {
  const { updates } = await openUpdates(page);
  await expect(updates.getByText(/Nothing about your manuscript is sent/)).toBeVisible();
  // The signing reality, stated plainly rather than hidden.
  await expect(updates.getByText(/not yet notarized by Apple or Microsoft/)).toBeVisible();
  // The offline line belongs to a failed check, so it is absent until one fails.
  await expect(updates.getByText(/no pop-up, no retry loop/)).toBeHidden();
});

test("the channel is a real choice and beta is marked opt-in", async ({ page }) => {
  const { updates } = await openUpdates(page);
  const channel = updates.getByLabel("Channel");
  await expect(channel).toHaveValue("stable");
  await expect(updates.getByText("Beta is opt-in and ships unfinished work.")).toBeVisible();

  await channel.selectOption("beta");
  await expect.poll(async () => page.evaluate(() => window.__VERSORIUM_MOCK__.update.channel)).toBe("beta");
});

test("automatic checking is on by default and can be turned off", async ({ page }) => {
  const { updates } = await openUpdates(page);
  const automatic = updates.getByRole("checkbox", { name: "Automatic updates" });
  await expect(automatic).toBeChecked();

  await automatic.uncheck();
  await expect.poll(async () => page.evaluate(() => window.__VERSORIUM_MOCK__.update.automatic)).toBe(false);
});

test("once signed in a check offers the new version", async ({ page }) => {
  const { settings, updates } = await openUpdates(page);
  await signIn(page, settings);

  await updates.getByRole("button", { name: "Check now" }).click();
  await expect(updates.getByText("Version 0.2.0 is available.")).toBeVisible();
});

test("the dialog offers install, later and skip, and promises verification", async ({ page }) => {
  const { settings, updates } = await openUpdates(page);
  await signIn(page, settings);
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

  // Skipping takes the version off the offer for good.
  await dialog.getByRole("button", { name: "Skip this version" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => page.evaluate(() => window.__VERSORIUM_MOCK__.update.available)).toBe(null);
});

test("the Updates panel is translated", async ({ page }) => {
  await page.goto("/?mock=tauri");
  await page.getByRole("contentinfo").getByRole("button", { name: "ES", exact: true }).click();
  await page.getByRole("button", { name: "Ajustes" }).click();
  const settings = page.getByRole("region", { name: "Ajustes" });
  await settings.getByRole("button", { name: "Aplicación" }).click();
  const updates = settings.getByRole("region", { name: "Actualizaciones" });
  await expect(updates.getByRole("button", { name: "Buscar ahora" })).toBeVisible();
});

test("the install shows what it is doing, then asks for a restart", async ({ page }) => {
  const { settings, updates } = await openUpdates(page);
  await signIn(page, settings);
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
