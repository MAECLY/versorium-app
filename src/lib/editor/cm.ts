import { EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap, type KeyBinding } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  indentOnInput,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { autocompletion, closeCompletion, completionKeymap, currentCompletions } from "@codemirror/autocomplete";

/**
 * The completion keys, with Escape taken only while a list is showing.
 *
 * CodeMirror's own Escape also closes a query still pending after every
 * keystroke, for about 100ms, with nothing on screen. App.svelte leaves a key
 * CodeMirror used alone, so that Escape closes the search panel or a list
 * without also ending Focus; the invisible query made it swallow the Escape a
 * writer pressed straight after typing, the one meant to leave Focus.
 * Precedence highest, as autocompletion() installs its own keymap, so the
 * arrows and Enter reach an open list before the cursor moves.
 */
const completionKeys: KeyBinding[] = [
  ...completionKeymap.filter((binding) => binding.key !== "Escape"),
  { key: "Escape", run: (view) => currentCompletions(view.state).length > 0 && closeCompletion(view) },
];

/**
 * The editor every chapter gets, before preferences.
 *
 * The gutters, the current-line band and Tab-to-indent are not here: they are
 * the writer's choices in Settings → Editor, and live in compartments
 * (`preferences.ts`) so they can change on a running editor. The fold gutter
 * went with the line numbers, because gutters line up in the order they are
 * added and a compartment passed in `extra` would otherwise put the numbers on
 * the wrong side of the fold markers.
 */
export function createMarkdownState(doc: string, extra: Extension[] = []): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      history(),
      markdown({ base: markdownLanguage }),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      bracketMatching(),
      highlightSelectionMatches(),
      autocompletion({ defaultKeymap: false }),
      Prec.highest(keymap.of(completionKeys)),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      EditorView.lineWrapping,
      ...extra,
    ],
  });
}
