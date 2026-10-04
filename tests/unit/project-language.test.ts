import { beforeEach, expect, it, vi } from "vitest";
import { api, type Project, type ProjectMeta } from "$lib/tauri";
import { BinderStore } from "$lib/binder/store.svelte";
import { notices } from "$lib/notices/state.svelte";

// Changing a novel's language through the binder store
// (src/lib/binder/store.svelte.ts): the answer from Rust reaches both the
// open project, which the editor reads its `lang` from, and the list.

vi.mock("$lib/tauri", () => ({
  api: { updateProject: vi.fn(), mcpSetActiveProject: vi.fn() },
  isTauri: () => true,
}));

const meta = { title: "El faro", language: "en", exportCover: true, exportColophon: true } as ProjectMeta;
const project = { path: "/novel", meta, chapters: [] } as Project;
let store: BinderStore;

beforeEach(() => {
  vi.clearAllMocks();
  store = new BinderStore();
  store.project = project;
  store.projects = [project, { ...project, path: "/other" }];
});

it("sends the language alone, and the open project and the list take the answer", async () => {
  vi.mocked(api.updateProject).mockResolvedValue({ ...meta, language: "es" });
  expect(await store.setProjectLanguage("/novel", "es")).toBeNull();

  expect(api.updateProject).toHaveBeenCalledWith("/novel", { language: "es" });
  expect(store.project?.meta.language).toBe("es");
  expect(store.projects.find((p) => p.path === "/novel")?.meta.language).toBe("es");
  expect(store.projects.find((p) => p.path === "/other")?.meta.language, "another novel moved").toBe("en");
});

it("a refusal comes back to the dialog that asked, and nothing changes", async () => {
  vi.mocked(api.updateProject).mockRejectedValue("bad_language");
  expect(await store.setProjectLanguage("/novel", "fr")).toBe("That is not a language Versorium offers for a novel.");
  expect(store.project?.meta.language).toBe("en");
  // The dialog is modal: a notice would sit behind its backdrop, unread.
  expect(notices.items).toEqual([]);
});
