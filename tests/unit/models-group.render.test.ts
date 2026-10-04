import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { api, type LocalAiView, type ModelCard } from "$lib/tauri";
import ModelsGroup from "$lib/settings/groups/ModelsGroup.svelte";
import { models } from "$lib/models/state.svelte";

// Settings → Models, rendered in jsdom against a scripted backend: finding a
// model in the catalogue, the one Recommended, the delete that asks first,
// and the uncensored checkbox whose name is only its label (SPEC C4).

vi.mock("$lib/tauri", async (actual) => ({
  ...(await actual<typeof import("$lib/tauri")>()),
  isTauri: () => true,
  api: {
    modelsView: vi.fn(),
    modelsDownload: vi.fn(),
    modelsCancel: vi.fn(),
    modelsDelete: vi.fn(async () => undefined),
    modelsProgress: vi.fn(async () => null),
    modelsSetSlot: vi.fn(),
    ollamaPull: vi.fn(),
    ollamaRemove: vi.fn(),
    studioTest: vi.fn(),
    studioSave: vi.fn(),
    setSettings: vi.fn(async () => ({})),
    llamaBackend: vi.fn(async () => ({ state: "ready", device: null, gpuOffload: true })),
  },
}));

// jsdom has no CSS.escape; the page finds a model's row with it.
globalThis.CSS ??= {} as typeof CSS;
CSS.escape ??= (value: string) => value.replace(/["\\]/g, "\\$&");

const card = (over: Partial<ModelCard>): ModelCard => ({
  id: "m", family: "Qwen", label: "M", task: "writing", tier: "mid", params: "4B", quant: "Q4_K_M",
  sizeBytes: 2_500_000_000, ramHintGB: 3.5, ctx: 32768, speed: "balanced", quality: "good", badge: null,
  uncensored: false, license: "apache-2.0", repo: "r", state: "missing", receivedBytes: 0, fits: true,
  ...over,
});

const view: LocalAiView = {
  models: [
    card({ id: "gemma3-1b", family: "Gemma", label: "Gemma 3 1B", tier: "low", sizeBytes: 800_000_000, state: "ready" }),
    card({ id: "qwen3-4b", label: "Qwen3 4B Instruct" }),
    card({ id: "qwen35-4b", label: "Qwen3.5 4B", sizeBytes: 3_000_000_000 }),
    card({ id: "dolphin-24b", family: "Dolphin", label: "Dolphin 24B", tier: "high", sizeBytes: 14_000_000_000, uncensored: true, fits: false }),
    card({ id: "nomic", family: "Nomic", label: "Nomic Embed", task: "embeddings", tier: "low", sizeBytes: 84_000_000, state: "ready" }),
  ],
  hardware: {
    totalRamGb: 16, availableRamGb: 8, cpuCores: 10, arch: "aarch64", os: "macos",
    gpu: "Metal (Apple M2)", recommendedTier: "mid",
  },
  slots: {
    rewrite: { kind: "none", id: "" },
    chat: { kind: "none", id: "" },
    continuity: { kind: "none", id: "" },
    embeddings: { kind: "none", id: "" },
    dictation: { kind: "none", id: "" },
  },
  progress: null,
  ollama: { running: false, models: [], installed: false },
  studio: { host: "127.0.0.1", port: 1234, enabled: false, running: false, models: [] },
  censorship: false,
  diskUsedBytes: 800_000_000,
  modelsDir: "/data/models",
};

let app: Record<string, unknown> | undefined;
let target: HTMLElement;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(api.modelsView).mockResolvedValue(structuredClone(view));
  models.view = null;
  models.error = null;
  await models.load();
  target = document.createElement("div");
  document.body.append(target);
  app = mount(ModelsGroup, { target });
  flushSync();
});

afterEach(async () => {
  if (app) await unmount(app);
  app = undefined;
  target.remove();
});

const available = () => target.querySelector<HTMLElement>('ul[aria-labelledby="models-available-title"]');
const availableNames = () => [...(available()?.querySelectorAll("li b") ?? [])].map((b) => b.textContent?.trim());
const showing = () => target.textContent?.match(/Showing (\d+) of (\d+)/)?.slice(1, 3);

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
}

function choose(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  flushSync();
}

const labelled = <T extends HTMLElement>(text: string): T => {
  const label = [...target.querySelectorAll("label")].find((l) => l.textContent?.trim() === text);
  if (!label) throw new Error(`no label ${text}`);
  return document.getElementById(label.htmlFor) as T;
};

it("lists only what is not on this computer, and finds a model by search, family and sort", () => {
  expect(availableNames()).toEqual(["Qwen3 4B Instruct", "Qwen3.5 4B", "Dolphin 24B"]);
  expect(showing()).toEqual(["3", "3"]);

  type(labelled<HTMLInputElement>("Search models"), "qwen3.5");
  expect(availableNames()).toEqual(["Qwen3.5 4B"]);
  expect(showing()).toEqual(["1", "3"]);

  type(labelled<HTMLInputElement>("Search models"), "");
  choose(labelled<HTMLSelectElement>("Family"), "Dolphin");
  expect(availableNames()).toEqual(["Dolphin 24B"]);

  choose(labelled<HTMLSelectElement>("Family"), "all");
  choose(labelled<HTMLSelectElement>("Sort"), "largest");
  expect(availableNames()).toEqual(["Dolphin 24B", "Qwen3.5 4B", "Qwen3 4B Instruct"]);
});

it("says when nothing matches, rather than showing an empty list", () => {
  type(labelled<HTMLInputElement>("Search models"), "llama");
  expect(target.textContent).toContain("No model matches that. Clear the search or the filters.");
  expect(available()).toBeNull();
});

it("marks exactly one Recommended, and never the uncensored one", () => {
  const tagged = [...(available()?.querySelectorAll("li") ?? [])].filter((li) =>
    [...li.querySelectorAll(".v-tag")].some((tag) => tag.textContent?.trim() === "Recommended"),
  );
  expect(tagged).toHaveLength(1);
  expect(tagged[0].querySelector("b")?.textContent?.trim()).toBe("Qwen3 4B Instruct");
});

it("asks before it deletes, and the embedding model says it is not used", async () => {
  const gemma = [...target.querySelectorAll("li")].find((li) => li.querySelector("b")?.textContent?.trim() === "Gemma 3 1B")!;
  const button = (text: string) => [...gemma.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);
  button("Delete")!.click();
  flushSync();
  expect(api.modelsDelete).not.toHaveBeenCalled();
  button("Delete for good?")!.click();
  await vi.waitFor(() => expect(api.modelsDelete).toHaveBeenCalledWith("gemma3-1b"));

  expect(target.textContent).toContain("Not used: search by meaning isn't built yet.");
});

it("the uncensored checkbox is named by its label alone, its hint describes it, and it acts at once", async () => {
  const box = labelled<HTMLInputElement>("Show uncensored models");
  expect(box.type).toBe("checkbox");
  expect(box.checked).toBe(true);
  // The name is the label element's text and nothing else: no "— On" after it.
  const label = target.querySelector(`label[for="${box.id}"]`);
  expect(label?.textContent).toBe("Show uncensored models");
  const hint = document.getElementById(box.getAttribute("aria-describedby") ?? "");
  expect(hint?.textContent).toBe("Uncensored models have their safety filter removed. Hiding them changes nothing else.");

  box.click();
  flushSync();
  // C4: the list follows before the save answers.
  expect(availableNames()).toEqual(["Qwen3 4B Instruct", "Qwen3.5 4B"]);
  expect(api.setSettings).toHaveBeenCalledWith({ censorship: true });
  await vi.waitFor(() => expect(labelled<HTMLInputElement>("Show uncensored models").checked).toBe(false));
});

/** Mount the page again over another view: a state the shared one does not have. */
async function remount(next: LocalAiView): Promise<void> {
  if (app) await unmount(app);
  vi.mocked(api.modelsView).mockResolvedValue(structuredClone(next));
  await models.load();
  app = mount(ModelsGroup, { target });
  flushSync();
}

/** A button by its words; a disclosure's ▸ / ▾ is hidden from its name, and so not compared. */
const button = (scope: ParentNode, text: string) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.replace(/[▸▾]/g, "").trim() === text);
const rowOf = (name: string) =>
  [...target.querySelectorAll<HTMLElement>("li")].find((li) => li.querySelector("b")?.textContent?.trim() === name);
const withModels = (...extra: ModelCard[]): LocalAiView => ({ ...view, models: [...view.models, ...extra] });

it("Only models that fit hides the ones that do not, and each order is its own", async () => {
  // A Small model larger than a Medium one tells "Recommended" (size word
  // first) from "Smallest first" (bytes only).
  await remount(withModels(card({ id: "llama-big", family: "Llama", label: "Big Llama", tier: "low", sizeBytes: 4_000_000_000 })));
  expect(availableNames()).toEqual(["Big Llama", "Qwen3 4B Instruct", "Qwen3.5 4B", "Dolphin 24B"]);

  const fits = labelled<HTMLInputElement>("Only models that fit");
  fits.click();
  flushSync();
  expect(availableNames()).toEqual(["Big Llama", "Qwen3 4B Instruct", "Qwen3.5 4B"]);
  expect(showing()).toEqual(["3", "4"]);
  fits.click();
  flushSync();

  const sort = labelled<HTMLSelectElement>("Sort");
  choose(sort, "smallest");
  expect(availableNames()).toEqual(["Qwen3 4B Instruct", "Qwen3.5 4B", "Big Llama", "Dolphin 24B"]);
  choose(sort, "largest");
  expect(availableNames()).toEqual(["Dolphin 24B", "Big Llama", "Qwen3.5 4B", "Qwen3 4B Instruct"]);
  choose(sort, "name");
  expect(availableNames()).toEqual(["Big Llama", "Dolphin 24B", "Qwen3 4B Instruct", "Qwen3.5 4B"]);
});

it("a damaged download says so and can be fetched again; a paused one can be resumed", async () => {
  // Done at once: the store is shared, and a download left running would hold the next test.
  vi.mocked(api.modelsDownload).mockResolvedValue(undefined);
  await remount({
    ...view,
    models: view.models.map((m) =>
      m.id === "qwen3-4b" ? { ...m, state: "corrupt" } : m.id === "qwen35-4b" ? { ...m, state: "partial", receivedBytes: 1_000_000_000 } : m,
    ),
  });
  const damaged = rowOf("Qwen3 4B Instruct")!;
  expect(damaged.textContent).toContain("The download is damaged.");
  button(damaged, "Download again")!.click();
  await vi.waitFor(() => expect(api.modelsDownload).toHaveBeenCalledWith("qwen3-4b"));
  await vi.waitFor(() => expect(models.downloadingId).toBeNull());
  flushSync();

  const paused = rowOf("Qwen3.5 4B")!;
  expect(paused.textContent).toContain("Paused at 954 MB of 2.8 GB");
  vi.mocked(api.modelsDownload).mockClear();
  button(rowOf("Qwen3.5 4B")!, "Resume")!.click();
  await vi.waitFor(() => expect(api.modelsDownload).toHaveBeenCalledWith("qwen35-4b"));
  await vi.waitFor(() => expect(models.downloadingId).toBeNull());
});

it("on a first run, a half-downloaded recommended model is resumed, not started over", async () => {
  await remount({
    ...view,
    models: view.models.map((m) =>
      m.id === "gemma3-1b" ? { ...m, state: "missing" } : m.id === "qwen3-4b" ? { ...m, state: "partial", receivedBytes: 500_000_000 } : m,
    ),
  });
  expect(target.textContent).toContain("To start, download Qwen3 4B Instruct");
  expect(button(target, "Resume Qwen3 4B Instruct")?.classList.contains("v-btn-primary")).toBe(true);
  expect(button(target, "Download Qwen3 4B Instruct")).toBeUndefined();
});

it("with every model downloaded, says so rather than showing an empty list", async () => {
  await remount({ ...view, models: view.models.map((m) => ({ ...m, state: "ready" as const })) });
  expect(target.textContent).toContain("Every model in the catalogue is already on this computer.");
  expect(target.textContent).not.toContain("No model matches that.");
  expect(available()).toBeNull();
});

it("a downloaded model too large for this computer says the tasks will refuse it", async () => {
  await remount({ ...view, models: view.models.map((m) => (m.id === "gemma3-1b" ? { ...m, fits: false } : m)) });
  expect(rowOf("Gemma 3 1B")?.textContent).toContain("Needs more memory than this computer has, so tasks will refuse it.");
  await remount(view);
  expect(rowOf("Gemma 3 1B")?.textContent).not.toContain("Needs more memory");
});

it("About this computer says when models run on the processor only, and Check again asks again", async () => {
  vi.mocked(api.llamaBackend).mockResolvedValue({ state: "ready", device: null, gpuOffload: false });
  await remount(view);
  const about = button(target, "About this computer")!;
  if (about.getAttribute("aria-expanded") !== "true") about.click();
  flushSync();
  await vi.waitFor(() =>
    expect(target.textContent).toContain("This build runs models on the processor, without graphics acceleration"),
  );

  vi.mocked(api.modelsView).mockClear();
  vi.mocked(api.llamaBackend).mockClear();
  button(target, "Check again")!.click();
  await vi.waitFor(() => expect(api.llamaBackend).toHaveBeenCalled());
  expect(api.modelsView).toHaveBeenCalled();
  vi.mocked(api.llamaBackend).mockResolvedValue({ state: "ready", device: null, gpuOffload: true });
});

it("every disclosure and expander names the region it opens", () => {
  const toggles = [...target.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")];
  // About this computer, a Details per model, Ollama and the local server.
  expect(toggles.length).toBeGreaterThanOrEqual(4);
  for (const toggle of toggles) {
    const region = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(region, `${toggle.textContent?.trim()} controls nothing`).not.toBeNull();
    expect(region?.hidden).toBe(toggle.getAttribute("aria-expanded") !== "true");
  }
});
