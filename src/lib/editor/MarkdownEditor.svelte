<script lang="ts">
  import { untrack } from "svelte";
  import { Annotation, Compartment, EditorState } from "@codemirror/state";
  import { EditorView } from "@codemirror/view";
  import { createMarkdownState } from "./cm";
  import { t } from "$lib/i18n";
  import { OpsLogger } from "$lib/git/ops";
  import { RollbackHistory, wordRange } from "$lib/git/rollback";
  import type { Op } from "$lib/tauri";

  interface Props {
    doc: string;
    projectPath: string;
    chapterId: string;
    disabled?: boolean;
    onChange: (body: string) => void;
    onOps?: (path: string, chapter: string, body: string, ops: Op[]) => Promise<unknown>;
    onOpsError?: (error: unknown) => void;
  }

  let { doc, projectPath, chapterId, disabled = false, onChange, onOps, onOpsError }: Props = $props();
  let host: HTMLDivElement | undefined = $state();
  let view: EditorView | undefined = $state.raw();
  let logger: OpsLogger | undefined;
  let history = new RollbackHistory();
  const source = Annotation.define<"external" | "rollback">();
  const editable = new Compartment();
  const editing = (locked: boolean) => [EditorState.readOnly.of(locked), EditorView.editable.of(!locked)];

  $effect(() => {
    const parent = host;
    const path = projectPath;
    const chapter = chapterId;
    if (!parent || !path || !chapter) return;
    const initialDoc = untrack(() => doc);
    const sink = untrack(() => onOps);
    const localHistory = new RollbackHistory();
    history = localHistory;
    const localLogger = sink
      ? new OpsLogger((body, ops) => sink(path, chapter, body, ops), initialDoc, (error) => onOpsError?.(error))
      : undefined;
    logger = localLogger;
    const created = new EditorView({
      parent,
      state: createMarkdownState(initialDoc, [
        editable.of(editing(untrack(() => disabled))),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const ops: Op[] = [];
          let notify = false;
          for (const transaction of update.transactions) {
            if (!transaction.docChanged) continue;
            const origin = transaction.annotation(source);
            if (origin === "external") {
              localHistory.clear();
              localLogger?.reset(transaction.newDoc.toString());
              continue;
            }
            notify = true;
            if (origin === "rollback") {
              localHistory.map(transaction.changes);
              continue;
            }
            localHistory.record(transaction.changes, transaction.startState.doc);
            const ts = Date.now();
            transaction.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
              if (toA > fromA) ops.push({
                seq: 0, ts, author: "human", kind: "delete", from: fromA, to: toA,
                text: transaction.startState.sliceDoc(fromA, toA),
              });
              if (toB > fromB) ops.push({
                seq: 0, ts, author: "human", kind: "insert", from: fromB, to: toB, text: inserted.toString(),
              });
            });
          }
          const body = update.state.doc.toString();
          if (ops.length) localLogger?.trackOps(body, ops);
          if (notify) onChange(body);
        }),
      ]),
    });
    view = created;
    return () => {
      localLogger?.dispose();
      created.destroy();
      localHistory.clear();
      if (view === created) view = undefined;
      if (logger === localLogger) logger = undefined;
    };
  });

  $effect(() => {
    const body = doc;
    const current = view;
    if (current && current.state.doc.toString() !== body) {
      current.dispatch({
        changes: { from: 0, to: current.state.doc.length, insert: body },
        annotations: source.of("external"),
      });
    }
  });

  $effect(() => {
    view?.dispatch({ effects: editable.reconfigure(editing(disabled)) });
  });

  function rollback(from: number, to: number): boolean {
    if (!view || disabled) return false;
    const change = history.take(view.state.doc.toString(), from, to);
    if (!change) return false;
    view.dispatch({
      changes: { from: change.from, to: change.to, insert: change.text },
      selection: { anchor: change.from + change.text.length },
      annotations: source.of("rollback"),
    });
    logger?.addRaw(change.op, view.state.doc.toString());
    return true;
  }

  export function rollbackWord(): boolean {
    if (!view) return false;
    const { from, to } = wordRange(view.state.doc.toString(), view.state.selection.main.head);
    return rollback(from, to);
  }

  export function rollbackSelection(): boolean {
    const selection = view?.state.selection.main;
    return !!selection && selection.from < selection.to && rollback(selection.from, selection.to);
  }

  export function getSelection(): { from: number; to: number; text: string } | null {
    if (!view) return null;
    const selection = view.state.selection.main;
    if (selection.empty) return null;
    return { from: selection.from, to: selection.to, text: view.state.sliceDoc(selection.from, selection.to) };
  }

  /** Replace a range the Rust side already persisted (no human ops are logged).
   *  With `expected`, refuses when the passage no longer matches. */
  export function applyExternal(from: number, to: number, text: string, expected?: string): boolean {
    if (!view || from < 0 || from > to || to > view.state.doc.length) return false;
    if (expected !== undefined && view.state.sliceDoc(from, to) !== expected) return false;
    view.dispatch({ changes: { from, to, insert: text }, annotations: source.of("external") });
    return true;
  }

  export function getDoc(): string {
    return view?.state.doc.toString() ?? "";
  }

  export function flushOps(): Promise<void> {
    return logger?.flushNow() ?? Promise.resolve();
  }
</script>

<div class="h-full min-h-0" bind:this={host} aria-label={t("binder.chapters")} role="textbox"></div>
