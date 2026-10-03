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
  /** Chapter ids in reading order, when it differs from their numbering. */
  chapterOrder: string[];
  /** Open an export with a title page. */
  exportCover: boolean;
  /** Close it with the project's own record and a line of thanks. */
  exportColophon: boolean;
}

/**
 * Wording that ends up inside an exported file.
 *
 * Supplied by the frontend because Rust has no dictionary, and written in the
 * manuscript's language rather than the app's: it is read by whoever opens the
 * book, not by whoever exported it.
 */
export type ExportLabels = Record<string, string>;

/** Mirrors `commands::chapters::STATUSES`; anything else is refused by Rust. */
export type ChapterStatus = "draft" | "revised" | "final";

export interface ChapterMeta {
  id: string;
  title: string;
  status: ChapterStatus;
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
  /** Id of the catalogue entry the editor renders in. */
  editorFont: string;
  focusMode: boolean;
  typewriter: boolean;
  /** False until the first run is done or skipped. */
  onboarded: boolean;
  /** Folders archives are written to; empty means backups are off. */
  backupDirs: string[];
  backupKeep: number;
  /** Two author identities; exports use whichever `authorProfile` names. */
  authorProfiles: AuthorProfiles;
  /** `work` or `hobby`. */
  authorProfile: string;
  /** Settings → Editor. */
  editor: EditorSettings;
}

/**
 * Mirrors `EditorSettings` in src-tauri/src/commands/settings.rs. The scales
 * are named steps; `src/lib/editor/preferences.ts` says what each renders as.
 */
export interface EditorSettings {
  spellcheck: boolean;
  textSize: "small" | "medium" | "large";
  lineSpacing: "compact" | "comfortable" | "airy";
  textWidth: "narrow" | "medium" | "wide";
  lineNumbers: boolean;
  /** The band behind the paragraph that holds the caret. */
  activeLine: boolean;
  /** `next` moves focus to the next control; `indent` indents the paragraph. */
  tabKey: "next" | "indent";
}

/**
 * What `set_settings` accepts. The editor block is patched key by key in Rust,
 * so a change to one preference sends that preference alone.
 */
export type SettingsPatch = Partial<Omit<AppSettings, "editor">> & { editor?: Partial<EditorSettings> };

/**
 * One author identity, as it will appear inside an exported file.
 *
 * Every field lands somewhere real — no field here is stored only to be looked
 * at, and none of them travels anywhere but into the file being written.
 */
export interface AuthorProfile {
  /** The byline. Creator in every format that has one. */
  name: string;
  /** "Le Guin, Ursula K." — EPUB `file-as`. Guessed when blank. */
  sortAs: string;
  /** A MARC relator: `aut`, `edt`, `trl`. EPUB only. */
  role: string;
  /** `dc:publisher` in EPUB, `Company` in DOCX. */
  organization: string;
  /** The copyright line. `dc:rights` in EPUB, `/Subject` in PDF. */
  rights: string;
}

export interface AuthorProfiles {
  work: AuthorProfile;
  hobby: AuthorProfile;
}

/** The relator codes offered. A free-text role produces codes nothing reads. */
export const AUTHOR_ROLES = ["aut", "edt", "trl"] as const;

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

/** MCP over HTTP as well as stdio. The token is absent on purpose: it lives in
 *  a file only the user can read. */
export interface McpHttpStatus {
  enabled: boolean;
  url: string | null;
  endpointFile: string | null;
}

export type SecretSlot = "updates" | "novel";

/** Which credentials exist. Never their values: the token only travels inward. */
export interface SecretsStatus {
  store: { usable: boolean; reason: string | null };
  updates: boolean;
  novel: boolean;
}

export interface BackupDestination {
  /** A provider slug (`icloud`, `dropbox`, …), `disk`, or `folder`. */
  kind: string;
  path: string;
  /** The folder is there right now; an absent one is still offered, and says so. */
  available: boolean;
  /** Which physical disk this is on. Null where the platform will not say. */
  volume: string | null;
  /** A provider carries the copy off this machine; a second disk does not. */
  offsite: boolean;
}

export interface BackupArchive {
  path: string;
  name: string;
  bytes: number;
  /** Unix seconds from the file's own mtime — not what to show a writer. */
  modified: number;
  /** When the backup was asked for, read out of the name. Show this one. */
  stamped: number | null;
  /** Which state of the novel it holds. Null for one written before this existed. */
  print: string | null;
  /** Of the archive as the destination handed it back. Null when only listed. */
  sha256: string | null;
}

/** Grades the current choice against the three-copy rule. Never scored. */
export interface BackupCoverage {
  /** Counting the novel itself, as the rule does. */
  copies: number;
  /** Distinct disks. Null when one could not be identified, never guessed. */
  media: number | null;
  offsite: boolean;
  /** Destinations sharing a disk with the novel: a copy that dies with it. */
  onTheNovelsDisk: string[];
}

/** What happened at one destination. A missing disk is not a failure. */
export type BackupOutcome =
  | { state: "ok"; path: string; archive: BackupArchive; pruned: number }
  | { state: "copy"; path: string; archive: BackupArchive; pruned: number }
  | { state: "unchanged"; path: string; archive: BackupArchive; pruned: number }
  | {
      state: "repaired";
      path: string;
      archive: BackupArchive;
      pruned: number;
      reason: string;
      damaged: string;
    }
  | { state: "unavailable"; path: string }
  | { state: "failed"; path: string; reason: string };

/** How far along an install is. The phases are the real steps, not an
 *  animation: downloading has byte counts, verifying is the two signature
 *  checks, installing hands the bytes to the platform, ready means restart. */
export interface InstallProgress {
  phase: "downloading" | "verifying" | "installing" | "ready" | "failed";
  received: number;
  /** Absent when the server sends no length; show indeterminate, not zero. */
  total: number | null;
  error: string | null;
}

/** Which device llama.cpp will use. Asked for separately from the model cards:
 *  the backend is a property of the machine, not of a model. */
export interface LlamaBackendState {
  /** `warming` while llama.cpp starts — on Apple Silicon that is ~15s of
   *  Metal shader compilation, long enough to need saying. */
  state: "warming" | "ready" | "failed";
  device: { label: string; deviceType: string; memFreeMb: number; memTotalMb: number } | null;
  /** False on the Windows and Linux builds today, so CPU speeds there are
   *  expected rather than a fault. */
  gpuOffload: boolean;
}

/** Text produced by the running generation. Polled, like a download's bytes. */
export interface LlamaProgress {
  model: string;
  text: string;
  tokens: number;
  done: boolean;
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

export type ExportFormat = "md" | "docx" | "epub" | "pdf" | "scriv";
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

// --- M6: updates ---

export interface AvailableUpdate {
  version: string;
  notes: string;
  date: string | null;
}

export interface UpdateStatus {
  currentVersion: string;
  available: AvailableUpdate | null;
  channel: "stable" | "beta";
  automatic: boolean;
  /**
   * An updates token is saved. Optional (spec §11, amended 2026-10-03):
   * without one the check runs anonymously, it is not skipped.
   */
  tokenSet: boolean;
  checking: boolean;
  /** A check has finished since launch or since the channel changed. */
  checked: boolean;
  /** An i18n code, never prose. */
  lastError: string | null;
  /** When GitHub's rate limit lifts, in Unix seconds; only with a rate-limit code. */
  resetsAt: number | null;
}

// --- M7: polish ---

/**
 * A recorded panic. Rust scrubs every field before it reaches disk, so nothing
 * here carries manuscript text or a project path (spec §12).
 */
export interface CrashEntry {
  id: string;
  ts: number;
  version: string;
  os: string;
  arch: string;
  kind: string;
  message: string;
  stack: string[];
}

export interface ContinuityFinding {
  kind: string;
  detail: string;
  chapter: string | null;
}

export interface ContinuityReport {
  ran: boolean;
  /** An i18n code explaining why it did not run. */
  reason: string | null;
  findings: ContinuityFinding[];
}

export interface FontEntry {
  id: string;
  family: string;
  role: "body" | "ui" | "mono";
  /** The CSS font-family list to render in. */
  stack: string;
  license: string;
  bundled: boolean;
}

export interface FontCatalog {
  version: number;
  fonts: FontEntry[];
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
  setSettings: (patch: SettingsPatch) => invoke<AppSettings>("set_settings", { patch }),
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
  /** `kind` + `id` are a slot assignment: the id names *which* model to use. */
  aiRewrite: (kind: SlotKind, id: string, text: string) =>
    invoke<string>("ai_rewrite", { kind, id, text }),
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

  updateProgress: () => invoke<InstallProgress | null>("update_progress"),
  updateRelaunch: () => invoke<void>("update_relaunch"),

  // --- editing a novel and its chapters ---
  updateProject: (
    path: string,
    title?: string,
    author?: string,
    exportCover?: boolean,
    exportColophon?: boolean,
  ) =>
    invoke<ProjectMeta>("update_project", { path, title, author, exportCover, exportColophon }),
  /** Moves the folder to the system trash; returns what is left. */
  deleteProject: (path: string, parent: string) =>
    invoke<Project[]>("delete_project", { path, parent }),
  updateChapter: (path: string, file: string, title?: string, status?: ChapterStatus) =>
    invoke<ChapterMeta>("update_chapter", { path, file, title, status }),
  /** Snapshots the project first, so this is recoverable from its history. */
  deleteChapter: (path: string, file: string) =>
    invoke<ChapterMeta[]>("delete_chapter", { path, file }),
  /** Put the chapters in this order. Nothing on disk moves. */
  reorderChapters: (path: string, ids: string[]) =>
    invoke<ChapterMeta[]>("reorder_chapters", { path, ids }),

  mcpHttpStatus: () => invoke<McpHttpStatus>("mcp_http_status"),
  mcpSetHttp: (enabled: boolean) => invoke<McpHttpStatus>("mcp_set_http", { enabled }),

  // --- credentials, kept in the OS store; the token never comes back out ---
  secretsStatus: () => invoke<SecretsStatus>("secrets_status"),
  secretsConnect: (slot: SecretSlot, token: string) =>
    invoke<string>("secrets_connect", { slot, token }),
  secretsForget: (slot: SecretSlot) => invoke<void>("secrets_forget", { slot }),

  // --- backup to a synced folder ---
  backupDestinations: () => invoke<BackupDestination[]>("backup_destinations"),
  backupConfigure: (paths: string[], keep: number) =>
    invoke<void>("backup_configure", { paths, keep }),
  /** One outcome per destination; never collapsed into a single result. */
  backupNow: (path: string) => invoke<BackupOutcome[]>("backup_now", { path }),
  backupList: (path: string) => invoke<[string, BackupArchive[]][]>("backup_list", { path }),
  /** Read an archive back and confirm it is complete and extractable. */
  backupVerify: (archive: string) => invoke<string>("backup_verify", { archive }),
  /** What the configured destinations protect this novel against. */
  backupCoverage: (path: string) => invoke<BackupCoverage>("backup_coverage", { path }),
  backupRestore: (archive: string, project: string, label: string) =>
    invoke<string>("backup_restore", { archive, project, label }),

  // --- network git ---
  gitPush: (path: string, remote?: string) => invoke<string>("git_push", { path, remote }),
  gitPull: (path: string, remote?: string) =>
    invoke<{ branch: string; changed: boolean }>("git_pull", { path, remote }),

  // --- the in-process engine ---
  llamaBackend: () => invoke<LlamaBackendState>("llama_backend"),
  llamaProgress: () => invoke<LlamaProgress | null>("llama_progress"),
  llamaCancel: () => invoke<void>("llama_cancel"),
  llamaUnload: () => invoke<void>("llama_unload"),

  // --- M5: formats ---
  exportManuscript: (path: string, format: ExportFormat, dest: string, labels?: ExportLabels) =>
    invoke<ExportResult>("export_manuscript", { path, format, dest, labels }),
  importPreview: (source: string) => invoke<Imported>("import_preview", { source }),
  importApply: (source: string, title: string) =>
    invoke<Project>("import_apply", { source, title }),
  setAuthor: (path: string, author: string) =>
    invoke<ProjectMeta>("set_author", { path, author }),

  // --- M6: updates ---
  updateStatus: () => invoke<UpdateStatus>("update_status"),
  updateCheck: () => invoke<UpdateStatus>("update_check"),
  updateInstall: () => invoke<void>("update_install"),
  updateSkip: (version: string) => invoke<UpdateStatus>("update_skip", { version }),
  updateSetChannel: (channel: "stable" | "beta") =>
    invoke<UpdateStatus>("update_set_channel", { channel }),
  updateSetAutomatic: (automatic: boolean) =>
    invoke<UpdateStatus>("update_set_automatic", { automatic }),

  // --- M7: polish ---
  crashList: (limit?: number) => invoke<CrashEntry[]>("crash_list", { limit }),
  crashReportUrl: (id: string) => invoke<string>("crash_report_url", { id }),
  crashClear: () => invoke<void>("crash_clear"),
  continuityCheck: (path: string) => invoke<ContinuityReport>("continuity_check", { path }),
  fontsCatalog: () => invoke<FontCatalog>("fonts_catalog"),
  editorFont: () => invoke<string>("editor_font"),
  setEditorFont: (id: string) => invoke<string>("set_editor_font", { id }),

  /** Where to write an export. Returns null when the user backs out. */
  pickExportTarget: (defaultPath: string, name: string, extension: string) =>
    save({ defaultPath, filters: [{ name, extensions: [extension] }] }),
  /** A manuscript file to import. */
  pickImportFile: () =>
    open({
      multiple: false,
      filters: [{ name: "Manuscript", extensions: ["md", "markdown", "docx", "epub"] }],
    }),
  /** A Scrivener project, which is a .scriv bundle directory on macOS. */
  pickImportProject: () => open({ directory: true, multiple: false }),
};

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
