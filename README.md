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
```

Prereqs: Rust (stable), Node 20+, pnpm 10.

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
