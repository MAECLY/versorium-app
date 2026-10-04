import { expect, test, type Locator, type Page } from "@playwright/test";

// The projects-and-chapters panel and the top bar fold away and come back,
// and Focus is a toggle with a menu choosing which of them it hides
// (src/lib/chrome/, App.svelte). The pure rules are tests/unit/chrome.test.ts;
// these read what the page does: inert, focus, hit-testing, the patches the
// mock receives, and the column the text gets.
//
// Runs against the mocked IPC (tests/e2e/mock-tauri.ts).

/**
 * Pins `navigator.platform` before the app loads, as editor-settings.spec.ts
 * does, so the chords read the same on this Mac and on the Linux CI runner.
 */
async function onPlatform(page: Page, platform: "MacIntel" | "Linux x86_64"): Promise<void> {
  await page.addInitScript((value) => {
    Object.defineProperty(Navigator.prototype, "platform", { get: () => value });
  }, platform);
}

/**
 * Settings a previous launch left behind, read by `?persist=1`. Only seeded
 * once, so a reload reads what the app wrote rather than this again.
 */
async function savedSettings(page: Page, saved: Record<string, unknown>): Promise<void> {
  await page.addInitScript((value) => {
    if (!sessionStorage.getItem("versorium.mock.settings")) {
      sessionStorage.setItem("versorium.mock.settings", JSON.stringify(value));
    }
  }, saved);
}

/** A novel on disk, opened on its first chapter. */
async function openSeeded(page: Page, query = ""): Promise<void> {
  await page.goto(`/?mock=tauri&seed=1${query}`);
  await page.getByRole("button", { name: /^(Continue|Continuar)/ }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
}

async function addChapter(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: "New chapter" }).click();
  const dialog = page.getByRole("dialog", { name: "New chapter" });
  await dialog.getByLabel("Chapter title").fill(title);
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toBeHidden();
}

async function typeInManuscript(page: Page, text: string): Promise<void> {
  await page.locator(".cm-content").click();
  await page.keyboard.type(text);
}

const binder = (page: Page) => page.locator("#binder");
const header = (page: Page) => page.locator("#topbar");
const rail = (page: Page) => page.getByRole("button", { name: "Show projects and chapters" });
const lip = (page: Page) => page.getByRole("button", { name: "Show top bar" });
const hideBinder = (page: Page) => page.getByRole("button", { name: "Hide projects and chapters" });
const hideTopBar = (page: Page) => page.getByRole("button", { name: "Hide top bar" });
const focusButton = (page: Page) => page.getByRole("contentinfo").getByRole("button", { name: "Focus", exact: true });
const focusOptions = (page: Page) => page.getByRole("button", { name: "Focus options" });
const liveRegion = (page: Page) => page.locator('[role="status"].sr-only');

function inert(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => el.hasAttribute("inert"));
}

/** Every layout patch the app sent, in order. */
function layoutPatches(page: Page): Promise<Record<string, boolean>[]> {
  return page.evaluate(() =>
    window.__VERSORIUM_MOCK__.calls
      .filter((c) => c.cmd === "set_settings")
      .map((c) => (c.args.patch as { layout?: Record<string, boolean> }).layout)
      .filter((layout): layout is Record<string, boolean> => !!layout),
  );
}

function columnBox(page: Page) {
  return page.locator(".cm-content").evaluate((el) => {
    const box = el.getBoundingClientRect();
    return { x: Math.round(box.x), width: Math.round(box.width) };
  });
}

async function centre(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** What a press at this point would land on, described. */
function hitAt(page: Page, point: { x: number; y: number }): Promise<string> {
  return page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return "nothing";
    const button = el.closest("button");
    return button ? (button.getAttribute("aria-label") ?? button.textContent ?? "").trim() : el.tagName.toLowerCase();
  }, point);
}

function opacity(locator: Locator): Promise<number> {
  return locator.evaluate((el) => Number(getComputedStyle(el).opacity));
}

function caretInManuscript(page: Page): Promise<boolean> {
  return page.evaluate(() => !!document.activeElement?.closest(".cm-content"));
}

/**
 * WCAG contrast of an element's text against what is painted under it: the
 * computed backgrounds from the root down to the element, composited, so a
 * translucent highlight or a transparent button counts for what shows.
 */
function contrastOf(locator: Locator): Promise<number> {
  return locator.evaluate((el) => {
    type Rgba = [number, number, number, number];
    const parse = (css: string): Rgba => {
      const rgb = css.match(/^rgba?\(([^)]+)\)$/);
      if (rgb) {
        const [r, g, b, a = 1] = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
        return [r, g, b, a];
      }
      // What Chrome computes for color-mix(in srgb, …).
      const srgb = css.match(/^color\(srgb ([^)]+)\)$/);
      if (srgb) {
        const [r, g, b, a = 1] = srgb[1].split(/[\s/]+/).filter(Boolean).map(Number);
        return [r * 255, g * 255, b * 255, a];
      }
      throw new Error(`a colour this does not read: ${css}`);
    };
    const over = ([r, g, b, a]: Rgba, under: number[]): number[] => [r, g, b].map((c, i) => c * a + under[i] * (1 - a));
    const chain: Element[] = [];
    for (let node: Element | null = el; node; node = node.parentElement) chain.unshift(node);
    let bg = [255, 255, 255];
    for (const node of chain) bg = over(parse(getComputedStyle(node).backgroundColor), bg);
    const fg = over(parse(getComputedStyle(el).color), bg);
    const luminance = (c: number[]): number => {
      const [r, g, b] = c.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  });
}

/** Switches the theme in place, and waits out the 150ms colour transitions it starts. */
async function onTheme(page: Page, theme: string): Promise<void> {
  await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
  // Transitions only: the caret's blink is an animation that never ends.
  await expect
    .poll(() =>
      page.evaluate(
        () => document.getAnimations().filter((a) => a instanceof CSSTransition && a.playState === "running").length,
      ),
    )
    .toBe(0);
}

/**
 * The slots have finished their 160ms: no transition is running and each is
 * the size its data-view asks for, so what is measured now is where things
 * stay. Sizes alone are not enough: a transition's first frame still reads
 * the size it is leaving.
 */
async function settled(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const slot = document.querySelector<HTMLElement>(".v-binder-slot");
        const bar = document.querySelector<HTMLElement>(".v-topbar-slot")!;
        // Read first: forcing the style is what starts a pending transition.
        const width = slot ? slot.getBoundingClientRect().width : 0;
        const height = bar.getBoundingClientRect().height;
        const moving = document.getAnimations().some((a) => a instanceof CSSTransition && a.playState === "running");
        const wanted = slot ? (slot.dataset.view === "open" ? 240 : 28) : 0;
        return !moving && width === wanted && height === (bar.dataset.view === "open" ? 48 : 24);
      }),
    )
    .toBe(true);
}

/** Enter Focus with the mouse, then type so the edges go to sleep. */
async function focusAndType(page: Page, text = "Y nadie contestó. "): Promise<void> {
  await focusButton(page).click();
  await expect(focusButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => caretInManuscript(page)).toBe(true);
  await page.keyboard.type(text);
  await settled(page);
}

/** Moves the pointer by a total distance, starting from a fresh baseline at `from`. */
async function travel(page: Page, from: { x: number; y: number }, steps: [number, number][]): Promise<void> {
  await page.mouse.move(from.x, from.y);
  let { x, y } = from;
  for (const [dx, dy] of steps) {
    x += dx;
    y += dy;
    await page.mouse.move(x, y);
  }
}

test("the projects-and-chapters panel folds to a rail and comes back", async ({ page }) => {
  // At 1024 with the panel open the window, not the measure, limits the
  // column; 84ch keeps that true on any machine's serif.
  await page.setViewportSize({ width: 1024, height: 700 });
  await savedSettings(page, {
    editor: {
      spellcheck: true,
      textSize: "medium",
      lineSpacing: "comfortable",
      textWidth: "wide",
      lineNumbers: false,
      activeLine: true,
      tabKey: "next",
    },
  });
  await openSeeded(page, "&persist=1");
  const before = await columnBox(page);

  // Control: open, the panel is no inert subtree and leaves no rail.
  expect(await inert(binder(page))).toBe(false);
  await expect(rail(page)).toHaveCount(0);

  // Clicked while writing: the caret stays in the text, so the next words
  // land there. (In WebKit a click once left focus on <body>, and in Chrome
  // it went to the button and on to the rail.)
  await typeInManuscript(page, "Hola. ");
  await hideBinder(page).click();
  expect(await inert(binder(page))).toBe(true);
  await expect(rail(page)).toBeVisible();
  // The panel's one name, the one its Hide, menu item and announcements use.
  await expect(rail(page)).toHaveText("Projects and chapters");
  await expect(rail(page)).toHaveAttribute("aria-expanded", "false");
  expect(await caretInManuscript(page), "a click on Hide keeps the writer's caret").toBe(true);
  await expect.poll(() => layoutPatches(page)).toEqual([{ binderOpen: false }]);
  await expect.poll(async () => (await columnBox(page)).width, { message: "the text got the room" }).toBeGreaterThan(
    before.width,
  );

  // Hovered, the rail draws the accent border every button shows on hover.
  await rail(page).hover();
  const accent = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--accent)";
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  });
  await expect.poll(() => rail(page).evaluate((el) => getComputedStyle(el).borderRightColor)).toBe(accent);

  await rail(page).click();
  expect(await inert(binder(page))).toBe(false);
  await expect(rail(page)).toHaveCount(0);
  expect(await caretInManuscript(page), "and so does a click on the rail").toBe(true);
  await page.keyboard.type("Sigo.");
  await expect(page.locator(".cm-content")).toContainText("Hola. Sigo.");
  await expect.poll(() => layoutPatches(page)).toEqual([{ binderOpen: false }, { binderOpen: true }]);
  await expect.poll(async () => (await columnBox(page)).width).toBe(before.width);
});

test("from the keyboard, Hide hands focus to its rail or lip, and that back to Hide", async ({ page }) => {
  await openSeeded(page);

  await hideBinder(page).focus();
  await page.keyboard.press("Enter");
  await expect(rail(page), "focus went to the rail, not down with the panel").toBeFocused();
  await page.keyboard.press("Enter");
  await expect(hideBinder(page)).toBeFocused();

  await hideTopBar(page).focus();
  await page.keyboard.press("Enter");
  await expect(lip(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(hideTopBar(page)).toBeFocused();
});

test("a click that finds focus nowhere leaves it in the text, never on <body>", async ({ page }) => {
  // Where WebKit, the macOS app's engine, leaves focus after a click on any
  // button elsewhere: it gives a clicked button none.
  const dropFocus = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const onBody = () => page.evaluate(() => document.activeElement === document.body);
  await openSeeded(page);

  for (const [hide, show] of [
    [hideBinder, rail],
    [hideTopBar, lip],
  ] as const) {
    await dropFocus();
    expect(await onBody(), "control: focus starts nowhere").toBe(true);
    await hide(page).click();
    await expect.poll(() => caretInManuscript(page)).toBe(true);
    await dropFocus();
    await show(page).click();
    await expect.poll(() => caretInManuscript(page)).toBe(true);
  }

  // With no manuscript on screen, the control that undoes the click.
  await page.getByRole("contentinfo").getByRole("button", { name: "Corkboard" }).click();
  await expect(page.getByRole("list", { name: "Corkboard" })).toBeVisible();
  await dropFocus();
  await hideBinder(page).click();
  await expect(rail(page)).toBeFocused();
  await dropFocus();
  await rail(page).click();
  await expect(hideBinder(page)).toBeFocused();
});

test("a folded panel is remembered across a relaunch", async ({ page }) => {
  await openSeeded(page, "&persist=1");
  await hideBinder(page).click();
  await expect(rail(page)).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: /^Continue/ }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(rail(page)).toBeVisible();
  expect(await inert(binder(page))).toBe(true);
  await expect.poll(() => page.locator(".v-binder-slot").evaluate((el) => el.getBoundingClientRect().width)).toBe(28);
});

test("without settings that outlive the page, a reload opens everything again", async ({ page }) => {
  // The control for the test above: what was remembered came from storage.
  await openSeeded(page);
  await hideBinder(page).click();
  await expect(rail(page)).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /^Continue/ }).click();
  await expect(hideBinder(page)).toBeVisible();
  await expect(rail(page)).toHaveCount(0);
});

test("the top bar folds to a lip and back, and Rewrite keeps its key", async ({ page }) => {
  await openSeeded(page);
  expect(await inert(header(page))).toBe(false);
  // Its Hide says which bar on the button itself, not only in a tooltip.
  await expect(hideTopBar(page)).toHaveText("Hide top bar");

  await typeInManuscript(page, "Una noche sin luna.");
  await hideTopBar(page).click();
  expect(await inert(header(page))).toBe(true);
  await expect(lip(page)).toBeVisible();
  expect(await caretInManuscript(page), "a click on Hide keeps the writer's caret").toBe(true);
  const box = (await lip(page).boundingBox())!;
  expect(box.height, "a 24px target (WCAG 2.5.8)").toBeGreaterThanOrEqual(24);
  await expect(lip(page)).toHaveAttribute("title", /Rewrite works without it: (⇧⌘R|Ctrl\+Shift\+R)\./);

  // Rewrite's button is folded away; its key is not.
  await page.keyboard.press("Shift+Home");
  await page.keyboard.press("Control+Shift+R");
  const rewrite = page.getByRole("dialog", { name: "Rewrite" });
  await expect(rewrite).toBeVisible();
  await rewrite.getByRole("button", { name: "Discard" }).click();
  await expect(rewrite).toBeHidden();

  await lip(page).click();
  expect(await inert(header(page))).toBe(false);
  await expect(lip(page)).toHaveCount(0);
  await expect.poll(() => caretInManuscript(page), { message: "a click on the lip keeps it too" }).toBe(true);
  await expect.poll(() => layoutPatches(page)).toEqual([{ topBarOpen: false }, { topBarOpen: true }]);
});

test("REGRESSION: in Focus the way out is under the mouse", async ({ page }) => {
  await openSeeded(page);
  await focusAndType(page);

  // The old Focus faded the status bar and made it unhittable, so the button
  // that ends Focus could not be pressed. It is now never hidden.
  const point = await centre(focusButton(page));
  expect(await hitAt(page, point)).toBe("Focus");
  expect(await inert(header(page))).toBe(true);
  expect(await page.locator(".v-topbar-slot").evaluate((el) => el.getBoundingClientRect().height)).toBe(24);

  // Straight after typing, as a writer would: the first Escape is not lost to
  // a completion query nobody can see (src/lib/editor/cm.ts).
  await page.mouse.click(point.x, point.y);
  await expect(focusButton(page)).toHaveAttribute("aria-pressed", "false");
  expect(await inert(header(page))).toBe(false);
});

test("in Focus the edges stay faded however the mouse moves, and show only under the pointer", async ({
  page,
}) => {
  await openSeeded(page);
  await focusAndType(page);

  const shell = page.locator(".v-shell");
  await expect(shell).toHaveAttribute("data-focus", /.+/);
  await expect(shell).not.toHaveAttribute("data-awake", /.*/);
  await expect.poll(() => opacity(rail(page))).toBe(0);

  // The owner's call (2026-10-04): moving the mouse around the page must not
  // bring the bars' traces back. Long travel, all over the page.
  await travel(page, { x: 500, y: 300 }, [[200, 0], [0, 200], [-300, -100], [150, 50]]);
  await expect(shell).not.toHaveAttribute("data-awake", /.*/);
  expect(await opacity(rail(page)), "the mouse moving leaves the rail faded").toBe(0);
  expect(await opacity(page.locator(".v-edge-lip")), "and the lip").toBe(0);

  // The pointer on the rail itself shows it, and it is the rail a click hits.
  const onRail = await centre(rail(page));
  await page.mouse.move(onRail.x, onRail.y);
  await expect.poll(() => opacity(rail(page))).toBe(1);
  expect(await hitAt(page, onRail)).toBe("Show projects and chapters");

  // Off it again, it fades: nothing else woke.
  await page.mouse.move(600, 300);
  await expect.poll(() => opacity(rail(page))).toBe(0);

  await page.mouse.move(onRail.x, onRail.y);
  await rail(page).click();
  await expect(binder(page)).toBeVisible();
  expect(await inert(binder(page))).toBe(false);
  await expect(page.locator(".v-binder-slot")).toHaveAttribute("data-view", "peek");
});

test("Focus masks the layout and never writes it", async ({ page }) => {
  await openSeeded(page);
  await hideBinder(page).click();
  await expect.poll(() => layoutPatches(page), { message: "control: a layout change is logged" }).toEqual([
    { binderOpen: false },
  ]);

  await focusAndType(page);
  expect(await inert(header(page))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(focusButton(page)).toHaveAttribute("aria-pressed", "false");

  // Exactly what was there before: the panel the writer folded stays folded,
  // the bar Focus folded is back.
  await expect(rail(page)).toBeVisible();
  expect(await inert(binder(page))).toBe(true);
  expect(await inert(header(page))).toBe(false);
  await expect(hideTopBar(page)).toBeVisible();
  expect(await layoutPatches(page), "nothing written between entering and leaving Focus").toEqual([
    { binderOpen: false },
  ]);
});

test("a peek floats over the page and closes once a chapter is chosen", async ({ page }) => {
  await openSeeded(page);
  await addChapter(page, "Segundo");
  await focusAndType(page);
  const column = await columnBox(page);

  await travel(page, { x: 500, y: 300 }, [[20, 0]]);
  await rail(page).click();
  await expect(page.locator(".v-binder-slot")).toHaveAttribute("data-view", "peek");
  await expect(rail(page)).toHaveAttribute("aria-expanded", "true");
  await settled(page);
  expect(await columnBox(page), "the text neither moves nor re-wraps").toEqual(column);

  await binder(page).getByRole("button").filter({ hasText: "Novela 1" }).last().click();
  await expect(page.locator(".v-binder-slot")).toHaveAttribute("data-view", "collapsed");
  // Read from the folded list itself: the status bar is showing the leave
  // hint in place of the chapter's name for these first seconds.
  await expect(binder(page).locator('[data-item-key^="chapter:"][aria-current="true"]')).toContainText("ch-01");
  await expect(focusButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => caretInManuscript(page), { message: "the caret went into the chapter" }).toBe(true);
  expect(await layoutPatches(page)).toEqual([]);
});

test("a chapter made with the peek's + opens, and the peek closes on it", async ({ page }) => {
  await onPlatform(page, "MacIntel");
  await openSeeded(page);
  await focusAndType(page);
  const slot = page.locator(".v-binder-slot");

  await page.keyboard.press("Control+Meta+KeyS");
  await expect(slot).toHaveAttribute("data-view", "peek");
  await binder(page).getByRole("button", { name: "New chapter" }).click();
  const dialog = page.getByRole("dialog", { name: "New chapter" });
  await dialog.getByLabel("Chapter title").fill("Segundo");
  await expect(slot, "a dialog opened from the peek keeps it").toHaveAttribute("data-view", "peek");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toBeHidden();

  // Made and opened, so chosen: the peek goes, as a row's click makes it.
  await expect(slot).toHaveAttribute("data-view", "collapsed");
  await expect(binder(page).locator('[data-item-key^="chapter:"][aria-current="true"]')).toContainText("Segundo");
  await expect(focusButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => caretInManuscript(page), { message: "the caret went into the new chapter" }).toBe(true);
  await page.keyboard.type("Empieza aquí.");
  await expect(page.locator(".cm-content")).toContainText("Empieza aquí.");
});

test("focus that leaves a peek closes it, and a peek from the faded rail hands the caret back", async ({
  page,
  browserName,
}) => {
  // WebKit's Tab skips buttons unless macOS keyboard navigation is on;
  // Option+Tab is how a default Mac reaches them (TODO.md, macOS checks).
  const tab = browserName === "webkit" ? "Alt+Tab" : "Tab";
  await onPlatform(page, "MacIntel");
  await openSeeded(page);
  await focusAndType(page);
  const barSlot = page.locator(".v-topbar-slot");
  const panelSlot = page.locator(".v-binder-slot");

  // The top bar: Tab within it keeps it, Tab past its last button closes it.
  await page.keyboard.press("Alt+Meta+KeyT");
  await expect(barSlot).toHaveAttribute("data-view", "peek");
  await expect(header(page).getByRole("button", { name: "Rewrite" })).toBeFocused();
  // While it floats, the folded panel's rail starts its words below it.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const words = document.querySelector(".v-edge-rail .v-edge-label")!.getBoundingClientRect();
        return Math.round(words.top) >= Math.round(document.querySelector("#topbar")!.getBoundingClientRect().bottom);
      }),
    )
    .toBe(true);
  await page.keyboard.press(tab);
  await expect(barSlot).toHaveAttribute("data-view", "peek");
  await expect(header(page).getByRole("button", { name: "Manuscript" })).toBeFocused();
  for (const name of ["Open project", "Settings", "Hide top bar"]) {
    await page.keyboard.press(tab);
    await expect(header(page).getByRole("button", { name })).toBeFocused();
  }
  await expect(barSlot).toHaveAttribute("data-view", "peek");
  await page.keyboard.press(tab);
  await expect(barSlot, "focus moved on past the bar").toHaveAttribute("data-view", "collapsed");

  // The panel: from the open chapter's row, past its ⋯, into the text.
  await page.keyboard.press("Control+Meta+KeyS");
  await expect(panelSlot).toHaveAttribute("data-view", "peek");
  await page.keyboard.press(tab);
  await expect(panelSlot).toHaveAttribute("data-view", "peek");
  await page.keyboard.press(tab);
  await expect(panelSlot).toHaveAttribute("data-view", "collapsed");

  // A press on the faded rail opens the panel as a peek, which takes focus
  // on the open chapter's row; Escape closes it and the caret is back where
  // the writer left it.
  await typeInManuscript(page, "Sigo. ");
  const shell = page.locator(".v-shell");
  await expect(shell).not.toHaveAttribute("data-awake", /.*/);
  const onRail = await centre(rail(page));
  await page.mouse.click(onRail.x, onRail.y);
  await expect(panelSlot).toHaveAttribute("data-view", "peek");
  await expect(page.locator('[data-item-key^="chapter:"][aria-current="true"]')).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panelSlot).toHaveAttribute("data-view", "collapsed");
  await expect.poll(() => caretInManuscript(page)).toBe(true);
  await page.keyboard.type("Y sigo.");
  await expect(page.locator(".cm-content")).toContainText("Sigo. Y sigo.");
});

test("the floating panel sits above the editor's own search panel", async ({ page }) => {
  await onPlatform(page, "MacIntel");
  await openSeeded(page);
  await focusAndType(page);
  await page.keyboard.press("Meta+KeyF");
  await expect(page.locator(".cm-search")).toBeVisible();
  await page.keyboard.press("Control+Meta+KeyS");
  await expect(page.locator(".v-binder-slot")).toHaveAttribute("data-view", "peek");
  await settled(page);

  const hit = await page.evaluate(() => {
    const panel = document.querySelector("#binder")!.getBoundingClientRect();
    const search = document.querySelector(".cm-search")!.closest(".cm-panels")!.getBoundingClientRect();
    // Where the two overlap: the floating panel's lower left.
    const x = Math.max(panel.left, search.left) + 10;
    const y = (Math.max(panel.top, search.top) + Math.min(panel.bottom, search.bottom)) / 2;
    const overlap = x < Math.min(panel.right, search.right) && y > search.top && y < panel.bottom;
    return { overlap, onPanel: !!document.elementFromPoint(x, y)?.closest("#binder") };
  });
  expect(hit.overlap, "control: the search panel does run under the floating one").toBe(true);
  expect(hit.onPanel, "a press there lands on the floating panel").toBe(true);
});

test("outside Focus the rail opens the panel in the layout, which moves the column", async ({ page }) => {
  // The control for the floating peek above.
  await openSeeded(page);
  await hideBinder(page).click();
  const column = await columnBox(page);
  await rail(page).click();
  await expect.poll(async () => (await columnBox(page)).x).not.toBe(column.x);
});

test("Escape peels one layer at a time", async ({ page }) => {
  await onPlatform(page, "MacIntel");
  await openSeeded(page);
  await focusAndType(page);

  // Peek by chord: focus lands on the open chapter's row.
  await page.keyboard.press("Control+Meta+KeyS");
  await expect(page.locator(".v-binder-slot")).toHaveAttribute("data-view", "peek");
  const row = binder(page).locator('[data-item-key^="chapter:"][aria-current="true"]');
  await expect(row).toBeFocused();

  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("menu")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu"), "the menu, and only the menu").toHaveCount(0);
  await expect(page.locator(".v-binder-slot")).toHaveAttribute("data-view", "peek");
  await expect(row).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.locator(".v-binder-slot")).toHaveAttribute("data-view", "collapsed");
  await expect.poll(() => caretInManuscript(page), { message: "the caret is back" }).toBe(true);
  await expect(focusButton(page)).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Escape");
  await expect(focusButton(page)).toHaveAttribute("aria-pressed", "false");
});

test("Escape that something else used does not end Focus", async ({ page }) => {
  await onPlatform(page, "MacIntel");
  await openSeeded(page);
  await focusAndType(page);

  // The search panel's own Escape.
  await page.keyboard.press("Meta+KeyF");
  await expect(page.locator(".cm-search")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".cm-search")).toHaveCount(0);
  await expect(focusButton(page)).toHaveAttribute("aria-pressed", "true");

  // Collapsing a selection.
  await page.keyboard.press("Shift+Home");
  await page.keyboard.press("Escape");
  await expect(focusButton(page)).toHaveAttribute("aria-pressed", "true");

  // A completion list on screen is closed first.
  await page.keyboard.type(" <di");
  await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".cm-tooltip-autocomplete")).toHaveCount(0);
  await expect(focusButton(page)).toHaveAttribute("aria-pressed", "true");

  // Control: an Escape nothing else wants ends it.
  await page.keyboard.press("Escape");
  await expect(focusButton(page)).toHaveAttribute("aria-pressed", "false");
});

test("the first Escape after typing leaves Focus", async ({ page }) => {
  // Typed and pressed at once, inside the ~100ms in which CodeMirror's
  // completion has an invisible query pending.
  await openSeeded(page);
  await focusButton(page).click();
  await expect.poll(() => caretInManuscript(page)).toBe(true);
  await page.keyboard.type("Fin.");
  await page.keyboard.press("Escape");
  await expect(focusButton(page)).toHaveAttribute("aria-pressed", "false");
});

test("Focus options: two items saying what Focus hides, from the keyboard", async ({ page }) => {
  await openSeeded(page);
  const dots = focusOptions(page);
  await expect(dots).toHaveAttribute("aria-haspopup", "menu");
  await expect(dots).not.toHaveAttribute("aria-controls", /.*/);

  await dots.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Focus options" });
  await expect(menu).toBeVisible();
  await expect(dots).toHaveAttribute("aria-controls", "focus-options-menu");
  const binderItem = menu.getByRole("menuitemcheckbox", { name: "Projects and chapters" });
  const barItem = menu.getByRole("menuitemcheckbox", { name: "Top bar" });
  await expect(binderItem).toBeFocused();
  await expect(binderItem).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("group", { name: "When Focus is on, hide" })).toBeVisible();
  // Focus is off, so the menu says nothing will move yet.
  await expect(menu).toHaveAccessibleDescription("Takes effect when Focus is on.");

  await page.keyboard.press("ArrowDown");
  await expect(barItem).toBeFocused();
  await page.keyboard.press("Space");
  await expect(barItem).toHaveAttribute("aria-checked", "false");
  await expect(menu, "Space keeps the menu open").toBeVisible();
  await expect.poll(() => layoutPatches(page), { message: "one write, the shape Rust reads" }).toEqual([
    { focusHidesTopBar: false },
  ]);

  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(dots).toBeFocused();
  await expect(focusButton(page)).toHaveAttribute("aria-pressed", "false");

  // With Focus on there is no note, and ticking Top bar again folds the bar
  // behind the open menu, which stays open.
  await focusButton(page).click();
  await dots.click();
  await expect(menu).toBeVisible();
  await expect(menu).not.toHaveAttribute("aria-describedby", /.*/);
  expect(await inert(header(page)), "unticked, so Focus left the bar").toBe(false);
  await barItem.click();
  await expect(barItem).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => inert(header(page))).toBe(true);
  await expect(menu).toBeVisible();
  await barItem.click();
  await expect.poll(() => inert(header(page)), { message: "unticking brings the bar back" }).toBe(false);
  await expect(menu).toBeVisible();

  // Both unticked: Focus stays pressed and hides nothing, and the menu says
  // what it still does, with Focus on and with it off.
  await binderItem.click();
  await expect(binderItem).toHaveAttribute("aria-checked", "false");
  await expect.poll(() => inert(binder(page))).toBe(false);
  await expect(menu).toHaveAccessibleDescription("Nothing is ticked, so Focus only quiets the status bar.");
  // The note arrived with the menu open, and the menu grew upward from ⋯,
  // not down over the status bar and off the window.
  await expect
    .poll(async () => {
      const pop = (await page.locator(".v-menu-pop").boundingBox())!;
      const trigger = (await dots.boundingBox())!;
      return Math.round(pop.y + pop.height) <= Math.round(trigger.y);
    })
    .toBe(true);
  await page.keyboard.press("Escape");
  await focusButton(page).click();
  await expect(focusButton(page)).toHaveAttribute("aria-pressed", "false");
  await dots.click();
  await expect(menu).toHaveAccessibleDescription("Nothing is ticked, so Focus only quiets the status bar.");
  // Control: one tick back, and the note is the Focus-off one again.
  await binderItem.click();
  await expect(menu).toHaveAccessibleDescription("Takes effect when Focus is on.");
});

test("Focus options is a target WCAG 2.5.8 accepts beside Focus", async ({ page }) => {
  // 21px tall, under 24, and sharing a border with Focus: it passes on
  // spacing, which needs a 24px circle on its centre to stay clear of Focus.
  await openSeeded(page);
  const dots = (await focusOptions(page).boundingBox())!;
  const focus = (await focusButton(page).boundingBox())!;
  expect(dots.height, "control: undersized, so spacing is what counts").toBeLessThan(24);
  expect(dots.x + dots.width / 2 - 12, "the circle's left edge clears Focus's box").toBeGreaterThan(focus.x + focus.width);
});

test("on a Mac the chords fold, peek and toggle Focus, and say so", async ({ page }) => {
  await onPlatform(page, "MacIntel");
  await page.clock.install();
  await openSeeded(page);
  await typeInManuscript(page, "Hola.");

  await page.keyboard.press("Control+Meta+KeyS");
  await expect(rail(page)).toBeVisible();
  await expect(liveRegion(page)).toHaveText("Projects and chapters hidden.");
  expect(await caretInManuscript(page), "a chord typed in the text leaves the caret").toBe(true);
  await page.keyboard.press("Control+Meta+KeyS");
  await expect(hideBinder(page)).toBeVisible();
  await expect(liveRegion(page)).toHaveText("Projects and chapters shown.");

  await page.keyboard.press("Alt+Meta+KeyT");
  await expect(lip(page)).toBeVisible();
  await expect(liveRegion(page)).toHaveText("Top bar hidden.");
  await page.keyboard.press("Alt+Meta+KeyT");
  await expect(hideTopBar(page)).toBeVisible();

  // Control: the other platforms' chord does nothing here.
  await page.keyboard.press("Control+Shift+KeyF");
  await expect(focusButton(page)).toHaveAttribute("aria-pressed", "false");

  await page.keyboard.press("Meta+Shift+KeyF");
  await expect(focusButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect(focusButton(page)).toHaveAttribute("aria-keyshortcuts", "Shift+Meta+F");
  await expect(liveRegion(page)).toHaveText("Focus on. Press Escape to leave.");
  expect(await caretInManuscript(page)).toBe(true);
  const hint = page.getByRole("contentinfo").getByText("Press Esc to leave Focus");
  await expect(hint).toBeVisible();
  await page.clock.fastForward(4100);
  await expect(hint).toHaveCount(0);

  await page.keyboard.press("Meta+Shift+KeyF");
  await expect(focusButton(page)).toHaveAttribute("aria-pressed", "false");
  await expect(liveRegion(page)).toHaveText("Focus off.");
  // Control: the hint is once a session. Counted at once: a retrying
  // assertion would wait out the 4s and pass either way.
  await page.keyboard.press("Meta+Shift+KeyF");
  await expect(focusButton(page)).toHaveAttribute("aria-pressed", "true");
  expect(await hint.count()).toBe(0);
});

test("on Windows and Linux the chords are Ctrl+Shift", async ({ page }) => {
  await onPlatform(page, "Linux x86_64");
  await openSeeded(page);
  await typeInManuscript(page, "Hola.");
  await expect(hideBinder(page)).toHaveAttribute("aria-keyshortcuts", "Control+Shift+S");
  await expect(hideBinder(page)).toHaveAttribute("title", "Hide projects and chapters (Ctrl+Shift+S)");

  await page.keyboard.press("Control+Shift+KeyS");
  await expect(rail(page)).toBeVisible();
  await page.keyboard.press("Control+Shift+KeyT");
  await expect(lip(page)).toBeVisible();
  await page.keyboard.press("Control+Shift+KeyF");
  await expect(focusButton(page)).toHaveAttribute("aria-pressed", "true");
  // Control: the macOS chord is nothing here.
  await page.keyboard.press("Control+Meta+KeyS");
  await expect(page.locator(".v-binder-slot")).toHaveAttribute("data-view", "collapsed");
});

test("Focus is not restored at launch", async ({ page }) => {
  await page.goto("/?mock=tauri&seed=1&legacyFocus=1");
  // Control: the file really says Focus was on.
  expect(await page.evaluate(() => window.__VERSORIUM_MOCK__.settings.focusMode)).toBe(true);
  await page.getByRole("button", { name: /^Continue/ }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(focusButton(page)).toHaveAttribute("aria-pressed", "false");
  await expect(hideBinder(page)).toBeVisible();
  await expect(hideTopBar(page)).toBeVisible();
});

test("with no chapter open Focus waits, and deleting the last one ends it", async ({ page }) => {
  await onPlatform(page, "MacIntel");
  await openSeeded(page);
  // Control: a chapter is open, so Focus is there to press.
  await expect(focusButton(page)).toBeEnabled();

  await focusAndType(page);
  await page.keyboard.press("Control+Meta+KeyS");
  await expect(binder(page).locator('[data-item-key^="chapter:"][aria-current="true"]')).toBeFocused();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Delete chapter" }).click();
  await page.getByRole("dialog", { name: /Delete/ }).getByRole("button", { name: "Delete chapter" }).click();

  await expect(focusButton(page)).toHaveAttribute("aria-pressed", "false");
  await expect(focusButton(page)).toBeDisabled();
  await expect(focusButton(page)).toHaveAttribute("title", "Open a chapter to use Focus.");
  await expect(hideBinder(page), "the layout Focus borrowed is back").toBeVisible();
  await page.keyboard.press("Meta+Shift+KeyF");
  await expect(focusButton(page)).toHaveAttribute("aria-pressed", "false");
  await expect(rail(page)).toHaveCount(0);
});

test("Focus and the corkboard or Settings never share the page", async ({ page }) => {
  await onPlatform(page, "MacIntel");
  await openSeeded(page);
  await focusAndType(page);
  await page.getByRole("contentinfo").getByRole("button", { name: "Corkboard" }).click();
  await expect(page.getByRole("list", { name: "Corkboard" })).toBeVisible();
  await expect(focusButton(page)).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("contentinfo").getByRole("button", { name: "Corkboard" }).click();

  await focusAndType(page);
  await page.keyboard.press("Alt+Meta+KeyT");
  await expect(page.locator(".v-topbar-slot")).toHaveAttribute("data-view", "peek");
  await expect(header(page).getByRole("button", { name: "Rewrite" })).toBeFocused();
  await header(page).getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("region", { name: "Settings" })).toBeVisible();
  await expect(focusButton(page)).toHaveAttribute("aria-pressed", "false");
});

test("a menu left open in a panel that folds away closes with it", async ({ page }) => {
  await onPlatform(page, "MacIntel");
  await openSeeded(page);
  const dots = page.getByRole("button", { name: "Actions for chapter Novela 1" });
  const dropFocus = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  // The DOM, not the accessibility tree: an inert panel hides a stranded menu
  // from getByRole, while App's Escape guard still finds it and stands down.
  const menus = page.locator('[role="menu"]');

  await dots.click();
  await expect(menus).toHaveCount(1);
  await page.keyboard.press("Control+Meta+KeyS");
  await expect(rail(page)).toBeVisible();
  await expect(menus).toHaveCount(0);
  await expect(rail(page), "focus left the folding panel for its rail").toBeFocused();

  // Focus already dropped out of the menu to <body>, which leaves it open:
  // only the fold itself can close it.
  await rail(page).click();
  await dots.click();
  await dropFocus();
  await expect(menus).toHaveCount(1);
  await page.keyboard.press("Control+Meta+KeyS");
  await expect(rail(page)).toBeVisible();
  await expect(menus).toHaveCount(0);

  // And Escape still reaches a menu whose focus left it.
  await rail(page).click();
  await dots.click();
  await dropFocus();
  await expect(menus).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(menus).toHaveCount(0);
});

test("quiet while you type in Focus, the status bar's buttons keep AA contrast", async ({ page }) => {
  await openSeeded(page);
  await focusAndType(page);
  // Off the bar, whose hover brings the borders back.
  await page.mouse.move(600, 300);
  await page.keyboard.type("x");
  await expect(page.locator(".v-shell")).toHaveAttribute("data-quiet", /.+/);
  const bar = page.getByRole("contentinfo");

  // The two light themes where --text-mute on the bar's own --bg-app falls
  // under 4.5:1 (4.21 and 4.40); the rest have more room.
  for (const theme of ["folio-light", "quarry-light"]) {
    await onTheme(page, theme);
    for (const name of ["Save snapshot", "History", "↩ Restore", "Corkboard", "Focus options", "Typewriter", "ES"]) {
      const button = bar.getByRole("button", { name, exact: true });
      // Control: quiet really is on, the border is gone (after its 150ms).
      await expect
        .poll(() => button.evaluate((el) => getComputedStyle(el).borderTopColor), { message: `${name} is quiet` })
        .toBe("rgba(0, 0, 0, 0)");
      expect(await contrastOf(button), `${name}, ${theme}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("a highlighted Delete keeps AA contrast in every theme", async ({ page }) => {
  await openSeeded(page);
  const dots = page.getByRole("button", { name: "Actions for chapter Novela 1" });
  await dots.focus();
  // ↑ opens the menu on its last item, the destructive one, by keyboard.
  await page.keyboard.press("ArrowUp");
  const remove = page.getByRole("menuitem", { name: "Delete chapter" });
  await expect(remove).toBeFocused();
  expect(await remove.evaluate((el) => el.matches(":focus-visible")), "control: the keyboard's highlight").toBe(true);
  expect(await remove.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");

  for (const theme of ["folio-light", "folio-dark", "quarry-light", "quarry-dark", "needle-light", "needle-dark"]) {
    await onTheme(page, theme);
    expect(await contrastOf(remove), theme).toBeGreaterThanOrEqual(4.5);
  }
  // Control: only the destructive item's highlight is lighter.
  const fill = (el: Element) => getComputedStyle(el).backgroundColor;
  const dangerFill = await remove.evaluate(fill);
  await page.keyboard.press("ArrowUp");
  const other = page.locator('[role="menuitem"]:focus');
  await expect(other).toHaveCount(1);
  expect(await other.evaluate(fill)).not.toBe("rgba(0, 0, 0, 0)");
  expect(await other.evaluate(fill)).not.toBe(dangerFill);
});

test("folding is instant when the system asks for reduced motion", async ({ page }) => {
  const durations = () =>
    page.evaluate(() =>
      [".v-binder-slot", ".v-topbar-slot"].map((s) => getComputedStyle(document.querySelector(s)!).transitionDuration),
    );
  await openSeeded(page);
  await expect(page.locator(".v-shell")).toHaveAttribute("data-ready", /.+/);
  // Control: 160ms without the preference.
  expect(await durations()).toEqual(["0.16s", "0.16s"]);

  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await durations()).toEqual(["0s", "0s"]);
});

test("in Spanish at 1024 the status bar fits, and a long chapter title gives way", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await openSeeded(page);
  await page.getByRole("contentinfo").getByRole("button", { name: "ES", exact: true }).click();
  const bar = page.getByRole("contentinfo");
  await expect(bar.getByRole("button", { name: "Concentración", exact: true })).toBeVisible();

  const where = bar.locator(".v-status-where");
  // Control: a short title fits whole.
  expect(await where.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

  await page.getByRole("button", { name: "Nuevo capítulo" }).click();
  const dialog = page.getByRole("dialog", { name: "Nuevo capítulo" });
  await dialog.getByLabel("Título del capítulo").fill("Donde el faro dejó de girar y el pueblo entero contuvo el aliento");
  await dialog.getByRole("button", { name: "Crear" }).click();
  await expect(bar).toContainText("ch-02 · Donde el faro");

  expect(await where.evaluate((el) => el.scrollWidth > el.clientWidth), "the title is cut").toBe(true);
  expect(await where.evaluate((el) => getComputedStyle(el).textOverflow)).toBe("ellipsis");
  await expect(where).toHaveAttribute("title", /contuvo el aliento$/);
  expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth), "nothing spills out of the bar").toBe(true);
  for (const button of [
    bar.getByRole("button", { name: "Concentración", exact: true }),
    bar.getByRole("button", { name: "Opciones de Concentración" }),
    bar.getByRole("button", { name: "Máquina de escribir" }),
    bar.getByRole("button", { name: "EN", exact: true }),
  ]) {
    const box = (await button.boundingBox())!;
    expect(box.x + box.width, await button.textContent()).toBeLessThanOrEqual(1024);
  }
});
