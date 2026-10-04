import { tick } from "svelte";
import { api, isTauri } from "$lib/tauri";
import {
  chromeFromSettings,
  reduce,
  type ChromeContext,
  type ChromeModel,
  type Command,
  type LayoutPatch,
  type Surface,
} from "./chrome";

/** How long the "Press Esc to leave Focus" hint stays, the first time. */
export const HINT_MS = 4000;

/**
 * The window's surfaces and Focus, live. The rules are in `chrome.ts`; this
 * holds the state they act on and writes the layout back to settings.json.
 *
 * Layout changes apply at once and are saved behind them: a panel that waited
 * on IPC before folding would feel broken, and a failed write costs only the
 * memory of one click, which the next one makes again.
 */
export class ChromeStore {
  layout = $state<Record<Surface, boolean>>({ binder: true, topBar: true });
  recipe = $state<Record<Surface, boolean>>({ binder: true, topBar: true });
  /** Session only: every launch starts with Focus off. */
  focus = $state(false);
  peek = $state<Surface | null>(null);
  /** The Focus options menu is open, which keeps the edges showing. */
  menuOpen = $state(false);
  /** The saved layout is on screen; transitions stay off until then. */
  ready = $state(false);
  hintVisible = $state(false);
  /** The live region's text. */
  announcement = $state("");

  private hintShown = false;
  private hintTimer: ReturnType<typeof setTimeout> | undefined;
  private settling = false;

  get model(): ChromeModel {
    return { layout: this.layout, recipe: this.recipe, focus: this.focus, peek: this.peek };
  }

  /** Adopt the saved layout, then let transitions run (`settle`). */
  load(saved: unknown): void {
    const m = chromeFromSettings(saved);
    this.layout = m.layout;
    this.recipe = m.recipe;
    this.focus = false;
    this.peek = null;
    this.settle();
  }

  /**
   * Transitions on, two frames from now: one frame draws the layout with
   * them off, so a folded panel never animates shut at launch, the way the
   * theme never fades in. Also what a launch with no settings to read calls.
   */
  settle(): void {
    if (this.settling) return;
    this.settling = true;
    if (typeof requestAnimationFrame === "undefined") {
      this.ready = true;
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => (this.ready = true)));
  }

  /** Apply one command and save what it changed. Returns what was saved. */
  run(cmd: Command, ctx: ChromeContext): LayoutPatch {
    const { model, persist } = reduce(this.model, ctx, cmd);
    this.layout = model.layout;
    this.recipe = model.recipe;
    this.focus = model.focus;
    this.peek = model.peek;
    if (Object.keys(persist).length > 0 && isTauri()) {
      // A layout not remembered is a click to repeat next launch; not an error.
      void api.setSettings({ layout: persist }).catch(() => undefined);
    }
    return persist;
  }

  /**
   * Say it to the live region. Cleared first and set a tick later, so the
   * same message twice in a row is announced twice.
   */
  async announce(message: string): Promise<void> {
    this.announcement = "";
    await tick();
    this.announcement = message;
  }

  /** The leave hint, once per session, for HINT_MS. */
  showHintOnce(): void {
    if (this.hintShown) return;
    this.hintShown = true;
    this.hintVisible = true;
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => (this.hintVisible = false), HINT_MS);
  }

  hideHint(): void {
    clearTimeout(this.hintTimer);
    this.hintVisible = false;
  }
}

export const chrome = new ChromeStore();
