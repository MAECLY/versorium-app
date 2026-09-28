# STATUS

## Current milestone: M3 — MCP server (read default) ✅ (DoD green)

## How to run

```bash
# Node v20 via nvm must be on PATH. NOTE: the corepack pnpm shim in nvm is
# broken on this machine (points at pnpm/12.4.1/bin/pnpm.cjs, which pnpm 12
# does not ship); /opt/homebrew/bin/pnpm works.
export PATH="$HOME/.nvm/versions/node/v20.19.1/bin:$PATH"

pnpm tauri dev        # dev window (VERSORIUM_DEVTOOLS=1 opens the inspector)
pnpm check            # svelte-check (0 errors, 0 warnings)
pnpm test             # cargo test (120 unit + 4 integration)
pnpm test:ui          # vitest, jsdom (21 tests)
pnpm test:e2e         # Playwright, system Chrome, mocked IPC (11 specs)
cargo test --manifest-path src-tauri/Cargo.toml -- --ignored live_   # real CLIs + Ollama

versorium mcp [--client <id>]   # serve MCP over stdio
```

Browser preview with the IPC stubbed: `pnpm dev` → `http://localhost:1420/?mock=tauri`.

## M3 DoD checklist

- [x] `versorium mcp` serves stdio from the same binary — `--client <id>` comes from the config the user approved, not from the wire, so a client cannot claim another's permission
- [x] Read tools: `list_projects`, `read_document`, `search`, `assemble_context`, `history_list` — plus `get_app_state`, `open_project`, `list_documents`, `history_blame`, `diff`, `git_status`, `git_log`, `get_style`, `codex_search`, `codex_get` (15 total)
- [x] Write tools exist but REJECT unless Settings → MCP grants that client: `write_document`, `insert_text`, `delete_text`, `replace_text`, `create_document`, `codex_upsert`, `git_commit`, `delete_document` (8)
- [x] Write path: preview (no `confirm: true` → diff only, nothing touched) → git checkpoint → apply → ops `author=ai:<client>` at UTF-16 offsets. Deleting a chapter needs `acknowledge_delete` on top of `confirm`
- [x] README documents the auto-write snippet for Claude Desktop, OpenCode and Cursor (plus Claude Code, Codex and VS Code); Settings → MCP writes the first four for you
- [x] Warning copy about AI deleting text, verbatim from spec §7, shown above the Allow-write controls rather than behind them
- [x] Tool log in Settings → MCP: tool, client, scope, outcome, paths — never manuscript text
- [x] i18n EN + ES (29 `mcp.*` keys); actionable copy for every error code a tool can return

## Verification (this machine, 2026-09-27, macOS 27.0)

| Check | Result |
|---|---|
| `cargo test` | ✅ 120 unit passed (protocol eras, permission gate, write pipeline, query layer, config writer, prose-free log) |
| `cargo test --test mcp_stdio` | ✅ 4 passed — spawns the shipped binary, speaks JSON-RPC to it, asserts stdout carries only MCP frames and the read-only default survives into the real process |
| `pnpm check` | ✅ 0 errors, 0 warnings |
| `pnpm test:ui` | ✅ 21 passed |
| `pnpm test:e2e` | ✅ 11 passed (6 new: read-only default, connect, unwritable config, per-client grants, tool log, ES) |
| **Real client end-to-end** | ✅ Claude Code 2.1.283 registered against the real binary: `open_project` → `search` (1 hit) → `assemble_context` → `history_blame` (span attributed `ai:claude`, from the M2 rewrite) all succeeded, and `write_document` was refused with `write_not_allowed` |

## How the wire shapes were settled

Reading the spec was not enough — it has two incompatible eras live at once. A
throwaway logging server registered in a scratch project captured what a real
client actually sends: **Claude Code 2.1.283 opens with `initialize` at
protocol `2025-11-25`**, then `notifications/initialized`, `tools/list`,
`tools/call`. Binary inspection shows Claude Code, Claude Desktop and Codex all
carry `2026-07-28` (which deleted the handshake in favour of `server/discover`)
while OpenCode is legacy-only — so the server answers both eras and latches
whichever one the client opened with.

## Bugs found and fixed on the way

- **`server/discover` was wrong in three ways** — the field is `supportedVersions` not `supported`, `serverInfo` belongs in `result._meta`, and `resultType`/`ttlMs`/`cacheScope` are required on modern cacheable results.
- **`structuredContent` as a bare array** — a real Claude Code session rejected `search` outright with `expected: "record"`. List results are now wrapped in an object.
- **`write_not_allowed: Something went wrong.`** — the refusal had no copy and read like a crash. Every code a tool can return now says what to do about it, in EN and ES, with a test pinning the list.
- **The tool log was not hermetic** — `log::append` resolved the real app-data path, so tests wrote into the user's log and read each other's entries. The path is now derived from the session's settings file.
- **`atomic_write` widened private files** — it created its temp at the umask default, so rewriting a 0600 agent config published its cleartext API keys at 0644 until the mode was restored. Now set before any content is written.
- **We advertised `2025-03-26`** — the one revision that requires accepting JSON-RPC batch arrays, which the transport rejects.
- **"Claude Code" named two different cards** in Settings (Agents and MCP), ambiguous to a screen reader and to any query by name. Each section is now a labelled landmark.

## Files / structure (M3 delta)

- Rust `src-tauri/src/mcp/`: `mod.rs` (CLI), `server.rs` (stdio JSON-RPC framing), `dispatch.rs` (both eras), `tools.rs` (23 tools), `write.rs` (checkpoint-first pipeline), `query.rs` (search / context / blame), `session.rs` (permission gate + era latch), `clients.rs` (config writer), `log.rs`
- `src-tauri/src/`: `paths.rs` (app-data shared by both processes), `commands/mcp.rs`, `storage.rs` (mode-preserving atomic write), `i18n.rs`
- Frontend: `src/lib/mcp/state.svelte.ts`, Settings → MCP section, `src/lib/i18n/errors.ts`
- Tests: `src-tauri/tests/mcp_stdio.rs`, `tests/e2e/m3-mcp.spec.ts`, mock extended

## Architecture decisions (M3)

1. **Identity from the config, not the wire** — `--client <id>` is written into the client's own config by Versorium, so a write grant cannot be borrowed by renaming.
2. **The grant is re-read on every call** — revoking write in the GUI bites immediately; the writer never has to restart an agent to take permission back.
3. **Two-phase writes** — a write tool without `confirm: true` returns a diff and touches nothing. That is the MCP-shaped equivalent of the preview the spec requires, with no GUI round-trip.
4. **Config writing prefers each client's own CLI** — `~/.claude.json` is live session state a running client rewrites, and a duplicate TOML table would make Codex's whole config unparseable. Only the two clients without a usable CLI are hand-edited.
5. **A tool that runs and refuses is `isError`, not a JSON-RPC error** — the call succeeded, the operation did not, and the model needs to read why to recover.

## Known holes (M3)

- HTTP/SSE on `127.0.0.1` is not implemented; the DoD's "stdio **or** localhost" is met by stdio, and the spec marks HTTP opt-in.
- `continuity_check` is not exposed — it needs a local model (M4). `git_push`/`git_pull` are not exposed either: network git is still unwired (an M1 hole).
- `apply_edit_set`, `rename_document` and `move_document` from the §7 list are not implemented.
- Codex project scope (`.codex/config.toml`) is untouched — documented but unverifiable here, so only user scope is written.
- Windows and Linux config paths come from docs only; this machine is macOS.
- Projects-list word count is still stale until reload; Ollama still uses its first served model; GitHub tokens still plaintext until M6.

## Next: M4 — Local models, Meetily-style

DoD targets: Settings cards with Download / Ready / Selected; `models/catalog.json` with LOW/MID packs (never auto-download HIGH); an Ollama tab listing local models when the daemon is up; slots for Rewrite, Chat, Continuity and Embeddings; a hardware wizard that recommends a tier; and a real download path for one MID GGUF.
