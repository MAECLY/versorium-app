import { expect, test, type Page } from "@playwright/test";

// M2 DoD in the browser: agents cards, censorship toggle, select → Rewrite →
// diff → Apply with a git checkpoint first and ops authored by the AI.
// Runs against the mocked IPC (tests/e2e/mock-tauri.ts).

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

async function createProject(page: Page, title: string): Promise<void> {
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Create your first project" }).click();
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
  // With no slot configured the dialog opens on the local daemon, so a CLI
  // harness has to be asked for: the passage only leaves the machine on a
  // deliberate choice.
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
  await expect(page.getByRole("alert")).toContainText("Select a passage first.");
});

test("settings: agents cards and censorship toggle persist", async ({ page }) => {
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Settings" }).click();
  // Scoped to the Agents landmark: the MCP panel lists the same client names.
  const agents = page.getByRole("dialog", { name: "Settings" }).getByRole("region", { name: "Agents" });

  await expect(agents.getByText("Claude Code")).toBeVisible();
  await expect(agents.getByText("Connected", { exact: true })).toHaveCount(4);
  await expect(agents.getByText("Missing", { exact: true })).toHaveCount(1);
  await expect(agents.getByText("qwen3.8:latest")).toBeVisible();
  await agents.getByRole("button", { name: "Re-check" }).click();
  await expect(agents.getByText("OpenCode")).toBeVisible();

  const censorship = page
    .getByRole("dialog", { name: "Settings" })
    .getByRole("checkbox", { name: "Censorship" });
  await expect(censorship).not.toBeChecked();
  await censorship.check();
  await expect.poll(async () => (await mockState(page)).censorship).toBe(true);
});

test("the whole M2 surface is translated", async ({ page }) => {
  await createProject(page, "Idioma");
  await page.getByRole("banner").getByRole("button", { name: "ES", exact: true }).click();
  const header = page.getByRole("banner");
  await expect(header.getByRole("button", { name: "Reescribir" })).toBeVisible();
  await page.getByRole("button", { name: "Ajustes" }).click();
  const settings = page.getByRole("dialog", { name: "Ajustes" });
  await expect(settings.getByRole("region", { name: "Agentes" }).getByText("Conectado", { exact: true }).first()).toBeVisible();
  await expect(settings.getByRole("checkbox", { name: "Censura" })).toBeVisible();
});

test("the rewrite names the model, and downloaded weights say they have no engine", async ({
  page,
}) => {
  await createProject(page, "Which Model");
  await typeAndSelectLine(page, "El faro seguía encendido.");
  await page.getByRole("banner").getByRole("button", { name: "Rewrite" }).click();
  const dialog = page.getByRole("dialog", { name: "Rewrite" });

  // The local daemon is the default because it is the only choice that keeps
  // the passage on this machine and can actually answer.
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

  // A downloaded GGUF is offered, and explains itself rather than looking broken.
  await typeAndSelectLine(page, "Otra noche mas.");
  await page.getByRole("banner").getByRole("button", { name: "Rewrite" }).click();
  const again = page.getByRole("dialog", { name: "Rewrite" });
  await again.getByLabel("Agent").selectOption({ label: "Gemma 3 1B" });
  await again.getByRole("button", { name: "Rewrite", exact: true }).click();
  await expect(again.getByRole("alert")).toContainText("no engine to run it yet");
  await expect(again.getByRole("button", { name: "Apply" })).toBeDisabled();
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
  // failing: opencode is "missing" in the mock.
  await page.evaluate(() => {
    window.__VERSORIUM_MOCK__.slots.rewrite = { kind: "cli", id: "opencode" };
  });
  await dialog.getByRole("button", { name: "Discard" }).click();
  await typeAndSelectLine(page, "Nadie contestó.");
  await page.getByRole("banner").getByRole("button", { name: "Rewrite" }).click();
  const again = page.getByRole("dialog", { name: "Rewrite" });
  await expect(again.getByText("This call goes to Ollama · qwen3.8:latest.")).toBeVisible();
});
