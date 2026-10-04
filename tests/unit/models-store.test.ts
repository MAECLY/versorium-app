import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, type LocalAiView, type ModelCard, type Slots } from "$lib/tauri";
import { ModelsStore } from "$lib/models/state.svelte";

// Two bugs the Settings redesign found in the models store (SPEC C4, C5):
// a download used to hold the store's one busy flag for the whole transfer,
// so every other change made meanwhile was dropped without a word; and hiding
// uncensored models changed nothing on screen until the page was left.

vi.mock("$lib/tauri", () => ({
  api: {
    modelsView: vi.fn(),
    modelsDownload: vi.fn(),
    modelsCancel: vi.fn(),
    modelsProgress: vi.fn(),
    modelsSetSlot: vi.fn(),
    ollamaPull: vi.fn(),
    setSettings: vi.fn(),
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
  badge: null,
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
  models: [card(), card({ id: "gemma3-1b", label: "Gemma 3 1B", tier: "low", state: "ready" })],
  hardware: {
    totalRamGb: 16, availableRamGb: 8, cpuCores: 8, arch: "aarch64", os: "macos",
    gpu: "Metal (Apple M2)", recommendedTier: "mid",
  },
  slots: slots(),
  progress: null,
  ollama: { running: false, models: [], installed: false },
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
  vi.mocked(api.modelsProgress).mockResolvedValue({ id: "qwen3-4b", received: 1, total: 100, done: false });
});
afterEach(() => {
  store.dispose();
  vi.useRealTimers();
});

it("a choice of model goes through while a download is running (C5)", async () => {
  await store.load();
  let finish: () => void = () => {};
  vi.mocked(api.modelsDownload).mockReturnValue(new Promise<void>((r) => (finish = r)));
  vi.mocked(api.modelsSetSlot).mockResolvedValue({ ...slots(), rewrite: { kind: "builtin", id: "gemma3-1b" } });

  const running = store.download("qwen3-4b");
  // The download says which model it is, and holds nothing else.
  expect(store.downloadingId).toBe("qwen3-4b");
  expect(store.loading).toBe(false);

  await store.setSlot("rewrite", "builtin", "gemma3-1b");
  expect(api.modelsSetSlot).toHaveBeenCalledWith("rewrite", "builtin", "gemma3-1b");
  expect(store.view?.slots.rewrite).toEqual({ kind: "builtin", id: "gemma3-1b" });

  finish();
  await running;
  expect(store.downloadingId).toBeNull();
});

it("one download at a time: a second press while one runs starts nothing", async () => {
  await store.load();
  let finish: () => void = () => {};
  vi.mocked(api.modelsDownload).mockReturnValue(new Promise<void>((r) => (finish = r)));

  const running = store.download("qwen3-4b");
  await store.download("gemma3-1b");
  expect(api.modelsDownload).toHaveBeenCalledTimes(1);
  expect(store.downloadingId).toBe("qwen3-4b");

  finish();
  await running;
});

it("a failed download says why and frees the store", async () => {
  await store.load();
  vi.mocked(api.modelsDownload).mockRejectedValue("download_busy");
  await store.download("qwen3-4b");
  expect(store.error).toBe("Another model is already downloading. Wait for it to finish.");
  expect(store.downloadingId).toBeNull();
  expect(store.loading).toBe(false);
});

it("hiding uncensored models takes effect before the save answers (C4)", async () => {
  await store.load();
  let saved: () => void = () => {};
  vi.mocked(api.setSettings).mockReturnValue(new Promise((r) => (saved = () => r({} as never))));

  const saving = store.setCensorship(false);
  // On screen at once: the list hides them while the file is being written.
  expect(store.view?.censorship).toBe(true);
  expect(api.setSettings).toHaveBeenCalledWith({ censorship: true });

  saved();
  await saving;
  expect(store.view?.censorship).toBe(true);

  vi.mocked(api.setSettings).mockResolvedValue({} as never);
  await store.setCensorship(true);
  expect(store.view?.censorship).toBe(false);
  expect(api.setSettings).toHaveBeenLastCalledWith({ censorship: false });
});

it("a refused save puts the list back and tells the caller (C4)", async () => {
  await store.load();
  vi.mocked(api.setSettings).mockRejectedValue("io");
  await expect(store.setCensorship(false)).rejects.toBe("io");
  // The box and the list say what is stored, not what was asked for.
  expect(store.view?.censorship).toBe(false);
});

it("two quick choices both reach Rust, in order, and the last one stands", async () => {
  await store.load();
  // WebView2 changes a closed select on every arrow key: two changes can be
  // on their way at once. Through the old busy guard the second was dropped.
  let first: (s: Slots) => void = () => {};
  vi.mocked(api.modelsSetSlot)
    .mockReturnValueOnce(new Promise<Slots>((r) => (first = r)))
    .mockResolvedValueOnce({ ...slots(), rewrite: { kind: "ollama", id: "qwen3:4b" } });

  const a = store.setSlot("rewrite", "builtin", "gemma3-1b");
  const b = store.setSlot("rewrite", "ollama", "qwen3:4b");
  // In order: the second waits for the first.
  await vi.waitFor(() => expect(api.modelsSetSlot).toHaveBeenCalledTimes(1));
  await Promise.resolve();
  expect(api.modelsSetSlot).toHaveBeenCalledTimes(1);
  first({ ...slots(), rewrite: { kind: "builtin", id: "gemma3-1b" } });
  await Promise.all([a, b]);
  expect(vi.mocked(api.modelsSetSlot).mock.calls).toEqual([
    ["rewrite", "builtin", "gemma3-1b"],
    ["rewrite", "ollama", "qwen3:4b"],
  ]);
  expect(store.view?.slots.rewrite).toEqual({ kind: "ollama", id: "qwen3:4b" });
  // A choice never holds the store: the selects do not lock while it saves.
  expect(store.loading).toBe(false);
});

it("getting a model into Ollama holds its own state, not the store's", async () => {
  await store.load();
  let finish: () => void = () => {};
  vi.mocked(api.ollamaPull).mockReturnValue(new Promise<void>((r) => (finish = r)));
  const pulling = store.pullOllama(" qwen3:4b ");
  expect(store.pulling).toBe("qwen3:4b");
  expect(store.loading).toBe(false);
  finish();
  await pulling;
  expect(store.pulling).toBeNull();

  vi.mocked(api.ollamaPull).mockRejectedValue("ollama_failed");
  await store.pullOllama("nope:1b");
  // Said in Ollama's row, not at the top of the page.
  expect(store.pullError).toBe("Ollama could not finish that.");
  expect(store.error).toBeNull();
});

/** A promise and the hand that settles it, for an answer still on its way from Rust. */
function later<T>(): { promise: Promise<T>; settle: (value: T) => void } {
  let settle: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => (settle = resolve));
  return { promise, settle };
}

it("a view asked for before a task changed does not put the old task back on screen", async () => {
  await store.load();
  // A download ends, and its closing refresh is on its way: Rust read the
  // settings, then waits on Ollama and the saved server.
  let finish: () => void = () => {};
  vi.mocked(api.modelsDownload).mockReturnValue(new Promise<void>((r) => (finish = r)));
  vi.mocked(api.modelsProgress).mockResolvedValue(null);
  const stale = later<LocalAiView>();
  vi.mocked(api.modelsView).mockReturnValue(stale.promise);
  const downloading = store.download("qwen3-4b");
  finish();
  await vi.waitFor(() => expect(api.modelsView).toHaveBeenCalledTimes(2));

  // Meanwhile the writer gives Rewrite a model, which a download no longer blocks.
  const chosen = { ...slots(), rewrite: { kind: "builtin" as const, id: "gemma3-1b" } };
  vi.mocked(api.modelsSetSlot).mockResolvedValue(chosen);
  await store.setSlot("rewrite", "builtin", "gemma3-1b");
  expect(store.view?.slots.rewrite).toEqual({ kind: "builtin", id: "gemma3-1b" });

  // The refresh lands with the settings as they were before the choice.
  stale.settle(view({ models: [card({ state: "ready" })] }));
  await downloading;
  // What Rust holds now, not what it held when it was asked...
  expect(store.view?.slots.rewrite).toEqual({ kind: "builtin", id: "gemma3-1b" });
  // ...and the rest of the view is the new one: the download is on disk.
  expect(store.view?.models[0].state).toBe("ready");

  // A view asked for after the change carries it, and is taken whole.
  vi.mocked(api.modelsView).mockResolvedValue(view({ slots: { ...chosen, continuity: { kind: "ollama", id: "qwen3:4b" } } }));
  await store.load();
  expect(store.view?.slots.continuity).toEqual({ kind: "ollama", id: "qwen3:4b" });
});

it("a view asked for before the uncensored models were hidden does not show them again", async () => {
  await store.load();
  const stale = later<LocalAiView>();
  vi.mocked(api.modelsView).mockReturnValue(stale.promise);
  const loading = store.load();
  vi.mocked(api.setSettings).mockResolvedValue({} as never);
  await store.setCensorship(false);
  expect(store.view?.censorship).toBe(true);
  stale.settle(view({ censorship: false }));
  await loading;
  expect(store.view?.censorship).toBe(true);
});

it("a view that lands while the uncensored models are being hidden does not show them again", async () => {
  await store.load();
  const stale = later<LocalAiView>();
  vi.mocked(api.modelsView).mockReturnValue(stale.promise);
  const loading = store.load();
  const saved = later<unknown>();
  vi.mocked(api.setSettings).mockReturnValue(saved.promise as never);
  const hiding = store.setCensorship(false);
  // The view Rust built before the change arrives while the file is written.
  stale.settle(view({ censorship: false }));
  await loading;
  expect(store.view?.censorship).toBe(true);
  saved.settle({});
  await hiding;
  expect(store.view?.censorship).toBe(true);
});

it("the download poller stops only when the last surface showing the models closes", async () => {
  // Settings is open, and the Manuscript dialog's Continuity tab over it.
  vi.mocked(api.modelsView).mockResolvedValue(view({ progress: { id: "qwen3-4b", received: 1, total: 100, done: false } }));
  await store.open();
  await store.open();
  vi.mocked(api.modelsProgress).mockClear();

  // The dialog closes: Settings still shows the bar, so it still moves.
  store.close();
  await vi.advanceTimersByTimeAsync(800);
  expect(api.modelsProgress).toHaveBeenCalled();

  // Settings closes too: nothing is left to show it.
  store.close();
  vi.mocked(api.modelsProgress).mockClear();
  await vi.advanceTimersByTimeAsync(2000);
  expect(api.modelsProgress).not.toHaveBeenCalled();

  // An extra close never counts below zero: the next open polls again.
  store.close();
  await store.open();
  await vi.advanceTimersByTimeAsync(800);
  expect(api.modelsProgress).toHaveBeenCalled();
});

it("saving the server reads the tasks back when one ran on it, since Rust may release it", async () => {
  const studio = { host: "192.168.1.20", port: 1234, enabled: true, running: true, models: ["local-model"] };
  vi.mocked(api.studioSave).mockResolvedValue(studio);
  // No task on the server: nothing to read back.
  await store.load();
  vi.mocked(api.modelsView).mockClear();
  await store.saveStudio("192.168.1.20", 1234, true);
  expect(api.modelsView).not.toHaveBeenCalled();
  expect(store.view?.studio).toEqual(studio);

  // Rewrite on it: Rust released it for the new address, and the view says so.
  vi.mocked(api.modelsView).mockResolvedValue(view({ slots: { ...slots(), rewrite: { kind: "server", id: "local-model" } } }));
  await store.load();
  vi.mocked(api.modelsView).mockResolvedValue(view({ studio }));
  await store.saveStudio("192.168.1.20", 1234, true);
  expect(store.view?.slots.rewrite).toEqual({ kind: "none", id: "" });
});

it("a download the writer cancelled is not reported as a failure", async () => {
  await store.load();
  vi.mocked(api.modelsDownload).mockRejectedValue("cancelled");
  await store.download("qwen3-4b");
  expect(store.error).toBeNull();
  expect(store.downloadingId).toBeNull();
});
