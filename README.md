# Versorium

Local-first novel studio. Detects the AI you already pay for (CLI / desktop /
local), exposes an MCP server, versions text at character granularity with
rollback, syncs to Git/GitHub, and self-updates from GitHub Releases.

- App id: `dev.versorium.app`
- CLI: `versorium`
- License: [Apache-2.0](LICENSE) · Marks: [TRADEMARKS.md](TRADEMARKS.md)
- Canon: [PROMPT-VERSORIUM.md](PROMPT-VERSORIUM.md) (product) ·
  [DESIGN-VERSORIUM.md](DESIGN-VERSORIUM.md) (design) ·
  [AGENT-BOOTSTRAP.md](AGENT-BOOTSTRAP.md) / [AGENTS.md](AGENTS.md) (process)

## Stack

Tauri 2 (Rust) + Svelte 5 + Vite + Tailwind 4 + CodeMirror 6. pnpm.
No Electron. No SaaS. No telemetry.

## How to run

```bash
pnpm install
pnpm tauri dev      # development (opens a window)
pnpm tauri build    # release bundle
pnpm check          # svelte-check
pnpm test           # cargo test (Rust unit tests)
pnpm test:ui        # vitest (Svelte components + stores, jsdom)
pnpm test:e2e       # Playwright in the system Chrome against `pnpm dev` + mocked IPC
```

Prereqs: Rust (stable), Node 20+, pnpm 10. E2E needs Google Chrome installed
(no browser download); `pnpm dev` with `?mock=tauri` runs the UI in any browser
with the Tauri IPC stubbed by `tests/e2e/mock-tauri.ts`.

## Agents (M2)

Settings → Agents scans PATH and the usual install dirs for `claude`, `codex`,
`opencode`, `ollama` (daemon checked on `127.0.0.1:11434`) and `gh`. Nothing is
stored: each harness keeps its own login. Select a passage → **Rewrite** →
pick a provider → diff → **Apply**. Before the apply Versorium commits a git
checkpoint, then writes the chapter and logs the ops as `ai:<provider>`.
The dialog states where the passage goes (Local vs CLI). Settings → Safety
holds the censorship toggle; routing by it arrives with Local AI (M4).

## MCP server (M3)

Versorium exposes its own MCP server so the agents you already use can read the
manuscript. It is **read-only by default** and speaks stdio on this machine
only — nothing listens on a network port.

```bash
versorium mcp                      # serve stdio (this is what a client runs)
versorium mcp --client claude-code # identify the caller for permissions + log
```

Settings → MCP connects a client for you (backing the file up first) and shows
every tool call an agent made. The `--client` id comes from the config you
approved, not from the wire, so one client cannot borrow another's permission.

### Read tools

`get_app_state`, `list_projects`, `open_project`, `list_documents`,
`read_document`, `search`, `assemble_context`, `history_list`, `history_blame`,
`diff`, `git_status`, `git_log`, `get_style`, `codex_search`, `codex_get`.

### Write tools

The write tools exist but **refuse** unless you grant that specific client write
access in Settings → MCP. When granted, every write still goes through the same
pipeline as your own keystrokes:

1. the tool returns a **diff preview** and changes nothing unless it is called
   again with `confirm: true`;
2. Versorium makes a **git checkpoint** first — if the snapshot fails, the write
   does not happen;
3. the change is recorded in the ops log as `ai:<client>`, so you can roll it
   back word by word.

Deleting a document needs a second flag (`acknowledge_delete`) on top of
`confirm`.

> **Write lets the AI change your manuscript. Versorium will snapshot Git first.
> You can roll back. The model can still delete text if you allow the edit.**

### Connecting a client by hand

Settings → MCP writes these for you. If you would rather do it yourself, replace
`/path/to/versorium` with the binary path shown in that panel.

**Claude Code** — prefer the CLI, because `~/.claude.json` is live session state
that a running Claude Code rewrites:

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

Quit Claude Desktop fully and relaunch — closing the window is not enough.

**OpenCode** — `~/.config/opencode/opencode.json`. Note the shape differs: the
key is `mcp`, `type` is required, and the command is a single array (there is no
`args`):

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

## Project layout on disk

Each novel is a plain folder under `Documents/Versorium/<slug>/`:

```
versorium.json        # project metadata
manuscript/           # one .md file per chapter (frontmatter + body)
codex/                # characters / locations / factions / items / timeline.yml
plot/                 # outline.md, beats.yml
research/  style/  prompts/  snapshots/
.versorium/           # ops log, embeddings, cache (git-committable packs)
```

## Milestones

See [STATUS.md](STATUS.md). M0 skeleton → M1 git + ops → M2 agents →
M3 MCP → M4 local models → M5 formats → M6 updater → M7 polish.
