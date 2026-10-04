import { expect, it, vi } from "vitest";
import { mount, flushSync, unmount } from "svelte";
import ManuscriptDialog from "$lib/components/ManuscriptDialog.svelte";
import { formats } from "$lib/formats/state.svelte";

// jsdom has no dialog implementation; the component calls showModal on mount.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};

vi.mock("$lib/tauri", async (orig) => {
  const actual = await orig<typeof import("$lib/tauri")>();
  return { ...actual, isTauri: () => true, api: { setAuthor: vi.fn() } };
});

it("renders both tabs, every export format and a warning as copy", async () => {
  formats.preview = {
    title: "Imported",
    language: null,
    declaredLanguage: null,
    chapters: [{ title: "One", body: "Uno dos.", synopsis: null }],
    warnings: ["import_title_guessed"],
  };
  const target = document.createElement("div");
  document.body.append(target);
  const app = mount(ManuscriptDialog, { target, props: { onClose: () => {} } });
  flushSync();
  const text = target.textContent ?? "";
  for (const s of ["Manuscript", "Export", "Import", "Markdown", "Word (DOCX)", "EPUB 3", "PDF", "Scrivener", "Author"]) {
    expect(text, `missing ${s}`).toContain(s);
  }
  expect(text).toContain("The title was taken from the first heading.");
  expect(target.querySelectorAll('[role="tab"]')).toHaveLength(2);
  expect(target.querySelectorAll('input[type="radio"]')).toHaveLength(5);
  await unmount(app);
  target.remove();
  formats.discardPreview();
});
