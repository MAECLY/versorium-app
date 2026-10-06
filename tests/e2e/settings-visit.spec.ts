import { expect, test, type Page } from "@playwright/test";

// A visit to Settings costs the editor nothing (App.svelte; styles.css,
// "Settings over the page"). Settings covers the panel and the page instead of
// replacing them, and the CodeMirror view under it stays mounted, inert and
// unseen. These read what the writer finds on the way back (the undo history,
// Restore, the caret, the selection, the scroll, the room a notice stack
// needs), check that nothing under Settings answers the keyboard or moves
// while it is covered, and that what is pressed over it either keeps the
// keyboard in Settings or, for Rewrite and Restore, closes it first.
//
// Runs against the mocked IPC (tests/e2e/mock-tauri.ts).

/** Sixty paragraphs: a chapter that scrolls well past any window. */
const LONG = Array.from(
  { length: 60 },
  (_, i) =>
    `Párrafo ${i + 1}. El invierno fue largo, y la niña esperaba junto a la ventana mientras la nieve borraba el camino del pueblo.`,
).join("\n\n");

/** Pins `navigator.platform` before the app loads, as chrome.spec.ts does, so the chords are the Mac's here and on CI. */
async function onPlatform(page: Page, platform: "MacIntel" | "Linux x86_64"): Promise<void> {
  await page.addInitScript((value) => {
    Object.defineProperty(Navigator.prototype, "platform", { get: () => value });
  }, platform);
}

/** A novel on disk, opened on its first chapter, which holds `body` when one is given. */
async function openSeeded(page: Page, body?: string): Promise<void> {
  await page.goto("/?mock=tauri&seed=1");
  const resume = page.getByRole("button", { name: /^Continue/ });
  await resume.waitFor();
  if (body !== undefined) {
    await page.evaluate((text) => {
      [...window.__VERSORIUM_MOCK__.projects.values()][0].chapters[0].body = text;
    }, body);
  }
  await resume.click();
  await expect(page.locator(".cm-content")).toBeVisible();
}

const content = (page: Page) => page.locator(".cm-content");
const settings = (page: Page) => page.getByRole("region", { name: "Settings" });
const notices = (page: Page) => page.getByRole("region", { name: "Notifications" });
const statusBar = (page: Page) => page.getByRole("contentinfo");

async function openSettings(page: Page): Promise<void> {
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  await expect(settings(page)).toBeVisible();
}

async function backToManuscript(page: Page): Promise<void> {
  await settings(page).getByRole("button", { name: "← Back to writing" }).click();
  await expect(settings(page)).toHaveCount(0);
  await expect(content(page)).toBeVisible();
}

/**
 * What the editor holds and where it is scrolled. `cmTile` is how CodeMirror
 * (6.43) gets from its DOM to its view, which is all `EditorView.findFromDOM`
 * does; the page exposes nothing of its own for tests.
 */
function editor(page: Page) {
  return page.evaluate(() => {
    type View = {
      state: { doc: { toString(): string }; selection: { main: { anchor: number; head: number } } };
      scrollDOM: HTMLElement;
    };
    const host = document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: View } } };
    const view = host.cmTile.root.view;
    const { anchor, head } = view.state.selection.main;
    return { doc: view.state.doc.toString(), anchor, head, scrollTop: view.scrollDOM.scrollTop };
  });
}

function caretInManuscript(page: Page): Promise<boolean> {
  return page.evaluate(() => !!document.activeElement?.closest(".cm-content"));
}

function focusUnderSettings(page: Page): Promise<boolean> {
  return page.evaluate(() => !!document.activeElement?.closest(".v-under"));
}

/** Every call to `command` from here on fails with `code`, as a Rust rejection does. */
function failing(page: Page, command: string, code: string): Promise<unknown> {
  return page.evaluate(([c, k]) => (window.__VERSORIUM_MOCK__.failures[c] = k), [command, code]);
}

/** Settings → Author, a name typed and the field left, which is when it is written. */
async function saveAuthorName(page: Page, name: string): Promise<void> {
  await settings(page).getByRole("button", { name: "Author", exact: true }).click();
  const field = settings(page).getByRole("region", { name: "Author" }).getByLabel("Name");
  await field.fill(name);
  await field.blur();
}

/**
 * The caret's own line (not its whole paragraph) and the notice stack, in
 * viewport pixels, read whether or not Settings covers the page: hidden, it
 * keeps its layout.
 */
function caretAndStack(page: Page) {
  return page.evaluate(() => {
    type View = {
      state: { selection: { main: { head: number } } };
      coordsAtPos(pos: number): { top: number; bottom: number } | null;
      scrollDOM: HTMLElement;
      contentDOM: HTMLElement;
    };
    const host = document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: View } } };
    const view = host.cmTile.root.view;
    const caret = view.coordsAtPos(view.state.selection.main.head)!;
    const stack = document.querySelector(".v-notes-list")!.getBoundingClientRect();
    const scroller = view.scrollDOM.getBoundingClientRect();
    const text = view.contentDOM.getBoundingClientRect();
    return {
      caretTop: caret.top,
      caretBottom: caret.bottom,
      stackTop: stack.top,
      overText: stack.left < text.right && stack.right > text.left,
      scrollerTop: scroller.top,
      scrollerBottom: scroller.bottom,
    };
  });
}

test("undo and Restore reach what was typed before a visit to Settings", async ({ page }) => {
  await openSeeded(page);
  await content(page).click();
  await page.keyboard.type("Lo último.");
  await openSettings(page);
  await expect(content(page), "covered, not shown beside Settings").toBeHidden();
  await backToManuscript(page);

  // Back where the writer was: the caret is in the text without a click...
  await expect.poll(() => caretInManuscript(page)).toBe(true);
  // ...and the undo history is the one the words were typed into.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await editor(page)).doc).toBe("");

  // Restore works from the same session: a word, a visit, and the word goes.
  await page.keyboard.insertText("Palabra");
  await openSettings(page);
  await backToManuscript(page);
  await page.keyboard.press("Control+Alt+r");
  await expect.poll(async () => (await editor(page)).doc).toBe("");
  await expect(notices(page), "not \"Nothing to roll back here.\"").toHaveCount(0);
});

for (const typewriter of [false, true]) {
  test(`the caret, the selection and the scroll come back as they were${typewriter ? ", with Typewriter on" : ""}`, async ({
    page,
  }) => {
    await openSeeded(page, LONG);
    const scroller = page.locator(".cm-scroller");
    await scroller.evaluate((el) => (el.scrollTop = 1800));
    // CodeMirror draws the lines it scrolled to on the next frame.
    await page.waitForTimeout(100);
    const box = (await scroller.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 12; i += 1) await page.keyboard.press("Shift+ArrowRight");
    const selected = await page.evaluate(() => getSelection()?.toString());
    if (typewriter) {
      // On after the selection: it centres the caret's line at once, which a
      // scroll made after it would only undo.
      const button = statusBar(page).getByRole("button", { name: "Typewriter" });
      await button.click();
      await expect(button).toHaveAttribute("aria-pressed", "true");
      await page.waitForTimeout(300);
    }
    const before = await editor(page);
    expect(before.scrollTop, "control: well down the chapter").toBeGreaterThan(1000);
    expect(before.head - before.anchor, "control: a selection, not a caret").toBe(12);
    expect(selected, "control: the selection is drawn").toHaveLength(12);

    await openSettings(page);
    expect((await editor(page)).scrollTop, "nothing moved the page while it was covered").toBe(before.scrollTop);
    await backToManuscript(page);

    const after = await editor(page);
    expect(after.anchor).toBe(before.anchor);
    expect(after.head).toBe(before.head);
    expect(Math.abs(after.scrollTop - before.scrollTop)).toBeLessThanOrEqual(1);
    // What the writer sees selected is the same words, in focus.
    expect(await caretInManuscript(page)).toBe(true);
    expect(await page.evaluate(() => getSelection()?.toString())).toBe(selected);
  });
}

test("under Settings, nothing on the page answers the keyboard", async ({ page }) => {
  await openSeeded(page, LONG);
  await content(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" Una palabra");
  for (let i = 0; i < 7; i += 1) await page.keyboard.press("Shift+ArrowLeft");
  const before = await editor(page);
  expect(before.anchor - before.head, "control: \"palabra\" is selected").toBe(7);
  expect(before.scrollTop, "control: scrolled to the end, with room to scroll back").toBeGreaterThan(1000);
  await openSettings(page);

  // Tab goes round Settings and the bars, and never into the page.
  const stops: { under: boolean; settings: boolean }[] = [];
  for (let i = 0; i < 60; i += 1) {
    await page.keyboard.press("Tab");
    stops.push(
      await page.evaluate(() => ({
        under: !!document.activeElement?.closest(".v-under"),
        settings: !!document.activeElement?.closest(".v-settings-layer"),
      })),
    );
  }
  expect(stops.filter((stop) => stop.under), "Tab stops under Settings").toEqual([]);
  expect(stops.some((stop) => stop.settings), "control: Tab went through Settings").toBe(true);
  // Nothing under it is offered to assistive technology either.
  await expect(page.locator(".v-under").getByRole("textbox")).toHaveCount(0);
  await expect(page.locator(".v-under").getByRole("button")).toHaveCount(0);
  // And inert, read the way chrome.spec.ts reads the folded bars. Hidden and
  // read-only, the page already keeps out every key below, in Chrome and in
  // WebKit, so no key can show what inert adds: it is what holds if the
  // stylesheet's rule ever stops applying.
  expect(await page.locator(".v-under").evaluate((el) => (el as HTMLElement).inert)).toBe(true);

  // Focus nowhere, where WebKit leaves it after a press on a button: typing,
  // undo and the scrolling keys still reach nothing on the page.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.type("xyz");
  await page.keyboard.press("ControlOrMeta+z");
  for (const key of ["PageUp", "ArrowUp", "Home"]) await page.keyboard.press(key);
  expect(await editor(page)).toEqual(before);
  await expect(notices(page)).toHaveCount(0);

  await backToManuscript(page);
  expect(await editor(page)).toEqual(before);
});

test("the undo key in Settings takes back what was typed there, and never the page under it", async ({ page }) => {
  await openSeeded(page);
  await content(page).click();
  await page.keyboard.type("Lo último.");
  await openSettings(page);
  await settings(page).getByRole("button", { name: "Author", exact: true }).click();
  const name = settings(page).getByRole("region", { name: "Author" }).getByLabel("Name");
  await name.click();
  await page.keyboard.type("Ana");
  // The browser keeps one undo stack for the whole document: the first press
  // takes back the field's typing, and the next would reach the page's.
  for (let i = 0; i < 3; i += 1) await page.keyboard.press("ControlOrMeta+z");
  await expect(name).toHaveValue("");
  expect((await editor(page)).doc).toBe("Lo último.");

  await backToManuscript(page);
  expect((await editor(page)).doc).toBe("Lo último.");
  // The words are still in the history they were typed into.
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => (await editor(page)).doc).toBe("");
});

test("Settings opened with the caret still on the page takes the keyboard into Settings", async ({ page }) => {
  await openSeeded(page);
  await content(page).click();
  await page.keyboard.type("Hola.");
  // A press that moves no focus, as a click on a button does in WebKit, the
  // macOS app's engine: the caret is still in the text when Settings opens.
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).dispatchEvent("click");
  await expect(settings(page)).toBeVisible();
  await expect(settings(page).getByRole("button", { name: "Editor", exact: true })).toBeFocused();
  expect(await focusUnderSettings(page)).toBe(false);
  await page.keyboard.type("xyz");
  expect((await editor(page)).doc).toBe("Hola.");
});

test("Settings opened with focus on a chapter row takes the keyboard into Settings", async ({ page }) => {
  // The twin of the test above, for the branch Chrome reaches too. There,
  // the caret leaves for <body> the moment the editor locks, so App finds
  // focus lost; a row keeps focus after it goes inert, as anything under
  // Settings does in WebKit, so App finds it still on the page.
  await openSeeded(page);
  const row = page.locator('[data-item-key^="chapter:"]').first();
  await row.focus();
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).dispatchEvent("click");
  await expect(settings(page)).toBeVisible();
  await expect(settings(page).getByRole("button", { name: "Editor", exact: true })).toBeFocused();
  expect(await focusUnderSettings(page)).toBe(false);
});

test("Rewrite and Restore pressed over Settings close it, and act on the page it uncovers", async ({ page }) => {
  await openSeeded(page);
  await content(page).click();
  await page.keyboard.type("Hola mundo");
  for (let i = 0; i < 5; i += 1) await page.keyboard.press("Shift+ArrowLeft");

  // The key, with a selection made before the visit: the page comes back
  // with it, and Rewrite opens on it.
  await openSettings(page);
  await page.keyboard.press("Control+Shift+R");
  await expect(settings(page)).toHaveCount(0);
  const rewrite = page.getByRole("dialog", { name: "Rewrite" });
  await expect(rewrite).toBeVisible();
  const held = await editor(page);
  expect(held.doc.slice(Math.min(held.anchor, held.head), Math.max(held.anchor, held.head))).toBe("mundo");
  await page.keyboard.press("Escape");
  await expect(rewrite).toHaveCount(0);

  // The top bar's button, nothing selected: the page, and the hint that says
  // what to do on it. Under Settings, the press used to do nothing at all.
  await content(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await openSettings(page);
  await page.getByRole("banner").getByRole("button", { name: "Rewrite" }).click();
  await expect(settings(page)).toHaveCount(0);
  await expect(notices(page).getByRole("listitem").filter({ hasText: "Select a passage first." })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Rewrite" })).toHaveCount(0);

  // Restore from the status bar: the word typed this session goes, on the
  // page the writer is back on, with the caret in it. One insertion, as in
  // the first test: Restore takes back the latest change inside the word.
  await expect.poll(() => caretInManuscript(page)).toBe(true);
  await page.keyboard.type(" ");
  await page.keyboard.insertText("Palabra");
  await openSettings(page);
  await statusBar(page).getByRole("button", { name: "↩ Restore" }).click();
  await expect(settings(page)).toHaveCount(0);
  await expect.poll(async () => (await editor(page)).doc).toBe("Hola mundo ");
  await expect(notices(page).getByRole("listitem").filter({ hasText: "Nothing to roll back here." })).toHaveCount(0);
  await expect.poll(() => caretInManuscript(page)).toBe(true);
});

test("Settings covers the panel and the page, and the press lands in Settings", async ({ page }) => {
  await openSeeded(page);
  const middle = await page.locator(".v-middle").boundingBox();
  await openSettings(page);
  const covered = (await settings(page).boundingBox())!;
  for (const side of ["x", "y", "width", "height"] as const) {
    expect(Math.abs(covered[side] - middle![side]), side).toBeLessThanOrEqual(1);
  }
  // Where the text column was, a press reaches Settings and nothing under it.
  const column = { x: covered.x + covered.width / 2, y: covered.y + covered.height / 2 };
  expect(
    await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest(".v-settings-layer"), column),
  ).toBe(true);
});

test("a notice raised in Settings leaves the covered page alone, and is lifted off the caret on the way back", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await openSeeded(page, LONG);
  const scroller = page.locator(".cm-scroller");
  await scroller.evaluate((el) => (el.scrollTop = 1200));
  await page.waitForTimeout(100);
  // The caret on a line at the foot of the page, where the stack lands.
  const box = (await scroller.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 30);
  await page.waitForTimeout(200);
  const before = await editor(page);

  // An error, which stays until it is closed: still showing when the writer
  // comes back.
  await openSettings(page);
  await failing(page, "set_settings", "io");
  await saveAuthorName(page, "Ana Ruiz");
  await expect(notices(page).getByRole("listitem").filter({ hasText: "File system error." })).toBeVisible();
  const covered = await caretAndStack(page);
  expect(covered.caretBottom, "control: the stack is over the caret's line").toBeGreaterThan(covered.stackTop);
  expect(covered.overText, "control: over the text column, not beside it").toBe(true);
  // The editor would have lifted that line by now (MarkdownEditor's notices effect).
  await page.waitForTimeout(300);
  expect((await editor(page)).scrollTop, "the covered page stayed where the writer left it").toBe(before.scrollTop);

  // Back on the page, the stack lands on it as one raised there does: the
  // caret's line goes just above it, and the page moves by no more than that.
  await backToManuscript(page);
  await expect.poll(async () => (await caretAndStack(page)).caretBottom).toBeLessThanOrEqual(covered.stackTop);
  const lifted = (await editor(page)).scrollTop - before.scrollTop;
  expect(lifted).toBeGreaterThan(0);
  expect(lifted).toBeLessThanOrEqual(covered.caretBottom - covered.stackTop + 16);
  const back = await caretAndStack(page);
  expect(back.caretTop, "the caret is on screen").toBeGreaterThanOrEqual(back.scrollerTop);
});

test("a tall stack raised in Settings gets its room below the last line on the way back", async ({ page }) => {
  // Four errors from one visit, the minute's snapshot among them: taller than
  // the page's 120px foot, so the end of the chapter needs the room the editor
  // gives a stack (--v-notes-room) for its last line to be typed above it.
  await page.clock.install();
  await page.setViewportSize({ width: 900, height: 600 });
  await openSeeded(page, LONG);
  await content(page).click();
  await page.keyboard.press("ControlOrMeta+End");
  await openSettings(page);

  await failing(page, "set_settings", "io");
  await saveAuthorName(page, "Ana Ruiz");
  await failing(page, "set_settings", "bad_args");
  await settings(page).getByRole("navigation").getByRole("button", { name: "Models", exact: true }).click();
  await settings(page).getByRole("checkbox", { name: "Show uncensored models", exact: true }).click();
  await failing(page, "git_commit", "no_repo");
  await statusBar(page).getByRole("button", { name: "Save snapshot" }).click();
  await failing(page, "git_auto_checkpoint", "nothing_to_commit");
  await page.clock.fastForward(60_000);
  await expect(notices(page).getByRole("listitem")).toHaveCount(4);
  const covered = await caretAndStack(page);
  expect(covered.scrollerBottom - covered.stackTop, "control: the stack is taller than the page's foot").toBeGreaterThan(150);

  await backToManuscript(page);
  await expect.poll(() => caretInManuscript(page)).toBe(true);
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" fin");
  await expect.poll(async () => (await editor(page)).doc.endsWith(" fin")).toBe(true);
  await expect.poll(async () => (await caretAndStack(page)).caretBottom).toBeLessThanOrEqual(covered.stackTop);
});

test("quitting from Settings keeps the last words typed before it opened", async ({ page }) => {
  await page.clock.install();
  await openSeeded(page);
  await content(page).click();
  await page.keyboard.type("Lo último.");
  // At once: the change log's batch (500 ms) has not gone, and with the clock
  // held it will not go by itself.
  await openSettings(page);
  const calls = () =>
    page.evaluate(() =>
      window.__VERSORIUM_MOCK__.calls
        .filter((call) => call.cmd === "ops_append" || call.cmd === "quit_ready")
        .map((call) => (call.cmd === "quit_ready" ? `quit_ready ${call.args.saved}` : "ops_append")),
    );
  expect(await calls(), "control: nothing written yet").toEqual([]);

  await page.evaluate(() => window.__VERSORIUM_MOCK__.emit("versorium://quit-requested", null));
  await expect.poll(calls).toEqual(["ops_append", "quit_ready true"]);
  const logged = await page.evaluate(() =>
    window.__VERSORIUM_MOCK__.calls
      .filter((call) => call.cmd === "ops_append")
      .flatMap((call) => (call.args.args as { ops: { kind: string; text: string }[] }).ops)
      .filter((op) => op.kind === "insert")
      .map((op) => op.text)
      .join(""),
  );
  expect(logged).toBe("Lo último.");
});

test("the Focus keys from Settings close it, and the caret comes back with its history", async ({ page }) => {
  await onPlatform(page, "MacIntel");
  await openSeeded(page);
  await content(page).click();
  await page.keyboard.type("Lo último.");
  await openSettings(page);
  await page.keyboard.press("Meta+Shift+KeyF");
  await expect(settings(page)).toHaveCount(0);
  await expect(statusBar(page).getByRole("button", { name: "Focus", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => caretInManuscript(page)).toBe(true);
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => (await editor(page)).doc).toBe("");
});

test("with no chapter to go back to, closing Settings puts focus on the button that opened it", async ({ page }) => {
  await page.goto("/?mock=tauri");
  await openSettings(page);
  await settings(page).getByRole("button", { name: "← Back to writing" }).click();
  await expect(settings(page)).toHaveCount(0);
  await expect(page.getByRole("banner").getByRole("button", { name: "Settings" })).toBeFocused();
});

test("with no chapter to go back to and the top bar folded, closing Settings puts focus on the bar's lip", async ({
  page,
}) => {
  await onPlatform(page, "MacIntel");
  await page.goto("/?mock=tauri");
  await openSettings(page);
  // Folded from Settings with its chord: the button that opened Settings
  // folds away with the bar, inert, and cannot take focus back.
  await page.keyboard.press("Alt+Meta+KeyT");
  const lip = page.getByRole("button", { name: "Show top bar" });
  await expect(lip).toBeVisible();
  await expect(page.getByRole("banner").getByRole("button", { name: "Settings" })).toHaveCount(0);
  // From the keyboard, which moves focus onto Back in either engine; Back
  // goes with Settings, so focus would otherwise fall to <body>.
  await settings(page).getByRole("button", { name: "← Back to writing" }).focus();
  await page.keyboard.press("Enter");
  await expect(settings(page)).toHaveCount(0);
  await expect(lip).toBeFocused();
});

test("a notice closed from the keyboard over Settings hands focus to Settings, not to the page under it", async ({
  page,
  browserName,
}) => {
  await openSeeded(page);
  await failing(page, "git_commit", "io");
  await statusBar(page).getByRole("button", { name: "Save snapshot" }).click();
  const error = notices(page).getByRole("listitem").filter({ hasText: "File system error." });
  await expect(error).toBeVisible();
  // Into the notice from the page, as Tab goes: the caret is where focus came
  // from. WebKit's Tab skips buttons unless macOS keyboard navigation is on;
  // Option+Tab is how a default Mac reaches them.
  await content(page).click();
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  const close = error.getByRole("button", { name: "Close" });
  await expect(close).toBeFocused();
  // Settings opened by a press that moves no focus, as one does in WebKit.
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).dispatchEvent("click");
  await expect(settings(page)).toBeVisible();
  await expect(close, "control: focus stayed on the notice").toBeFocused();

  // The caret it came from is under Settings now, inert.
  await page.keyboard.press("Escape");
  await expect(error).toHaveCount(0);
  await expect(settings(page).getByRole("button", { name: "Editor", exact: true })).toBeFocused();
});

const LONG_FOR_SCROLL = Array.from(
  { length: 60 },
  (_, i) => `Párrafo ${i + 1}. El invierno fue largo, y la niña esperaba junto a la ventana mientras la nieve borraba el camino del pueblo.`,
).join("\n\n");

async function noticeGeometry(page: Page) {
  return page.evaluate(() => {
    type View = {
      state: { selection: { main: { head: number } } };
      coordsAtPos(pos: number): { top: number; bottom: number } | null;
      scrollDOM: HTMLElement;
    };
    const host = document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: View } } };
    const view = host.cmTile.root.view;
    const caret = view.coordsAtPos(view.state.selection.main.head)!;
    const stack = document.querySelector(".v-notes-list")!.getBoundingClientRect();
    return { caretTop: caret.top, caretBottom: caret.bottom, stackTop: stack.top, stackBottom: stack.bottom, scrollTop: view.scrollDOM.scrollTop };
  });
}

test("a notice already up when Settings opens leaves the scroll where the writer left it", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto("/?mock=tauri&seed=1");
  const resume = page.getByRole("button", { name: /^Continue/ });
  await resume.waitFor();
  await page.evaluate((text) => {
    [...window.__VERSORIUM_MOCK__.projects.values()][0].chapters[0].body = text;
  }, LONG_FOR_SCROLL);
  await resume.click();
  await expect(page.locator(".cm-content")).toBeVisible();

  await page.evaluate(() => (window.__VERSORIUM_MOCK__.failures["git_commit"] = "io"));
  await page.getByRole("contentinfo").getByRole("button", { name: "Save snapshot" }).click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByRole("listitem")).toHaveCount(1);

  const scroller = page.locator(".cm-scroller");
  await scroller.evaluate((el) => (el.scrollTop = 1200));
  await page.waitForTimeout(100);
  const box = (await scroller.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(150);
  let g = await noticeGeometry(page);
  // Scroll (as a wheel would: the caret does not move) so the caret's line sits inside the stack.
  const delta = g.stackTop + 8 - g.caretTop;
  await scroller.evaluate((el, d) => (el.scrollTop -= d), delta);
  await page.waitForTimeout(200);
  const before = await noticeGeometry(page);

  // Control: no visit, a little while later, nothing moves.
  await page.waitForTimeout(300);
  expect((await noticeGeometry(page)).scrollTop).toBe(before.scrollTop);

  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("region", { name: "Settings" })).toBeVisible();
  await page.getByRole("region", { name: "Settings" }).getByRole("button", { name: "← Back to writing" }).click();
  await page.waitForTimeout(300);
  const after = await noticeGeometry(page);
  expect(after.scrollTop, "the round trip moved the page the writer left").toBe(before.scrollTop);
});
