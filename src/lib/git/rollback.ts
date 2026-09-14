import type { EditorView } from "@codemirror/view";
import type { Op } from "$lib/tauri";

export interface SelSnap {
  from: number;
  to: number;
  text: string;
  ts: number;
}

const MAX_SNAPS = 300;
const snaps = new Map<string, SelSnap[]>();

/** Remember the text under a selection (called on every selection change). */
export function snapshotSelection(
  chapterId: string,
  from: number,
  to: number,
  text: string,
): void {
  if (to <= from) return;
  const list = snaps.get(chapterId) ?? [];
  list.push({ from, to, text, ts: Date.now() });
  while (list.length > MAX_SNAPS) list.shift();
  snaps.set(chapterId, list);
}

export function clearSnaps(chapterId: string): void {
  snaps.delete(chapterId);
}

/** Most recent snapshot intersecting [from, to]. */
export function findSnap(chapterId: string, from: number, to: number): SelSnap | null {
  const list = snaps.get(chapterId);
  if (!list) return null;
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    if (s.to > from && s.from < to) return s;
  }
  return null;
}

/** Expand a cursor position to word boundaries (unicode-aware). */
export function wordRange(doc: string, pos: number): { from: number; to: number } {
  const isWord = (c: string) => /\p{L}|\p{N}|_/u.test(c);
  let from = pos;
  let to = pos;
  while (from > 0 && isWord(doc[from - 1])) from--;
  while (to < doc.length && isWord(doc[to])) to++;
  if (to === from) {
    from = Math.max(0, from - 1);
    to = Math.min(doc.length, to + 1);
  }
  return { from, to };
}

/**
 * Restore the snapshotted text over the intersection of [from, to] and the
 * stored selection. Applies the change to the view and returns the rollback
 * op (caller logs it), or null when nothing applicable was stored.
 */
export function applyRollback(
  view: EditorView,
  chapterId: string,
  from: number,
  to: number,
): Op | null {
  const snap = findSnap(chapterId, from, to);
  if (!snap) return null;
  const f = Math.max(from, snap.from);
  const t = Math.min(to, snap.to);
  if (t <= f) return null;
  const restored = snap.text.slice(f - snap.from, t - snap.from);
  view.dispatch({
    changes: { from: f, to: t, insert: restored },
    selection: { anchor: t },
  });
  return {
    seq: 0,
    ts: Date.now(),
    author: "human",
    kind: "rollback",
    from: f,
    to: t,
    text: restored,
  };
}
