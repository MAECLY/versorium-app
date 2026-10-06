import { expect, test, type Page } from "@playwright/test";

// Local AI where the graphics card cannot run models (src-tauri/src/gpu): it
// runs on the processor with a notice that says so, or, with no Vulkan at
// all, it cannot start and its sections are out of reach. Either way a modal
// lists what this computer has and what is missing, with the vendor's
// driver page and Check again. Runs against the mocked IPC: `?gpu=cpu` is a
// Linux laptop with only llvmpipe, `?gpu=unavailable` a Windows PC with an
// NVIDIA card and no Vulkan.

async function openSettingsPage(page: Page, url: string, group: string, title = "Settings") {
  await page.goto(url);
  await page.getByRole("banner").getByRole("button", { name: title }).click();
  const settings = page.getByRole("region", { name: title });
  await settings.getByRole("navigation").getByRole("button", { name: group, exact: true }).click();
  return settings;
}

test("on the processor, Models says so and the modal says why, with the driver to get", async ({ page }) => {
  const settings = await openSettingsPage(page, "/?mock=tauri&gpu=cpu", "Models");
  const notice = settings.locator("[data-gpu-notice='cpu']");
  await expect(notice).toContainText("Local AI runs on the processor, which is slower.");
  // Nothing is locked: the models still run.
  await expect(settings.locator("[data-gpu-locked]")).toHaveCount(0);
  // Not opened by itself: the AI works, the notice is enough.
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await notice.getByRole("button", { name: "See what's missing" }).click();
  // By role alone: its title follows the state, and Check again changes it.
  await expect(page.getByRole("dialog", { name: "Local AI runs on the processor" })).toBeVisible();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("listitem").filter({ hasText: "llvmpipe" })).toContainText("Models can't run on it.");
  await expect(dialog.getByText("A Vulkan driver for the graphics card. Only a software renderer answered.")).toBeVisible();
  const driver = dialog.getByRole("link", { name: /Get the Intel driver/ });
  await expect(driver).toHaveAttribute("href", "https://www.intel.com/content/www/us/en/support/detect.html");

  // A driver installed since: Check again says so, and the notice goes.
  await page.evaluate(() => {
    const mock = window.__VERSORIUM_MOCK__;
    mock.gpu.next = { ...mock.gpuStates.ready, platform: "linux", backend: "vulkan" };
  });
  await dialog.getByRole("button", { name: "Check again" }).click();
  await expect(dialog.getByText("Checked: models now run on the graphics card.")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Local AI is ready on this computer" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__VERSORIUM_MOCK__.calls.filter((c) => c.cmd === "gpu_check_again").length)).toBe(1);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(settings.locator("[data-gpu-notice]")).toHaveCount(0);
});

test("with no Vulkan, the modal opens by itself and the models are out of reach until a check passes", async ({ page }) => {
  const settings = await openSettingsPage(page, "/?mock=tauri&gpu=unavailable", "Models");
  const dialog = page.getByRole("dialog", { name: "Local AI can't start on this computer" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("listitem").filter({ hasText: "NVIDIA GeForce RTX 3060" })).toContainText("No Vulkan");
  await expect(dialog.getByText("Vulkan, which comes with your graphics card's driver.")).toBeVisible();
  await expect(dialog.getByRole("link", { name: /Get the NVIDIA driver/ })).toHaveAttribute("href", "https://www.nvidia.com/Download/index.aspx");
  // Assistants are named as still working: nothing else is lost.
  await expect(dialog).toContainText("Assistants (Claude Code, Codex, OpenCode) still work.");

  // Nothing installed yet: Check again says so and keeps the modal.
  await dialog.getByRole("button", { name: "Check again" }).click();
  await expect(dialog.getByText("Checked: something is still missing.")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();

  await expect(settings.locator("[data-gpu-notice='unavailable']")).toContainText("Local AI can't start on this computer yet.");
  await expect(settings.locator("[data-gpu-locked]")).toHaveAttribute("inert", "");
  // About this computer, opened, names the engine's state.
  await settings.getByRole("button", { name: "About this computer" }).click();
  await expect(settings.getByText("Not available on this computer")).toBeVisible();

  // Once per visit: leaving and coming back does not open it again.
  await settings.getByRole("navigation").getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(settings.locator("[data-gpu-notice='unavailable']")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a computer whose GPU runs the models shows no notice", async ({ page }) => {
  const settings = await openSettingsPage(page, "/?mock=tauri", "Models");
  await expect(settings.getByText("About this computer")).toBeVisible();
  await expect(settings.locator("[data-gpu-notice]")).toHaveCount(0);
  await expect(settings.locator("[data-gpu-locked]")).toHaveCount(0);
});

test("the notice and the modal are in Spanish too", async ({ page }) => {
  await page.goto("/?mock=tauri&gpu=cpu");
  await page.getByRole("contentinfo").getByRole("button", { name: "ES", exact: true }).click();
  await page.getByRole("banner").getByRole("button", { name: "Ajustes" }).click();
  const settings = page.getByRole("region", { name: "Ajustes" });
  await settings.getByRole("navigation").getByRole("button", { name: "Modelos", exact: true }).click();
  const notice = settings.locator("[data-gpu-notice='cpu']");
  await expect(notice).toContainText("La IA local funciona con el procesador, que es más lento.");
  await notice.getByRole("button", { name: "Ver qué falta" }).click();
  const dialog = page.getByRole("dialog", { name: "La IA local funciona con el procesador" });
  await expect(dialog.getByRole("button", { name: "Revisar de nuevo" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: /Descarga el controlador de Intel/ })).toBeVisible();
});
