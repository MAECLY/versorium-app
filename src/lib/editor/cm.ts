import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  indentOnInput,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";

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
      autocompletion(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...completionKeymap]),
      EditorView.lineWrapping,
      ...extra,
    ],
  });
}
