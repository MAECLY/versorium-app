import { expect, test, type Page } from "@playwright/test";

// M3 DoD in the browser: the MCP panel connects clients, the write grant is
// opt-in behind its warning, and the tool log shows what agents did.
// Runs against the mocked IPC (tests/e2e/mock-tauri.ts).

/** Scoped to the MCP landmark: "Claude Code" also names an Agents card. */
async function openMcpPanel(page: Page) {
  await page.goto("/?mock=tauri");
  await page.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("region", { name: "Settings" });
  await settings.getByRole("button", { name: "Assistants" }).click();
  return { settings, mcp: settings.getByRole("region", { name: "MCP" }) };
}

async function mcpClients(page: Page) {
  return page.evaluate(() => window.__VERSORIUM_MOCK__.mcpClients.map((c) => ({ ...c })));
}

test("the panel states it is local and read-only before anything is granted", async ({ page }) => {
  const { mcp } = await openMcpPanel(page);
  await expect(mcp.getByText("A local server on this machine")).toBeVisible();
  await expect(mcp.getByText("Nothing listens on the network.")).toBeVisible();
  await expect(mcp.getByText("/mock/bin/versorium mcp")).toBeVisible();

  // The warning has to be readable before opting in, not after.
  await expect(mcp.getByText("Write lets the AI change your manuscript.")).toBeVisible();

  for (const name of ["Claude Code", "Claude Desktop", "Codex", "OpenCode"]) {
    await expect(mcp.getByText(name, { exact: true })).toBeVisible();
  }
  expect((await mcpClients(page)).every((c) => !c.writeAllowed)).toBe(true);
});

test("connecting a client writes its config and asks for a restart", async ({ page }) => {
  const { mcp } = await openMcpPanel(page);
  const codex = mcp.getByRole("listitem").filter({ hasText: "Codex" });

  await expect(codex.getByText("Not connected")).toBeVisible();
  await codex.getByRole("button", { name: "Connect" }).click();

  await expect(codex.getByText("Connected", { exact: true })).toBeVisible();
  await expect(codex.getByRole("button", { name: "Disconnect" })).toBeVisible();
  await expect(codex.getByText("Restart Codex for the change to take effect.")).toBeVisible();
  await expect.poll(async () => (await mcpClients(page)).find((c) => c.id === "codex")?.installed).toBe(true);
});

test("a client whose config cannot be written says so and stays disconnected", async ({ page }) => {
  const { settings, mcp } = await openMcpPanel(page);
  const opencode = mcp.getByRole("listitem").filter({ hasText: "OpenCode" });

  await opencode.getByRole("button", { name: "Connect" }).click();
  await expect(settings.getByRole("alert")).toContainText(
    "Versorium could not write that client's config file.",
  );
  await expect(opencode.getByText("Not connected")).toBeVisible();
  expect((await mcpClients(page)).find((c) => c.id === "opencode")?.installed).toBe(false);
});

test("write is granted per client and disconnecting takes the grant with it", async ({ page }) => {
  const { mcp } = await openMcpPanel(page);
  const claude = mcp.getByRole("listitem").filter({ hasText: "Claude Code" });

  await claude.getByRole("checkbox", { name: "Allow write" }).check();
  await expect.poll(async () => (await mcpClients(page)).find((c) => c.id === "claude-code")?.writeAllowed).toBe(true);
  // The grant must not leak to another client.
  expect((await mcpClients(page)).find((c) => c.id === "codex")?.writeAllowed).toBe(false);

  await claude.getByRole("button", { name: "Connect" }).click();
  await claude.getByRole("button", { name: "Disconnect" }).click();
  await expect
    .poll(async () => (await mcpClients(page)).find((c) => c.id === "claude-code")?.writeAllowed)
    .toBe(false);
});

test("the tool log shows what agents did and promises to keep prose out", async ({ page }) => {
  const { mcp } = await openMcpPanel(page);
  const log = mcp.getByRole("list", { name: "Tool log" });

  await expect(log.getByText("read_document")).toBeVisible();
  await expect(log.getByText("manuscript/ch-01-the-long-winter.md")).toBeVisible();
  await expect(log.getByText("write_document")).toBeVisible();
  await expect(log.getByText("denied", { exact: true })).toBeVisible();
  await expect(mcp.getByText("Never your manuscript text.")).toBeVisible();
});

test("the MCP panel is translated", async ({ page }) => {
  await page.goto("/?mock=tauri");
  await page.getByRole("banner").getByRole("button", { name: "ES", exact: true }).click();
  await page.getByRole("button", { name: "Ajustes" }).click();
  const settings = page.getByRole("region", { name: "Ajustes" });
  await settings.getByRole("button", { name: "Asistentes" }).click();
  await expect(settings.getByRole("button", { name: "Conectar" }).first()).toBeVisible();
  await expect(settings.getByRole("checkbox", { name: "Permitir escritura" }).first()).toBeVisible();
});
