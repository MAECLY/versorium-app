import { describe, expect, it } from "vitest";
import { CLEARANCE, caretOverlap, scrollMarginBottom } from "$lib/notices/cover";

// The arithmetic that keeps a notice off the line being written
// (src/lib/notices/cover.ts). The editor feeds it real boxes; these are the
// shapes of a 1280×800 window with the panel open and a two-notice stack.

const scroller = { top: 48, bottom: 768 };
const column = { left: 356, right: 1164 };
const stack = { top: 680, left: 884, right: 1264 };

describe("the scroll margin", () => {
  it("is the height of the scroller the stack covers, and a little air, when it covers the text column", () => {
    expect(scrollMarginBottom(scroller, column, stack)).toBe(88 + CLEARANCE);
  });

  it("is nothing when the stack sits beside the column, in a wide window's margin", () => {
    expect(scrollMarginBottom(scroller, { left: 356, right: 884 }, stack)).toBe(0);
    expect(scrollMarginBottom(scroller, { left: 1264, right: 1900 }, stack)).toBe(0);
  });

  it("is nothing without a stack, and never more than the scroller", () => {
    expect(scrollMarginBottom(scroller, column, null)).toBe(0);
    expect(scrollMarginBottom(scroller, column, { ...stack, top: 0 })).toBe(720);
    expect(scrollMarginBottom(scroller, column, { ...stack, top: 900 })).toBe(0);
  });
});

describe("the caret's line under the stack", () => {
  it("measures how far the line runs under it", () => {
    expect(caretOverlap({ top: 700, bottom: 736 }, scroller, column, stack)).toBe(56 + CLEARANCE);
  });

  it("is nothing when the line is clear of it", () => {
    expect(caretOverlap({ top: 600, bottom: 636 }, scroller, column, stack)).toBe(0);
    expect(caretOverlap({ top: 636, bottom: 672 }, scroller, column, stack), "with its air above the stack").toBe(0);
  });

  it("counts a line that touches the stack as under it: it needs its air", () => {
    expect(caretOverlap({ top: 644, bottom: 680 }, scroller, column, stack)).toBe(CLEARANCE);
  });

  it("is nothing when the stack is beside the column", () => {
    expect(caretOverlap({ top: 700, bottom: 736 }, scroller, { left: 356, right: 884 }, stack)).toBe(0);
  });

  it("is nothing when the writer scrolled the caret off screen, either way", () => {
    expect(caretOverlap({ top: 790, bottom: 826 }, scroller, column, stack), "below the page").toBe(0);
    expect(caretOverlap({ top: 0, bottom: 36 }, scroller, column, stack), "above the page").toBe(0);
    expect(caretOverlap(null, scroller, column, stack), "not drawn at all").toBe(0);
  });
});
