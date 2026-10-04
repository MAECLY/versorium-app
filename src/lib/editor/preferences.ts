import { Compartment, type Extension, type StateEffect } from "@codemirror/state";
import { EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { foldGutter } from "@codemirror/language";
import type { EditorFont, EditorSettings, FontEntry } from "$lib/tauri";

export type EditorPreferences = EditorSettings;
export type TextSize = EditorSettings["textSize"];
export type LineSpacing = EditorSettings["lineSpacing"];
export type TextWidth = EditorSettings["textWidth"];
export type TabKey = EditorSettings["tabKey"];

export const TEXT_SIZES: readonly TextSize[] = ["small", "medium", "large"];
export const LINE_SPACINGS: readonly LineSpacing[] = ["compact", "comfortable", "airy"];
export const TEXT_WIDTHS: readonly TextWidth[] = ["narrow", "medium", "wide"];
export const TAB_KEYS: readonly TabKey[] = ["next", "indent"];

/** The same defaults as `EditorSettings::default` in Rust. */
export const EDITOR_DEFAULTS: EditorPreferences = {
  spellcheck: true,
  textSize: "medium",
  lineSpacing: "comfortable",
  textWidth: "medium",
  lineNumbers: false,
  activeLine: true,
  tabKey: "next",
};

/**
 * What each step renders as.
 *
 * The middle steps are the values styles.css hard-coded before these settings
 * existed (21px, 1.7, 72ch, inside DESIGN's 20–22px, 1.7 and 66–72ch), so a
 * writer who never opens Settings keeps the page they had. The outer steps are
 * one clear notch either side: three pixels of size; 1.5 is the "one and a
 * half" spacing writers know from word processors and 2 is the double spacing
 * of manuscript format; twelve characters of measure.
 */
export const TEXT_SIZE: Record<TextSize, string> = { small: "18px", medium: "21px", large: "24px" };
export const LINE_HEIGHT: Record<LineSpacing, string> = { compact: "1.5", comfortable: "1.7", airy: "2" };
export const MEASURE: Record<TextWidth, string> = { narrow: "60ch", medium: "72ch", wide: "84ch" };

function oneOf<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return allowed.find((option) => option === value) ?? fallback;
}

/**
 * Settings as they arrive, made safe to render.
 *
 * Rust already normalizes what it loads, so this is for what Rust does not
 * control: a settings object from before the `editor` block existed, or a
 * mock. A value with no option in the panel would leave a Select showing
 * something other than what the page does.
 */
export function normalizePreferences(raw: unknown): EditorPreferences {
  const source = (raw !== null && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const flag = (key: keyof EditorPreferences, fallback: boolean): boolean =>
    typeof source[key] === "boolean" ? (source[key] as boolean) : fallback;
  return {
    spellcheck: flag("spellcheck", EDITOR_DEFAULTS.spellcheck),
    textSize: oneOf(TEXT_SIZES, source.textSize, EDITOR_DEFAULTS.textSize),
    lineSpacing: oneOf(LINE_SPACINGS, source.lineSpacing, EDITOR_DEFAULTS.lineSpacing),
    textWidth: oneOf(TEXT_WIDTHS, source.textWidth, EDITOR_DEFAULTS.textWidth),
    lineNumbers: flag("lineNumbers", EDITOR_DEFAULTS.lineNumbers),
    activeLine: flag("activeLine", EDITOR_DEFAULTS.activeLine),
    tabKey: oneOf(TAB_KEYS, source.tabKey, EDITOR_DEFAULTS.tabKey),
  };
}

/**
 * The novel's language as an HTML `lang`, or nothing when it is not a tag.
 *
 * The manuscript is in the novel's language, not the app's: without this the
 * content inherited `<html lang>`, which follows the interface, so a Spanish
 * novel in an English Versorium was declared English to everything that reads
 * `lang` — a screen reader picks its voice from it, and a spell checker that
 * honours it picks its dictionary. A value that is not shaped like a language
 * tag (a hand-edited versorium.json) is left out rather than passed on, so
 * the page falls back to the interface language instead of to nonsense.
 */
export function contentLanguage(language: string | null | undefined): string | undefined {
  const tag = (language ?? "").trim().replace(/_/g, "-");
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(tag) ? tag : undefined;
}

/**
 * Whether turning spelling on underlines anything in this webview.
 *
 * `spellcheck="true"` is a request, and the webview decides. WKWebView honours
 * it once `src-tauri/src/spelling.rs` has registered the default WebKit reads,
 * and WebView2 is expected to check by itself, as Edge does (not yet seen,
 * TODO.md). WebKitGTK checks nothing until Rust switches its checker on, which
 * is not done yet (TODO.md), so on Linux Settings says that rather than
 * promising underlines. Drop this when spelling.rs learns WebKitGTK.
 * `navigator.platform` is "Linux x86_64" there, from uname.
 */
export function spellingUnderlines(platform: string): boolean {
  return !/Linux/.test(platform);
}

/**
 * Attributes for the manuscript's editing host.
 *
 * CodeMirror writes spellcheck="false", autocorrect="off",
 * autocapitalize="off" and writingsuggestions="false" on its content by
 * default: right for code, decided here for prose.
 *
 * - spellcheck follows the setting. It only underlines; the writer chooses
 *   what to do with a flagged word from the right-click menu.
 * - autocorrect stays "off", stated rather than inherited. Once spelling is
 *   checked, WebKit's automatic correction follows macOS's own text
 *   correction settings, on by default (TextCheckerMac.mm), and this
 *   attribute is what WebKit and Chromium 153+ honour to keep it off an
 *   element. A novel is full of words no dictionary has — invented names,
 *   dialect, a character's misspellings — and a silent replacement would
 *   also be recorded in the op log as the writer's own keystroke. It also
 *   keeps CodeMirror undoing macOS's "period on double space", as the editor
 *   always has.
 * - autocapitalize is "sentences": prose is sentences. It acts only on
 *   on-screen keyboards and dictation, never on a physical keyboard, and it
 *   decides a letter's case as it is entered rather than rewriting a word
 *   afterwards. WKWebView on macOS ignores it; WebView2 supports it.
 * - writingsuggestions stays CodeMirror's "false": an inline prediction
 *   accepted with one key puts words the writer did not write into the
 *   manuscript as human keystrokes, and the only door for machine text is
 *   Rewrite, with its diff and its `ai:` author.
 */
export function contentAttributes(spellcheck: boolean, language: string | undefined): Record<string, string> {
  const attributes: Record<string, string> = {
    spellcheck: spellcheck ? "true" : "false",
    autocorrect: "off",
    autocapitalize: "sentences",
  };
  if (language) attributes.lang = language;
  return attributes;
}

/**
 * A face's stack as the value of `--editor-font`, or undefined when it is not
 * one to write into a style attribute.
 *
 * The stack comes from the catalogue Rust embeds, and goes into the editor's
 * `style` as a declaration: a `;` would end it and start another, and braces,
 * angle brackets, a backslash or a line break have no place in a list of
 * family names. A stack refused here, or none at all, leaves the property
 * unset, and the page in the stylesheet's own face rather than in nothing.
 */
export function fontFamilyValue(stack: string | null | undefined): string | undefined {
  const value = (stack ?? "").trim();
  return value && !/[;{}<>\\\r\n]/.test(value) ? value : undefined;
}

/**
 * Which row of Typography is marked as chosen: the face settings hold, by its
 * catalogue id, when it is one of the faces offered. Null otherwise — a face
 * the panel does not list, or none read yet — rather than a row the page is
 * not in.
 */
export function markedFont(
  offered: readonly Pick<FontEntry, "id">[],
  choice: Pick<EditorFont, "id"> | null | undefined,
): string | null {
  const id = choice?.id;
  return id !== undefined && offered.some((face) => face.id === id) ? id : null;
}

/**
 * The page's face, size, spacing and width as custom properties on
 * `.cm-editor`.
 *
 * styles.css reads them in its `.cm-editor .cm-content` rule, with today's
 * values as the fallbacks. Nothing else declares those properties, so there
 * is no cascade to win: no specificity contest with the stylesheet and no
 * dependence on which <style> landed last — the trap the typewriter padding
 * fell into. Typewriter's own rule sets padding only, at 0,3,0, and is
 * untouched by these. The face is left out until one is known, so the page
 * renders in the stylesheet's default, the catalogue's own, meanwhile.
 */
export function pageStyle(preferences: EditorPreferences, fontStack?: string | null): string {
  const declarations = [
    `--editor-text-size: ${TEXT_SIZE[preferences.textSize]}`,
    `--editor-line-height: ${LINE_HEIGHT[preferences.lineSpacing]}`,
    `--editor-measure: ${MEASURE[preferences.textWidth]}`,
  ];
  const family = fontFamilyValue(fontStack);
  if (family) declarations.push(`--editor-font: ${family}`);
  return declarations.join("; ");
}

// Built once and shared, so reconfiguring a compartment with an unchanged
// choice hands CodeMirror the same extension instead of a new gutter. The fold
// markers ride in the same compartment, after the numbers, because gutters
// line up in the order they are added.
const FOLD_GUTTER = foldGutter();
const WITH_NUMBERS = [
  lineNumbers(),
  FOLD_GUTTER,
  // styles.css draws the gutter's rule only beside numbers.
  EditorView.editorAttributes.of({ class: "v-line-numbers" }),
];
const ACTIVE_LINE = highlightActiveLine();

/**
 * Tab, when the writer asks for it to indent.
 *
 * Not the default, and the reasons were measured rather than assumed:
 *
 * 1. What it writes: CodeMirror's indent unit, two spaces, at the start of
 *    the paragraph wherever the caret is, one unit per press.
 * 2. One press is harmless and pointless. Every export is built from
 *    `scenes_of`, which trims each line, so the indent reaches no reader; DOCX
 *    and PDF already indent paragraphs the way manuscript format asks.
 * 3. Two presses damage the source. Four spaces after a blank line — before
 *    every paragraph of a novel — make an indented code block in CommonMark:
 *    the editor stops parsing the paragraph's italics, an indented `##` stops
 *    being a heading, and GitHub, where the novel's own repository lives,
 *    renders the paragraph as code.
 *    (preferences.test.ts proves 1 and the editor's half of 3;
 *    `formats::tests` proves 2.)
 * 4. Indenting traps the keyboard. With Tab bound, the ways out of the
 *    manuscript are Escape and then Tab within two seconds, or CodeMirror's
 *    Ctrl-M (Shift-Alt-M on a Mac) toggle, and nobody finds either; an
 *    earlier design panel measured Tab never leaving the editor.
 *
 * Mod-] and Mod-[ still indent and outdent in every mode (CodeMirror's default
 * keymap), so nothing is lost by leaving Tab to the keyboard.
 */
const TAB_INDENTS = keymap.of([indentWithTab]);

/**
 * The preferences behind compartments, like typewriter.
 *
 * Reconfiguring a compartment changes a running editor in place; rebuilding
 * the view would throw away the caret, the selection and the undo history in
 * the middle of a sentence. The face rides in the page's compartment with the
 * size it is drawn at: a changed attribute makes CodeMirror measure again, so
 * the line numbers follow the lines the new face wraps into.
 */
export function createPreferenceCompartments(): {
  initial: (preferences: EditorPreferences, language: string | undefined, fontStack?: string) => Extension[];
  reconfigure: (
    preferences: EditorPreferences,
    language: string | undefined,
    fontStack?: string,
  ) => StateEffect<unknown>[];
} {
  const spelling = new Compartment();
  const page = new Compartment();
  const gutter = new Compartment();
  const currentLine = new Compartment();
  const tab = new Compartment();
  const parts = (
    preferences: EditorPreferences,
    language: string | undefined,
    fontStack: string | undefined,
  ): [Compartment, Extension][] => [
    [spelling, EditorView.contentAttributes.of(contentAttributes(preferences.spellcheck, contentLanguage(language)))],
    [page, EditorView.editorAttributes.of({ style: pageStyle(preferences, fontStack) })],
    [gutter, preferences.lineNumbers ? WITH_NUMBERS : FOLD_GUTTER],
    [currentLine, preferences.activeLine ? ACTIVE_LINE : []],
    [tab, preferences.tabKey === "indent" ? TAB_INDENTS : []],
  ];
  return {
    initial: (preferences, language, fontStack) =>
      parts(preferences, language, fontStack).map(([c, extension]) => c.of(extension)),
    reconfigure: (preferences, language, fontStack) =>
      parts(preferences, language, fontStack).map(([c, extension]) => c.reconfigure(extension)),
  };
}
