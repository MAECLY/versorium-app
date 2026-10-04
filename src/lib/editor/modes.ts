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

/**
 * Typewriter mode: the caret's line rides at the lower third.
 *
 * The selector is `&.cm-editor .cm-content`, not `.cm-content`, on purpose.
 * styles.css sets `.cm-editor .cm-content { padding: 48px 24px 120px }` at
 * specificity 0,2,0 — the same as a plain theme rule — and style-mod inserts
 * the theme's <style> at the top of <head>, so the app stylesheet came later
 * and won. The head and tail padding never rendered: typewriter mode did
 * nothing on a chapter shorter than the window, which is exactly the bug this
 * padding exists to fix. The extra class makes it 0,3,0 and it wins on
 * specificity rather than on insertion order, which nobody controls.
 */
export function typewriterMode(): Extension {
  return [
    typewriterScroller(),
    EditorView.theme({
      "&.cm-editor .cm-content": { paddingTop: TYPEWRITER_HEAD, paddingBottom: TYPEWRITER_TAIL },
    }),
  ];
}

/**
 * Typewriter behind a compartment so it can be switched on a live editor.
 *
 * This is the whole point: a prop change that rebuilt the view would throw away
 * focus, selection and undo history mid-sentence. Reconfiguring a compartment
 * leaves the state intact.
 *
 * Focus has no editor half. Its 12vh of air and 1.02em never rendered (the
 * cascade typewriter's padding once lost), and making them render would move
 * or re-wrap every line under the caret each time Focus is toggled. Focus is
 * what it hides: src/lib/chrome/chrome.ts.
 */
export function createModeCompartments(): {
  typewriter: Compartment;
  initial: (typewriter: boolean) => Extension[];
  reconfigure: (typewriter: boolean) => ReturnType<Compartment["reconfigure"]>[];
} {
  const typewriter = new Compartment();
  const forTypewriter = (on: boolean): Extension => (on ? typewriterMode() : []);
  return {
    typewriter,
    initial: (t) => [typewriter.of(forTypewriter(t))],
    reconfigure: (t) => [typewriter.reconfigure(forTypewriter(t))],
  };
}
