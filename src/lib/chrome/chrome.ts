/**
 * What the window shows around the page: the projects-and-chapters panel
 * ("binder"), the top bar, and Focus, which folds some of them away.
 *
 * Pure, with no DOM, so every combination can be tested without a browser
 * (tests/unit/chrome.test.ts), the way `src/lib/editor/modes.ts` keeps the
 * typewriter's arithmetic apart from the editor.
 *
 * Two things are the writer's and are remembered (settings.json → `layout`):
 * which surfaces they keep open, and which of them Focus hides. Focus itself
 * lasts one session. It is a mask over the layout and never writes to it, so
 * leaving Focus puts back exactly what was there.
 */

export type Surface = "binder" | "topBar";

/**
 * - `open`: in the layout, taking its room.
 * - `collapsed`: folded to its edge (the rail or the lip), inert.
 * - `peek`: Focus hid it, and the writer asked to see it: it floats over the
 *   page without moving the text, until it is used.
 */
export type SurfaceView = "open" | "collapsed" | "peek";

export const SURFACES: readonly Surface[] = ["binder", "topBar"];

export interface ChromeModel {
  /** The writer's layout: whether each surface is open outside Focus. */
  layout: Record<Surface, boolean>;
  /** The Focus recipe: whether Focus hides each surface. */
  recipe: Record<Surface, boolean>;
  /** Asked for. Only active while the editor is on screen (`resolveChrome`). */
  focus: boolean;
  /** At most one floating surface at a time. */
  peek: Surface | null;
}

export interface ChromeContext {
  /** A chapter is in the editor, or one is loading into it. */
  editorOnScreen: boolean;
}

/** What `layout` holds on disk, in the order Rust writes it. */
export interface LayoutPatch {
  binderOpen?: boolean;
  topBarOpen?: boolean;
  focusHidesBinder?: boolean;
  focusHidesTopBar?: boolean;
}

const LAYOUT_KEY: Record<Surface, "binderOpen" | "topBarOpen"> = { binder: "binderOpen", topBar: "topBarOpen" };
const RECIPE_KEY: Record<Surface, "focusHidesBinder" | "focusHidesTopBar"> = {
  binder: "focusHidesBinder",
  topBar: "focusHidesTopBar",
};

export type Command =
  | { type: "hide"; surface: Surface }
  | { type: "show"; surface: Surface }
  | { type: "toggle"; surface: Surface }
  | { type: "setRecipe"; surface: Surface; value: boolean }
  | { type: "setFocus"; value: boolean }
  | { type: "closePeek" };

export interface Resolved {
  /** Focus is on and there is a page for it to clear. */
  focusActive: boolean;
  hiddenByFocus: Record<Surface, boolean>;
  view: Record<Surface, SurfaceView>;
}

/**
 * The editor is what Focus clears the page for. The loading term keeps Focus
 * steady through the moment a deleted chapter leaves `currentChapter` null
 * before the next one opens: both happen in the same synchronous tick.
 */
export function isEditorOnScreen(state: {
  project: boolean;
  chapter: boolean;
  loading: boolean;
  corkboard: boolean;
  settings: boolean;
}): boolean {
  return state.project && (state.chapter || state.loading) && !state.corkboard && !state.settings;
}

export function resolveChrome(model: ChromeModel, ctx: ChromeContext): Resolved {
  const focusActive = model.focus && ctx.editorOnScreen;
  const hiddenByFocus = {
    binder: focusActive && model.recipe.binder,
    topBar: focusActive && model.recipe.topBar,
  };
  const viewOf = (s: Surface): SurfaceView => {
    if (model.layout[s] && !hiddenByFocus[s]) return "open";
    if (model.peek === s && hiddenByFocus[s]) return "peek";
    return "collapsed";
  };
  return { focusActive, hiddenByFocus, view: { binder: viewOf("binder"), topBar: viewOf("topBar") } };
}

/**
 * Applies one command. The rule is "act on what you see":
 *
 * - Hide on an open surface folds it and remembers that; on a peek it only
 *   closes the peek.
 * - Show on a surface Focus hid opens a peek and remembers nothing, even when
 *   the writer's own layout hides it too. Anything else would be a write that
 *   changes nothing on screen until some later moment.
 * - Show anywhere else opens it and remembers that.
 *
 * `persist` names only what changed, ready for `set_settings({ layout })`.
 */
export function reduce(model: ChromeModel, ctx: ChromeContext, cmd: Command): { model: ChromeModel; persist: LayoutPatch } {
  const { view, hiddenByFocus } = resolveChrome(model, ctx);
  const next: ChromeModel = {
    layout: { ...model.layout },
    recipe: { ...model.recipe },
    focus: model.focus,
    peek: model.peek,
  };
  const persist: LayoutPatch = {};
  const setLayout = (s: Surface, open: boolean): void => {
    if (next.layout[s] === open) return;
    next.layout[s] = open;
    persist[LAYOUT_KEY[s]] = open;
  };

  const hide = (s: Surface): void => {
    if (view[s] === "open") setLayout(s, false);
    else if (view[s] === "peek") next.peek = null;
  };
  const show = (s: Surface): void => {
    if (hiddenByFocus[s]) next.peek = s;
    else setLayout(s, true);
  };

  switch (cmd.type) {
    case "hide":
      hide(cmd.surface);
      break;
    case "show":
      show(cmd.surface);
      break;
    case "toggle":
      if (view[cmd.surface] === "collapsed") show(cmd.surface);
      else hide(cmd.surface);
      break;
    case "setRecipe":
      if (next.recipe[cmd.surface] !== cmd.value) {
        next.recipe[cmd.surface] = cmd.value;
        persist[RECIPE_KEY[cmd.surface]] = cmd.value;
      }
      if (next.peek === cmd.surface) next.peek = null;
      break;
    case "setFocus":
      next.focus = cmd.value;
      next.peek = null;
      break;
    case "closePeek":
      next.peek = null;
      break;
  }
  return { model: next, persist };
}

/**
 * The saved layout, read the way Rust reads it: a missing or non-boolean value
 * is `true`, so nothing is ever hidden by a value nobody chose. A saved
 * `focusMode` is ignored: Focus starts off in every session.
 */
export function chromeFromSettings(saved: unknown): ChromeModel {
  const layout = isRecord(saved) && isRecord(saved.layout) ? saved.layout : {};
  const flag = (key: keyof LayoutPatch): boolean => (typeof layout[key] === "boolean" ? (layout[key] as boolean) : true);
  return {
    layout: { binder: flag("binderOpen"), topBar: flag("topBarOpen") },
    recipe: { binder: flag("focusHidesBinder"), topBar: flag("focusHidesTopBar") },
    focus: false,
    peek: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* ------------------------------------------------------------------ wake */

/**
 * In Focus the rail and the lip stay where they are but sleep while the writer
 * types: invisible, and taking no clicks. The pointer travelling this far
 * since the last keystroke wakes them. Far enough that a hand resting on a
 * trackpad does not, near enough that reaching for the edge always does.
 */
export const WAKE_TRAVEL_PX = 8;

export interface WakeState {
  awake: boolean;
  /** Pointer travel since the last keystroke, in CSS pixels. */
  travel: number;
  /** Where the pointer was last seen; null until the first move after a keystroke. */
  last: { x: number; y: number } | null;
}

export const ASLEEP: WakeState = { awake: false, travel: 0, last: null };
export const AWAKE: WakeState = { awake: true, travel: 0, last: null };

/**
 * One pointer position. The first after a keystroke only sets the baseline:
 * where the pointer already was is not a movement.
 */
export function notePointer(wake: WakeState, x: number, y: number): WakeState {
  if (wake.awake) return wake;
  if (!wake.last) return { awake: false, travel: 0, last: { x, y } };
  const travel = wake.travel + Math.hypot(x - wake.last.x, y - wake.last.y);
  return { awake: travel >= WAKE_TRAVEL_PX, travel, last: { x, y } };
}

/** A key typed into the manuscript puts the edges back to sleep. */
export function noteKeystroke(): WakeState {
  return ASLEEP;
}
