import { expect, test } from "@playwright/test";

// Typewriter mode has to change what is on screen, not only a constant in a
// unit test. The padding that lets a short chapter's last line ride at the
// lower third once existed only in a CodeMirror theme that the app stylesheet
// overrode, so the button did nothing — and the unit test, which checked the
// constant, stayed green the whole time.

test("typewriter mode really pads the page, so a short chapter can ride at the lower third", async ({ page }) => {
  await page.goto("/?mock=tauri&seed=1");
  await page.getByRole("button", { name: /^Continue/ }).click();
  const content = page.locator(".cm-content");
  await expect(content).toBeVisible();

  const padding = () =>
    content.evaluate((el) => {
      const s = getComputedStyle(el);
      return { top: parseFloat(s.paddingTop), bottom: parseFloat(s.paddingBottom) };
    });

  const off = await padding();
  expect(off.top).toBeLessThan(100);

  await page.getByRole("contentinfo").getByRole("button", { name: "Typewriter" }).click();
  const height = page.viewportSize()!.height;
  // Two thirds of the viewport, above and below, as TYPEWRITER_HEAD/TAIL say.
  await expect.poll(async () => (await padding()).top).toBeGreaterThan(height * 0.6);
  expect((await padding()).bottom).toBeGreaterThan(height * 0.6);

  await page.getByRole("contentinfo").getByRole("button", { name: "Typewriter" }).click();
  await expect.poll(async () => (await padding()).top).toBe(off.top);
});

/** Where the caret's line sits, as a fraction of the visible page from its top. */
async function lineAt(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    const scroller = document.querySelector(".cm-scroller")!.getBoundingClientRect();
    const line = document.querySelector(".cm-activeLine")!.getBoundingClientRect();
    return (line.top - scroller.top) / scroller.height;
  });
}

test("in a chapter longer than the window, the line being written rides at the lower third", async ({ page }) => {
  // The scroll used to be computed from the line's place in the document,
  // which starts below the 66vh of padding typewriter adds: past the first
  // screen the line sat that much lower, under the window's edge.
  await page.setViewportSize({ width: 1000, height: 640 });
  await page.goto("/?mock=tauri&seed=1");
  await page.getByRole("button", { name: /^Continue/ }).click();
  await page.getByRole("contentinfo").getByRole("button", { name: "Typewriter" }).click();
  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.press("Control+End");
  for (let i = 0; i < 30; i += 1) await page.keyboard.type(`Line ${i}.\n`);
  await page.keyboard.type("Last words");

  // The scroll lands in CodeMirror's next measure: poll until it settles at
  // two thirds down, give or take a line.
  const atAnchor = async () => {
    const at = await lineAt(page);
    return at > 0.6 && at < 0.72 ? "at the anchor" : `at ${at.toFixed(3)}`;
  };
  await expect.poll(atAnchor).toBe("at the anchor");
  const before = await lineAt(page);

  // Moving back up the chapter keeps the line at the same height.
  for (let i = 0; i < 10; i += 1) await page.keyboard.press("ArrowUp");
  await expect.poll(async () => Math.abs((await lineAt(page)) - before)).toBeLessThan(0.05);
});
