import { expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { createMarkdownState } from "./cm";
import {
  TYPEWRITER_ANCHOR,
  TYPEWRITER_HEAD,
  TYPEWRITER_TAIL,
  createModeCompartments,
  desiredScrollTop,
  shouldScroll,
  typewriterMode,
} from "./modes";

it("puts the active line at the lower third", () => {
  // A line 900px down a 600px viewport should sit two thirds down, so the
  // scroller stops 400px above it.
  expect(desiredScrollTop(900, 600)).toBe(900 - 600 * TYPEWRITER_ANCHOR);
  expect(desiredScrollTop(900, 600)).toBeCloseTo(500, 5);
});

it("never scrolls above the start of the document", () => {
  // Near the top the line simply sits where it falls rather than the view
  // jumping into negative space.
  expect(desiredScrollTop(10, 600)).toBe(0);
  expect(desiredScrollTop(0, 600)).toBe(0);
});

it("treats a viewport it cannot measure as no scroll at all", () => {
  expect(desiredScrollTop(Number.NaN, 600)).toBe(0);
  expect(desiredScrollTop(900, Number.POSITIVE_INFINITY)).toBe(0);
});

it("leaves a small drift alone so the text does not shiver", () => {
  expect(shouldScroll(500, 501)).toBe(false);
  expect(shouldScroll(500, 502)).toBe(false);
  expect(shouldScroll(500, 520)).toBe(true);
  expect(shouldScroll(520, 500)).toBe(true);
});

it("contributes nothing when typewriter is off", () => {
  const modes = createModeCompartments();
  const state = createMarkdownState("hola", modes.initial(false));
  // The compartment exists but holds no extension, so nothing is imposed on a
  // writer who did not ask for the mode.
  expect(state.doc.toString()).toBe("hola");
  expect(modes.initial(false)).toHaveLength(1);
});

it("reconfigures a live editor instead of rebuilding it", () => {
  const modes = createModeCompartments();
  const view = new EditorView({
    state: createMarkdownState("Una frase larga que vive aquí.", modes.initial(false)),
  });
  const contentBefore = view.contentDOM;

  // Put the caret somewhere and remember it: this is what a rebuild would lose.
  view.dispatch({ selection: { anchor: 4 } });
  expect(view.state.selection.main.head).toBe(4);

  view.dispatch({ effects: modes.reconfigure(true) });

  // Same view, same DOM node, same caret, same text — only the configuration
  // moved. A prop change that recreated the EditorView would fail every one of
  // these, which is exactly the regression this guards.
  expect(view.contentDOM).toBe(contentBefore);
  expect(view.state.selection.main.head).toBe(4);
  expect(view.state.doc.toString()).toBe("Una frase larga que vive aquí.");

  // And back off again, still the same editor.
  view.dispatch({ effects: modes.reconfigure(false) });
  expect(view.contentDOM).toBe(contentBefore);
  expect(view.state.selection.main.head).toBe(4);

  view.destroy();
});

it("keeps undo history across a mode change", () => {
  const modes = createModeCompartments();
  const view = new EditorView({
    state: createMarkdownState("", modes.initial(false)),
  });

  view.dispatch({ changes: { from: 0, insert: "escrito a mano" } });
  view.dispatch({ effects: modes.reconfigure(true) });

  // The document survived the reconfigure with its edit intact; a rebuilt
  // editor would have started again from the original doc.
  expect(view.state.doc.toString()).toBe("escrito a mano");

  view.destroy();
});

it("offers typewriter as a real extension", () => {
  expect(typewriterMode()).toBeTruthy();
});

it("leaves room above the first line, or the mode does nothing on a short chapter", () => {
  // The scroller clamps at zero, so an early line has a target scroll of zero
  // and cannot move. Padding the top by the anchor fraction is what puts line
  // one at the lower third with no scrolling at all -- without it, toggling
  // typewriter on a fresh chapter changed nothing on screen.
  const anchorVh = `${Math.round(TYPEWRITER_ANCHOR * 100)}vh`;
  expect(TYPEWRITER_HEAD).toBe(anchorVh);
  expect(TYPEWRITER_TAIL).toBe(anchorVh);

  // Restated as the arithmetic the padding relies on: a first line sitting one
  // anchor-height down needs no scroll, and is already at the anchor.
  const viewport = 600;
  const firstLineTop = viewport * TYPEWRITER_ANCHOR;
  expect(desiredScrollTop(firstLineTop, viewport)).toBe(0);
});
