# Versorium — developer reference

The technical detail that used to live in the root README: the rules the
project keeps, what is in the app, updates, building from source, agents, the
MCP server and a novel's layout on disk. The writer-facing introduction is
[README.md](../../README.md) ([español](../../README.es.md)); how to work on the
code is [AGENTS.md](../../AGENTS.md); the other project documents are listed in
[this folder's index](README.md).

## Rules this project keeps

- Local-first. No SaaS, no account, no telemetry.
- One `.md` file per chapter, inside a folder you own.
- MCP starts read-only. Writing needs a per-client grant, made in a dialog that
  shows the warning (Settings → Access to your novel → Allow writing…), only
  for an app that is connected, and every write except `git_commit` is
  preceded by a Git checkpoint (`git_commit` is itself the restore point).
- English and Spanish throughout, with no hardcoded UI strings.
- Themes Folio, Quarry and Needle, each light and dark.
- Stack: Tauri 2 + Rust + Svelte 5 + CodeMirror 6 + git2.
- The app's repository and your novels' repositories never mix.
- Crash logs never contain novel text.

## What is in the app

- **Projects as folders.** Each novel is a Git repository from the moment it is
  created (libgit2, no system `git` needed). Chapters can be created, renamed,
  reordered, given a status and deleted; deleting a novel sends its folder to
  the system trash.
- **Character-level history.** Every insert and delete is appended to an ops
  log in the novel's folder with its author (you, or `ai:<name>`), and a full
  copy of the chapter is saved every 200 ops. No screen reads those snapshots
  back yet.
- **Restore.** The status bar's Restore button (or Cmd/Ctrl+Alt+R) rolls back
  the word at the cursor, or the selected text, using the edits you typed in
  the current editor session for that chapter (up to the last 1000). That
  in-memory history is cleared when you switch chapters and whenever the chapter
  changes from outside the editor — an applied AI rewrite or an MCP edit
  included. An AI or MCP change can only be undone through the Git checkpoint
  commit made before it, and the app has no screen for checking out an earlier
  commit yet, so today that means using Git on the novel's folder.
- **Snapshots and backup.** Snapshots are Git commits. Backup writes a
  timestamped zip to up to three folders (cloud-synced folders and other disks
  are detected) and reports, per destination, whether it leaves the machine. A
  novel can also be pushed to and pulled from GitHub. GitHub tokens are kept in
  the OS credential store (Keychain, Credential Manager or Secret Service).
- **Editor.** CodeMirror 6, with focus mode, typewriter mode and a corkboard of
  chapter cards. Spelling is checked as you type by the operating system's own
  checker, and nothing is corrected for you. That is shown on macOS and on
  Windows 11; Linux does not check the manuscript yet.
  Settings → Editor turns it off, and sets the text size, line spacing and
  text width, line numbers (off by default), the band behind the current
  paragraph, and whether Tab indents or moves to the next control (it moves,
  by default).
- **Rewrite with AI.** See [Agents](#agents).
- **Local models.** A catalogue of 12 GGUF models in `models/catalog.json`
  (11 writing models from about 0.6 GB to 17 GB, plus one embedding model).
  Nothing downloads on its own; downloads resume and are checked against a
  sha256. A built-in llama.cpp runtime runs them in-process — Metal on macOS,
  Vulkan in the Windows and Linux release builds, CPU otherwise. Ollama models
  can be used as well, and, from v0.1.1, so can a local server (LM Studio,
  llama-server, or any app serving the OpenAI API): once saved under Settings → Models, its
  models can do Rewrite and Continuity. Settings → Tasks says which model does
  each, and where the passage goes with that choice. Saving the server at
  another computer's address releases the tasks that ran on it, so no passage
  goes to another machine unless it was chosen for that task.
- **Continuity check.** Manuscript → Continuity sends chapter titles, scene
  headings and the opening of codex entries (not the manuscript) to the model
  chosen for Continuity — built in, in Ollama, or on the local server — and
  says so plainly when it could not run.
- **Import and export.** Export to Markdown, DOCX, EPUB 3, PDF and Scrivener;
  import from Markdown, DOCX, EPUB and Scrivener. An import takes the novel's
  language from the source when the source gives one and asks when it does
  not (Project settings changes it later), and Scrivener synopses come across
  onto the corkboard's cards. Each direction states what it could not carry.
  Details per format: [FORMATS.md](FORMATS.md).
- **Author metadata.** Two author profiles (work and personal) written into the
  exported files; an optional title page and colophon per project.
- **Crash log.** Kept on disk only, scrubbed of prose, paths, emails and tokens.
  Nothing is sent unless you press Report, which opens a prefilled GitHub issue
  in your browser.
- **First run** with no signup, every step skippable.

Not there yet (from [TODO.md](TODO.md)): Settings → Tasks lists project chat,
search by meaning and dictation under "Not built yet" — there is no chat, no
search by meaning, and no Whisper model for dictation.

## Updates

Settings → Application → Updates checks GitHub Releases. The updater verifies
each download twice — the minisign signature against the public key compiled
into the app, and the sha256 against the release's `SHA256SUMS` — and refuses
anything that fails either check. Every request it makes goes to
`api.github.com`, and the owner and repository are compiled in, not
configurable. When GitHub redirects a download to its storage host, the
updater follows that one hop and no further.

One update has been done end to end, from 0.1.0 to 0.1.1, with the in-app
updater: on macOS (Apple silicon) and on Windows 11. It has not been done on
Linux or an Intel Mac.

No GitHub token is needed. Without one the check is anonymous, which is all a
public repository requires (the rule since 2026-10-03; see §11 of
[PROMPT-VERSORIUM.md](PROMPT-VERSORIUM.md)). A token saved under Settings →
Application → **Updates token (optional)** is still sent, and only to
`api.github.com`. It lets the updater see the releases of a private
repository, and it lifts GitHub's limit of 60 anonymous requests an hour per
address. When that limit is reached, the panel says so and says when it resets.

### Signing the installers

None of the builds carries an Apple Developer ID or a Windows Authenticode
signature yet. Both need purchased certificates, and buying them is not enough
on its own: `release.yml` passes no Apple or Windows codesigning variables to
`tauri-action`, and `src-tauri/tauri.conf.json` has no signing identity or
certificate thumbprint, so both have to be wired in once the certificates are
bought. They are separate from the updater's signing key described above. What
a writer sees meanwhile, and what to do, is under "Ready to download." in the
[README](../../README.md#ready-to-download).

## Build from source

Prerequisites:

- Rust, stable toolchain
- Node `^20.19` or `>=22.12` (what Vite 7 requires; CI uses Node 20)
- pnpm — `package.json` pins `pnpm@12.4.1` through `packageManager`
- cmake and a C/C++ toolchain: llama.cpp is compiled from source, and bindgen
  needs libclang
- Linux only: the packages CI installs — `libwebkit2gtk-4.1-dev`,
  `libayatana-appindicator3-dev`, `librsvg2-dev`, `libxdo-dev`, `libssl-dev`,
  `build-essential`, `libclang-dev`, `cmake`, `patchelf`
- For `pnpm test:e2e`: Google Chrome installed (the config uses the system
  Chrome; set `PLAYWRIGHT_CHANNEL=chromium` to use Playwright's own Chromium, as
  CI does)

```bash
pnpm install
pnpm tauri dev      # run the desktop app with hot reload
pnpm tauri build --no-sign   # build installable bundles without the signing key (see below)
pnpm check          # svelte-check
pnpm test           # cargo test (Rust unit + integration tests)
pnpm test:ui        # vitest (Svelte components and stores, jsdom)
pnpm test:e2e       # Playwright against the Vite dev server with mocked IPC
pnpm locales        # EN/ES locale key parity
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

`pnpm dev` alone serves the frontend at `http://localhost:1420`; open
`http://localhost:1420/?mock=tauri` to run the UI in a browser with the Tauri
IPC stubbed by `tests/e2e/mock-tauri.ts`.

Bundling and the signing key: `src-tauri/tauri.conf.json` turns on updater
artifacts and compiles in the updater's public key, so a plain
`pnpm tauri build` (and `make bundle`, which runs it) expects
`TAURI_SIGNING_PRIVATE_KEY` in the environment and stops without it. Only the
maintainer holds that key. Without it, pass `--no-sign`, which skips updater
signing and code signing; the resulting bundle cannot be offered through the
in-app updater. (Taken from the Tauri CLI's own messages; not run for this
reference.)

The [Makefile](../../Makefile) wraps most of these (`make help` lists them):
`make dev`, `make devtools`, `make mock`, `make bundle`, `make check`,
`make locales`, `make test`, `make test-ui`, `make test-e2e`, `make clippy`,
`make mcp`, and `make verify`, which runs check, locales, test-ui, test, clippy
and test-e2e. `make clippy` runs `cargo clippy --all-targets -- -D warnings`,
exactly as CI does. The Makefile defaults to Homebrew's pnpm on Apple silicon;
elsewhere pass `PNPM=pnpm` (for example `make verify PNPM=pnpm`). `make test-live` runs the
`#[ignore]` tests that need the network, Ollama, epubcheck and other external
tools; it is not part of `verify` or CI.

A historical snapshot, measured on 2026-10-03 on the head of `main` after PR #9
(the numbers have grown since; run the checks for today's):

| Check | Result |
|---|---|
| `cargo test` | 464 unit + 4 integration passed, 16 ignored |
| `cargo clippy --all-targets -- -D warnings` | 0 findings |
| `pnpm test:ui` | 93 passed |
| `pnpm test:e2e` | 96 passed |
| `pnpm check` | 0 errors, 0 warnings, 377 files |
| `node tests/locale-parity.mjs` | 679 keys in each of en and es |
| CI (`.github/workflows/ci.yml`) | green |

## Agents

Settings → Assistants lists `claude`, `codex` and `opencode`, found on `PATH`
and in the usual install locations. Nothing is stored: each tool keeps its own
login. (Detection also looks for `ollama`, whose daemon on `127.0.0.1:11434`
Settings → Models shows, and for `gh`, which nothing uses.)

To rewrite: select a passage → **Rewrite** → pick an agent → preview the diff →
**Apply**. The dialog opens on a model on this computer and says where the
passage is going (Local, Network for a server elsewhere, or CLI). Before
applying, Versorium makes a Git checkpoint; if that fails, nothing is written.
Then it saves the chapter and records the ops as `ai:<provider>`. A rewrite can
go to Claude Code, Codex, OpenCode, an Ollama model, a model on the saved local
server, or a downloaded model run by the built-in runtime. Settings → Tasks
chooses one for Rewrite, or leaves it to ask each time.

"Show uncensored models" in Settings → Models, when unticked, hides the two
uncensored (abliterated) models — `gemma4-12b-abliterated-q4k` and
`qwen38-27b-abliterated-q4k` — from the catalogue there. It does not change
which model or agent a task is sent to, and the one model marked Recommended
is never uncensored.

## MCP server

Versorium's own binary is also an MCP server, so the assistants you already use
can read the manuscript. It speaks stdio and is **read-only by default**.

```bash
<versorium-binary> mcp                      # serve stdio; this is what a client runs
<versorium-binary> mcp --client claude-code # name the caller, for permissions and the log
make mcp                                    # the same, from a source checkout
```

Settings → Access to your novel shows the exact command to use and connects a
client for you, and Settings → Activity lists every tool call in words (tool,
client, outcome, paths — never manuscript text; a write that only returned
its diff is logged as a preview, not as done, and a write logged before
previews were told apart says it may have been either). The `--client` id comes from the config you approved, not
from the wire, so one client cannot borrow another's permission.

### Over HTTP (optional, off by default)

For clients that need a URL instead of starting a program, Settings → Access to
your novel → Advanced can also serve MCP over Streamable HTTP. It listens on `127.0.0.1` only, on a
port chosen at launch, checks `Origin` and `Host`, and requires a bearer token
minted per launch. The URL and token are written to `mcp-http.json` in the app
data folder (mode 600 on macOS and Linux). HTTP callers are identified as `unknown`,
which cannot be granted write access, so HTTP is read-only. Turning it off takes
effect at the next launch.

### Read tools

`get_app_state`, `list_projects`, `open_project`, `list_documents`,
`read_document`, `search`, `assemble_context`, `history_list`, `history_blame`,
`diff`, `git_status`, `git_log`, `get_style`, `codex_search`, `codex_get`.

### Write tools

`write_document`, `insert_text`, `delete_text`, `replace_text`,
`create_document`, `codex_upsert`, `git_commit`, `delete_document`.

They exist but **refuse** unless you grant that specific client write access in
Settings → Access to your novel (Allow writing…, then a dialog that starts on
"Keep read only"). Only the four clients Versorium can connect for you —
Claude Code, Claude Desktop, Codex and OpenCode — can be granted it, and only
once connected; the app refuses a grant for one that is not. When granted:

1. a call without `confirm: true` returns a **diff preview** and changes nothing;
2. Versorium makes a **Git checkpoint** first — if the snapshot fails, the write
   does not happen (`git_commit` is itself the restore point);
3. edits to a chapter are recorded in the ops log as `ai:<client>`, so you can
   see who changed what. To undo one, go back to the checkpoint commit with Git
   (there is no in-app screen for that yet); the editor's Restore does not reach
   MCP edits.

Deleting a document needs a second flag, `acknowledge_delete`, on top of
`confirm`.

The warning that opens the Allow writing… dialog in Settings → Access to your
novel:

> **Write lets the AI change your manuscript. Versorium will snapshot Git first.
> You can roll back. The model can still delete text if you allow the edit.**

"Roll back" there means returning to that Git snapshot, which today is done
with Git outside the app.

### Connecting a client by hand

Settings → Access to your novel does this for Claude Code, Claude Desktop,
Codex and OpenCode. For Claude Code and Codex it runs the client's own CLI; for Claude
Desktop and OpenCode it edits the JSON file and keeps a `.versorium-backup` copy
first. Restart the client afterwards. To do it yourself, replace
`/path/to/versorium` with the path shown in that panel.

**Claude Code** — use the CLI, because `~/.claude.json` is live state that a
running Claude Code rewrites:

```bash
claude mcp add --scope user versorium -- /path/to/versorium mcp --client claude-code
```

**Codex** — likewise; a duplicate `[mcp_servers.versorium]` table would make the
whole `config.toml` unparseable:

```bash
codex mcp add versorium -- /path/to/versorium mcp --client codex
```

**Claude Desktop** — no CLI; edit
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS),
`%APPDATA%\Claude\claude_desktop_config.json` (Windows) or
`~/.config/Claude/claude_desktop_config.json` (Linux), keeping every other key:

```json
{
  "mcpServers": {
    "versorium": {
      "command": "/path/to/versorium",
      "args": ["mcp", "--client", "claude-desktop"],
      "env": {}
    }
  }
}
```

**OpenCode** — `~/.config/opencode/opencode.json`. The shape differs: the key
is `mcp`, `type` is required, and the command is a single array (no `args`):

```json
{
  "mcp": {
    "versorium": {
      "type": "local",
      "command": ["/path/to/versorium", "mcp", "--client", "opencode"],
      "enabled": true
    }
  }
}
```

**Cursor and VS Code** — Versorium does not write or test these configs, and
neither client can be granted write access, so they stay read-only. Cursor
reads `<repo>/.cursor/mcp.json` or `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "versorium": {
      "command": "/path/to/versorium",
      "args": ["mcp", "--client", "cursor"]
    }
  }
}
```

VS Code reads `<repo>/.vscode/mcp.json`, whose top-level key is `servers`, not
`mcpServers`:

```json
{
  "servers": {
    "versorium": {
      "command": "/path/to/versorium",
      "args": ["mcp", "--client", "vscode"]
    }
  }
}
```

## Project layout on disk

New novels go under `Documents/Versorium/<slug>/` by default:

```
versorium.json        # project metadata
manuscript/           # one .md file per chapter (frontmatter + body)
codex/                # characters/ locations/ factions/ items/ + timeline.yml
plot/                 # outline.md
research/  style/  prompts/  snapshots/
style/voice.md        # the project's voice guide
.versorium/ops/       # the character-level ops log (committed with the novel)
.versorium/snapshots/ # a full chapter copy every 200 ops (committed too)
.versorium/cache/  .versorium/embeddings/   # local only, in .gitignore
```

App settings live elsewhere, in the platform's app-data folder under
`dev.versorium.app` (on macOS, `~/Library/Application Support/dev.versorium.app`).

