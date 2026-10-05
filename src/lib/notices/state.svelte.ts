import { tick, untrack } from "svelte";
import type { Cover } from "./cover";

/**
 * What the app tells the writer in passing, in one place (docs/project/STATUS.md,
 * "Notifications"). Before this, a hint went through the error channel and
 * stayed on screen until closed, and no message anywhere hid itself.
 *
 * Two tiers, because they fail in opposite ways:
 *
 * - **Transient**: a confirmation ("Saved.") or a hint ("Select a passage
 *   first."). It hides itself after TRANSIENT_MS, and waits while the pointer
 *   or keyboard focus is on it, so it never goes while being read.
 * - **Persistent**: an error the writer has to read to resolve. It stays until
 *   they close it, or until the code that raised it says the condition is gone.
 *   Hiding it on a timer fails WCAG 2.2.1 and loses the one message that
 *   matters.
 *
 * What belongs to a place is not a notice at all: a destination's backup
 * outcome, a field's validation, an error inside a dialog. Those stay where they
 * happened, which is where the writer reads them.
 *
 * Every notice has an id. The same id replaces in place rather than stacking: a
 * failure that repeats every minute is one notice whose words may change, a
 * hint asked for twice is one hint shown again. `inform` and `fail` take the id
 * from the words when given none, so saying the same thing twice is one notice.
 * The shape is the contract scheduled backups were specified against (backup
 * schedule SPEC §6.3), which is why `dismiss` (the code: the condition cleared)
 * and `close` (the writer) are two calls: only the writer's fires `onDismiss`.
 *
 * What a screen reader hears: a notice when it first appears. Under the same
 * id, a persistent notice is never read again (SPEC §6.4), and a transient one
 * only when its words change or the writer asks again (`inform`); the same
 * words shown again are a refresh (SPEC §6.3).
 */

export type Tier = "transient" | "persistent";

export interface NoticeAction {
  label: string;
  run: () => void;
}

interface NoticeBase {
  /** Stable for the condition it reports: the same id is replaced, never stacked. */
  id: string;
  text: string;
  /** The writer closed it. Never called when code dismisses it. */
  onDismiss?: () => void;
}

/**
 * A transient notice carries no action: it can hide on its way to being
 * pressed, which would make the button a timed one.
 */
export type Notice =
  | (NoticeBase & { tier: "transient"; action?: never })
  | (NoticeBase & { tier: "persistent"; action?: NoticeAction });

/** One notice on screen. Persistent notices with the same words and no action are drawn once. */
export interface Shown {
  /** The first id: what the list is keyed on. */
  key: string;
  ids: string[];
  tier: Tier;
  text: string;
  action?: NoticeAction;
}

export type Hold = "pointer" | "focus";

/** How long a transient notice stays, unread. */
export const TRANSIENT_MS = 5000;

/**
 * Transient notices on screen at once; the oldest goes first. Persistent ones
 * are never dropped. Three keeps the stack short enough to stay out of the
 * text column's way.
 */
export const MAX_TRANSIENT = 3;

type Region = "polite" | "assertive";

const REGIONS: readonly Region[] = ["polite", "assertive"];

/** Which notices each region speaks for. */
const TIER_OF: Record<Region, Tier> = { polite: "transient", assertive: "persistent" };

interface Clock {
  timer: ReturnType<typeof setTimeout> | undefined;
  /** When it hides, while the timer runs. */
  deadline: number;
  /** What is left, while it is held. */
  remaining: number;
}

/**
 * Persistent notices that say the same thing are drawn once: a full disk fails
 * the save, the change log and the minute's snapshot at once, and three boxes
 * reading "File system error." say less than one. Each id still clears on its
 * own; the box goes when the last of them does. A notice with an action keeps
 * a box of its own: a shared box has room for one action, and the other
 * notice's would be lost.
 */
function folds(notice: Notice): boolean {
  return notice.tier === "persistent" && !notice.action;
}

function fold(items: readonly Notice[]): Shown[] {
  const shown: Shown[] = [];
  const byText = new Map<string, Shown>();
  for (const notice of items) {
    const same = folds(notice) ? byText.get(notice.text) : undefined;
    if (same) {
      same.ids.push(notice.id);
      continue;
    }
    const entry: Shown = {
      key: notice.id,
      ids: [notice.id],
      tier: notice.tier,
      text: notice.text,
      action: notice.action,
    };
    if (folds(notice)) byText.set(notice.text, entry);
    shown.push(entry);
  }
  return shown;
}

export class NoticeStore {
  items = $state.raw<Notice[]>([]);
  shown = $derived(fold(this.items));
  /** The two screen-reader regions' text (Notices.svelte keeps both in the DOM). */
  polite = $state("");
  assertive = $state("");
  /** Bumped when the stack appears, goes, or changes size: the editor re-checks its caret. */
  coverRevision = $state(0);

  private clocks = new Map<string, Clock>();
  private holds = new Map<string, Set<Hold>>();
  private queued: Record<Region, string[]> = { polite: [], assertive: [] };
  /** The lines each region holds now, one per notice's words. */
  private spoken: Record<Region, string[]> = { polite: [], assertive: [] };
  private surface: HTMLElement | null = null;
  private revision = 0;

  /**
   * Untracked, so a notice raised from inside an effect does not make that
   * effect depend on the list it is changing.
   */
  private get list(): Notice[] {
    return untrack(() => this.items);
  }

  /**
   * Raise or replace a notice. The same id keeps its place in the stack, and
   * the same words under it are not read out again.
   */
  show(notice: Notice): void {
    this.raise(notice, false);
  }

  /**
   * A confirmation or a hint, gone after TRANSIENT_MS. It answers something
   * the writer did, so asked for again it is heard again, in the same words.
   */
  inform(text: string, id = `inform:${text}`): void {
    this.raise({ id, tier: "transient", text }, true);
  }

  /** An error that stays until the writer closes it or `dismiss(id)` clears it. */
  fail(text: string, id = `fail:${text}`): void {
    this.raise({ id, tier: "persistent", text }, false);
  }

  /** The condition is gone: remove it without telling `onDismiss`. */
  dismiss(id: string): void {
    this.remove(id);
  }

  /** The writer closed it (✕ or Escape). */
  close(id: string): void {
    this.remove(id)?.onDismiss?.();
  }

  /**
   * Pointer or keyboard focus is on it: its timer waits. Two reasons, counted
   * apart, so moving the pointer away while focus is still on it keeps it.
   */
  hold(id: string, why: Hold): void {
    if (!this.list.some((n) => n.id === id)) return;
    const reasons = this.holds.get(id) ?? new Set<Hold>();
    if (reasons.size === 0) this.pause(id);
    reasons.add(why);
    this.holds.set(id, reasons);
  }

  /** The last reason gone: the timer runs on with what was left of it. */
  release(id: string, why: Hold): void {
    const reasons = this.holds.get(id);
    if (!reasons?.delete(why) || reasons.size > 0) return;
    this.holds.delete(id);
    const clock = this.clocks.get(id);
    if (clock && clock.timer === undefined) this.start(id, clock);
  }

  /** The stack's element, from Notices.svelte. */
  attach(el: HTMLElement): void {
    this.surface = el;
    this.moved();
  }

  detach(el: HTMLElement): void {
    if (this.surface !== el) return;
    this.surface = null;
    this.moved();
  }

  /** The stack appeared, went, or changed size or place. */
  moved(): void {
    this.revision += 1;
    this.coverRevision = this.revision;
  }

  /**
   * The stack's box, read live, or null when nothing shows. Live because it
   * hangs from the panels under it, and opening History moves it without
   * changing its size.
   */
  coverRect(): Cover | null {
    const el = this.surface;
    if (!el?.isConnected) return null;
    const box = el.getBoundingClientRect();
    return box.height > 0 ? { top: box.top, left: box.left, right: box.right } : null;
  }

  private raise(notice: Notice, asked: boolean): void {
    const list = this.list;
    const at = list.findIndex((n) => n.id === notice.id);
    const before = at >= 0 ? list[at] : undefined;
    const echo = folds(notice) && list.some((n) => n.id !== notice.id && folds(n) && n.text === notice.text);
    this.items = at >= 0 ? list.map((n, i) => (i === at ? notice : n)) : [...list, notice];
    this.prune();
    if (notice.tier === "transient") {
      this.arm(notice.id);
      this.trim(notice.id);
      // It goes in seconds, so new words are read out: this is the only time
      // a screen reader hears them.
      const fresh = before?.tier !== "transient" || before.text !== notice.text;
      if (fresh || asked) this.say("polite", notice.text);
      return;
    }
    // A transient notice's clock would otherwise still run, and take the
    // error that replaced it off screen on the transient's schedule.
    this.disarm(notice.id);
    // Once, when it first appears. An update in place, or words already on
    // screen under another id, are not news.
    if (before?.tier !== "persistent" && !echo) this.say("assertive", notice.text);
  }

  private held(id: string): boolean {
    return (this.holds.get(id)?.size ?? 0) > 0;
  }

  /** The full time again, waiting if the notice is held. */
  private arm(id: string): void {
    this.disarm(id);
    const clock: Clock = { timer: undefined, deadline: 0, remaining: TRANSIENT_MS };
    this.clocks.set(id, clock);
    if (!this.held(id)) this.start(id, clock);
  }

  private start(id: string, clock: Clock): void {
    clock.deadline = Date.now() + clock.remaining;
    clock.timer = setTimeout(() => {
      if (this.clocks.get(id) === clock) this.remove(id);
    }, clock.remaining);
  }

  private pause(id: string): void {
    const clock = this.clocks.get(id);
    if (!clock || clock.timer === undefined) return;
    clearTimeout(clock.timer);
    clock.timer = undefined;
    clock.remaining = Math.max(0, clock.deadline - Date.now());
  }

  private disarm(id: string): void {
    clearTimeout(this.clocks.get(id)?.timer);
    this.clocks.delete(id);
  }

  /** Oldest transient first, never the one just raised and never one being read. */
  private trim(keep: string): void {
    const transient = this.list.filter((n) => n.tier === "transient");
    let excess = transient.length - MAX_TRANSIENT;
    for (const notice of transient) {
      if (excess <= 0) return;
      if (notice.id === keep || this.held(notice.id)) continue;
      this.remove(notice.id);
      excess -= 1;
    }
  }

  private remove(id: string): Notice | undefined {
    const list = this.list;
    const notice = list.find((n) => n.id === id);
    if (!notice) return undefined;
    this.disarm(id);
    // A pointer never leaves an element that was taken away under it, so a
    // hold left here would keep the next notice under this id up for good.
    this.holds.delete(id);
    this.items = list.filter((n) => n.id !== id);
    this.prune();
    return notice;
  }

  /**
   * The screen-reader copy stays while a notice of its tier still says one of
   * its lines, and goes when none does, so nobody reading the page later finds
   * a message that is no longer true: one closed, one whose words changed in
   * place, or two read together that have both gone. Emptying a region is not
   * read out.
   */
  private prune(): void {
    const list = this.list;
    for (const region of REGIONS) {
      const lines = this.spoken[region];
      if (lines.length === 0) continue;
      if (!list.some((n) => n.tier === TIER_OF[region] && lines.includes(n.text))) this.write(region, []);
    }
  }

  /**
   * Cleared, then written a tick later, so the same words twice are heard
   * twice (chrome.announce does the same). Words raised in the same tick are
   * read together rather than the last one alone, and words whose notice went
   * before the tick are not read at all.
   */
  private say(region: Region, text: string): void {
    const queue = this.queued[region];
    queue.push(text);
    if (queue.length > 1) return;
    this.write(region, []);
    void tick().then(() => {
      const live = this.list;
      const said = [...new Set(queue.splice(0))].filter((line) =>
        live.some((n) => n.tier === TIER_OF[region] && n.text === line),
      );
      this.write(region, said);
    });
  }

  private write(region: Region, lines: string[]): void {
    this.spoken[region] = lines;
    const text = lines.join(" ");
    if (region === "polite") this.polite = text;
    else this.assertive = text;
  }
}

export const notices = new NoticeStore();
