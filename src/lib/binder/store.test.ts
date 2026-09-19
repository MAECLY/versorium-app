import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { BinderStore } from "./store.svelte";
import { api, type ChapterMeta, type Project } from "$lib/tauri";

vi.mock("$lib/tauri", () => ({ api: { saveChapter: vi.fn(), readChapter: vi.fn(), openProject: vi.fn() } }));
vi.mock("$lib/i18n", () => ({ t: (key: string) => key }));

const chapter = (id: string): ChapterMeta => ({ id, file: `${id}.md`, title: id, status: "draft", words: 0, mtime: 0 });
const project = { path: "/novel", chapters: [chapter("a"), chapter("b")], meta: {} } as Project;
let store: BinderStore;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  store = new BinderStore();
  store.project = project;
  store.currentChapter = project.chapters[0];
  vi.mocked(api.saveChapter).mockImplementation(async (_path, file) => ({ ...chapter(file[0]), words: 3 }));
  vi.mocked(api.readChapter).mockResolvedValue({ body: "Chapter B", frontmatter: {} });
});
afterEach(() => vi.useRealTimers());

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
