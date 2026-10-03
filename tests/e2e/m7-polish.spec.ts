import { expect, test, type Page } from "@playwright/test";

// M7 DoD in the browser: focus and typewriter, the corkboard, onboarding
// without a signup, crash reports that carry no prose, the continuity stub,
// and the font catalogue. Runs against the mocked IPC.

async function withProject(page: Page, title = "El largo invierno") {
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Create your first novel" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
}

/** `group` is a rail entry: a group's controls exist only while it is current. */
async function openSettings(page: Page, group = "Editor") {
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByRole("button", { name: group, exact: true }).click();
  return settings;
}

test("focus and typewriter toggle without losing the text", async ({ page }) => {
  await withProject(page);
  await page.locator(".cm-content").click();
  await page.keyboard.type("El invierno fue largo.");
  await page.waitForTimeout(900);

  const bar = page.getByRole("contentinfo");
  await bar.getByRole("button", { name: "Typewriter" }).click();
  await expect(bar.getByRole("button", { name: "Typewriter" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".cm-content")).toContainText("El invierno fue largo.");

  await bar.getByRole("button", { name: "Focus" }).click();
  await expect(bar.getByRole("button", { name: "Focus" })).toHaveAttribute("aria-pressed", "true");
  // The words survive the mode change — that is the whole point.
  await expect(page.locator(".cm-content")).toContainText("El invierno fue largo.");

  // Escape is the way out, so nobody has to force-quit.
  await page.locator(".cm-content").click();
  await page.keyboard.press("Escape");
  await expect(bar.getByRole("button", { name: "Focus" })).toHaveAttribute("aria-pressed", "false");
});

test("the corkboard shows a card per chapter and opens one", async ({ page }) => {
  await withProject(page);
  await page.locator(".cm-content").click();
  await page.keyboard.type("Primera escena del capítulo.");
  await page.waitForTimeout(900);

  await page.getByRole("contentinfo").getByRole("button", { name: "Corkboard" }).click();
  const board = page.getByRole("list", { name: "Corkboard" }).or(page.locator("ul").filter({ hasText: "El largo invierno" }).first());
  await expect(board.getByRole("listitem").first()).toBeVisible();
  await expect(page.getByText("Primera escena del capítulo.")).toBeVisible();

  await page.getByRole("contentinfo").getByRole("button", { name: "Corkboard" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
});

test("a crash report carries no manuscript and is not sent on its own", async ({ page }) => {
  await withProject(page);
  const settings = await openSettings(page, "Application");
  const crash = settings.getByRole("region", { name: "Crash reports" });

  await expect(crash.getByText(/carry no manuscript text/)).toBeVisible();
  await expect(crash.getByText(/Nothing is sent unless you press Report/)).toBeVisible();
  await expect(crash.getByText("<redacted> 3 but the index is 5")).toBeVisible();

  // Opening a report is an explicit act; nothing left the machine to render this.
  expect(await page.evaluate(() => window.__VERSORIUM_MOCK__.calls.some((c) => c.cmd === "crash_report_url"))).toBe(false);
});

test("the continuity check says it did not run rather than reporting nothing", async ({ page }) => {
  await withProject(page);
  // Continuity only runs from a local model, so it sits with the models.
  const settings = await openSettings(page, "Local AI");
  const continuity = settings.getByRole("region", { name: "Continuity check" });

  await expect(continuity.getByText(/needs a local model selected/)).toBeVisible();
  await continuity.getByRole("button", { name: "Run check" }).click();

  // No model is assigned, so it must not imply the manuscript is consistent.
  await expect(continuity.getByText(/No model is selected for Continuity|continuity_no_model/)).toBeVisible();
  await expect(continuity.getByText("Nothing contradictory found.")).toBeHidden();
});

test("typography offers what is installed and promises no download", async ({ page }) => {
  await withProject(page);
  const settings = await openSettings(page);
  const typography = settings.getByRole("region", { name: "Typography" });

  await expect(typography.getByText("System serif")).toBeVisible();
  await expect(typography.getByText(/Nothing here needs fetching/)).toBeVisible();
  // A font we cannot fetch must not offer to fetch it.
  await expect(typography.getByRole("button", { name: /Download/ })).toHaveCount(0);
});

test("onboarding runs on a fresh install and never asks for an account", async ({ page }) => {
  // The mock treats `fresh` as a first run; a reload would just rebuild its state.
  await page.goto("/?mock=tauri&fresh=1");

  const tour = page.getByRole("dialog", { name: "Welcome to Versorium" });
  await expect(tour).toBeVisible();
  // Spec §14 ends on "sin signup": nothing may ask for an account.
  await expect(tour.getByLabel(/e-?mail/i)).toHaveCount(0);
  await expect(tour.getByLabel(/password|contraseña/i)).toHaveCount(0);

  await tour.getByRole("button", { name: "Skip setup" }).click();
  await expect(tour).toBeHidden();
  await expect.poll(async () => page.evaluate(() => window.__VERSORIUM_MOCK__.settings.onboarded)).toBe(true);
});
