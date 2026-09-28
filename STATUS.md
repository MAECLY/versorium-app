# STATUS

## Current milestone: M6 — Updater ✅ (DoD green)

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

## M6 DoD checklist

- [x] Tauri updater plugin (2.13) wired, with `createUpdaterArtifacts` and the real minisign public key
- [x] Reads GitHub Releases of the app's own repo, over the **API asset endpoint** — the only form that serves bytes from a private repository
- [x] **minisign + sha256** — the plugin verifies the signature, and the client verifies the digest against the release's `SHA256SUMS` before installing
- [x] Settings → Updates, using the M1 Updates token slot that has always been separate from the novel token
- [x] Dialog with **Download & Install / Later / Skip this version**
- [x] CI workflow that builds and publishes a signed release on a `vX.Y.Z` tag, plus `RELEASING.md`
- [x] Channels `stable` (default) and `beta`; automatic checking on by default on stable; offline never nags

## M5 DoD checklist (done)

## M5 DoD checklist

- [x] Export **Markdown** (canonical, lossless round trip), **DOCX** in standard manuscript format, **EPUB 3** (passes epubcheck 5.2.1 with zero errors and zero warnings) and **PDF** (base-14 Times-Roman, nothing embedded, chapter per page, running heads)
- [x] Import **Markdown** (tolerant of setext, CRLF, BOM, no headings, prose before the first heading), **DOCX** (H1 = chapter, across Word / Google Docs / LibreOffice / pandoc spellings), **Scrivener** best-effort (v2 and v3 layouts, binder order, synopsis, trash skipped)
- [x] **Round trip documented** — `FORMATS.md`, per format and per direction, plus the commands to verify each output
- [x] Losses are said out loud: an export reports what it could not carry, an import shows its losses **before** writing a project

## M4 DoD checklist (done)

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
| `cargo test` | ✅ 269 unit + 4 integration passed |
| `cargo clippy` | ✅ 0 warnings |
| `pnpm check` | ✅ 0 errors, 0 warnings |
| `pnpm test:ui` | ✅ 57 passed |
| `pnpm test:e2e` | ✅ 33 passed (7 new for updates) |
| `cargo test -- --ignored live_` | ✅ carried from M5: epubcheck 0/0, poppler, pandoc, a real model download, Ollama, Claude Code |

**Not verified end to end:** no release has been cut, so the workflow has never
run and no client has ever been offered a real update. The pieces are tested in
isolation; the first `v0.1.1` tag is what proves the whole chain.

## How the updater is kept from being a backdoor

An automated review flagged the runtime-endpoint design, and it was right to
look. The answer is that the endpoint is not configurable at all:

- Owner, repo and host are **compile-time constants**. There is no environment
  variable, no setting and no command parameter that can change where an update
  comes from — anything that could would be arbitrary code execution carrying
  our own signature. An override "for testing" was planned and deliberately
  dropped for exactly this reason.
- Every URL that reaches the network is re-validated to be **https on
  `api.github.com`**, so a tampered API response cannot redirect the download.
  Tests run hostile inputs through it, including `api.github.com.evil.example.com`.
- `endpoints: []` in the config is not an omission: the plugin refuses a check
  that did not set an endpoint at runtime, which closes the unauthenticated JS
  path rather than opening one. A static URL could not work anyway — a private
  repo's asset id changes with every release.
- The **private** signing key lives outside the repository. Only the public half
  is committed, which is what a public key is for.

## How the formats were built

Nothing was written from memory. A research pass built a working DOCX, EPUB and
PDF by hand on this machine, ran epubcheck, pandoc, poppler and QuickLook
against them, and **ablated each part to find which were genuinely required** —
that is how we know `word/styles.xml` is not optional (without it pandoc loses
every heading and the chapter round trip dies) while `docProps/core.xml` is. The
Rust writers are ports of those verified builders, and the same tools run as
`#[ignore] live_` tests.

Only two new dependencies: `zip` and `quick-xml`. The PDF needs neither a crate
nor a font file — Times-Roman is one of the base-14, so nothing is embedded.

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

- **`latest.json` from `tauri-action` 404s on a private repo.** It writes
  `github.com/.../releases/download/...`, and only the API asset endpoint serves
  bytes. The release workflow rewrites every platform URL, and the client
  refuses the un-rewritten form outright so the problem is named at check time
  rather than failing later on an empty download.
- **Signing in did not reach the panel that cares.** The Updates section reads
  the token saved under Git → Updates, and kept reporting "signed out" until
  Settings was reopened. Found by the end-to-end test — the seam between two
  sections is exactly what a unit test on either one misses.
- **A tag/version mismatch published silently.** A release tagged `v0.2.0` while
  the config still said `0.1.0` uploads fine and is never offered to anyone; the
  guard job now refuses it.
- **`pnpm/action-setup` would have failed every build** — no `packageManager`
  field, so it refuses to guess.

## Files / structure (M6 delta)

- `src-tauri/src/update/mod.rs` (release selection, host guard, sha256),
  `src-tauri/src/commands/update.rs` (6 commands)
- `tauri.conf.json`: `createUpdaterArtifacts`, the public key, `endpoints: []`
- Frontend: `src/lib/update/state.svelte.ts`,
  `src/lib/settings/UpdatesSection.svelte`,
  `src/lib/components/UpdateDialog.svelte`
- `.github/workflows/release.yml`, `RELEASING.md`
- Tests: `tests/e2e/m6-updates.spec.ts`, mock extended

## Architecture decisions (M6)

1. **download → verify → install**, not `download_and_install`. The spec
   requires rejecting a bad checksum, and the combined call leaves no window to
   look at the bytes.
2. **No token means no check.** Not a failed check — no request at all, so a
   private repo never sees a 401 loop and the UI shows a sign-in path instead.
3. **Later is per session, Skip is forever.** Only Skip reaches Rust.
4. **Release notes render as text.** A release body is remote content; a test
   pins that an `onerror` payload never becomes an element.
5. **Releases are drafts.** Publishing is the moment clients start being
   offered an update, so it stays a deliberate act after the checks in
   `RELEASING.md`.

## Known holes (M6)

- **The repo constants say `maecly/versorium-app`** (spec §11) while the current
  git remote is a personal fork. One human decision, one constant, one line in
  `RELEASING.md`.
- No release has been cut, so the workflow is unproven in practice. Several CI
  details could not be verified without running it: that `ubuntu-22.04` runners
  remain available, that `gh release download` works against a draft, and the
  macOS x86_64 cross-compile.
- No Apple notarization or Windows Authenticode yet — minisign only, so a first
  launch warns. Stated in the UI rather than hidden.
- GitHub tokens are still plaintext in `settings.json`; the keyring pass never
  happened and is now a standing hole rather than a deferred M6 item.
- Carried over: no built-in inference runtime, no Scrivener export, no EPUB
  import, no HTTP/SSE MCP transport, no network git.

## Next: M7 — Polish

DoD targets: onboarding with no signup, a basic corkboard, a continuity-check
stub, a local crash log with a Report button that opens an issue **carrying no
manuscript text**, focus and typewriter modes, and a font catalogue stub.
