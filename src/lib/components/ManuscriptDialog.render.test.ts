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
  return { ...actual, isTauri: () => true, api: { setAuthor: vi.fn(), modelsView: vi.fn(() => new Promise(() => {})) } };
});

it("renders the three tabs, every export format and a warning as copy", async () => {
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
  expect([...target.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent?.trim())).toEqual([
    "Export",
    "Import",
    "Continuity",
  ]);
  expect(target.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim()).toBe("Export");
  expect(target.querySelectorAll('input[type="radio"]')).toHaveLength(5);
  await unmount(app);
  target.remove();
  formats.discardPreview();
});

it("opens on the tab it is asked for, with the check as the footer's action", async () => {
  const target = document.createElement("div");
  document.body.append(target);
  const app = mount(ManuscriptDialog, { target, props: { onClose: () => {}, initialTab: "continuity" } });
  flushSync();
  // Settings' "Run it from Manuscript › Continuity" lands here, not on Export.
  const selected = target.querySelector('[role="tab"][aria-selected="true"]');
  expect(selected?.textContent?.trim()).toBe("Continuity");
  expect(document.activeElement).toBe(selected);
  const panel = target.querySelector<HTMLElement>("#manuscript-panel-continuity")!;
  expect(panel.hidden).toBe(false);
  expect(panel.textContent).toContain("Looks for contradictions in your story.");
  // No model known yet, and no novel open: the check cannot start.
  const check = [...target.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Check the manuscript");
  expect(check?.disabled).toBe(true);
  await unmount(app);
  target.remove();
});
