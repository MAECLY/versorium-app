import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, tick, unmount } from "svelte";
import Menu, { closeOpenMenu, type MenuItem } from "$lib/components/Menu.svelte";

// The app's one menu (src/lib/components/Menu.svelte), rendered in jsdom: the
// WAI-ARIA menu-button keys, checkbox items that only ever show their prop,
// and Escape staying inside the menu. Named .svelte.test.ts so `$state` can
// drive the props, the way a parent would.

type Props = {
  items: MenuItem[];
  label: string;
  onChoose?: (id: string) => void;
  onToggle?: (id: string, next: boolean) => void;
  onOpenChange?: (open: boolean) => void;
  heading?: string;
  note?: string;
  menuId?: string;
};

const mounted: { app: Record<string, unknown>; target: HTMLElement }[] = [];

function render(initial: Props) {
  const props = $state(initial);
  const target = document.createElement("div");
  document.body.append(target);
  const app = mount(Menu, { target, props });
  mounted.push({ app, target });
  flushSync();
  const trigger = target.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
  return { props, target, trigger };
}

afterEach(async () => {
  for (const { app, target } of mounted.splice(0)) {
    await unmount(app);
    target.remove();
  }
  document.body.replaceChildren();
});

async function settle(): Promise<void> {
  await tick();
  await tick();
  flushSync();
}

function key(el: Element, value: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(event);
  return event;
}

const menuOf = (target: HTMLElement) => target.querySelector<HTMLElement>('[role="menu"]');
const itemsOf = (target: HTMLElement) =>
  [...target.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]')];

const FRUIT: MenuItem[] = [
  { id: "apple", label: "Apple" },
  { id: "banana", label: "Banana" },
  { id: "blueberry", label: "Blueberry" },
  { id: "cherry", label: "Cherry" },
];

describe("the menu button", () => {
  it("opens on the first item with ↓ and on the last with ↑, and names what it controls only while open", async () => {
    const { target, trigger } = render({ items: FRUIT, label: "Fruit", menuId: "fruit-menu" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.hasAttribute("aria-controls")).toBe(false);

    trigger.focus();
    key(trigger, "ArrowDown");
    await settle();
    expect(menuOf(target)?.id).toBe("fruit-menu");
    expect(trigger.getAttribute("aria-controls")).toBe("fruit-menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(itemsOf(target)[0]);

    key(document.activeElement!, "Escape");
    await settle();
    expect(menuOf(target)).toBeNull();
    expect(trigger.hasAttribute("aria-controls")).toBe(false);
    expect(document.activeElement, "Escape hands focus back to the button").toBe(trigger);

    key(trigger, "ArrowUp");
    await settle();
    expect(document.activeElement).toBe(itemsOf(target)[3]);
  });

  it("moves with wrap, jumps with Home and End, and finds an item by its first letter", async () => {
    const { target, trigger } = render({ items: FRUIT, label: "Fruit" });
    trigger.focus();
    key(trigger, "ArrowDown");
    await settle();
    const items = itemsOf(target);
    const at = () => items.indexOf(document.activeElement as HTMLElement);

    key(document.activeElement!, "ArrowUp");
    expect(at(), "up from the first wraps to the last").toBe(3);
    key(document.activeElement!, "ArrowDown");
    expect(at(), "down from the last wraps to the first").toBe(0);
    key(document.activeElement!, "End");
    expect(at()).toBe(3);
    key(document.activeElement!, "Home");
    expect(at()).toBe(0);

    key(document.activeElement!, "b");
    expect(at()).toBe(1);
    key(document.activeElement!, "B");
    expect(at(), "the next one with that letter").toBe(2);
    key(document.activeElement!, "b");
    expect(at(), "and round again").toBe(1);
    const miss = key(document.activeElement!, "z");
    expect(at(), "no item starts with z: focus stays").toBe(1);
    expect(miss.defaultPrevented, "but the letter does not leak out of the menu").toBe(true);
  });
});

describe("Escape belongs to the menu", () => {
  it("never reaches a bubble-phase listener on window registered before the menu", async () => {
    const spy = vi.fn();
    const onWindow = (event: KeyboardEvent) => {
      if (event.key === "Escape") spy(event.defaultPrevented);
    };
    window.addEventListener("keydown", onWindow);
    try {
      const { target, trigger } = render({ items: FRUIT, label: "Fruit" });
      trigger.click();
      await settle();
      expect(menuOf(target)).not.toBeNull();

      key(document.activeElement!, "Escape");
      await settle();
      expect(menuOf(target)).toBeNull();
      expect(spy).not.toHaveBeenCalled();

      // Control: the same key from outside the menu does reach it.
      const outside = document.createElement("button");
      document.body.append(outside);
      key(outside, "Escape");
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", onWindow);
    }
  });
});

describe("checkbox items", () => {
  const RECIPE = (binder: boolean, topBar: boolean): MenuItem[] => [
    { id: "binder", label: "Projects and chapters", kind: "checkbox", checked: binder },
    { id: "topBar", label: "Top bar", kind: "checkbox", checked: topBar },
  ];

  it("show their prop and nothing else: a click asks, and only the owner answers", async () => {
    const onToggle = vi.fn();
    const { props, target, trigger } = render({
      items: RECIPE(true, true),
      label: "Focus options",
      heading: "When Focus is on, hide",
      note: "Takes effect when Focus is on.",
      onToggle,
    });
    trigger.click();
    await settle();
    const [binder] = itemsOf(target);
    expect(binder.getAttribute("role")).toBe("menuitemcheckbox");
    expect(binder.getAttribute("aria-checked")).toBe("true");
    expect(target.querySelector('[role="group"]')?.getAttribute("aria-labelledby")).toBe(
      target.querySelector(".v-menu-heading")?.id,
    );
    const note = target.querySelector(".v-menu-note")!;
    expect(menuOf(target)?.getAttribute("aria-describedby")).toBe(note.id);
    expect(menuOf(target)?.contains(note), "the note sits outside role=menu").toBe(false);

    binder.click();
    await settle();
    expect(onToggle).toHaveBeenCalledWith("binder", false);
    expect(binder.getAttribute("aria-checked"), "nothing changed it yet").toBe("true");
    expect(menuOf(target), "a click keeps the menu open").not.toBeNull();

    // Control: once the owner changes the prop, the item follows.
    props.items = RECIPE(false, true);
    await settle();
    expect(itemsOf(target)[0].getAttribute("aria-checked")).toBe("false");
    expect(itemsOf(target)[0].textContent, "the tick goes with it").not.toContain("✓");
  });

  it("toggle with Space and stay open; toggle with Enter and close", async () => {
    const onToggle = vi.fn();
    const { target, trigger } = render({ items: RECIPE(true, true), label: "Focus options", onToggle });
    trigger.focus();
    key(trigger, "ArrowDown");
    await settle();

    const space = key(document.activeElement!, " ");
    await settle();
    expect(space.defaultPrevented).toBe(true);
    expect(onToggle).toHaveBeenLastCalledWith("binder", false);
    expect(menuOf(target)).not.toBeNull();

    key(document.activeElement!, "ArrowDown");
    key(document.activeElement!, "Enter");
    await settle();
    expect(onToggle).toHaveBeenLastCalledWith("topBar", false);
    expect(menuOf(target)).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("one menu at a time", () => {
  it("opening another closes the first, and closeOpenMenu closes whatever is open", async () => {
    const first = render({ items: FRUIT, label: "First" });
    const second = render({ items: FRUIT, label: "Second" });

    first.trigger.click();
    await settle();
    expect(menuOf(first.target)).not.toBeNull();
    // Focus already dropped out of the first menu to <body>, which leaves it
    // open (a null relatedTarget names nowhere): only the app-wide guard can
    // close it when the second opens.
    (document.activeElement as HTMLElement).blur();
    await settle();
    expect(menuOf(first.target)).not.toBeNull();
    second.trigger.click();
    await settle();
    expect(menuOf(first.target)).toBeNull();
    expect(menuOf(second.target)).not.toBeNull();

    // Scoped: a panel that does not hold the open menu leaves it alone.
    closeOpenMenu(first.target);
    await settle();
    expect(menuOf(second.target)).not.toBeNull();
    closeOpenMenu(second.target);
    await settle();
    expect(menuOf(second.target)).toBeNull();

    first.trigger.click();
    await settle();
    closeOpenMenu();
    await settle();
    expect(menuOf(first.target)).toBeNull();
    expect(first.trigger.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("a menu that goes while open", () => {
  it("tells its owner it closed, so nothing it kept awake stays so", async () => {
    // Focus options lives in the status bar's project group, which unmounts
    // when the project closes; chrome.menuOpen followed onOpenChange, and the
    // edges stayed awake for good.
    const onOpenChange = vi.fn();
    const { trigger } = render({ items: FRUIT, label: "Fruit", onOpenChange });
    trigger.click();
    await settle();
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    const { app, target } = mounted.pop()!;
    await unmount(app);
    target.remove();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });

  it("says nothing when it was already closed", async () => {
    const onOpenChange = vi.fn();
    render({ items: FRUIT, label: "Fruit", onOpenChange });
    const { app, target } = mounted.pop()!;
    await unmount(app);
    target.remove();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("action items", () => {
  it("run on click and close the menu", async () => {
    const onChoose = vi.fn();
    const { target, trigger } = render({
      items: [...FRUIT, { id: "delete", label: "Delete", destructive: true }],
      label: "Fruit",
      onChoose,
    });
    trigger.click();
    await settle();
    const roles = [...menuOf(target)!.children].map((child) => child.getAttribute("role"));
    expect(roles).toEqual(["menuitem", "menuitem", "menuitem", "menuitem", "separator", "menuitem"]);
    itemsOf(target)[4].click();
    await settle();
    expect(onChoose).toHaveBeenCalledWith("delete");
    expect(menuOf(target)).toBeNull();
  });
});
