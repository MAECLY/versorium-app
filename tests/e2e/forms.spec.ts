import { expect, test, type Page } from "@playwright/test";

// The shared form primitives, checked on the surfaces that use them. These
// tests exist because the whole point of the components is the wiring a hand
// -rolled control keeps getting wrong: the accessible name, the hint, and a
// control that tells the truth about what the backend accepted.

async function openAuthor(page: Page) {
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByRole("button", { name: "Author", exact: true }).click();
  return settings.getByRole("region", { name: "Author" });
}

test("a field's accessible name is its label and nothing else", async ({ page }) => {
  const author = await openAuthor(page);

  // The hint is a description, not part of the name. Inside the <label> it
  // became the name, and a screen reader announced a paragraph where somebody
  // expected "Name".
  const name = author.getByLabel("Name", { exact: true });
  await expect(name).toBeVisible();
  const described = await name.getAttribute("aria-describedby");
  expect(described, "the hint is wired as a description").toBeTruthy();
  await expect(page.locator(`#${described}`)).toContainText("The byline");
});

test("a select keeps its role, its options and its own chevron", async ({ page }) => {
  const author = await openAuthor(page);

  // Native, deliberately: the popup escapes dialogs and scroll containers and
  // carries keyboard type-ahead for free.
  const role = author.getByRole("combobox", { name: "Role" });
  await expect(role).toBeVisible();
  await role.selectOption("edt");
  await expect(role).toHaveValue("edt");

  // The OS arrow is gone and ours is drawn by the wrapper.
  await expect(author.locator(".v-select").first()).toBeVisible();
  await expect(role).toHaveCSS("appearance", "none");
});

test("a checkbox reports what the caller accepted, not what the browser did", async ({ page }) => {
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByRole("button", { name: "Author", exact: true }).click();
  const author = settings.getByRole("region", { name: "Author" });

  // Work is in use, so its own box is ticked and refuses to be unticked —
  // exports need a profile and none is not one of the two answers.
  const use = author.getByRole("checkbox");
  await expect(use).toBeChecked();
  await expect(use).toBeDisabled();
  // Its name is the label alone.
  await expect(use).toHaveAccessibleName("Use Work for exports");
});

test("the checkbox is drawn in the app's accent, not the operating system's", async ({ page }) => {
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByRole("button", { name: "Author", exact: true }).click();

  // Every checkbox in the app rendered in macOS blue until accent-color was
  // set, which is a branding rule broken in every panel at once.
  const box = settings.getByRole("checkbox").first();
  const accent = await box.evaluate((el) => getComputedStyle(el).accentColor);
  const themed = await box.evaluate((el) =>
    getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
  );
  expect(accent).not.toBe("auto");
  expect(themed).not.toBe("");
});

test("a number field refuses nonsense instead of sending it", async ({ page }) => {
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Create your first novel" }).click();
  const dialog = page.getByRole("dialog", { name: "New project" });
  await dialog.getByLabel("Title").fill("El largo invierno");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(page.locator(".cm-content")).toBeVisible();

  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByRole("button", { name: "History & backup" }).click();
  const backup = settings.getByRole("region", { name: "Backup" });
  await backup.getByRole("button", { name: "Use this" }).first().click();

  const keep = backup.getByRole("spinbutton", { name: "Keep the newest" });
  await expect(keep).toHaveValue("10");

  // Nothing in this app is inside a <form>, so native constraint validation
  // never runs: an empty box would otherwise reach the backend as 0.
  await keep.fill("");
  await keep.blur();
  await expect(keep).toHaveValue("10");

  // And out of range is clamped rather than refused in silence.
  await keep.fill("9999");
  await keep.blur();
  await expect(keep).toHaveValue("200");
});

test("clearing the local server port cannot send a non-number to the backend", async ({ page }) => {
  // It was a bound <input type="number">: Svelte binds an emptied number box
  // as null, and studio_save takes a u16.
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByRole("button", { name: "Local AI" }).click();
  await settings.getByRole("tab", { name: "Local server" }).click();

  const port = settings.getByRole("spinbutton", { name: "Port" });
  await expect(port).toHaveValue("1234");
  await port.fill("");
  await port.blur();
  await expect(port).toHaveValue("1234");

  await settings.getByRole("button", { name: "Save" }).click();
  const saved = await page.evaluate(() =>
    window.__VERSORIUM_MOCK__.calls.filter((c) => c.cmd === "studio_save").map((c) => c.args.port),
  );
  expect(saved.at(-1)).toBe(1234);
});
