import { beforeEach, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { api, type LocalAiView } from "$lib/tauri";
import LocalAiSection from "./LocalAiSection.svelte";
import { models } from "$lib/models/state.svelte";

vi.mock("$lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("$lib/tauri")>("$lib/tauri");
  return {
    ...actual,
    api: {
      modelsView: vi.fn(),
      modelsDownload: vi.fn(),
      modelsCancel: vi.fn(),
      modelsDelete: vi.fn(),
      modelsProgress: vi.fn(),
      modelsSetSlot: vi.fn(),
      ollamaPull: vi.fn(),
      ollamaRemove: vi.fn(),
      studioTest: vi.fn(),
      studioSave: vi.fn(),
    },
    isTauri: () => true,
  };
});

const view: LocalAiView = {
  models: [
    {
      id: "gemma3-1b", family: "Gemma", label: "Gemma 3 1B", task: "writing", tier: "low",
      params: "1B", quant: "Q4_K_M", sizeBytes: 1_000_000_000, ramHintGB: 2, ctx: 8192,
      speed: "fast", quality: "basic", badge: null, uncensored: false,
      license: "gemma", repo: "google/gemma-3-1b", state: "missing", receivedBytes: 0, fits: true,
    },
    {
      id: "qwen3-4b", family: "Qwen", label: "Qwen3 4B Instruct", task: "writing", tier: "mid",
      params: "4B", quant: "Q4_K_M", sizeBytes: 2_500_000_000, ramHintGB: 3.5, ctx: 32768,
      speed: "balanced", quality: "good", badge: "Balanced", uncensored: false,
      license: "apache-2.0", repo: "Qwen/Qwen3-4B-GGUF", state: "ready", receivedBytes: 0, fits: true,
    },
  ],
  hardware: {
    totalRamGb: 32, availableRamGb: 12, cpuCores: 10, arch: "aarch64",
    os: "macos", gpu: "Apple unified memory", recommendedTier: "mid",
  },
  slots: {
    rewrite: { kind: "builtin", id: "qwen3-4b" },
    chat: { kind: "none", id: "" },
    continuity: { kind: "none", id: "" },
    embeddings: { kind: "none", id: "" },
    dictation: { kind: "none", id: "" },
  },
  progress: null,
  ollama: { running: true, models: [{ name: "qwen3:4b", sizeBytes: 2_600_000_000, modified: "2026-09-01T00:00:00Z" }], installed: true },
  studio: { host: "127.0.0.1", port: 1234, enabled: false },
  censorship: false,
  diskUsedBytes: 2_500_000_000,
  modelsDir: "/data/models",
};

async function render() {
  const target = document.createElement("div");
  document.body.append(target);
  const app = mount(LocalAiSection, { target });
  flushSync();
  await vi.waitFor(() => expect(target.textContent).toContain("Qwen3 4B Instruct"));
  flushSync();
  return { target, app };
}

beforeEach(() => {
  vi.clearAllMocks();
  models.view = null;
  models.error = null;
  vi.mocked(api.modelsView).mockResolvedValue(view);
});

it("renders the ladder, the wizard and the per-task slots", async () => {
  const { target, app } = await render();

  // The row says what it takes to decide: name, badge, size, what it is for.
  expect(target.textContent).toContain("Balanced");
  expect(target.textContent).toContain("2.3 GB");
  // The rest is folded away, because a catalogue of eleven models rendered in
  // full is a scroll, not a list.
  expect(target.textContent).not.toContain("Q4_K_M");
  const details = [...target.querySelectorAll<HTMLButtonElement>("button")].filter(
    (b) => b.textContent?.trim() === "Details",
  );
  expect(details.length).toBe(2);
  details[1].click();
  flushSync();
  expect(target.textContent).toContain("Q4_K_M");
  expect(target.textContent).toContain("needs 3.5 GB RAM");
  // A slot points at it, so it reads Selected rather than merely Ready.
  expect(target.textContent).toContain("Selected");
  // The untouched one offers a download.
  expect(target.querySelector("button.v-btn-primary")?.textContent?.trim()).toBe("Download");
  // The wizard states a recommendation without acting on it.
  expect(target.textContent).toContain("balanced pack is the largest that fits");
  expect(api.modelsDownload).not.toHaveBeenCalled();

  // The task list leads the panel now, so the picker is above the catalogue
  // rather than buried under it.
  const slotSelect = [...target.querySelectorAll<HTMLSelectElement>("select")].find(
    (el) => el.labels?.[0]?.textContent?.trim() === "Rewrite",
  );
  expect(slotSelect?.value).toBe("builtin:qwen3-4b");
  // Only downloaded models may be picked.
  expect([...(slotSelect?.querySelectorAll("option") ?? [])].map((o) => o.value)).toEqual([
    "none",
    "builtin:qwen3-4b",
    "ollama:qwen3:4b",
  ]);

  await unmount(app);
  target.remove();
});

it("switches tabs and keeps exactly one panel visible", async () => {
  const { target, app } = await render();
  const tabs = [...target.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    // Named for what they are — sources of models — rather than for tasks.
  // "Writing" collided with the Writing settings group, and "Studio" meant
  // nothing on its own.
  expect(tabs.map((b) => b.textContent?.trim())).toEqual([
    "Built in",
    "Ollama",
    "Local server",
    "Dictation",
  ]);
  expect(tabs[0].getAttribute("aria-selected")).toBe("true");

  const panels = () => [...target.querySelectorAll<HTMLElement>('[role="tabpanel"]')].filter((p) => !p.hidden);
  expect(panels()).toHaveLength(1);

  tabs[1].click();
  flushSync();
  expect(tabs[1].getAttribute("aria-selected")).toBe("true");
  expect(panels()).toHaveLength(1);
  expect(panels()[0].id).toBe("localai-panel-ollama");
  expect(target.textContent).toContain("qwen3:4b");

  // Arrow keys move along the tablist, as a tablist is expected to.
  tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  flushSync();
  expect(panels()[0].id).toBe("localai-panel-studio");

  await unmount(app);
  target.remove();
});

it("hides uncensored models while censorship is on", async () => {
  vi.mocked(api.modelsView).mockResolvedValue({
    ...view,
    censorship: true,
    models: [...view.models, { ...view.models[0], id: "spicy", label: "Spicy 7B", uncensored: true }],
  });
  const { target, app } = await render();
  expect(target.textContent).not.toContain("Spicy 7B");
  await unmount(app);
  target.remove();
});

it("deleting asks first", async () => {
  const { target, app } = await render();
  const deleteButton = [...target.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Delete");
  deleteButton?.click();
  flushSync();
  expect(target.textContent).toContain("Delete for good?");
  expect(api.modelsDelete).not.toHaveBeenCalled();

  [...target.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Delete for good?")?.click();
  flushSync();
  expect(api.modelsDelete).toHaveBeenCalledWith("qwen3-4b");

  await unmount(app);
  target.remove();
});

it("finding a model does not mean scrolling past every model", async () => {
  const { target, app } = await render();
  // Scoped to the panel: the slot pickers at the bottom list every ready model
  // by name, and matching those would make the filter look broken.
  const panel = target.querySelector("#localai-panel-writing")!;
  const showing = () => panel.textContent?.match(/Showing (\d+) of (\d+)/)?.slice(1, 3);
  expect(showing()).toEqual(["2", "2"]);

  const search = target.querySelector<HTMLInputElement>('input[type="search"]')!;
  search.value = "gemma";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
  expect(showing()).toEqual(["1", "2"]);
  expect(panel.textContent).not.toContain("Qwen3 4B Instruct");

  // A family chip is the same question asked the other way round.
  search.value = "";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
  const qwen = [...target.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === "Qwen",
  )!;
  qwen.click();
  flushSync();
  expect(panel.textContent).not.toContain("Gemma 3 1B");
  expect(qwen.getAttribute("aria-pressed")).toBe("true");

  await unmount(app);
  target.remove();
});

it("a search that matches nothing says so instead of showing an empty list", async () => {
  const { target, app } = await render();
  const search = target.querySelector<HTMLInputElement>('input[type="search"]')!;
  search.value = "llama";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
  // Distinct from "the catalogue is empty", which is a different problem with a
  // different fix.
  expect(target.textContent).toContain("No model matches that");
  expect(target.textContent).not.toContain("Nothing downloads on its own. Pick a model when you want it. Empty");

  await unmount(app);
  target.remove();
});

it("sorting by size reorders the list rather than filtering it", async () => {
  const { target, app } = await render();
  const names = () =>
    [...target.querySelectorAll("#localai-panel-writing li.v-card b")].map((b) => b.textContent?.trim());
  expect(names()).toEqual(["Gemma 3 1B", "Qwen3 4B Instruct"]);

  const sort = target.querySelector<HTMLSelectElement>('select[aria-label="Sort"]')!;
  sort.value = "largest";
  sort.dispatchEvent(new Event("change", { bubbles: true }));
  flushSync();
  expect(names()).toEqual(["Qwen3 4B Instruct", "Gemma 3 1B"]);

  await unmount(app);
  target.remove();
});
