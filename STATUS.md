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

## Verification (this machine, 2026-09-28, macOS 27.0)

| Check | Result |
|---|---|
| `cargo test` | ✅ 438 unit + 4 integration passed, 16 ignored |
| `cargo clippy --all-targets` | ✅ 0 warnings. The 6 that used to be reported were in test code and are now fixed, so CI can run this flag with `-D warnings` |
| `pnpm check` | ✅ 0 errors, 0 warnings, 368 files |
| `pnpm test:ui` | ✅ 91 passed |
| `pnpm test:e2e` | ✅ 81 passed |
| `node tests/locale-parity.mjs` | ✅ 632 keys in each of en, es |
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

### The inference runtime (the largest hole, now closed — with limits)

llama.cpp runs in-process via `llama-cpp-2`, pinned to `=0.1.157`. A `builtin`
slot executes; continuity no longer skips one. Four candidates were investigated
and adversarially challenged first — Ollama-as-runtime was rejected because
`Ollama.app` requires macOS 14 while Versorium ships an Intel `.dmg` with no
minimum, so exactly the low-RAM Intel Macs needing the `low` tier could install
Versorium and never its runtime; pure-Rust candle loads one of eight catalogue
entries, verified by running it.

**Verified on this machine** against a real 3B GGUF: it answers, a concurrent
call is refused rather than queued, and a CLIP vision encoder fed to it fails as
`llama_load_failed` instead of crashing.

Three things that came from reading the crate rather than assuming it:

- `token_to_str` is deprecated and builds a fresh decoder per call, so an
  accented character split across two tokens loses its accent. One `encoding_rs`
  decoder now lives for the whole loop via `token_to_piece`. For a Spanish-first
  tool that was the difference between working and quietly corrupting output.
- `llama_sampler_sample` accepts the token internally. The upstream example
  accepts again — harmless with `dist`, corrupting the moment a penalty or
  grammar sampler is added — so this does not.
- llama.cpp defaults to 512 tokens of context and 4 threads regardless of
  machine. 512 would cut a selected passage in half.

**Limits, stated rather than discovered later:**

- **Metal and CPU only. No CUDA, no Vulkan** from the current release matrix,
  so §6.2 is half-delivered knowingly: an NVIDIA or AMD owner gets CPU speeds
  from a `builtin` slot, and the UI says so rather than letting it read as a
  fault. The additive follow-up is the crate's `dynamic-backends` feature.
- **In-process means a ggml assertion kills the editor.** `ggml_abort()` calls
  `abort()` even with a callback installed. This is what a sidecar would have
  bought and it is a conscious trade; it is bounded because a malformed GGUF is
  caught gracefully, the editor autosaves, and every AI write is preceded by a
  git snapshot, so the worst case is a lost session window, not lost prose.
- **First-run Metal compile: 14.9 s measured on an M4 Max**, plausibly longer on
  an M1 Air (not measured). A background warm-up thread hides it, but the OS
  shader cache is shared across every Metal app on the account and rotates, so
  it can recur. Shipping an ahead-of-time `default.metallib` would fix it and is
  blocked by the Metal Toolchain being a stub in Xcode 27.
- **Dictation is still unsolved and now says so.** llama.cpp cannot load Whisper
  and the catalogue has no speech entry, so the slot keeps refusing.
- **CI cannot smoke-test inference** without hosting a small GGUF fixture. The
  path ships with unit coverage plus a `live_` test gated on
  `VERSORIUM_TEST_GGUF`.

### Backup, done properly (2026-09-28)

Three layers, named as layers in the UI, because they fail differently:

1. **The novel's own history.** Always on, nothing to configure.
2. **Up to three folders elsewhere**, written in one pass. Cloud providers are
   detected rather than guessed — `~/Library/CloudStorage/Vendor-Account`,
   Dropbox's `info.json`, the Nextcloud/ownCloud `.cfg` — so somebody who moved
   their Dropbox folder still gets a working backup. A **second or third disk**
   is offered too, with mount points excluded by device number rather than by
   name, so an empty `/Volumes/Something` left by an ejected drive is never
   silently accepted.
3. **GitHub**, collapsed, because it needs an account and a token.

What the three-copy rule (three copies, two media, one offsite) asked for and
this now reports rather than scores:

- Every destination says whether it **leaves the machine**. A second disk
  survives a dead drive, not a burnt flat, and calling both "backup" hides the
  only difference that matters.
- Two destinations on one disk are counted as **one disk**, by device number. A
  frontend comparing path prefixes would call `/Volumes/Backup` and
  `/Volumes/Backup2` two disks.
- A volume that cannot be identified makes the count **unknown**, never
  optimistic. Claiming "2 disks" on a guess is the one lie this must not tell.
- Outcomes are **never collapsed into one result**. Two of three succeeding is a
  real outcome that both "backed up" and "failed" misreport. A destination that
  is gone reports as unavailable and is retried next time.
- An archive can be **checked on demand**: reopened, and every entry read back.

A live `.git` still must not sit inside a synced folder — these services sync
per file without git's ordering or atomicity and evict files to placeholders —
so the artefact is one timestamped zip, and the panel says so where somebody is
about to choose a folder.

### Author metadata (2026-09-28)

Settings → Writing holds **two author profiles**, work and personal, and each
field states in the UI where it lands. The fields were chosen by what the
formats can carry, not by what a form usually asks for:

| Field | Where it goes |
|---|---|
| name | creator in EPUB, DOCX, PDF, Markdown |
| sortAs | EPUB `file-as`; guessed from the name, and the guess is the placeholder |
| role | EPUB only, as a MARC relator; an unlisted code is dropped |
| organization | `dc:publisher` in EPUB, `Company` in DOCX |
| rights | `dc:rights` in EPUB, `/Subject` in PDF, `dc:description` in DOCX |

No email and no address: no export format has a slot for either, and storing a
contact detail only to look at it is not a feature.

Three gaps this closed, all of them silent until somebody opened the file
properties: DOCX had **no app.xml at all**, so Word showed the manuscript as
coming from no application; PDF had **no information dictionary**, so every
reader's properties panel was blank; EPUB had a creator with **no file-as**, so
a library shelved *El largo invierno* under A for Ana.

### Chapter order is data, not a numbering (2026-09-28)

`versorium.json` gains `chapterOrder`. Reorder used to be impossible to do
safely because order came from the id, the id is in the filename, and renaming
files is what git history follows, what a backup archive contains, and what
`.versorium/ops/<id>` is keyed by. It is an override, not the whole truth:
anything missing from the list still sorts by id, after the ordered ones, so a
chapter restored from a backup appears rather than vanishing.

### Model catalogue (2026-09-28)

Four models under 1.3 GB — Qwen3.5 0.8B (0.58 GB), Llama 3.2 1B (0.81 GB),
SmolLM2 1.7B (1.06 GB), Qwen3.5 2B Q3\_K\_M (1.22 GB) — with sizes and hashes
taken from the Hugging Face **LFS object ids**, which are the sha256 the
downloader checks. `tests/catalog/hf-files.py` is how, so the next person adding
a model does not work it out again. Every URL in the catalogue re-checked: 12/12
return 200. The panel gained search, family chips, a "runs on this machine"
filter, a sort and a count, with each card's quant/context/RAM/licence folded
behind Details — eleven models in one column of full cards is a scroll, not a
list.

### Still open on this branch

- **One unreproduced test failure.** A single `cargo test` run reported 1 failed
  of 438 without naming it in captured output, and ten subsequent runs were
  clean. Not diagnosed, so not claimed fixed. Ephemeral ports rule out the
  obvious cause (the MCP http tests bind port 0).
- **Chat UI, the embeddings search index, and Whisper dictation.** The three
  features with a runtime behind them and no surface yet. Dictation has no
  Whisper pack in the catalogue and the UI says so rather than pretending.
- **Apple notarization and Windows Authenticode.** Both need purchased
  certificates, so neither is a code problem.

## Next

M0–M7 are complete. The spec's own "Criterios de aceptación" (§17) is the
remaining bar: it asks for a real release to be published and installed by three
platforms, which needs the two human decisions above.
