> **Historical document — do not follow it as instructions.**
> This is the prompt Versorium was originally built from, kept unchanged for the record.
> Milestones M0–M7 are complete. `STATUS.md` records what shipped, the DoD checklists of M3–M7 and the
> known limits (for example, no release has been cut yet). `TODO.md` lists what is half-done or specified
> and not yet started, including parts of the DoD below. The unticked checklists below are the original
> prompt, not current status.
> Agents working on the repo now should read [`AGENTS.md`](../../AGENTS.md) instead.

---

# VERSORIUM — ORQUESTADOR PARA AGENTE (Magnitude + Qwen 3 27B Q6)

You are the lead coding agent. Your job is to BUILD Versorium end-to-end by executing one milestone at a time until M7 is green. Do not ask the human questions. Defaults below are law.

## Model constraint (you are Qwen3 27B Q6)

- Context is finite. NEVER paste or re-read both spec files in full on every turn.
- Work in SMALL files (<400 lines). Split modules.
- After each milestone: write `STATUS.md` with what shipped, files touched, how to run, what's next.
- Before coding a milestone: read ONLY the sections of the specs that apply to that milestone.
- If you forget a rule, re-open this file and `STATUS.md`, not the entire spec.

## Source of truth (read these files from disk; they sit next to this prompt)

1. `PROMPT-VERSORIUM.md` — product + architecture
2. `DESIGN-VERSORIUM.md` — themes, tokens, type
3. THIS FILE — how you work

If they conflict: THIS FILE wins on process; PROMPT wins on product; DESIGN wins on pixels.

Ignore `PROMPT-APP-NOVELA-DESKTOP.md` if present. It is obsolete.

## Destination

```
github.com/maecly/versorium-app   PRIVATE
app id: dev.versorium.app
cli: versorium
license: Apache-2.0
```

If the git remote is not set, `git init` locally as `versorium-app` and keep committing. Do not push secrets.

## Hard rules (never violate)

- Local-first. No SaaS. No telemetry. No token resale.
- One Markdown file per chapter. Scenes = `##` headings.
- No Creative Mode engine. UI may say Coming soon.
- MCP starts READ-ONLY. Write is a setting + warning + git checkpoint first.
- Censorship toggle exists in Settings.
- EN + ES i18n from M0. No hardcoded UI strings.
- Themes: Folio, Quarry, Needle (light+dark). Default: Folio day / Needle night / follow system.
- Brand accent: Needle Teal `#2A6F6A` / `#7EB8B2`. Not iA orange. Not Ulysses purple.
- Two GitHubs never mixed:
  - `maecly/versorium-app` = this codebase + app updates + crash issues
  - User novels = THEIR account/org, private default
- Crash logs never include novel text.
- Do not invent features outside the specs.
- Stack is LOCKED: Tauri 2 + Rust + one TS frontend (pick **Svelte 5** — less boilerplate for 27B than React).
- Editor: CodeMirror 6 or TipTap; pick CodeMirror 6 markdown.
- Git engine: libgit2 via `git2` crate. Do not require system git.
- Frontend talks to Rust via Tauri commands. Business logic in Rust when it touches files, git, models, MCP.

## Defaults when unspecified

| Topic | Default |
|---|---|
| Novel folder | `Documents/Versorium/` |
| New GitHub repo for a novel | private |
| MCP write | off |
| Portable USB build | skip (v1.1) |
| Signing | minisign + sha256 only |
| Frontend | Svelte 5 + Vite + Tailwind + CSS variables from DESIGN |
| Package manager | pnpm |
| Rust edition | 2021 |

## Repo layout you MUST create in M0

```
versorium-app/
  AGENTS.md                 (copy of this file)
  STATUS.md
  PROMPT-VERSORIUM.md
  DESIGN-VERSORIUM.md
  README.md
  LICENSE                   Apache-2.0
  TRADEMARKS.md
  src-tauri/
    Cargo.toml
    tauri.conf.json
    capabilities/
    src/
      lib.rs
      commands/
      git/
      ops/
      i18n.rs
  src/
    app.html
    main.ts
    App.svelte
    lib/
      i18n/
      themes/
      binder/
      editor/
      settings/
  locales/en/*.json
  locales/es/*.json
  models/catalog.json       (stub in M0, fill M4)
  fonts/catalog.json        (stub in M0)
```

## Operating loop (every session)

1. Read `STATUS.md`. If missing, you are at M0.
2. Read only the spec slices for the CURRENT milestone.
3. Implement that milestone ONLY.
4. Run whatever can run (`pnpm tauri dev` or unit tests).
5. Update `STATUS.md`: milestone, DoD checklist, commands, known holes.
6. Commit: `mN: short description`
7. STOP and start the next milestone in a NEW turn / new subagent. Do not start M2 while M1 DoD is red.

If a command fails: fix it. Do not skip DoD.

If the human is gone, keep going until M0 DoD is green, then M1, etc. Pause only on missing OS credentials (GitHub token) — stub the UI and continue.

## Subagents (Magnitude)

Delegate when a task is isolated:

- **planner**: break current milestone into files
- **builder**: implement
- **reviewer**: check DoD + spec drift
- **debugger**: `pnpm tauri dev` / cargo errors

Main agent never rewrites the whole app in one shot.

---

## M0 — Skeleton  (DO THIS FIRST)

Goal: window opens, binder + editor, save chapter md, switch EN/ES, apply Folio theme.

DoD:
- [ ] `pnpm tauri dev` launches on the current OS
- [ ] New project in `Documents/Versorium/<slug>/`
- [ ] Binder lists `chapters/01-*.md`
- [ ] Editor edits markdown, autosave
- [ ] UI strings from `locales/en` and `locales/es`
- [ ] Theme Folio light/dark tokens as CSS variables
- [ ] Settings shell (empty sections: Agents, Local AI, Git, MCP, Safety, Updates, Typography)
- [ ] README how to run

Out of scope: git, AI, MCP, export, updater.

---

## M1 — Git + character ops

DoD:
- [ ] libgit2 init on new project
- [ ] Commit button + auto checkpoint
- [ ] Ops log per keystroke (insert/delete) with author=human
- [ ] Rollback word / selection
- [ ] Mini Git panel: status, log, diff, branch
- [ ] Connect GitHub (user + orgs) stub works if no token (shows CTA)
- [ ] New remote default private
- [ ] Two OAuth slots in Settings (Updates vs Novel GitHub) even if only UI

---

## M2 — Detect agents + rewrite selection

DoD:
- [ ] Detect binaries: `claude`, `codex`, `opencode`, `ollama`, optional `gh`
- [ ] Settings → Agents: Connected / Detected / Missing
- [ ] Select text → Rewrite → diff preview → Apply / Discard
- [ ] Applied rewrite writes ops with `author=ai:<provider>`
- [ ] Git checkpoint BEFORE apply
- [ ] Censorship toggle exists (routes later)

No full-chapter generation.

---

## M3 — MCP server (read default)

DoD:
- [ ] `versorium mcp` or app-start localhost MCP
- [ ] Tools: list_project, read_document, search, assemble_context, history_list (read)
- [ ] Write tools exist but REJECT unless Settings allow write
- [ ] Write path: preview + git checkpoint + author=ai
- [ ] Auto-write snippet for Claude Desktop / OpenCode / Cursor documented in README
- [ ] Warning copy about AI deleting text

---

## M4 — Local models Meetily-style

DoD:
- [ ] Settings cards: Download / Ready / Selected
- [ ] `models/catalog.json` with LOW/MID packs (do not auto-download HIGH)
- [ ] Ollama tab lists local models if daemon up
- [ ] Slots: Rewrite, Chat, Continuity, Embeddings
- [ ] Hardware wizard recommends a tier
- [ ] llama.cpp or compatible runtime for one MID GGUF if user clicks Download (or stub download + hook)

Dictation Whisper = same downloader UI, packs can wait if time.

---

## M5 — Formats

DoD:
- [ ] Export MD / DOCX (manuscript format) / EPUB 3 / PDF
- [ ] Import MD / DOCX (H1=chapter) / Scrivener best-effort
- [ ] Roundtrip documented

---

## M6 — Updater

DoD:
- [ ] Tauri updater plugin
- [ ] Reads GitHub Releases of `maecly/versorium-app`
- [ ] minisign + sha256
- [ ] Settings → Updates login separate from novel GitHub
- [ ] Dialog: Install / Later / Skip
- [ ] CI workflow draft that builds tag `vX.Y.Z`

---

## M7 — Polish

DoD:
- [ ] Onboarding (no signup)
- [ ] Corkboard basic
- [ ] Continuity check stub (local MID or skip if no model)
- [ ] Crash log local + “Report” opens issue URL with NO manuscript
- [ ] Focus mode + typewriter
- [ ] Font catalog stub (system + bundled Source Serif if easy; otherwise system serif)

---

## First commands you run NOW

```bash
# create project if empty
# copy PROMPT-VERSORIUM.md DESIGN-VERSORIUM.md AGENT-BOOTSTRAP.md into repo root
# implement M0
pnpm create tauri-app . --template svelte-ts   # or equivalent non-interactive flags
# if wizard is interactive, write files by hand to match layout
```

Then implement M0 DoD. Commit. Update STATUS.md. Continue to M1 without waiting.

## What you must NOT do

- Do not start a Next.js web app
- Do not use Electron
- Do not require a cloud account
- Do not put novel text in issues, telemetry, or crash reports
- Do not implement Creative Mode
- Do not download 27B GGUF as part of the app install
- Do not block M0 on GitHub auth
- Do not rewrite specs

Begin M0 immediately.
