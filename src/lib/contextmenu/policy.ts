import type { Attachment } from "svelte/attachments";

/**
 * Who a right-click belongs to, settled once per click.
 *
 * Over text it belongs to the platform. The engine's own menu is the only
 * place spelling guesses, Look Up, Translate, Writing Tools and a Paste
 * without a permission prompt live, and a page can neither read nor redraw
 * them. Over binder rows and corkboard cards it belongs to Versorium, which
 * opens the same menu as their ⋯. Everywhere else it is cancelled: what the
 * engine shows there is a page menu whose main item is Reload, and a reload
 * mid-chapter loses up to 800 ms of typing, the queued ops, the undo history
 * and the session Restore works from.
 *
 * App.svelte installs this from onMount, not main.ts, so the boot-failure
 * screen keeps the engine's Reload: there it is the only way out, and there is
 * no text yet to lose. Every listener is capture-phase on window, ahead of
 * Svelte's delegated handlers on the mount root and the document, so no
 * component can leak the page menu by stopping propagation, and one written
 * next year is covered without knowing this rule exists.
 */

export type ContextMenuVerdict = "native" | "suppress";

/** Where an item menu opens: a point, and which of its edges sits on it. */
export interface MenuAnchor {
  x: number;
  y: number;
  align?: "start" | "end";
}

const TEXT_INPUT = new Set(["text", "search", "password", "email", "url", "tel", "number"]);

/**
 * WebKit maps the pointer through its own hit test to choose between the
 * selected-text menu and the page menu, and over a control it can answer
 * "page menu" where a bare rectangle test says "on the selection". Erring
 * toward suppression costs a right-click Copy on a selection that runs across
 * a control; erring the other way shows Reload.
 */
const NOT_TEXT = 'button, select, label, [role="button"], [role="menu"], [role="menuitem"]';

function onMac(): boolean {
  return /Mac/.test(navigator.platform);
}

function onWindows(win: Window): boolean {
  return /^Win/.test(win.navigator.platform) || /Windows/.test(win.navigator.userAgent);
}

/**
 * Shift reaches the engine's own menu, Inspect Element included, in a dev
 * build only (Firefox's Shift+right-click convention). DEV is a build-time
 * constant, so a release bundle carries no way around the policy.
 */
function bypassed(event: MouseEvent | KeyboardEvent): boolean {
  return import.meta.env.DEV && event.shiftKey;
}

/** Targets are not always elements (a text node, the document); every rule here is about one. */
function elementOf(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  return target instanceof Node ? target.parentElement : null;
}

/** A press that asks for a menu: the secondary button, or Ctrl+click where macOS makes it one. */
export function isContextPress(event: MouseEvent): boolean {
  return event.button === 2 || (event.button === 0 && event.ctrlKey && onMac());
}

/** Shift+F10 and the Menu key, the keyboard's two ways of asking for a context menu. */
export function isContextMenuKey(event: KeyboardEvent): boolean {
  if (event.key === "ContextMenu") return true;
  return event.key === "F10" && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
}

/**
 * Text the writer can type into. Checkboxes, radios, selects and buttons are
 * not text, and neither is a disabled or read-only field: none of them has
 * spelling or Paste to offer, only the page menu.
 */
export function isEditable(target: EventTarget | null): boolean {
  const el = elementOf(target);
  if (el instanceof HTMLInputElement) {
    return TEXT_INPUT.has(el.type) && !el.matches(":disabled") && !el.readOnly;
  }
  if (el instanceof HTMLTextAreaElement) return !el.matches(":disabled") && !el.readOnly;
  return el instanceof HTMLElement && el.isContentEditable === true;
}

/** The pointer is on text the writer already selected, and not on a control drawn over it. */
export function onSelection(
  target: EventTarget | null,
  x: number,
  y: number,
  selection: Selection | null,
): boolean {
  const el = elementOf(target);
  if (!el || !selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  if (el.closest(NOT_TEXT)) return false;
  const style = getComputedStyle(el);
  const userSelect = style.getPropertyValue("user-select") || style.getPropertyValue("-webkit-user-select");
  if (userSelect === "none") return false;
  for (let i = 0; i < selection.rangeCount; i += 1) {
    const range = selection.getRangeAt(i);
    if (!range.intersectsNode(el)) continue;
    for (const rect of range.getClientRects()) {
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true;
    }
  }
  return false;
}

/** 'native' keeps the engine's menu untouched; anything else is cancelled. No side effects. */
export function decideContextMenu(
  target: EventTarget | null,
  x: number,
  y: number,
  selection: Selection | null,
): ContextMenuVerdict {
  return isEditable(target) || onSelection(target, x, y, selection) ? "native" : "suppress";
}

/**
 * What the release of a cancelled context press would still do. A native
 * menu's tracking loop used to swallow that release; with the menu cancelled
 * it reaches the page.
 *
 * - WebKit follows a Ctrl+click whose contextmenu was cancelled with a click,
 *   which would open the chapter under a row's menu, or press Save snapshot
 *   under cancelled chrome.
 * - WebKit sends a right button's release as an auxclick and runs a
 *   checkbox's activation on it: the box toggles, with no click at all, and a
 *   <label> clicks the box it names. That saved a project setting or switched
 *   automatic updates off.
 *
 * Chrome does neither. Both are one-shot and cleared by the next pointerdown,
 * because Chrome sends no click and Windows sends the auxclick before the
 * contextmenu. Shared by the policy and the zones, which both cancel.
 */
let swallowNextClick = false;
let cancelNextAuxClick = false;

function guardRelease(event: MouseEvent): void {
  if (event.button === 0 && event.ctrlKey && onMac()) swallowNextClick = true;
  if (event.button === 2) cancelNextAuxClick = true;
}

/**
 * A zone takes this right-click for its own menu. False under the dev bypass,
 * when the engine's menu (and its Inspect Element) is what was asked for.
 */
export function claimContextMenu(event: MouseEvent): boolean {
  if (bypassed(event)) return false;
  event.preventDefault();
  guardRelease(event);
  return true;
}

/**
 * Installs the policy on a window and returns its uninstall.
 *
 * The press guard is the half that is easy to miss. By the time contextmenu
 * fires, the press has already done its work: Chrome focuses the button under
 * it, WebKit sends focus to <body> and selects the word under the pointer, and
 * the writer's caret is gone. Cancelling the press keeps focus where it was.
 * That means pointerdown itself, which also withholds the mousedown: a
 * disabled button is sent no mousedown at all, and the engine still moves
 * focus to <body> for it. mousedown stays cancelled for an engine that sends
 * one anyway. Cancelling selectstart stops WebKit's word selection, which
 * survives a cancelled mousedown. None of it is cancelled over text, where
 * selecting the word is what spelling and Look Up act on.
 */
export function installContextMenuPolicy(win: Window = window): () => void {
  let pressArmed = false;

  const verdict = (event: MouseEvent): ContextMenuVerdict =>
    decideContextMenu(event.target, event.clientX, event.clientY, win.document.getSelection());

  const onPointerDown = (event: PointerEvent): void => {
    swallowNextClick = false;
    cancelNextAuxClick = false;
    pressArmed = isContextPress(event) && !bypassed(event) && verdict(event) === "suppress";
    if (pressArmed) event.preventDefault();
  };
  const cancelWhileArmed = (event: Event): void => {
    if (pressArmed) event.preventDefault();
  };
  const disarm = (): void => {
    pressArmed = false;
  };
  const onContextMenu = (event: MouseEvent): void => {
    pressArmed = false;
    if (bypassed(event) || verdict(event) === "native") return;
    event.preventDefault();
    guardRelease(event);
  };
  const onClick = (event: MouseEvent): void => {
    if (!swallowNextClick) return;
    swallowNextClick = false;
    // A click from Enter or Space (detail 0) is never the tail of a Ctrl+press.
    // Without this, Chrome, which sends no tail, would eat the first keyboard
    // choice made in the menu that Ctrl+click opened.
    if (event.detail === 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  // Cancelling is enough: nothing in the app listens for auxclick, and the
  // activation WebKit runs on it is its default action.
  const onAuxClick = (event: MouseEvent): void => {
    if (!cancelNextAuxClick || event.button !== 2) return;
    cancelNextAuxClick = false;
    event.preventDefault();
  };

  const listeners: [string, EventListener][] = [
    ["pointerdown", onPointerDown as EventListener],
    ["mousedown", cancelWhileArmed],
    ["selectstart", cancelWhileArmed],
    ["pointerup", disarm],
    ["pointercancel", disarm],
    ["contextmenu", onContextMenu as EventListener],
    ["click", onClick as EventListener],
    ["auxclick", onAuxClick as EventListener],
  ];
  for (const [type, listener] of listeners) win.addEventListener(type, listener, true);
  return () => {
    for (const [type, listener] of listeners) win.removeEventListener(type, listener, true);
    pressArmed = false;
    swallowNextClick = false;
    cancelNextAuxClick = false;
  };
}

function below(el: Element): MenuAnchor {
  const box = el.getBoundingClientRect();
  return { x: box.left, y: box.bottom, align: "start" };
}

/**
 * Makes an element a place whose right-click opens an item menu.
 *
 * An attachment rather than oncontextmenu/onkeydown on the markup: both are
 * interactive handlers, and on a <div> or an <li> they trip
 * a11y_no_static_element_interactions. It goes on the wrapper around the
 * button, not on the button, because engines still dispatch contextmenu to a
 * disabled button and bubble it, and because a right-click fires auxclick,
 * never click, so the row underneath does not open.
 *
 * The page menu has already been cancelled in the capture phase by the time
 * this runs; this only decides whether the item menu opens.
 */
export function contextMenuZone(options: {
  open: (at: MenuAnchor) => void;
  enabled: () => boolean;
}): Attachment<HTMLElement> {
  return (node) => {
    // The menu renders inside the zone. A second right-click on it, or the
    // keyup contextmenu Windows aims at its first item, must not reopen it.
    const fromOwnMenu = (event: Event): boolean => {
      const menu = elementOf(event.target)?.closest('[role="menu"]');
      return !!menu && node.contains(menu);
    };

    const onContextMenu = (event: MouseEvent): void => {
      if (fromOwnMenu(event) || !options.enabled() || !claimContextMenu(event)) return;
      // button -1 is a contextmenu no pointer produced (Chrome's Menu key).
      if (event.button !== -1) {
        options.open({ x: event.clientX, y: event.clientY, align: "start" });
        return;
      }
      const active = document.activeElement;
      options.open(below(active && node.contains(active) ? active : (elementOf(event.target) ?? node)));
    };

    // Handled on keydown because neither Chrome nor WebKit on macOS sends a
    // contextmenu for Shift+F10, and WebKit sends none for the Menu key.
    // Cancelling the key also stops the one WebView2 and WebKitGTK would send.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isContextMenuKey(event) || fromOwnMenu(event) || !options.enabled()) return;
      event.preventDefault();
      event.stopPropagation();
      options.open(below(elementOf(event.target) ?? node));
    };

    node.addEventListener("contextmenu", onContextMenu);
    node.addEventListener("keydown", onKeyDown);
    return () => {
      node.removeEventListener("contextmenu", onContextMenu);
      node.removeEventListener("keydown", onKeyDown);
    };
  };
}

/**
 * The letter an accelerator is matched on. On a Latin layout that is `key`.
 * On Cyrillic, Greek or Hebrew, `key` is not a Latin letter while Windows
 * still reports the Latin virtual key, so WebView2 reloads on the key in the R
 * position; `code` stands in for it. Not with Alt held: AltGr arrives as
 * Ctrl+Alt and types characters such as ®, which must reach the page.
 */
function acceleratorLetter(event: KeyboardEvent): string {
  const key = event.key.toLowerCase();
  if (/^[a-z]$/.test(key)) return key;
  return !event.altKey && /^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase() : "";
}

function refreshKey(event: KeyboardEvent): boolean {
  return event.key === "F5" || event.key === "BrowserRefresh";
}

function reloadsOrPrints(event: KeyboardEvent): boolean {
  if (refreshKey(event)) return true;
  if (!event.ctrlKey || event.metaKey) return false;
  const letter = acceleratorLetter(event);
  return letter === "r" || (letter === "p" && !event.altKey);
}

/**
 * Shift+F5 in a dev build, the developer reloading on purpose. The refresh
 * keys only: with Shift waived on every key, Ctrl+Shift+R (Rewrite's key) and
 * Ctrl+Shift+P would also get past the guard, and the dev window should
 * behave like a release one apart from this one way out.
 */
function devReload(event: KeyboardEvent): boolean {
  return bypassed(event) && refreshKey(event);
}

/**
 * Cancels the reload and print keys WebView2 keeps in release builds. wry
 * leaves browser accelerator keys on and tauri-runtime-wry exposes no switch
 * for them, so F5 and Ctrl+R reload the window with the same loss as the
 * menu's Reload, no right-click involved.
 *
 * Windows only. WKWebView and WebKitGTK bind no reload key, and on macOS
 * Ctrl+P and Ctrl+F are Cocoa and CodeMirror emacs bindings that must keep
 * working. Left alone on purpose: Alt+Arrow, which CodeMirror binds to
 * cursorSyntaxLeft/Right off macOS and would skip once defaultPrevented is
 * set; Back/Forward, harmless while nothing pushes history; and Ctrl+F,
 * CodeMirror's search. App's Ctrl+Shift+R (Rewrite) and Ctrl+Alt+R (Restore)
 * still run, because its window listener ignores defaultPrevented.
 */
export function installReloadKeyGuard(win: Window = window): () => void {
  if (!onWindows(win)) return () => {};
  const onKeyDown = (event: KeyboardEvent): void => {
    if (reloadsOrPrints(event) && !devReload(event)) event.preventDefault();
  };
  win.addEventListener("keydown", onKeyDown, true);
  return () => win.removeEventListener("keydown", onKeyDown, true);
}
