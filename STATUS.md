# STATUS

## Current milestone: post-v1 — UI/UX pass ⏳ · M0–M7 complete

Work after M7 lives on `feat/m8-inference-runtime`. It is not a milestone with a
DoD; it is what reading the app with fresh eyes turned up, plus the largest
known hole (no inference runtime). See "Post-v1 pass" below.

## How to run

```bash
# Node v20 via nvm must be on PATH. NOTE: the corepack pnpm shim in nvm is
# broken on this machine (points at pnpm/12.4.1/bin/pnpm.cjs, which pnpm 12
# does not ship); /opt/homebrew/bin/pnpm works.
export PATH="$HOME/.nvm/versions/node/v20.19.1/bin:$PATH"

# There is now a Makefile wrapping all of this: `make help` lists it, and it
# resolves the two absolute paths this machine needs (pnpm, the real JDK).
make dev              # dev window (make devtools opens the inspector)
make verify           # the whole gate: check, test-ui, test, clippy, test-e2e
make check            # svelte-check (0 errors, 0 warnings)
make test             # cargo test
make test-ui          # vitest, jsdom
make test-e2e         # Playwright, system Chrome, mocked IPC
make test-live        # the #[ignore] live_ tests (fetches epubcheck first)

versorium mcp [--client <id>]   # serve MCP over stdio
```

Browser preview with the IPC stubbed: `pnpm dev` → `http://localhost:1420/?mock=tauri`.

## M7 DoD checklist

- [x] **Onboarding with no signup** — spec §14's five steps, every one skippable, a Skip that always works, and nothing created until the project step is confirmed
- [x] **Corkboard** — a card per chapter with title, words, status and a preview, opening the chapter on click
- [x] **Continuity check stub** — runs through a selected Ollama model, and returns `ran: false` with a reason rather than an empty report when there is none
- [x] **Crash log local + Report** — scrubbed entries on disk, an issue URL prefilled from the scrubbed entry, and nothing sent unless the writer presses Report
- [x] **Focus mode + typewriter** — both through CodeMirror compartments, so toggling never rebuilds the editor
- [x] **Font catalogue stub** — the faces already on the machine, with Source Serif 4 listed as unavailable rather than offered with a dead URL

## M6 DoD checklist (done)

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
| `cargo test` | ✅ 305 unit + 4 integration passed |
| `cargo clippy` | ✅ 0 warnings **on shipped code**. `--all-targets` reports 6, all in test code, all predating this branch — the earlier "0 warnings" was measured without that flag and overstated the result |
| `pnpm check` | ✅ 0 errors, 0 warnings |
| `pnpm test:ui` | ✅ 82 passed |
| `pnpm test:e2e` | ✅ 39 passed (6 new for polish) |
| Real app | ✅ launches with every M7 control present, editor, project switching and the Git panel working |

**Honest limit on the real-app pass**: the corkboard and focus mode were driven
through the browser end-to-end suite, which exercises the same components via
the same TopBar buttons, but coordinate-driven clicks in the desktop window kept
landing on the wrong control, so they were not clicked in the real app.

## How the crash log is kept from carrying a manuscript

Spec §12 says zero prose, and a panic payload is whatever someone passed to
`panic!`, so the scrubber removes rather than trusts: absolute paths collapse to
an extension, emails and credential-shaped tokens go, and any run of six plain
words goes with them — chapter filenames are slugified titles, so a path is
prose too. Proved gone in tests: Spanish prose, chapter paths, `ghp_` tokens,
sha256 hex, emails, Windows and `file://` paths, and all of their
percent-encoded forms inside the report URL.

That threshold has a price, taken deliberately: `index out of bounds: the len is
3 but the index is 5` is seven plain words and collapses. No threshold both
keeps that and drops seven words of somebody's novel, so the manuscript wins —
the numbers and the panic location survive, which is what identifies the bug.

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

- **The corkboard fetched every chapter twice.** Its effect read the preview
  cache to decide what to fetch and then wrote to it, so storing a preview
  re-triggered the read that stored it. The dedupe now lives outside reactive
  state.
- **Onboarding advanced relative to wherever the writer stood**, so reaching the
  project or template step from earlier landed on the wrong one.
- **`detectAgents()` returning a non-promise** blew up the whole first step.
- **The Report button could not open a browser** — there was no opener plugin,
  so spec §12's "opens the browser" was a link the desktop app could not follow.
- **Onboarding was unreachable**: nothing mounted it, because the file that
  mounts it belonged to a different agent than the one that wrote it.

## Files / structure (M7 delta)

- Rust: `src-tauri/src/crash/`, `src-tauri/src/continuity/`,
  `src-tauri/src/fonts/`, `src-tauri/src/commands/polish.rs`, `fonts/catalog.json`
- Frontend: `src/lib/editor/modes.ts`, `src/lib/binder/Corkboard.svelte`,
  `src/lib/onboarding/`, `src/lib/settings/TypographySection.svelte`,
  `src/lib/settings/SafetySectionCrash.svelte`
- Tests: `tests/e2e/m7-polish.spec.ts`, mock extended with a fresh-install flag

## Architecture decisions (M7)

1. **Modes go through compartments.** Toggling focus or typewriter must never
   rebuild the editor — a test builds a real view, sets a caret, reconfigures,
   and asserts the same DOM node, caret and text survive. That regression cost a
   writer their selection and undo history once already.
2. **Continuity refuses to pretend.** An empty findings list reads as "your
   novel is consistent"; a stub that did not run has to say so.
3. **Template chapter titles live in the locale files**, because they become
   chapter titles inside the writer's own project and a Spanish writer should
   not open a manuscript full of English beat names.
4. **No Download button for a font we cannot fetch.** The catalogue lists what
   is installed and marks Source Serif 4 unavailable.
5. **Focus dims the chrome only once it holds neither hover nor keyboard
   focus**, so a keyboard user never loses their place, and Escape always exits.

## Known holes at the end of v1

- **No built-in inference runtime** (M4). A downloaded GGUF is verified and Ready
  but nothing loads it, so the continuity check and any built-in slot depend on
  Ollama. This is the largest gap between the spec and the build.
- **No release has ever been cut** (M6), so the updater chain is unproven end to
  end and the repo constants still name `maecly/versorium-app` while the remote
  is a personal fork.
- **GitHub tokens are plaintext** in `settings.json`. The keyring pass was
  deferred from M0 to M6 and never happened.
- No Scrivener export, no EPUB import (M5). No HTTP/SSE MCP transport, no
  network git (M3/M1). Whisper dictation packs absent (M4).
- No Apple notarization or Windows Authenticode — minisign only.
- Scene titles do not survive DOCX or PDF; characters outside WinAnsi do not
  survive PDF. Both reported to the writer and documented in `FORMATS.md`.
- Creative Mode remains a disabled control, as the spec requires for v1.

## Post-v1 pass (branch `feat/m8-inference-runtime`)

Not a milestone. This is what came out of reading the app as a reader rather
than as its author, plus the corrections that reading forced.

### Defects found, all in code that was already merged and green

- **The rewrite slot was never consulted.** `agents::rewrite` dispatched on a
  bare provider string, so an `ollama` slot ran `tags.models[0]` — whatever the
  daemon happened to list first — instead of the model chosen in Settings. A
  `builtin` slot had no branch at all and reported "that agent is not
  installed", which described the wrong problem. Dispatch is now on the
  `{kind, id}` assignment.
- **The typewriter toggle did nothing**, for two independent reasons. It was a
  no-op on any chapter shorter than two thirds of a screen, because
  `desiredScrollTop` clamps at zero and only the bottom was padded. And no
  toggle in the chrome had a visible pressed state — `aria-pressed` was set, so
  a screen reader knew, but nothing was styled for it.
- **The history panel had no end-to-end coverage whatsoever.** Commits were only
  ever asserted as a side effect of an AI rewrite.
- **Three error codes had no locale key** in either language — `cancelled`,
  `ollama_offline`, `ollama_failed` — so each reached the writer as "Something
  went wrong."
- **A comment in `catalog.rs` still called the catalogue a version-0 stub**,
  which stopped being true when the eight-entry ladder landed. A subagent read
  the comment, believed it over the data, and reported the catalogue as empty.
- Saving a snapshot without a description stored the literal word
  `checkpoint`, so a list of them was indistinguishable — which defeats the one
  reason the list exists.
- The view toggle named its destination ("Editor" while in the corkboard), which
  contradicted the pressed state once that became visible.

### Redesign

- **Settings is a page, not a modal.** Nine unrelated concerns had accumulated
  in one scrolling dialog in the order the milestones built them. Six groups
  now, each answering one question and saying so in a line under its heading.
  Two placements changed on purpose: the "Git" section held two credentials for
  unrelated jobs (authorizing update downloads vs backing up the novel) and they
  moved beside the thing each one serves; continuity and the content filter were
  loose in the middle of the modal and moved to the models they depend on.
- **Git's vocabulary is gone from the reader's path.** commit → snapshot, repo →
  backup, commit message → what changed. `snapshot`/`instantánea` was already
  this codebase's word in `ai.checkpointNote`, so it was spread rather than
  invented. Git's three-way modified/staged/untracked split collapsed to one
  list, because Versorium commits the whole project at once and the distinction
  never reached a decision the writer makes. Branch, remote and the short hash
  live behind an Advanced tab that opens by saying it is Git underneath.
- **The bars are split by what each control is for.** Thirteen controls had
  collected in the header, all rendered identically. The header now holds what
  acts on the manuscript; document state and view modes moved to the status bar,
  which is where VS Code, Scrivener and iA Writer put them, and groups are
  divided by a hairline. The two range-restore buttons became one whose scope is
  implied by the selection, with `Cmd/Ctrl+Alt+R`.
- **The model cards say what a model is for.** They showed `{speed} • {quality}`
  and nothing else. The load-bearing fact is stated once above the ladder: the
  seven writing models do the same three jobs and differ only in size, so the
  choice is which one the machine can hold. nomic-embed now says it does not
  write.

### Deliberate non-changes

- Almost no control gets an icon. Focus, Typewriter and Corkboard have no
  universal glyph, and the original complaint was labels that could not be
  understood — an icon there worsens exactly that. Only glyphs already carrying
  meaning stay (the `↩` prefix, the dirty dot).
- Focus and Typewriter are not added to Settings → Writing. They are modes, not
  preferences, and they now live in the status bar with visible state; a second
  copy in Settings would be the same control in two places.

### Still open on this branch

- The inference runtime itself. The approach is decided (llama.cpp in-process
  via `llama-cpp-2`) and the constraints are measured, but it is not built.
- A backup destination that is not GitHub — iCloud Drive, OneDrive, or a chosen
  folder — with GitHub demoted to an advanced option. Note that a live `.git`
  must not sit inside a synced folder: these services sync per file without
  git's ordering or atomicity and evict files to placeholders, which corrupts
  repositories. `git2` 0.19 cannot write a bundle (libgit2 has no bundle
  support), so the artifact should be a single timestamped archive — the `zip`
  crate is already a dependency for DOCX.

## Next

M0–M7 are complete. The spec's own "Criterios de aceptación" (§17) is the
remaining bar: it asks for a real release to be published and installed by three
platforms, which needs the two human decisions above.
