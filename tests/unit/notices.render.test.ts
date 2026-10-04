import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, tick, unmount } from "svelte";
import Notices from "$lib/notices/Notices.svelte";
import { notices, TRANSIENT_MS } from "$lib/notices/state.svelte";

// The notice stack (src/lib/notices/Notices.svelte) rendered in jsdom: the
// screen-reader regions, what pauses a timer, what Escape and ✕ do, and where
// keyboard focus goes when the notice holding it closes.

let app: Record<string, unknown> | undefined;
let target: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  target = document.createElement("div");
  document.body.append(target);
  app = mount(Notices, { target });
  flushSync();
});

afterEach(async () => {
  for (const notice of [...notices.items]) notices.dismiss(notice.id);
  if (app) await unmount(app);
  app = undefined;
  target.remove();
  document.body.replaceChildren();
  vi.useRealTimers();
});

const region = () => target.querySelector<HTMLElement>('section[aria-label="Notifications"]');
const items = () => [...target.querySelectorAll<HTMLElement>(".v-note")];
const closer = (item: HTMLElement) => item.querySelector<HTMLButtonElement>(".v-note-close")!;

async function settle(): Promise<void> {
  await tick();
  flushSync();
}

function key(el: Element, value: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return event;
}

describe("the screen-reader regions", () => {
  it("are in the page before the first notice, and the stack is not", () => {
    expect(target.querySelector('[role="status"][data-notices="polite"]')).not.toBeNull();
    expect(target.querySelector('[role="alert"][data-notices="assertive"]')).not.toBeNull();
    // No empty landmark for a screen reader to land on.
    expect(region()).toBeNull();
  });

  it("carry the words, and the visible notices carry no live role", async () => {
    notices.fail("The chapter could not be saved.", "binder.save");
    notices.inform("Select a passage first.");
    await settle();
    expect(target.querySelector('[data-notices="assertive"]')?.textContent).toBe("The chapter could not be saved.");
    expect(target.querySelector('[data-notices="polite"]')?.textContent).toBe("Select a passage first.");
    expect(region()?.querySelectorAll("[role], [aria-live]")).toHaveLength(0);
    expect(items().map((item) => item.querySelector("p")?.textContent)).toEqual([
      "The chapter could not be saved.",
      "Select a passage first.",
    ]);
  });
});

describe("what keeps a transient notice", () => {
  it("the pointer on it", async () => {
    notices.inform("Saved.");
    await settle();
    items()[0].dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(60_000);
    await settle();
    expect(items()).toHaveLength(1);

    items()[0].dispatchEvent(new Event("pointerleave"));
    vi.advanceTimersByTime(TRANSIENT_MS);
    await settle();
    expect(items()).toHaveLength(0);
  });

  it("keyboard focus on it, until focus leaves the notice", async () => {
    notices.inform("Saved.");
    await settle();
    closer(items()[0]).focus();
    vi.advanceTimersByTime(60_000);
    await settle();
    expect(items()).toHaveLength(1);

    closer(items()[0]).blur();
    vi.advanceTimersByTime(TRANSIENT_MS);
    await settle();
    expect(items()).toHaveLength(0);
  });
});

describe("closing", () => {
  it("Escape on a notice closes it, and is used up there", async () => {
    const reachedWindow = vi.fn();
    window.addEventListener("keydown", reachedWindow);
    notices.fail("The chapter could not be saved.", "binder.save");
    await settle();

    const event = key(closer(items()[0]), "Escape");
    await settle();
    window.removeEventListener("keydown", reachedWindow);
    expect(items()).toHaveLength(0);
    expect(event.defaultPrevented, "App leaves a used key alone, so Focus stays on").toBe(true);
    expect(reachedWindow).not.toHaveBeenCalled();
  });

  it("any other key on a notice leaves it there and goes on its way", async () => {
    notices.fail("The chapter could not be saved.", "binder.save");
    await settle();
    // Tab and Shift+Tab move on; Enter on ✕ is the button's own click.
    for (const value of ["Tab", "Enter", "a"]) {
      const event = key(closer(items()[0]), value);
      await settle();
      expect(items(), value).toHaveLength(1);
      expect(event.defaultPrevented, value).toBe(false);
    }
  });

  it("✕ tells the owner, and an action runs without closing", async () => {
    const run = vi.fn();
    const onDismiss = vi.fn();
    notices.show({
      id: "backup:failed:a",
      tier: "persistent",
      text: "Not backed up.",
      action: { label: "Open backup settings", run },
      onDismiss,
    });
    await settle();
    const action = [...items()[0].querySelectorAll("button")].find((b) => b.textContent?.trim() === "Open backup settings");
    action?.click();
    await settle();
    expect(run).toHaveBeenCalledTimes(1);
    expect(items()).toHaveLength(1);

    expect(closer(items()[0]).getAttribute("aria-label")).toBe("Close");
    expect(closer(items()[0]).getAttribute("aria-describedby")).toBe(items()[0].querySelector("p")?.id);
    closer(items()[0]).click();
    await settle();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(items()).toHaveLength(0);
  });

  it("✕ on words shared by two conditions closes both", async () => {
    const saved = vi.fn();
    const logged = vi.fn();
    notices.show({ id: "binder.save", tier: "persistent", text: "File system error.", onDismiss: saved });
    notices.show({ id: "editor.ops", tier: "persistent", text: "File system error.", onDismiss: logged });
    await settle();
    expect(items()).toHaveLength(1);
    closer(items()[0]).click();
    await settle();
    expect(saved).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(notices.items).toEqual([]);
  });

  it("from the keyboard moves focus to the notice that takes its place, then back where it came from", async () => {
    const origin = document.createElement("button");
    origin.textContent = "Status bar";
    document.body.prepend(origin);
    notices.fail("First.");
    notices.fail("Second.");
    await settle();

    origin.focus();
    closer(items()[0]).focus();
    key(closer(items()[0]), "Escape");
    await settle();
    expect(items()).toHaveLength(1);
    expect(document.activeElement, "the next notice's ✕").toBe(closer(items()[0]));

    closer(items()[0]).click();
    await settle();
    expect(items()).toHaveLength(0);
    expect(document.activeElement, "back where focus came from").toBe(origin);
  });
});
