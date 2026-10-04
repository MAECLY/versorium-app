/**
 * The three chords that fold the window's surfaces, and how they are named in
 * tooltips and to assistive technology.
 *
 * Each was checked against every keymap the editor loads (defaultKeymap with
 * the emacs set on macOS, historyKeymap, searchKeymap, completionKeymap, and
 * Tab-to-indent): none binds them, and neither does the reload guard nor the
 * context-menu keys in `src/lib/contextmenu/policy.ts`.
 *
 * - ⌃⌘S / Ctrl+Shift+S: the projects-and-chapters panel.
 * - ⌥⌘T / Ctrl+Shift+T: the top bar.
 * - ⇧⌘F / Ctrl+Shift+F: Focus.
 *
 * Off macOS every chord is Ctrl+Shift with no Alt: AltGr arrives as Ctrl+Alt,
 * and a chord that matched it would eat characters people type.
 */

export type Platform = "mac" | "other";

export type ChordId = "toggleBinder" | "toggleTopBar" | "toggleFocus";

/** The label's id: the three chords, and Rewrite for the lip's tooltip. */
export type LabelId = ChordId | "rewrite";

/** Read once per call, as `policy.ts` does, so a pinned platform in a test is honoured. */
export function platformOf(): Platform {
  return typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "mac" : "other";
}

/**
 * The letter an accelerator is matched on. On a Latin layout that is `key`.
 * On Cyrillic, Greek or Hebrew, `key` is not a Latin letter while Windows
 * still reports the Latin virtual key, so WebView2 reloads on the key in the R
 * position; `code` stands in for it. Not with Alt held: AltGr arrives as
 * Ctrl+Alt and types characters such as ®, which must reach the page.
 */
export function acceleratorLetter(event: Pick<KeyboardEvent, "key" | "code" | "altKey">): string {
  const key = event.key.toLowerCase();
  if (/^[a-z]$/.test(key)) return key;
  return !event.altKey && /^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase() : "";
}

type ChordEvent = Pick<KeyboardEvent, "key" | "code" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">;

/**
 * Which chord a keydown is, if any. The modifier set must match exactly, so
 * ⌘F (search) and ⌘D are never mistaken for one.
 *
 * With Option held the letter comes from `code`: ⌥ turns t into †. Without
 * it, from `key`, so AZERTY and Dvorak writers press the letter they see.
 */
export function matchChord(event: ChordEvent, platform: Platform): ChordId | null {
  const { ctrlKey: ctrl, metaKey: meta, altKey: alt, shiftKey: shift } = event;
  if (platform === "mac") {
    if (ctrl && meta && !alt && !shift && acceleratorLetter(event) === "s") return "toggleBinder";
    if (alt && meta && !ctrl && !shift && event.code === "KeyT") return "toggleTopBar";
    if (shift && meta && !ctrl && !alt && acceleratorLetter(event) === "f") return "toggleFocus";
    return null;
  }
  if (!ctrl || !shift || alt || meta) return null;
  const letter = acceleratorLetter(event);
  if (letter === "s") return "toggleBinder";
  if (letter === "t") return "toggleTopBar";
  if (letter === "f") return "toggleFocus";
  return null;
}

const LABELS: Record<Platform, Record<LabelId, string>> = {
  mac: { toggleBinder: "⌃⌘S", toggleTopBar: "⌥⌘T", toggleFocus: "⇧⌘F", rewrite: "⇧⌘R" },
  other: { toggleBinder: "Ctrl+Shift+S", toggleTopBar: "Ctrl+Shift+T", toggleFocus: "Ctrl+Shift+F", rewrite: "Ctrl+Shift+R" },
};

/** aria-keyshortcuts values: modifier names from the UI Events spec, then the key. */
const ARIA: Record<Platform, Record<LabelId, string>> = {
  mac: { toggleBinder: "Control+Meta+S", toggleTopBar: "Alt+Meta+T", toggleFocus: "Shift+Meta+F", rewrite: "Shift+Meta+R" },
  other: {
    toggleBinder: "Control+Shift+S",
    toggleTopBar: "Control+Shift+T",
    toggleFocus: "Control+Shift+F",
    rewrite: "Control+Shift+R",
  },
};

/** How a tooltip writes the chord: the platform's own symbols on macOS. */
export function chordLabel(id: LabelId, platform: Platform): string {
  return LABELS[platform][id];
}

export function chordAria(id: LabelId, platform: Platform): string {
  return ARIA[platform][id];
}
