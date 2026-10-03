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
