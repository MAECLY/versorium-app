import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { invoke } from "@tauri-apps/api/core";
import { EditorView } from "@codemirror/view";
import { undoDepth } from "@codemirror/commands";
import { createMarkdownState } from "$lib/editor/cm";
import {
  EDITOR_DEFAULTS,
  createPreferenceCompartments,
  fontFamilyValue,
  markedFont,
  pageStyle,
} from "$lib/editor/preferences";
import { EditorPreferencesStore } from "$lib/editor/state.svelte";

// The face chosen under Settings → Editor → Typography, on its way to the
// page: Rust answers an id and a stack (`fonts::EditorFont`), the store keeps
// what Rust kept, the panel marks the id, and the editor carries the stack as
// `--editor-font` on `.cm-editor`, read by the one rule in styles.css that
// names the content's face. The page itself is tests/e2e/editor-settings.spec.ts.

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

interface CatalogFace {
  id: string;
  role: string;
  stack: string;
}

const catalog = JSON.parse(readFileSync("fonts/catalog.json", "utf8")) as {
  defaultBody: string;
  fonts: CatalogFace[];
};
const stackOf = (id: string): string => catalog.fonts.find((face) => face.id === id)!.stack;
const SYSTEM_SERIF = stackOf("system-serif");
const SOURCE_SERIF = stackOf("source-serif-4");

/** A family list compared as the browser reads it: commas and runs of space are not significant. */
function families(list: string): string[] {
  return list.split(",").map((family) => family.trim().replace(/\s+/g, " "));
}

/** The fallback the stylesheet gives `--editor-font` in `.cm-editor .cm-content`. */
function stylesheetFace(): string {
  const css = readFileSync("src/styles.css", "utf8");
  const rule = /\.cm-editor \.cm-content\s*\{([^}]*)\}/.exec(css);
  if (!rule) throw new Error("no `.cm-editor .cm-content` rule in styles.css");
  const face = /font-family:\s*var\(\s*--editor-font\s*,([^)]+)\)/.exec(rule[1]);
  if (!face) throw new Error("the content's font-family does not read --editor-font");
  return face[1];
}

describe("the face on the page", () => {
  it("rides with size, spacing and measure as one more custom property", () => {
    const style = pageStyle(EDITOR_DEFAULTS, SOURCE_SERIF);
    expect(style).toBe(
      `--editor-text-size: 21px; --editor-line-height: 1.7; --editor-measure: 72ch; --editor-font: ${SOURCE_SERIF}`,
    );
    // None known yet: the property is left out, and the stylesheet's own face shows.
    expect(pageStyle(EDITOR_DEFAULTS)).toBe("--editor-text-size: 21px; --editor-line-height: 1.7; --editor-measure: 72ch");
    expect(pageStyle(EDITOR_DEFAULTS, null)).not.toContain("--editor-font");
  });

  it("refuses a stack that could end the declaration or start another", () => {
    for (const hostile of ["serif; color: red", "serif }", "a { b", "<b>serif", "Iowan\nserif", "Iowan\rserif", "se\\rif"]) {
      expect(fontFamilyValue(hostile), JSON.stringify(hostile)).toBeUndefined();
      expect(pageStyle(EDITOR_DEFAULTS, hostile), JSON.stringify(hostile)).not.toContain("--editor-font");
    }
    for (const nothing of ["", "   ", null, undefined]) expect(fontFamilyValue(nothing)).toBeUndefined();
    expect(fontFamilyValue(`  ${SYSTEM_SERIF}  `)).toBe(SYSTEM_SERIF);
  });

  it("takes every face the shipped catalogue offers, as it is written", () => {
    for (const face of catalog.fonts) expect(fontFamilyValue(face.stack), face.id).toBe(face.stack);
  });

  it("falls back, before any choice is read, to the face the catalogue gives a fresh install", () => {
    // If the two differed, the page would change face the moment the choice
    // arrived from Rust, and before that it would show a face no row marks.
    expect(catalog.defaultBody).toBe("system-serif");
    expect(families(stylesheetFace())).toEqual(families(stackOf(catalog.defaultBody)));
  });
});

describe("the mark in Typography", () => {
  const offered = catalog.fonts.filter((face) => face.role === "body");

  it("is on the row whose id settings hold", () => {
    expect(markedFont(offered, { id: "source-serif-4" })).toBe("source-serif-4");
    expect(markedFont(offered, { id: "system-serif" })).toBe("system-serif");
  });

  it("is on no row when what came back is not an offered id", () => {
    // What editor_font used to answer: a stack, which no row's id ever equals.
    expect(markedFont(offered, { id: SYSTEM_SERIF })).toBeNull();
    // A face the panel does not list (the catalogue's mono face, which the
    // command accepts) marks nothing rather than a row the page is not in.
    expect(markedFont(offered, { id: "system-mono" })).toBeNull();
    expect(markedFont(offered, null)).toBeNull();
    expect(markedFont(offered, undefined)).toBeNull();
    expect(markedFont([], { id: "system-serif" })).toBeNull();
  });
});

describe("on a live editor", () => {
  it("changes face in place: same editor, same caret, same undo history", () => {
    const compartments = createPreferenceCompartments();
    const view = new EditorView({
      state: createMarkdownState("Una frase larga que vive aquí.", compartments.initial(EDITOR_DEFAULTS, "es", SYSTEM_SERIF)),
    });
    const content = view.contentDOM;
    expect(view.dom.getAttribute("style")).toContain(`--editor-font: ${SYSTEM_SERIF}`);
    view.dispatch({ changes: { from: 0, insert: "Hoy. " }, selection: { anchor: 9 }, userEvent: "input.type" });
    const depth = undoDepth(view.state);

    view.dispatch({ effects: compartments.reconfigure(EDITOR_DEFAULTS, "es", SOURCE_SERIF) });

    expect(view.dom.getAttribute("style")).toContain(`--editor-font: ${SOURCE_SERIF}`);
    expect(view.dom.getAttribute("style")).not.toContain(SYSTEM_SERIF);
    expect(view.dom.getAttribute("style")).toContain("--editor-text-size: 21px");
    expect(view.contentDOM).toBe(content);
    expect(view.state.selection.main.head).toBe(9);
    expect(undoDepth(view.state)).toBe(depth);
    view.destroy();
  });
});

describe("the store", () => {
  const answered = vi.mocked(invoke);
  let store: EditorPreferencesStore;

  beforeEach(() => {
    // isTauri() looks for the IPC bridge; the bridge itself is the mock above.
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    answered.mockReset();
    store = new EditorPreferencesStore();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("reads the face settings hold, as Rust resolved it", async () => {
    answered.mockResolvedValueOnce({ id: "system-serif", stack: SYSTEM_SERIF });
    await store.loadFont();
    expect(answered).toHaveBeenLastCalledWith("editor_font");
    expect(store.font).toEqual({ id: "system-serif", stack: SYSTEM_SERIF });
    expect(store.fontError).toBeNull();
  });

  it("chooses by id and keeps what Rust answered, not what was asked for", async () => {
    // Rust answers the face it kept; the store shows that, never the request.
    answered.mockResolvedValueOnce({ id: "source-serif-4", stack: SOURCE_SERIF });
    await store.chooseFont("source-serif-4");
    expect(answered).toHaveBeenLastCalledWith("set_editor_font", { id: "source-serif-4" });
    expect(store.font).toEqual({ id: "source-serif-4", stack: SOURCE_SERIF });
  });

  it("keeps the face it had when the choice is refused, and says why", async () => {
    answered.mockResolvedValueOnce({ id: "system-serif", stack: SYSTEM_SERIF });
    await store.loadFont();
    answered.mockRejectedValueOnce("bad_args");
    await store.chooseFont("comic-sans");
    expect(store.font).toEqual({ id: "system-serif", stack: SYSTEM_SERIF });
    expect(store.fontError).toEqual(expect.any(String));

    // The next choice that goes through clears it.
    answered.mockResolvedValueOnce({ id: "source-serif-4", stack: SOURCE_SERIF });
    await store.chooseFont("source-serif-4");
    expect(store.fontError).toBeNull();
    expect(store.font?.id).toBe("source-serif-4");
  });
});
