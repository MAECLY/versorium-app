import { t } from "$lib/i18n";
import type { McpClient, McpLogEntry } from "$lib/tauri";

/**
 * Settings → Activity, without the markup: what an app asked for, in words,
 * and how it went. Pure, so the words are tested against Rust's catalogue
 * (tests/unit/mcp-activity.test.ts).
 */

/** The tools `src-tauri/src/mcp/tools.rs` serves: 15 that read, then 8 that write. */
export const TOOLS = [
  "get_app_state",
  "list_projects",
  "open_project",
  "list_documents",
  "read_document",
  "search",
  "assemble_context",
  "history_list",
  "history_blame",
  "diff",
  "git_status",
  "git_log",
  "get_style",
  "codex_search",
  "codex_get",
  "write_document",
  "insert_text",
  "delete_text",
  "replace_text",
  "create_document",
  "codex_upsert",
  "git_commit",
  "delete_document",
] as const;

/** The four clients Versorium can connect; anything else was an app over HTTP. */
export const CLIENTS = ["claude-code", "claude-desktop", "codex", "opencode"] as const;

/**
 * `unsure`: a write logged `ok` before Versorium logged previews apart, so it
 * may have changed nothing. Shown as either, under Done and under Previews.
 */
export type Outcome = "done" | "preview" | "unsure" | "refused" | "failed";
export type Kind = "all" | "read" | "write";
/** What the Result filter offers: `unsure` is not a choice of its own. */
export type ResultFilter = "all" | Exclude<Outcome, "unsure">;

export interface Filters {
  /** A client id, `unknown` for apps over HTTP, or `all`. */
  app: string;
  kind: Kind;
  result: ResultFilter;
}

/** The log format since which a preview is logged `preview` (`mcp::log::FORMAT`). */
export const PREVIEWS_LOGGED = 2;

export const ALL: Filters = { app: "all", kind: "all", result: "all" };

/** The plain words for a tool, or "Use {tool}" for one this build does not know. */
export function actionLabel(tool: string): string {
  return (TOOLS as readonly string[]).includes(tool)
    ? t(`settings.activity.actions.${tool}`)
    : t("settings.activity.actions.unknown", { tool });
}

/**
 * How a request went. A preview is its own outcome: Rust logs a write that
 * only returned its diff as `preview`, so it never reads as Done. A line an
 * older build wrote logged that preview `ok`, so a write it calls `ok` is
 * done or a preview, and says so.
 */
export function outcomeOf(entry: Pick<McpLogEntry, "outcome" | "scope" | "format">): Outcome {
  switch (entry.outcome) {
    case "ok":
      return entry.scope === "write" && (entry.format ?? 0) < PREVIEWS_LOGGED ? "unsure" : "done";
    case "preview":
      return "preview";
    case "denied":
      return "refused";
    default:
      return "failed";
  }
}

export function clientLabel(id: string): string {
  if ((CLIENTS as readonly string[]).includes(id)) return t(`mcp.clients.${id}`);
  if (id === "unknown") return t("settings.activity.unknownClient");
  return id;
}

/** The outcome as the row says it; a refusal names who was refused. */
export function outcomeLabel(entry: McpLogEntry): string {
  const outcome = outcomeOf(entry);
  return outcome === "refused"
    ? t("settings.activity.outcome.refused", { client: clientLabel(entry.client) })
    : t(`settings.activity.outcome.${outcome}`);
}

export function matches(entry: McpLogEntry, filters: Filters): boolean {
  return (
    (filters.app === "all" || entry.client === filters.app) &&
    (filters.kind === "all" || entry.scope === filters.kind) &&
    resultMatches(outcomeOf(entry), filters.result)
  );
}

function resultMatches(outcome: Outcome, wanted: ResultFilter): boolean {
  if (wanted === "all") return true;
  // Done or a preview, the log cannot say which: listed under both.
  if (outcome === "unsure") return wanted === "done" || wanted === "preview";
  return outcome === wanted;
}

/** The clients that may change the manuscript, connected or not (a grant left over). */
export function writers(clients: readonly McpClient[]): McpClient[] {
  return clients.filter((c) => c.writeAllowed);
}
