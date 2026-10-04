import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { notices } from "./state.svelte";
import { caretOverlap, scrollMarginBottom } from "./cover";

/**
 * The manuscript and the notice stack share the foot of the window. These keep
 * the line being written out from under it: CodeMirror treats the covered strip
 * as off screen while the writer types, and a notice that lands on the caret's
 * line scrolls the line up once, never the page to a caret scrolled away from.
 */

/** CodeMirror's bottom scroll margin, read each time it scrolls the caret into view. */
export function clearOfNotices(): Extension {
  return EditorView.scrollMargins.of((view) => {
    const bottom = scrollMarginBottom(
      view.scrollDOM.getBoundingClientRect(),
      view.contentDOM.getBoundingClientRect(),
      notices.coverRect(),
    );
    return bottom > 0 ? { bottom } : null;
  });
}

/**
 * How much room the page needs below its last line for that line to clear
 * the stack: the strip of the scroller the stack covers.
 */
export function roomForNotices(view: EditorView): number {
  return scrollMarginBottom(
    view.scrollDOM.getBoundingClientRect(),
    view.contentDOM.getBoundingClientRect(),
    notices.coverRect(),
  );
}

/** The stack just landed on the caret's line: scroll the line above it. */
export function liftCaret(view: EditorView): boolean {
  const cover = notices.coverRect();
  if (!cover) return false;
  const head = view.state.selection.main.head;
  const overlap = caretOverlap(
    view.coordsAtPos(head),
    view.scrollDOM.getBoundingClientRect(),
    view.contentDOM.getBoundingClientRect(),
    cover,
  );
  if (overlap <= 0) return false;
  view.dispatch({ effects: EditorView.scrollIntoView(head, { y: "nearest" }) });
  return true;
}
