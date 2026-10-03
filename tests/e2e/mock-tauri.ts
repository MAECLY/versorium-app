// In-browser stand-in for the Tauri IPC so the UI runs in a plain browser
// (Playwright, Chrome DevTools). Loaded by src/main.ts only in `pnpm dev`
// with `?mock=tauri`; never bundled. Mirrors the Rust command contracts in
// src-tauri/src/commands with in-memory state exposed at window.__VERSORIUM_MOCK__.

type Args = Record<string, unknown>;

interface Op {
  seq: number;
  ts: number;
  author: string;
  kind: "insert" | "delete" | "rollback";
  from: number;
  to: number;
  text: string;
}

interface Chapter {
  id: string;
  title: string;
  status: string;
  words: number;
  file: string;
  mtime: number;
  body: string;
}

interface Commit {
  sha: string;
  short: string;
  author: string;
  time: number;
  message: string;
}

interface ProjectState {
  path: string;
  meta: {
    schema: number;
    title: string;
    author: string;
    language: string;
    uiLanguage: string;
    defaultChapterPattern: string;
    censorship: string;
    remote: string | null;
    chapterOrder: string[];
    exportCover: boolean;
    exportColophon: boolean;
  };
  chapters: Chapter[];
  commits: Commit[];
  dirty: Set<string>;
  /** Paths that have been in at least one snapshot; the rest read as new. */
  tracked: Set<string>;
  ops: Record<string, Op[]>;
  seq: Record<string, number>;
  branches: string[];
  remotes: { name: string; url: string }[];
}

interface CrashEntry {
  id: string; ts: number; version: string; os: string; arch: string;
  kind: string; message: string; stack: string[];
}

interface AvailableUpdate { version: string; notes: string; date: string | null }
interface UpdateStatus {
  currentVersion: string;
  available: AvailableUpdate | null;
  channel: "stable" | "beta";
  automatic: boolean;
  tokenSet: boolean;
  checking: boolean;
  checked: boolean;
  lastError: string | null;
  resetsAt: number | null;
}

/**
 * What GitHub would answer the updater, kept apart from what the app shows, so
 * a spec can change the world and then watch the app find out.
 *
 * `answer` mirrors `update::classify` in Rust: each value is one of the states
 * the panel must tell apart. `checks` records, per check, whether it carried a
 * token — the mock keeps only a token's presence, never its value, as the real
 * secrets commands do.
 */
interface MockGitHub {
  /** The newest release on the channel; null when nothing newer is out. */
  release: AvailableUpdate | null;
  answer: "ok" | "404" | "rate_limited" | "401" | "offline";
  /** `x-ratelimit-reset`, Unix seconds, sent with a rate-limit answer. */
  resetsAt: number | null;
  checks: { authorized: boolean }[];
}

interface ImportedChapter { title: string; body: string; synopsis: string | null }
interface Imported { title: string; chapters: ImportedChapter[]; warnings: string[] }

interface ModelCard {
  id: string; family: string; label: string; task: string; tier: string;
  params: string; quant: string; sizeBytes: number; ramHintGB: number; ctx: number;
  speed: string; quality: string; badge: string | null; uncensored: boolean;
  license: string; repo: string; state: string; receivedBytes: number; fits: boolean;
}

interface SlotAssignment { kind: string; id: string }

interface McpClient {
  id: string;
  name: string;
  configPath: string;
  detected: boolean;
  installed: boolean;
  writeAllowed: boolean;
}

interface McpLogEntry {
  ts: number;
  client: string;
  tool: string;
  scope: "read" | "write";
  outcome: "ok" | "denied" | "error";
  detail: string;
}

interface AgentInfo {
  id: string;
  name: string;
  path: string | null;
  version: string | null;
  state: "connected" | "detected" | "missing";
  models: string[] | null;
}

const PROJECTS_DIR = "/mock/Documents/Versorium";

const settings = {
  uiLocale: "en",
  theme: "folio",
  themeMode: "light",
  censorship: false,
  githubUpdatesToken: null as string | null,
  githubNovelToken: null as string | null,
  editorFont: "system-serif",
  focusMode: false,
  typewriter: false,
  // Already onboarded, so the tour does not sit on top of every other spec.
  // `?mock=tauri&fresh=1` simulates a first run instead.
  onboarded: !new URLSearchParams(location.search).has("fresh"),
  authorProfiles: {
    work: { name: "", sortAs: "", role: "", organization: "", rights: "" },
    hobby: { name: "", sortAs: "", role: "", organization: "", rights: "" },
  },
  authorProfile: "work",
};

const projects = new Map<string, ProjectState>();
const calls: { cmd: string; args: Args }[] = [];

const GB = 1024 ** 3;

/// What a Scrivener import would surface: chapters plus what could not cross.
const importPreview: Imported = {
  title: "The Salt Road",
  chapters: [
    { title: "A door in the rain", body: "It rained for three days.", synopsis: "She leaves." },
    { title: "North", body: "## Morning\n\nThe road bent north.", synopsis: null },
  ],
  warnings: [
    "Scrivener labels and status flags are not imported.",
    "Comments and footnotes in 2 documents were dropped.",
  ],
};

// Already scrubbed by Rust: no prose, no paths, no tokens.
const crashes: CrashEntry[] = [
  { id: "a1", ts: 1_759_000_000_000, version: "0.1.0", os: "macos", arch: "aarch64",
    kind: "panic", message: "<redacted> 3 but the index is 5", stack: ["src/ops/mod.rs:142"] },
];

const fonts = {
  version: 1,
  fonts: [
    { id: "system-serif", family: "System serif", role: "body",
      stack: '"Iowan Old Style", Palatino, "Times New Roman", serif',
      license: "system", bundled: false },
    { id: "system-ui", family: "System UI", role: "ui", stack: "system-ui, sans-serif",
      license: "system", bundled: false },
    { id: "source-serif-4", family: "Source Serif 4", role: "body",
      stack: '"Source Serif 4", serif', license: "OFL-1.1", bundled: false },
  ],
};

const update: UpdateStatus = {
  currentVersion: "0.1.0",
  available: null,
  channel: "stable",
  automatic: true,
  // No token to start, as on a fresh install. Since the §11 amendment that no
  // longer stops a check: the startup check runs anonymously.
  tokenSet: false,
  checking: false,
  checked: false,
  lastError: null,
  resetsAt: null,
};

// Nothing newer than the running version to start with, so the startup check —
// which now runs on every launch with automatic updates on — finds nothing and
// opens no dialog over every other spec.
const github: MockGitHub = { release: null, answer: "ok", resetsAt: null, checks: [] };
/** Mirrors `update_skipped` in the Rust settings: a skip outlives the check. */
let skippedVersion: string | null = null;

let lastExport: { path: string; bytes: number; format: string; warnings: string[] } | null = null;

const models: ModelCard[] = [
  { id: "gemma3-1b-q4km", family: "Gemma", label: "Gemma 3 1B", task: "writing", tier: "low",
    params: "1B", quant: "Q4_K_M", sizeBytes: 0.8 * GB, ramHintGB: 2, ctx: 8192, speed: "fast",
    quality: "basic", badge: null, uncensored: false, license: "gemma", repo: "mock/gemma3-1b",
    state: "ready", receivedBytes: 0, fits: true },
  { id: "qwen3-4b-q4km", family: "Qwen", label: "Qwen3 4B Instruct", task: "writing", tier: "mid",
    params: "4B", quant: "Q4_K_M", sizeBytes: 2.5 * GB, ramHintGB: 3.5, ctx: 32768, speed: "balanced",
    quality: "good", badge: "Balanced", uncensored: false, license: "apache-2.0", repo: "mock/qwen3-4b",
    state: "missing", receivedBytes: 0, fits: true },
  { id: "qwen3-14b-q5km", family: "Qwen", label: "Qwen3 14B", task: "writing", tier: "midPlus",
    params: "14B", quant: "Q5_K_M", sizeBytes: 9 * GB, ramHintGB: 12, ctx: 32768, speed: "slow",
    quality: "high", badge: "Balanced+", uncensored: false, license: "apache-2.0", repo: "mock/qwen3-14b",
    state: "partial", receivedBytes: 3 * GB, fits: true },
  { id: "dolphin-24b-q4km", family: "Dolphin", label: "Dolphin 24B", task: "writing", tier: "high",
    params: "24B", quant: "Q4_K_M", sizeBytes: 14 * GB, ramHintGB: 20, ctx: 32768, speed: "slow",
    quality: "high", badge: null, uncensored: true, license: "apache-2.0", repo: "mock/dolphin-24b",
    state: "missing", receivedBytes: 0, fits: false },
  { id: "nomic-embed", family: "Nomic", label: "Nomic Embed", task: "embeddings", tier: "low",
    params: "137M", quant: "F16", sizeBytes: 0.08 * GB, ramHintGB: 0.5, ctx: 2048, speed: "fast",
    quality: "good", badge: null, uncensored: false, license: "apache-2.0", repo: "mock/nomic",
    state: "ready", receivedBytes: 0, fits: true },
];

const slots: Record<string, SlotAssignment> = {
  rewrite: { kind: "none", id: "" },
  chat: { kind: "none", id: "" },
  continuity: { kind: "none", id: "" },
  embeddings: { kind: "none", id: "" },
  dictation: { kind: "none", id: "" },
};

let downloadProgress: { id: string; received: number; total: number; done: boolean } | null = null;

const studio = { host: "127.0.0.1", port: 1234, enabled: false };

const mcpClients: McpClient[] = [
  { id: "claude-code", name: "Claude Code", configPath: "/mock/project/.mcp.json", detected: true, installed: false, writeAllowed: false },
  { id: "claude-desktop", name: "Claude Desktop", configPath: "/mock/Library/Claude/claude_desktop_config.json", detected: true, installed: false, writeAllowed: false },
  { id: "codex", name: "Codex", configPath: "/mock/.codex/config.toml", detected: true, installed: false, writeAllowed: false },
  { id: "opencode", name: "OpenCode", configPath: "/mock/.config/opencode/opencode.json", detected: false, installed: false, writeAllowed: false },
];

const mcpLog: McpLogEntry[] = [
  { ts: 1_759_000_000_000, client: "claude-code", tool: "read_document", scope: "read", outcome: "ok", detail: "manuscript/ch-01-the-long-winter.md" },
  { ts: 1_759_000_060_000, client: "codex", tool: "write_document", scope: "write", outcome: "denied", detail: "write not allowed for codex" },
];

/** The in-process engine's state. `warming` for the first call only, so a test
 *  can see the "starting" copy the real app shows while Metal shaders compile. */
/** Queued install phases, drained one per poll. */
let installPhases: { phase: string; received: number; total: number | null; error: string | null }[] = [];
let relaunched = false;

/** Which credentials exist. Never their values, matching the real command. */
const storedSecrets = new Set<string>();

// One reachable provider, one absent, one second disk, and one folder that
// happens to be on the novel's own disk — the four cases the panel renders
// differently.
const backupDestinations = [
  {
    kind: "icloud",
    path: "/mock/Library/Mobile Documents/com~apple~CloudDocs",
    available: true,
    volume: "1",
    offsite: true,
  },
  { kind: "dropbox", path: "/mock/Dropbox", available: false, volume: null, offsite: true },
  { kind: "disk", path: "/mock/Volumes/Respaldo", available: true, volume: "2", offsite: false },
  { kind: "folder", path: "/mock/novels/backups", available: true, volume: "1", offsite: false },
];
/** The novel lives here, so a destination on volume 1 shares its disk. */
const projectVolume = "1";
let backupDirs: string[] = [];
let backupKeep = 10;
type MockArchive = {
  path: string;
  name: string;
  bytes: number;
  modified: number;
  stamped: number | null;
  print: string | null;
  sha256: string | null;
};
/** Which state of the novel each destination is already holding, and how many
    copies of it — the mock's stand-in for reading the archives back. */
const backupHeld = new Map<string, { print: string; copies: number }>();
/** Bumped by any command that changes the manuscript, so the mock can tell an
    unchanged press from a real one without hashing anything. */
let manuscriptRevision = 0;
const backupArchives = new Map<string, MockArchive[]>();

let mcpHttpEnabled = false;

let llamaWarmCalls = 0;
let llamaBusy = false;

/// Mirrors settings::SLOT_KINDS; Rust rejects anything else as `bad_args`.
const SLOT_KINDS = ["none", "builtin", "ollama", "cli"];

const agents: AgentInfo[] = [
  { id: "claude", name: "Claude Code", path: "/mock/bin/claude", version: "2.1.0", state: "connected", models: null },
  { id: "codex", name: "Codex", path: "/mock/bin/codex", version: "0.9.0", state: "connected", models: null },
  { id: "opencode", name: "OpenCode", path: null, version: null, state: "missing", models: null },
  { id: "ollama", name: "Ollama", path: "/mock/bin/ollama", version: "0.6.0", state: "connected", models: ["qwen3.8:latest"] },
  { id: "gh", name: "GitHub CLI", path: "/mock/bin/gh", version: "2.60.0", state: "connected", models: null },
];

function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "untitled";
}

function countWords(body: string): number {
  return body.split(/\s+/).filter(Boolean).length;
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function sha(): string {
  return Array.from({ length: 40 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
}

function publicChapter(c: Chapter) {
  const { body: _body, ...meta } = c;
  return meta;
}

function publicProject(p: ProjectState) {
  return { path: p.path, meta: p.meta, chapters: p.chapters.map(publicChapter) };
}

function project(path: unknown): ProjectState {
  const p = projects.get(String(path));
  if (!p) throw "not_found";
  return p;
}

function chapter(p: ProjectState, file: unknown): Chapter {
  const c = p.chapters.find((c) => c.file === String(file));
  if (!c) throw "not_found";
  return c;
}

function commit(p: ProjectState, message: string): string {
  if (p.dirty.size === 0 && p.commits.length > 0) throw "nothing_to_commit";
  const id = sha();
  p.commits.unshift({ sha: id, short: id.slice(0, 7), author: "Versorium", time: now(), message });
  for (const f of p.dirty) p.tracked.add(f);
  p.dirty.clear();
  return id;
}

function newChapter(n: number, title: string): Chapter {
  const nn = String(n).padStart(2, "0");
  return {
    id: `ch-${nn}`,
    title,
    status: "draft",
    words: 0,
    file: `manuscript/ch-${nn}-${slugify(title)}.md`,
    mtime: now(),
    body: "",
  };
}

function appendOps(p: ProjectState, chapterId: string, ops: Op[]): Op[] {
  const list = (p.ops[chapterId] ??= []);
  let seq = p.seq[chapterId] ?? 0;
  const stamped = ops.map((op) => ({ ...op, seq: ++seq, ts: op.ts > 0 ? op.ts : Date.now() }));
  p.seq[chapterId] = seq;
  list.push(...stamped);
  return stamped;
}

const commands: Record<string, (args: Args) => unknown> = {
  app_info: () => ({ version: "0.1.0-mock", os: "mock", family: "unix" }),
  default_projects_dir: () => PROJECTS_DIR,
  // Most recently written first, as the Rust command sorts. The sidebar is
  // called recent projects, and "Continue where you left off" reads the head of
  // this list, so insertion order would make the mock disagree with the app.
  list_projects: () =>
    [...projects.values()]
      .map(publicProject)
      .sort((a, b) => {
        const touched = (p: { chapters: { mtime: number }[] }) =>
          p.chapters.reduce((newest, c) => Math.max(newest, c.mtime), 0);
        return touched(b) - touched(a) || a.meta.title.localeCompare(b.meta.title);
      }),

  create_project: ({ args }) => {
    const { path, title, language } = args as { path: string; title: string; language: string };
    const clean = title.trim();
    if (!clean) throw "empty_title";
    const root = `${path}/${slugify(clean)}`;
    if (projects.has(root)) throw "project_exists";
    const p: ProjectState = {
      path: root,
      meta: {
        schema: 1,
        title: clean,
        language,
        author: "",
        uiLanguage: "en",
        defaultChapterPattern: "ch-{n}-{slug}.md",
        censorship: "off",
        remote: null,
        chapterOrder: [],
        // On by default, exactly as a fresh versorium.json has them.
        exportCover: true,
        exportColophon: true,
      },
      chapters: [newChapter(1, clean)],
      commits: [],
      dirty: new Set(),
      tracked: new Set(),
      ops: {},
      seq: {},
      branches: ["main"],
      remotes: [],
    };
    commit(p, "m0: project created");
    projects.set(root, p);
    return publicProject(p);
  },

  open_project: ({ path }) => publicProject(project(path)),
  list_chapters: ({ path }) => project(path).chapters.map(publicChapter),

  create_chapter: ({ path, title }) => {
    const p = project(path);
    const clean = String(title).trim();
    if (!clean) throw "empty_title";
    const c = newChapter(p.chapters.length + 1, clean);
    p.chapters.push(c);
    p.dirty.add(c.file);
    return publicChapter(c);
  },

  read_chapter: ({ args }) => {
    const { path, file } = args as { path: string; file: string };
    const c = chapter(project(path), file);
    return { frontmatter: { id: c.id, title: c.title, status: c.status, words: String(c.words) }, body: c.body };
  },

  save_chapter: ({ path, file, body, status }) => {
    const p = project(path);
    const c = chapter(p, file);
    // What makes the next "Back up now" a real backup rather than a no-op.
    manuscriptRevision += 1;
    c.body = String(body);
    c.words = countWords(c.body);
    if (typeof status === "string") c.status = status;
    c.mtime = now();
    p.dirty.add(c.file);
    return publicChapter(c);
  },

  get_settings: () => ({ ...settings, backupDirs: [...backupDirs], backupKeep }),
  set_settings: ({ patch }) => {
    Object.assign(settings, patch as Partial<typeof settings>);
    // The legacy settings field still counts as a saved token, as in Rust.
    update.tokenSet = Boolean(settings.githubUpdatesToken) || storedSecrets.has("updates");
    return { ...settings };
  },

  update_project: ({ path, title, author, exportCover, exportColophon }) => {
    const p = project(String(path));
    if (title !== undefined && title !== null) {
      if (!String(title).trim()) throw "empty_title";
      p.meta.title = String(title).trim();
    }
    if (author !== undefined && author !== null) p.meta.author = String(author).trim();
    if (exportCover !== undefined && exportCover !== null) p.meta.exportCover = Boolean(exportCover);
    if (exportColophon !== undefined && exportColophon !== null) {
      p.meta.exportColophon = Boolean(exportColophon);
    }
    if (title == null && author == null && exportCover == null && exportColophon == null) {
      throw "bad_args";
    }
    return { ...p.meta };
  },
  // Mirrors the real command: the folder goes to the system trash, and what
  // comes back is the remaining projects.
  delete_project: ({ path }) => {
    if (!projects.has(String(path))) throw "not_found";
    projects.delete(String(path));
    return [...projects.values()].map((p) => ({ path: p.path, meta: { ...p.meta }, chapters: p.chapters.map((c) => ({ ...c })) }));
  },
  update_chapter: ({ path, file, title, status }) => {
    const p = project(String(path));
    const c = chapter(p, String(file));
    if (title == null && status == null) throw "bad_args";
    if (title !== undefined && title !== null) {
      if (!String(title).trim()) throw "empty_title";
      c.title = String(title).trim();
    }
    if (status !== undefined && status !== null) {
      if (!["draft", "revised", "final"].includes(String(status))) throw "bad_args";
      c.status = String(status);
    }
    return { ...c };
  },
  reorder_chapters: ({ path, ids }) => {
    const p = project(String(path));
    const wanted = (ids as string[] | undefined) ?? [];
    for (const id of wanted) {
      if (!p.chapters.some((c) => c.id === id)) throw "not_found";
    }
    // Named ids first, in the order given; everything else keeps its place
    // after them, exactly as the Rust command does.
    const named = p.chapters.filter((c) => wanted.includes(c.id));
    named.sort((a, b) => wanted.indexOf(a.id) - wanted.indexOf(b.id));
    p.chapters = [...named, ...p.chapters.filter((c) => !wanted.includes(c.id))];
    return p.chapters.map((c) => ({ ...c }));
  },

  delete_chapter: ({ path, file }) => {
    const p = project(String(path));
    const index = p.chapters.findIndex((c) => c.file === String(file));
    if (index < 0) throw "not_found";
    // The real command snapshots before removing, which is what makes this
    // recoverable; the mock records the commit so a test can see it happened.
    commit(p, `checkpoint: before deleting ${file}`);
    p.chapters.splice(index, 1);
    return p.chapters.map((c) => ({ ...c }));
  },

  git_status: ({ path }) => {
    const p = project(path);
    const dirty = [...p.dirty];
    return {
      branch: "main",
      modified: dirty.filter((f) => p.tracked.has(f)),
      staged: [],
      untracked: dirty.filter((f) => !p.tracked.has(f)),
      ahead: 0,
      behind: 0,
    };
  },
  git_log: ({ path, limit }) => project(path).commits.slice(0, Number(limit ?? 50)),
  git_diff: ({ path }) => [...project(path).dirty].map((f) => `--- a/${f}\n+++ b/${f}\n`).join(""),
  git_commit: ({ path, message }) => {
    const msg = String(message ?? "").trim();
    if (!msg) throw "empty_message";
    return commit(project(path), msg);
  },
  git_auto_checkpoint: ({ path }) => {
    const p = project(path);
    return p.dirty.size ? commit(p, "checkpoint: autosave") : null;
  },
  git_branches: ({ path }) => ({ current: "main", branches: project(path).branches }),
  git_branch_create: ({ path, name }) => {
    const p = project(path);
    const n = String(name).trim();
    if (!n) throw "bad_branch";
    if (p.branches.includes(n)) throw "branch_exists";
    p.branches.push(n);
    return n;
  },
  git_checkout_file: () => undefined,
  git_remotes: ({ path }) => project(path).remotes,
  git_remote_add: ({ path, name, url }) => {
    project(path).remotes.push({ name: String(name), url: String(url) });
  },
  git_remote_remove: ({ path, name }) => {
    const p = project(path);
    p.remotes = p.remotes.filter((r) => r.name !== name);
  },
  github_me: ({ token }) => {
    if (!String(token).startsWith("ghp_")) throw "bad_token";
    return "mock-writer";
  },
  github_owners: () => [
    { login: "mock-writer", kind: "user" },
    { login: "mock-press", kind: "organization" },
  ],
  github_create_repo: ({ name, owner }) => `https://github.com/${owner ?? "mock-writer"}/${name}.git`,
  github_list_repos: () => [{ name: "mock-writer/novel", private: true }],

  ops_append: ({ args }) => {
    const { path, chapter: id, ops } = args as { path: string; chapter: string; ops: Op[] };
    return appendOps(project(path), id, ops);
  },
  ops_recent: ({ path, chapter: id, limit }) => {
    const list = project(path).ops[String(id)] ?? [];
    return list.slice(-Number(limit ?? 50));
  },
  ops_snapshots: () => [],
  ops_restore_snapshot: () => {
    throw "not_found";
  },

  agents_detect: () => agents.map((a) => ({ ...a, models: a.models ? [...a.models] : null })),

  // --- M7: polish ---
  crash_list: ({ limit }) => crashes.slice(0, Number(limit ?? 20)),
  crash_report_url: ({ id }) => {
    if (!crashes.some((c) => c.id === id)) throw "not_found";
    return `https://github.com/mock/versorium-app/issues/new?title=crash&body=redacted`;
  },
  crash_clear: () => {
    crashes.length = 0;
  },
  continuity_check: () => {
    // No model is selected for Continuity, so it refuses to pretend it ran.
    const slot = slots.continuity;
    if (slot.kind !== "ollama") return { ran: false, reason: "continuity_no_model", findings: [] };
    return { ran: true, reason: null,
             findings: [{ kind: "contradiction", detail: "Ana's eyes change colour.", chapter: "ch-02" }] };
  },
  fonts_catalog: () => JSON.parse(JSON.stringify(fonts)),
  editor_font: () => settings.editorFont ?? "system-serif",
  set_editor_font: ({ id }) => {
    if (!fonts.fonts.some((f) => f.id === id)) throw "bad_args";
    settings.editorFont = String(id);
    return settings.editorFont;
  },

  // --- M6: updates ---
  update_status: () => ({ ...update }),
  // Never throws for GitHub's answer: like the Rust command, every outcome is
  // a status with a code, and only a broken command rejects.
  update_check: () => {
    const authorized = update.tokenSet;
    github.checks.push({ authorized });
    update.checked = true;
    update.available = null;
    update.lastError = null;
    update.resetsAt = null;
    if (github.answer === "offline") {
      update.lastError = "network";
    } else if (github.answer === "404") {
      update.lastError = "update_none_visible";
    } else if (github.answer === "rate_limited") {
      update.lastError = authorized ? "update_rate_limited_token" : "update_rate_limited";
      update.resetsAt = github.resetsAt;
    } else if (github.answer === "401" && authorized) {
      update.lastError = "update_token_rejected";
    } else if (github.release && github.release.version !== skippedVersion) {
      // "ok" — or a 401 to a check that carried no credential: GitHub only
      // refuses a token, so an anonymous check gets the ordinary answer.
      update.available = { ...github.release };
    }
    return { ...update };
  },
  update_install: () => {
    const MB = 1024 * 1024;
    installPhases = [
      ...[2, 5, 8, 11].map((mb) => ({
        phase: "downloading",
        received: mb * MB,
        total: 12 * MB,
        error: null,
      })),
      { phase: "verifying", received: 12 * MB, total: 12 * MB, error: null },
      { phase: "installing", received: 12 * MB, total: 12 * MB, error: null },
      { phase: "ready", received: 12 * MB, total: 12 * MB, error: null },
    ];
    return new Promise((resolve) => setTimeout(resolve, 2600));
  },
  // Each poll advances one phase and the last one sticks, so a test can watch
  // the sequence without racing a timer.
  update_progress: () => {
    if (installPhases.length === 0) return null;
    const next = installPhases.length > 1 ? installPhases.shift()! : installPhases[0];
    return next;
  },
  update_relaunch: () => {
    relaunched = true;
    return undefined;
  },
  update_skip: ({ version }) => {
    skippedVersion = String(version);
    if (update.available?.version === version) update.available = null;
    return { ...update };
  },
  update_set_channel: ({ channel }) => {
    if (channel !== "stable" && channel !== "beta") throw "bad_args";
    update.channel = channel;
    // Another track has other releases: what the last check found says
    // nothing about it, and a skip from the old track does not carry over.
    update.available = null;
    update.checked = false;
    update.lastError = null;
    update.resetsAt = null;
    skippedVersion = null;
    return { ...update };
  },
  update_set_automatic: ({ automatic }) => {
    update.automatic = Boolean(automatic);
    return { ...update };
  },

  // --- M5: formats ---
  export_manuscript: ({ path, format, dest }) => {
    const project = projects.get(String(path));
    if (!project) throw "not_found";
    if (!["md", "docx", "epub", "pdf", "scriv"].includes(String(format))) throw "bad_format";
    if (!project.chapters.some((c) => c.body.trim())) throw "empty_manuscript";
    // PDF cannot carry every character, and the UI has to say so.
    const warnings = format === "pdf" ? ["export_pdf_characters_replaced"]
                   : format === "docx" ? ["export_docx_scene_titles_dropped"]
                   // Scrivener has no scene inside a document, so a heading
                   // becomes a separator and the UI has to say so.
                   : format === "scriv" ? ["export_scrivener_scenes_flattened"] : [];
    lastExport = { path: String(dest), bytes: 48_231, format: String(format), warnings };
    return { ...lastExport };
  },
  import_preview: ({ source }) => {
    const name = String(source);
    if (!/\.(md|markdown|docx|scriv|epub)$/i.test(name)) throw "unsupported_source";
    return JSON.parse(JSON.stringify(importPreview));
  },
  import_apply: ({ source: _source, title }) =>
    commands.create_project({ args: { path: PROJECTS_DIR, title, language: "en" } }),
  set_author: ({ path, author }) => {
    const project = projects.get(String(path));
    if (!project) throw "not_found";
    project.meta.author = String(author);
    return { ...project.meta };
  },

  // --- M4: local models ---
  models_view: () => ({
    models: models.map((m) => ({ ...m })),
    hardware: { totalRamGb: 36, availableRamGb: 18, cpuCores: 12, arch: "aarch64",
                os: "macos", gpu: "Apple unified memory (Metal)", recommendedTier: "midPlus" },
    slots: { ...slots },
    progress: downloadProgress,
    ollama: { running: true, installed: true,
              models: [{ name: "qwen3.8:latest", sizeBytes: 17_741_872_154, modified: "2026-09-04T11:30:22Z" }] },
    studio: { ...studio },
    censorship: settings.censorship,
    diskUsedBytes: models.filter((m) => m.state === "ready").reduce((a, m) => a + m.sizeBytes, 0),
    modelsDir: "/mock/Library/versorium/models",
  }),
  // Resolves only when the file is on disk, exactly as the Rust command does:
  // `download::start` awaits the whole transfer. The mock used to return
  // immediately, which is precisely why the missing progress bar survived the
  // suite — a mock that lies about a command's shape tests a program nobody
  // ships.
  models_download: ({ id }) => {
    const model = models.find((m) => m.id === id);
    if (!model) throw "not_found";
    if (downloadProgress && !downloadProgress.done) throw "download_busy";
    model.state = "partial";
    downloadProgress = { id: String(id), received: 0, total: model.sizeBytes, done: false };

    return new Promise<void>((resolve) => {
      let received = 0;
      // Slower than one poll interval on purpose: a real download takes
      // minutes, and a mock that finishes inside 700ms would let a panel that
      // shows nothing during a transfer pass this suite.
      const step = model.sizeBytes / 12;
      const timer = setInterval(() => {
        // Cancelled: the command rejects and the caller stops polling.
        if (downloadProgress?.id !== id) {
          clearInterval(timer);
          resolve();
          return;
        }
        received = Math.min(model.sizeBytes, received + step);
        downloadProgress = { id: String(id), received, total: model.sizeBytes, done: false };
        if (received >= model.sizeBytes) {
          clearInterval(timer);
          model.state = "ready";
          downloadProgress = { id: String(id), received, total: model.sizeBytes, done: true };
          resolve();
        }
      }, 150);
    });
  },
  models_cancel: ({ id }) => {
    if (downloadProgress?.id === id) downloadProgress = null;
  },
  models_delete: ({ id }) => {
    const model = models.find((m) => m.id === id);
    if (!model) throw "not_found";
    model.state = "missing";
    model.receivedBytes = 0;
    // A slot must never point at a file that is gone.
    for (const key of Object.keys(slots)) {
      if (slots[key].kind === "builtin" && slots[key].id === id) slots[key] = { kind: "none", id: "" };
    }
  },
  models_progress: () => downloadProgress,
  models_set_slot: ({ slot, kind, id }) => {
    const name = String(slot);
    if (!(name in slots)) throw "bad_args";
    if (kind === "builtin" && models.find((m) => m.id === id)?.state !== "ready") throw "not_ready";
    slots[name] = kind === "none" ? { kind: "none", id: "" } : { kind: String(kind), id: String(id) };
    return { ...slots };
  },
  // Credentials live in the OS store; the mock keeps presence only, because the
  // whole point is that the value never comes back to the frontend.
  secrets_status: () => ({
    store: { usable: true, reason: null },
    updates: storedSecrets.has("updates"),
    novel: storedSecrets.has("novel"),
  }),
  secrets_connect: ({ slot, token }) => {
    const name = String(slot);
    if (!["updates", "novel"].includes(name)) throw "bad_args";
    if (!String(token ?? "").trim()) throw "bad_args";
    storedSecrets.add(name);
    // The updater reads the same store, so the next check carries the token.
    if (name === "updates") update.tokenSet = true;
    return "versorium-writer";
  },
  secrets_forget: ({ slot }) => {
    const name = String(slot);
    if (!["updates", "novel"].includes(name)) throw "bad_args";
    storedSecrets.delete(name);
    if (name === "updates") update.tokenSet = Boolean(settings.githubUpdatesToken);
    return undefined;
  },

  backup_destinations: () => backupDestinations.map((d) => ({ ...d })),
  backup_configure: ({ paths, keep }) => {
    const kept: string[] = [];
    for (const raw of (paths as string[] | undefined) ?? []) {
      const dir = String(raw ?? "").trim();
      if (!dir) continue;
      if (!backupDestinations.some((d) => d.path === dir && d.available)) throw "backup_dest_missing";
      if (!kept.includes(dir)) kept.push(dir);
    }
    backupDirs = kept.slice(0, 3);
    backupKeep = Math.min(200, Math.max(1, Number(keep ?? 10)));
    return undefined;
  },
  backup_now: () => {
    if (backupDirs.length === 0) throw "backup_not_configured";
    // `/mock/Volumes/Respaldo` stands in for an unplugged drive: the case the
    // whole per-destination reporting exists for.
    const print = `state${manuscriptRevision}`.padEnd(16, "0");
    return backupDirs.map((dir) => {
      if (dir === "/mock/Volumes/Respaldo") return { state: "unavailable", path: dir };
      const stored = backupArchives.get(dir) ?? [];
      const held = backupHeld.get(dir);

      // Mirrors the real rule: two copies of a state, then nothing.
      if (held?.print === print && held.copies >= 2) {
        return { state: "unchanged", path: dir, archive: { ...stored[0] }, pruned: 0 };
      }
      const copy = held?.print === print;
      const stamp = `2026-09-28-01000${stored.length}`;
      const archive: MockArchive = {
        path: `${dir}/versorium-backup-el-largo-invierno-${stamp}-${print}.zip`,
        name: `versorium-backup-el-largo-invierno-${stamp}-${print}.zip`,
        bytes: 1_240_000,
        modified: 1_790_553_600 + stored.length,
        stamped: 1_790_553_600 + stored.length,
        print,
        sha256: "a".repeat(64),
      };
      const next = [archive, ...stored];
      const pruned = Math.max(0, next.length - backupKeep);
      backupArchives.set(dir, next.slice(0, backupKeep));
      backupHeld.set(dir, { print, copies: copy ? (held?.copies ?? 0) + 1 : 1 });
      return { state: copy ? "copy" : "ok", path: dir, archive: { ...archive }, pruned };
    });
  },
  backup_list: () =>
    backupDirs.map((dir) => [dir, (backupArchives.get(dir) ?? []).map((a) => ({ ...a }))]),
  backup_verify: () => "a".repeat(64),
  backup_coverage: () => {
    const volumes = new Set<string>([projectVolume]);
    let unknown = false;
    const onTheNovelsDisk: string[] = [];
    for (const dir of backupDirs) {
      const known = backupDestinations.find((d) => d.path === dir);
      if (!known?.volume) {
        unknown = true;
        continue;
      }
      if (known.volume === projectVolume) onTheNovelsDisk.push(dir);
      volumes.add(known.volume);
    }
    return {
      copies: 1 + backupDirs.length,
      media: unknown ? null : volumes.size,
      offsite: backupDirs.some((dir) => backupDestinations.find((d) => d.path === dir)?.offsite),
      onTheNovelsDisk,
    };
  },
  backup_restore: ({ project, label }) => `${String(project)}-${String(label)}`,

  git_push: ({ path }) => {
    if (!storedSecrets.has("novel")) throw "not_signed_in";
    if (!project(String(path)).remotes.length) throw "no_remote";
    return "main";
  },
  git_pull: ({ path }) => {
    if (!storedSecrets.has("novel")) throw "not_signed_in";
    if (!project(String(path)).remotes.length) throw "no_remote";
    return { branch: "main", changed: false };
  },

  llama_backend: () => {
    // The real backend reports `warming` while it compiles Metal shaders; the
    // first call here does too so the UI state is reachable in a test.
    llamaWarmCalls += 1;
    if (llamaWarmCalls === 1) return { state: "warming", device: null, gpuOffload: false };
    return {
      state: "ready",
      device: { label: "Metal (Apple M4 Max)", deviceType: "gpu", memFreeMb: 53_083, memTotalMb: 55_662 },
      gpuOffload: true,
    };
  },
  llama_progress: () => null,
  llama_cancel: () => undefined,
  llama_unload: () => undefined,

  ollama_pull: () => undefined,
  ollama_remove: () => undefined,
  studio_test: ({ port }) => Number(port) === 1234,
  studio_save: ({ host, port, enabled }) => {
    studio.host = String(host);
    studio.port = Number(port);
    studio.enabled = Boolean(enabled);
    return { ...studio };
  },

  // --- M3: MCP ---
  mcp_status: () => ({
    command: "/mock/bin/versorium",
    args: ["mcp"],
    logPath: "/mock/Library/versorium/mcp-log.jsonl",
    clients: mcpClients.map((c) => ({ ...c })),
  }),
  mcp_set_write: ({ client, allowed }) => {
    const c = mcpClients.find((c) => c.id === client);
    if (!c) throw "mcp_client_unknown";
    c.writeAllowed = Boolean(allowed);
    return commands.mcp_status({});
  },
  mcp_install_client: ({ client }) => {
    const c = mcpClients.find((c) => c.id === client);
    if (!c) throw "mcp_client_unknown";
    // OpenCode stands in for a client whose config cannot be written.
    if (c.id === "opencode") throw "mcp_config_failed";
    c.installed = true;
    return commands.mcp_status({});
  },
  mcp_uninstall_client: ({ client }) => {
    const c = mcpClients.find((c) => c.id === client);
    if (!c) throw "mcp_client_unknown";
    c.installed = false;
    c.writeAllowed = false;
    return commands.mcp_status({});
  },
  mcp_log: ({ limit }) => mcpLog.slice(-Number(limit ?? 50)).reverse(),
  mcp_set_active_project: () => undefined,
  // Off by default, like the real setting: it opens a listener on a machine
  // whose MCP tools can write.
  mcp_http_status: () => ({
    enabled: mcpHttpEnabled,
    url: mcpHttpEnabled ? "http://127.0.0.1:52341/mcp" : null,
    endpointFile: "/mock/Library/versorium/mcp-http.json",
  }),
  mcp_set_http: ({ enabled }) => {
    mcpHttpEnabled = Boolean(enabled);
    return commands.mcp_http_status({});
  },

  // Mirrors agents::rewrite: dispatch on the assignment, never on `kind` alone.
  ai_rewrite: ({ kind, id, text }) => {
    const passage = String(text).trim();
    if (!passage) throw "ai_empty";
    if (!SLOT_KINDS.includes(String(kind))) throw "bad_args";
    const model = String(id ?? "").trim();
    if (!model) throw "no_provider";
    switch (kind) {
      case "cli": {
        // `gh` is in `agents` but is a git tool: Rust only accepts the three
        // prose harnesses, so the mock must refuse it the same way.
        if (!["claude", "codex", "opencode"].includes(model)) throw "no_provider";
        if (!agents.some((a) => a.id === model && a.state !== "missing")) throw "no_provider";
        // Codex stands in for a failing harness so the error path is testable.
        if (model === "codex") throw "ai_failed";
        break;
      }
      case "ollama": {
        const daemon = agents.find((a) => a.id === "ollama");
        if (daemon?.state !== "connected") throw "ollama_offline";
        // A slot can outlive the model it names; no substituting another.
        if (!daemon.models?.includes(model)) throw "no_provider";
        break;
      }
      case "builtin": {
        const card = models.find((m) => m.id === model);
        if (!card) throw "not_found";
        if (card.state !== "ready") throw "not_ready";
        // The engine refuses before loading rather than swapping the machine.
        if (!card.fits) throw "model_too_large";
        if (llamaBusy) throw "llama_busy";
        break;
      }
      default:
        throw "no_provider";
    }
    return `${passage} — rewritten by ${model}`;
  },

  ai_apply_rewrite: ({ args }) => {
    const { path, file, from, to, text, provider, expected } = args as {
      path: string; file: string; from: number; to: number; text: string; provider: string; expected: string;
    };
    const p = project(path);
    const c = chapter(p, file);
    if (from < 0 || from > to || to > c.body.length) throw "bad_range";
    const deleted = c.body.slice(from, to);
    if (deleted !== expected) throw "stale_selection";
    if (p.dirty.size) commit(p, `checkpoint: before ai rewrite (${provider})`);
    c.body = c.body.slice(0, from) + text + c.body.slice(to);
    c.words = countWords(c.body);
    c.mtime = now();
    p.dirty.add(c.file);
    const author = `ai:${provider}`;
    const ops: Op[] = [];
    if (deleted) ops.push({ seq: 0, ts: 0, author, kind: "delete", from, to, text: deleted });
    if (text) ops.push({ seq: 0, ts: 0, author, kind: "insert", from, to: from + text.length, text });
    appendOps(p, c.id, ops);
    return publicChapter(c);
  },

  // Plugins used by the UI. The dialog returns the first project so "Open project" works.
  // The native pickers. `open` returns a project folder for "Open project" and
  // an importable file for the Manuscript dialog; the two are told apart by the
  // filters the caller passes.
  "plugin:dialog|open": ({ options }) => {
    const o = (options ?? {}) as { directory?: boolean; filters?: { extensions: string[] }[] };
    const extensions = o.filters?.flatMap((f) => f.extensions) ?? [];
    if (extensions.includes("scriv")) return "/mock/Documents/The Salt Road.scriv";
    if (extensions.length) return `/mock/Documents/import.${extensions[0]}`;
    return projects.keys().next().value ?? null;
  },
  "plugin:dialog|save": ({ options }) => {
    const o = (options ?? {}) as { defaultPath?: string; filters?: { extensions: string[] }[] };
    const extension = o.filters?.[0]?.extensions?.[0] ?? "out";
    return o.defaultPath ?? `/mock/Documents/novel.${extension}`;
  },
  "plugin:event|listen": () => Math.floor(Math.random() * 1e9),
  "plugin:event|unlisten": () => undefined,
  "plugin:window|destroy": () => undefined,
};

let nextCallback = 1;

const internals = {
  metadata: {
    currentWindow: { label: "main" },
    currentWebview: { label: "main", windowLabel: "main" },
    windows: [{ label: "main" }],
    webviews: [{ label: "main", windowLabel: "main" }],
  },
  transformCallback(callback: (payload: unknown) => void, once = false): number {
    const id = nextCallback++;
    const key = `_${id}`;
    Object.defineProperty(window, key, {
      value: (payload: unknown) => {
        if (once) Reflect.deleteProperty(window, key);
        return callback(payload);
      },
      writable: false,
      configurable: true,
    });
    return id;
  },
  unregisterCallback(id: number): void {
    Reflect.deleteProperty(window, `_${id}`);
  },
  convertFileSrc(path: string): string {
    return `asset://localhost/${encodeURIComponent(path)}`;
  },
  async invoke(cmd: string, args: Args = {}): Promise<unknown> {
    calls.push({ cmd, args });
    const handler = commands[cmd];
    if (!handler) {
      if (cmd.startsWith("plugin:")) return undefined;
      throw `unknown_command ${cmd}`;
    }
    // Same shape as Tauri: rejections are the Rust error code string.
    return handler(args);
  },
};

declare global {
  interface Window {
    __TAURI_INTERNALS__: typeof internals;
    __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: (event: string, id: number) => void };
    __VERSORIUM_MOCK__: {
      projects: Map<string, ProjectState>;
      settings: typeof settings;
      calls: typeof calls;
      agents: AgentInfo[];
      mcpClients: McpClient[];
      mcpLog: McpLogEntry[];
      models: ModelCard[];
      slots: Record<string, SlotAssignment>;
      lastExport: { path: string; bytes: number; format: string; warnings: string[] } | null;
      update: UpdateStatus;
      /** What GitHub answers the next check; specs set it, then press Check now. */
      github: MockGitHub;
      crashes: CrashEntry[];
      /** True once the app was asked to restart into the new version. */
      relaunched: boolean;
    };
  }
}

// `?mock=tauri&seed=2` starts with novels already on disk and none open — the
// state a returning writer actually sees, which no test could reach before
// because creating a project also opens it.
{
  const seed = Number(new URLSearchParams(location.search).get("seed") ?? 0);
  for (let i = 0; i < seed; i += 1) {
    const created = commands.create_project({
      args: { path: PROJECTS_DIR, title: `Novela ${i + 1}`, language: "es" },
    }) as { path: string };
    // Staggered so "most recently written" has an unambiguous answer.
    const p = projects.get(created.path);
    if (p) for (const c of p.chapters) c.mtime = 1_790_000_000 + i * 3600;
  }
}

window.__TAURI_INTERNALS__ = internals;
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };
Object.defineProperty(window, "__VERSORIUM_MOCK__", {
  value: {
    projects, settings, calls, agents, mcpClients, mcpLog, models, slots, update, github, crashes,
    get relaunched() {
      return relaunched;
    },
    get lastExport() {
      return lastExport;
    },
  },
  writable: false,
  configurable: true,
});

export {};
