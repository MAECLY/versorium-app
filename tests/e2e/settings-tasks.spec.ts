import { expect, test, type Page } from "@playwright/test";
import { gotoMock } from "./mock-page";

// Settings → Tasks: which model does Rewrite and Continuity, chosen from
// native selects grouped by where the passage goes, each with a line that
// says so (Settings redesign SPEC §4.2). Runs against the mocked IPC: Gemma 3
// 1B is downloaded, Ollama serves qwen3.8:latest, Claude Code and Codex are
// found, and no task has a model.

async function openTasks(page: Page, url = "/?mock=tauri", setup?: () => void) {
  await gotoMock(page, url);
  if (setup) await page.evaluate(setup);
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await rail(page).getByRole("button", { name: "Tasks", exact: true }).click();
  return settings;
}

const rail = (page: Page) =>
  page.getByRole("region", { name: "Settings" }).getByRole("navigation", { name: "Settings sections" });
const summary = (page: Page) => page.getByTestId("tasks-summary");
const rewrite = (page: Page) => page.getByRole("combobox", { name: "Model for Rewrite" });
const continuity = (page: Page) => page.getByRole("combobox", { name: "Model for Continuity" });
const notices = (page: Page) => page.getByRole("region", { name: "Notifications" });

function mockSlots(page: Page) {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__VERSORIUM_MOCK__.slots)));
}

/** What a select shows: its option labels, its groups, and which options are disabled. */
function selectContents(page: Page, name: string) {
  return page.getByRole("combobox", { name }).evaluate((el) => {
    const select = el as HTMLSelectElement;
    return {
      groups: [...select.querySelectorAll("optgroup")].map((g) => g.label),
      options: [...select.options].map((o) => o.textContent?.trim() ?? ""),
      disabled: [...select.options].filter((o) => o.disabled).map((o) => o.textContent?.trim() ?? ""),
      groupOf: Object.fromEntries(
        [...select.options].map((o) => [o.textContent?.trim() ?? "", (o.parentElement as HTMLOptGroupElement).label ?? ""]),
      ),
      selected: select.selectedOptions[0]?.textContent?.trim() ?? "",
    };
  });
}

/** Nothing on this computer can write: no download, no Ollama model (with `agents=none`, no assistant either). */
function nothingReady() {
  const mock = window.__VERSORIUM_MOCK__;
  const gemma = mock.models.find((m) => m.id === "gemma3-1b-q4km");
  if (gemma) gemma.state = "missing";
  Object.assign(mock.ollama, { running: false, installed: true, models: [] });
}

test("Tasks says what is ready and offers one click for both", async ({ page }) => {
  await openTasks(page);
  await expect(summary(page)).toContainText("Rewrite asks each time, starting with models on this computer.");
  await expect(summary(page)).toContainText("Continuity has no model yet.");
  const both = summary(page).getByRole("button", { name: "Use Gemma 3 1B for both" });
  // The size word, the size and the fit stand beside the offer.
  await expect(summary(page).getByText("Small · 819 MB · fits this computer")).toBeVisible();

  await both.click();
  await expect.poll(async () => (await mockSlots(page)).rewrite).toEqual({ kind: "builtin", id: "gemma3-1b-q4km" });
  expect((await mockSlots(page)).continuity).toEqual({ kind: "builtin", id: "gemma3-1b-q4km" });
  await expect(notices(page)).toContainText("Rewrite and Continuity now use Gemma 3 1B.");
  await expect(both).toHaveCount(0);
  // The button went with the offer; focus did not go with it.
  await expect(rewrite(page)).toBeFocused();
  await expect(summary(page)).toContainText("Rewrite runs on this computer, with Gemma 3 1B.");
});

test("the Rewrite list groups choices by where the passage goes", async ({ page }) => {
  await openTasks(page);
  const contents = await selectContents(page, "Model for Rewrite");
  expect(contents.groups).toEqual(["On this computer", "Assistants, with your own account"]);
  expect(contents.options).toEqual([
    "Choose each time",
    "Gemma 3 1B — in Versorium",
    "qwen3.8:latest — in Ollama",
    "Claude Code",
    "Codex",
  ]);
  // The embedding model writes nothing (C6), and OpenCode is not installed.
  expect(contents.options.join(" ")).not.toContain("Nomic");
  expect(contents.options).not.toContain("OpenCode");
  expect(contents.disabled).toEqual([]);
});

test("choosing an assistant says the passage leaves this computer", async ({ page }) => {
  await openTasks(page);
  await rewrite(page).selectOption("cli:claude");
  await expect.poll(async () => (await mockSlots(page)).rewrite).toEqual({ kind: "cli", id: "claude" });
  // The line under the select is its description, so it is read with it.
  await expect(rewrite(page)).toHaveAccessibleDescription("The passage goes to Claude Code's service, under your account.");
  await expect(summary(page)).toContainText("Rewrite hands the passage to Claude Code");
});

test("the choice is read out once it settles, and only the last of quick changes", async ({ page }) => {
  await openTasks(page);
  // The app's own live region (App.svelte), not the notices'.
  const said = page.locator('.sr-only[role="status"]:not([data-notices])');
  // Everything the region says from here on.
  await said.evaluate((region) => {
    const heard: string[] = [];
    (window as unknown as { heard: string[] }).heard = heard;
    new MutationObserver(() => {
      const text = region.textContent?.trim();
      if (text) heard.push(text);
    }).observe(region, { childList: true, characterData: true, subtree: true });
  });
  // On Windows a closed select changes on each arrow key: three in a row.
  await rewrite(page).selectOption("ollama:qwen3.8:latest");
  await rewrite(page).selectOption("builtin:gemma3-1b-q4km");
  await rewrite(page).selectOption("cli:codex");
  await expect(said).toHaveText("The passage goes to Codex's service, under your account.");
  // Once, for the choice that settled: not once per step on the way there.
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => (window as unknown as { heard: string[] }).heard)).toEqual([
    "The passage goes to Codex's service, under your account.",
  ]);
  // Every change reached Rust, in order; the last one stands.
  await expect.poll(async () => (await mockSlots(page)).rewrite).toEqual({ kind: "cli", id: "codex" });
  const sent = await page.evaluate(() =>
    window.__VERSORIUM_MOCK__.calls.filter((c) => c.cmd === "models_set_slot").map((c) => c.args.id),
  );
  expect(sent).toEqual(["qwen3.8:latest", "gemma3-1b-q4km", "codex"]);
});

test("a refused choice puts the select back and says why", async ({ page }) => {
  await openTasks(page);
  await page.evaluate(() => {
    window.__VERSORIUM_MOCK__.failures.models_set_slot = "io";
  });
  await rewrite(page).selectOption("cli:claude");
  await expect(page.getByRole("region", { name: "Settings" }).getByRole("alert")).toHaveText("File system error.");
  // What is stored, not what was asked for.
  await expect(rewrite(page)).toHaveValue("none");
  expect((await mockSlots(page)).rewrite).toEqual({ kind: "none", id: "" });
});

test("Continuity shows the assistants but cannot use them", async ({ page }) => {
  await openTasks(page);
  const contents = await selectContents(page, "Model for Continuity");
  expect(contents.groups).toContain("Assistants: Continuity runs only on one of your models");
  expect(contents.groupOf["Claude Code"]).toBe("Assistants: Continuity runs only on one of your models");
  expect(contents.disabled).toEqual(["Claude Code", "Codex"]);
  await expect(
    page.getByText("Assistants can't run it: Continuity runs only on one of your models."),
  ).toBeVisible();
  await expect(continuity(page)).toHaveAccessibleDescription("Off until it has a model.");
});

test("features that are not built are text, not controls", async ({ page }) => {
  const settings = await openTasks(page);
  await expect(settings.getByRole("heading", { name: "Not built yet" })).toBeVisible();
  for (const line of [
    "Project chat. Talking with a model about your novel.",
    "Search by meaning. Finding passages by what they say, not by their exact words.",
    "Dictation. You speak, and Versorium types it into the chapter.",
  ]) {
    await expect(settings.getByText(line)).toBeVisible();
  }
  await expect(settings.getByRole("combobox")).toHaveCount(2);
});

test("with nothing ready, Tasks leads to Models and its first download", async ({ page }) => {
  await openTasks(page, "/?mock=tauri&agents=none", nothingReady);
  await expect(summary(page)).toContainText("No model is ready yet, so Rewrite and Continuity can't run.");
  expect((await selectContents(page, "Model for Rewrite")).options).toEqual(["Choose each time"]);

  await summary(page).getByRole("button", { name: "Get a model" }).click();
  await expect(rail(page).getByRole("button", { name: "Models", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Download Qwen3 4B Instruct" })).toBeFocused();
});

test("a choice that is no longer available stays visible, and says so", async ({ page }) => {
  await openTasks(page, "/?mock=tauri", () => {
    window.__VERSORIUM_MOCK__.slots.rewrite = { kind: "ollama", id: "llama3:8b" };
  });
  // A select shows the stored value, never silently its first option.
  await expect(rewrite(page)).toHaveValue("ollama:llama3:8b");
  const contents = await selectContents(page, "Model for Rewrite");
  expect(contents.selected).toBe("llama3:8b — not on this computer any more");
  expect(contents.disabled).toContain("llama3:8b — not on this computer any more");
  expect(contents.groupOf["llama3:8b — not on this computer any more"]).toBe("No longer available");
  await expect(summary(page)).toContainText("Rewrite was set to llama3:8b, which isn't on this computer any more.");
});

test("Run it from Manuscript › Continuity opens that tab over Settings, which stays", async ({ page }) => {
  await openTasks(page, "/?mock=tauri&seed=1", () => undefined);
  const link = page.getByRole("button", { name: "Run it from Manuscript › Continuity" });
  await link.click();
  const dialog = page.getByRole("dialog", { name: "Manuscript" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("tab", { name: "Continuity" })).toHaveAttribute("aria-selected", "true");

  // Closing it comes back to where the link was.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(rail(page).getByRole("button", { name: "Tasks", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(link).toBeFocused();
});

test("Tasks is translated", async ({ page }) => {
  await page.goto("/?mock=tauri");
  await page.getByRole("contentinfo").getByRole("button", { name: "ES", exact: true }).click();
  await page.getByRole("banner").getByRole("button", { name: "Ajustes" }).click();
  const settings = page.getByRole("region", { name: "Ajustes" });
  await settings.getByRole("navigation").getByRole("button", { name: "Tareas", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "Tareas", level: 2 })).toBeVisible();
  await expect(settings.getByRole("combobox", { name: "Modelo para Reescritura" })).toHaveValue("none");
  await expect(settings.getByRole("combobox", { name: "Modelo para Reescritura" }).locator("option").first()).toHaveText(
    "Elegir cada vez",
  );
  await expect(settings.getByRole("heading", { name: "Aún no existen" })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Usar Gemma 3 1B para las dos" })).toBeVisible();
});

/** A novel open with a sentence selected, ready for Rewrite. */
async function selectALine(page: Page, text: string): Promise<void> {
  await page.getByRole("button", { name: "← Back to writing" }).click();
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.type(text);
  await page.keyboard.press("Shift+Home");
  await page.waitForTimeout(1200);
}

test("a saved, answering local server can be given to Rewrite, and the passage goes to it", async ({ page }) => {
  await page.goto("/?mock=tauri&seed=1");
  await page.getByRole("button", { name: /^Continue/ }).click();
  await page.evaluate(() => {
    window.__VERSORIUM_MOCK__.studio.enabled = true;
  });
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  await rail(page).getByRole("button", { name: "Tasks", exact: true }).click();

  const contents = await selectContents(page, "Model for Rewrite");
  expect(contents.options).toContain("local-model — on the local server");
  expect(contents.groupOf["local-model — on the local server"]).toBe("On this computer");
  expect(contents.disabled).not.toContain("local-model — on the local server");
  await rewrite(page).selectOption("server:local-model");
  await expect.poll(async () => (await mockSlots(page)).rewrite).toEqual({ kind: "server", id: "local-model" });
  await expect(rewrite(page)).toHaveAccessibleDescription("Runs on the local server on this computer. The passage stays here.");

  await selectALine(page, "La aguja tembló.");
  await page.getByRole("banner").getByRole("button", { name: "Rewrite" }).click();
  const dialog = page.getByRole("dialog", { name: "Rewrite" });
  // The configured task, said as where the passage goes.
  await expect(dialog.getByText("This call goes to Local server · local-model.")).toBeVisible();
  await expect(dialog.getByText("Local", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Rewrite", exact: true }).click();
  await expect(dialog.getByRole("region", { name: "Preview" })).toContainText("rewritten by local-model");
});

test("a task on a local server that stopped answering says so, here and in Rewrite", async ({ page }) => {
  await page.goto("/?mock=tauri&seed=1");
  await page.getByRole("button", { name: /^Continue/ }).click();
  await page.evaluate(() => {
    const mock = window.__VERSORIUM_MOCK__;
    mock.studio.enabled = true;
    mock.slots.rewrite = { kind: "server", id: "local-model" };
    // Both tasks on it: with Continuity free, the summary would offer it a
    // model first (SPEC §4.2, the button rules' order).
    mock.slots.continuity = { kind: "server", id: "local-model" };
  });

  // Answering when the dialog opens, silent when it is asked.
  await page.locator(".cm-content").click();
  await page.keyboard.type("Nadie contestó.");
  await page.keyboard.press("Shift+Home");
  await page.waitForTimeout(1200);
  await page.getByRole("banner").getByRole("button", { name: "Rewrite" }).click();
  const dialog = page.getByRole("dialog", { name: "Rewrite" });
  await expect(dialog.getByText("This call goes to Local server · local-model.")).toBeVisible();
  await page.evaluate(() => {
    window.__VERSORIUM_MOCK__.studio.running = false;
  });
  await dialog.getByRole("button", { name: "Rewrite", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "The local server isn't answering. Start it, or check its address in Settings → Models.",
  );
  await dialog.getByRole("button", { name: "Discard" }).click();

  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  await rail(page).getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(summary(page)).toContainText("Rewrite uses local-model on the local server, but it isn't answering.");
  await expect(summary(page)).toContainText("Continuity uses local-model on the local server, but it isn't answering.");
  await expect(summary(page).getByRole("button", { name: "Check again" })).toBeVisible();
  await expect(rewrite(page)).toHaveValue("server:local-model");
  const contents = await selectContents(page, "Model for Rewrite");
  expect(contents.selected).toBe("local-model — the local server isn't answering");
  expect(contents.disabled).toContain("local-model — the local server isn't answering");

  // Started again: Check again finds it.
  await page.evaluate(() => {
    window.__VERSORIUM_MOCK__.studio.running = true;
  });
  await summary(page).getByRole("button", { name: "Check again" }).click();
  await expect(summary(page)).toContainText("Rewrite runs on this computer, with local-model on the local server.");
  await expect(summary(page).getByRole("button", { name: "Check again" })).toHaveCount(0);
});

test("a download does not lock the task pickers (C5)", async ({ page }) => {
  await openTasks(page);
  // The download stays on its way for as long as this test looks.
  await page.evaluate(() => window.__VERSORIUM_MOCK__.hold("models_download"));
  await rail(page).getByRole("button", { name: "Models", exact: true }).click();
  const row = page.locator("li").filter({ hasText: "Qwen3 4B Instruct" }).filter({ hasText: "Recommended" });
  await row.getByRole("button", { name: "Download" }).click();
  await expect(row.getByRole("progressbar")).toBeVisible();

  await rail(page).getByRole("button", { name: "Tasks", exact: true }).click();
  // Not after the download: during it. It used to hold the store's one busy
  // flag, which locked these selects and dropped any change made meanwhile.
  await expect(rewrite(page)).toBeEnabled({ timeout: 1000 });
  await rewrite(page).selectOption("builtin:gemma3-1b-q4km");
  await expect.poll(async () => (await mockSlots(page)).rewrite).toEqual({ kind: "builtin", id: "gemma3-1b-q4km" });

  // Let it go: the download finishes, the choice stands.
  await page.evaluate(() => window.__VERSORIUM_MOCK__.release("models_download"));
  await expect
    .poll(async () => page.evaluate(() => window.__VERSORIUM_MOCK__.models.find((m) => m.id === "qwen3-4b-q4km")?.state))
    .toBe("ready");
  expect((await mockSlots(page)).rewrite).toEqual({ kind: "builtin", id: "gemma3-1b-q4km" });
});

test("when the model engine did not start, Tasks says so before offering a model in Versorium", async ({ page }) => {
  await openTasks(page, "/?mock=tauri", () => {
    window.__VERSORIUM_MOCK__.llama.failed = true;
  });
  const notice = page.getByText(
    "Models in Versorium can't run on this computer right now: the model engine didn't start.",
  );
  // The summary offers Gemma 3 1B, which the engine would run.
  await expect(summary(page).getByRole("button", { name: "Use Gemma 3 1B for both" })).toBeVisible();
  await expect(notice).toBeVisible();
  await page.getByRole("button", { name: "Models ›" }).click();
  await expect(rail(page).getByRole("button", { name: "Models", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(notice).toBeVisible();
  await page.getByRole("button", { name: "About this computer" }).click();
  await expect(page.getByText("Didn't start", { exact: true })).toBeVisible();
});

test("an engine that started says nothing on Tasks", async ({ page }) => {
  await openTasks(page);
  await expect(summary(page)).toBeVisible();
  await expect(page.getByText(/the model engine didn't start/)).toHaveCount(0);
});

test("with Rewrite on an assistant, one click gives Continuity a model on this computer", async ({ page }) => {
  await openTasks(page, "/?mock=tauri", () => {
    window.__VERSORIUM_MOCK__.slots.rewrite = { kind: "cli", id: "claude" };
  });
  await summary(page).getByRole("button", { name: "Use Gemma 3 1B for Continuity" }).click();
  await expect.poll(async () => (await mockSlots(page)).continuity).toEqual({ kind: "builtin", id: "gemma3-1b-q4km" });
  expect((await mockSlots(page)).rewrite).toEqual({ kind: "cli", id: "claude" });
  await expect(notices(page)).toContainText("Continuity now uses Gemma 3 1B.");
  await expect(continuity(page)).toBeFocused();
});

test("a server saved at another computer's address is said to be elsewhere, everywhere it shows", async ({ page }) => {
  await page.goto("/?mock=tauri&seed=1");
  await page.getByRole("button", { name: /^Continue/ }).click();
  await page.evaluate(() => {
    Object.assign(window.__VERSORIUM_MOCK__.studio, { host: "192.168.1.20", enabled: true });
  });
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  await rail(page).getByRole("button", { name: "Tasks", exact: true }).click();

  const contents = await selectContents(page, "Model for Rewrite");
  expect(contents.groupOf["local-model — on the server at 192.168.1.20:1234"]).toBe("On the server at 192.168.1.20:1234");
  await rewrite(page).selectOption("server:local-model");
  await expect(rewrite(page)).toHaveAccessibleDescription("The passage goes to the server at 192.168.1.20:1234.");
  // Never what one click offers: that is for models on this computer.
  await expect(summary(page).getByRole("button", { name: /local-model/ })).toHaveCount(0);

  await rail(page).getByRole("button", { name: "Models", exact: true }).click();
  // Your models says where it is, as Tasks does, never "local".
  const served = page.getByRole("region", { name: "Settings" }).locator("ul.v-boxed").first().locator("li").filter({ hasText: "local-model" });
  await expect(served).toContainText("On the server at 192.168.1.20:1234 · Used by Rewrite");
  await expect(served).not.toContainText("On the local server");
  await page.getByRole("button", { name: /^Local server, / }).click();
  await expect(
    page.getByText("That address is not this computer: a passage given to its models leaves this computer for it."),
  ).toBeVisible();

  await page.getByRole("button", { name: "← Back to writing" }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.type("Lejos.");
  await page.keyboard.press("Shift+Home");
  await page.waitForTimeout(1200);
  await page.getByRole("banner").getByRole("button", { name: "Rewrite" }).click();
  const dialog = page.getByRole("dialog", { name: "Rewrite" });
  await expect(dialog.getByText("This call goes to Server at 192.168.1.20:1234 · local-model.")).toBeVisible();
  await expect(dialog.getByText("Network", { exact: true })).toBeVisible();
});

/** The line under a task's select: its words, and the bar that says where the passage goes. */
const statusOf = (page: Page, slot: "rewrite" | "continuity") => page.locator(`#tasks-${slot}-status`);

test("the bar before each status line says where the passage goes", async ({ page }) => {
  await openTasks(page, "/?mock=tauri", () => {
    window.__VERSORIUM_MOCK__.slots.continuity = { kind: "ollama", id: "llama3:8b" };
  });
  await expect(statusOf(page, "rewrite")).toHaveAttribute("data-bar", "local");
  await rewrite(page).selectOption("cli:claude");
  await expect(statusOf(page, "rewrite")).toHaveAttribute("data-bar", "cli");
  await rewrite(page).selectOption("builtin:gemma3-1b-q4km");
  await expect(statusOf(page, "rewrite")).toHaveAttribute("data-bar", "local");
  // A model that is gone is a warning, in words and in colour.
  await expect(statusOf(page, "continuity")).toHaveAttribute("data-bar", "warn");
  await expect(statusOf(page, "continuity")).toHaveText("Continuity was set to llama3:8b, which isn't on this computer any more.");
});

test("with no assistant found, Continuity does not explain that assistants can't run it", async ({ page }) => {
  await openTasks(page, "/?mock=tauri&agents=none");
  await expect(continuity(page)).toBeEnabled();
  await expect(page.getByText(/Assistants can't run it/)).toHaveCount(0);
  expect((await selectContents(page, "Model for Continuity")).groups).not.toContain(
    "Assistants: Continuity runs only on one of your models",
  );
});

test("the links at the foot of Tasks and Assistants go where they say, at the top of the page", async ({ page }) => {
  // A short window, so the page scrolls and the links are at its foot.
  await page.setViewportSize({ width: 1280, height: 520 });
  const settings = await openTasks(page);
  const pane = page.locator("#settings-page-title").locator("xpath=ancestor::div[contains(@class, 'overflow-y-auto')][1]");
  const toAssistants = settings.getByRole("button", { name: "The assistants in the Rewrite list are in Assistants ›" });
  await toAssistants.scrollIntoViewIfNeeded();
  expect(await pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await toAssistants.click();
  await expect(rail(page).getByRole("button", { name: "Assistants", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#settings-page-title")).toBeFocused();
  expect(await pane.evaluate((el) => el.scrollTop)).toBe(0);

  const toAccess = settings.getByRole("button", {
    name: "To let an app read your novel instead, Claude Desktop included, see Access to your novel ›",
  });
  await toAccess.click();
  await expect(rail(page).getByRole("button", { name: "Access to your novel", exact: true })).toHaveAttribute("aria-current", "page");
  await rail(page).getByRole("button", { name: "Assistants", exact: true }).click();
  await settings.getByRole("button", { name: "Choose one for Rewrite in Tasks ›" }).click();
  await expect(rail(page).getByRole("button", { name: "Tasks", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(rewrite(page)).toBeFocused();

  // A long page opens at its top too, not where the last one was left: the
  // title that takes focus does not scroll there by itself.
  await rail(page).getByRole("button", { name: "Tasks", exact: true }).click();
  await toAssistants.scrollIntoViewIfNeeded();
  expect(await pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await rail(page).getByRole("button", { name: "Models", exact: true }).click();
  await expect(page.locator("#settings-page-title")).toHaveText("Models");
  expect(await pane.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(300);
  expect(await pane.evaluate((el) => el.scrollTop)).toBe(0);
});
