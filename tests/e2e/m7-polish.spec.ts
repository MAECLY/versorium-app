import { expect, test, type Page } from "@playwright/test";
import { gotoMock } from "./mock-page";

// M7 DoD in the browser: focus and typewriter, the corkboard, onboarding
// without a signup, crash reports that carry no prose, the continuity check
// (Manuscript › Continuity), and the font catalogue. Runs against the mocked
// IPC.

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

  // Exact: "Focus options" sits right beside it.
  await bar.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(bar.getByRole("button", { name: "Focus", exact: true })).toHaveAttribute("aria-pressed", "true");
  // The words survive the mode change — that is the whole point.
  await expect(page.locator(".cm-content")).toContainText("El invierno fue largo.");

  // Escape is the way out, so nobody has to force-quit.
  await page.locator(".cm-content").click();
  await page.keyboard.press("Escape");
  await expect(bar.getByRole("button", { name: "Focus", exact: true })).toHaveAttribute("aria-pressed", "false");
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

test("Report opens the issue in the browser, and a browser that does not open shows the address", async ({ page }) => {
  await withProject(page);
  const settings = await openSettings(page, "Application");
  const crash = settings.getByRole("region", { name: "Crash reports" });
  await crash.getByRole("button", { name: "Report" }).first().click();
  const open = crash.getByRole("button", { name: "Open an issue" });
  await expect(open).toBeVisible();

  // Through the opener and its https scope, the way About's links go.
  await open.click();
  await expect
    .poll(() => page.evaluate(() => window.__VERSORIUM_MOCK__.browser.at(-1) ?? ""))
    .toBe("https://github.com/mock/versorium-app/issues/new?title=crash&body=redacted");
  await expect(crash.getByRole("alert")).toHaveCount(0);

  // A browser that will not open is said on the card, with the address to copy.
  await page.evaluate(() => (window.__VERSORIUM_MOCK__.failures["plugin:opener|open_url"] = "no browser"));
  await open.click();
  const alert = crash.getByRole("alert");
  await expect(alert).toContainText("Your browser could not be opened. The address is:");
  await expect(alert).toContainText("https://github.com/mock/versorium-app/issues/new?title=crash&body=redacted");

  // Once it opens again, the line goes.
  await page.evaluate(() => delete window.__VERSORIUM_MOCK__.failures["plugin:opener|open_url"]);
  await open.click();
  await expect(alert).toHaveCount(0);
});

/** Manuscript › Continuity, from the top bar. */
async function openContinuity(page: Page) {
  await page.getByRole("banner").getByRole("button", { name: "Manuscript" }).click();
  const dialog = page.getByRole("dialog", { name: "Manuscript" });
  await dialog.getByRole("tab", { name: "Continuity" }).click();
  return dialog;
}

const rail = (page: Page) =>
  page.getByRole("region", { name: "Settings" }).getByRole("navigation", { name: "Settings sections" });

test("the continuity check lives in the manuscript and says when it has no model", async ({ page }) => {
  await withProject(page);
  const dialog = await openContinuity(page);

  await expect(dialog.getByText("Continuity has no model yet.")).toBeVisible();
  // Nothing to run it on, so it cannot start, and cannot imply the novel is consistent.
  await expect(dialog.getByRole("button", { name: "Check the manuscript" })).toBeDisabled();
  await expect(dialog.getByText("Nothing contradictory found.")).toHaveCount(0);

  await dialog.getByRole("button", { name: "Choose one in Settings ›" }).click();
  await expect(dialog).toBeHidden();
  await expect(rail(page).getByRole("button", { name: "Tasks", exact: true })).toHaveAttribute("aria-current", "page");
  // Where the choice is made, ready to make it.
  await expect(page.getByRole("combobox", { name: "Model for Continuity" })).toBeFocused();
  // And Settings no longer runs the check itself.
  const settings = page.getByRole("region", { name: "Settings" });
  await expect(settings.getByRole("button", { name: /Run check|Check the manuscript/ })).toHaveCount(0);
});

test("a continuity check with a model lists what it found", async ({ page }) => {
  await withProject(page);
  await page.evaluate(() => {
    window.__VERSORIUM_MOCK__.slots.continuity = { kind: "ollama", id: "qwen3.8:latest" };
  });
  const dialog = await openContinuity(page);

  await expect(dialog.getByText("Runs on qwen3.8:latest, on this computer.")).toBeVisible();
  await dialog.getByRole("button", { name: "Check the manuscript" }).click();
  await expect(dialog.getByText("Ana's eyes change colour.")).toBeVisible();
  await expect(dialog.getByText("Contradiction", { exact: true })).toBeVisible();

  // A check that cannot run says why instead of reporting a clean novel.
  await page.evaluate(() => {
    window.__VERSORIUM_MOCK__.ollama.running = false;
  });
  await dialog.getByRole("button", { name: "Check the manuscript" }).click();
  await expect(dialog.getByText("Ollama isn't running, so the check couldn't start.")).toBeVisible();
  await expect(dialog.getByText("Ana's eyes change colour.")).toHaveCount(0);
});

test("a check says it is reading while it runs, and a closed dialog forgets it", async ({ page }) => {
  await withProject(page);
  await page.evaluate(() => {
    window.__VERSORIUM_MOCK__.slots.continuity = { kind: "ollama", id: "qwen3.8:latest" };
    window.__VERSORIUM_MOCK__.hold("continuity_check");
  });
  let dialog = await openContinuity(page);
  await dialog.getByRole("button", { name: "Check the manuscript" }).click();
  const reading = dialog.getByRole("button", { name: "Reading…" });
  await expect(reading).toBeDisabled();
  await expect(dialog.locator('[aria-live="polite"][aria-busy="true"]')).toHaveCount(1);
  await page.evaluate(() => window.__VERSORIUM_MOCK__.release("continuity_check"));
  await expect(dialog.getByText("Ana's eyes change colour.")).toBeVisible();
  await expect(dialog.locator('[aria-live="polite"][aria-busy="true"]')).toHaveCount(0);

  // Closed and opened again: the dialog starts clean, not on the last result.
  await page.keyboard.press("Escape");
  dialog = await openContinuity(page);
  await expect(dialog.getByText("Runs on qwen3.8:latest, on this computer.")).toBeVisible();
  await expect(dialog.getByText("Ana's eyes change colour.")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Check the manuscript" })).toBeEnabled();
});

test("with no novel open, the check waits for one even with a model chosen", async ({ page }) => {
  await gotoMock(page);
  await page.evaluate(() => {
    window.__VERSORIUM_MOCK__.slots.continuity = { kind: "builtin", id: "gemma3-1b-q4km" };
  });
  // No novel, so no Manuscript button: Settings' link is the way in.
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  await rail(page).getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("button", { name: "Run it from Manuscript › Continuity" }).click();
  const dialog = page.getByRole("dialog", { name: "Manuscript" });
  await expect(dialog.getByText("Runs on Gemma 3 1B, on this computer.")).toBeVisible();
  await expect(dialog.getByText("Open a novel first.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Check the manuscript" })).toBeDisabled();
});

test("the Continuity tab reads the chosen model afresh each time it opens", async ({ page }) => {
  await withProject(page);
  let dialog = await openContinuity(page);
  await expect(dialog.getByText("Continuity has no model yet.")).toBeVisible();
  await page.keyboard.press("Escape");
  // Chosen since (from Settings, or anywhere): the next opening says so.
  await page.evaluate(() => {
    window.__VERSORIUM_MOCK__.slots.continuity = { kind: "builtin", id: "gemma3-1b-q4km" };
  });
  dialog = await openContinuity(page);
  await expect(dialog.getByText("Runs on Gemma 3 1B, on this computer.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Check the manuscript" })).toBeEnabled();
});

test("Change in Settings › from the Manuscript dialog over an open Settings moves Settings there", async ({
  page,
}) => {
  await withProject(page);
  await page.evaluate(() => {
    window.__VERSORIUM_MOCK__.slots.continuity = { kind: "builtin", id: "gemma3-1b-q4km" };
  });
  await openSettings(page, "Author");
  // Settings covers the page, not the top bar: the dialog opens over it.
  const dialog = await openContinuity(page);
  await expect(dialog.getByText("Runs on Gemma 3 1B, on this computer.")).toBeVisible();

  await dialog.getByRole("button", { name: "Change in Settings ›" }).click();
  await expect(dialog).toBeHidden();
  await expect(rail(page).getByRole("button", { name: "Tasks", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(rail(page).getByRole("button", { name: "Author", exact: true })).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("combobox", { name: "Model for Continuity" })).toBeFocused();
  await expect(page.getByRole("combobox", { name: "Model for Continuity" })).toHaveValue("builtin:gemma3-1b-q4km");
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
  // The size words Settings → Models uses, not a "pack" of its own.
  await expect(tour.getByText("36 GB of memory and 12 cores: models up to Large fit comfortably.")).toBeVisible();
  await tour.getByRole("button", { name: "Next" }).click();
  // Found, not "Connected": that word belongs to Access to your novel.
  await expect(tour.getByRole("listitem").filter({ hasText: "Claude Code" })).toContainText("Found");
  await expect(tour.getByRole("listitem").filter({ hasText: "OpenCode" })).toContainText("Not found");
  // Spec §14 ends on "sin signup": nothing may ask for an account.
  await expect(tour.getByLabel(/e-?mail/i)).toHaveCount(0);
  await expect(tour.getByLabel(/password|contraseña/i)).toHaveCount(0);

  await tour.getByRole("button", { name: "Skip setup" }).click();
  await expect(tour).toBeHidden();
  await expect.poll(async () => page.evaluate(() => window.__VERSORIUM_MOCK__.settings.onboarded)).toBe(true);
});
