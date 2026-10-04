import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, type LocalAiView, type ModelCard, type Slots } from "$lib/tauri";
import { ModelsStore, humanSize, percent } from "./state.svelte";

vi.mock("$lib/tauri", () => ({
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
}));

const card = (over: Partial<ModelCard> = {}): ModelCard => ({
  id: "qwen3-4b",
  family: "Qwen",
  label: "Qwen3 4B Instruct",
  task: "writing",
  tier: "mid",
  params: "4B",
  quant: "Q4_K_M",
  sizeBytes: 2_500_000_000,
  ramHintGB: 3.5,
  ctx: 32768,
  speed: "balanced",
  quality: "good",
  badge: "Balanced",
  uncensored: false,
  license: "apache-2.0",
  repo: "Qwen/Qwen3-4B-GGUF",
  state: "missing",
  receivedBytes: 0,
  fits: true,
  ...over,
});

const slots = (): Slots => ({
  rewrite: { kind: "none", id: "" },
  chat: { kind: "none", id: "" },
  continuity: { kind: "none", id: "" },
  embeddings: { kind: "none", id: "" },
  dictation: { kind: "none", id: "" },
});

const view = (over: Partial<LocalAiView> = {}): LocalAiView => ({
  models: [card()],
  hardware: {
    totalRamGb: 32,
    availableRamGb: 12,
    cpuCores: 10,
    arch: "aarch64",
    os: "macos",
    gpu: "Apple unified memory",
    recommendedTier: "midPlus",
  },
  slots: slots(),
  progress: null,
  ollama: { running: true, models: [{ name: "qwen3:4b", sizeBytes: 1, modified: "now" }], installed: true },
  studio: { host: "127.0.0.1", port: 1234, enabled: false, running: false, models: [] },
  censorship: false,
  diskUsedBytes: 0,
  modelsDir: "/data/models",
  ...over,
});

let store: ModelsStore;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  store = new ModelsStore();
  vi.mocked(api.modelsView).mockResolvedValue(view());
});
afterEach(() => {
  store.dispose();
  vi.useRealTimers();
});

it("loads the view", async () => {
  await store.load();
  expect(store.models[0].label).toBe("Qwen3 4B Instruct");
  expect(store.view?.hardware.recommendedTier).toBe("midPlus");
  expect(store.error).toBeNull();
  expect(store.loading).toBe(false);
});

it("hides uncensored models only while censorship is on", async () => {
  vi.mocked(api.modelsView).mockResolvedValue(
    view({ models: [card(), card({ id: "spicy", uncensored: true })], censorship: true }),
  );
  await store.load();
  expect(store.writing.map((m) => m.id)).toEqual(["qwen3-4b"]);

  vi.mocked(api.modelsView).mockResolvedValue(
    view({ models: [card(), card({ id: "spicy", uncensored: true })], censorship: false }),
  );
  await store.load();
  expect(store.writing.map((m) => m.id)).toEqual(["qwen3-4b", "spicy"]);
});

it("the poll runs DURING the download, which is the only time it is useful", async () => {
  await store.load();
  // `models_download` does not resolve until the file is on disk. Polling used
  // to start after that await — the moment the download finished — so the panel
  // showed nothing at all for the whole transfer.
  let finish: () => void = () => {};
  vi.mocked(api.modelsDownload).mockReturnValue(new Promise<void>((r) => (finish = r)));
  vi.mocked(api.modelsProgress).mockResolvedValue({ id: "qwen3-4b", received: 10, total: 100, done: false });

  const running = store.download("qwen3-4b");

  // Seeded before the first poll, because 700ms of a dead button reads as broken.
  expect(store.view?.progress?.id).toBe("qwen3-4b");

  await vi.advanceTimersByTimeAsync(700);
  expect(api.modelsProgress).toHaveBeenCalledTimes(1);
  expect(store.view?.progress?.received).toBe(10);

  await vi.advanceTimersByTimeAsync(700);
  expect(api.modelsProgress).toHaveBeenCalledTimes(2);

  finish();
  await running;

  // The download is over, so there is nothing left to ask about.
  await vi.advanceTimersByTimeAsync(2100);
  expect(api.modelsProgress).toHaveBeenCalledTimes(2);
});

it("a download that finishes mid-poll stops the interval itself", async () => {
  await store.load();
  let finish: () => void = () => {};
  vi.mocked(api.modelsDownload).mockReturnValue(new Promise<void>((r) => (finish = r)));
  vi.mocked(api.modelsProgress).mockResolvedValue({ id: "qwen3-4b", received: 100, total: 100, done: true });

  const running = store.download("qwen3-4b");
  await vi.advanceTimersByTimeAsync(700);
  expect(api.modelsProgress).toHaveBeenCalledTimes(1);

  // `done` came back, so the poller stands down without waiting for the command.
  await vi.advanceTimersByTimeAsync(2100);
  expect(api.modelsProgress).toHaveBeenCalledTimes(1);
  finish();
  await running;
});

it("a download never holds the store busy, and Cancel works while it runs", async () => {
  await store.load();
  let finish: () => void = () => {};
  vi.mocked(api.modelsDownload).mockReturnValue(new Promise<void>((r) => (finish = r)));
  vi.mocked(api.modelsProgress).mockResolvedValue({ id: "qwen3-4b", received: 10, total: 100, done: false });

  const running = store.download("qwen3-4b");
  // A download used to hold `loading` for its whole length, which dropped
  // every other change made meanwhile (tests/unit/models-store.test.ts). It
  // has its own state now.
  expect(store.loading).toBe(false);
  expect(store.downloadingId).toBe("qwen3-4b");
  // Cancel used to be routed through that same guard, so it was dead for
  // exactly as long as it was the only button on screen.
  await store.cancel("qwen3-4b");
  expect(api.modelsCancel).toHaveBeenCalledWith("qwen3-4b");

  finish();
  await running;
  expect(store.downloadingId).toBeNull();
});

it("a failed download localizes the error and keeps the previous view", async () => {
  await store.load();
  vi.mocked(api.modelsDownload).mockRejectedValue("download_busy");
  await store.download("qwen3-4b");
  // Real dictionary, so this also pins the locale key existing.
  expect(store.error).toBe("Another model is already downloading. Wait for it to finish.");
  expect(store.models[0].state).toBe("missing");
  expect(store.loading).toBe(false);
});

it("setSlot adopts the slots Rust returns", async () => {
  await store.load();
  vi.mocked(api.modelsSetSlot).mockResolvedValue({ ...slots(), rewrite: { kind: "builtin", id: "qwen3-4b" } });
  await store.setSlot("rewrite", "builtin", "qwen3-4b");
  expect(api.modelsSetSlot).toHaveBeenCalledWith("rewrite", "builtin", "qwen3-4b");
  expect(store.view?.slots.rewrite).toEqual({ kind: "builtin", id: "qwen3-4b" });
});

it("disposing leaves no interval behind", async () => {
  await store.load();
  vi.mocked(api.modelsDownload).mockResolvedValue(undefined);
  vi.mocked(api.modelsProgress).mockResolvedValue({ id: "qwen3-4b", received: 1, total: 100, done: false });
  await store.download("qwen3-4b");

  store.dispose();
  const calls = vi.mocked(api.modelsProgress).mock.calls.length;
  await vi.advanceTimersByTimeAsync(3000);
  expect(api.modelsProgress).toHaveBeenCalledTimes(calls);
});

it("reopening the panel revives a disposed store", async () => {
  await store.load();
  store.dispose();

  // Closing Settings and opening it again must poll like the first time.
  await store.load();
  let finish: () => void = () => {};
  vi.mocked(api.modelsDownload).mockReturnValue(new Promise<void>((r) => (finish = r)));
  vi.mocked(api.modelsProgress).mockResolvedValue({ id: "qwen3-4b", received: 5, total: 100, done: false });
  const running = store.download("qwen3-4b");
  await vi.advanceTimersByTimeAsync(700);
  expect(api.modelsProgress).toHaveBeenCalled();
  finish();
  await running;
});

it("formats sizes and percentages without lying", () => {
  expect(humanSize(512)).toBe("512 B");
  // Under 10 keeps a decimal, at or above it rounds — "2.3 GB" is useful, "28.6 MB" is noise.
  expect(humanSize(2_500_000_000)).toBe("2.3 GB");
  expect(humanSize(30_000_000)).toBe("29 MB");
  expect(humanSize(5_000_000)).toBe("4.8 MB");
  expect(percent(50, 100)).toBe(50);
  // A missing or zero total must not render NaN.
  expect(percent(10, 0)).toBe(0);
  expect(percent(200, 100)).toBe(100);
});
