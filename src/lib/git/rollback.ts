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
