// In-browser stand-in for the Tauri IPC so the UI runs in a plain browser
// (Playwright, Chrome DevTools). Loaded by src/main.ts only in `pnpm dev`
// with `?mock=tauri`; never bundled. Mirrors the Rust command contracts in
// src-tauri/src/commands with in-memory state exposed at window.__VERSORIUM_MOCK__.

import { BACKUP_STATE_EVENT } from "$lib/backup/events";
import shippedFonts from "../../fonts/catalog.json";
import tauriConf from "../../src-tauri/tauri.conf.json";
import {
  enabledCapabilities,
  refusal,
  resolveOpenUrl,
  urlAllowed,
  type Capability,
  type CapabilityEntry,
  type Manifest,
} from "./opener-acl";

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
  /** `synopsis:` in the chapter's frontmatter, as a Scrivener import keeps it. */
  synopsis?: string;
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
interface Imported {
  title: string;
  /** The source's language when a novel can take it; null when it gives none. */
  language: string | null;
  /** The tag as the source wrote it, usable or not. */
  declaredLanguage: string | null;
  chapters: ImportedChapter[];
  warnings: string[];
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
  outcome: "ok" | "preview" | "denied" | "error";
  /** `mcp::log::FORMAT`: 2 for a line this build wrote, 0 for one from before previews were logged apart. */
  format: number;
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

/** Mirrors `EditorSettings` in Rust: its steps, and the defaults of a fresh install. */
const EDITOR_STEPS: Record<string, readonly string[]> = {
  textSize: ["small", "medium", "large"],
  lineSpacing: ["compact", "comfortable", "airy"],
  textWidth: ["narrow", "medium", "wide"],
  tabKey: ["next", "indent"],
};
const EDITOR_FLAGS = ["spellcheck", "lineNumbers", "activeLine"];
/** Mirrors `LayoutSettings` in Rust: four booleans, all true on a fresh install. */
const LAYOUT_FLAGS = ["binderOpen", "topBarOpen", "focusHidesBinder", "focusHidesTopBar"];

const settings = {
  uiLocale: "en",
  theme: "folio",
  themeMode: "light",
  censorship: false,
  githubUpdatesToken: null as string | null,
  githubNovelToken: null as string | null,
  editorFont: "system-serif",
  // Legacy, never read by the app. `?mock=tauri&legacyFocus=1` is a file
  // written by the build that still restored Focus at launch.
  focusMode: new URLSearchParams(location.search).has("legacyFocus"),
  typewriter: false,
  // Already onboarded, so the tour does not sit on top of every other spec.
  // `?mock=tauri&fresh=1` simulates a first run instead.
  onboarded: !new URLSearchParams(location.search).has("fresh"),
  authorProfiles: {
    work: { name: "", sortAs: "", role: "", organization: "", rights: "" },
    hobby: { name: "", sortAs: "", role: "", organization: "", rights: "" },
  },
  authorProfile: "work",
  editor: {
    spellcheck: true,
    textSize: "medium",
    lineSpacing: "comfortable",
    textWidth: "medium",
    lineNumbers: false,
    activeLine: true,
    tabKey: "next",
  } as Record<string, string | boolean>,
  layout: {
    binderOpen: true,
    topBarOpen: true,
    focusHidesBinder: true,
    focusHidesTopBar: true,
  } as Record<string, boolean>,
};

/**
 * `?mock=tauri&persist=1` keeps the settings across a page reload, the way
 * settings.json outlives a relaunch, so a spec can prove a preference is read
 * back from storage rather than remembered by the page that set it. Off by
 * default: every other spec starts from the same settings on every load.
 */
const PERSIST = new URLSearchParams(location.search).has("persist");
const PERSISTED_SETTINGS = "versorium.mock.settings";
if (PERSIST) {
  const stored = sessionStorage.getItem(PERSISTED_SETTINGS);
  if (stored) Object.assign(settings, JSON.parse(stored));
}

function persistSettings(): void {
  if (PERSIST) sessionStorage.setItem(PERSISTED_SETTINGS, JSON.stringify(settings));
}

/**
 * Key by key, known values only, as `EditorSettings::apply` does. A plain
 * Object.assign would swap the whole block for whatever half of it a patch
 * carried, and accept a step Rust refuses.
 */
function applyEditorPatch(patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (EDITOR_FLAGS.includes(key) && typeof value === "boolean") settings.editor[key] = value;
    if (EDITOR_STEPS[key]?.includes(value as string)) settings.editor[key] = value as string;
  }
}

/** Key by key, JSON booleans only, as `LayoutSettings::apply` does. */
function applyLayoutPatch(patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (LAYOUT_FLAGS.includes(key) && typeof value === "boolean") settings.layout[key] = value;
  }
}

const projects = new Map<string, ProjectState>();
const calls: { cmd: string; args: Args }[] = [];

/**
 * Commands that fail, and with which code, until a spec deletes the entry:
 * `__VERSORIUM_MOCK__.failures.save_chapter = "io"` is a full disk for every
 * save. The call is still recorded, as Rust would have received it.
 */
const failures: Record<string, string> = {};

/**
 * What `plugin:opener|open_url` may open, worked out from the files the app
 * is built from (opener-acl.ts): the capabilities, tauri.conf.json's list of
 * them if it has one, and the plugins' ACL manifests tauri-build writes to
 * src-tauri/gen/schemas (tracked). Globbed rather than imported, so the
 * manifests' 70 KB are not a type TypeScript has to infer.
 */
const OPEN_URL = (() => {
  const unread = Object.keys(import.meta.glob("../../src-tauri/capabilities/*.{toml,json5}"));
  if (unread.length) throw new Error(`mock-tauri reads JSON capabilities only, not ${unread.join(", ")}`);
  const files = import.meta.glob<Capability>("../../src-tauri/capabilities/*.json", { eager: true, import: "default" });
  const [acl] = Object.values(
    import.meta.glob<Record<string, Manifest>>("../../src-tauri/gen/schemas/acl-manifests.json", { eager: true, import: "default" }),
  );
  const listed = (tauriConf.app.security as { capabilities?: CapabilityEntry[] }).capabilities;
  return resolveOpenUrl(enabledCapabilities(Object.values(files), listed), acl);
})();

/** Every address the system browser was handed, oldest first: what the opener accepted. */
const browser: string[] = [];

const GB = 1024 ** 3;

/// What `importer_for` in src-tauri/src/commands/formats.rs reads, for the
/// preview and the apply alike: `.txt` is Markdown there, though the picker
/// does not offer it.
const IMPORTABLE = /\.(md|markdown|txt|docx|scriv|epub)$/i;

/// What a Scrivener import would surface: chapters plus what could not cross.
/// A spec may change it (`__VERSORIUM_MOCK__.importPreview`) before choosing a
/// file: a Scrivener project names no language, so neither does this.
const importPreview: Imported = {
  title: "The Salt Road",
  language: null,
  declaredLanguage: null,
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

interface FontEntry {
  id: string; family: string; role: string; stack: string;
  license: string; bundled: boolean; available: boolean; note: string;
}

/**
 * The catalogue Rust embeds (`fonts/catalog.json`), as `fonts_catalog` sends
 * it: the file's own `note` is not part of the wire shape. A spec may add a
 * face through `__VERSORIUM_MOCK__.fonts`, before Settings reads the list.
 */
const fonts: { version: number; defaultBody: string; fonts: FontEntry[] } = {
  version: shippedFonts.version,
  defaultBody: shippedFonts.defaultBody,
  fonts: shippedFonts.fonts.map((font) => ({ ...font })),
};

/**
 * Mirrors `fonts::resolve` and `fonts::EditorFont`: the stored id's face, or
 * the default's, under its own id, when settings name a face this catalogue
 * lacks.
 */
/** As `fonts::resolve`: a body face the catalogue holds, else the default. */
function editorFont(id: unknown): { id: string; stack: string } {
  const entry =
    fonts.fonts.find((font) => font.id === id && font.role === "body") ??
    fonts.fonts.find((font) => font.id === fonts.defaultBody);
  if (!entry) throw "bad_font_catalog";
  return { id: entry.id, stack: entry.stack };
}

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

/**
 * The local server the writer may save. `running` and `models` are what it
 * would answer; `models_view` reports them only while it is saved, because
 * Rust asks it nothing before then. A spec stops it with
 * `__VERSORIUM_MOCK__.studio.running = false`.
 */
const studio = { host: "127.0.0.1", port: 1234, enabled: false, running: true, models: ["local-model"] };

/** Mirrors `commands::models::studio_view`. */
function studioView() {
  const answering = studio.enabled && studio.running;
  return {
    host: studio.host,
    port: studio.port,
    enabled: studio.enabled,
    running: answering,
    models: answering ? [...studio.models] : [],
  };
}

/**
 * The Ollama daemon as `models_view` and `agents_detect` see it. A spec makes
 * it stop or empty it (`__VERSORIUM_MOCK__.ollama.running = false`); the
 * rewrite and the continuity check read the same object.
 */
const ollama = {
  running: true,
  installed: true,
  models: [{ name: "qwen3.8:latest", sizeBytes: 17_741_872_154, modified: "2026-09-04T11:30:22Z" }],
};

function ollamaServes(tag: string): boolean {
  return ollama.running && ollama.models.some((m) => m.name === tag);
}

/** Mirrors `agents::is_loopback`: 127.0.0.0/8, `::1` and `localhost`. */
function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
  if (h === "localhost" || h === "::1") return true;
  const parts = h.split(".");
  return parts.length === 4 && parts[0] === "127" && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/** Every task whose model was `kind`/`id` (or any of `kind`, without an id) goes back to none. */
function releaseSlots(kind: string, id?: string): void {
  for (const key of Object.keys(slots)) {
    if (slots[key].kind === kind && (id === undefined || slots[key].id === id)) slots[key] = { kind: "none", id: "" };
  }
}

const mcpClients: McpClient[] = [
  { id: "claude-code", name: "Claude Code", configPath: "/mock/project/.mcp.json", detected: true, installed: false, writeAllowed: false },
  { id: "claude-desktop", name: "Claude Desktop", configPath: "/mock/Library/Claude/claude_desktop_config.json", detected: true, installed: false, writeAllowed: false },
  { id: "codex", name: "Codex", configPath: "/mock/.codex/config.toml", detected: true, installed: false, writeAllowed: false },
  { id: "opencode", name: "OpenCode", configPath: "/mock/.config/opencode/opencode.json", detected: false, installed: false, writeAllowed: false },
];

// Oldest first, as the file is written; `mcp_log` answers newest first. The
// preview mirrors mcp::tools::call, which logs a write that only returned its
// diff as `preview`, never `ok`; every line carries the log's format, 2.
const mcpLog: McpLogEntry[] = [
  { ts: 1_759_000_000_000, client: "claude-code", tool: "read_document", scope: "read", outcome: "ok", detail: "manuscript/ch-01-the-long-winter.md", format: 2 },
  { ts: 1_759_000_030_000, client: "claude-desktop", tool: "replace_text", scope: "write", outcome: "preview", detail: "manuscript/ch-01-the-long-winter.md · 412 chars", format: 2 },
  { ts: 1_759_000_060_000, client: "codex", tool: "write_document", scope: "write", outcome: "denied", detail: "write not allowed for codex", format: 2 },
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

/**
 * Whether a backup is running, as Rust's `backup_state` reports it, and what
 * the next Back up now answers instead of the mock's own outcomes. A spec sets
 * `nextOutcomes` to see `failed`, `repaired` or a held prune, which the mock
 * never produces on its own; it is used once.
 */
const backup = {
  running: null as null | { project: string; startedAt: number },
  seq: 0,
  nextOutcomes: null as null | unknown[],
  /** End the run in progress just before the page's next listener for the
   *  backup state is registered: the event it would have heard is gone. */
  endOnNextListen: false,
};

/**
 * A press held before it starts, as one queued behind another run waits in
 * Rust, so a spec can look at the panel while its own press is pending.
 */
let backupHold: Promise<void> | null = null;
let releaseHold: (() => void) | null = null;

function holdBackup(): void {
  backupHold = new Promise((resolve) => (releaseHold = resolve));
}

function releaseBackup(): void {
  releaseHold?.();
  backupHold = releaseHold = null;
}

/** Waiting for the run in progress to end, as Rust's queue does. */
const backupWaiters: (() => void)[] = [];

function backupEnded(): Promise<void> {
  return new Promise((resolve) => backupWaiters.push(resolve));
}

/**
 * Listeners registered through `plugin:event|listen`. Tauri delivers an event
 * by calling the handler `transformCallback` registered on `window`, so
 * `emit` does exactly that, and a spec can send what Rust would send.
 */
const listeners = new Map<number, { event: string; handler: number }>();
let nextListener = 1;

function emit(event: string, payload: unknown): void {
  for (const [id, listener] of listeners) {
    if (listener.event !== event) continue;
    const handler = Reflect.get(window, `_${listener.handler}`);
    if (typeof handler === "function") handler({ event, id, payload });
  }
}

/** A backup starts or ends, and the page is told, as `backup_now` does. */
function setBackupRunning(running: typeof backup.running): void {
  backup.running = running;
  backup.seq += 1;
  emit(BACKUP_STATE_EVENT, { running, seq: backup.seq });
  if (running === null) backupWaiters.splice(0).forEach((wake) => wake());
}

/** How many listeners the page has for `event` right now. */
function listening(event: string): number {
  return [...listeners.values()].filter((listener) => listener.event === event).length;
}

/** The mock's own Back up now: the real rule, without hashing anything. */
function backupNow(): unknown[] {
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
}

let mcpHttpEnabled = false;

let llamaWarmCalls = 0;
let llamaBusy = false;

/** `__VERSORIUM_MOCK__.llama.failed = true`: the engine did not start on this computer. */
const llama = { failed: false };

/**
 * The GPU check (src-tauri/src/gpu). `?gpu=unavailable` is a Windows PC with
 * an NVIDIA card and no Vulkan; `?gpu=cpu` a Linux laptop whose Intel GPU has
 * no Vulkan driver (only llvmpipe). Default: a Mac, ready on Metal. Check
 * again moves to `gpu.next` when a spec set one, as installing a driver would.
 */
type MockGpu = import("$lib/tauri").GpuReadiness;
const GPU_STATES: Record<string, MockGpu> = {
  ready: {
    state: "ready", backend: "metal", platform: "macos", loaderPresent: true,
    gpus: [], missing: [], hints: [], driver: null,
  },
  unavailable: {
    state: "unavailable", backend: "none", platform: "windows", loaderPresent: false,
    gpus: [{ name: "NVIDIA GeForce RTX 3060", vendor: "nvidia", driver: null, vulkan: null, deviceType: null, memoryMb: null, usable: false }],
    missing: ["vulkan_loader"], hints: [],
    driver: { vendor: "nvidia", url: "https://www.nvidia.com/Download/index.aspx" },
  },
  cpu: {
    state: "cpu", backend: "cpu", platform: "linux", loaderPresent: true,
    gpus: [
      { name: "llvmpipe (LLVM 17.0.6, 256 bits)", vendor: "software", driver: "Mesa 24.0.5", vulkan: "1.3", deviceType: "cpu", memoryMb: null, usable: false },
      { name: "Intel GPU 5917", vendor: "intel", driver: "i915", vulkan: null, deviceType: null, memoryMb: null, usable: false },
    ],
    missing: ["vulkan_driver"], hints: [],
    driver: { vendor: "intel", url: "https://www.intel.com/content/www/us/en/support/detect.html" },
  },
};
const gpu: { current: MockGpu | null; next: MockGpu | null } = {
  current: GPU_STATES[new URLSearchParams(location.search).get("gpu") ?? "ready"] ?? GPU_STATES.ready,
  next: null,
};

/// Mirrors settings::SLOT_KINDS; Rust rejects anything else as `bad_args`.
const SLOT_KINDS = ["none", "builtin", "ollama", "server", "cli"];

const agents: AgentInfo[] = [
  { id: "claude", name: "Claude Code", path: "/mock/bin/claude", version: "2.1.0", state: "connected", models: null },
  { id: "codex", name: "Codex", path: "/mock/bin/codex", version: "0.9.0", state: "connected", models: null },
  { id: "opencode", name: "OpenCode", path: null, version: null, state: "missing", models: null },
  { id: "ollama", name: "Ollama", path: "/mock/bin/ollama", version: "0.6.0", state: "connected", models: ["qwen3.8:latest"] },
  { id: "gh", name: "GitHub CLI", path: "/mock/bin/gh", version: "2.60.0", state: "connected", models: null },
];

// `?mock=tauri&agents=none`: no assistant on this computer. A URL switch
// rather than a change made from a spec, because the app scans once at
// launch and keeps the answer for the session (src/lib/ai/agents.ts).
if (new URLSearchParams(location.search).get("agents") === "none") {
  for (const agent of agents) {
    if (agent.id !== "ollama") Object.assign(agent, { state: "missing", path: null, version: null });
  }
}

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
  const { body: _body, synopsis: _synopsis, ...meta } = c;
  return meta;
}

/** Mirrors `LANGUAGES` in src-tauri/src/commands/project.rs. */
const LANGUAGES = ["en", "es"];

/**
 * Mirrors `language_code` in Rust: the code a tag names when a novel can take
 * it (`es-MX` and `ES_mx` are `es`), or null.
 */
function languageCode(raw: unknown): string | null {
  const tag = String(raw ?? "").trim().toLowerCase().replace(/_/g, "-");
  if (!/^[a-z]{2,3}(-[a-z0-9]{1,8})*$/.test(tag)) return null;
  const primary = tag.split("-")[0];
  return LANGUAGES.includes(primary) ? primary : null;
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
    const { path, title, language: raw } = args as { path: string; title: string; language: string };
    const clean = title.trim();
    if (!clean) throw "empty_title";
    const language = languageCode(raw);
    if (!language) throw "bad_language";
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
    const frontmatter: Record<string, string> = { id: c.id, title: c.title, status: c.status, words: String(c.words) };
    if (c.synopsis) frontmatter.synopsis = c.synopsis;
    return { frontmatter, body: c.body };
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

  get_settings: () => ({
    ...settings,
    editor: { ...settings.editor },
    layout: { ...settings.layout },
    backupDirs: [...backupDirs],
    backupKeep,
  }),
  set_settings: ({ patch }) => {
    const { editor, layout, ...rest } = (patch ?? {}) as Partial<typeof settings> & {
      editor?: Record<string, unknown>;
      layout?: Record<string, unknown>;
    };
    Object.assign(settings, rest);
    if (editor && typeof editor === "object") applyEditorPatch(editor);
    if (layout && typeof layout === "object") applyLayoutPatch(layout);
    persistSettings();
    // The legacy settings field still counts as a saved token, as in Rust.
    update.tokenSet = Boolean(settings.githubUpdatesToken) || storedSecrets.has("updates");
    return { ...settings, editor: { ...settings.editor }, layout: { ...settings.layout } };
  },

  update_project: ({ path, title, author, exportCover, exportColophon, language }) => {
    const p = project(String(path));
    // Every check before any write, as in Rust: a refused call changes nothing.
    if (title != null && !String(title).trim()) throw "empty_title";
    const code = language == null ? null : languageCode(language);
    if (language != null && !code) throw "bad_language";
    if (title == null && author == null && exportCover == null && exportColophon == null && language == null) {
      throw "bad_args";
    }
    if (title !== undefined && title !== null) {
      p.meta.title = String(title).trim();
    }
    if (code) p.meta.language = code;
    if (author !== undefined && author !== null) p.meta.author = String(author).trim();
    if (exportCover !== undefined && exportCover !== null) p.meta.exportCover = Boolean(exportCover);
    if (exportColophon !== undefined && exportColophon !== null) {
      p.meta.exportColophon = Boolean(exportColophon);
    }
    return { ...p.meta };
  },
  // Mirrors the real command: the folder goes to the system trash, and what
  // comes back is the remaining projects.
  delete_project: ({ path }) => {
    if (!projects.has(String(path))) throw "not_found";
    projects.delete(String(path));
    return [...projects.values()].map((p) => ({ ...publicProject(p), meta: { ...p.meta } }));
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
    return publicChapter(c);
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
    return p.chapters.map(publicChapter);
  },

  delete_chapter: ({ path, file }) => {
    const p = project(String(path));
    const index = p.chapters.findIndex((c) => c.file === String(file));
    if (index < 0) throw "not_found";
    // The real command snapshots before removing, which is what makes this
    // recoverable; the mock records the commit so a test can see it happened.
    // A clean tree is already snapshotted, so, as in Rust, that is no reason
    // to refuse: without this a second delete in a row failed only here.
    try {
      commit(p, `checkpoint: before deleting ${file}`);
    } catch (error) {
      if (error !== "nothing_to_commit") throw error;
    }
    p.chapters.splice(index, 1);
    return p.chapters.map(publicChapter);
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

  // Ollama's entry is the daemon's state, as `agents_detect` merges it in Rust:
  // connected while it answers, detected with only its binary.
  agents_detect: () =>
    agents.map((a) =>
      a.id === "ollama"
        ? {
            ...a,
            state: ollama.running ? "connected" : ollama.installed ? "detected" : "missing",
            path: ollama.installed ? a.path : null,
            models: ollama.running ? ollama.models.map((m) => m.name) : null,
          }
        : { ...a, models: a.models ? [...a.models] : null },
    ),

  // --- M7: polish ---
  crash_list: ({ limit }) => crashes.slice(0, Number(limit ?? 20)),
  crash_report_url: ({ id }) => {
    if (!crashes.some((c) => c.id === id)) throw "not_found";
    return `https://github.com/mock/versorium-app/issues/new?title=crash&body=redacted`;
  },
  crash_clear: () => {
    crashes.length = 0;
  },
  // Mirrors continuity::check: it runs on a model on this computer, or says
  // why it did not, and never pretends a run that did not happen was clean.
  continuity_check: () => {
    const slot = slots.continuity;
    const skipped = (reason: string) => ({ ran: false, reason, findings: [] });
    switch (slot.kind) {
      case "builtin": {
        // As continuity::builtin_check: a busy engine first, then the model.
        if (llamaBusy) return skipped("continuity_busy");
        const card = models.find((m) => m.id === slot.id);
        if (!card || card.state !== "ready") return skipped("continuity_no_model");
        if (!card.fits) return skipped("continuity_model_too_large");
        break;
      }
      case "ollama":
        if (!ollama.running) return skipped("continuity_daemon_offline");
        if (!ollamaServes(slot.id)) return skipped("continuity_no_model");
        break;
      case "server":
        if (!studio.enabled) return skipped("continuity_no_model");
        if (!studio.running) return skipped("continuity_server_offline");
        if (!studio.models.includes(slot.id)) return skipped("continuity_no_model");
        break;
      default:
        return skipped("continuity_no_model");
    }
    return { ran: true, reason: null,
             findings: [{ kind: "contradiction", detail: "Ana's eyes change colour.", chapter: "ch-02" }] };
  },
  fonts_catalog: () => JSON.parse(JSON.stringify(fonts)),
  editor_font: () => editorFont(settings.editorFont),
  set_editor_font: ({ id }) => {
    // As `fonts::find_for_page`: only the body faces Typography offers.
    if (!fonts.fonts.some((f) => f.id === id && f.role === "body")) throw "bad_args";
    settings.editorFont = String(id);
    persistSettings();
    return editorFont(settings.editorFont);
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
    if (!IMPORTABLE.test(String(source))) throw "unsupported_source";
    return JSON.parse(JSON.stringify(importPreview));
  },
  // Mirrors `import_into`: the language checked before anything is read, the
  // previewed chapters in place of the placeholder, and each synopsis kept on
  // its chapter.
  import_apply: ({ source, title, language }) => {
    const code = languageCode(language);
    if (!code) throw "bad_language";
    if (!IMPORTABLE.test(String(source))) throw "unsupported_source";
    const imported = JSON.parse(JSON.stringify(importPreview)) as Imported;
    if (imported.chapters.length === 0) throw "empty_document";
    const chosen = String(title ?? "").trim() || imported.title;
    const created = commands.create_project({ args: { path: PROJECTS_DIR, title: chosen, language: code } }) as {
      path: string;
    };
    const p = project(created.path);
    p.chapters = imported.chapters.map((c, i) => {
      const synopsis = (c.synopsis ?? "").replace(/\r\n?/g, "\n").trim();
      return {
        ...newChapter(i + 1, c.title),
        body: c.body,
        words: countWords(c.body),
        ...(synopsis ? { synopsis } : {}),
      };
    });
    for (const c of p.chapters) p.dirty.add(c.file);
    return publicProject(p);
  },
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
                os: "macos", gpu: "Metal (Apple M4 Max)", recommendedTier: "midPlus" },
    slots: { ...slots },
    progress: downloadProgress,
    ollama: {
      running: ollama.running,
      installed: ollama.installed,
      models: ollama.running ? ollama.models.map((m) => ({ ...m })) : [],
    },
    studio: studioView(),
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

    return new Promise<void>((resolve, reject) => {
      let received = 0;
      // Slower than one poll interval on purpose: a real download takes
      // minutes, and a mock that finishes inside 700ms would let a panel that
      // shows nothing during a transfer pass this suite.
      const step = model.sizeBytes / 12;
      const timer = setInterval(() => {
        // Cancelled: the command rejects, as `download::start` does, and the
        // part already fetched stays (the model is partial, to be resumed).
        if (downloadProgress?.id !== id) {
          clearInterval(timer);
          model.receivedBytes = received;
          reject("cancelled");
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
  // Mirrors commands::models::set_slot_in: a slot names something that is
  // there now, or it is refused and nothing changes.
  models_set_slot: ({ slot, kind, id }) => {
    const name = String(slot);
    const model = String(id ?? "");
    if (!(name in slots) || !SLOT_KINDS.includes(String(kind))) throw "bad_args";
    if (kind === "builtin") {
      // As set_slot_in: an id the catalogue does not know, then one not downloaded.
      const card = models.find((m) => m.id === model);
      if (!card) throw "not_found";
      if (card.state !== "ready") throw "not_ready";
    }
    if (kind === "ollama" && !ollamaServes(model)) throw "not_found";
    if (kind === "server") {
      if (!model.trim()) throw "bad_args";
      if (!studio.enabled || !studio.running || !studio.models.includes(model)) throw "not_found";
    }
    if (kind === "cli" && !model.trim()) throw "bad_args";
    slots[name] = kind === "none" ? { kind: "none", id: "" } : { kind: String(kind), id: model };
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
  backup_now: async ({ path }) => {
    if (backupDirs.length === 0) throw "backup_not_configured";
    await backupHold;
    // One run at a time: a press waits for the one in progress, then makes
    // its own, as `flight::exclusive` does.
    while (backup.running) await backupEnded();
    setBackupRunning({ project: String(path), startedAt: now() });
    try {
      const scripted = backup.nextOutcomes;
      if (scripted) {
        backup.nextOutcomes = null;
        return scripted;
      }
      return backupNow();
    } finally {
      setBackupRunning(null);
    }
  },
  backup_state: () => ({ running: backup.running, seq: backup.seq }),
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

  gpu_readiness: () => gpu.current,
  gpu_check_again: () => {
    if (gpu.next) gpu.current = gpu.next;
    return gpu.current;
  },
  llama_backend: () => {
    if (llama.failed) return { state: "failed", device: null, gpuOffload: false };
    if (gpu.current?.state === "unavailable") return { state: "unavailable", device: null, gpuOffload: false };
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

  // Mirrors agents::ollama_pull: the daemon has to be there, and the tag is
  // then one of its models.
  ollama_pull: ({ name }) => {
    const tag = String(name ?? "").trim();
    if (!tag) throw "bad_args";
    if (!ollama.running) throw "ollama_offline";
    if (!ollama.models.some((m) => m.name === tag)) {
      ollama.models.push({ name: tag, sizeBytes: 2_620_000_000, modified: new Date().toISOString() });
    }
    return undefined;
  },
  // Mirrors commands::models::ollama_remove: the tag goes, and so does every
  // task that used it (`clear_slots_matching`).
  ollama_remove: ({ name }) => {
    const tag = String(name ?? "").trim();
    if (!tag) throw "bad_args";
    if (!ollama.running) throw "ollama_offline";
    const at = ollama.models.findIndex((m) => m.name === tag);
    if (at < 0) throw "ollama_failed";
    ollama.models.splice(at, 1);
    releaseSlots("ollama", tag);
    return undefined;
  },
  // The one fake server answers at the address saved for it, while it runs.
  studio_test: ({ host, port }) =>
    studio.running && String(host ?? "").trim() === studio.host && Number(port) === studio.port,
  // Mirrors studio_save: saving keeps the tasks; forgetting releases every
  // task that ran on the server, and so does saving it at another
  // computer's address.
  studio_save: ({ host, port, enabled }) => {
    const trimmed = String(host ?? "").trim();
    if (!trimmed || !Number(port)) throw "bad_args";
    const elsewhere = !isLoopbackHost(trimmed) && trimmed.toLowerCase() !== studio.host.toLowerCase();
    studio.host = trimmed;
    studio.port = Number(port);
    studio.enabled = Boolean(enabled);
    if (!studio.enabled || elsewhere) releaseSlots("server");
    return studioView();
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
    // Mirrors commands::mcp::set_write_in: a grant needs the client connected;
    // taking one back always goes through.
    if (allowed && !c.installed) throw "mcp_client_not_connected";
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
        if (!ollama.running) throw "ollama_offline";
        // A slot can outlive the model it names; no substituting another.
        if (!ollamaServes(model)) throw "no_provider";
        break;
      }
      case "server": {
        // Mirrors agents::server_rewrite: only a saved server, only while it
        // answers, only a model it serves.
        if (!studio.enabled) throw "no_provider";
        if (!studio.running) throw "server_offline";
        if (!studio.models.includes(model)) throw "no_provider";
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
  "plugin:event|listen": ({ event, handler }) => {
    if (event === BACKUP_STATE_EVENT && backup.endOnNextListen) {
      backup.endOnNextListen = false;
      setBackupRunning(null);
    }
    const id = nextListener++;
    listeners.set(id, { event: String(event), handler: Number(handler) });
    return id;
  },
  "plugin:event|unlisten": ({ eventId }) => {
    listeners.delete(Number(eventId));
  },
  "plugin:window|destroy": () => undefined,
  // The opener answers as the plugin would under the app's capabilities: an
  // address its scope does not allow is refused in the plugin's words and
  // never reaches the browser.
  "plugin:opener|open_url": ({ url, with: program }) => {
    const address = String(url);
    const named = program == null ? undefined : String(program);
    if (!OPEN_URL.granted) throw "opener.open_url not allowed by the capabilities in src-tauri/capabilities";
    if (!urlAllowed(OPEN_URL, address, named)) throw refusal(address, named);
    browser.push(address);
  },
  // Rust's half of "quitting waits for the last save" (src-tauri/src/quit.rs):
  // the answer is in `calls`, as `{ saved }`.
  quit_ready: () => undefined,
};

let nextCallback = 1;

/**
 * Commands whose next call waits until a spec releases it, by name: how a
 * spec acts while an answer from Rust is still on its way. The call is in
 * `calls` as soon as it is made.
 */
const holds = new Map<string, { taken: boolean; open: Promise<void>; release: () => void }>();

function hold(cmd: string): void {
  let release = () => {};
  const open = new Promise<void>((resolve) => (release = resolve));
  holds.set(cmd, { taken: false, open, release });
}

function release(cmd: string): void {
  holds.get(cmd)?.release();
  holds.delete(cmd);
}

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
    const held = holds.get(cmd);
    if (held && !held.taken) {
      held.taken = true;
      await held.open;
    }
    if (cmd in failures) throw failures[cmd];
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
      /** Commands that reject, by name, with the code given. */
      failures: typeof failures;
      agents: AgentInfo[];
      /** The Ollama daemon: running, installed, and the tags it serves. */
      ollama: typeof ollama;
      /** The local server: saved (`enabled`), answering, and what it serves. */
      studio: typeof studio;
      /** The in-process engine: `failed` makes `llama_backend` answer that it did not start. */
      llama: typeof llama;
      mcpClients: McpClient[];
      mcpLog: McpLogEntry[];
      models: ModelCard[];
      slots: Record<string, SlotAssignment>;
      lastExport: { path: string; bytes: number; format: string; warnings: string[] } | null;
      update: UpdateStatus;
      /** What GitHub answers the next check; specs set it, then press Check now. */
      github: MockGitHub;
      crashes: CrashEntry[];
      /** Every address the system browser was handed, oldest first: what the opener accepted. */
      browser: string[];
      /** True once the app was asked to restart into the new version. */
      relaunched: boolean;
      /** The GPU check: what `gpu_readiness` answers, and what Check again moves to. */
      gpu: { current: import("$lib/tauri").GpuReadiness | null; next: import("$lib/tauri").GpuReadiness | null };
      gpuStates: Record<string, import("$lib/tauri").GpuReadiness>;
      /** A backup in progress, and the outcomes the next Back up now returns. */
      backup: typeof backup;
      /** Start or end a backup the way Rust reports it. */
      setBackupRunning: typeof setBackupRunning;
      /** Hold the next Back up now before it starts, and let it go. */
      holdBackup: typeof holdBackup;
      releaseBackup: typeof releaseBackup;
      /** Send an event to the page, as Rust's `emit` does. */
      emit: typeof emit;
      /** How many listeners the page has for an event. */
      listening: typeof listening;
      /** The font catalogue `fonts_catalog` answers; a spec may add a face to it. */
      fonts: typeof fonts;
      /** What the next import preview reads; a spec may give it a language. */
      importPreview: Imported;
      /** Make the next call of a command wait, and let it go. */
      hold: typeof hold;
      release: typeof release;
    };
  }
}

// `?mock=tauri&seed=2` starts with novels already on disk and none open — the
// state a returning writer actually sees, which no test could reach before
// because creating a project also opens it.
//
// `&seedLanguage=fr` gives them that language as a hand-edited
// versorium.json would hold it, which create_project itself refuses.
{
  const params = new URLSearchParams(location.search);
  const seed = Number(params.get("seed") ?? 0);
  const seedLanguage = params.get("seedLanguage");
  for (let i = 0; i < seed; i += 1) {
    const created = commands.create_project({
      args: { path: PROJECTS_DIR, title: `Novela ${i + 1}`, language: "es" },
    }) as { path: string };
    // Staggered so "most recently written" has an unambiguous answer.
    const p = projects.get(created.path);
    if (p) for (const c of p.chapters) c.mtime = 1_790_000_000 + i * 3600;
    if (p && seedLanguage) p.meta.language = seedLanguage;
  }
}

window.__TAURI_INTERNALS__ = internals;
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
  unregisterListener: (_event: string, id: number) => {
    listeners.delete(id);
  },
};
Object.defineProperty(window, "__VERSORIUM_MOCK__", {
  value: {
    projects, settings, calls, failures, agents, ollama, studio, llama, gpu, gpuStates: GPU_STATES, mcpClients, mcpLog, models, slots, update, github, crashes, browser,
    backup, setBackupRunning, holdBackup, releaseBackup, emit, listening, fonts, importPreview, hold, release,
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
