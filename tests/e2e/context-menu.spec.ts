import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";

// Who a right-click belongs to (src/lib/contextmenu/policy.ts). Over text, the
// engine's own menu, untouched: it is where spelling, Look Up and Paste live.
// Over binder rows and corkboard cards, the same menu as their ⋯. Everywhere
// else, nothing: the engine's page menu there leads with Reload, and a reload
// mid-chapter loses the last 800 ms of typing.
//
// "Native" and "cancelled" are told apart by a bubble-phase window listener
// reading defaultPrevented. It runs after the policy and the zones, and nothing
// stops a contextmenu's propagation. Runs against the mocked IPC.

declare global {
  interface Window {
    __describeFocus: () => string;
    __menus: { prevented: boolean; focus: string }[];
    __auxclicks: { button: number; prevented: boolean }[];
    __keys: { key: string; prevented: boolean }[];
    __releaseReads: () => void;
    __caretOnFocus: number;
  }
}

// What has focus, in words a failure message can show.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__describeFocus = () => {
      const el = document.activeElement;
      if (!el || el === document.body) return "body";
      if (el.classList.contains("cm-content")) return "manuscript";
      const key = (el as HTMLElement).dataset?.itemKey;
      if (key) return key;
      return `${el.tagName.toLowerCase()}[role=${el.getAttribute("role") ?? ""}]`;
    };
  });
});

/**
 * Records every contextmenu. Focus is read in the capture phase, before the
 * zone opens a menu and moves focus into it, which is the moment the press
 * itself is judged by. The auxclick a right button's release sends is
 * recorded too: WebKit runs a checkbox's activation on it.
 */
async function recordMenus(page: Page) {
  await page.addInitScript(() => {
    let focus = "";
    window.__menus = [];
    window.__auxclicks = [];
    window.addEventListener("contextmenu", () => (focus = window.__describeFocus()), true);
    window.addEventListener("contextmenu", (event) => {
      window.__menus.push({ prevented: event.defaultPrevented, focus });
    });
    window.addEventListener("auxclick", (event) => {
      window.__auxclicks.push({ button: event.button, prevented: event.defaultPrevented });
    });
  });
}

function lastAuxClick(page: Page) {
  return page.evaluate(() => window.__auxclicks.at(-1) ?? null);
}

/**
 * Pins the platform before the app loads, so the Mac-only and Windows-only
 * rules behave the same on this Mac and on the Linux CI runner. Only the OS
 * part of the user agent changes; CodeMirror reads its browser from the rest.
 */
async function onPlatform(page: Page, platform: "mac" | "windows") {
  await page.addInitScript((target) => {
    const ua = navigator.userAgent.replace(
      /\([^)]*\)/,
      target === "windows" ? "(Windows NT 10.0; Win64; x64)" : "(Macintosh; Intel Mac OS X 10_15_7)",
    );
    Object.defineProperty(Navigator.prototype, "platform", {
      get: () => (target === "windows" ? "Win32" : "MacIntel"),
    });
    Object.defineProperty(Navigator.prototype, "userAgent", { get: () => ua });
  }, platform);
}

async function withProject(page: Page, title = "El largo invierno", query = "") {
  await page.goto(`/?mock=tauri${query}`);
  await page.getByRole("button", { name: "Create your first novel" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
}

async function addChapter(page: Page, title: string) {
  await page.getByRole("button", { name: "New chapter" }).click();
  const dialog = page.getByRole("dialog", { name: "New chapter" });
  await dialog.getByLabel("Chapter title").fill(title);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toBeHidden();
}

/** Three chapters, the first one open. */
async function withThreeChapters(page: Page) {
  await withProject(page);
  await addChapter(page, "Segundo");
  await addChapter(page, "Tercero");
  await chapterRow(page, "El largo invierno").click();
  await expect(chapterRow(page, "El largo invierno")).toHaveAttribute("aria-current", "true");
}

/** The row itself, not its ⋯, whose text is only the ellipsis. */
function chapterRow(page: Page, title: string, list = "Chapters"): Locator {
  return page.getByRole("list", { name: list }).getByRole("button").filter({ hasText: title });
}

function novelRow(page: Page, title: string, list = "Projects"): Locator {
  return page.getByRole("list", { name: list }).getByRole("button").filter({ hasText: title });
}

function card(page: Page, title: string, list = "Corkboard"): Locator {
  return page.getByRole("list", { name: list }).getByRole("button", { name: new RegExp(title) });
}

async function openBoard(page: Page) {
  await page.getByRole("contentinfo").getByRole("button", { name: "Corkboard" }).click();
  await expect(page.getByRole("list", { name: "Corkboard" })).toBeVisible();
  await expect(page.getByText("Reading chapters…")).toHaveCount(0);
}

async function typeInManuscript(page: Page, text: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.type(text);
}

function manuscript(page: Page) {
  return page.locator(".cm-content").innerText();
}

function menu(page: Page): Locator {
  return page.getByRole("menu");
}

async function menuItems(page: Page): Promise<string[]> {
  return (await menu(page).getByRole("menuitem").allTextContents()).map((s) => s.trim());
}

function focused(page: Page): Promise<string> {
  return page.evaluate(() => window.__describeFocus());
}

function keyOf(page: Page, row: Locator): Promise<string> {
  return row.evaluate((el) => (el as HTMLElement).dataset.itemKey ?? "");
}

function calls(page: Page, cmd: string): Promise<number> {
  return page.evaluate((name) => window.__VERSORIUM_MOCK__.calls.filter((c) => c.cmd === name).length, cmd);
}

function mockTitles(page: Page): Promise<string[]> {
  return page.evaluate(() => [...window.__VERSORIUM_MOCK__.projects.values()][0].chapters.map((c) => c.title));
}

/**
 * Right-clicks and returns the contextmenu as recorded. A point rather than a
 * locator for disabled controls: Playwright's click waits for them to enable.
 */
async function rightClick(
  page: Page,
  where: Locator | { x: number; y: number },
  modifiers: ("Shift" | "Control")[] = [],
) {
  const before = await page.evaluate(() => window.__menus.length);
  if ("x" in where) {
    for (const key of modifiers) await page.keyboard.down(key);
    await page.mouse.click(where.x, where.y, { button: "right" });
    for (const key of modifiers) await page.keyboard.up(key);
  } else {
    await where.click({ button: "right", modifiers });
  }
  await expect.poll(() => page.evaluate(() => window.__menus.length)).toBeGreaterThan(before);
  return page.evaluate(() => window.__menus[window.__menus.length - 1]);
}

/** The top bar's empty stretch between the version and its first button. */
async function topBarGap(page: Page) {
  const header = page.getByRole("banner");
  const version = (await header.getByText(/^v\d/).boundingBox())!;
  const first = (await header.getByRole("button").first().boundingBox())!;
  const point = { x: (version.x + version.width + first.x) / 2, y: version.y + version.height / 2 };
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, point);
  expect(hit, "the point is the bar itself, not a control on it").toBe("HEADER");
  return point;
}

async function centre(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Holds every read_chapter until released, so a chapter switch stays in flight. */
async function holdReads(page: Page) {
  await page.evaluate(() => {
    const internals = window.__TAURI_INTERNALS__;
    const invoke = internals.invoke.bind(internals);
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    window.__releaseReads = release;
    internals.invoke = async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "read_chapter") await gate;
      return invoke(cmd, args);
    };
  });
}

test("right-click on a chapter row opens that row's ⋯ menu, and nothing else happens", async ({ page }) => {
  await recordMenus(page);
  await withThreeChapters(page);
  const reads = await calls(page, "read_chapter");

  const result = await rightClick(page, chapterRow(page, "Tercero"));
  expect(result.prevented).toBe(true);

  // Exactly the ⋯'s items for chapter 3: no Move later on the last row.
  await expect(menu(page)).toHaveCount(1);
  expect(await menuItems(page)).toEqual([
    "Rename chapter…",
    "Move earlier",
    "Mark as revised",
    "Mark as final",
    "Delete chapter",
  ]);
  expect(
    await menu(page).evaluate((el) => [...el.children].map((child) => child.getAttribute("role"))),
  ).toEqual(["menuitem", "menuitem", "menuitem", "menuitem", "separator", "menuitem"]);

  // Outlined, so "Delete chapter" cannot be read as the chapter that is open.
  await expect(chapterRow(page, "Tercero")).toHaveClass(/v-menu-target/);

  // Button 2 fires auxclick, never click: the row did not open.
  expect(await calls(page, "read_chapter")).toBe(reads);
  await expect(chapterRow(page, "El largo invierno")).toHaveAttribute("aria-current", "true");

  await menu(page).getByRole("menuitem", { name: "Rename chapter…" }).click();
  const rename = page.getByRole("dialog", { name: "Rename chapter" });
  await expect(rename.getByLabel("Title")).toHaveValue("Tercero");
});

test("right-click on a novel row or its cover offers the novel's actions without opening it", async ({ page }) => {
  await recordMenus(page);
  // A novel on disk and none open, so opening it would be visible as a call.
  await page.goto("/?mock=tauri&seed=1");
  const row = novelRow(page, "Novela 1");
  await expect(row).toBeVisible();

  for (const target of [row.getByText("Novela 1"), row.locator('span[aria-hidden="true"]').first()]) {
    expect((await rightClick(page, target)).prevented).toBe(true);
    expect(await menuItems(page)).toEqual(["Rename novel…", "Project settings…", "Move to Trash"]);
    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
  }
  expect(await calls(page, "open_project")).toBe(0);
});

test("Shift+F10 and the Menu key open row and card menus from the keyboard", async ({ page }) => {
  await withProject(page);
  await addChapter(page, "Segundo");
  const row = chapterRow(page, "El largo invierno");
  const rowKey = await keyOf(page, row);

  // Chrome on macOS sends no contextmenu for Shift+F10, so this is the zone's
  // own keydown handling.
  await row.focus();
  await page.keyboard.press("Shift+F10");
  await expect(menu(page)).toHaveCount(1);
  const items = menu(page).getByRole("menuitem");
  const last = (await items.count()) - 1;
  await expect(items.first()).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(items.nth(last)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("End");
  await expect(items.nth(last)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(items.first()).toBeFocused();

  // Inside the open menu the keys neither reopen it nor move it.
  const box = await menu(page).boundingBox();
  await page.keyboard.press("Shift+F10");
  await expect(menu(page)).toHaveCount(1);
  expect(await menu(page).boundingBox()).toEqual(box);
  await expect(items.first()).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  expect(await focused(page)).toBe(rowKey);

  // The Menu key; Tab closes and moves on from the row, to its ⋯.
  await page.keyboard.press("ContextMenu");
  await expect(menu(page)).toHaveCount(1);
  await page.keyboard.press("Tab");
  await expect(menu(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Actions for chapter El largo invierno" })).toBeFocused();

  // On the ⋯ itself too.
  await page.keyboard.press("Shift+F10");
  await expect(menu(page)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Actions for chapter El largo invierno" })).toBeFocused();

  // And on a card, which has no ⋯ at all.
  await openBoard(page);
  const first = card(page, "El largo invierno");
  const firstKey = await keyOf(page, first);
  await first.focus();
  await page.keyboard.press("ContextMenu");
  await expect(menu(page)).toHaveCount(1);
  await expect(menu(page).getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  expect(await focused(page)).toBe(firstKey);

  await page.keyboard.press("Shift+F10");
  await expect(menu(page)).toHaveCount(1);
  await page.keyboard.press("Tab");
  await expect(menu(page)).toHaveCount(0);
  await expect(card(page, "Segundo")).toBeFocused();
});

test("a right-click never moves focus, and choosing hands it back to the manuscript", async ({ page }) => {
  await recordMenus(page);
  await withProject(page);
  await typeInManuscript(page, "Hola mundo");
  for (let i = 0; i < 5; i += 1) await page.keyboard.press("ArrowLeft");
  const row = chapterRow(page, "El largo invierno");

  // Without the press guard, Chrome focuses the row button here.
  const press = await rightClick(page, row);
  expect(press.focus).toBe("manuscript");
  await menu(page).getByRole("menuitem", { name: "Mark as final" }).click();
  await expect(row).toContainText("final");
  await page.keyboard.type("x");
  await expect.poll(() => manuscript(page)).toBe("Hola xmundo");

  await rightClick(page, row);
  await page.keyboard.press("Escape");
  await page.keyboard.type("y");
  await expect.poll(() => manuscript(page)).toBe("Hola xymundo");

  // A disabled control gets no mousedown, so cancelling that is not enough:
  // without the press itself cancelled, focus went to <body> and the next
  // letter was lost.
  const creative = await centre(page.getByRole("banner").getByRole("button", { name: "Continue chapter" }));
  expect((await rightClick(page, creative)).focus, "a disabled button").toBe("manuscript");
  expect(await focused(page)).toBe("manuscript");
  await page.keyboard.type("Z");
  await expect.poll(() => manuscript(page)).toBe("Hola xyZmundo");
  await page.keyboard.press("Backspace");

  // Through a dialog and back: Modal returns focus to the manuscript, and the
  // caret comes back from the editor's state.
  await rightClick(page, row);
  await menu(page).getByRole("menuitem", { name: "Rename chapter…" }).click();
  const rename = page.getByRole("dialog", { name: "Rename chapter" });
  await rename.getByLabel("Title").fill("La llegada");
  // WebKit keeps one selection per page, so typing in the dialog's field takes
  // the DOM caret out of the manuscript; Chrome gives a field its own and
  // leaves the editor's alone. Taking it out here puts Chrome where the app's
  // engine is: the caret has to come back from the editor's state.
  await rename.getByText(/The file keeps its name/).evaluate((hint) => getSelection()?.selectAllChildren(hint));
  // Where the DOM caret is the moment focus is back, read in a microtask after
  // focusin. EditorView.focus() has redrawn it from the editor's state by
  // then; a bare element.focus() leaves the engine's placement there until
  // CodeMirror's own focus handler runs, 10 ms later. Typing afterwards cannot
  // tell the two apart, because that handler wins the race today.
  await page.evaluate(() => {
    window.__caretOnFocus = -1;
    const line = document.querySelector(".cm-line")!;
    const read = () => {
      const selection = getSelection();
      if (!selection?.anchorNode || !line.contains(selection.anchorNode)) return;
      const before = document.createRange();
      before.setStart(line, 0);
      before.setEnd(selection.anchorNode, selection.anchorOffset);
      window.__caretOnFocus = before.toString().length;
    };
    document
      .querySelector(".cm-content")!
      .addEventListener("focusin", () => queueMicrotask(read), { once: true });
  });
  await rename.getByLabel("Title").press("Enter");
  await expect(rename).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => window.__caretOnFocus), { message: "the caret, redrawn as focus returns" })
    .toBe("Hola xy".length);
  await page.keyboard.type("z");
  await expect.poll(() => manuscript(page)).toBe("Hola xyzmundo");
});

test("dialogs opened from a menu give focus back when closed by their own buttons", async ({ page }) => {
  await withProject(page);
  const row = chapterRow(page, "El largo invierno");
  const key = await keyOf(page, row);

  await row.focus();
  await page.keyboard.press("Shift+F10");
  await page.keyboard.press("Enter");
  const rename = page.getByRole("dialog", { name: "Rename chapter" });
  await rename.getByLabel("Title").fill("La llegada");
  await rename.getByLabel("Title").press("Enter");
  await expect(rename).toBeHidden();
  expect(await focused(page)).toBe(key);

  await page.keyboard.press("Shift+F10");
  await page.keyboard.press("Enter");
  await rename.getByRole("button", { name: "Cancel" }).click();
  await expect(rename).toBeHidden();
  expect(await focused(page)).toBe(key);

  await page.keyboard.press("Shift+F10");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("dialog", { name: /Delete “La llegada”/ });
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(confirm).toBeHidden();
  expect(await focused(page)).toBe(key);

  const novel = novelRow(page, "El largo invierno");
  const novelKey = await keyOf(page, novel);
  await novel.focus();
  await page.keyboard.press("Shift+F10");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const settings = page.getByRole("dialog", { name: "Project" });
  await settings.getByRole("button", { name: "Done" }).click();
  await expect(settings).toBeHidden();
  expect(await focused(page)).toBe(novelKey);
});

test("Move and Delete keep keyboard focus on something real", async ({ page }) => {
  await withThreeChapters(page);
  const second = chapterRow(page, "Segundo");
  const secondKey = await keyOf(page, second);

  await second.focus();
  await page.keyboard.press("Shift+F10");
  await menu(page).getByRole("menuitem", { name: "Move later" }).press("Enter");
  await expect.poll(() => mockTitles(page)).toEqual(["El largo invierno", "Tercero", "Segundo"]);
  expect(await focused(page)).toBe(secondKey);
  // And at once again, from the same row, now third.
  await page.keyboard.press("Shift+F10");
  await menu(page).getByRole("menuitem", { name: "Move earlier" }).press("Enter");
  await expect.poll(() => mockTitles(page)).toEqual(["El largo invierno", "Segundo", "Tercero"]);
  expect(await focused(page)).toBe(secondKey);

  // The same on a card.
  await openBoard(page);
  const secondCard = card(page, "Segundo");
  await secondCard.focus();
  await page.keyboard.press("Shift+F10");
  await menu(page).getByRole("menuitem", { name: "Move later" }).press("Enter");
  await expect.poll(() => mockTitles(page)).toEqual(["El largo invierno", "Tercero", "Segundo"]);
  await expect(secondCard).toBeFocused();
  await page.keyboard.press("Shift+F10");
  await menu(page).getByRole("menuitem", { name: "Move earlier" }).press("Enter");
  await expect.poll(() => mockTitles(page)).toEqual(["El largo invierno", "Segundo", "Tercero"]);
  await expect(secondCard).toBeFocused();
  await page.getByRole("contentinfo").getByRole("button", { name: "Corkboard" }).click();

  const remove = async (row: Locator, title: string) => {
    await row.focus();
    await page.keyboard.press("Shift+F10");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    const confirm = page.getByRole("dialog", { name: new RegExp(`Delete “${title}”`) });
    await confirm.getByRole("button", { name: "Delete chapter" }).click();
    await expect(confirm).toBeHidden();
    await expect(chapterRow(page, title)).toHaveCount(0);
  };

  // The next row, then the previous one, then the way to make a chapter.
  await remove(second, "Segundo");
  await expect(chapterRow(page, "Tercero")).toBeFocused();
  await remove(chapterRow(page, "Tercero"), "Tercero");
  await expect(chapterRow(page, "El largo invierno")).toBeFocused();
  await remove(chapterRow(page, "El largo invierno"), "El largo invierno");
  await expect(page.getByRole("button", { name: "New chapter" })).toBeFocused();
});

test("Move to Trash keeps keyboard focus on the next novel, then on the home screen", async ({ page }) => {
  await page.goto("/?mock=tauri&seed=2");
  const trash = async (title: string) => {
    await novelRow(page, title).focus();
    await page.keyboard.press("Shift+F10");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    const confirm = page.getByRole("dialog", { name: new RegExp(`Move “${title}” to the Trash`) });
    await confirm.getByRole("button", { name: "Move to Trash" }).click();
    await expect(novelRow(page, title)).toHaveCount(0);
  };

  // Most recently written first: Novela 2 sits above Novela 1.
  await trash("Novela 2");
  await expect(novelRow(page, "Novela 1")).toBeFocused();
  await trash("Novela 1");
  await expect(page.getByRole("button", { name: "Create your first novel" })).toBeFocused();
});

test("closing a menu without choosing restores focus", async ({ page }) => {
  await recordMenus(page);
  await withProject(page);
  await typeInManuscript(page, "Hola");
  const row = chapterRow(page, "El largo invierno");

  await rightClick(page, row);
  await expect(menu(page)).toHaveCount(1);
  await page.evaluate(() => window.dispatchEvent(new FocusEvent("blur")));
  await expect(menu(page)).toHaveCount(0);
  expect(await focused(page)).toBe("manuscript");

  await rightClick(page, row);
  await page.getByRole("list", { name: "Chapters" }).dispatchEvent("scroll");
  await expect(menu(page)).toHaveCount(0);
  expect(await focused(page)).toBe("manuscript");

  await rightClick(page, row);
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.width - 40, height: size.height });
  await expect(menu(page)).toHaveCount(0);
  expect(await focused(page)).toBe("manuscript");

  // A scroll that does not move the menu's row leaves it open.
  await rightClick(page, row);
  await page.locator(".cm-scroller").dispatchEvent("scroll");
  await expect(menu(page)).toHaveCount(1);

  // Focus moved out by code, or by VoiceOver's cursor, with no press, blur or
  // Tab: the menu goes too, or Escape could no longer reach it. Focus stays
  // where it went, and the ⋯ stops saying it is expanded. element.focus(), as
  // app code calls it: Playwright's own focus() blurs a contenteditable's
  // predecessor first, which is a different sequence (a focusout with no
  // relatedTarget).
  const toManuscript = () => page.locator(".cm-content").evaluate((el) => (el as HTMLElement).focus());
  await toManuscript();
  await expect(menu(page)).toHaveCount(0);
  expect(await focused(page)).toBe("manuscript");
  const dots = page.getByRole("button", { name: "Actions for chapter El largo invierno" });
  await dots.click();
  await expect(dots).toHaveAttribute("aria-expanded", "true");
  await toManuscript();
  await expect(menu(page)).toHaveCount(0);
  await expect(dots).toHaveAttribute("aria-expanded", "false");
  expect(await focused(page)).toBe("manuscript");
});

test("a corkboard card's menu matches the binder's and acts on that card", async ({ page }) => {
  await recordMenus(page);
  await withThreeChapters(page);
  await openBoard(page);

  for (const title of ["El largo invierno", "Segundo", "Tercero"]) {
    await rightClick(page, chapterRow(page, title));
    const fromRow = await menuItems(page);
    await page.keyboard.press("Escape");
    await rightClick(page, card(page, title));
    expect(await menuItems(page), `the card for ${title} offers what its row does`).toEqual(fromRow);
    await page.keyboard.press("Escape");
  }
  await rightClick(page, card(page, "El largo invierno"));
  expect(await menuItems(page)).not.toContain("Move earlier");
  await page.keyboard.press("Escape");
  await rightClick(page, card(page, "Tercero"));
  expect(await menuItems(page)).not.toContain("Move later");
  await page.keyboard.press("Escape");

  const reads = await calls(page, "read_chapter");
  await rightClick(page, card(page, "El largo invierno"));
  await expect(card(page, "El largo invierno")).toHaveClass(/v-menu-target/);
  await menu(page).getByRole("menuitem", { name: "Move later" }).click();
  await expect.poll(() => mockTitles(page)).toEqual(["Segundo", "El largo invierno", "Tercero"]);
  await expect(menu(page)).toHaveCount(0);
  // Nothing under the pointer opened: still the same chapter, no new read.
  expect(await calls(page, "read_chapter")).toBe(reads);
  await expect(card(page, "El largo invierno")).toHaveAttribute("aria-current", "true");
});

test("the page menu is cancelled on every non-text surface", async ({ page }) => {
  await recordMenus(page);
  const cancelled = async (where: Locator | { x: number; y: number }, what: string) => {
    expect((await rightClick(page, where)).prevented, what).toBe(true);
    await expect(menu(page), what).toHaveCount(0);
  };

  // The New project dialog, which only the home screen opens.
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Create your first novel" }).click();
  const created = page.getByRole("dialog", { name: "New project" });
  await cancelled(created.getByRole("heading", { name: "New project" }), "a dialog heading");
  await cancelled(created.getByLabel("Manuscript language"), "a dialog's select");
  // Create stays disabled until there is a title. A disabled button gets no
  // mousedown, and without the press cancelled focus left the field for the
  // <dialog> itself.
  await created.getByLabel("Title").focus();
  await cancelled(await centre(created.getByRole("button", { name: "Create" })), "a disabled dialog button");
  await expect(created.getByLabel("Title")).toBeFocused();
  await created.getByLabel("Title").fill("El largo invierno");
  await created.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await addChapter(page, "Segundo");

  const banner = page.getByRole("banner");
  await cancelled(await topBarGap(page), "the top bar's empty middle");
  await cancelled(
    await centre(banner.getByRole("button", { name: "Continue chapter" })),
    "the disabled Creative button",
  );
  await cancelled(page.getByRole("contentinfo").getByRole("button", { name: "Save snapshot" }), "a status-bar button");
  await cancelled(page.locator("aside").getByText("Projects", { exact: true }), "the binder's Projects title");
  await cancelled(page.getByRole("button", { name: "New chapter" }), "the binder's +");
  const aside = (await page.locator("aside").boundingBox())!;
  await cancelled({ x: aside.x + aside.width / 2, y: aside.y + aside.height - 12 }, "blank binder space");

  // Both points are checked for what they hit: the scroller and the editor
  // behind them are cancelled too, so a point that drifted off its target
  // would still pass.
  const hits = (point: { x: number; y: number }, inside: string, notInside = "") =>
    page.evaluate(
      ({ x, y, inside, notInside }) => {
        const el = document.elementFromPoint(x, y);
        return !!el?.closest(inside) && !(notInside && el?.closest(notInside));
      },
      { ...point, inside, notInside },
    );
  const gutter = (await page.locator(".cm-gutters").boundingBox())!;
  const inGutter = { x: gutter.x + gutter.width / 2, y: gutter.y + 60 };
  expect(await hits(inGutter, ".cm-gutters"), "the point is on the gutter").toBe(true);
  await cancelled(inGutter, "the line-number gutter");
  // The manuscript font is the system's, so the margin's width varies by machine.
  const column = (await page.locator(".cm-content").boundingBox())!;
  const scroller = (await page.locator(".cm-scroller").boundingBox())!;
  const margin = scroller.x + scroller.width - (column.x + column.width);
  expect(margin, "the 72ch column leaves a margin at this viewport").toBeGreaterThan(8);
  const inMargin = { x: column.x + column.width + margin / 2, y: column.y + 30 };
  expect(await hits(inMargin, ".cm-scroller", ".cm-content"), "the point is beside the column").toBe(true);
  await cancelled(inMargin, "the margin beside the column");

  await page.getByRole("button", { name: "Actions for the novel El largo invierno" }).click();
  await menu(page).getByRole("menuitem", { name: "Project settings…" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "Project" });
  const coverBox = settingsDialog.getByRole("checkbox", { name: "Open exports with a title page" });
  const ticked = await coverBox.isChecked();
  const saves = await calls(page, "update_project");
  // Chrome never ticks it. WebKit does, on the auxclick that follows a
  // cancelled menu, so that is cancelled too; the box and its label are driven
  // in WebKit by tests/scratch/context-menu-webkit-probe.mjs.
  for (const [target, what] of [
    [coverBox, "a dialog's checkbox"],
    [settingsDialog.locator("label", { hasText: "Open exports with a title page" }), "the label that names it"],
  ] as const) {
    await cancelled(target, what);
    expect(await lastAuxClick(page), `the release on ${what}`).toEqual({ button: 2, prevented: true });
    expect(await coverBox.isChecked(), "a right-click does not tick it").toBe(ticked);
  }
  expect(await calls(page, "update_project")).toBe(saves);
  await settingsDialog.getByRole("button", { name: "Done" }).click();

  await openBoard(page);
  await cancelled(page.locator("main").getByText("Corkboard", { exact: true }), "the corkboard header");
  const one = (await card(page, "El largo invierno").boundingBox())!;
  const two = (await card(page, "Segundo").boundingBox())!;
  await cancelled({ x: (one.x + one.width + two.x) / 2, y: one.y + one.height / 2 }, "the gap between cards");
  await page.getByRole("contentinfo").getByRole("button", { name: "Corkboard" }).click();

  await page.getByRole("contentinfo").getByRole("button", { name: "History" }).click();
  await cancelled(page.getByRole("region", { name: "History" }).getByRole("button", { name: "Changes" }), "a History tab");
  await page.getByRole("region", { name: "History" }).getByRole("button", { name: "✕" }).click();

  await page.getByRole("banner").getByRole("button", { name: "Rewrite" }).click();
  const toast = page.getByRole("alert").filter({ hasText: "Select a passage first." });
  await expect(toast).toBeVisible();
  await cancelled(toast, "the error toast");

  await page.getByRole("button", { name: "Settings" }).click();
  await cancelled(
    page.getByRole("region", { name: "Settings" }).getByRole("button", { name: "Editor", exact: true }),
    "a Settings rail button",
  );
});

test("text keeps the platform's menu", async ({ page }) => {
  await recordMenus(page);
  const native = async (where: Locator | { x: number; y: number }, what: string) => {
    expect((await rightClick(page, where)).prevented, what).toBe(false);
  };

  await withProject(page);
  await typeInManuscript(page, "Primera línea.");
  await native(page.locator(".cm-line").first(), "the manuscript");

  await page.getByRole("button", { name: "New chapter" }).click();
  const dialog = page.getByRole("dialog", { name: "New chapter" });
  await native(dialog.getByLabel("Chapter title"), "a dialog's text field");
  // A disabled field has no spelling or Paste to offer, only the page menu.
  await dialog.getByLabel("Chapter title").evaluate((el) => ((el as HTMLInputElement).disabled = true));
  expect((await rightClick(page, await centre(dialog.getByLabel("Chapter title")))).prevented).toBe(true);
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("contentinfo").getByRole("button", { name: "History" }).click();
  await native(page.getByPlaceholder("What changed"), "the History commit message");
  await page.getByRole("region", { name: "History" }).getByRole("button", { name: "✕" }).click();

  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByRole("button", { name: "Author" }).click();
  await native(settings.getByLabel("Name"), "a Settings TextField");
  await settings.getByRole("button", { name: "Application" }).click();
  // Pasting a token is the reason this menu matters most.
  await native(settings.getByPlaceholder("GitHub token"), "a token password field");
  await settings.getByRole("button", { name: "← Back to the manuscript" }).click();

  // The editor is locked while a chapter switch is in flight.
  await addChapter(page, "Segundo");
  await holdReads(page);
  await chapterRow(page, "El largo invierno").click();
  await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "false");
  await page.evaluate(() => getSelection()?.removeAllRanges());
  const locked = await rightClick(page, await centre(page.locator(".cm-content")));
  expect(locked.prevented, "the locked editor").toBe(true);
  await page.evaluate(() => window.__releaseReads());
});

test("a selection gets the native menu only on itself, never over a control", async ({ page }) => {
  await recordMenus(page);
  await page.goto("/?mock=tauri");
  const body = page.getByText("Create a project to start writing.");
  await body.click({ clickCount: 3 });
  const selected = await page.evaluate(() => getSelection()?.toString() ?? "");
  expect(selected).toContain("Create a project to start writing.");
  // On the selected glyphs themselves: the gap between two lines is not.
  const onText = await page.evaluate(() => {
    const rect = getSelection()!.getRangeAt(0).getClientRects()[0];
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  expect((await rightClick(page, onText)).prevented).toBe(false);

  // Elsewhere, cancelled, and the press changes nothing it lands on.
  const before = await focused(page);
  expect((await rightClick(page, page.getByRole("heading", { name: "A quiet desk, a sharp needle." }))).prevented).toBe(true);
  expect(await page.evaluate(() => getSelection()?.toString() ?? "")).toBe(selected);
  expect(await focused(page)).toBe(before);

  await page.getByRole("button", { name: "Create your first novel" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Title").fill("El largo invierno");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();

  // A selection dragged across the status bar does not unlock its buttons.
  const bar = page.getByRole("contentinfo");
  const from = (await bar.getByText(/ch-01 · /).boundingBox())!;
  const to = (await bar.getByRole("button", { name: "History" }).boundingBox())!;
  await page.mouse.move(from.x + 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width - 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  expect(await page.evaluate(() => getSelection()?.toString() ?? "")).toContain("Save snapshot");
  expect((await rightClick(page, bar.getByRole("button", { name: "Save snapshot" }))).prevented).toBe(true);

  // Inside a dialog too: part of a rewrite is something a writer copies.
  await typeInManuscript(page, "Una noche sin luna.");
  await page.keyboard.press("Shift+Home");
  await page.getByRole("banner").getByRole("button", { name: "Rewrite" }).click();
  const rewrite = page.getByRole("dialog", { name: "Rewrite" });
  await rewrite.getByLabel("Agent").selectOption({ label: "Claude Code" });
  await rewrite.getByRole("button", { name: "Rewrite", exact: true }).click();
  const proposed = rewrite.getByRole("region", { name: "Preview" }).getByText(/rewritten by claude/);
  await proposed.click({ clickCount: 3 });
  const line = await page.evaluate(() => getSelection()?.toString() ?? "");
  expect(line).toContain("rewritten by claude");
  // The glyphs of the line, not the − / + marker before them.
  const onLine = await proposed.evaluate((el) => {
    const text = [...el.childNodes].find((node) => node.textContent?.includes("rewritten"))!;
    const range = document.createRange();
    range.selectNodeContents(text);
    const rect = range.getClientRects()[0];
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  expect((await rightClick(page, onLine)).prevented, "a selected preview line").toBe(false);
  expect((await rightClick(page, rewrite.getByText(/snapshots Git before applying/))).prevented).toBe(true);
  expect(await page.evaluate(() => getSelection()?.toString() ?? "")).toBe(line);
  await rewrite.getByRole("button", { name: "Discard" }).click();
  await expect(rewrite).toBeHidden();

  // Nor does a selection under an open item menu.
  await page.getByRole("button", { name: "Actions for chapter El largo invierno" }).click();
  await page.evaluate(() => getSelection()?.selectAllChildren(document.body));
  const item = menu(page).getByRole("menuitem").first();
  expect((await rightClick(page, item)).prevented).toBe(true);
  await expect(menu(page)).toHaveCount(1);
});

test("a right-click or Ctrl-click on a dialog's backdrop does not dismiss it", async ({ page }) => {
  await recordMenus(page);
  await onPlatform(page, "mac");
  await withProject(page);
  await page.getByRole("button", { name: "New chapter" }).click();
  const dialog = page.getByRole("dialog", { name: "New chapter" });
  await expect(dialog).toBeVisible();

  await rightClick(page, { x: 6, y: 6 });
  await expect(dialog).toBeVisible();
  // On a Mac, Ctrl+click is a right-click.
  await page.keyboard.down("Control");
  await page.mouse.click(6, 6);
  await page.keyboard.up("Control");
  await expect(dialog).toBeVisible();
  // A plain click outside still closes it.
  await page.mouse.click(6, 6);
  await expect(dialog).toBeHidden();

  // The tour persists onboarded:true when it is dismissed.
  await page.goto("/?mock=tauri&fresh=1");
  const tour = page.getByRole("dialog", { name: "Welcome to Versorium" });
  await expect(tour).toBeVisible();
  await rightClick(page, { x: 6, y: 6 });
  await expect(tour).toBeVisible();
  expect(await page.evaluate(() => window.__VERSORIUM_MOCK__.settings.onboarded)).toBe(false);
});

test("Escape closes an open menu without leaving Focus mode", async ({ page }) => {
  await withProject(page);
  await page.getByRole("contentinfo").getByRole("button", { name: "Focus" }).click();
  await expect(page.locator(".v-focus")).toHaveCount(1);

  // focus-within brings the faded binder back.
  const row = chapterRow(page, "El largo invierno");
  const key = await keyOf(page, row);
  await row.focus();
  await page.keyboard.press("Shift+F10");
  await expect(menu(page)).toHaveCount(1);
  await page.keyboard.press("Escape");

  await expect(menu(page)).toHaveCount(0);
  await expect(page.locator(".v-focus")).toHaveCount(1);
  expect(await focused(page)).toBe(key);
});

test("only one item menu is open at a time", async ({ page }) => {
  await withProject(page);
  await addChapter(page, "Segundo");

  const dots = page.getByRole("button", { name: "Actions for chapter El largo invierno" });
  await dots.click();
  await expect(menu(page)).toHaveCount(1);
  // No pointerdown in between to close the first one; focus leaving it does.
  await chapterRow(page, "Segundo").focus();
  await expect(dots).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Shift+F10");
  await expect(menu(page)).toHaveCount(1);
  await expect(menu(page)).toHaveAccessibleName("Actions for chapter Segundo");

  // Where nothing else closes the first menu, the app-wide guard does: focus
  // already dropped out of it to <body> (no relatedTarget, so it stays open),
  // then a contextmenu that no pointerdown preceded asks for another.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(menu(page)).toHaveCount(1);
  await chapterRow(page, "El largo invierno").evaluate((el) => {
    const box = el.getBoundingClientRect();
    el.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: box.x + 4, clientY: box.y + 4 }),
    );
  });
  await expect(menu(page)).toHaveCount(1);
  await expect(menu(page)).toHaveAccessibleName("Actions for chapter El largo invierno");
});

test("a right-click inside an open menu does nothing", async ({ page }) => {
  await recordMenus(page);
  await withProject(page);
  await rightClick(page, chapterRow(page, "El largo invierno"));
  const item = menu(page).getByRole("menuitem").first();
  await expect(item).toBeFocused();
  const box = await menu(page).boundingBox();
  const ipc = await page.evaluate(() => window.__VERSORIUM_MOCK__.calls.length);

  expect((await rightClick(page, item)).prevented).toBe(true);

  await expect(menu(page)).toHaveCount(1);
  expect(await menu(page).boundingBox()).toEqual(box);
  expect(await page.evaluate(() => window.__VERSORIUM_MOCK__.calls.length)).toBe(ipc);
  await expect(item).toBeFocused();
});

test("no menu over rows or cards while a chapter is loading", async ({ page }) => {
  await recordMenus(page);
  await withProject(page);
  await addChapter(page, "Segundo");
  await openBoard(page);

  await holdReads(page);
  await card(page, "El largo invierno").click();
  await expect(chapterRow(page, "Segundo")).toBeDisabled();
  await expect(card(page, "Segundo")).toBeDisabled();

  for (const [what, target] of [
    ["a disabled row", chapterRow(page, "Segundo")],
    ["a disabled card", card(page, "Segundo")],
  ] as const) {
    const result = await rightClick(page, await centre(target));
    expect(result.prevented, what).toBe(true);
    await expect(menu(page), what).toHaveCount(0);
  }
  await page.evaluate(() => window.__releaseReads());
  await expect(card(page, "Segundo")).toBeEnabled();
});

test("the menus are translated, and both surfaces use one wording", async ({ page }) => {
  await recordMenus(page);
  await withThreeChapters(page);

  // The middle chapter, which offers both moves.
  await rightClick(page, chapterRow(page, "Segundo"));
  expect(await menuItems(page)).toEqual([
    "Rename chapter…",
    "Move earlier",
    "Move later",
    "Mark as revised",
    "Mark as final",
    "Delete chapter",
  ]);
  await page.keyboard.press("Escape");

  await page.getByRole("contentinfo").getByRole("button", { name: "ES", exact: true }).click();

  await rightClick(page, chapterRow(page, "Segundo", "Capítulos"));
  const fromRow = await menuItems(page);
  expect(fromRow).toEqual([
    "Renombrar capítulo…",
    "Mover antes",
    "Mover después",
    "Marcar como revisado",
    "Marcar como final",
    "Borrar capítulo",
  ]);
  await page.keyboard.press("Escape");

  await rightClick(page, novelRow(page, "El largo invierno", "Proyectos"));
  expect(await menuItems(page)).toContain("Mover a la papelera");
  await page.keyboard.press("Escape");

  await page.getByRole("contentinfo").getByRole("button", { name: "Fichas" }).click();
  await rightClick(page, card(page, "Segundo", "Fichas"));
  expect(await menuItems(page)).toEqual(fromRow);

  // The old labels are gone from the catalogs themselves, not only from these
  // menus, so no other screen can bring them back in either language.
  // Exact values, so a future "Subir archivo" is not caught by mistake.
  const strings = (value: unknown): string[] =>
    typeof value === "string"
      ? [value]
      : value !== null && typeof value === "object"
        ? Object.values(value).flatMap(strings)
        : [];
  for (const lang of ["en", "es"]) {
    const catalog = JSON.parse(readFileSync(new URL(`../../locales/${lang}/ui.json`, import.meta.url), "utf8"));
    expect(catalog.binder.menu, `${lang}: binder.menu`).not.toHaveProperty("moveUp");
    expect(catalog.binder.menu, `${lang}: binder.menu`).not.toHaveProperty("moveDown");
    for (const gone of ["Subir", "Bajar", "Move up", "Move down"]) {
      expect(strings(catalog), `${lang} catalog`).not.toContain(gone);
    }
  }
});

test("dev builds keep Inspect Element behind Shift+right-click", async ({ page }) => {
  await recordMenus(page);
  await withProject(page);
  const chrome = await topBarGap(page);

  expect((await rightClick(page, chrome, ["Shift"])).prevented).toBe(false);
  expect((await rightClick(page, chapterRow(page, "El largo invierno"), ["Shift"])).prevented).toBe(false);
  await expect(menu(page)).toHaveCount(0);

  expect((await rightClick(page, chrome)).prevented).toBe(true);
});

test("Windows reload and print keys are cancelled, editing keys are not", async ({ page }) => {
  await onPlatform(page, "windows");
  await withProject(page);
  // Capture phase, registered after the guard's, so this reads exactly what the
  // guard decided and nothing later (CodeMirror cancels keys it handles).
  await page.evaluate(() => {
    window.__keys = [];
    window.addEventListener(
      "keydown",
      (event) => window.__keys.push({ key: event.key, prevented: event.defaultPrevented }),
      true,
    );
  });
  const pressed = async (combo: string) => {
    await page.keyboard.press(combo);
    return page.evaluate(() => window.__keys.filter((k) => !["Shift", "Control", "Alt"].includes(k.key)).at(-1));
  };

  await page.locator(".cm-content").click();
  expect((await pressed("F5"))?.prevented, "F5").toBe(true);
  expect((await pressed("Control+r"))?.prevented, "Ctrl+R").toBe(true);
  expect((await pressed("Control+p"))?.prevented, "Ctrl+P").toBe(true);
  await expect(page.locator(".cm-content")).toBeVisible();

  // Rewrite keeps its key: with nothing selected it says so. The guard still
  // cancels it for the webview, Shift held or not, even in this dev build:
  // only the refresh keys get the dev escape hatch.
  expect((await pressed("Control+Shift+R"))?.prevented, "Ctrl+Shift+R in DEV").toBe(true);
  await expect(page.getByRole("alert").filter({ hasText: "Select a passage first." })).toBeVisible();
  await page.getByRole("alert").getByRole("button", { name: "✕" }).click();

  // CodeMirror's cursorSyntaxLeft, which a guard on Alt+Arrow would kill.
  await typeInManuscript(page, "Hola mundo");
  expect((await pressed("Alt+ArrowLeft"))?.prevented, "Alt+ArrowLeft").toBe(false);
  await page.keyboard.type("x");
  await expect.poll(() => manuscript(page)).not.toBe("Hola mundox");
  expect(await manuscript(page)).toContain("x");

  // The dev escape hatch reloads the dev window on purpose.
  expect((await pressed("Shift+F5"))?.prevented, "Shift+F5 in DEV").toBe(false);
});

test("on a Mac, Ctrl+P stays CodeMirror's line-up", async ({ page }) => {
  await onPlatform(page, "mac");
  await withProject(page);
  await page.evaluate(() => {
    window.__keys = [];
    window.addEventListener(
      "keydown",
      (event) => window.__keys.push({ key: event.key, prevented: event.defaultPrevented }),
      true,
    );
  });
  await typeInManuscript(page, "uno");
  await page.keyboard.press("Enter");
  await page.keyboard.type("dos");
  await page.keyboard.press("Control+p");
  const key = await page.evaluate(() => window.__keys.filter((k) => k.key === "p").at(-1));
  expect(key?.prevented).toBe(false);
  await page.keyboard.type("x");
  await expect.poll(() => manuscript(page)).toBe("unox\ndos");
});
