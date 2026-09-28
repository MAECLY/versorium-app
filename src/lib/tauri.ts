import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

// Tauri command wrappers. All business logic lives in Rust; this is a thin typed edge.

export interface ProjectMeta {
  schema: number;
  title: string;
  /** Standard Manuscript Format puts the surname in every running head. */
  author: string;
  language: string;
  uiLanguage: string;
  defaultChapterPattern: string;
  censorship: string;
  remote: string | null;
}

export interface ChapterMeta {
  id: string;
  title: string;
  status: string;
  words: number;
  file: string;
  mtime: number;
}

export interface Project {
  path: string;
  meta: ProjectMeta;
  chapters: ChapterMeta[];
}

export interface AppInfo {
  version: string;
  os: string;
  family: string;
}

export interface AppSettings {
  uiLocale: string;
  theme: string;
  themeMode: string;
  censorship: boolean;
  githubUpdatesToken: string | null;
  githubNovelToken: string | null;
}

export interface ChapterDoc {
  frontmatter: Record<string, string>;
  body: string;
}

// --- M1: git + ops ---

export interface GitStatus {
  branch: string | null;
  modified: string[];
  staged: string[];
  untracked: string[];
  ahead: number;
  behind: number;
}

export interface GitCommit {
  sha: string;
  short: string;
  author: string;
  time: number;
  message: string;
}

export interface GitBranches {
  current: string | null;
  branches: string[];
}

export interface GitRemote {
  name: string;
  url: string;
}

export interface Op {
  seq: number;
  ts: number;
  author: string;
  kind: "insert" | "delete" | "rollback";
  from: number;
  to: number;
  text: string;
}

// --- M2: agents + rewrite ---

export interface AgentInfo {
  id: string;
  name: string;
  path: string | null;
  version: string | null;
  state: "connected" | "detected" | "missing";
  models: string[] | null;
}

export interface AiApplyArgs {
  path: string;
  file: string;
  /** UTF-16 offsets into the body (editor coordinates), frontmatter excluded. */
  from: number;
  to: number;
  text: string;
  provider: string;
  /** The passage as selected; Rust refuses the write if the file moved on. */
  expected: string;
}

// --- M3: MCP server ---

export type McpClientId = "claude-code" | "claude-desktop" | "codex" | "opencode";

export interface McpClient {
  id: McpClientId;
  name: string;
  /** Absolute path of the client config Versorium would write. */
  configPath: string;
  /** The client itself is installed on this machine. */
  detected: boolean;
  /** Our server entry is present in that config. */
  installed: boolean;
  /** This client may call the write tools. Off by default (spec §7). */
  writeAllowed: boolean;
}

export interface McpStatus {
  /** Absolute path to the versorium binary the clients would spawn. */
  command: string;
  args: string[];
  logPath: string;
  clients: McpClient[];
}

export interface McpLogEntry {
  ts: number;
  client: string;
  tool: string;
  scope: "read" | "write";
  outcome: "ok" | "denied" | "error";
  /** Paths and counts only — never manuscript prose. */
  detail: string;
}

// --- M4: local models ---

export type SlotName = "rewrite" | "chat" | "continuity" | "embeddings" | "dictation";
/** Where a slot's model comes from. `cli` reuses a detected harness (M2). */
export type SlotKind = "none" | "builtin" | "ollama" | "cli";

export interface SlotAssignment {
  kind: SlotKind;
  id: string;
}

export interface Slots {
  rewrite: SlotAssignment;
  chat: SlotAssignment;
  continuity: SlotAssignment;
  embeddings: SlotAssignment;
  dictation: SlotAssignment;
}

/** A catalog entry flattened together with what is on disk right now. */
export interface ModelCard {
  id: string;
  family: string;
  label: string;
  task: "writing" | "embeddings" | "dictation";
  tier: "low" | "mid" | "midPlus" | "high";
  params: string;
  quant: string;
  sizeBytes: number;
  ramHintGB: number;
  ctx: number;
  speed: "fast" | "balanced" | "slow";
  quality: "basic" | "good" | "high";
  badge: string | null;
  uncensored: boolean;
  license: string;
  repo: string;
  state: "missing" | "partial" | "ready" | "corrupt";
  /** Bytes already on disk; 0 unless `state` is `partial`. */
  receivedBytes: number;
  /** The RAM hint fits this machine with 20% headroom. */
  fits: boolean;
}

export interface Hardware {
  totalRamGb: number;
  availableRamGb: number;
  cpuCores: number;
  arch: string;
  os: string;
  gpu: string;
  recommendedTier: string;
}

export interface DownloadProgress {
  id: string;
  received: number;
  total: number;
  done: boolean;
}

export interface OllamaModel {
  name: string;
  sizeBytes: number;
  modified: string;
}

export interface OllamaView {
  /** The daemon answered on 127.0.0.1:11434. */
  running: boolean;
  models: OllamaModel[];
  /** The `ollama` binary exists on this machine. */
  installed: boolean;
}

export interface StudioView {
  host: string;
  port: number;
  enabled: boolean;
}

export interface LocalAiView {
  models: ModelCard[];
  hardware: Hardware;
  slots: Slots;
  progress: DownloadProgress | null;
  ollama: OllamaView;
  studio: StudioView;
  /** Censorship is on, so uncensored models are hidden (spec §6.2). */
  censorship: boolean;
  diskUsedBytes: number;
  modelsDir: string;
}

// --- M5: formats ---

export type ExportFormat = "md" | "docx" | "epub" | "pdf";
export type ImportFormat = "md" | "docx" | "scriv";

export interface ExportResult {
  path: string;
  bytes: number;
  format: ExportFormat;
  /// i18n codes for what this format could not carry.
  warnings: string[];
}

export interface ImportedChapter {
  title: string;
  /** Markdown body, frontmatter excluded. */
  body: string;
  synopsis: string | null;
}

export interface Imported {
  title: string;
  chapters: ImportedChapter[];
  /** What the source held that Versorium could not carry across. */
  warnings: string[];
}

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  uiReady: () => invoke<void>("ui_ready"),
  defaultProjectsDir: () => invoke<string>("default_projects_dir"),
  listProjects: (path: string) => invoke<Project[]>("list_projects", { path }),
  createProject: (path: string, title: string, language: string) =>
    invoke<Project>("create_project", { args: { path, title, language } }),
  openProject: (path: string) => invoke<Project>("open_project", { path }),
  createChapter: (path: string, title: string) => invoke<ChapterMeta>("create_chapter", { path, title }),
  listChapters: (path: string) => invoke<ChapterMeta[]>("list_chapters", { path }),
  readChapter: (path: string, file: string) =>
    invoke<ChapterDoc>("read_chapter", { args: { path, file } }),
  saveChapter: (path: string, file: string, body: string, status?: string) =>
    invoke<ChapterMeta>("save_chapter", { path, file, body, status }),
  getSettings: () => invoke<AppSettings>("get_settings"),
  setSettings: (patch: Partial<AppSettings>) => invoke<AppSettings>("set_settings", { patch }),
  pickDirectory: () => open({ directory: true, multiple: false }),

  // --- M1: git + ops ---
  gitStatus: (path: string) => invoke<GitStatus>("git_status", { path }),
  gitLog: (path: string, limit?: number) => invoke<GitCommit[]>("git_log", { path, limit }),
  gitDiff: (path: string) => invoke<string>("git_diff", { path }),
  gitCommit: (path: string, message: string) => invoke<string>("git_commit", { path, message }),
  gitAutoCheckpoint: (path: string) => invoke<string | null>("git_auto_checkpoint", { path }),
  gitBranches: (path: string) => invoke<GitBranches>("git_branches", { path }),
  gitBranchCreate: (path: string, name: string) => invoke<string>("git_branch_create", { path, name }),
  gitCheckoutFile: (path: string, file: string, sha?: string) =>
    invoke<void>("git_checkout_file", { path, file, sha }),
  gitRemotes: (path: string) => invoke<GitRemote[]>("git_remotes", { path }),
  gitRemoteAdd: (path: string, name: string, url: string) =>
    invoke<void>("git_remote_add", { path, name, url }),
  gitRemoteRemove: (path: string, name: string) => invoke<void>("git_remote_remove", { path, name }),
  githubMe: (token: string) => invoke<string>("github_me", { token }),
  githubOwners: (token: string) => invoke<{ login: string; kind: "user" | "organization" }[]>("github_owners", { token }),
  githubCreateRepo: (token: string, name: string, owner?: string) => invoke<string>("github_create_repo", { token, name, owner }),
  githubListRepos: (token: string) => invoke<{ name: string; private: boolean }[]>("github_list_repos", { token }),
  opsAppend: (path: string, chapter: string, body: string, ops: Op[]) =>
    invoke<Op[]>("ops_append", { args: { path, chapter, body, ops } }),
  opsRecent: (path: string, chapter: string, limit?: number) =>
    invoke<Op[]>("ops_recent", { path, chapter, limit }),
  opsSnapshots: (path: string, chapter: string) => invoke<number[]>("ops_snapshots", { path, chapter }),
  opsRestoreSnapshot: (path: string, chapter: string, seq: number) =>
    invoke<string>("ops_restore_snapshot", { path, chapter, seq }),

  // --- M2: agents + rewrite ---
  agentsDetect: () => invoke<AgentInfo[]>("agents_detect"),
  aiRewrite: (provider: string, text: string) =>
    invoke<string>("ai_rewrite", { provider, text }),
  aiApplyRewrite: (args: AiApplyArgs) => invoke<ChapterMeta>("ai_apply_rewrite", { args }),

  // --- M3: MCP server ---
  mcpStatus: () => invoke<McpStatus>("mcp_status"),
  mcpSetWrite: (client: string, allowed: boolean) =>
    invoke<McpStatus>("mcp_set_write", { client, allowed }),
  mcpInstallClient: (client: string) => invoke<McpStatus>("mcp_install_client", { client }),
  mcpUninstallClient: (client: string) => invoke<McpStatus>("mcp_uninstall_client", { client }),
  mcpLog: (limit?: number) => invoke<McpLogEntry[]>("mcp_log", { limit }),
  mcpSetActiveProject: (path: string | null) => invoke<void>("mcp_set_active_project", { path }),

  // --- M4: local models ---
  modelsView: () => invoke<LocalAiView>("models_view"),
  modelsDownload: (id: string) => invoke<void>("models_download", { id }),
  modelsCancel: (id: string) => invoke<void>("models_cancel", { id }),
  modelsDelete: (id: string) => invoke<void>("models_delete", { id }),
  modelsProgress: () => invoke<DownloadProgress | null>("models_progress"),
  modelsSetSlot: (slot: SlotName, kind: SlotKind, id: string) =>
    invoke<Slots>("models_set_slot", { slot, kind, id }),
  ollamaPull: (name: string) => invoke<void>("ollama_pull", { name }),
  ollamaRemove: (name: string) => invoke<void>("ollama_remove", { name }),
  studioTest: (host: string, port: number) => invoke<boolean>("studio_test", { host, port }),
  studioSave: (host: string, port: number, enabled: boolean) =>
    invoke<StudioView>("studio_save", { host, port, enabled }),

  // --- M5: formats ---
  exportManuscript: (path: string, format: ExportFormat, dest: string) =>
    invoke<ExportResult>("export_manuscript", { path, format, dest }),
  importPreview: (source: string) => invoke<Imported>("import_preview", { source }),
  importApply: (source: string, title: string) =>
    invoke<Project>("import_apply", { source, title }),
  setAuthor: (path: string, author: string) =>
    invoke<ProjectMeta>("set_author", { path, author }),

  /** Where to write an export. Returns null when the user backs out. */
  pickExportTarget: (defaultPath: string, name: string, extension: string) =>
    save({ defaultPath, filters: [{ name, extensions: [extension] }] }),
  /** A manuscript file to import. */
  pickImportFile: () =>
    open({
      multiple: false,
      filters: [{ name: "Manuscript", extensions: ["md", "markdown", "docx"] }],
    }),
  /** A Scrivener project, which is a .scriv bundle directory on macOS. */
  pickImportProject: () => open({ directory: true, multiple: false }),
};

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
