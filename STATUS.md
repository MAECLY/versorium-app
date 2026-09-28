# STATUS

## Current milestone: M4 — Local models, Meetily-style ✅ (DoD green)

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

## M4 DoD checklist

- [x] Settings → Local AI cards moving **Download → % + Cancel → Ready → Selected**, with the weight icon, one-liner, badge, size/quality/quant/context/RAM meta, licence and repo the spec's card bullet list asks for
- [x] `models/catalog.json` with the LOW → MID → MID+ → HIGH ladder plus an embeddings pack; **nothing downloads on its own**, HIGH least of all
- [x] Ollama tab: daemon state, the pulled models, pull by name, remove with confirmation, install hint when it is not there
- [x] Slots for Rewrite, Chat, Continuity, Embeddings — and Dictation — each picking its own model instead of one global choice
- [x] Hardware wizard: memory, cores, platform, graphics, and the largest tier that fits with 20% headroom, stated in a sentence
- [x] Real downloads: streamed, resumable from a `.part`, one at a time, SHA256-verified, destroyed on mismatch
- [x] Studio tab (LM Studio / llama-server) with a connection test; Dictation is the UI hole the spec asks for until the Whisper packs land
- [x] i18n EN + ES (81 `localAi.*` keys)

## M3 DoD checklist (done)

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
| `cargo test` | ✅ 165 unit + 4 integration passed |
| `cargo test -- --ignored live_` | ✅ 3 passed — including a **real 84 MB download from Hugging Face, verified against its published SHA256**, plus Ollama round-trip and a rewrite through Claude Code |
| `cargo clippy` | ✅ 0 warnings |
| `pnpm check` | ✅ 0 errors, 0 warnings |
| `pnpm test:ui` | ✅ 33 passed |
| `pnpm test:e2e` | ✅ 19 passed (8 new for the model panel) |
| **Real app** | ✅ Settings → Local AI renders the shipped catalogue: Gemma 4 and Qwen 3.8 cards with licence, repo, quant, context and RAM hint; wizard recommends the tier that fits; 0 B downloaded on open |

## Catalogue provenance

Every `sha256` was read from Hugging Face's LFS `oid`, never guessed, and every
`sizeBytes` confirmed with a HEAD request. The method itself was proven by
downloading the 84 MB embedder in full and comparing `shasum -a 256` against the
published oid. Nothing in the catalogue is gated, so the downloader needs no
credentials. Sidecar `mmproj`/`mtp` blobs are deliberately absent — the main
GGUF loads standalone and the extras would double the download for nothing.

The spec's example models are a generation behind: Gemma 4 and Qwen 3.8 are
current, and Gemma 4 ships `apache-2.0` and ungated where Gemma 3 was neither.
`Qwen3-4B-Instruct-2507` stays as a mid entry because it is the only candidate
inside the 2.3–2.6 GB band the spec names.

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

- **The RAM hint never reached the UI.** serde's camelCase renders `ram_hint_gb`
  as `ramHintGb`, but the catalogue file, the TypeScript types and the spec all
  spell it `GB`. Every test passed because the E2E mock is written by hand and
  spelled it correctly — only the real app showed `undefined`. Both structs now
  pin the wire name and a test asserts every key the frontend reads.
- **`tier: "embeddings"`** — my own brief was ambiguous: the embedder is a `low`
  tier model whose `task` is embeddings, not a fifth tier.
- **Six dead wrappers in the store** — the command layer resolves the models
  directory once per request and uses the `_in` twins, so the convenience
  wrappers were never called.
- **`pnpm tauri dev` could not open the window** on a machine whose corepack
  pnpm shim is broken. The Tauri hooks now run the local vite binary directly,
  like the Playwright web server already did.

## Files / structure (M4 delta)

- Rust `src-tauri/src/models/`: `catalog.rs` (embedded, validated on load),
  `store.rs` (state from size, streaming hash, delete), `download.rs` (resume,
  cancel, verify, rename), `hardware.rs` (probe + tier recommendation)
- `src-tauri/src/commands/models.rs` (10 commands), slots in `settings.rs`,
  Ollama list/pull/delete in `agents/mod.rs`
- Frontend: `src/lib/models/state.svelte.ts`, `src/lib/settings/LocalAiSection.svelte`
- `models/catalog.json` — 8 entries with verified hashes
- Tests: `tests/e2e/m4-models.spec.ts`, mock extended

## Architecture decisions (M4)

1. **State from file size, never a re-hash** — the panel refreshes often and the
   weights are gigabytes; the hash is checked once, when a download finishes.
2. **Cancel keeps the `.part`** — that is what makes the next start a resume.
   Only a hash failure deletes it, because a corrupt prefix can never converge.
3. **A slot can never point at a file that is gone** — deleting a model, or
   removing it from Ollama, releases every task that selected it.
4. **The wizard recommends, it never forbids** — a model too large for the
   machine says so and stays downloadable.
5. **Tests inject their directory rather than setting an env var** — Rust runs
   tests in parallel threads and a process-global override would race.

## Known holes (M4)

- **No built-in inference runtime.** A downloaded GGUF is verified and Ready,
  but nothing loads it yet — llama.cpp embedding is the next step, and the DoD
  explicitly allowed "stub download + hook". Slots pointing at Ollama do run;
  slots pointing at a built-in model are recorded but not yet executed, so the
  rewrite path still goes through the CLI harnesses from M2.
- Whisper/dictation packs are absent by design — the tab and the shared
  downloader ship now, the packs land in M4.1 per spec §6.2.
- Censorship hides uncensored cards but does not yet influence routing.
- The Recommended badge marks a tier, so both models in the winning tier carry it.
- Carried over: projects-list word count stale until reload, GitHub tokens
  plaintext until M6, no HTTP/SSE MCP transport, no network git.

## Next: M5 — Formats

DoD targets: export Markdown, DOCX (standard manuscript format), EPUB 3 and PDF;
import Markdown, DOCX (H1 = chapter) and Scrivener best-effort; round-trip
documented.
