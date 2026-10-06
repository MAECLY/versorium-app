import { expect, test } from "@playwright/test";

// A screen reader lands in CodeMirror's editable area; that area is the one
// textbox, and its name says what it holds, in the interface's language.
// It used to sit inside a wrapper that was a second textbox, named after the
// binder's chapter list.

test("the page is one textbox, named for the chapter's text, in the interface's language", async ({ page }) => {
  await page.goto("/?mock=tauri&seed=1");
  await page.getByRole("button", { name: /^(Continue|Continuar)/ }).click();
  const content = page.locator(".cm-content");
  await expect(content).toBeVisible();

  await expect(page.getByRole("textbox", { name: "Chapter text" })).toHaveCount(1);
  await expect(content).toHaveAttribute("aria-label", "Chapter text");
  await expect(page.getByRole("textbox", { name: "Chapters" })).toHaveCount(0);
  // Typing still lands in it.
  await content.click();
  await page.keyboard.type(" Más.");
  await expect(content).toContainText("Más.");

  await page.getByRole("contentinfo").getByRole("button", { name: "ES", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Texto del capítulo" })).toHaveCount(1);
});
