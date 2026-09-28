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
    language: string;
    uiLanguage: string;
    defaultChapterPattern: string;
    censorship: string;
    remote: string | null;
  };
  chapters: Chapter[];
  commits: Commit[];
  dirty: Set<string>;
  ops: Record<string, Op[]>;
  seq: Record<string, number>;
  branches: string[];
  remotes: { name: string; url: string }[];
}

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
};

const projects = new Map<string, ProjectState>();
const calls: { cmd: string; args: Args }[] = [];

const GB = 1024 ** 3;

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
  list_projects: () => [...projects.values()].map(publicProject),

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
        uiLanguage: "en",
        defaultChapterPattern: "ch-{n}-{slug}.md",
        censorship: "off",
        remote: null,
      },
      chapters: [newChapter(1, clean)],
      commits: [],
      dirty: new Set(),
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
    c.body = String(body);
    c.words = countWords(c.body);
    if (typeof status === "string") c.status = status;
    c.mtime = now();
    p.dirty.add(c.file);
    return publicChapter(c);
  },

  get_settings: () => ({ ...settings }),
  set_settings: ({ patch }) => {
    Object.assign(settings, patch as Partial<typeof settings>);
    return { ...settings };
  },

  git_status: ({ path }) => {
    const p = project(path);
    return { branch: "main", modified: [...p.dirty], staged: [], untracked: [], ahead: 0, behind: 0 };
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
    if (String(token).startsWith("ghp_")) return "mock-writer";
    throw "bad_token";
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
  models_download: ({ id }) => {
    const model = models.find((m) => m.id === id);
    if (!model) throw "not_found";
    if (downloadProgress && !downloadProgress.done) throw "download_busy";
    model.state = "partial";
    downloadProgress = { id: String(id), received: model.sizeBytes / 2, total: model.sizeBytes, done: false };
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

  ai_rewrite: ({ provider, text }) => {
    const passage = String(text).trim();
    if (!passage) throw "ai_empty";
    if (!agents.some((a) => a.id === provider && a.state !== "missing")) throw "no_provider";
    // Codex stands in for a failing harness so the error path is testable.
    if (provider === "codex") throw "ai_failed";
    return `${passage} — rewritten by ${provider}`;
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
  "plugin:dialog|open": () => projects.keys().next().value ?? null,
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
    };
  }
}

window.__TAURI_INTERNALS__ = internals;
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => undefined };
window.__VERSORIUM_MOCK__ = { projects, settings, calls, agents, mcpClients, mcpLog, models, slots };

export {};
