<script lang="ts">
  import { untrack } from "svelte";
  import { Annotation, Compartment, EditorState } from "@codemirror/state";
  import { EditorView } from "@codemirror/view";
  import { createMarkdownState } from "./cm";
  import { createModeCompartments } from "./modes";
  import { EDITOR_DEFAULTS, createPreferenceCompartments, type EditorPreferences } from "./preferences";
  import { t } from "$lib/i18n";
  import { OpsLogger } from "$lib/git/ops";
  import { RollbackHistory, wordRange } from "$lib/git/rollback";
  import { notices } from "$lib/notices/state.svelte";
  import { clearOfNotices, liftCaret, roomForNotices } from "$lib/notices/editor";
  import type { Op } from "$lib/tauri";

  interface Props {
    doc: string;
    projectPath: string;
    chapterId: string;
    disabled?: boolean;
    /** The caret's line rides at the lower third. */
    typewriter?: boolean;
    /** Settings → Editor. */
    preferences?: EditorPreferences;
    /** The novel's language (`versorium.json`), not the interface's. */
    language?: string;
    /** The stack of the face chosen under Settings → Editor → Typography; the stylesheet's own until one is read. */
    font?: string;
    /** Settings is over the page: nothing here may move it while the writer cannot see it. */
    covered?: boolean;
    onChange: (body: string) => void;
    onOps?: (path: string, chapter: string, body: string, ops: Op[]) => Promise<unknown>;
    onOpsError?: (error: unknown) => void;
  }

  let {
    doc,
    projectPath,
    chapterId,
    disabled = false,
    typewriter = false,
    preferences = EDITOR_DEFAULTS,
    language = "",
    font,
    covered = false,
    onChange,
    onOps,
    onOpsError,
  }: Props = $props();
  let host: HTMLDivElement | undefined = $state();
  let view: EditorView | undefined = $state.raw();
  let logger: OpsLogger | undefined;
  let history = new RollbackHistory();
  const source = Annotation.define<"external" | "rollback">();
  const editable = new Compartment();
  const editing = (locked: boolean) => [EditorState.readOnly.of(locked), EditorView.editable.of(!locked)];
  // The accessible name goes on CodeMirror's own editable area, the one a
  // screen reader lands in, and follows the interface's language.
  const naming = new Compartment();
  const named = (label: string) => EditorView.contentAttributes.of({ "aria-label": label });
  // Covered by Settings, the page is read-only as well as inert. The browser
  // keeps one undo stack for the whole document, and its own undo (the undo
  // key pressed anywhere in Settings, Edit → Undo in the menu) walks it into
  // the typing done here, out of CodeMirror's history and out of sight. Text
  // that is not editable is skipped by that undo, and CodeMirror ignores any
  // change to the DOM of a read-only editor.
  const locked = $derived(disabled || covered);
  // Typewriter lives in a compartment for the same reason `editable` does:
  // toggling it must reconfigure the running editor, never rebuild it. So do
  // the writer's preferences, and the novel's language with them.
  const modes = createModeCompartments();
  const choices = createPreferenceCompartments();
  // Parents pass `store.project.path` / `store.currentChapter.id`; those objects are
  // reassigned on every save. A derived string only notifies when the value changes,
  // so the editor (focus, selection, undo) survives autosave.
  const docKey = $derived(projectPath && chapterId ? `${projectPath}\u0000${chapterId}` : "");

  $effect(() => {
    const parent = host;
    const key = docKey;
    if (!parent || !key) return;
    const [path, chapter] = key.split("\u0000");
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
        editable.of(editing(untrack(() => locked))),
        naming.of(named(untrack(() => t("editor.label")))),
        ...modes.initial(untrack(() => typewriter)),
        ...choices.initial(untrack(() => preferences), untrack(() => language), untrack(() => font)),
        clearOfNotices(),
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
    view?.dispatch({ effects: editable.reconfigure(editing(locked)) });
  });

  $effect(() => {
    const label = t("editor.label");
    view?.dispatch({ effects: naming.reconfigure(named(label)) });
  });

  $effect(() => {
    view?.dispatch({ effects: modes.reconfigure(typewriter) });
  });

  // Derived for the reason docKey is: the parent reads the language off
  // `store.project`, which is replaced on every save, and an effect on the raw
  // prop would reconfigure the editor after every autosave. The face is a
  // string for the same reason: a fresh answer naming the same face changes
  // nothing.
  const novelLanguage = $derived(language);
  const fontStack = $derived(font);

  $effect(() => {
    view?.dispatch({ effects: choices.reconfigure(preferences, novelLanguage, fontStack) });
  });

  // A notice appeared, grew or went. The page gets room below its last line
  // to lift that line clear of the stack (styles.css reads --v-notes-room),
  // and the caret's line, if the stack landed on it, is scrolled above it.
  // The room only grows for this chapter: shrinking it when a notice went
  // would drop the page under a writer scrolled to its end.
  //
  // Not while Settings covers the page: the stack is over Settings then, and
  // the page keeps its layout under it, so a notice raised there would scroll
  // a page nobody can see. Coming back runs this again (`covered` is
  // tracked): to the writer, a stack still showing lands on the page then,
  // so it gets its room and is lifted off the caret's line like any other.
  // When coming back did not run it, a tall stack raised during the visit
  // kept the chapter's last lines under it, and a caret at the foot of the
  // page came back hidden.
  //
  // The lift itself only follows a change in the stack: a return from
  // Settings with the same notices up leaves the scroll where the writer
  // left it, even if they had scrolled the caret's line under a notice.
  let noticeRoom = 0;
  let liftedFor = -1;
  $effect(() => {
    const revision = notices.coverRevision;
    const current = view;
    const el = host;
    if (!current || !el || covered) return;
    untrack(() => {
      const room = roomForNotices(current);
      if (room > noticeRoom) {
        noticeRoom = room;
        el.style.setProperty("--v-notes-room", `${Math.ceil(room)}px`);
      }
      if (revision === liftedFor) return;
      liftedFor = revision;
      liftCaret(current);
    });
  });

  function rollback(from: number, to: number): boolean {
    if (!view || locked) return false;
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

<div class="h-full min-h-0" bind:this={host}></div>
