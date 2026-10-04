import { EditorView } from "@codemirror/view";

/**
 * A mousedown handler for controls a press must not move focus for: the
 * Hide buttons, the rail and the lip. Without it a click takes the caret out
 * of the manuscript in either engine: WebKit, the macOS app's, gives focus to
 * nothing (a button there takes none from a click) and leaves it on <body>,
 * and Chrome gives it to the button. Keyboard activation is untouched, so
 * focus that was really on the control still moves on from it.
 */
export function keepFocusOnPress(event: MouseEvent): void {
  event.preventDefault();
}

/**
 * Gives focus back to an element without scrolling to it, and returns whether
 * it landed.
 *
 * The manuscript goes through CodeMirror's own focus(), which redraws the DOM
 * selection from the editor's state in the same call. A bare focus() leaves
 * the engine to place the DOM caret and counts on CodeMirror's focus handler,
 * which runs 10 ms later, to put it back before a selectionchange is read as
 * the writer moving it. In Chrome and in WebKit that race is won today; the
 * writer's caret should not depend on it. preventScroll everywhere keeps
 * Typewriter's centring from being fought.
 */
export function restoreFocus(el: Element | null | undefined): boolean {
  if (!(el instanceof HTMLElement) || !el.isConnected) return false;
  const editor = el.closest(".cm-editor");
  const view = editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null;
  if (view) view.focus();
  else el.focus({ preventScroll: true });
  return el.ownerDocument.activeElement === (view ? view.contentDOM : el);
}
