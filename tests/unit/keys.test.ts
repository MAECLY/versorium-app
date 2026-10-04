import { describe, expect, it } from "vitest";
import { acceleratorLetter, chordAria, chordLabel, matchChord, type Platform } from "$lib/chrome/keys";

// The chords that fold the window's surfaces (src/lib/chrome/keys.ts). Each is
// matched on an exact set of modifiers, so the editor's own keys (⌘F search,
// ⌘D) and AltGr characters are never taken.

type Mods = { ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean };

function key(k: string, code: string, mods: Mods = {}) {
  return {
    key: k,
    code,
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift,
  };
}

describe("on macOS", () => {
  const mac: Platform = "mac";

  it("folds the panel with ⌃⌘S, the bar with ⌥⌘T and toggles Focus with ⇧⌘F", () => {
    expect(matchChord(key("s", "KeyS", { ctrl: true, meta: true }), mac)).toBe("toggleBinder");
    // Option turns t into †; the physical key is what counts.
    expect(matchChord(key("†", "KeyT", { alt: true, meta: true }), mac)).toBe("toggleTopBar");
    expect(matchChord(key("F", "KeyF", { shift: true, meta: true }), mac)).toBe("toggleFocus");
  });

  it("leaves everything else alone", () => {
    expect(matchChord(key("f", "KeyF", { meta: true }), mac), "⌘F is search").toBeNull();
    expect(matchChord(key("d", "KeyD", { meta: true }), mac), "⌘D").toBeNull();
    expect(matchChord(key("S", "KeyS", { ctrl: true, shift: true }), mac), "the other platforms' chord").toBeNull();
    expect(matchChord(key("F", "KeyF", { ctrl: true, shift: true }), mac)).toBeNull();
    expect(matchChord(key("s", "KeyS", { ctrl: true, meta: true, shift: true }), mac), "an extra Shift").toBeNull();
    expect(matchChord(key("t", "KeyT", { meta: true }), mac), "⌘T alone").toBeNull();
    expect(matchChord(key("s", "KeyS"), mac), "a bare S").toBeNull();
  });
});

describe("on Windows and Linux", () => {
  const other: Platform = "other";

  it("uses Ctrl+Shift for all three", () => {
    expect(matchChord(key("S", "KeyS", { ctrl: true, shift: true }), other)).toBe("toggleBinder");
    expect(matchChord(key("T", "KeyT", { ctrl: true, shift: true }), other)).toBe("toggleTopBar");
    expect(matchChord(key("F", "KeyF", { ctrl: true, shift: true }), other)).toBe("toggleFocus");
  });

  it("finds the letter by position on a non-Latin layout", () => {
    expect(matchChord(key("Ы", "KeyS", { ctrl: true, shift: true }), other)).toBe("toggleBinder");
    expect(matchChord(key("ы", "KeyS", { ctrl: true, shift: true }), other)).toBe("toggleBinder");
  });

  it("never takes AltGr, a bare letter, or the macOS chord", () => {
    expect(matchChord(key("s", "KeyS", { ctrl: true, alt: true }), other), "AltGr").toBeNull();
    expect(matchChord(key("S", "KeyS", { ctrl: true, alt: true, shift: true }), other), "Ctrl+Alt+Shift").toBeNull();
    expect(matchChord(key("s", "KeyS"), other)).toBeNull();
    expect(matchChord(key("s", "KeyS", { ctrl: true, meta: true }), other), "⌃⌘S").toBeNull();
    expect(matchChord(key("s", "KeyS", { ctrl: true }), other), "Ctrl+S without Shift").toBeNull();
  });
});

describe("the letter an accelerator is matched on", () => {
  it("is the key on a Latin layout, the position elsewhere, and nothing under AltGr", () => {
    expect(acceleratorLetter(key("R", "KeyR"))).toBe("r");
    expect(acceleratorLetter(key("к", "KeyR"))).toBe("r");
    expect(acceleratorLetter(key("®", "KeyR", { alt: true }))).toBe("");
  });
});

describe("names", () => {
  it("writes the chords the way each platform does", () => {
    expect(["toggleBinder", "toggleTopBar", "toggleFocus", "rewrite"].map((id) => chordLabel(id as never, "mac"))).toEqual([
      "⌃⌘S",
      "⌥⌘T",
      "⇧⌘F",
      "⇧⌘R",
    ]);
    expect(chordLabel("toggleBinder", "other")).toBe("Ctrl+Shift+S");
    expect(chordLabel("rewrite", "other")).toBe("Ctrl+Shift+R");
  });

  it("gives aria-keyshortcuts in the spec's modifier names", () => {
    expect(chordAria("toggleBinder", "mac")).toBe("Control+Meta+S");
    expect(chordAria("toggleTopBar", "mac")).toBe("Alt+Meta+T");
    expect(chordAria("toggleFocus", "mac")).toBe("Shift+Meta+F");
    expect(chordAria("toggleBinder", "other")).toBe("Control+Shift+S");
    expect(chordAria("toggleTopBar", "other")).toBe("Control+Shift+T");
    expect(chordAria("toggleFocus", "other")).toBe("Control+Shift+F");
  });
});
