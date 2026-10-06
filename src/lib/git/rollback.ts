import type { ChangeSet, Text } from "@codemirror/state";
import type { Op } from "$lib/tauri";

interface Edit {
  from: number;
  to: number;
  previous: string;
  current: string;
}

export interface RollbackChange {
  from: number;
  to: number;
  text: string;
  op: Op;
}

const MAX_EDITS = 1000;

/** Session history for one editor. Offsets follow unrelated edits to the document. */
export class RollbackHistory {
  private edits: Edit[] = [];

  clear(): void { this.edits = []; }

  /** Discard an older edit only when a newer change overlaps its text. */
  map(changes: ChangeSet): void {
    this.edits = this.edits.filter((edit) => {
      let overlaps = false;
      changes.iterChangedRanges((from, to) => {
        if (edit.from === edit.to) {
          if (from <= edit.from && to >= edit.to) overlaps = true;
        } else if (from === to) {
          if (from > edit.from && from < edit.to) overlaps = true;
        } else if (from < edit.to && to > edit.from) overlaps = true;
      });
      return !overlaps;
    }).map((edit) => {
      const from = changes.mapPos(edit.from, 1);
      return { ...edit, from, to: edit.from === edit.to ? from : changes.mapPos(edit.to, -1) };
    });
  }

  record(changes: ChangeSet, before: Text): void {
    // A word typed key by key arrives as one change per key; so does a word
    // erased with Backspace. Restore promises the word, so a key that carries
    // on the latest edit within the same word joins it instead of starting
    // one of its own. Checked before map(): an erase at the previous erase's
    // point overlaps it, and map() would drop it.
    const last = this.edits[this.edits.length - 1];
    const joined = last ? joinedKey(last, changes, before) : null;
    if (joined) {
      this.edits.pop();
      this.map(changes);
      this.edits.push(joined);
      return;
    }
    this.map(changes);
    changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
      this.edits.push({
        from: fromB, to: toB,
        previous: before.sliceString(fromA, toA), current: inserted.toString(),
      });
    });
    if (this.edits.length > MAX_EDITS) this.edits.splice(0, this.edits.length - MAX_EDITS);
  }

  /** Undo the latest contained change; never replace text outside the chosen scope. */
  take(doc: string, from: number, to: number): RollbackChange | null {
    if (from < 0 || to < from || to > doc.length) return null;
    for (let i = this.edits.length - 1; i >= 0; i--) {
      const edit = this.edits[i];
      if (edit.from < from || edit.to > to) continue;
      if (doc.slice(edit.from, edit.to) !== edit.current) continue;
      this.edits.splice(i, 1);
      return {
        from: edit.from, to: edit.to, text: edit.previous,
        op: {
          seq: 0, ts: Date.now(), author: "human", kind: "rollback",
          from: edit.from, to: edit.to, text: edit.previous,
        },
      };
    }
    return null;
  }
}

const WORD = /^[\p{L}\p{N}\p{M}_]+$/u;

/**
 * The latest edit with one more key of the same word, or null.
 *
 * Typing: an insertion of word characters right where the edit's text ends,
 * which is itself word characters. Erasing: a deletion of word characters
 * ending where the edit erased its own, so the word's letters come back
 * together. Anything else (a space, a paste elsewhere, a second change in
 * the same transaction) starts an edit of its own, which keeps every edit
 * inside one word, the scope Restore acts on.
 */
function joinedKey(last: Edit, changes: ChangeSet, before: Text): Edit | null {
  let count = 0;
  let single: { fromA: number; toA: number; inserted: string } | null = null;
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    count += 1;
    single = { fromA, toA, inserted: inserted.toString() };
  });
  if (count !== 1 || !single) return null;
  const { fromA, toA, inserted } = single as { fromA: number; toA: number; inserted: string };
  const typed = fromA === toA && WORD.test(inserted);
  if (typed && WORD.test(last.current) && last.to === fromA) {
    return { from: last.from, to: last.to + inserted.length, previous: last.previous, current: last.current + inserted };
  }
  const erased = before.sliceString(fromA, toA);
  if (inserted === "" && WORD.test(erased) && last.current === "" && last.from === last.to && last.from === toA && WORD.test(last.previous)) {
    return { from: fromA, to: fromA, previous: erased + last.previous, current: "" };
  }
  return null;
}

/** Word boundaries include combining marks and supplementary-plane letters. */
export function wordRange(doc: string, pos: number): { from: number; to: number } {
  const bounded = Math.max(0, Math.min(doc.length, pos));
  for (const match of doc.matchAll(/[\p{L}\p{N}\p{M}_]+/gu)) {
    const from = match.index;
    const to = from + match[0].length;
    if (from <= bounded && to >= bounded) return { from, to };
    if (from > bounded) break;
  }
  // A collapsed range also lets a completely deleted word be restored at the caret.
  return { from: bounded, to: bounded };
}
