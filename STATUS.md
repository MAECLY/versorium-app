# STATUS

## Current milestone: M2 — Agents + rewrite + censorship ✅ (DoD green)

## How to run

```bash
# Node v20 via nvm must be on PATH (no system node on this machine)
export PATH="$HOME/.nvm/versions/node/v20.19.1/bin:$PATH"

pnpm tauri dev        # dev window (VERSORIUM_DEVTOOLS=1 opens the inspector)
pnpm check            # svelte-check (0 errors, 0 warnings)
pnpm test             # cargo test (37 unit tests)
pnpm test:ui          # vitest, jsdom (14 tests)
pnpm test:e2e         # Playwright, system Chrome, mocked IPC (5 specs)
cargo test --manifest-path src-tauri/Cargo.toml -- --ignored live_   # real CLIs + Ollama on this machine
```

Browser preview with the IPC stubbed: `pnpm dev` → `http://localhost:1420/?mock=tauri`.

## M2 DoD checklist

- [x] Detect binaries `claude`, `codex`, `opencode`, `ollama`, `gh` — PATH first, then the usual install dirs per OS (Finder/Explorer launches do not inherit the login shell PATH); Windows tries `.exe/.cmd/.bat`; five `--version` probes run in parallel (5 s cap each); Ollama daemon probed on `127.0.0.1:11434`
- [x] Settings → Agents: one card per harness — Connected / Detected / Missing, version, path, Ollama models, offline-daemon hint, Re-check. Detection cached per session (warmed at startup)
- [x] Select text → Rewrite → diff preview → Apply / Discard (`RewriteDialog` on `<dialog>`, agent picker, −/+ line diff, Cmd/Ctrl+Shift+R)
- [x] Applied rewrite writes ops with `author=ai:<provider>` (delete at old UTF-16 coords, insert at new) into the same JSONL packs as human keystrokes
- [x] Git checkpoint BEFORE apply (`checkpoint: before ai rewrite (<provider>)`; identical tree → no-op, still refused if the checkpoint itself fails)
- [x] Censorship toggle in Settings → Safety, persisted in `settings.json` (routing by it arrives with Local AI, M4)
- [x] Spec §2.3 "this call goes to X": privacy line + Local / CLI pill in the dialog
- [x] Spec §5 Creative Mode: visible, disabled, tooltip "arrives in v1.1" — no engine
- [x] i18n EN + ES for everything above (key sets identical, 0 hardcoded strings)

## Verification (this machine, 2026-09-19, macOS 27.0)

| Check | Result |
|---|---|
| `cargo test` | ✅ 37 passed (UTF-16 offsets, stale-selection refusal without checkpoint, agent dir scan + exec bit, five-spec detection) |
| `cargo test -- --ignored live_` | ✅ 5/5 detected with real versions; Ollama (qwen3.8) and `claude -p` both returned a rewrite |
| `pnpm check` | ✅ 0 errors, 0 warnings |
| `pnpm test:ui` | ✅ 14 passed (diff, agent cache, store flush/ordering/adoptSaved, IPC payload shapes, App smoke) |
| `pnpm test:e2e` | ✅ 5 passed — rewrite happy path (checkpoint first, `ai:<provider>` ops, editor updated), Local/CLI labels + failing harness keeps the dialog open, no-selection hint, agents cards + censorship persistence, ES translation |
| Real app (`pnpm tauri dev`, driven via macOS accessibility) | ✅ project created → typed → selected → Rewrite with **Claude Code** → Apply. On disk: chapter has the rewritten sentence (with `ñ`), ops pack holds 58 `human` ops then `ai:claude` delete/insert in UTF-16 coords, git tree dirty afterwards for the next checkpoint |

## Bugs found and fixed on the way

- `ops_append` payload never matched the Rust signature → **human keystrokes were never logged in the real app** since M1 (swallowed by the best-effort logger). Caught by the E2E IPC mock, which mirrors the Rust signatures.
- Editor was torn down 800 ms after every pause (props read reassigned store objects) → lost focus, selection and session history. Fixed with a value-equal derived key.
- `ai_apply_rewrite` sliced bytes with UTF-16 offsets → any accented passage broke. Now converts and refuses stale selections before the checkpoint.
- White window on launch (macOS 27 / wry 0.55.1: `visibilityState=hidden`, DOM complete, never painted). Window now starts hidden and the frontend reveals it once mounted (`ui_ready`); Rust shows it after 3 s regardless.
- Rewrite dialog said "No agent found" while detection was still running.

## Files / structure (M2 delta)

- Rust `src-tauri/src/`: `agents/mod.rs` (dir scan, parallel probes, live test), `commands/ai.rs` (validate → checkpoint → splice → ops), `text.rs` (UTF-16 helpers), `commands/project.rs::ui_ready`, `lib.rs` (hidden window reveal, devtools env)
- Frontend `src/`: `lib/ai/{agents,diff}.ts` (+tests), `lib/components/RewriteDialog.svelte`, `lib/settings/SettingsModal.svelte` (Agents + Safety), `lib/components/TopBar.svelte` (Rewrite, Creative placeholder), `App.svelte` (apply pipeline), `lib/binder/store.svelte.ts::adoptSaved`, `lib/editor/MarkdownEditor.svelte` (`applyExternal` guard, `getDoc`, stable doc key), `main.ts` (boot, mock hook, fatal surface)
- Tests: `tests/e2e/mock-tauri.ts`, `tests/e2e/m2-rewrite.spec.ts`, `playwright.config.ts`
- Locales: `ai.*`, `agents.*`, `safety.*`, `errors.{no_provider,ai_failed,ai_empty,bad_range,stale_selection}`

## Architecture decisions (M2)

1. **Editor coordinates everywhere** — ops (human and AI) use UTF-16 code units; Rust converts to bytes only to splice. `expected` travels with every apply so a moved file is refused (`stale_selection`) before any commit.
2. **Harnesses own their login** — detection is presence-based; nothing is stored. Rewrite invokes `claude -p`, `codex exec`, `opencode run`, or Ollama `/api/generate` (first served model; picker is M4).
3. **Checkpoint first, then write, then ops** — mirrors the MCP write path planned for M3.
4. **IPC mock for browser E2E** — `tests/e2e/mock-tauri.ts` keeps the Rust arg shapes; anything the UI can do can be exercised in Chrome/Playwright.

## Known holes (M2)

- Projects list word count is stale until reload (`store.projects` is only refreshed on create/mount).
- Ollama rewrite uses the first served model; no per-slot model picker until M4.
- No "this call goes to X" banner in the status bar yet (privacy segment of the bottom bar is M4/M7 polish).
- Censorship toggle does not route yet (by design: M4).
- GitHub tokens still plaintext in `settings.json` (keyring pass deferred to M6).
- Real-app E2E is driven ad hoc via macOS accessibility; browser E2E is the automated one.

## Next: M3 — MCP server (read default)

DoD targets: `versorium mcp` stdio (+ optional localhost HTTP/SSE), tools `list_project`, `read_document`, `search`, `assemble_context`, `history_list`; write tools present but rejected unless Settings → MCP allows write; write path = preview + git checkpoint + `author=ai:<client>`; client config snippets (Claude Desktop / OpenCode / Cursor) in README; warning copy about AI deleting text.
