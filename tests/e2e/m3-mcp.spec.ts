import { expect, test, type Page } from "@playwright/test";
import { gotoMock } from "./mock-page";

// M3 in the browser, as Settings shows it (Settings redesign SPEC §4.5,
// §4.6): Access to your novel connects apps, keeps them read only until the
// writer lets one write, through a dialog, and only once it is connected;
// Activity says what they asked for, in words, never the writer's text.
// Runs against the mocked IPC: Claude Code, Claude Desktop and Codex are
// found, OpenCode is not, and the log holds a read, a preview and a refusal.

const rail = (page: Page) =>
  page.getByRole("region", { name: "Settings" }).getByRole("navigation", { name: "Settings sections" });

async function openPage(page: Page, name: "Access to your novel" | "Activity") {
  await page.goto("/?mock=tauri");
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  await rail(page).getByRole("button", { name, exact: true }).click();
  return page.getByRole("region", { name: "Settings" });
}

async function mcpClients(page: Page) {
  return page.evaluate(() => window.__VERSORIUM_MOCK__.mcpClients.map((c) => ({ ...c })));
}

/** An app's row: its header button, named "{app}, {status}". */
const header = (page: Page, app: string) => page.getByRole("button", { name: new RegExp(`^${app}, `) });
const panel = (page: Page, id: string) => page.locator(`#access-${id}-panel`);

test("Access starts read only, and keeps the warning for when writing is on", async ({ page }) => {
  const settings = await openPage(page, "Access to your novel");
  await expect(settings.getByText("No app can change your manuscript.")).toBeVisible();
  for (const app of ["Claude Code", "Claude Desktop", "Codex"]) {
    await expect(header(page, app)).toHaveAccessibleName(`${app}, Not set up`);
  }
  // OpenCode was not found: it waits behind a disclosure, still reachable.
  await expect(settings.getByRole("button", { name: "Not found on this computer (1)" })).toBeVisible();
  await expect(header(page, "OpenCode")).toBeHidden();

  // Nothing about snapshots before anything can write.
  await expect(settings.getByText(/saves a snapshot/)).toHaveCount(0);

  await settings.getByRole("button", { name: "Advanced" }).click();
  await expect(settings.getByText("/mock/bin/versorium mcp", { exact: true })).toBeVisible();
  await expect(settings.getByText("Nothing listens on the network unless HTTP is on.")).toBeVisible();
  expect((await mcpClients(page)).every((c) => !c.writeAllowed)).toBe(true);
});

test("connecting an app writes its config and asks for a restart", async ({ page }) => {
  await openPage(page, "Access to your novel");
  await page.getByRole("button", { name: "Connect", exact: true }).nth(2).click();
  await expect(header(page, "Codex")).toHaveAccessibleName("Codex, Connected · read only");
  await expect(page.getByText("Restart Codex for the change to take effect.")).toBeVisible();
  await expect.poll(async () => (await mcpClients(page)).find((c) => c.id === "codex")?.installed).toBe(true);
});

test("an app whose config cannot be written says so and stays as it was", async ({ page }) => {
  const settings = await openPage(page, "Access to your novel");
  await settings.getByRole("button", { name: "Not found on this computer (1)" }).click();
  await settings.getByRole("button", { name: "Connect anyway" }).click();
  await expect(settings.getByRole("alert")).toContainText("Versorium could not write that client's config file.");
  await expect(header(page, "OpenCode")).toHaveAccessibleName("OpenCode, Not found on this computer");
  expect((await mcpClients(page)).find((c) => c.id === "opencode")?.installed).toBe(false);
});

test("writing needs a connection, a dialog and a deliberate choice", async ({ page }) => {
  const settings = await openPage(page, "Access to your novel");
  await header(page, "Claude Code").click();
  const allow = panel(page, "claude-code").getByRole("button", { name: "Allow writing…" });

  // 1. Not connected: no grant to make.
  await expect(allow).toBeDisabled();
  await expect(allow).toHaveAccessibleDescription("Connect Claude Code first.");

  // 2. Connected.
  await settings.locator(".v-expander").filter({ has: header(page, "Claude Code") }).getByRole("button", { name: "Connect" }).click();
  await expect(header(page, "Claude Code")).toHaveAccessibleName("Claude Code, Connected · read only");

  // 3. The dialog: an alert, read with the product spec's sentence, starting
  //    on the answer that keeps it read only.
  await allow.click();
  const dialog = page.getByRole("alertdialog", { name: "Let Claude Code change your manuscript?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(
    "Write lets the AI change your manuscript. Versorium will snapshot Git first. You can roll back. The model can still delete text if you allow the edit.",
  );
  await expect(dialog.getByRole("button", { name: "Keep read only" })).toBeFocused();
  await expect(dialog.getByText(/bringing it back is done with Git, outside Versorium/)).toBeVisible();

  // 4. Escape keeps it read only.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect((await mcpClients(page)).find((c) => c.id === "claude-code")?.writeAllowed).toBe(false);

  // 5. A deliberate yes.
  await allow.click();
  await dialog.getByRole("button", { name: "Let Claude Code write" }).click();
  await expect.poll(async () => (await mcpClients(page)).find((c) => c.id === "claude-code")?.writeAllowed).toBe(true);
  await expect(settings.getByText("1 app can change your manuscript: Claude Code.")).toBeVisible();
  await expect(header(page, "Claude Code")).toHaveAccessibleName("Claude Code, Connected · can change your manuscript");
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Claude Code can now change your manuscript.");
  // Focus is handed to what undoes it, which took the button's place.
  await expect(panel(page, "claude-code").getByRole("button", { name: "Make read only" })).toBeFocused();
  expect((await mcpClients(page)).find((c) => c.id === "codex")?.writeAllowed).toBe(false);
});

test("Make all read only takes every grant back at once, a left-over one included", async ({ page }) => {
  await gotoMock(page);
  await page.evaluate(() => {
    for (const c of window.__VERSORIUM_MOCK__.mcpClients) {
      if (c.id !== "opencode") Object.assign(c, { installed: true, writeAllowed: true });
    }
    // A grant an older build left on an app that is not connected.
    const opencode = window.__VERSORIUM_MOCK__.mcpClients.find((c) => c.id === "opencode");
    if (opencode) opencode.writeAllowed = true;
  });
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  await rail(page).getByRole("button", { name: "Access to your novel", exact: true }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await expect(settings.getByText(/^4 apps can change your manuscript/)).toBeVisible();
  // Not found and not connected, but it may write: it is listed, and says so.
  await expect(header(page, "OpenCode")).toHaveAccessibleName("OpenCode, Not set up · writing still allowed");

  await settings.getByRole("button", { name: "Make all read only" }).click();
  await expect(settings.getByText("No app can change your manuscript.")).toBeVisible();
  await expect.poll(async () => (await mcpClients(page)).some((c) => c.writeAllowed)).toBe(false);
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Every app is read only now.");
});

test("disconnecting takes the grant with it", async ({ page }) => {
  await gotoMock(page);
  await page.evaluate(() => {
    const c = window.__VERSORIUM_MOCK__.mcpClients.find((x) => x.id === "codex");
    if (c) Object.assign(c, { installed: true, writeAllowed: true });
  });
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  await rail(page).getByRole("button", { name: "Access to your novel", exact: true }).click();
  await header(page, "Codex").click();
  await panel(page, "codex").getByRole("button", { name: "Disconnect" }).click();
  await expect.poll(async () => (await mcpClients(page)).find((c) => c.id === "codex")?.writeAllowed).toBe(false);
  await expect(header(page, "Codex")).toHaveAccessibleName("Codex, Not set up");
});

test("the backend refuses a grant for an app that is not connected", async ({ page }) => {
  await gotoMock(page);
  const refusal = await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("mcp_set_write", { client: "codex", allowed: true }).then(
      () => "granted",
      (e: unknown) => String(e),
    ),
  );
  expect(refusal).toBe("mcp_client_not_connected");
  expect((await mcpClients(page)).find((c) => c.id === "codex")?.writeAllowed).toBe(false);
});

test("Activity shows requests in words and never the text", async ({ page }) => {
  const settings = await openPage(page, "Activity");
  await expect(settings.getByText(/never records your text/)).toBeVisible();
  const rows = settings.locator(".v-activity-row");
  await expect(rows).toHaveCount(3);
  const codex = rows.filter({ hasText: "Codex" });
  await expect(codex).toContainText("Replace a chapter's text");
  await expect(codex).toContainText("Refused: Codex can only read");
  // A preview is not a change, and never reads as one.
  const desktop = rows.filter({ hasText: "Claude Desktop" });
  await expect(desktop).toContainText("Preview only, nothing changed");
  await expect(desktop).not.toContainText("Done");
  // The technical line is the log as written: tool names, paths and counts.
  await expect(rows.filter({ hasText: "Claude Code" }).getByText("read_document · manuscript/ch-01-the-long-winter.md")).toBeVisible();
});

test("Activity shows a hundred requests at a time", async ({ page }) => {
  await gotoMock(page);
  await page.evaluate(() => {
    const log = window.__VERSORIUM_MOCK__.mcpLog;
    for (let i = 0; i < 150; i += 1) {
      log.push({ ts: 1_759_000_100_000 + i, client: "claude-code", tool: "search", scope: "read", outcome: "ok", detail: `${i} hits`, format: 2 });
    }
  });
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  await rail(page).getByRole("button", { name: "Activity", exact: true }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await expect(settings.locator(".v-activity-row")).toHaveCount(100);
  await expect(settings.getByText("Showing 100 of 153")).toBeVisible();
  await settings.getByRole("button", { name: "Show more" }).click();
  await expect(settings.locator(".v-activity-row")).toHaveCount(153);
  await expect(settings.getByRole("button", { name: "Show more" })).toHaveCount(0);
  // Newest first.
  await expect(settings.locator(".v-activity-row").first()).toContainText("search · 149 hits");
});

test("Activity filters by app, and a refused request links to the app", async ({ page }) => {
  const settings = await openPage(page, "Activity");
  await settings.getByRole("combobox", { name: "App" }).selectOption("codex");
  await expect(settings.locator(".v-activity-row")).toHaveCount(1);
  await expect(settings.getByText("Showing 1 of 1")).toBeVisible();
  await settings.getByRole("combobox", { name: "App" }).selectOption("all");
  await settings.getByRole("combobox", { name: "Result" }).selectOption("preview");
  await expect(settings.locator(".v-activity-row")).toHaveCount(1);
  await expect(settings.locator(".v-activity-row")).toContainText("Claude Desktop");

  await settings.getByRole("combobox", { name: "Result" }).selectOption("all");
  await settings.getByRole("button", { name: "Change access ›" }).click();
  await expect(rail(page).getByRole("button", { name: "Access to your novel", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(header(page, "Codex")).toHaveAttribute("aria-expanded", "true");
  await expect(header(page, "Codex")).toBeFocused();

  // And back: an app's own "All activity ›" shows that app only.
  await panel(page, "codex").getByRole("button", { name: "All activity ›" }).click();
  await expect(settings.getByRole("combobox", { name: "App" })).toHaveValue("codex");
  await expect(settings.locator(".v-activity-row")).toHaveCount(1);
});

/** Apps set up before Settings opens, as `{ id: [installed, writeAllowed] }`. */
async function openAccessWith(page: Page, apps: Record<string, [boolean, boolean]>) {
  await gotoMock(page);
  await page.evaluate((state) => {
    for (const c of window.__VERSORIUM_MOCK__.mcpClients) {
      const set = state[c.id];
      if (set) Object.assign(c, { installed: set[0], writeAllowed: set[1] });
    }
  }, apps);
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  await rail(page).getByRole("button", { name: "Access to your novel", exact: true }).click();
  return page.getByRole("region", { name: "Settings" });
}

/** The dot beside an app's status: its colour always comes with the words. */
const dot = (page: Page, app: string) => header(page, app).locator(".v-status-dot");

test("Make read only takes one app's access back at once, says so, and offers it again", async ({ page }) => {
  const settings = await openAccessWith(page, { "claude-code": [true, true] });
  await expect(settings.getByText("1 app can change your manuscript: Claude Code.")).toBeVisible();
  await header(page, "Claude Code").click();
  await panel(page, "claude-code").getByRole("button", { name: "Make read only" }).click();

  // The safe direction: no dialog, and Rust holds it at once.
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect.poll(async () => (await mcpClients(page)).find((c) => c.id === "claude-code")?.writeAllowed).toBe(false);
  await expect(header(page, "Claude Code")).toHaveAccessibleName("Claude Code, Connected · read only");
  await expect(settings.getByText("No app can change your manuscript.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText("Claude Code is read only now.");
  // The button that grants it again took its place, and focus with it.
  await expect(panel(page, "claude-code").getByRole("button", { name: "Allow writing…" })).toBeFocused();
});

test("the warning colour is only where an app can write", async ({ page }) => {
  await openAccessWith(page, { "claude-code": [true, true], codex: [true, false] });
  await expect(dot(page, "Claude Code")).toHaveAttribute("data-tone", "warn");
  await expect(dot(page, "Codex")).toHaveAttribute("data-tone", "ok");
  await expect(dot(page, "Claude Desktop")).toHaveAttribute("data-tone", "mute");
});

test("focus goes on to what took the pressed button's place", async ({ page }) => {
  const settings = await openAccessWith(page, { "claude-code": [true, true] });

  // Connect goes from the header's side: focus goes to the app's row, opened.
  await settings.locator(".v-expander").filter({ has: header(page, "Codex") }).getByRole("button", { name: "Connect" }).click();
  await expect(header(page, "Codex")).toBeFocused();
  await expect(header(page, "Codex")).toHaveAttribute("aria-expanded", "true");

  // Disconnect goes with the connection: focus goes to Connect, which is back.
  await panel(page, "codex").getByRole("button", { name: "Disconnect" }).click();
  await expect(settings.locator(".v-expander").filter({ has: header(page, "Codex") }).getByRole("button", { name: "Connect" })).toBeFocused();

  // Make all read only goes with the warning: focus goes to the line that says so.
  await settings.getByRole("button", { name: "Make all read only" }).click();
  await expect(settings.getByText("No app can change your manuscript.")).toBeFocused();
});

test("each app's row shows its own recent requests, and only its own", async ({ page }) => {
  await openAccessWith(page, {});
  await header(page, "Codex").click();
  const codex = panel(page, "codex");
  await expect(codex.getByRole("listitem")).toHaveCount(1);
  await expect(codex.getByRole("listitem")).toContainText("Replace a chapter's text · Refused: Codex can only read");
  await expect(codex).not.toContainText("Change text in a chapter");

  await header(page, "Claude Desktop").click();
  const desktop = panel(page, "claude-desktop");
  await expect(desktop.getByRole("listitem")).toHaveCount(1);
  await expect(desktop.getByRole("listitem")).toContainText("Change text in a chapter · Preview only, nothing changed");
});

test("Activity filters by kind, names apps that connect by address, and dates what is not today", async ({ page }) => {
  await gotoMock(page);
  await page.evaluate(() => {
    // An app over HTTP, today.
    window.__VERSORIUM_MOCK__.mcpLog.push({
      ts: Date.now(), client: "unknown", tool: "search", scope: "read", outcome: "ok", detail: "3 hits", format: 2,
    });
  });
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  await rail(page).getByRole("button", { name: "Activity", exact: true }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  const rows = settings.locator(".v-activity-row");
  await expect(rows).toHaveCount(4);

  const kind = settings.getByRole("combobox", { name: "Kind" });
  await kind.selectOption({ label: "Changes" });
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "Read a chapter" })).toHaveCount(0);
  await kind.selectOption({ label: "Reading" });
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "Replace a chapter's text" })).toHaveCount(0);
  await kind.selectOption({ label: "All" });

  const app = settings.getByRole("combobox", { name: "App" });
  await app.selectOption({ label: "An app connected by address" });
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("An app connected by address · Search the novel");
  // Today's request says its time; the others, from another day, their date too.
  // (Chrome writes "Sep 27, 2:07 PM", WebKit "Sep 27 at 2:07 PM".)
  await expect(rows.first().locator(":scope > span")).toHaveText(/^\d{1,2}:\d{2}\s?[AP]M$/);
  await app.selectOption("codex");
  await expect(rows.first().locator(":scope > span")).toHaveText(/^[A-Z][a-z]{2} \d{1,2}\b.*\d{1,2}:\d{2}\s?[AP]M$/);
});

test("Activity's Check again reads the log again", async ({ page }) => {
  const settings = await openPage(page, "Activity");
  const rows = settings.locator(".v-activity-row");
  await expect(rows).toHaveCount(3);
  await page.evaluate(() => {
    window.__VERSORIUM_MOCK__.mcpLog.push({
      ts: 1_759_000_090_000, client: "claude-code", tool: "git_log", scope: "read", outcome: "ok", detail: "", format: 2,
    });
  });
  await settings.getByRole("button", { name: "Check again" }).click();
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText("List the snapshots");
});

test("a change logged before previews were told apart is not called done", async ({ page }) => {
  await gotoMock(page);
  await page.evaluate(() => {
    // A line as an older build wrote it: no format, and a preview logged ok.
    window.__VERSORIUM_MOCK__.mcpLog.push({
      ts: 1_759_000_095_000, client: "claude-desktop", tool: "write_document", scope: "write", outcome: "ok",
      detail: "manuscript/ch-01-the-long-winter.md · 980 chars", format: 0,
    });
  });
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  await rail(page).getByRole("button", { name: "Activity", exact: true }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  const old = settings.locator(".v-activity-row").first();
  await expect(old).toContainText("Done, or only a preview: logged before Versorium told them apart");
  // It is listed for a writer looking for either, never as a plain Done.
  await settings.getByRole("combobox", { name: "Result" }).selectOption("preview");
  await expect(settings.locator(".v-activity-row")).toHaveCount(2);
  await settings.getByRole("combobox", { name: "Result" }).selectOption("done");
  await expect(settings.locator(".v-activity-row").filter({ hasText: "980 chars" })).toHaveCount(1);
});

test("HTTP is off until asked for, then says where and how", async ({ page }) => {
  const settings = await openPage(page, "Access to your novel");
  await settings.getByRole("button", { name: "Advanced" }).click();
  await expect(settings.getByText(/Apps reach Versorium by starting it/)).toBeVisible();
  const toggle = settings.getByRole("checkbox", { name: "Serve over HTTP too", exact: true });
  await expect(toggle).not.toBeChecked();
  await expect(settings.getByText("Apps that connect by address can only read: writing can't be allowed for them.")).toBeVisible();

  await toggle.check();
  // What an app needs, and where the token is — never the token itself.
  await expect(settings.getByText("http://127.0.0.1:52341/mcp")).toBeVisible();
  await expect(settings.getByText(/mcp-http\.json/)).toBeVisible();
  await expect(toggle).toHaveAccessibleDescription(/only you can open/);

  // Turning it off cannot retract a listener mid-request, and says so.
  await toggle.uncheck();
  await expect(settings.getByText(/Apps reach Versorium by starting it/)).toBeVisible();
});

test("Access and Activity are translated", async ({ page }) => {
  await page.goto("/?mock=tauri");
  await page.getByRole("contentinfo").getByRole("button", { name: "ES", exact: true }).click();
  await page.getByRole("banner").getByRole("button", { name: "Ajustes" }).click();
  const settings = page.getByRole("region", { name: "Ajustes" });
  const nav = settings.getByRole("navigation", { name: "Secciones de ajustes" });
  await nav.getByRole("button", { name: "Acceso a tu novela", exact: true }).click();
  await expect(settings.getByText("Ninguna app puede cambiar tu manuscrito.")).toBeVisible();
  await expect(settings.getByRole("button", { name: "Conectar", exact: true }).first()).toBeVisible();
  await settings.getByRole("button", { name: /^Claude Code, / }).click();
  await expect(settings.getByRole("button", { name: "Permitir escribir…" }).first()).toBeVisible();

  await nav.getByRole("button", { name: "Actividad", exact: true }).click();
  await expect(settings.getByText("Rechazado: Codex solo puede leer")).toBeVisible();
  await expect(settings.getByText("Solo vista previa, no cambió nada")).toBeVisible();
});
