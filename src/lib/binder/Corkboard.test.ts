import { beforeEach, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { api, type ChapterMeta, type Project } from "$lib/tauri";
import { store } from "$lib/binder/store.svelte";
import Corkboard from "./Corkboard.svelte";

vi.mock("$lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("$lib/tauri")>("$lib/tauri");
  return {
    ...actual,
    api: { readChapter: vi.fn(), saveChapter: vi.fn(), openProject: vi.fn() },
    isTauri: () => true,
  };
});

const chapter = (id: string, title: string, words: number, status: string): ChapterMeta => ({
  id,
  title,
  status,
  words,
  file: `manuscript/${id}.md`,
  mtime: 0,
});

const project = {
  path: "/novel",
  meta: { title: "The Long Winter" },
  chapters: [
    chapter("ch-01", "A door in the rain", 412, "draft"),
    chapter("ch-02", "North", 980, "revised"),
  ],
} as unknown as Project;

let target: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.readChapter).mockImplementation(async (_path, file) => ({
    frontmatter: {},
    body: file.includes("ch-01")
      ? "# A door in the rain\n\nLlovió tres días seguidos."
      : "El camino torcía al norte.",
  }));
  store.project = project;
  store.currentChapter = project.chapters[0];
  store.loading = false;
  target = document.createElement("div");
  document.body.append(target);
});

async function render() {
  const app = mount(Corkboard, { target });
  flushSync();
  // Let the per-chapter reads resolve.
  await vi.waitFor(() => expect(api.readChapter).toHaveBeenCalledTimes(2));
  flushSync();
  return app;
}

it("shows a card per chapter with its words and status", async () => {
  const app = await render();
  const cards = target.querySelectorAll("li");
  expect(cards).toHaveLength(2);

  const text = target.textContent ?? "";
  expect(text).toContain("A door in the rain");
  expect(text).toContain("North");
  expect(text).toContain("412");
  expect(text).toContain("980");
  // Status comes from an existing key namespace, so the copy really resolves.
  expect(text).toContain("draft");
  expect(text).toContain("revised");

  await unmount(app);
  target.remove();
});

it("reads each chapter to show a synopsis without its markdown markers", async () => {
  const app = await render();
  const text = target.textContent ?? "";
  expect(text).toContain("Llovió tres días seguidos.");
  // The heading is stripped rather than shown as "# A door in the rain".
  expect(text).not.toContain("# A door");
  expect(api.readChapter).toHaveBeenCalledWith("/novel", "manuscript/ch-01.md");

  await unmount(app);
  target.remove();
});

it("marks the chapter that is open", async () => {
  const app = await render();
  const current = target.querySelectorAll('[aria-current="true"]');
  expect(current).toHaveLength(1);
  expect(current[0].textContent).toContain("A door in the rain");

  await unmount(app);
  target.remove();
});

it("opens the chapter behind a card that is clicked", async () => {
  const open = vi.spyOn(store, "openChapter").mockResolvedValue();
  const app = await render();

  const buttons = target.querySelectorAll("button");
  (buttons[1] as HTMLButtonElement).click();
  flushSync();

  expect(open).toHaveBeenCalledTimes(1);
  expect(open.mock.calls[0][0].id).toBe("ch-02");

  open.mockRestore();
  await unmount(app);
  target.remove();
});

it("survives a chapter it cannot read rather than blanking the board", async () => {
  vi.mocked(api.readChapter).mockRejectedValueOnce("io");
  const app = await render();

  // Both cards are still there; the unreadable one just has no synopsis.
  expect(target.querySelectorAll("li")).toHaveLength(2);
  expect(target.textContent).toContain("North");

  await unmount(app);
  target.remove();
});
