# STATUS

## Current milestone: M1 — Git + character ops ✅ (DoD green, pending git commit)

## How to run

```bash
# Node v20 via nvm must be on PATH (no system node on this machine)
export PATH="$HOME/.nvm/versions/node/v20.19.1/bin:$PATH"

pnpm tauri dev        # dev window
pnpm check            # svelte-check (0 errors, 10 warnings)
pnpm build            # vite build → dist/
cargo test --manifest-path src-tauri/Cargo.toml   # 18 passed
```

## M1 DoD checklist

- [x] Every new project is a git repo from birth (libgit2 `git2`, vendored — no system git); branch pinned to `main`, first commit `m0: project created`
- [x] Commit button (TopBar, default message `checkpoint`) + auto checkpoint every 60 s while a project is open (`checkpoint: autosave`)
- [x] Character ops log, author=`human`: JSONL packs at `.versorium/ops/<chapter>/<YYYY-MM-DD>.jsonl`, monotonically increasing `seq` per chapter, snapshot every 200 ops at `.versorium/snapshots/<chapter>/<seq>.md`
- [x] Rollback word (cursor) / rollback selection, from in-memory selection snapshots (ring, 300); rollback recorded as op `kind:"rollback"`
- [x] Mini Git panel (bottom drawer): status (modified/staged/untracked, ahead/behind), log (50), diff (HEAD→workdir patch), branches (list + create + current marker), remotes (list + remove)
- [x] GitHub connect in Settings — two OAuth slots, never mixed: **Updates** (reads releases of maecly/versorium-app) and **Novel** (user repos). CTA shown when no token; token validated via `GET /user`
- [x] Novel slot creates a **private** repo by default and adds it as `origin`
- [x] Dirty dot in TopBar (15 s poll) + i18n for all new strings (EN/ES)

## Verification (this machine, 2026-09-11)

| Check | Result |
|---|---|
| `cargo test` (src-tauri) | ✅ 18 passed, 0 failed (incl. e2e `create_project_initializes_git`: `.git` exists, branch `main`, clean tree, 1 commit) |
| `pnpm check` (svelte-check) | ✅ 0 errors, 10 warnings (pre-existing a11y patterns) |
| `pnpm build` (vite) | ✅ built in ~1 s |
| `pnpm tauri dev` | ✅ window opens, process alive, no panics in log |

Rust unit tests: git repo (init/status/commit/log, branches+checkout, remote roundtrip, no-repo errors), ops (append/read-back, snapshot cadence, day format), project/settings/chapters (M0) + new e2e git-init test.

## Files / structure (M1 delta)

- Rust `src-tauri/src/`:
  - `git/repo.rs` — init_with_commit (branch `main`), status (+ahead/behind), log, diff (patch text), commit_all (empty-commit → `nothing_to_commit`), branches/create, checkout_file, remotes add/remove
  - `git/github.rs` — minimal REST client (reqwest + rustls): me / create_repo(private) / list_repos
  - `ops/mod.rs` — JSONL packs + seq counter + snapshot every 200 ops, restore_snapshot
  - `commands/git.rs` (12 commands), `commands/ops.rs` (4), `commands/settings.rs` (+`githubUpdatesToken`/`githubNovelToken`), `commands/project.rs` (git init on create), `lib.rs` (29 commands registered)
- Frontend `src/`:
  - `lib/git/ops.ts` — `deriveOps` (prefix/suffix diff) + `OpsLogger` (500 ms debounce, best-effort flush)
  - `lib/git/rollback.ts` — selection snapshot ring + word/selection restore
  - `lib/editor/MarkdownEditor.svelte` — ops tracking + public `rollbackWord/rollbackSelection/flushOps`
  - `lib/components/GitPanel.svelte`, `TopBar.svelte` (commit + rollbacks + Git toggle + dirty dot), `App.svelte` (wiring, 60 s auto checkpoint, 15 s dirty poll)
  - `lib/settings/SettingsModal.svelte` — real Git section (two slots, private repo create)
  - `lib/tauri.ts` — git/ops types + api wrappers
- Locales: `git.*` (43 keys) + `errors.*` (Rust error codes) in `en` + `es`

## Architecture decisions (M1)

1. **Vendored libgit2** — `git2 = 0.19` with `vendored-libgit2`; no system git anywhere. libgit2 defaults the initial branch to `master`, so `init_with_commit` pins `main` before the first commit.
2. **Ops are derived, not keystroke-tracked** — each editor update diffs old vs new body (common prefix/suffix) into delete/insert ops; positions: deletes reference the old doc, inserts the new doc.
3. **Rollback is snapshot-based, not replay** — selection snapshots kept in memory (300 ring per chapter); restoring word/selection re-inserts the stored text and logs a `rollback` op. Full replay from the JSONL log is a later milestone.
4. **GitHub = plain REST** — no SDK; `reqwest` with rustls. Error codes (`bad_token`, `network`, `repo_failed`) localize through the same `errors.*` map.
5. **Two token slots are separate fields** in `settings.json` and are never interchangeable in code paths (Updates reads releases only; Novel manages the novel remote).
6. **Empty commit** — git2 reports it as an error message; mapped to `nothing_to_commit` (localized, not an error state in the auto-checkpoint path).

## Known holes (M1)

- GitHub tokens stored in `settings.json` (plaintext) — `keyring` was planned in M0 notes; defer to M6 hardening pass.
- No push/pull yet: `origin` is added, but network git operations are not wired (CLI or a later milestone).
- Rollback snapshots are in-memory only; closing the app loses them (the ops log + disk snapshots remain).
- 10 svelte-check warnings (pre-existing a11y patterns) — cosmetic.

## Next: M2 — Agents + rewrite + censorship

DoD targets: detect local agent binaries (claude / codex / opencode / ollama / gh) on PATH, Agents cards in Settings, Rewrite → diff → Apply flow (author=`ai:<provider>` ops), git checkpoint before apply, censorship toggle in Safety section.

## Git

Agent shell blocks mutating git commands — handoff to the user:

```bash
# (once) if the m0 commit was never made:
cd ~/Documents/Github/versorium-app && git init -b main && git add -A && git commit -m "m0: skeleton"

# M1:
cd ~/Documents/Github/versorium-app && git add -A && git commit -m "m1: git + ops"
```

Remote (`maecly/versorium-app`, private) needs `gh`/token — not available in agent shell; create manually and push after.
