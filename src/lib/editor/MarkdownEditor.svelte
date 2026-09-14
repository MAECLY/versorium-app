<script lang="ts">
  import { EditorView } from "@codemirror/view";
  import { createMarkdownState } from "./cm";
  import { t } from "$lib/i18n";
  import { OpsLogger } from "$lib/git/ops";
  import {
    snapshotSelection,
    clearSnaps,
    wordRange,
    applyRollback,
  } from "$lib/git/rollback";
  import type { Op } from "$lib/tauri";

  interface Props {
    doc: string;
    chapterId: string;
    onChange: (body: string) => void;
    /** Sinks derived ops to the Rust ops log. */
    onOps?: (body: string, ops: Op[]) => Promise<unknown>;
  }

  let { doc, chapterId, onChange, onOps }: Props = $props();

  let host: HTMLDivElement | undefined = $state();
  let view: EditorView | undefined;
  let activeId = $state("");
  let logger: OpsLogger | undefined;
  let skipDerive = false;

  $effect(() => {
    const id = chapterId;
    const d = doc;
    if (!host || !id) return;

    logger?.flushNow();
    clearSnaps(id);

    if (view && activeId === id) {
      // Same chapter: only sync when the doc changed from outside (e.g. rollback).
      if (view.state.doc.toString() !== d) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: d } });
      }
      logger?.reset(d);
      return;
    }

    // New chapter (or first mount): rebuild the editor.
    view?.destroy();
    activeId = id;
    logger = onOps
      ? new OpsLogger((body, ops) => onOps(body, ops), d)
      : undefined;
    view = new EditorView({
      parent: host,
      state: createMarkdownState(d, [
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            const body = u.state.doc.toString();
            onChange(body);
            if (!skipDerive) logger?.track(body, "human");
            skipDerive = false;
          } else if (u.selectionSet) {
            const s = u.state.selection.main;
            if (s.from < s.to) {
              snapshotSelection(id, s.from, s.to, u.state.sliceDoc(s.from, s.to));
            }
          }
        }),
      ]),
    });
  });

  /** Restore the word under the cursor from the last selection snapshot. */
  export function rollbackWord(): boolean {
    const v = view;
    if (!v || !logger) return false;
    const pos = v.state.selection.main.head;
    const { from, to } = wordRange(v.state.doc.toString(), pos);
    const op = applyRollback(v, activeId, from, to);
    if (!op) return false;
    skipDerive = true;
    logger.addRaw(op);
    return true;
  }

  /** Restore the current selection from the last selection snapshot. */
  export function rollbackSelection(): boolean {
    const v = view;
    if (!v || !logger) return false;
    const s = v.state.selection.main;
    if (s.from >= s.to) return false;
    const op = applyRollback(v, activeId, s.from, s.to);
    if (!op) return false;
    skipDerive = true;
    logger.addRaw(op);
    return true;
  }

  /** Current selection in body coordinates, or null when collapsed. */
  export function getSelection(): { from: number; to: number; text: string } | null {
    const v = view;
    if (!v) return null;
    const s = v.state.selection.main;
    if (s.from >= s.to) return null;
    return { from: s.from, to: s.to, text: v.state.sliceDoc(s.from, s.to) };
  }

  /** Replace [from, to) with `text` without logging it as a human op
   *  (the Rust side records the ai:<provider> ops instead). */
  export function applyExternal(from: number, to: number, text: string): boolean {
    const v = view;
    if (!v) return false;
    const len = v.state.doc.length;
    if (from > to || to > len) return false;
    skipDerive = true;
    v.dispatch({ changes: { from, to, insert: text } });
    return true;
  }

  /** Flush pending ops immediately (called before commit / checkpoint). */
  export function flushOps(): Promise<void> {
    return logger?.flushNow() ?? Promise.resolve();
  }
</script>

<div class="h-full min-h-0" bind:this={host} aria-label={t("binder.chapters")} role="textbox"></div>
