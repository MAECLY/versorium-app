import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  contextMenuZone,
  decideContextMenu,
  installContextMenuPolicy,
  installReloadKeyGuard,
  isContextMenuKey,
  isContextPress,
  isEditable,
} from "./policy";

// The rules in isolation. The engines' half of the story (focus, word
// selection, the click WebKit sends after a Ctrl+click) is pinned by
// tests/e2e/context-menu.spec.ts and tests/scratch/context-menu-webkit-probe.mjs.

function onPlatform(platform: string, userAgent = navigator.userAgent): void {
  Object.defineProperty(window.navigator, "platform", { value: platform, configurable: true });
  Object.defineProperty(window.navigator, "userAgent", { value: userAgent, configurable: true });
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  document.body.append(node);
  return node;
}

function mouse(type: string, init: MouseEventInit = {}): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
}

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
}

/** A selection with one range covering a 100×20 box at the origin. */
function selectionOver(target: Node): Selection {
  return {
    isCollapsed: false,
    rangeCount: 1,
    getRangeAt: () => ({
      intersectsNode: (node: Node) => node === target,
      getClientRects: () => [{ left: 0, top: 0, right: 100, bottom: 20 }],
    }),
  } as unknown as Selection;
}

afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(window.navigator, "platform");
  Reflect.deleteProperty(window.navigator, "userAgent");
});

describe("what counts as text", () => {
  it("is a field the writer can type in, and nothing else", () => {
    expect(isEditable(el("input"))).toBe(true);
    expect(isEditable(el("input", { type: "password" }))).toBe(true);
    expect(isEditable(el("input", { type: "number" }))).toBe(true);
    expect(isEditable(el("textarea"))).toBe(true);
    expect(isEditable(el("input", { type: "checkbox" }))).toBe(false);
    expect(isEditable(el("input", { type: "range" }))).toBe(false);
    expect(isEditable(el("input", { disabled: "" }))).toBe(false);
    expect(isEditable(el("input", { readonly: "" }))).toBe(false);
    expect(isEditable(el("textarea", { disabled: "" }))).toBe(false);
    expect(isEditable(el("button"))).toBe(false);
    expect(isEditable(el("select"))).toBe(false);
  });

  it("follows contenteditable, which is what the manuscript is", () => {
    const line = el("span");
    // jsdom does not compute isContentEditable; engines do.
    Object.defineProperty(line, "isContentEditable", { value: true });
    expect(isEditable(line)).toBe(true);
    expect(isEditable(el("div"))).toBe(false);
  });
});

describe("the verdict", () => {
  it("keeps the engine's menu over text and cancels it everywhere else", () => {
    expect(decideContextMenu(el("input"), 5, 5, null)).toBe("native");
    expect(decideContextMenu(el("button"), 5, 5, null)).toBe("suppress");
    expect(decideContextMenu(el("p"), 5, 5, null)).toBe("suppress");
  });

  it("keeps it on a selection only under the pointer, and never over a control", () => {
    const text = el("p");
    expect(decideContextMenu(text, 50, 10, selectionOver(text))).toBe("native");
    expect(decideContextMenu(text, 150, 10, selectionOver(text)), "beside the selection").toBe("suppress");
    const button = el("button");
    expect(decideContextMenu(button, 50, 10, selectionOver(button)), "a selected control").toBe("suppress");
    const menu = el("div", { role: "menu" });
    const item = document.createElement("span");
    menu.append(item);
    expect(decideContextMenu(item, 50, 10, selectionOver(item)), "inside an item menu").toBe("suppress");
  });

  it("treats a link as a control, so the engine never offers to open it in the app's window", () => {
    const link = el("a", { href: "https://www.maecly.com" });
    const words = document.createElement("span");
    link.append(words);
    expect(decideContextMenu(words, 50, 10, selectionOver(words)), "selected words inside a link").toBe("suppress");
    expect(decideContextMenu(link, 50, 10, selectionOver(link)), "a selected link").toBe("suppress");
    // An anchor with no address goes nowhere: it is only text.
    const plain = el("a");
    expect(decideContextMenu(plain, 50, 10, selectionOver(plain))).toBe("native");
  });
});

describe("the keys and presses that ask for a menu", () => {
  it("is Shift+F10 alone, or the Menu key", () => {
    expect(isContextMenuKey(key({ key: "ContextMenu" }))).toBe(true);
    expect(isContextMenuKey(key({ key: "F10", shiftKey: true }))).toBe(true);
    expect(isContextMenuKey(key({ key: "F10" }))).toBe(false);
    expect(isContextMenuKey(key({ key: "F10", shiftKey: true, ctrlKey: true }))).toBe(false);
  });

  it("treats Ctrl+click as a right-click on a Mac only", () => {
    expect(isContextPress(mouse("pointerdown", { button: 2 }))).toBe(true);
    onPlatform("Win32");
    expect(isContextPress(mouse("pointerdown", { button: 0, ctrlKey: true }))).toBe(false);
    onPlatform("MacIntel");
    expect(isContextPress(mouse("pointerdown", { button: 0, ctrlKey: true }))).toBe(true);
    expect(isContextPress(mouse("pointerdown", { button: 0 }))).toBe(false);
  });
});

describe("the installed policy", () => {
  let uninstall: () => void;
  beforeEach(() => {
    uninstall = installContextMenuPolicy(window);
  });
  afterEach(() => uninstall());

  it("cancels the page menu and the press under it, and leaves text alone", () => {
    const button = el("button");
    button.dispatchEvent(mouse("pointerdown", { button: 2 }));
    const press = mouse("mousedown", { button: 2 });
    button.dispatchEvent(press);
    expect(press.defaultPrevented, "the press would move focus").toBe(true);
    const menu = mouse("contextmenu", { button: 2 });
    button.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);

    const field = el("input");
    field.dispatchEvent(mouse("pointerdown", { button: 2 }));
    const fieldPress = mouse("mousedown", { button: 2 });
    field.dispatchEvent(fieldPress);
    expect(fieldPress.defaultPrevented, "the word under the pointer is what spelling acts on").toBe(false);
    const fieldMenu = mouse("contextmenu", { button: 2 });
    field.dispatchEvent(fieldMenu);
    expect(fieldMenu.defaultPrevented).toBe(false);
  });

  it("cancels the press itself, which is all a disabled control is sent", () => {
    const disabled = el("button", { disabled: "" });
    const press = mouse("pointerdown", { button: 2 });
    disabled.dispatchEvent(press);
    expect(press.defaultPrevented, "it would move focus to <body>").toBe(true);

    const fieldPress = mouse("pointerdown", { button: 2 });
    el("input").dispatchEvent(fieldPress);
    expect(fieldPress.defaultPrevented).toBe(false);
  });

  it("lets a primary press through untouched", () => {
    const button = el("button");
    const down = mouse("pointerdown", { button: 0 });
    button.dispatchEvent(down);
    const press = mouse("mousedown", { button: 0 });
    button.dispatchEvent(press);
    expect(down.defaultPrevented).toBe(false);
    expect(press.defaultPrevented).toBe(false);
  });

  it("cancels the release that follows a cancelled right-click, and only that one", () => {
    // WebKit runs a checkbox's activation on this auxclick: the box toggles,
    // and a <label> clicks the box it names.
    const label = el("label");
    label.dispatchEvent(mouse("pointerdown", { button: 2 }));
    label.dispatchEvent(mouse("contextmenu", { button: 2 }));
    const release = mouse("auxclick", { button: 2 });
    label.dispatchEvent(release);
    expect(release.defaultPrevented).toBe(true);
    const again = mouse("auxclick", { button: 2 });
    label.dispatchEvent(again);
    expect(again.defaultPrevented, "one-shot").toBe(false);

    // Text keeps its menu, and its release is none of the policy's business.
    const field = el("input");
    field.dispatchEvent(mouse("pointerdown", { button: 2 }));
    field.dispatchEvent(mouse("contextmenu", { button: 2 }));
    const fieldRelease = mouse("auxclick", { button: 2 });
    field.dispatchEvent(fieldRelease);
    expect(fieldRelease.defaultPrevented).toBe(false);

    // A cancelled menu whose release never came (dragged away) does not reach
    // into the next press, here one over text.
    label.dispatchEvent(mouse("pointerdown", { button: 2 }));
    label.dispatchEvent(mouse("contextmenu", { button: 2 }));
    field.dispatchEvent(mouse("pointerdown", { button: 2 }));
    field.dispatchEvent(mouse("contextmenu", { button: 2 }));
    const next = mouse("auxclick", { button: 2 });
    field.dispatchEvent(next);
    expect(next.defaultPrevented).toBe(false);
  });

  it("cancels the release of a right-click a zone claims, whatever is under it", () => {
    // A field inside a zone, which the policy alone would leave to the engine.
    const zone = el("div");
    const field = document.createElement("input");
    zone.append(field);
    const detach = contextMenuZone({ open: () => {}, enabled: () => true })(zone) ?? (() => {});
    field.dispatchEvent(mouse("pointerdown", { button: 2 }));
    field.dispatchEvent(mouse("contextmenu", { button: 2 }));
    const release = mouse("auxclick", { button: 2 });
    field.dispatchEvent(release);
    expect(release.defaultPrevented).toBe(true);
    detach();
  });

  it("eats the click WebKit sends after a cancelled Ctrl+click, and nothing else", () => {
    onPlatform("MacIntel");
    const button = el("button");
    const pressed = vi.fn();
    button.addEventListener("click", pressed);

    button.dispatchEvent(mouse("pointerdown", { button: 0, ctrlKey: true }));
    button.dispatchEvent(mouse("contextmenu", { button: 0, ctrlKey: true }));
    const tail = mouse("click", { button: 0, ctrlKey: true, detail: 1 });
    button.dispatchEvent(tail);
    expect(tail.defaultPrevented).toBe(true);
    expect(pressed).not.toHaveBeenCalled();

    // One-shot: the next real click goes through.
    button.dispatchEvent(mouse("pointerdown", { button: 0 }));
    button.dispatchEvent(mouse("click", { button: 0, detail: 1 }));
    expect(pressed).toHaveBeenCalledTimes(1);
  });

  it("never eats a keyboard click, which Chrome can send before any pointerdown", () => {
    onPlatform("MacIntel");
    const button = el("button");
    const pressed = vi.fn();
    button.addEventListener("click", pressed);
    button.dispatchEvent(mouse("pointerdown", { button: 0, ctrlKey: true }));
    button.dispatchEvent(mouse("contextmenu", { button: 0, ctrlKey: true }));
    button.dispatchEvent(mouse("click", { detail: 0 }));
    expect(pressed).toHaveBeenCalledTimes(1);
  });

  it("steps aside for Shift in a dev build, so Inspect Element stays reachable", () => {
    expect(import.meta.env.DEV).toBe(true);
    const button = el("button");
    const down = mouse("pointerdown", { button: 2, shiftKey: true });
    button.dispatchEvent(down);
    const press = mouse("mousedown", { button: 2, shiftKey: true });
    button.dispatchEvent(press);
    const menu = mouse("contextmenu", { button: 2, shiftKey: true });
    button.dispatchEvent(menu);
    const release = mouse("auxclick", { button: 2, shiftKey: true });
    button.dispatchEvent(release);
    expect(down.defaultPrevented).toBe(false);
    expect(press.defaultPrevented).toBe(false);
    expect(menu.defaultPrevented).toBe(false);
    expect(release.defaultPrevented).toBe(false);
  });

  it("is gone once uninstalled", () => {
    uninstall();
    const menu = mouse("contextmenu", { button: 2 });
    el("button").dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(false);
    uninstall = installContextMenuPolicy(window);
  });
});

describe("the reload and print keys", () => {
  const prevented = (init: KeyboardEventInit): boolean => {
    const event = key(init);
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  };

  it("are cancelled on Windows, and editing keys are not", () => {
    onPlatform("Win32");
    const uninstall = installReloadKeyGuard(window);
    expect(prevented({ key: "F5" })).toBe(true);
    expect(prevented({ key: "F5", ctrlKey: true })).toBe(true);
    expect(prevented({ key: "BrowserRefresh" })).toBe(true);
    expect(prevented({ key: "r", code: "KeyR", ctrlKey: true })).toBe(true);
    // Restore's key: cancelled for the webview, still run by App's listener,
    // which ignores defaultPrevented.
    expect(prevented({ key: "r", code: "KeyR", ctrlKey: true, altKey: true })).toBe(true);
    expect(prevented({ key: "p", code: "KeyP", ctrlKey: true })).toBe(true);
    expect(prevented({ key: "f", code: "KeyF", ctrlKey: true }), "CodeMirror's search").toBe(false);
    expect(prevented({ key: "ArrowLeft", altKey: true }), "cursorSyntaxLeft").toBe(false);
    expect(prevented({ key: "Shift", shiftKey: true })).toBe(false);
    uninstall();
    expect(prevented({ key: "F5" })).toBe(false);
  });

  it("follow the key in the R position on a non-Latin layout, but not AltGr", () => {
    onPlatform("Win32");
    const uninstall = installReloadKeyGuard(window);
    expect(prevented({ key: "к", code: "KeyR", ctrlKey: true }), "Cyrillic Ctrl+R").toBe(true);
    expect(prevented({ key: "®", code: "KeyR", ctrlKey: true, altKey: true }), "AltGr types ®").toBe(false);
    uninstall();
  });

  it("step aside for Shift in a dev build on the refresh keys only, so Shift+F5 reloads the dev window", () => {
    onPlatform("Win32");
    const uninstall = installReloadKeyGuard(window);
    expect(prevented({ key: "F5", shiftKey: true })).toBe(false);
    expect(prevented({ key: "BrowserRefresh", shiftKey: true })).toBe(false);
    // Rewrite's key would otherwise reach WebView2's hard reload.
    expect(prevented({ key: "R", code: "KeyR", ctrlKey: true, shiftKey: true }), "Ctrl+Shift+R").toBe(true);
    expect(prevented({ key: "P", code: "KeyP", ctrlKey: true, shiftKey: true }), "Ctrl+Shift+P").toBe(true);
    uninstall();
  });

  it("are left alone off Windows, where Ctrl+P is the line above", () => {
    onPlatform("MacIntel", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    const uninstall = installReloadKeyGuard(window);
    expect(prevented({ key: "p", code: "KeyP", ctrlKey: true })).toBe(false);
    expect(prevented({ key: "F5" })).toBe(false);
    uninstall();
  });

  it("recognise Windows by its user agent too", () => {
    onPlatform("", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    const uninstall = installReloadKeyGuard(window);
    expect(prevented({ key: "F5" })).toBe(true);
    uninstall();
  });
});

describe("a zone", () => {
  function zone(enabled = true) {
    const node = el("div");
    const button = document.createElement("button");
    node.append(button);
    const open = vi.fn();
    const detach = contextMenuZone({ open, enabled: () => enabled })(node);
    return { node, button, open, detach: detach ?? (() => {}) };
  }

  it("opens its menu at the pointer and takes the event", () => {
    const { button, open, detach } = zone();
    const event = mouse("contextmenu", { button: 2, clientX: 40, clientY: 30 });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith({ x: 40, y: 30, align: "start" });
    detach();
  });

  it("opens from Shift+F10 and the Menu key, under the focused element", () => {
    const { button, open, detach } = zone();
    for (const init of [{ key: "F10", shiftKey: true }, { key: "ContextMenu" }]) {
      const event = key(init);
      button.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(open).toHaveBeenCalledTimes(2);
    expect(open.mock.calls[0][0]).toMatchObject({ align: "start" });
    detach();
  });

  it("does nothing while disabled, or from inside its own open menu", () => {
    const disabled = zone(false);
    disabled.button.dispatchEvent(mouse("contextmenu", { button: 2 }));
    disabled.button.dispatchEvent(key({ key: "ContextMenu" }));
    expect(disabled.open).not.toHaveBeenCalled();
    disabled.detach();

    const { node, open, detach } = zone();
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const item = document.createElement("button");
    menu.append(item);
    node.append(menu);
    item.dispatchEvent(mouse("contextmenu", { button: 2 }));
    item.dispatchEvent(key({ key: "F10", shiftKey: true }));
    expect(open).not.toHaveBeenCalled();
    detach();
  });

  it("leaves Shift+right-click to the engine in a dev build", () => {
    const { button, open, detach } = zone();
    const event = mouse("contextmenu", { button: 2, shiftKey: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
    detach();
  });
});
