import { describe, expect, it } from "vitest";
import {
  ASLEEP,
  SURFACES,
  WAKE_TRAVEL_PX,
  chromeFromSettings,
  isEditorOnScreen,
  noteKeystroke,
  notePointer,
  reduce,
  resolveChrome,
  type ChromeModel,
  type Surface,
} from "$lib/chrome/chrome";

// The window's surfaces as a pure model (src/lib/chrome/chrome.ts): Focus is a
// mask over the writer's layout, and "act on what you see" decides what a
// Hide or a Show does. The DOM half is tests/e2e/chrome.spec.ts.

function model(over: Partial<ChromeModel> = {}): ChromeModel {
  return {
    layout: { binder: true, topBar: true },
    recipe: { binder: true, topBar: true },
    focus: false,
    peek: null,
    ...over,
  };
}

const ON_SCREEN = { editorOnScreen: true };
const OFF_SCREEN = { editorOnScreen: false };

describe("what each surface shows", () => {
  it("covers every combination of layout, recipe, Focus and the editor being there", () => {
    for (const layoutOpen of [true, false]) {
      for (const hides of [true, false]) {
        for (const focus of [true, false]) {
          for (const editorOnScreen of [true, false]) {
            const m = model({
              layout: { binder: layoutOpen, topBar: layoutOpen },
              recipe: { binder: hides, topBar: hides },
              focus,
            });
            const r = resolveChrome(m, { editorOnScreen });
            const active = focus && editorOnScreen;
            const what = JSON.stringify({ layoutOpen, hides, focus, editorOnScreen });
            expect(r.focusActive, what).toBe(active);
            for (const s of SURFACES) {
              expect(r.hiddenByFocus[s], what).toBe(active && hides);
              expect(r.view[s], what).toBe(layoutOpen && !(active && hides) ? "open" : "collapsed");
            }
          }
        }
      }
    }
  });

  it("shows a peek only on a surface Focus hid, and only that one", () => {
    const peeking = model({ focus: true, peek: "binder" });
    expect(resolveChrome(peeking, ON_SCREEN).view).toEqual({ binder: "peek", topBar: "collapsed" });
    // Control: the same peek with nothing for Focus to clear is no peek at all.
    expect(resolveChrome(peeking, OFF_SCREEN).view).toEqual({ binder: "open", topBar: "open" });
    // Nor on a surface Focus leaves alone, whether the layout shows it or not.
    const notHidden = model({ focus: true, peek: "binder", recipe: { binder: false, topBar: true } });
    expect(resolveChrome(notHidden, ON_SCREEN).view.binder).toBe("open");
    const folded = model({ ...notHidden, layout: { binder: false, topBar: true } });
    expect(resolveChrome(folded, ON_SCREEN).view.binder).toBe("collapsed");
  });

  it("keeps Focus through a chapter swap, and not once nothing is loading", () => {
    const base = { project: true, chapter: false, corkboard: false, settings: false };
    // deleteChapter nulls currentChapter and starts loading the next one in
    // the same tick: Focus must not flicker off in between.
    expect(isEditorOnScreen({ ...base, loading: true })).toBe(true);
    expect(isEditorOnScreen({ ...base, loading: false })).toBe(false);
    expect(isEditorOnScreen({ ...base, chapter: true, loading: false })).toBe(true);
    expect(isEditorOnScreen({ ...base, chapter: true, loading: false, corkboard: true })).toBe(false);
    expect(isEditorOnScreen({ ...base, chapter: true, loading: false, settings: true })).toBe(false);
    expect(isEditorOnScreen({ ...base, project: false, chapter: true, loading: true })).toBe(false);
  });
});

describe("act on what you see", () => {
  it("remembers a Hide or a Show outside Focus", () => {
    const hidden = reduce(model(), ON_SCREEN, { type: "hide", surface: "binder" });
    expect(hidden.model.layout.binder).toBe(false);
    expect(hidden.persist).toEqual({ binderOpen: false });

    const shown = reduce(hidden.model, ON_SCREEN, { type: "show", surface: "binder" });
    expect(shown.model.layout.binder).toBe(true);
    expect(shown.persist).toEqual({ binderOpen: true });

    const bar = reduce(model(), ON_SCREEN, { type: "hide", surface: "topBar" });
    expect(bar.persist).toEqual({ topBarOpen: false });
  });

  it("remembers nothing for a Hide or a Show on a surface Focus hid", () => {
    const inFocus = model({ focus: true });
    const shown = reduce(inFocus, ON_SCREEN, { type: "show", surface: "binder" });
    expect(shown.model.peek).toBe("binder");
    expect(shown.model.layout).toEqual(inFocus.layout);
    expect(shown.persist).toEqual({});

    const hidden = reduce(shown.model, ON_SCREEN, { type: "hide", surface: "binder" });
    expect(hidden.model.peek).toBeNull();
    expect(hidden.model.layout).toEqual(inFocus.layout);
    expect(hidden.persist).toEqual({});
  });

  it("opens a peek, never a silent write, on a surface hidden by both the layout and Focus", () => {
    const both = model({ focus: true, layout: { binder: false, topBar: true } });
    const r = reduce(both, ON_SCREEN, { type: "show", surface: "binder" });
    expect(r.model.peek).toBe("binder");
    expect(r.model.layout.binder).toBe(false);
    expect(r.persist).toEqual({});
    expect(resolveChrome(r.model, ON_SCREEN).view.binder).toBe("peek");
  });

  it("toggles by what is on screen: open and peek hide, collapsed shows", () => {
    const toggle = (m: ChromeModel, s: Surface) => reduce(m, ON_SCREEN, { type: "toggle", surface: s });
    expect(toggle(model(), "binder").persist).toEqual({ binderOpen: false });
    expect(toggle(model({ layout: { binder: false, topBar: true } }), "binder").persist).toEqual({ binderOpen: true });
    const peeking = toggle(model({ focus: true }), "topBar").model;
    expect(peeking.peek).toBe("topBar");
    expect(toggle(peeking, "topBar").model.peek).toBeNull();
  });

  it("does nothing to a surface that is already the way it was asked to be", () => {
    expect(reduce(model(), ON_SCREEN, { type: "show", surface: "binder" }).persist).toEqual({});
    const collapsed = model({ layout: { binder: false, topBar: true } });
    const r = reduce(collapsed, ON_SCREEN, { type: "hide", surface: "binder" });
    expect(r.persist).toEqual({});
    expect(r.model).toEqual(collapsed);
  });

  it("clears a peek on closePeek, on leaving Focus, and on unticking its recipe item", () => {
    const peeking = reduce(model({ focus: true }), ON_SCREEN, { type: "show", surface: "binder" }).model;
    expect(peeking.peek).toBe("binder");

    expect(reduce(peeking, ON_SCREEN, { type: "closePeek" }).model.peek).toBeNull();
    expect(reduce(peeking, ON_SCREEN, { type: "setFocus", value: false }).model.peek).toBeNull();

    const unticked = reduce(peeking, ON_SCREEN, { type: "setRecipe", surface: "binder", value: false });
    expect(unticked.model.peek).toBeNull();
    expect(unticked.persist).toEqual({ focusHidesBinder: false });
    expect(resolveChrome(unticked.model, ON_SCREEN).view.binder).toBe("open");

    // Control: unticking the other surface leaves this peek alone.
    const other = reduce(peeking, ON_SCREEN, { type: "setRecipe", surface: "topBar", value: false });
    expect(other.model.peek).toBe("binder");
    expect(other.persist).toEqual({ focusHidesTopBar: false });
  });

  it("lets one peek replace the other", () => {
    const binder = reduce(model({ focus: true }), ON_SCREEN, { type: "show", surface: "binder" }).model;
    const bar = reduce(binder, ON_SCREEN, { type: "show", surface: "topBar" }).model;
    expect(bar.peek).toBe("topBar");
    expect(resolveChrome(bar, ON_SCREEN).view).toEqual({ binder: "collapsed", topBar: "peek" });
  });

  it("never writes the layout when Focus goes on or off", () => {
    const on = reduce(model({ layout: { binder: false, topBar: true } }), ON_SCREEN, { type: "setFocus", value: true });
    expect(on.persist).toEqual({});
    expect(on.model.layout).toEqual({ binder: false, topBar: true });
    const off = reduce(on.model, ON_SCREEN, { type: "setFocus", value: false });
    expect(off.persist).toEqual({});
    expect(resolveChrome(off.model, ON_SCREEN).view).toEqual({ binder: "collapsed", topBar: "open" });
  });
});

describe("reading the saved layout", () => {
  it("ignores a saved focusMode and shows everything a file does not mention", () => {
    expect(chromeFromSettings({ focusMode: true })).toEqual(model());
    expect(chromeFromSettings(undefined)).toEqual(model());
    expect(chromeFromSettings({ layout: null })).toEqual(model());
  });

  it("takes booleans and nothing else", () => {
    const m = chromeFromSettings({
      layout: { binderOpen: false, topBarOpen: "false", focusHidesBinder: 0, focusHidesTopBar: false },
    });
    expect(m.layout).toEqual({ binder: false, topBar: true });
    expect(m.recipe).toEqual({ binder: true, topBar: false });
    expect(m.focus).toBe(false);
  });
});

describe("the edges wake when the pointer travels", () => {
  it(`stays asleep under ${WAKE_TRAVEL_PX}px and wakes at it`, () => {
    let w = notePointer(ASLEEP, 100, 100);
    expect(w).toEqual({ awake: false, travel: 0, last: { x: 100, y: 100 } });
    w = notePointer(w, 103, 100);
    w = notePointer(w, 103, 104);
    expect(w.travel).toBe(7);
    expect(w.awake).toBe(false);
    w = notePointer(w, 105, 104);
    expect(w.awake).toBe(true);
  });

  it("starts over after a keystroke, where the first move only sets the baseline", () => {
    let w = notePointer(notePointer(ASLEEP, 0, 0), 50, 0);
    expect(w.awake).toBe(true);
    w = noteKeystroke();
    expect(w).toEqual(ASLEEP);
    // A pointer far from where it was before the keystroke is not a movement:
    // the travel counts from here.
    w = notePointer(w, 400, 300);
    expect(w.awake).toBe(false);
    expect(w.travel).toBe(0);
    w = notePointer(w, 404, 303);
    expect(w.travel).toBe(5);
    expect(w.awake).toBe(false);
  });
});
