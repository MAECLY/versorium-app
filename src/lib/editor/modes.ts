import { Compartment, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * Where the active line sits in typewriter mode, as a fraction of the viewport
 * height measured from the top. DESIGN asks for "línea activa al tercio
 * inferior" — two thirds down is the top edge of that lower third.
 */
export const TYPEWRITER_ANCHOR = 2 / 3;

/**
 * Scroll offset that puts a line at the typewriter anchor.
 *
 * Kept pure so the arithmetic can be tested without a DOM: the extension below
 * only feeds it measurements. Clamped at zero because the document cannot
 * scroll above its own start — near the top the line simply sits wherever it
 * naturally falls rather than the view jumping into negative space.
 */
export function desiredScrollTop(
  lineTop: number,
  viewportHeight: number,
  anchor: number = TYPEWRITER_ANCHOR,
): number {
  if (!Number.isFinite(lineTop) || !Number.isFinite(viewportHeight)) return 0;
  return Math.max(0, lineTop - viewportHeight * anchor);
}

/**
 * Whether a scroll is worth performing. Re-scrolling by a pixel on every
 * keystroke makes the text shiver, so a small drift is left alone.
 */
export function shouldScroll(current: number, desired: number, tolerance = 2): boolean {
  return Math.abs(current - desired) > tolerance;
}

/**
 * Room below the last line so it can still reach the anchor. Without it the
 * document ends before two thirds of the viewport and the final paragraphs
 * refuse to lift.
 */
export const TYPEWRITER_TAIL = `${Math.round(TYPEWRITER_ANCHOR * 100)}vh`;

/**
 * Room *above* the first line, for the same reason in the other direction.
 *
 * Without it the mode was a no-op on any chapter shorter than two thirds of a
 * screen: `desiredScrollTop` clamps at zero, so an early line's target scroll
 * is zero and nothing moves. A writer opening a fresh chapter, toggling
 * typewriter and seeing the caret stay exactly where it was concluded the
 * button was dead -- and was right to.
 */
export const TYPEWRITER_HEAD = TYPEWRITER_TAIL;

function typewriterScroller(): Extension {
  return EditorView.updateListener.of((update) => {
    if (!update.selectionSet && !update.docChanged && !update.geometryChanged) return;
    const view = update.view;
    view.requestMeasure({
      read(v) {
        const head = v.state.selection.main.head;
        return { lineTop: v.lineBlockAt(head).top, height: v.scrollDOM.clientHeight };
      },
      write({ lineTop, height }, v) {
        if (height <= 0) return;
        const desired = desiredScrollTop(lineTop, height);
        if (shouldScroll(v.scrollDOM.scrollTop, desired)) v.scrollDOM.scrollTop = desired;
      },
    });
  });
}

/** Typewriter mode: the caret's line rides at the lower third. */
export function typewriterMode(): Extension {
  return [
    typewriterScroller(),
    EditorView.theme({
      ".cm-content": { paddingTop: TYPEWRITER_HEAD, paddingBottom: TYPEWRITER_TAIL },
    }),
  ];
}

/**
 * Focus mode, editor side. The measure is already 72ch in the stylesheet, so
 * what this adds is air: the column is the only thing left on screen once the
 * chrome fades, and it should not start hard against the top edge.
 */
export function focusMode(): Extension {
  return EditorView.theme({
    ".cm-content": { paddingTop: "12vh" },
    "&": { fontSize: "1.02em" },
  });
}

/**
 * Both modes behind compartments so they can be switched on a live editor.
 *
 * This is the whole point: a prop change that rebuilt the view would throw away
 * focus, selection and undo history mid-sentence. Reconfiguring a compartment
 * leaves the state intact.
 */
export function createModeCompartments(): {
  focus: Compartment;
  typewriter: Compartment;
  initial: (focus: boolean, typewriter: boolean) => Extension[];
  reconfigure: (focus: boolean, typewriter: boolean) => ReturnType<Compartment["reconfigure"]>[];
} {
  const focus = new Compartment();
  const typewriter = new Compartment();
  const forFocus = (on: boolean): Extension => (on ? focusMode() : []);
  const forTypewriter = (on: boolean): Extension => (on ? typewriterMode() : []);
  return {
    focus,
    typewriter,
    initial: (f, t) => [focus.of(forFocus(f)), typewriter.of(forTypewriter(t))],
    reconfigure: (f, t) => [
      focus.reconfigure(forFocus(f)),
      typewriter.reconfigure(forTypewriter(t)),
    ],
  };
}
