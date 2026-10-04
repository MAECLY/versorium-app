import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { BinderStore } from "./store.svelte";
import { api, type ChapterMeta, type Project } from "$lib/tauri";
import { notices } from "$lib/notices/state.svelte";

vi.mock("$lib/tauri", () => ({
  api: {
    saveChapter: vi.fn(),
    readChapter: vi.fn(),
    openProject: vi.fn(),
    mcpSetActiveProject: vi.fn(),
    createProject: vi.fn(),
    createChapter: vi.fn(),
    defaultProjectsDir: vi.fn(),
    listProjects: vi.fn(),
    updateProject: vi.fn(),
    updateChapter: vi.fn(),
    reorderChapters: vi.fn(),
  },
  isTauri: () => true,
}));
vi.mock("$lib/i18n", () => ({ t: (key: string) => key }));

const chapter = (id: string): ChapterMeta => ({ id, file: `${id}.md`, title: id, status: "draft", words: 0, mtime: 0 });
const project = { path: "/novel", chapters: [chapter("a"), chapter("b")], meta: {} } as Project;
let store: BinderStore;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  for (const notice of [...notices.items]) notices.dismiss(notice.id);
  store = new BinderStore();
  store.project = project;
  store.currentChapter = project.chapters[0];
  vi.mocked(api.saveChapter).mockImplementation(async (_path, file) => ({ ...chapter(file[0]), words: 3 }));
  vi.mocked(api.readChapter).mockResolvedValue({ body: "Chapter B", frontmatter: {} });
  vi.mocked(api.openProject).mockResolvedValue(project);
  vi.mocked(api.mcpSetActiveProject).mockResolvedValue(undefined);
  vi.mocked(api.defaultProjectsDir).mockResolvedValue("/novels");
  vi.mocked(api.listProjects).mockResolvedValue([project]);
});
afterEach(() => vi.useRealTimers());

/** What the binder put in the notices, as "id tier". */
const posted = () => notices.items.map((n) => `${n.id} ${n.tier}`);

describe("chapter persistence", () => {
  it("flushes typed text to chapter A before selecting B", async () => {
    store.updateBody("Chapter A typed");
    await store.openChapter(project.chapters[1]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.saveChapter).toHaveBeenCalledTimes(1);
    expect(api.saveChapter).toHaveBeenCalledWith("/novel", "a.md", "Chapter A typed");
    expect(store.currentChapter?.id).toBe("b");
    expect(store.chapterBody).toBe("Chapter B");
  });
  it("stays in the chapter with unsaved text if saving fails", async () => {
    vi.mocked(api.saveChapter).mockRejectedValue("io");
    store.updateBody("Keep this text");
    await store.openChapter(project.chapters[1]);
    expect(store.currentChapter?.id).toBe("a");
    expect(store.chapterBody).toBe("Keep this text");
    expect(api.readChapter).not.toHaveBeenCalled();
    expect(store.saveState).toBe("error");
  });
  it("blocks navigation if the operation log cannot flush", async () => {
    store.beforeLeave = async () => { throw "io"; };
    await store.openChapter(project.chapters[1]);
    expect(api.readChapter).not.toHaveBeenCalled();
    expect(store.currentChapter?.id).toBe("a");
  });
  it("serializes writes so an older save cannot win", async () => {
    let release!: () => void;
    vi.mocked(api.saveChapter).mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { release = resolve; });
      return chapter("a");
    });
    store.updateBody("first");
    const first = store.flush();
    await vi.advanceTimersByTimeAsync(0);
    store.updateBody("second");
    const second = store.flush();
    expect(api.saveChapter).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(api.saveChapter).toHaveBeenLastCalledWith("/novel", "a.md", "second");
    expect(store.chapterBody).toBe("second");
    expect(store.saveState).toBe("saved");
  });
});

describe("adoptSaved", () => {
  it("takes a body Rust already persisted without scheduling another save", async () => {
    store.updateBody("typed before rewrite");
    const meta = { ...chapter("a"), words: 2 };
    store.adoptSaved("rewritten body", meta);
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.saveChapter).not.toHaveBeenCalled();
    expect(store.chapterBody).toBe("rewritten body");
    expect(store.currentChapter).toEqual(meta);
    expect(store.project?.chapters[0]).toEqual(meta);
    expect(store.saveState).toBe("saved");
    await store.flush();
    expect(api.saveChapter).not.toHaveBeenCalled();
  });
});

describe("MCP active project", () => {
  it("notifies the separate MCP process when a project opens", async () => {
    await store.openProject("/novel");
    expect(api.mcpSetActiveProject).toHaveBeenCalledWith("/novel");
  });

  it("notifies with null when the project closes", async () => {
    await store.closeProject();
    expect(api.mcpSetActiveProject).toHaveBeenLastCalledWith(null);
    expect(store.project).toBeNull();
  });

  it("a failed notification never blocks navigation nor surfaces an error", async () => {
    vi.mocked(api.mcpSetActiveProject).mockRejectedValue("io");
    await store.openProject("/novel");
    await vi.advanceTimersByTimeAsync(0);
    expect(api.mcpSetActiveProject).toHaveBeenCalledWith("/novel");
    expect(store.project?.path).toBe("/novel");
    expect(store.currentChapter?.id).toBe("a");
    expect(notices.items).toEqual([]);
  });
});

describe("what the binder reports, and where", () => {
  it("a failed save stays on screen, once, until a save goes through", async () => {
    vi.mocked(api.saveChapter).mockRejectedValue("io");
    store.updateBody("first");
    await vi.advanceTimersByTimeAsync(1000);
    store.updateBody("first, again");
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.saveChapter).toHaveBeenCalledTimes(2);
    expect(posted()).toEqual(["binder.save persistent"]);
    expect(store.saveState).toBe("error");

    vi.mocked(api.saveChapter).mockImplementation(async (_path, file) => ({ ...chapter(file[0]), words: 3 }));
    expect(await store.saveChapter("first, saved")).toBe(true);
    expect(notices.items).toEqual([]);
  });

  it("a chapter that cannot be opened says so until one can", async () => {
    vi.mocked(api.readChapter).mockRejectedValueOnce("not_found");
    await store.openChapter(project.chapters[1]);
    expect(posted()).toEqual(["binder.navigate persistent"]);
    expect(store.currentChapter?.id).toBe("a");

    await store.openChapter(project.chapters[1]);
    expect(store.currentChapter?.id).toBe("b");
    expect(notices.items).toEqual([]);
  });

  it("a novel or a chapter that cannot be made tells the dialog that asked, and posts nothing", async () => {
    vi.mocked(api.createProject).mockRejectedValue("project_exists");
    expect(await store.createProject("Taken", "es")).toBe("errors.generic");
    vi.mocked(api.createChapter).mockRejectedValue("empty_title");
    expect(await store.createChapter(" ")).toBe("errors.generic");
    expect(notices.items, "a notice would sit behind the dialog's backdrop").toEqual([]);

    vi.mocked(api.createChapter).mockResolvedValue(chapter("c"));
    expect(await store.createChapter("Tercero")).toBeNull();
  });

  it("the list of novels that cannot be read says so until it can", async () => {
    vi.mocked(api.listProjects).mockRejectedValueOnce("io");
    await store.refreshProjects();
    expect(posted()).toEqual(["binder.list persistent"]);
    await store.refreshProjects();
    expect(notices.items).toEqual([]);
  });

  it("an edit that fails the same way twice is one notice, gone once that edit works", async () => {
    vi.mocked(api.updateProject).mockRejectedValue("io");
    await store.renameProject("/novel", "Uno");
    await store.renameProject("/novel", "Dos");
    expect(posted()).toEqual(["binder.renameProject persistent"]);

    vi.mocked(api.updateProject).mockResolvedValue({ ...project.meta, title: "Tres" });
    vi.mocked(api.listProjects).mockResolvedValue([project]);
    await store.renameProject("/novel", "Tres");
    expect(notices.items).toEqual([]);
  });

  it("another action that works leaves a failed one up: what failed has still not happened", async () => {
    vi.mocked(api.updateChapter).mockRejectedValue("io");
    await store.updateChapter("a.md", "Uno");
    vi.mocked(api.updateChapter).mockResolvedValue({ ...chapter("a"), status: "final" });
    await store.updateChapter("a.md", undefined, "final");
    vi.mocked(api.reorderChapters).mockResolvedValue([...project.chapters].reverse());
    await store.moveChapter("a.md", 1);
    expect(api.reorderChapters).toHaveBeenCalledTimes(1);
    expect(posted(), "the rename is still undone").toEqual(["binder.renameChapter persistent"]);
  });

  it("the Project dialog gets its failure back, and nothing is posted behind its backdrop", async () => {
    vi.mocked(api.updateProject).mockRejectedValue("io");
    expect(await store.setExportMatter("/novel", false, true)).toBe("errors.generic");
    expect(notices.items).toEqual([]);

    vi.mocked(api.updateProject).mockResolvedValue({ ...project.meta, exportCover: false });
    expect(await store.setExportMatter("/novel", false, true)).toBeNull();
    expect(store.project?.meta.exportCover).toBe(false);
  });
});
