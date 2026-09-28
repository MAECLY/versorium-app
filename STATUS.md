# STATUS

## Current milestone: M5 — Formats ✅ (DoD green)

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
| `cargo test` | ✅ 247 unit + 4 integration passed |
| `cargo test -- --ignored live_` | ✅ 6 passed — **epubcheck 5.2.1 reports zero errors and zero warnings**, poppler reads the PDF's prose and running head, pandoc reads the DOCX chapters back, plus the M4 model download and the M2 agent rewrites |
| `cargo clippy` | ✅ 0 warnings |
| `pnpm check` | ✅ 0 errors, 0 warnings |
| `pnpm test:ui` | ✅ 44 passed |
| `pnpm test:e2e` | ✅ 26 passed (7 new for export/import) |

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

- **quick-xml reports an escaped entity as its own event** rather than folding
  it into the surrounding text. Ignoring it silently deleted every escaped
  character — a chapter titled `Cap. 2 & "El <norte>"` came back as
  `Cap. 2  El norte`.
- **`<w:p/>` is a real empty paragraph**, not a non-event; skipping it shifted
  every later paragraph index.
- **The native save picker was never mocked**, so the export E2E waited forever
  on a dialog that never answered.
- **A Scrivener `Type=` attribute also appears outside the binder** — in
  `Collections`, `ProjectTargets` and `PrintSettings` — so the walk has to gate
  on being inside `<Binder>` rather than matching globally.

## Files / structure (M5 delta)

- `src-tauri/src/formats/`: `mod.rs` (the Manuscript shape and scene splitting),
  `markdown.rs`, `docx.rs`, `epub.rs`, `pdf.rs`, `scrivener.rs`
- `src-tauri/src/commands/formats.rs` (4 commands), `author` on `ProjectMeta`
- Frontend: `src/lib/formats/state.svelte.ts`,
  `src/lib/components/ManuscriptDialog.svelte`, Manuscript button in the TopBar
- `FORMATS.md` — the round-trip documentation
- Tests: `tests/e2e/m5-formats.spec.ts`, mock extended with the native pickers

## Architecture decisions (M5)

1. **Formats never touch the disk layout.** They take a `Manuscript` and emit
   bytes, or take bytes and produce chapters, so five formats stop each
   re-deriving what a chapter or a scene is.
2. **Losses are i18n codes, not prose** — the same convention the importers use,
   so what a format could not carry is said in the reader's language.
3. **Import writes nothing until confirmed.** The preview exists so the writer
   sees the losses before a project exists, not after.
4. **An export that would print a blank running head is refused** before a file
   is created, rather than shipping a manuscript with an empty header.
5. **The PDF embeds no fonts.** Base-14 Times-Roman means no licensing, no
   bundle weight, and no font loading — at the cost of anything outside WinAnsi,
   which is reported.

## Known holes (M5)

- **No Scrivener export.** Spec §9 wants a round trip; the DoD asked for import
  only, and that is what shipped.
- **No EPUB import.** §9 marks it best-effort; the DoD does not list it.
- Scene titles do not survive DOCX or PDF (standard manuscript format has no
  place for them) and characters outside WinAnsi do not survive PDF. Both are
  reported to the writer and documented in `FORMATS.md`.
- DOCX heading detection was reasoned against generated fixtures: the research
  pass was **blocked from reading the real .docx files on this machine** by a
  PII classifier, so producer variants are handled generously but were not
  observed in the wild.
- Carried over: no built-in inference runtime, Whisper packs absent, GitHub
  tokens plaintext until M6, no HTTP/SSE MCP transport, no network git.

## Next: M6 — Updater

DoD targets: the Tauri updater plugin reading GitHub Releases of
`maecly/versorium-app`, minisign + SHA256 verification, a Settings → Updates
login kept separate from the novel GitHub, an Install / Later / Skip dialog, and
a CI workflow that builds a `vX.Y.Z` tag.
