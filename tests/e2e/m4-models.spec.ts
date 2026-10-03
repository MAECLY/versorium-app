import { expect, test, type Page } from "@playwright/test";

// M4 DoD in the browser: the ladder as Download / Ready / Selected cards, the
// hardware wizard that recommends without downloading, the Ollama tab, and
// per-task slots. Runs against the mocked IPC (tests/e2e/mock-tauri.ts).

async function openLocalAi(page: Page) {
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByRole("button", { name: "Local AI" }).click();
  return { settings, localAi: settings.getByRole("region", { name: "Local AI" }) };
}

async function mockModels(page: Page) {
  return page.evaluate(() => window.__VERSORIUM_MOCK__.models.map((m) => ({ ...m })));
}

async function mockSlots(page: Page) {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__VERSORIUM_MOCK__.slots)));
}

test("the wizard recommends a tier and starts nothing by itself", async ({ page }) => {
  const { localAi } = await openLocalAi(page);

  await expect(localAi.getByText("This machine", { exact: true })).toBeVisible();
  await expect(localAi.getByText(/the large pack is the largest that fits/)).toBeVisible();
  await expect(localAi.getByText("Nothing downloads on its own.")).toBeVisible();

  // Nothing may have moved off its starting state just by opening the panel.
  const models = await mockModels(page);
  expect(models.find((m) => m.id === "qwen3-4b-q4km")?.state).toBe("missing");
  expect(await page.evaluate(() => window.__VERSORIUM_MOCK__.calls.some((c) => c.cmd === "models_download"))).toBe(false);
});

test("a card shows Download, Ready or a resumable percentage", async ({ page }) => {
  const { localAi } = await openLocalAi(page);

  const ready = localAi.getByRole("listitem").filter({ hasText: "Gemma 3 1B" });
  await expect(ready.getByText("Ready")).toBeVisible();

  const missing = localAi.getByRole("listitem").filter({ hasText: "Qwen3 4B Instruct" });
  await expect(missing.getByRole("button", { name: "Download" })).toBeVisible();
  await expect(missing.getByText("Balanced", { exact: true })).toBeVisible();
  // Speed and quality are folded away until asked for: the row carries what it
  // takes to decide, the details carry the rest.
  await expect(missing.getByText(/Balanced • Good/i)).toHaveCount(0);
  await missing.getByRole("button", { name: "Details" }).click();
  await expect(missing.getByText(/Balanced • Good/i)).toBeVisible();

  // A partial download offers to resume rather than starting over.
  const partial = localAi.getByRole("listitem").filter({ hasText: "Qwen3 14B" });
  await expect(partial.getByRole("button", { name: "Resume" })).toBeVisible();
});

test("downloading shows a bar that moves, and can be cancelled while it does", async ({ page }) => {
  const { localAi } = await openLocalAi(page);
  const card = localAi.getByRole("listitem").filter({ hasText: "Qwen3 4B Instruct" });

  await card.getByRole("button", { name: "Download" }).click();

  // The bug: `models_download` does not resolve until the file is on disk, and
  // polling used to start after that await — so a writer pressing Download
  // watched a greyed-out button and nothing else for the whole transfer.
  const bar = card.getByRole("progressbar");
  await expect(bar).toBeVisible();
  await expect(card.getByText(/of .* · \d+%/)).toBeVisible();

  // And it actually moves.
  const first = Number(await bar.getAttribute("aria-valuenow"));
  await expect
    .poll(async () => Number(await bar.getAttribute("aria-valuenow")))
    .toBeGreaterThan(first);

  // Cancel used to be routed through the same guard that was held for the
  // length of the download, so it was dead for exactly as long as it was the
  // only button on screen.
  await card.getByRole("button", { name: "Cancel" }).click();
  await expect.poll(async () =>
    page.evaluate(() => window.__VERSORIUM_MOCK__.calls.some((c) => c.cmd === "models_cancel")),
  ).toBe(true);
  await expect(bar).toHaveCount(0);
});

test("a model too large for the machine says so but is not forbidden", async ({ page }) => {
  const { localAi } = await openLocalAi(page);
  // Censorship is off in the mock, so the uncensored 24B card is visible.
  const big = localAi.getByRole("listitem").filter({ hasText: "Dolphin 24B" });
  await expect(big.getByText(/Larger than this machine can hold/)).toBeVisible();
  await expect(big.getByText("uncensored")).toBeVisible();
  await expect(big.getByRole("button", { name: "Download" })).toBeEnabled();
});

test("deleting asks before it destroys gigabytes", async ({ page }) => {
  const { localAi } = await openLocalAi(page);
  const card = localAi.getByRole("listitem").filter({ hasText: "Gemma 3 1B" });

  await card.getByRole("button", { name: "Delete" }).click();
  await expect(card.getByText("Delete for good?")).toBeVisible();
  expect((await mockModels(page)).find((m) => m.id === "gemma3-1b-q4km")?.state).toBe("ready");

  await card.getByRole("button", { name: "Keep" }).click();
  await expect(card.getByText("Delete for good?")).toBeHidden();
  expect((await mockModels(page)).find((m) => m.id === "gemma3-1b-q4km")?.state).toBe("ready");
});

test("each task picks its own model and a deleted model releases its tasks", async ({ page }) => {
  const { localAi } = await openLocalAi(page);

  await localAi.getByLabel("Rewrite", { exact: true }).selectOption("builtin:gemma3-1b-q4km");
  await expect.poll(async () => (await mockSlots(page)).rewrite.id).toBe("gemma3-1b-q4km");
  // Picking one task must not touch another.
  expect((await mockSlots(page)).chat.kind).toBe("none");

  const card = localAi.getByRole("listitem").filter({ hasText: "Gemma 3 1B" });
  await card.getByRole("button", { name: "Delete" }).click();
  await card.getByRole("button", { name: "Delete for good?" }).click();
  await expect.poll(async () => (await mockSlots(page)).rewrite.kind).toBe("none");
});

test("the Ollama tab lists what the daemon has", async ({ page }) => {
  const { localAi } = await openLocalAi(page);
  await localAi.getByRole("tab", { name: "Ollama" }).click();
  await expect(localAi.getByRole("tabpanel")).toContainText("qwen3.8:latest");
});

test("the Local AI panel is translated", async ({ page }) => {
  await page.goto("/?mock=tauri");
  await page.getByRole("contentinfo").getByRole("button", { name: "ES", exact: true }).click();
  await page.getByRole("button", { name: "Ajustes" }).click();
  const settings = page.getByRole("region", { name: "Ajustes" });
  await settings.getByRole("button", { name: "IA local" }).click();
  const localAi = settings.getByRole("region", { name: "IA local" });
  // The tab is named for what it is — a source of models — rather than for a
  // task, which is what "Escritura" read as next to the Writing settings group.
  await expect(localAi.getByRole("tab", { name: "Integrados" })).toBeVisible();
  await expect(localAi.getByRole("button", { name: "Descargar" }).first()).toBeVisible();
  await expect(localAi.getByText("Qué usa cada tarea")).toBeVisible();
});

test("the panel leads with the tasks, not with the four ways to supply a model", async ({ page }) => {
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByRole("button", { name: "Local AI" }).click();
  const localAi = settings.getByRole("region", { name: "Local AI" });

  // "Which model does which job" used to be a row of dropdowns at the very
  // bottom, under four tabs that were four suppliers dressed as four choices.
  const headings = await localAi.locator("h4").allTextContents();
  expect(headings[0]).toBe("What each task uses");
  expect(headings.slice(1)).toContain("Where models come from");

  // A task with nothing assigned says so rather than looking configured.
  const rewrite = localAi.getByRole("listitem").filter({ hasText: "Rewrite" }).first();
  await expect(rewrite.getByText("no model yet")).toBeVisible();

  // And once it has one, it says where that one runs — instead of leaving it
  // implied by whichever tab you happened to find the model under.
  await rewrite.getByRole("combobox", { name: "Rewrite" }).selectOption({ index: 1 });
  await expect(rewrite.getByText("runs in Versorium")).toBeVisible();

  // The picker lists every source together, which is the other half of the
  // point: a writer choosing a model for a job should not have to know which
  // program is going to run it.
  const options = await rewrite.getByRole("combobox").locator("optgroup").allTextContents();
  expect(options.length).toBeGreaterThan(0);
});
