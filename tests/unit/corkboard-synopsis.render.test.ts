import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { api, type ChapterMeta, type Project } from "$lib/tauri";
import { store } from "$lib/binder/store.svelte";
import Corkboard from "$lib/binder/Corkboard.svelte";

// The corkboard (src/lib/binder/Corkboard.svelte) rendered in jsdom: a card
// shows a chapter's synopsis when it keeps one, its opening words when it
// does not, and says which to a screen reader.

vi.mock("$lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("$lib/tauri")>("$lib/tauri");
  return { ...actual, api: { readChapter: vi.fn() }, isTauri: () => true };
});

const chapter = (id: string, title: string): ChapterMeta => ({
  id,
  title,
  status: "draft",
  words: 5,
  file: `manuscript/${id}.md`,
  mtime: 0,
});

const project = {
  path: "/novel",
  meta: { title: "The Salt Road" },
  chapters: [chapter("ch-01", "A door in the rain"), chapter("ch-02", "North")],
} as unknown as Project;

let target: HTMLDivElement;
let app: Record<string, unknown> | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.readChapter).mockImplementation(async (_path, file) =>
    file.includes("ch-01")
      ? { frontmatter: { id: "ch-01", synopsis: "She leaves.\nAlone." }, body: "It rained for three days." }
      : { frontmatter: { id: "ch-02" }, body: "## Morning\n\nThe road bent north." },
  );
  store.project = project;
  store.currentChapter = project.chapters[0];
  store.loading = false;
  target = document.createElement("div");
  document.body.append(target);
});

afterEach(async () => {
  if (app) await unmount(app);
  app = undefined;
  target.remove();
});

async function render(): Promise<HTMLElement[]> {
  app = mount(Corkboard, { target });
  flushSync();
  await vi.waitFor(() => expect(api.readChapter).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => {
    flushSync();
    expect(target.querySelectorAll('[data-card-text="empty"]')).toHaveLength(0);
  });
  return [...target.querySelectorAll<HTMLElement>("[data-card-text]")];
}

it("a card shows the chapter's synopsis rather than its first lines", async () => {
  const [first] = await render();
  expect(first.dataset.cardText).toBe("synopsis");
  expect(first.textContent).toContain("She leaves.\nAlone.");
  expect(first.textContent).not.toContain("It rained for three days.");
});

it("a chapter without one shows its opening, marked as such", async () => {
  const [, second] = await render();
  expect(second.dataset.cardText).toBe("opening");
  expect(second.textContent).toContain("The road bent north.");
  expect(second.textContent, "a scene heading is not prose").not.toContain("Morning");
});

it("a screen reader hears which of the two a card is showing", async () => {
  const [first, second] = await render();
  expect(first.querySelector(".sr-only")?.textContent).toBe("Synopsis:");
  expect(second.querySelector(".sr-only")?.textContent).toBe("Opening lines:");
  // Inside the card's button, so it is part of what the button announces.
  expect(first.closest("button")?.textContent).toMatch(/Synopsis: She leaves\./);
});
