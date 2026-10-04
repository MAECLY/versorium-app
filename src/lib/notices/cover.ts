/**
 * Where a notice would hide the manuscript, worked out from boxes alone so it
 * can be tested without a browser. Notices sit above the status bar, over the
 * foot of the page; these say how much of the page they take from the caret.
 */

/** The part of a DOMRect these read; viewport pixels. */
export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** The notice stack's box. It runs down to the scroller's foot, so its top is all that matters vertically. */
export interface Cover {
  top: number;
  left: number;
  right: number;
}

/** The stack is over the text column, not beside it in a wide window's margin. */
export function overText(content: Pick<Box, "left" | "right">, cover: Cover): boolean {
  return cover.left < content.right && cover.right > content.left;
}

/**
 * How much of the scroller's foot the stack hides: CodeMirror's bottom scroll
 * margin, so typing keeps the caret above it. Zero when the stack sits beside
 * the text column, or ends above the scroller.
 */
export function scrollMarginBottom(
  scroller: Pick<Box, "top" | "bottom">,
  content: Pick<Box, "left" | "right">,
  cover: Cover | null,
): number {
  if (!cover || !overText(content, cover)) return 0;
  return Math.max(0, scroller.bottom - Math.max(cover.top, scroller.top));
}

/**
 * How far the caret's line runs under the stack. Zero when it is clear of it,
 * and zero when the line is off screen: the writer scrolled away from the
 * caret, and a notice must not pull the page back to it.
 */
export function caretOverlap(
  caret: Pick<Box, "top" | "bottom"> | null,
  scroller: Pick<Box, "top" | "bottom">,
  content: Pick<Box, "left" | "right">,
  cover: Cover | null,
): number {
  if (!caret || !cover || !overText(content, cover)) return 0;
  if (caret.bottom <= scroller.top || caret.top >= scroller.bottom) return 0;
  return Math.max(0, caret.bottom - cover.top);
}
