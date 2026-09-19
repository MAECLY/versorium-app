import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

// Tauri command wrappers. All business logic lives in Rust; this is a thin typed edge.

export interface ProjectMeta {
  schema: number;
  title: string;
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

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
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
};

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
