import { EditorState, type ChangeSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { RollbackHistory, wordRange } from "./rollback";

/** An editor's document and history, fed one transaction per key, as the editor records them. */
function editor(text = "") {
  let state = EditorState.create({ doc: text });
  const history = new RollbackHistory();
  const apply = (changes: ChangeSpec) => {
    const tr = state.update({ changes });
    history.record(tr.changes, state.doc);
    state = tr.state;
  };
  return {
    doc: () => state.doc.toString(),
    type(at: number, word: string) {
      for (let i = 0; i < word.length; i += 1) apply({ from: at + i, insert: word[i] });
    },
    backspace(at: number, times: number) {
      for (let i = 0; i < times; i += 1) apply({ from: at - i - 1, to: at - i });
    },
    apply,
    /** Restore the word under `pos`, as the status bar's button does with no selection. */
    restoreWord(pos: number) {
      const range = wordRange(state.doc.toString(), pos);
      const change = history.take(state.doc.toString(), range.from, range.to);
      if (change) apply({ from: change.from, to: change.to, insert: change.text });
      return change !== null;
    },
  };
}

describe("RollbackHistory", () => {
  it("takes back a word typed key by key in one press", () => {
    const e = editor("El faro ");
    e.type(8, "giraba");
    expect(e.doc()).toBe("El faro giraba");
    expect(e.restoreWord(14)).toBe(true);
    expect(e.doc()).toBe("El faro ");
  });

  it("keeps each typed word apart, so Restore takes the one under the caret only", () => {
    const e = editor("");
    e.type(0, "uno");
    e.apply({ from: 3, insert: " " });
    e.type(4, "dos");
    expect(e.restoreWord(7)).toBe(true);
    expect(e.doc()).toBe("uno ");
    expect(e.restoreWord(2)).toBe(true);
    expect(e.doc()).toBe(" ");
  });

  it("gives back a word erased with Backspace in one press", () => {
    const e = editor("El faro giraba.");
    e.backspace(14, 6);
    expect(e.doc()).toBe("El faro .");
    expect(e.restoreWord(8)).toBe(true);
    expect(e.doc()).toBe("El faro giraba.");
  });

  it("restores a word replaced by typing to the word it was", () => {
    const e = editor("El faro giraba.");
    // The first key replaces the selected word, the rest carry on.
    e.apply({ from: 8, to: 14, insert: "r" });
    e.type(9, "odaba");
    expect(e.doc()).toBe("El faro rodaba.");
    expect(e.restoreWord(12)).toBe(true);
    expect(e.doc()).toBe("El faro giraba.");
  });

  it("does not join keys across a space or a jump elsewhere", () => {
    const e = editor("ab cd");
    e.type(2, "x"); // abx cd
    e.type(5, "y"); // abx cyd: another word, another edit
    expect(e.restoreWord(5)).toBe(true);
    expect(e.doc()).toBe("abx cd");
    expect(e.restoreWord(1)).toBe(true);
    expect(e.doc()).toBe("ab cd");
  });
});
