import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../locales/en/ui.json";
import es from "../../locales/es/ui.json";
import type { McpClient, McpLogEntry } from "$lib/tauri";
import { actionLabel, clientLabel, matches, outcomeLabel, outcomeOf, TOOLS, writers } from "$lib/mcp/activity";

// Settings → Activity says in words what an outside app asked for. The words
// are held to Rust's own tool catalogue, so a tool added there cannot reach the
// page as a raw name without this failing.

/** The tool names `build_catalog` in src-tauri/src/mcp/tools.rs serves, in order. */
function rustTools(): string[] {
  // From the repository root, where vitest runs.
  const source = readFileSync(resolve(process.cwd(), "src-tauri/src/mcp/tools.rs"), "utf8");
  const catalogue = source.slice(source.indexOf("fn build_catalog"), source.indexOf("fn all()"));
  return [...catalogue.matchAll(/def\("([a-z_]+)"/g)].map((m) => m[1]);
}

function lookup(dict: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], dict);
}

const entry = (over: Partial<McpLogEntry> = {}): McpLogEntry => ({
  ts: 1, client: "codex", tool: "read_document", scope: "read", outcome: "ok", detail: "manuscript/ch-01.md", format: 2,
  ...over,
});

describe("the action names", () => {
  it("cover exactly the 23 tools Rust serves, 15 that read and 8 that write", () => {
    expect([...TOOLS]).toEqual(rustTools());
    expect(TOOLS).toHaveLength(23);
  });

  it("exist in English and Spanish for every tool, and for one this build does not know", () => {
    for (const key of [...TOOLS, "unknown"]) {
      for (const [lang, dict] of [["en", en], ["es", es]] as const) {
        const value = lookup(dict, `settings.activity.actions.${key}`);
        expect(typeof value === "string" && value.trim() !== "", `${lang} actions.${key}`).toBe(true);
      }
    }
  });

  it("read as plain words", () => {
    expect(actionLabel("write_document")).toBe("Replace a chapter's text");
    expect(actionLabel("git_commit")).toBe("Save a snapshot");
    expect(actionLabel("teleport")).toBe("Use teleport");
  });
});

describe("the outcome", () => {
  it("keeps a preview apart from a change that happened", () => {
    expect(outcomeOf(entry({ outcome: "ok" }))).toBe("done");
    expect(outcomeOf(entry({ outcome: "preview" }))).toBe("preview");
    expect(outcomeOf(entry({ outcome: "denied" }))).toBe("refused");
    expect(outcomeOf(entry({ outcome: "error" }))).toBe("failed");
    expect(outcomeLabel(entry({ outcome: "preview" }))).toBe("Preview only, nothing changed");
  });

  it("names who was refused", () => {
    expect(outcomeLabel(entry({ outcome: "denied", client: "codex" }))).toBe("Refused: Codex can only read");
  });

  it("does not call a write done when it was logged before previews were told apart", () => {
    // A line an older build wrote has no format, and logged a preview `ok`.
    const old = entry({ tool: "replace_text", scope: "write", outcome: "ok", format: 0 });
    expect(outcomeOf(old)).toBe("unsure");
    expect(outcomeLabel(old)).toBe("Done, or only a preview: logged before Versorium told them apart");
    // A line as Rust reads it from the file: the key is simply missing.
    const { format: _dropped, ...unmarked } = old;
    expect(outcomeOf(unmarked as McpLogEntry)).toBe("unsure");
    // The same line from this build means what it says; a read was never a preview.
    expect(outcomeOf({ ...old, format: 2 })).toBe("done");
    expect(outcomeOf(entry({ scope: "read", outcome: "ok", format: 0 }))).toBe("done");
    // Listed when the writer looks for either, and for nothing else.
    const all = { app: "all", kind: "all", result: "all" } as const;
    expect(matches(old, { ...all, result: "done" })).toBe(true);
    expect(matches(old, { ...all, result: "preview" })).toBe(true);
    expect(matches(old, { ...all, result: "refused" })).toBe(false);
    expect(matches(old, { ...all, result: "failed" })).toBe(false);
  });

  it("says it in Spanish too", () => {
    for (const key of ["settings.activity.outcome.unsure"]) {
      for (const [lang, dict] of [["en", en], ["es", es]] as const) {
        const value = lookup(dict, key);
        expect(typeof value === "string" && value.trim() !== "", `${lang} ${key}`).toBe(true);
      }
    }
  });
});

it("an app over HTTP is an app connected by address", () => {
  expect(clientLabel("unknown")).toBe("An app connected by address");
  expect(clientLabel("claude-desktop")).toBe("Claude Desktop");
});

it("filters by app, kind and result together", () => {
  const log = [
    entry({ client: "codex", scope: "write", outcome: "denied" }),
    entry({ client: "claude-desktop", scope: "write", outcome: "preview" }),
    entry({ client: "claude-code", scope: "read", outcome: "ok" }),
  ];
  const all = { app: "all", kind: "all", result: "all" } as const;
  expect(log.filter((e) => matches(e, all))).toHaveLength(3);
  expect(log.filter((e) => matches(e, { ...all, app: "codex" })).map((e) => e.client)).toEqual(["codex"]);
  expect(log.filter((e) => matches(e, { ...all, kind: "write" }))).toHaveLength(2);
  expect(log.filter((e) => matches(e, { ...all, result: "preview" })).map((e) => e.client)).toEqual(["claude-desktop"]);
  expect(log.filter((e) => matches(e, { app: "codex", kind: "read", result: "all" }))).toHaveLength(0);
});

it("the writers are every app allowed to write, connected or not", () => {
  const client = (id: McpClient["id"], installed: boolean, writeAllowed: boolean): McpClient => ({
    id, name: id, configPath: "", detected: true, installed, writeAllowed,
  });
  expect(
    writers([client("codex", true, true), client("opencode", false, true), client("claude-code", true, false)]).map((c) => c.id),
  ).toEqual(["codex", "opencode"]);
});
