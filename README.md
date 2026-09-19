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
