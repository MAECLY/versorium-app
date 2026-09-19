import { describe, expect, it } from "vitest";
import { lineDiff } from "./diff";

describe("lineDiff", () => {
  it("marks identical text as unchanged", () => {
    expect(lineDiff("a\nb", "a\nb")).toEqual([
      { kind: "same", text: "a" },
      { kind: "same", text: "b" },
    ]);
  });
  it("keeps the common prefix and suffix around the changed middle", () => {
    expect(lineDiff("intro\nold\nend", "intro\nnew\nend")).toEqual([
      { kind: "same", text: "intro" },
      { kind: "del", text: "old" },
      { kind: "add", text: "new" },
      { kind: "same", text: "end" },
    ]);
  });
  it("shows a full replacement as every line removed then added", () => {
    expect(lineDiff("x\ny", "p\nq\nr")).toEqual([
      { kind: "del", text: "x" },
      { kind: "del", text: "y" },
      { kind: "add", text: "p" },
      { kind: "add", text: "q" },
      { kind: "add", text: "r" },
    ]);
  });
  it("handles empty strings on either side", () => {
    expect(lineDiff("", "")).toEqual([{ kind: "same", text: "" }]);
    expect(lineDiff("", "new")).toEqual([
      { kind: "del", text: "" },
      { kind: "add", text: "new" },
    ]);
    expect(lineDiff("gone", "")).toEqual([
      { kind: "del", text: "gone" },
      { kind: "add", text: "" },
    ]);
  });
});
