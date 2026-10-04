import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { api, type LocalAiView, type Project } from "$lib/tauri";
import ManuscriptDialog from "$lib/components/ManuscriptDialog.svelte";
import { store } from "$lib/binder/store.svelte";
import { models } from "$lib/models/state.svelte";
import { continuityRunner } from "$lib/continuity/state.svelte";

// Manuscript › Continuity in jsdom: it asks for the models only once the tab
// is shown (an export has no use for Ollama or the saved server), and a
// finding names its chapter as the writer knows it, by its title.

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};

vi.mock("$lib/tauri", async (actual) => ({
  ...(await actual<typeof import("$lib/tauri")>()),
  isTauri: () => true,
  api: { setAuthor: vi.fn(), modelsView: vi.fn(), modelsProgress: vi.fn(async () => null), continuityCheck: vi.fn() },
}));

const none = { kind: "none" as const, id: "" };
const view = (): LocalAiView => ({
  models: [],
  hardware: { totalRamGb: 16, availableRamGb: 8, cpuCores: 8, arch: "aarch64", os: "macos", gpu: "", recommendedTier: "mid" },
  slots: { rewrite: none, chat: none, continuity: { kind: "ollama", id: "qwen3:4b" }, embeddings: none, dictation: none },
  progress: null,
  ollama: { running: true, installed: true, models: [{ name: "qwen3:4b", sizeBytes: 1, modified: "" }] },
  studio: { host: "127.0.0.1", port: 1234, enabled: false, running: false, models: [] },
  censorship: false,
  diskUsedBytes: 0,
  modelsDir: "/data/models",
});

const project = {
  path: "/novels/la-aguja",
  meta: { title: "La aguja", author: "", language: "es" },
  chapters: [
    { id: "ch-01", title: "El invierno", status: "draft", words: 10, file: "manuscript/ch-01.md", mtime: 1 },
    { id: "ch-02", title: "El deshielo", status: "draft", words: 10, file: "manuscript/ch-02.md", mtime: 1 },
  ],
} as unknown as Project;

let app: Record<string, unknown> | undefined;
let target: HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.modelsView).mockResolvedValue(view());
  models.view = null;
  target = document.createElement("div");
  document.body.append(target);
});

afterEach(async () => {
  if (app) await unmount(app);
  app = undefined;
  target.remove();
  store.project = null;
});

const tab = (name: string) =>
  [...target.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent?.trim() === name)!;

it("reads the models when the Continuity tab is shown, not when the dialog opens", async () => {
  const close = vi.spyOn(models, "close");
  app = mount(ManuscriptDialog, { target, props: { onClose: () => {} } });
  flushSync();
  // Opened on Export: nothing asks Ollama or the saved server.
  await Promise.resolve();
  expect(api.modelsView).not.toHaveBeenCalled();

  tab("Continuity").click();
  flushSync();
  await vi.waitFor(() => expect(api.modelsView).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(target.textContent).toContain("Runs on qwen3:4b, on this computer."));

  // Back and forth within one visit reads them once.
  tab("Export").click();
  flushSync();
  tab("Continuity").click();
  flushSync();
  expect(api.modelsView).toHaveBeenCalledTimes(1);

  // Closed, it lets them go: the poller stops unless Settings still shows them.
  await unmount(app);
  app = undefined;
  expect(close).toHaveBeenCalledTimes(1);
  close.mockRestore();
});

it("a dialog that never showed the tab lets go of nothing", async () => {
  const close = vi.spyOn(models, "close");
  app = mount(ManuscriptDialog, { target, props: { onClose: () => {} } });
  flushSync();
  await unmount(app);
  app = undefined;
  expect(close).not.toHaveBeenCalled();
  close.mockRestore();
});

it("a finding names its chapter by title, and keeps the id for one the novel does not have", async () => {
  store.project = project;
  vi.mocked(api.continuityCheck).mockResolvedValue({
    ran: true,
    reason: null,
    findings: [
      { kind: "contradiction", chapter: "ch-02", detail: "Ana's eyes change colour." },
      // A model may drop the leading zero; it is still chapter 2.
      { kind: "contradiction", chapter: "ch-2", detail: "The thaw comes twice." },
      { kind: "note", chapter: "ch-09", detail: "A chapter the novel does not have." },
    ],
  });
  app = mount(ManuscriptDialog, { target, props: { onClose: () => {}, initialTab: "continuity" } });
  flushSync();
  await continuityRunner.run(project.path);
  flushSync();
  const items = [...target.querySelectorAll("#manuscript-panel-continuity li")].map(
    (li) => li.textContent?.replace(/\s+/g, " ").trim() ?? "",
  );
  expect(items[0]).toContain("Contradiction · El deshielo");
  expect(items[0]).not.toContain("ch-02");
  expect(items[1]).toContain("Contradiction · El deshielo");
  expect(items[2]).toContain("Note · ch-09");
});
