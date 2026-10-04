import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { undoDepth } from "@codemirror/commands";
import { ensureSyntaxTree, getIndentUnit } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { createMarkdownState } from "./cm";
import {
  EDITOR_DEFAULTS,
  LINE_HEIGHT,
  MEASURE,
  TEXT_SIZE,
  contentAttributes,
  contentLanguage,
  createPreferenceCompartments,
  normalizePreferences,
  pageStyle,
  spellingUnderlines,
  type EditorPreferences,
} from "./preferences";

const css = readFileSync("src/styles.css", "utf8");

/** The fallback styles.css gives a custom property inside `.cm-editor .cm-content`. */
function fallbackOf(property: string): string {
  const rule = /\.cm-editor \.cm-content\s*\{([^}]*)\}/.exec(css);
  if (!rule) throw new Error("no `.cm-editor .cm-content` rule in styles.css");
  const found = new RegExp(`var\\(${property},\\s*([^)]+)\\)`).exec(rule[1]);
  if (!found) throw new Error(`${property} is not read in that rule`);
  return found[1].trim();
}

function mount(preferences: EditorPreferences, language: string, doc = "Una frase."): {
  view: EditorView;
  modes: ReturnType<typeof createPreferenceCompartments>;
} {
  const modes = createPreferenceCompartments();
  const view = new EditorView({ state: createMarkdownState(doc, modes.initial(preferences, language)) });
  return { view, modes };
}

/** Press a key the way CodeMirror's own keymap handler sees it. */
function press(view: EditorView, key: string): boolean {
  return runScopeHandlers(view, new KeyboardEvent("keydown", { key }), "editor");
}

/** Names of the syntax nodes that cover a position, innermost last. */
function nodesAt(state: EditorState, pos: number): string[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 5000);
  if (!tree) throw new Error("the Markdown parse did not finish");
  const names: string[] = [];
  for (let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, 1); node; node = node.parent) {
    names.unshift(node.name);
  }
  return names;
}

describe("the defaults", () => {
  it("match what Rust gives a fresh install", () => {
    // `EditorSettings::default` in src-tauri/src/commands/settings.rs.
    expect(EDITOR_DEFAULTS).toEqual({
      spellcheck: true,
      textSize: "medium",
      lineSpacing: "comfortable",
      textWidth: "medium",
      lineNumbers: false,
      activeLine: true,
      tabKey: "next",
    });
  });

  it("render as the page did before there were settings", () => {
    // The stylesheet's fallbacks and the middle steps must agree, or a writer
    // who never opens Settings would see the page change size the first time
    // the preferences arrive from Rust.
    expect(TEXT_SIZE.medium).toBe("21px");
    expect(LINE_HEIGHT.comfortable).toBe("1.7");
    expect(MEASURE.medium).toBe("72ch");
    expect(fallbackOf("--editor-text-size")).toBe(TEXT_SIZE[EDITOR_DEFAULTS.textSize]);
    expect(fallbackOf("--editor-line-height")).toBe(LINE_HEIGHT[EDITOR_DEFAULTS.lineSpacing]);
    expect(fallbackOf("--editor-measure")).toBe(MEASURE[EDITOR_DEFAULTS.textWidth]);
  });

  it("put every step in order, smallest first", () => {
    const px = (v: string) => parseFloat(v);
    expect(px(TEXT_SIZE.small)).toBeLessThan(px(TEXT_SIZE.medium));
    expect(px(TEXT_SIZE.medium)).toBeLessThan(px(TEXT_SIZE.large));
    expect(px(LINE_HEIGHT.compact)).toBeLessThan(px(LINE_HEIGHT.comfortable));
    expect(px(LINE_HEIGHT.comfortable)).toBeLessThan(px(LINE_HEIGHT.airy));
    expect(px(MEASURE.narrow)).toBeLessThan(px(MEASURE.medium));
    expect(px(MEASURE.medium)).toBeLessThan(px(MEASURE.wide));
  });
});

describe("normalizePreferences", () => {
  it("fills what is missing and drops what it does not know", () => {
    expect(normalizePreferences(undefined)).toEqual(EDITOR_DEFAULTS);
    expect(normalizePreferences("nope")).toEqual(EDITOR_DEFAULTS);
    expect(
      normalizePreferences({ textSize: "huge", lineSpacing: "airy", spellcheck: "yes", lineNumbers: true, tabKey: 1 }),
    ).toEqual({ ...EDITOR_DEFAULTS, lineSpacing: "airy", lineNumbers: true });
  });
});

describe("contentLanguage", () => {
  it("passes on a language tag and nothing else", () => {
    expect(contentLanguage("es")).toBe("es");
    expect(contentLanguage(" en-US ")).toBe("en-US");
    expect(contentLanguage("es_ES")).toBe("es-ES");
    expect(contentLanguage("zh-Hant-TW")).toBe("zh-Hant-TW");
    // Not a tag: the page keeps the interface's language rather than this.
    expect(contentLanguage("Spanish")).toBeUndefined();
    expect(contentLanguage("")).toBeUndefined();
    expect(contentLanguage(undefined)).toBeUndefined();
  });
});

describe("spellingUnderlines", () => {
  it("promises underlines where the webview draws them, and not on WebKitGTK", () => {
    // What each webview reports as navigator.platform.
    expect(spellingUnderlines("MacIntel")).toBe(true);
    expect(spellingUnderlines("Win32")).toBe(true);
    expect(spellingUnderlines("Linux x86_64")).toBe(false);
    expect(spellingUnderlines("Linux aarch64")).toBe(false);
  });
});

describe("contentAttributes", () => {
  it("checks spelling in the novel's language and corrects nothing", () => {
    expect(contentAttributes(true, "es")).toEqual({
      spellcheck: "true",
      autocorrect: "off",
      autocapitalize: "sentences",
      lang: "es",
    });
    expect(contentAttributes(false, undefined)).toEqual({
      spellcheck: "false",
      autocorrect: "off",
      autocapitalize: "sentences",
    });
  });

  it("names the steps as custom properties, not as declarations", () => {
    expect(pageStyle({ ...EDITOR_DEFAULTS, textSize: "large", lineSpacing: "airy", textWidth: "narrow" })).toBe(
      "--editor-text-size: 24px; --editor-line-height: 2; --editor-measure: 60ch",
    );
  });
});

describe("on a live editor", () => {
  it("lands on the content and the editor as attributes", () => {
    const { view } = mount(EDITOR_DEFAULTS, "es");
    const content = view.contentDOM;
    expect(content.getAttribute("spellcheck")).toBe("true");
    expect(content.getAttribute("lang")).toBe("es");
    expect(content.getAttribute("autocorrect")).toBe("off");
    expect(content.getAttribute("autocapitalize")).toBe("sentences");
    // Left as CodeMirror sets it, on purpose (see contentAttributes).
    expect(content.getAttribute("writingsuggestions")).toBe("false");
    expect(view.dom.getAttribute("style")).toContain("--editor-text-size: 21px");
    // Off by default: no numbers, and no rule beside the fold markers.
    expect(view.dom.querySelector(".cm-lineNumbers")).toBeNull();
    expect(view.dom.classList.contains("v-line-numbers")).toBe(false);
    expect(view.dom.querySelector(".cm-foldGutter")).not.toBeNull();
    expect(view.contentDOM.querySelector(".cm-activeLine")).not.toBeNull();
    view.destroy();
  });

  it("changes in place: same editor, same caret, same undo history", () => {
    const { view, modes } = mount(EDITOR_DEFAULTS, "es", "Una frase larga que vive aquí.");
    const content = view.contentDOM;
    view.dispatch({ changes: { from: 0, insert: "Hoy. " }, selection: { anchor: 9 }, userEvent: "input.type" });
    const depth = undoDepth(view.state);
    expect(depth).toBe(1);

    view.dispatch({
      effects: modes.reconfigure(
        {
          spellcheck: false,
          textSize: "large",
          lineSpacing: "compact",
          textWidth: "wide",
          lineNumbers: true,
          activeLine: false,
          tabKey: "indent",
        },
        "en",
      ),
    });

    // Every preference took effect...
    expect(content.getAttribute("spellcheck")).toBe("false");
    expect(content.getAttribute("lang")).toBe("en");
    expect(view.dom.getAttribute("style")).toContain("--editor-text-size: 24px");
    expect(view.dom.getAttribute("style")).toContain("--editor-line-height: 1.5");
    expect(view.dom.getAttribute("style")).toContain("--editor-measure: 84ch");
    expect(view.dom.querySelector(".cm-lineNumbers")).not.toBeNull();
    expect(view.dom.classList.contains("v-line-numbers")).toBe(true);
    expect(view.contentDOM.querySelector(".cm-activeLine")).toBeNull();

    // ...and none of it was a rebuild, which is what would lose these.
    expect(view.contentDOM).toBe(content);
    expect(view.state.selection.main.head).toBe(9);
    expect(view.state.doc.toString()).toBe("Hoy. Una frase larga que vive aquí.");
    expect(undoDepth(view.state)).toBe(depth);
    view.destroy();
  });
});

describe("the Tab key", () => {
  // What it means to let Tab indent prose, established before deciding.
  it("leaves the editor by default: CodeMirror does not take the key", () => {
    const { view } = mount(EDITOR_DEFAULTS, "es", "Un párrafo.");
    view.dispatch({ selection: { anchor: 3 } });
    // Not handled, so the browser does its own thing with it: move focus on.
    expect(press(view, "Tab")).toBe(false);
    expect(view.state.doc.toString()).toBe("Un párrafo.");
    view.destroy();
  });

  it("when set to indent, writes two spaces at the start of the paragraph, wherever the caret is", () => {
    const { view } = mount({ ...EDITOR_DEFAULTS, tabKey: "indent" }, "es", "Primero.\n\nUn párrafo con *cursiva*.");
    expect(getIndentUnit(view.state)).toBe(2);
    const paragraph = view.state.doc.line(3);
    view.dispatch({ selection: { anchor: paragraph.from + 6 } });

    expect(press(view, "Tab")).toBe(true);
    expect(view.state.doc.line(3).text).toBe("  Un párrafo con *cursiva*.");
    // One press: still a paragraph, and the italics still parse.
    expect(nodesAt(view.state, view.state.doc.line(3).from + 2)).toContain("Paragraph");
    expect(nodesAt(view.state, view.state.doc.line(3).to - 3)).toContain("Emphasis");
    view.destroy();
  });

  it("when pressed twice after a blank line, turns the paragraph into a Markdown code block", () => {
    const { view } = mount(
      { ...EDITOR_DEFAULTS, tabKey: "indent" },
      "es",
      "Primero.\n\nUn párrafo con *cursiva*.\n\n## La escena",
    );
    view.dispatch({ selection: { anchor: view.state.doc.line(3).from } });
    press(view, "Tab");
    press(view, "Tab");
    const line = view.state.doc.line(3);
    expect(line.text).toBe("    Un párrafo con *cursiva*.");
    // CommonMark: four spaces after a blank line is an indented code block.
    // The paragraph is gone, and so are its italics.
    const inside = nodesAt(view.state, line.from + 6);
    expect(inside).toContain("CodeBlock");
    expect(inside).not.toContain("Paragraph");
    expect(nodesAt(view.state, line.to - 3)).not.toContain("Emphasis");

    // The same on a scene heading: indented twice it stops being a heading.
    view.dispatch({ selection: { anchor: view.state.doc.line(5).from } });
    press(view, "Tab");
    press(view, "Tab");
    const heading = view.state.doc.line(5);
    expect(heading.text).toBe("    ## La escena");
    expect(nodesAt(view.state, heading.to - 2)).toContain("CodeBlock");
    expect(nodesAt(view.state, heading.to - 2)).not.toContain("ATXHeading2");
    view.destroy();
  });
});
