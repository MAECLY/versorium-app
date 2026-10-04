import { expect, test, type Page } from "@playwright/test";
import { gotoMock } from "./mock-page";

// M2 DoD in the browser: the assistants found, hiding uncensored models,
// select → Rewrite → diff → Apply with a git checkpoint first and ops
// authored by the AI. Runs against the mocked IPC (tests/e2e/mock-tauri.ts).

interface MockOp { author: string; kind: string; from: number; to: number; text: string; seq: number }

async function mockState(page: Page) {
  return page.evaluate(() => {
    const mock = window.__VERSORIUM_MOCK__;
    const project = [...mock.projects.values()][0];
    return {
      commits: project?.commits.map((c) => c.message) ?? [],
      ops: (project?.ops["ch-01"] ?? []) as MockOp[],
      body: project?.chapters[0]?.body ?? "",
      censorship: mock.settings.censorship,
    };
  });
}

async function createProject(page: Page, title: string, url = "/?mock=tauri"): Promise<void> {
  await page.goto(url);
  await page.getByRole("button", { name: "Create your first novel" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
}

async function typeAndSelectLine(page: Page, text: string): Promise<void> {
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.type(text);
  await page.keyboard.press("Shift+Home");
  // The 800 ms autosave + 500 ms ops flush must land before the rewrite.
  await page.waitForTimeout(1200);
}

test("rewrite a selection: checkpoint, ops author=ai, editor updated", async ({ page }) => {
  await createProject(page, "The Long Winter");
  await typeAndSelectLine(page, "The winter was long.");

  await page.getByRole("banner").getByRole("button", { name: "Rewrite" }).click();
  const dialog = page.getByRole("dialog", { name: "Rewrite" });
  await expect(dialog).toBeVisible();
  // With no slot configured the dialog opens on a model on this computer, so
  // a CLI harness has to be asked for: the passage only leaves the machine on
  // a deliberate choice.
  await dialog.getByLabel("Agent").selectOption({ label: "Claude Code" });
  // Privacy line (spec §2.3): the passage leaves through the CLI login.
  await expect(dialog.getByText("This call goes to Claude Code.")).toBeVisible();
  await expect(dialog.getByText("CLI", { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "Rewrite", exact: true }).click();
  const preview = dialog.getByRole("region", { name: "Preview" });
  await expect(preview).toContainText("− The winter was long.");
  await expect(preview).toContainText("+ The winter was long. — rewritten by claude");

  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".cm-content")).toContainText("rewritten by claude");

  const state = await mockState(page);
  expect(state.body).toBe("The winter was long. — rewritten by claude");
  expect(state.commits[0]).toBe("checkpoint: before ai rewrite (claude)");
  const aiOps = state.ops.filter((op) => op.author === "ai:claude");
  expect(aiOps.map((op) => op.kind)).toEqual(["delete", "insert"]);
  expect(aiOps[0].text).toBe("The winter was long.");
  expect(aiOps[1].to - aiOps[1].from).toBe("The winter was long. — rewritten by claude".length);
  // Human keystrokes were logged before the AI ops.
  expect(state.ops.some((op) => op.author === "human")).toBe(true);
  expect(state.ops.at(-1)?.author).toBe("ai:claude");
});

test("ollama is labelled local and a failing harness keeps the dialog open", async ({ page }) => {
  await createProject(page, "Errors");
  await typeAndSelectLine(page, "Una noche sin luna.");
  await page.getByRole("banner").getByRole("button", { name: "Rewrite" }).click();
  const dialog = page.getByRole("dialog", { name: "Rewrite" });

  // The daemon's model is named, not just "Ollama": the model is what runs.
  await expect(dialog.getByRole("option", { name: "Ollama · qwen3.8:latest" })).toBeAttached();
  await expect(dialog.getByText("Local", { exact: true })).toBeVisible();

  await dialog.getByLabel("Agent").selectOption({ label: "Codex" });
  await dialog.getByRole("button", { name: "Rewrite", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("The agent did not answer.");
  await expect(dialog.getByRole("button", { name: "Apply" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Discard" }).click();
  await expect(dialog).toBeHidden();
  expect((await mockState(page)).commits[0]).not.toContain("ai rewrite");
});

test("rewrite without a selection explains itself", async ({ page }) => {
  await createProject(page, "No Selection");
  await page.locator(".cm-content").click();
  await page.getByRole("banner").getByRole("button", { name: "Rewrite" }).click();
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Select a passage first.");
});

test("Assistants lists the three as found, and uncensored models can be hidden", async ({ page }) => {
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  const rail = settings.getByRole("navigation", { name: "Settings sections" });
  await rail.getByRole("button", { name: "Assistants", exact: true }).click();
  const list = settings.locator("ul.v-boxed");

  await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(list.getByRole("listitem").filter({ hasText: "Claude Code" })).toContainText("Found · version 2.1.0");
  await expect(list.getByRole("listitem").filter({ hasText: "OpenCode" })).toContainText("Not found on this computer");
  // Only the three that rewrite prose: Ollama is on Models, the GitHub CLI
  // is used by nothing, and "Connected" belongs to Access to your novel.
  await expect(settings.getByText(/Ollama|GitHub CLI|Connected/)).toHaveCount(0);
  await settings.getByRole("button", { name: "Check again" }).click();
  await expect(settings.getByRole("button", { name: "Check again" })).toBeEnabled();
  await expect(list.getByRole("listitem")).toHaveCount(3);
  // Links both ways.
  await expect(settings.getByRole("button", { name: "Choose one for Rewrite in Tasks ›" })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Used for Rewrite" })).toHaveCount(0);
  await expect(
    settings.getByRole("button", { name: "To let an app read your novel instead, Claude Desktop included, see Access to your novel ›" }),
  ).toBeVisible();

  // Which models the catalogue shows sits with the catalogue.
  await rail.getByRole("button", { name: "Models", exact: true }).click();
  const shown = settings.getByRole("checkbox", { name: "Show uncensored models", exact: true });
  await expect(shown).toBeChecked();
  await shown.uncheck();
  await expect.poll(async () => (await mockState(page)).censorship).toBe(true);
});

test("the whole M2 surface is translated", async ({ page }) => {
  await createProject(page, "Idioma");
  await page.getByRole("contentinfo").getByRole("button", { name: "ES", exact: true }).click();
  const header = page.getByRole("banner");
  await expect(header.getByRole("button", { name: "Reescribir" })).toBeVisible();
  await page.getByRole("button", { name: "Ajustes" }).click();
  const settings = page.getByRole("region", { name: "Ajustes" });
  const rail = settings.getByRole("navigation", { name: "Secciones de ajustes" });
  await rail.getByRole("button", { name: "Asistentes", exact: true }).click();
  await expect(settings.getByText("Encontrado · versión 2.1.0")).toBeVisible();
  await expect(settings.getByText("No encontrado en este equipo")).toBeVisible();
  await rail.getByRole("button", { name: "Modelos", exact: true }).click();
  await expect(settings.getByRole("checkbox", { name: "Mostrar modelos sin censura", exact: true })).toBeVisible();
});

test("the rewrite names the model, and downloaded weights say they have no engine", async ({
  page,
}) => {
  await createProject(page, "Which Model");
  await typeAndSelectLine(page, "El faro seguía encendido.");
  await page.getByRole("banner").getByRole("button", { name: "Rewrite" }).click();
  const dialog = page.getByRole("dialog", { name: "Rewrite" });

  // A model in Versorium comes first now that it has an engine; Ollama is
  // asked for here.
  await expect(dialog.getByText("This call goes to Gemma 3 1B.")).toBeVisible();
  await dialog.getByLabel("Agent").selectOption({ label: "Ollama · qwen3.8:latest" });
  await expect(dialog.getByText("This call goes to Ollama · qwen3.8:latest.")).toBeVisible();
  await dialog.getByRole("button", { name: "Rewrite", exact: true }).click();
  // Attribution is the model, not the family: "ollama" alone never said which.
  await expect(dialog.getByRole("region", { name: "Preview" })).toContainText(
    "+ El faro seguía encendido. — rewritten by qwen3.8:latest",
  );
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(dialog).toBeHidden();

  const state = await mockState(page);
  expect(state.commits[0]).toBe("checkpoint: before ai rewrite (qwen3.8:latest)");
  expect(state.ops.some((op) => op.author === "ai:qwen3.8:latest")).toBe(true);

  // A downloaded GGUF now runs in-process instead of reporting that nothing can
  // load it. This assertion was the inverse until the engine shipped.
  await typeAndSelectLine(page, "Otra noche mas.");
  await page.getByRole("banner").getByRole("button", { name: "Rewrite" }).click();
  const again = page.getByRole("dialog", { name: "Rewrite" });
  await again.getByLabel("Agent").selectOption({ label: "Gemma 3 1B" });
  await again.getByRole("button", { name: "Rewrite", exact: true }).click();
  await expect(again.getByRole("region", { name: "Preview" })).toContainText(
    "rewritten by gemma3-1b-q4km",
  );
  await expect(again.getByRole("alert")).toHaveCount(0);
});

test("a model too large for the machine is refused before it loads", async ({ page }) => {
  await createProject(page, "Demasiado grande");
  // Dolphin 24B does not fit the mocked 36 GB machine with the spec's margin.
  await page.evaluate(() => {
    const m = window.__VERSORIUM_MOCK__.models.find((x) => x.id === "dolphin-24b-q4km");
    if (m) m.state = "ready";
  });
  await typeAndSelectLine(page, "Una linea.");
  await page.getByRole("banner").getByRole("button", { name: "Rewrite" }).click();
  const dialog = page.getByRole("dialog", { name: "Rewrite" });
  await dialog.getByLabel("Agent").selectOption({ label: "Dolphin 24B" });
  await dialog.getByRole("button", { name: "Rewrite", exact: true }).click();
  // Refusing beats swapping: a model that does not fit does not fail, it makes
  // the machine unusable until the OS kills it.
  await expect(dialog.getByRole("alert")).toContainText("more memory than this machine has");
  await expect(dialog.getByRole("button", { name: "Apply" })).toBeDisabled();
});

test("the engine says it is starting, then names the device it will use", async ({ page }) => {
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByRole("navigation").getByRole("button", { name: "Models", exact: true }).click();
  await settings.getByRole("button", { name: "About this computer" }).click();

  // Spec §6.2 asks for the backend on Ready. Starting is a visible state
  // because the first start prepares the graphics chip for about fifteen seconds.
  await expect(settings.getByText(/preparing the graphics chip/).first()).toBeVisible();
  await expect(settings.getByText("Metal (Apple M4 Max)")).toBeVisible();
  await expect(settings.getByText("Ready", { exact: true })).toBeVisible();
});

test("the configured Rewrite slot is what the dialog opens on", async ({ page }) => {
  await createProject(page, "Configured Slot");
  // Setting the slot is covered by the M4 spec; here it is only a precondition.
  await page.evaluate(() => {
    window.__VERSORIUM_MOCK__.slots.rewrite = { kind: "cli", id: "claude" };
  });

  await typeAndSelectLine(page, "Nadie contestó.");
  await page.getByRole("banner").getByRole("button", { name: "Rewrite" }).click();
  const dialog = page.getByRole("dialog", { name: "Rewrite" });
  // The configured slot wins over the local default, and says it is the one
  // chosen in Settings rather than leaving the writer to guess.
  await expect(dialog.getByText("This call goes to Claude Code.")).toBeVisible();
  await expect(
    dialog.getByRole("option", { name: "Claude Code (configured)" }),
  ).toBeAttached();

  // A slot naming something this machine cannot run falls back rather than
  // failing: opencode is "missing" in the mock. The fallback is the first
  // model on this computer, never an assistant.
  await page.evaluate(() => {
    window.__VERSORIUM_MOCK__.slots.rewrite = { kind: "cli", id: "opencode" };
  });
  await dialog.getByRole("button", { name: "Discard" }).click();
  await typeAndSelectLine(page, "Nadie contestó.");
  await page.getByRole("banner").getByRole("button", { name: "Rewrite" }).click();
  const again = page.getByRole("dialog", { name: "Rewrite" });
  await expect(again.getByText("This call goes to Gemma 3 1B.")).toBeVisible();
});

test("with nothing to rewrite with, the dialog points to Models", async ({ page }) => {
  await createProject(page, "Nada", "/?mock=tauri&agents=none");
  await page.evaluate(() => {
    const mock = window.__VERSORIUM_MOCK__;
    const gemma = mock.models.find((m) => m.id === "gemma3-1b-q4km");
    if (gemma) gemma.state = "missing";
    Object.assign(mock.ollama, { running: false, models: [] });
  });
  await typeAndSelectLine(page, "Una línea.");
  await page.getByRole("banner").getByRole("button", { name: "Rewrite" }).click();
  const dialog = page.getByRole("dialog", { name: "Rewrite" });
  await expect(
    dialog.getByText("Nothing can rewrite yet. Get a model in Settings → Models, or install Claude Code, Codex or OpenCode."),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Rewrite", exact: true })).toBeDisabled();

  await dialog.getByRole("button", { name: "Open Settings › Models" }).click();
  await expect(dialog).toBeHidden();
  const rail = page.getByRole("region", { name: "Settings" }).getByRole("navigation", { name: "Settings sections" });
  await expect(rail.getByRole("button", { name: "Models", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#settings-page-title")).toBeFocused();
});

test("an assistant chosen for Rewrite says so on Assistants, and leads to the choice", async ({ page }) => {
  await gotoMock(page);
  await page.evaluate(() => {
    window.__VERSORIUM_MOCK__.slots.rewrite = { kind: "cli", id: "claude" };
  });
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  const rail = settings.getByRole("navigation", { name: "Settings sections" });
  await rail.getByRole("button", { name: "Assistants", exact: true }).click();
  const claude = settings.locator("ul.v-boxed").getByRole("listitem").filter({ hasText: "Claude Code" });
  await claude.getByRole("button", { name: "Used for Rewrite" }).click();
  await expect(rail.getByRole("button", { name: "Tasks", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(settings.getByRole("combobox", { name: "Model for Rewrite" })).toBeFocused();
  await expect(settings.getByRole("combobox", { name: "Model for Rewrite" })).toHaveValue("cli:claude");
});

test("Assistants says where each one was found, and that it is checking again", async ({ page }) => {
  await gotoMock(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Assistants", exact: true }).click();

  const where = settings.getByRole("button", { name: "Where they were found" });
  await expect(where).toHaveAttribute("aria-expanded", "false");
  await where.click();
  await expect(settings.getByText("/mock/bin/claude", { exact: true })).toBeVisible();
  await expect(settings.getByText("/mock/bin/codex", { exact: true })).toBeVisible();
  // Only what was found has a path: OpenCode is not on this computer.
  await expect(settings.getByText(/OpenCode:/)).toHaveCount(0);

  // A fresh scan takes seconds; the button says so meanwhile, and the list stays.
  await page.evaluate(() => window.__VERSORIUM_MOCK__.hold("agents_detect"));
  await settings.getByRole("button", { name: "Check again" }).click();
  const checking = settings.getByRole("button", { name: "Checking…" });
  await expect(checking).toBeDisabled();
  await expect(settings.locator("ul.v-boxed")).toHaveAttribute("aria-busy", "true");
  await expect(settings.locator("ul.v-boxed").getByRole("listitem")).toHaveCount(3);
  await page.evaluate(() => window.__VERSORIUM_MOCK__.release("agents_detect"));
  await expect(settings.getByRole("button", { name: "Check again" })).toBeEnabled();
  await expect(settings.locator("ul.v-boxed")).toHaveAttribute("aria-busy", "false");
});
