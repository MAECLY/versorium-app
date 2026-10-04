import { expect, test, type Page } from "@playwright/test";
import { gotoMock } from "./mock-page";

// M4 in the browser, as Settings → Models shows it (Settings redesign SPEC
// §4.3): what fits this computer, the models on it, Ollama and the local
// server as one row each, and the catalogue, where nothing downloads on its
// own. Runs against the mocked IPC (tests/e2e/mock-tauri.ts): Gemma 3 1B is
// downloaded, Qwen3 14B is half downloaded, Ollama serves qwen3.8:latest.

async function openModels(page: Page, setup?: () => void, url = "/?mock=tauri") {
  await gotoMock(page, url);
  if (setup) await page.evaluate(setup);
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await rail(page).getByRole("button", { name: "Models", exact: true }).click();
  return settings;
}

const rail = (page: Page) =>
  page.getByRole("region", { name: "Settings" }).getByRole("navigation", { name: "Settings sections" });

/** A row in Your models or in the catalogue, by the model's name. */
const yours = (page: Page, name: string) =>
  page.getByRole("region", { name: "Settings" }).locator('ul[class~="v-boxed"]').first().locator("li").filter({ hasText: name });
const catalogue = (page: Page, name: string) =>
  page.locator('ul[aria-labelledby="models-available-title"] > li').filter({ hasText: name });

async function mockModels(page: Page) {
  return page.evaluate(() => window.__VERSORIUM_MOCK__.models.map((m) => ({ ...m })));
}

async function mockSlots(page: Page) {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__VERSORIUM_MOCK__.slots)));
}

function nothingReady() {
  const mock = window.__VERSORIUM_MOCK__;
  const gemma = mock.models.find((m) => m.id === "gemma3-1b-q4km");
  if (gemma) gemma.state = "missing";
  Object.assign(mock.ollama, { running: false, installed: true, models: [] });
}

test("Models says what fits and starts nothing by itself", async ({ page }) => {
  const settings = await openModels(page);
  await expect(settings.getByText("This computer has 36 GB of memory: models up to Large fit comfortably.")).toBeVisible();
  await expect(settings.getByText(/Nothing downloads on its own\./)).toBeVisible();

  // Nothing may have moved off its starting state just by opening the page.
  expect((await mockModels(page)).find((m) => m.id === "qwen3-4b-q4km")?.state).toBe("missing");
  expect(await page.evaluate(() => window.__VERSORIUM_MOCK__.calls.some((c) => c.cmd === "models_download"))).toBe(false);
});

test("your models and the catalogue show Ready, Paused and Download", async ({ page }) => {
  await openModels(page);
  const gemma = yours(page, "Gemma 3 1B");
  await expect(gemma).toContainText("In Versorium · Small · 819 MB · Not used by a task");
  await expect(gemma.getByRole("button", { name: "Delete" })).toBeVisible();

  const paused = yours(page, "Qwen3 14B");
  await expect(paused).toContainText("Paused at 3.0 GB of 9.0 GB");
  await expect(paused.getByRole("button", { name: "Resume" })).toBeVisible();

  const qwen = catalogue(page, "Qwen3 4B Instruct");
  await expect(qwen).toContainText("Medium · 2.5 GB · Fits this computer");
  await expect(qwen.getByText("Recommended", { exact: true })).toBeVisible();
  // Speed and quality are folded away until asked for.
  await expect(qwen.getByText("Speed: medium · Quality: good")).toBeHidden();
  await qwen.getByRole("button", { name: "Details" }).click();
  await expect(qwen.getByText("Speed: medium · Quality: good")).toBeVisible();
});

test("downloading shows a bar that moves, and can be cancelled while it does", async ({ page }) => {
  await openModels(page);
  const row = catalogue(page, "Qwen3 4B Instruct");
  await row.getByRole("button", { name: "Download" }).click();

  // `models_download` does not resolve until the file is on disk; the bar
  // moves during the transfer, not after it.
  const bar = row.getByRole("progressbar");
  await expect(bar).toBeVisible();
  await expect(row.getByText(/of .* · \d+%/)).toBeVisible();
  const first = Number(await bar.getAttribute("aria-valuenow"));
  await expect.poll(async () => Number(await bar.getAttribute("aria-valuenow"))).toBeGreaterThan(first);
  await expect(bar).toHaveAttribute("aria-valuetext", /of 2\.5 GB$/);

  await row.getByRole("button", { name: "Cancel" }).click();
  await expect
    .poll(async () => page.evaluate(() => window.__VERSORIUM_MOCK__.calls.some((c) => c.cmd === "models_cancel")))
    .toBe(true);
  await expect(bar).toHaveCount(0);
});

test("one download at a time says why the other buttons wait", async ({ page }) => {
  await openModels(page);
  await catalogue(page, "Qwen3 4B Instruct").getByRole("button", { name: "Download" }).click();
  const why = "One download at a time: Qwen3 4B Instruct is downloading.";
  await expect(page.getByText(why)).toBeVisible();
  const dolphin = catalogue(page, "Dolphin 24B").getByRole("button", { name: "Download" });
  await expect(dolphin).toBeDisabled();
  await expect(dolphin).toHaveAccessibleDescription(why);
  await catalogue(page, "Qwen3 4B Instruct").getByRole("button", { name: "Cancel" }).click();
  await expect(dolphin).toBeEnabled();
});

test("a model too large for this computer says so but is not forbidden", async ({ page }) => {
  await openModels(page);
  // Uncensored models are shown in the mock, so the 24B row is there.
  const big = catalogue(page, "Dolphin 24B");
  await expect(big.getByText("Too large for this computer: you can still download it")).toBeVisible();
  await expect(big.getByText("Uncensored", { exact: true })).toBeVisible();
  await expect(big.getByRole("button", { name: "Download" })).toBeEnabled();
});

test("exactly one model is recommended, never an uncensored one", async ({ page }) => {
  const settings = await openModels(page);
  await expect(settings.getByText("Recommended", { exact: true })).toHaveCount(1);
  await expect(catalogue(page, "Dolphin 24B").getByText("Recommended", { exact: true })).toHaveCount(0);
});

test("deleting asks before it destroys gigabytes", async ({ page }) => {
  await openModels(page);
  const gemma = yours(page, "Gemma 3 1B");
  await gemma.getByRole("button", { name: "Delete" }).click();
  await expect(gemma.getByRole("button", { name: "Delete for good?" })).toBeVisible();
  expect((await mockModels(page)).find((m) => m.id === "gemma3-1b-q4km")?.state).toBe("ready");

  await gemma.getByRole("button", { name: "Keep" }).click();
  await expect(gemma.getByRole("button", { name: "Delete for good?" })).toBeHidden();
  expect((await mockModels(page)).find((m) => m.id === "gemma3-1b-q4km")?.state).toBe("ready");
});

test("a deleted model releases the tasks that used it", async ({ page }) => {
  await openModels(page);
  await rail(page).getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("combobox", { name: "Model for Rewrite" }).selectOption("builtin:gemma3-1b-q4km");
  await expect.poll(async () => (await mockSlots(page)).rewrite.id).toBe("gemma3-1b-q4km");

  await rail(page).getByRole("button", { name: "Models", exact: true }).click();
  const gemma = yours(page, "Gemma 3 1B");
  // Which task uses it is said on the row, and links there.
  await expect(gemma.getByRole("button", { name: "Used by Rewrite" })).toBeVisible();
  await gemma.getByRole("button", { name: "Delete", exact: true }).click();
  await gemma.getByRole("button", { name: "Delete for good?" }).click();
  await expect.poll(async () => (await mockSlots(page)).rewrite.kind).toBe("none");
});

test("Ollama's models are listed with the others, and Ollama itself is one row", async ({ page }) => {
  await openModels(page);
  await expect(yours(page, "qwen3.8:latest")).toContainText("In Ollama");
  const ollama = page.getByRole("button", { name: "Ollama, Running · 1 model" });
  await expect(ollama).toHaveAttribute("aria-expanded", "false");
  await ollama.click();
  await expect(ollama).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByLabel("Get a model by name")).toBeVisible();
});

test("the local server can be saved, and its models offered to the tasks", async ({ page }) => {
  await openModels(page);
  const header = page.getByRole("button", { name: /^Local server, / });
  await expect(header).toHaveAccessibleName("Local server, Not set up");
  await header.click();
  const panel = page.locator("#models-server-panel");
  await panel.getByRole("button", { name: "Test connection" }).click();
  await expect(panel.getByText("Answered.")).toBeVisible();
  // Tested is not saved: no task is offered it yet.
  await rail(page).getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Model for Rewrite" }).locator("option", { hasText: "local-model" })).toHaveCount(0);

  await rail(page).getByRole("button", { name: "Models", exact: true }).click();
  await panel.getByRole("button", { name: "Save" }).click();
  await expect(header).toHaveAccessibleName("Local server, Answering · 1 model");
  await expect(yours(page, "local-model")).toContainText("On the local server");

  await rail(page).getByRole("button", { name: "Tasks", exact: true }).click();
  const option = page.getByRole("combobox", { name: "Model for Rewrite" }).locator("option", { hasText: "local-model" });
  await expect(option).toHaveText("local-model — on the local server");
  await expect(option).toBeEnabled();

  // Forgotten, it is offered to nothing, and the task that ran on it is released.
  await page.getByRole("combobox", { name: "Model for Rewrite" }).selectOption("server:local-model");
  await expect.poll(async () => (await mockSlots(page)).rewrite.kind).toBe("server");
  await rail(page).getByRole("button", { name: "Models", exact: true }).click();
  await panel.getByRole("button", { name: "Forget" }).click();
  await expect(header).toHaveAccessibleName("Local server, Not set up");
  await expect.poll(async () => (await mockSlots(page)).rewrite.kind).toBe("none");
  await expect(yours(page, "local-model")).toHaveCount(0);
});

test("getting a model into Ollama says it is working, then lists it, or says why not", async ({ page }) => {
  await openModels(page);
  await page.evaluate(() => window.__VERSORIUM_MOCK__.hold("ollama_pull"));
  await page.getByRole("button", { name: "Ollama, Running · 1 model" }).click();
  const ollama = page.locator("#models-ollama-panel");
  await ollama.getByLabel("Get a model by name").fill("qwen3:4b");
  await ollama.getByRole("button", { name: "Get", exact: true }).click();
  await expect(ollama.getByText("Getting qwen3:4b in Ollama… this can take minutes.")).toBeVisible();
  await expect(ollama.getByRole("button", { name: "Get", exact: true })).toBeDisabled();
  // A pull holds nothing else: the task pickers stay usable meanwhile.
  await rail(page).getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Model for Rewrite" })).toBeEnabled({ timeout: 1000 });
  await rail(page).getByRole("button", { name: "Models", exact: true }).click();
  await page.evaluate(() => window.__VERSORIUM_MOCK__.release("ollama_pull"));
  await expect(page.locator("#models-ollama-panel").getByText(/Getting qwen3:4b/)).toHaveCount(0);
  // Then it is one of Your models, as Ollama now lists it, and Ollama's row counts it.
  await expect(yours(page, "qwen3:4b")).toContainText("In Ollama");
  await expect(page.getByRole("button", { name: "Ollama, Running · 2 models" })).toBeVisible();

  await page.evaluate(() => {
    window.__VERSORIUM_MOCK__.failures.ollama_pull = "ollama_failed";
  });
  const panel = page.locator("#models-ollama-panel");
  await panel.getByLabel("Get a model by name").fill("nope:1b");
  await panel.getByRole("button", { name: "Get", exact: true }).click();
  // Said in Ollama's row, where it was asked.
  await expect(panel.getByRole("alert")).toHaveText("Ollama could not finish that.");
});

test("removing a model from Ollama asks first, and releases the task that used it", async ({ page }) => {
  await openModels(page, () => {
    window.__VERSORIUM_MOCK__.slots.rewrite = { kind: "ollama", id: "qwen3.8:latest" };
  });
  const row = yours(page, "qwen3.8:latest");
  await expect(row.getByRole("button", { name: "Used by Rewrite" })).toBeVisible();

  await row.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(row.getByRole("button", { name: "Remove it?" })).toBeVisible();
  // Asking removes nothing; Keep takes the question back.
  expect(await page.evaluate(() => window.__VERSORIUM_MOCK__.ollama.models.map((m) => m.name))).toEqual(["qwen3.8:latest"]);
  await row.getByRole("button", { name: "Keep" }).click();
  await expect(row.getByRole("button", { name: "Remove it?" })).toHaveCount(0);
  expect(await page.evaluate(() => window.__VERSORIUM_MOCK__.ollama.models.map((m) => m.name))).toEqual(["qwen3.8:latest"]);

  await row.getByRole("button", { name: "Remove", exact: true }).click();
  await row.getByRole("button", { name: "Remove it?" }).click();
  await expect(yours(page, "qwen3.8:latest")).toHaveCount(0);
  expect(await page.evaluate(() => window.__VERSORIUM_MOCK__.ollama.models)).toEqual([]);
  // A task never points at a model that is gone.
  await expect.poll(async () => (await mockSlots(page)).rewrite.kind).toBe("none");
  await expect(page.getByRole("button", { name: "Ollama, Running · 0 models" })).toBeVisible();
});

test("Use for Rewrite and Continuity gives both tasks the model, and focus to the line that says so", async ({ page }) => {
  await openModels(page);
  const gemma = yours(page, "Gemma 3 1B");
  await gemma.getByRole("button", { name: "Use for Rewrite and Continuity" }).click();
  await expect.poll(async () => mockSlots(page)).toMatchObject({
    rewrite: { kind: "builtin", id: "gemma3-1b-q4km" },
    continuity: { kind: "builtin", id: "gemma3-1b-q4km" },
  });
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Rewrite and Continuity now use Gemma 3 1B.");
  // The button went with the offer; focus did not go with it.
  const used = gemma.getByRole("button", { name: "Used by Rewrite and Continuity" });
  await expect(used).toBeFocused();
  await expect(gemma.getByRole("button", { name: "Use for Rewrite and Continuity" })).toHaveCount(0);
});

test("a download puts focus on its Cancel, says it started, and a cancel gives focus back", async ({ page }) => {
  await openModels(page);
  const said = page.locator('.sr-only[role="status"]:not([data-notices])');
  const row = catalogue(page, "Qwen3 4B Instruct");
  await row.getByRole("button", { name: "Download" }).click();
  // The button pressed turned into the bar and its Cancel.
  await expect(row.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expect(said).toHaveText("Downloading Qwen3 4B Instruct");

  await page.keyboard.press("Enter");
  // What was fetched stays, as Rust keeps the part: the model waits in Your
  // models, paused, and focus is on what goes on with it. A cancel is not an error.
  const paused = yours(page, "Qwen3 4B Instruct");
  await expect(paused).toContainText("Paused at");
  await expect(paused.getByRole("button", { name: "Resume" })).toBeFocused();
  await expect(page.getByRole("region", { name: "Settings" }).getByRole("alert")).toHaveCount(0);
});

test("Ollama installed but not running says so, and what to do", async ({ page }) => {
  await openModels(page, () => {
    Object.assign(window.__VERSORIUM_MOCK__.ollama, { running: false, installed: true });
  });
  const ollama = page.getByRole("button", { name: /^Ollama, / });
  await expect(ollama).toHaveAccessibleName("Ollama, Installed, not running");
  await ollama.click();
  const panel = page.locator("#models-ollama-panel");
  await expect(panel.getByText("Start Ollama, then check again.")).toBeVisible();
  await expect(panel.getByText(/If you install Ollama/)).toHaveCount(0);
  await expect(panel.getByLabel("Get a model by name")).toHaveCount(0);
});

test("a connection test on an address with nothing on it says so", async ({ page }) => {
  await openModels(page);
  await page.getByRole("button", { name: /^Local server, / }).click();
  const panel = page.locator("#models-server-panel");
  const port = panel.getByRole("spinbutton", { name: "Port" });
  await port.fill("8080");
  await port.blur();
  await panel.getByRole("button", { name: "Test connection" }).click();
  await expect(panel.getByText("No answer on that address.")).toBeVisible();
  await expect(panel.getByText("Answered.")).toHaveCount(0);
});

test("forgetting the server forgets what was saved, and never saves what was only typed", async ({ page }) => {
  await openModels(page, () => {
    window.__VERSORIUM_MOCK__.studio.enabled = true;
  });
  await page.getByRole("button", { name: /^Local server, / }).click();
  const panel = page.locator("#models-server-panel");
  await panel.getByRole("textbox", { name: "Address" }).fill("10.0.0.9");
  await panel.getByRole("button", { name: "Forget" }).click();
  await expect(page.getByRole("button", { name: /^Local server, / })).toHaveAccessibleName("Local server, Not set up");
  const forgot = await page.evaluate(() => window.__VERSORIUM_MOCK__.calls.filter((c) => c.cmd === "studio_save").at(-1)?.args);
  expect(forgot).toMatchObject({ host: "127.0.0.1", port: 1234, enabled: false });
  expect(await page.evaluate(() => window.__VERSORIUM_MOCK__.studio.host)).toBe("127.0.0.1");
});

test("saving the server at another computer's address releases its tasks, and says so", async ({ page }) => {
  await openModels(page, () => {
    const mock = window.__VERSORIUM_MOCK__;
    mock.studio.enabled = true;
    mock.slots.rewrite = { kind: "server", id: "local-model" };
  });
  await page.getByRole("button", { name: /^Local server, / }).click();
  const panel = page.locator("#models-server-panel");

  // Another port on this computer: the task stays.
  const port = panel.getByRole("spinbutton", { name: "Port" });
  await port.fill("1235");
  await port.blur();
  await panel.getByRole("button", { name: "Save" }).click();
  await expect.poll(async () => page.evaluate(() => window.__VERSORIUM_MOCK__.studio.port)).toBe(1235);
  expect((await mockSlots(page)).rewrite).toEqual({ kind: "server", id: "local-model" });

  // Another computer: the passage would go there unchosen, so the task is released.
  await panel.getByRole("textbox", { name: "Address" }).fill("192.168.1.20");
  await panel.getByRole("button", { name: "Save" }).click();
  await expect.poll(async () => (await mockSlots(page)).rewrite.kind).toBe("none");
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText(
    "Rewrite no longer uses the server: 192.168.1.20:1235 is another computer. Choose it again in Tasks to use it there.",
  );
  await expect(panel.getByText(/That address is not this computer/)).toBeVisible();
});

test("a disclosure stays as it was left while Settings is open", async ({ page }) => {
  await openModels(page);
  const about = page.getByRole("button", { name: "About this computer" });
  await about.click();
  await expect(about).toHaveAttribute("aria-expanded", "true");
  await rail(page).getByRole("button", { name: "Tasks", exact: true }).click();
  await rail(page).getByRole("button", { name: "Models", exact: true }).click();
  await expect(page.getByRole("button", { name: "About this computer" })).toHaveAttribute("aria-expanded", "true");
});

test("hiding uncensored models takes effect at once (C4)", async ({ page }) => {
  const settings = await openModels(page);
  const shown = settings.getByRole("checkbox", { name: "Show uncensored models", exact: true });
  await expect(shown).toBeChecked();
  await expect(catalogue(page, "Dolphin 24B")).toHaveCount(1);
  await shown.uncheck();
  // Without leaving the page: it used to wait for the next visit.
  await expect(catalogue(page, "Dolphin 24B")).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => window.__VERSORIUM_MOCK__.settings.censorship)).toBe(true);
});

test("the embedding model is listed as unused and never offered for a task (C6)", async ({ page }) => {
  await openModels(page);
  await expect(yours(page, "Nomic Embed")).toContainText("Not used: search by meaning isn't built yet.");
  await rail(page).getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Model for Rewrite" }).locator("option", { hasText: "Nomic" })).toHaveCount(0);
});

test("a first run offers one recommended download, and then the model it brought", async ({ page }) => {
  const settings = await openModels(page, nothingReady, "/?mock=tauri&agents=none");
  await expect(settings.getByText(/^To start, download Qwen3 4B Instruct/)).toBeVisible();
  const start = settings.getByRole("button", { name: "Download Qwen3 4B Instruct" });
  // The page's one primary action.
  await expect(settings.locator(".v-btn-primary")).toHaveCount(1);
  await expect(settings.locator(".v-btn-primary")).toHaveText("Download Qwen3 4B Instruct");

  await start.click();
  // Done: the callout goes, and focus moves on to what the new model can do.
  const use = settings.getByRole("button", { name: "Use for Rewrite and Continuity" });
  await expect(use).toBeFocused({ timeout: 10_000 });
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Qwen3 4B Instruct is ready.");
  await expect(settings.getByText(/^To start, download/)).toHaveCount(0);
});

test("Models is translated", async ({ page }) => {
  await page.goto("/?mock=tauri");
  await page.getByRole("contentinfo").getByRole("button", { name: "ES", exact: true }).click();
  await page.getByRole("banner").getByRole("button", { name: "Ajustes" }).click();
  const settings = page.getByRole("region", { name: "Ajustes" });
  await settings.getByRole("navigation").getByRole("button", { name: "Modelos", exact: true }).click();
  await expect(settings.getByRole("heading", { name: "Modelos", level: 2 })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Tus modelos" })).toBeVisible();
  await expect(settings.getByRole("heading", { name: "Para descargar" })).toBeVisible();
  await expect(settings.getByText("Mediano · 2.5 GB · Cabe en este equipo")).toBeVisible();
  await expect(settings.getByRole("button", { name: "Descargar", exact: true }).first()).toBeVisible();
  await expect(settings.getByRole("checkbox", { name: "Mostrar modelos sin censura", exact: true })).toBeChecked();
});
