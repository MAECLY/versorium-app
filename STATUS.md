# STATUS

## Where things stand (2026-10-03)

M0–M7 are complete. Two rounds of work after them are merged into `main`:
PR #7 (the post-v1 pass and the built-in inference runtime) and PR #9
(`feat/v11-hardening`, 40 commits, merged 2026-10-03). Work now continues on
`feat/landing-and-docs`.

What is **not** true yet:

- **No release has been cut and no tag exists.** `tauri.conf.json` says
  `Versorium` / `dev.versorium.app` / `0.1.0`. The updater chain, the release
  workflow and the installers have never run end to end.
- **The repository is private** (`github.com/MAECLY/versorium-app`), and MAECLY
  is on GitHub's free plan, where Pages does not serve private repositories.
- **The landing page is not live.** `versorium.maecly.com` is planned as a
  GitHub Pages site built from `docs/` by `.github/workflows/pages.yml`, being
  added on this branch. It goes live only once the repo is public, Pages is
  enabled, and Cloudflare has `versorium` CNAME → `maecly.github.io`.
- The release signing secrets are set on 2026-10-03 (17:18 UTC); the first tag build is the
  end-to-end proof (see "Release readiness").

`TODO.md` lists the work that is half-done in the code, the three Local AI
tasks that are specified and not started, and the steps to going public. It is
not a complete list of what the spec asks for and the code does not do yet: the
"Implementation notes (2026-10-03)" sections at the end of
`PROMPT-VERSORIUM.md` and `DESIGN-VERSORIUM.md` record the rest (among them the
command palette, BYOK, most CLI subcommands, the downloadable font catalogue),
each against the code. "Still open" below is the short form of `TODO.md`.

## How to run

```bash
# The Makefile resolves the two absolute paths this machine needs: pnpm at
# /opt/homebrew/bin/pnpm (the corepack/nvm shim is broken here) and the real
# JDK for epubcheck (the `java` on PATH is the macOS stub). Override either:
# `make dev PNPM=pnpm`. Node 20 is what CI uses; on this machine it is
# ~/.nvm/versions/node/v20.19.1/bin, put on PATH before running make.
make help             # every target, with a one-line description
make dev              # dev window (make devtools opens the inspector)
make verify           # the whole gate, fast first: check, locales, test-ui, test, clippy, test-e2e
make check            # svelte-check (0 errors, 0 warnings)
make locales          # EN/ES key parity, no blank strings, no error code with a space
make test             # cargo test
make test-ui          # vitest, jsdom
make test-e2e         # Playwright against the mocked IPC
make test-live        # the #[ignore] live_ tests (fetches epubcheck first)
make icons            # regenerate the whole app icon set from tests/icons/generate.py
make bundle           # installable app (.dmg / .msi / .AppImage)

versorium mcp [--client <id>]   # serve MCP over stdio
```

`make clippy` runs `cargo clippy -- -D warnings` on shipped code only. CI runs
the stricter `cargo clippy --all-targets -- -D warnings`, which is the form
measured below; the Makefile target's description ("test code has known
warnings") predates the test-code warnings being fixed.

Browser preview with the IPC stubbed: `make mock` (or `pnpm dev`) →
`http://localhost:1420/?mock=tauri`. The mock only loads in a dev build.

## Verification (2026-10-03, on the merged head of PR #9)

| Check | Result |
|---|---|
| `cargo test` | ✅ 464 unit + 4 integration passed, 16 ignored |
| `cargo clippy --all-targets -- -D warnings` | ✅ 0 findings |
| `pnpm check` (svelte-check) | ✅ 0 errors, 0 warnings, 377 files |
| `pnpm test:ui` (vitest) | ✅ 93 passed |
| `pnpm test:e2e` (Playwright, mocked IPC) | ✅ 96 passed |
| `node tests/locale-parity.mjs` | ✅ 679 keys in each of en and es |
| CI (`.github/workflows/ci.yml`) | ✅ green on the merged head |

What this table does not cover: the 16 ignored tests were not run. Fifteen are
the `live_` ones, which need something outside the test process: the network,
GitHub, Ollama, installed agents, pandoc, poppler, epubcheck, a real GGUF, the
OS credential store, the system trash, the sync folders on this machine, or a
localhost socket. The sixteenth, `hook_writes_a_scrubbed_record` in
`src-tauri/src/crash/mod.rs`, is ignored because it installs a process-global
panic hook; `make test-live` (`--ignored live_`) does not run it. The results
of running the format tools by hand on 2026-10-03 are in `FORMATS.md`. The
end-to-end suite runs against a mocked IPC, not the desktop app, and the
desktop app was not driven by hand for this measurement. The Vulkan build is
only compile-checked by CI (`cargo check --features vulkan` on Linux, on `main`
and on demand, not on pull requests); it has never run on a GPU.

## Release readiness

- **Signing.** The updater's private key lives outside the repo at
  `~/.versorium/signing.key`. It is encrypted but signs with an empty password.
  `tests/release/verify-signing-pair.py` proves that a signature made with it
  verifies against the public key compiled into `tauri.conf.json`, and includes
  a negative control. The two GitHub secrets, `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty), were set on 2026-10-03 (17:18 UTC) by the
  maintainer.
- **Release notes.** The release workflow builds a *draft* on a `vX.Y.Z` tag and
  its body now carries two notices, in English and Spanish. They replace an
  older note telling macOS users to "right-click and choose Open", which does
  not get past the quarantine on a bundle without a Developer ID signature:
  - *macOS will say the app is damaged. It is not.* The fix is
    `xattr -rd com.apple.quarantine /Applications/Versorium.app`, run only on a
    build taken from the release page.
  - *SmartScreen will interrupt the installer.* Choose More info, then Run
    anyway.
- **No Apple notarization, no Windows Authenticode.** Both need purchased
  certificates, and the certificates alone do not produce a signed build:
  `release.yml` passes only `GITHUB_TOKEN` and the two `TAURI_SIGNING_*`
  variables to `tauri-action`, and `tauri.conf.json` has no signing identity
  and no certificate thumbprint, so the workflow and the config both need
  changes once the certificates exist. Until then every release depends on the
  two notices above; minisign plus `SHA256SUMS` is what the updater verifies.

## Updater without a token (2026-10-03, on `feat/landing-and-docs`)

On 2026-10-03 the founder decided that once the repository is public, updates
must work without a GitHub token. `PROMPT-VERSORIUM.md` §11 now opens with
that amendment, dated, above the original text, which is kept. What changed:

- **No token means an anonymous check, not no check.** `update_check` and
  `update_install` (`src-tauri/src/commands/update.rs`) no longer return early
  without a token, and the startup check no longer waits for one
  (`src/lib/update/state.svelte.ts`). `update::request_headers` adds
  `Authorization` only for a saved, non-blank token: without one there is no
  such header at all, not an empty `Bearer`. A saved token is sent exactly as
  before, which keeps updates working while the repository is private and
  lifts GitHub's anonymous limit (60 requests an hour per address; a check
  costs two: the release list and `latest.json`).
- **Each answer GitHub can give has its own code and its own EN and ES text**
  (`update::classify`). `update_none_visible`: a 404, so nothing is published
  yet, or the repository is still private and no token is saved; shown as a
  quiet line. `update_rate_limited`: a 403 with `x-ratelimit-remaining: 0` or
  `retry-after`, or a 429; it says a token lifts the limit and, when GitHub
  sends a reset time, when it lifts. `update_rate_limited_token`: the same with
  a token sent, without the advice to add one. `update_token_rejected`: a 401,
  or another 403, with a token sent. `network`: still quiet, now with a line
  that says nothing was checked. It also covers answers that are none of the
  above, such as a 5xx or an anonymous 403 with no rate-limit headers, so the
  line says GitHub could not be reached *or did not answer as expected*. The
  panel says "Not checked yet." until a check has finished. Before, it said
  "This is the newest release." as soon as the status loaded, whether or not
  anything had been checked, and after a failed check. `bad_signature`,
  `no_checksums` and `unsupported_platform` had no text and showed "Something
  went wrong."; each has its own now.
- **A limit reached between two requests is still named.** After the release
  list, the next request of a check (`latest.json`) and the next two of an
  install (`latest.json`, then the installer) are the plugin's, and the plugin
  cannot say why GitHub refused one: it reports a refused `latest.json` as "no
  release" and a refused installer as a network failure. GitHub's answer to
  the list already says how many requests are left this hour. When fewer are
  left than the check (one) or the install (three, `SHA256SUMS` included)
  still needs, the updater reports the limit there, with its reset time, and
  sends nothing that would be refused (`update::budget_covers`). What it
  cannot see is another program on the same address spending the last request
  in the instant between the list and the plugin's request. That check reads
  "No release matched this channel.", and the next one names the limit.
- **The token cannot follow a download off `api.github.com`.** Asset downloads
  are redirected to GitHub's storage host. reqwest — 0.12.28 for the app's own
  client, 0.13.5 inside tauri-plugin-updater, both from `Cargo.lock` — drops
  `Authorization` on a hop to another host, but it compares each hop only with
  the one before it, and tower-http 0.6.11, which follows the redirects for it,
  rebuilds each hop's headers from the original request. So a second hop that
  stays on the storage host carries the token again.
  `tests/updater/redirect-probe` shows this on both versions. Nothing leaked:
  no release has ever existed, so this path never ran, and GitHub's redirect
  for a public repository's asset, measured on 2026-10-03, is a single hop to
  `release-assets.githubusercontent.com`, which answers itself. Both clients now
  follow a redirect only out of `api.github.com`, and only over https
  (`update::may_follow`, applied to the plugin's client through
  `configure_client`). Two loopback tests show the token reaching the first
  host and nowhere else.
- **The installer URL is pinned before anything is downloaded.** It comes
  from `latest.json`, which nothing signs, and the plugin sends the builder's
  headers, the token among them, to wherever it points. Before this change, a
  tampered `latest.json` could have pointed the token at any host; the
  minisign check refused the bytes, but only after the token was gone.
- **Unchanged, and tested as such:** owner, repo and host compiled in;
  `manifest_url_for`; minisign in the plugin, with the public key and
  `endpoints: []` pinned by a test against `tauri.conf.json`; the
  `SHA256SUMS` comparison (`update::digest_matches`); no install on any
  mismatch. The anonymous path goes through all of them.
- **Settings → Application:** Check now is never disabled for want of a token,
  the "Sign in under Settings → Application…" line is gone, and the token
  section is "Updates token (optional)" with a one-line reason.

## Merged in PR #9 (`feat/v11-hardening`, written 2026-09-28 → 29, merged 2026-10-03)

### Backup

- **A synced folder, not only GitHub.** The project is archived as one zip,
  `.git` included, into a folder the OS already syncs. The live repository
  never goes inside the synced folder: those services sync file by file without
  git's ordering or atomicity. Archives are written under a `.part` name and
  renamed when complete; pruning only touches this project's own prefix.
  Restore extracts **beside** the original, never over it, and zip entries go
  through `enclosed_name`.
- **Providers are detected, not guessed**: `~/Library/CloudStorage/Vendor-Account`
  on macOS, Dropbox's `info.json`, the Nextcloud/ownCloud `.cfg`. A destination
  is probed for writability, and hidden directories are skipped — the first
  writable child of Google Drive was `.Trash`.
- **Up to three destinations** (`MAX_DESTINATIONS = 3`), written in one pass,
  each reporting separately. Details in "Backup, done properly" below.
- **Deduplicated by content.** An archive is identified by a fingerprint of the
  project — every path and every byte, each field length-prefixed so a rename
  cannot fool it. A short form rides in the filename; the full digest sits in
  the zip's comment. A press that changes nothing writes nothing and says so,
  with the time of the copy already there, after reading that copy back in
  full. **Two copies per state** per destination (`COPIES_PER_STATE = 2`), so a
  thousand presses on an untouched novel leave two archives. Before this, ten
  presses evicted ten real states, because pruning (default keep: 10) counted
  identical archives.
- What had to be fixed for that to work: `fs::read_dir` is unordered, so one
  sorted walk now feeds both the hash and the zip; zip entries carried `now` as
  their timestamp, so they now carry each file's own mtime; **two presses in the
  same second silently overwrote the first** (one-second names plus
  `fs::rename`), which was live data loss and is fixed; an in-flight
  `.versorium-save-*.tmp` could enter an archive and no longer can. **The time
  shown comes from the filename** — the moment the backup was asked for — not
  the file's mtime, which differed per destination.
- An archive whose name claims the current state but which cannot be opened is
  reported as damaged and a fresh one written; the bad file is left to age out.
- Installs that already had a backup folder keep it: the old `backupDir` key is
  moved into `backupDirs` on load.

### Credentials and GitHub

- **GitHub tokens are in the OS credential store** (Keychain, Credential
  Manager, Secret Service via the `keyring` crate), no longer plaintext in
  `settings.json`. Migration clears the file only after the store accepts the
  value; with no usable store the tokens stay where they were. The token never
  reaches the webview: the field is write-only and answers "Connected".
- **Push and pull work.** `git2` had been built without its `https` feature, so
  "Create private backup" made a repository nothing could ever be sent to. Pull
  fast-forwards or refuses with `git_diverged`; there is no merge.
- **The token is bound to github.com over https.** It used to be attached to
  whatever remote `.git/config` named. The remote is checked before the
  credential callbacks are built and again inside the callback (libgit2 follows
  redirects); the parser refuses `github.com@attacker`,
  `github.com.attacker.tld`, `notgithub.com`, `http://` and ssh remotes.
  Refusal has its own error code.

### MCP over HTTP

Streamable HTTP alongside stdio, as one stateless POST endpoint in front of the
same JSON-RPC dispatch. Off by default, toggled in Settings → Assistants.
Loopback only, ephemeral port, `Origin` and `Host` validated, and a per-launch
bearer token of 256 bits from the OS CSPRNG (`getrandom`), written with the URL
to a file at mode 600; if that randomness is unavailable the port does not
open. The write rules are unchanged: read-only until a client is granted
writing.

### Formats

- **EPUB import**, in spine order, skipping the nav document, reporting lost
  images and styling.
- **Scrivener 3 export** (`.scriv` bundle, one document per chapter, a synopsis
  per card, deterministic identifiers), offered in the export dialog. Scene
  headings flatten to separators, and that loss is reported. Writing it found
  two Scrivener-import bugs (titles cut at `&amp;`, then spaces lost around it),
  both fixed.
- **A title page and a colophon** in EPUB, DOCX and PDF, each switchable per
  project (`exportCover`, `exportColophon` in `versorium.json`, both default
  on). In EPUB, refusing the colophon removes every trace of the word
  Versorium from the file (a test asserts the OPF does not contain it). DOCX
  and PDF still name Versorium in their metadata whichever way the colophon is
  set: `<Application>Versorium</Application>` in `docProps/app.xml`, and
  `/Creator` and `/Producer` in the PDF information dictionary. The colophon is written in the manuscript's language, not the
  interface's (`tIn`). **The importers skip this apparatus**: EPUB on `epub:type`,
  DOCX on this app's own paragraph style ids, so re-importing an exported file
  does not hand back two extra chapters. A PDF of a novel with no chapters is
  still refused as empty, title page or not. The EPUB title page carries
  `role="doc-tithead"`, which epubcheck rejects (`RSC-005`); see `FORMATS.md`.
- **Author metadata**, with a work profile and a personal one; see "Author
  metadata" below.

### Binder, project and home screen

- **Rename, restatus and delete** novels and chapters. A deleted chapter is
  snapshotted into the project's git history first; a deleted novel goes to the
  system trash, and `delete_project` refuses any folder that is not a
  Versorium project. Renaming a novel changes `versorium.json` only, never the
  folder.
- **Reorder** through `chapterOrder`, Move up / Move down in the chapter menu;
  no file is renamed. See "Chapter order is data" below.
- **Project settings dialog**, reached from the binder menu, for the settings
  that live in `versorium.json` and travel with the folder. It draws the title
  page (`CoverPreview.svelte`) instead of describing it, and the colophon
  preview uses the novel's own numbers.
- **Covers in the sidebar**, from the same component, small enough that they
  show the page shape and the initial only; dimmed when the title page is off.
- **The home screen has two states.** Nothing on disk: the first-run copy and
  "Take the tour". Novels on disk, none open: "Where were we", with the last
  novel written in as the primary action. Both offer "Open a folder…".
  `list_projects` now sorts by the newest chapter mtime instead of by path
  descending. The tour is also reachable from Settings → Application.

### Settings and the interface

- **Author is its own settings group**, separate from Writing (typography).
  Settings now has seven groups: Writing, Author, Appearance, Local AI,
  History & backup, Assistants, Application.
- **Local AI is organised around tasks.** "What each task uses" lists the five
  jobs (Rewrite, Project chat, Continuity, Search, Dictation) and what each one
  runs on; "Where models come from" lists the sources. The tabs are now Built
  in, Ollama, Local server and Dictation.
- **Assistants names its direction**: outside tools that reach into the novel,
  "Assistants on this machine" for detection, and "What they are allowed to do"
  for MCP permissions — the arrow points the other way from Local AI.
- **Model downloads show progress.** Polling started only after the download
  had finished, and Cancel went through a guard that ignored it while a
  download ran; both fixed. The card draws a bar with bytes and a percentage.
  The mock now takes longer than a poll interval, so the E2E suite can see it.
- **Form controls look like this app's.** One stylesheet sets `color-scheme`
  per theme (it was never set, so dark themes got light native widgets) and
  `accent-color` to the theme accent (checkboxes were macOS blue), stops
  checkboxes being padded like text fields, gives selects the app's chevron
  and inputs their hover/disabled/invalid states.
- **Shared form primitives** in `src/lib/components/forms/`: `Field`,
  `TextField`, `NumberField`, `Select`, `Checkbox`. `Field` puts the hint in
  `aria-describedby` and the status readout outside the accessible name;
  `Checkbox` is strictly controlled; `NumberField` clamps on commit and commits
  once. Migrated so far: the author fields, the title-page and colophon
  toggles, the backup retention count, and the per-slot model picker in Local
  AI. The rest are listed in `TODO.md`.
- **The theme picker did nothing on a dark-mode machine**: the default `follow`
  mode forced Needle whatever was chosen. Fixed; the picker is now a swatch per
  theme, pinned by a test against `styles.css`.
- **The update dialog shows its phases** — downloading, verifying, installing,
  ready — then offers a restart.

### Models, icon and build

- **Four models under 1.3 GB**; see "Model catalogue" below.
- **The icon is a V and a nib**, drawn as a stroke with a pressure profile,
  with an ink pool at the point. The earlier needle-in-a-ring read as a compass,
  and a teal compass in a rounded tile reads as Safari. Per-size cuts: V, nib
  and ink from 256 px; V and nib from 64; the V alone below. Generated by
  `make icons` from `tests/icons/generate.py`; the in-app mark is one
  `VMark.svelte` built from the same geometry.
- **Vulkan on Windows and Linux** (`--features vulkan` in the release matrix);
  Metal on macOS as before. CUDA is not offered. The `.deb` declares
  `libvulkan1` and `libssl3`, because a missing Vulkan loader stops the app
  starting rather than falling back to CPU.
- x86-64 release builds target `x86-64-v2` (through `RUSTFLAGS`), after
  `GGML_CPU_ALL_VARIANTS` was found to make cmake fail on three of four legs.
- **CI** (`.github/workflows/ci.yml`): types and components, locale parity,
  clippy with `--all-targets -- -D warnings`, `cargo test`, end to end, and the
  Vulkan compile check on `main`. `pnpm-workspace.yaml`, which approves the one
  install script esbuild needs, is now committed.
- The updater and the crash reporter point at `MAECLY/versorium-app`, the org
  that now owns the repo.

## Still open

The full list, with file names, is `TODO.md`; the epubcheck result is in
`FORMATS.md`. In short:

- **Form controls still hand-written**: 26 control tags in 14 files, waiting
  to move to the shared primitives. One of them is a live bug: the local-server
  port in `LocalAiSection.svelte` is a bare `<input type="number" bind:value>`,
  so clearing it sends `null` to `studio_test` / `studio_save`, which take
  `port: u16`. `NumberField` fixes that and is not there yet.
  `RadioCardGroup` (the export-format picker) is named, not designed or
  written: commit `0ccb279` names it and no design for it is in the repository.
- **Project chat, search by meaning, and dictation.** The slots exist and can
  be assigned; nothing opens a conversation, there is no index or search box
  using the embedding model, and there is no Whisper pack in
  `models/catalog.json`. The Dictation tab says so.
- **Going public**, in order: signing secrets → make the repo public → enable
  Pages with GitHub Actions as the source → the Cloudflare CNAME → tag
  `v0.1.0` and check the draft release before publishing it.
- **The tokenless updater has not met a public repository yet.** The code
  no longer needs a token (see "Updater without a token" above), but the
  repository is still private and has no release. Today an anonymous check
  gets GitHub's 404 and the panel says that no published version is visible.
  Detect, verify and install without a token can only be tried after the
  repository is public and `v0.1.0` is published.
- **Apple notarization and Windows Authenticode.** They need purchased
  certificates and code: the release workflow and `tauri.conf.json` are not
  wired for either (see "Release readiness").
- **The EPUB title page fails epubcheck** (`RSC-005` on `role="doc-tithead"`),
  measured in `FORMATS.md`.
- **One unexplained test failure.** One `cargo test` run, on an earlier and
  smaller suite, reported 1 failure without naming it; the runs after it were
  reported clean, and no logs of them are kept. Not diagnosed, so not claimed
  fixed. A port clash is not the cause: the only test that opened a socket
  then (`live_a_real_request_over_a_real_socket_is_answered` in
  `src-tauri/src/mcp/http.rs`) is `#[ignore]`d, and it binds port 0 anyway.
  The updater's two redirect tests, added since, open loopback sockets on
  port 0 too.

---

The rest of this file is the record of how the milestones were built. Counts
and locations in it are as they were at the time; where something has since
moved or changed, it says so.

## Known holes at the end of v1, and what became of them

- **No built-in inference runtime** (M4). *Closed in PR #7*: llama.cpp runs
  in-process. See "The inference runtime" below.
- **No release has ever been cut** (M6). *Still true.* The repo constants and
  the remote now agree on `MAECLY/versorium-app`.
- **GitHub tokens were plaintext** in `settings.json`. *Closed in PR #9*: OS
  credential store.
- **No Scrivener export, no EPUB import** (M5). *Both closed in PR #9.*
- **No HTTP MCP transport** (M3). *Closed in PR #9* (Streamable HTTP, off by
  default). **No network git** (M1). *Closed in PR #9*: push, and fast-forward
  pull.
- **Whisper dictation packs absent** (M4). *Still true.*
- **No Apple notarization or Windows Authenticode** — minisign only. *Still
  true.*
- Scene titles do not survive DOCX or PDF; characters outside WinAnsi do not
  survive PDF. *Still true*, reported to the writer and documented in
  `FORMATS.md`. (Scrivener export also flattens scene headings.)
- Creative Mode is a disabled control with no engine behind it. That is a
  fixed project rule, not a v1 limit: the UI says "coming soon" and nothing
  more. *Unchanged, by design.* The tooltip (`ai.creativeSoon`) currently
  reads "Creative mode arrives in v1.1.", which promises a version the rule
  does not.

## Post-v1 pass (PR #7, merged)

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
  then (seven since Author split out in PR #9), each answering one question and
  saying so in a line under its heading. Two placements changed on purpose: the
  "Git" section held two credentials for unrelated jobs (authorizing update
  downloads vs backing up the novel) and they moved beside the thing each one
  serves; continuity and the content filter were loose in the middle of the
  modal and moved to the models they depend on.
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
  writing models (seven then, eleven now) do the same three jobs and differ in
  quality, speed and memory, so the choice is which one the machine can hold.
  nomic-embed says it does not write.

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

- **GPU backends: Metal on macOS, Vulkan on Windows and Linux, no CUDA.** When
  PR #7 merged it was Metal and CPU only. PR #9 added the Vulkan backend to the
  Windows and Linux release builds; one Vulkan backend reaches NVIDIA, AMD and
  Intel. The crate's `dynamic-backends` feature, once named as the follow-up,
  turned out not to add GPU backends at all. CUDA is deliberately not offered
  (full toolkit on every runner, hundreds of MB in the installer, for hardware
  Vulkan already reaches). The Vulkan build is compile-checked in CI and has
  not been run on a GPU.
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
- **Dictation is still unsolved and says so.** llama.cpp cannot load Whisper
  and the catalogue has no speech entry, so the slot keeps refusing.
- **CI cannot smoke-test inference** without hosting a small GGUF fixture. The
  path ships with unit coverage plus a `live_` test gated on
  `VERSORIUM_TEST_GGUF`.

## PR #9 in detail

The four parts of PR #9 that needed more than a bullet in "Merged in PR #9"
above.

### Backup, done properly (2026-09-28, PR #9)

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
so the artefact is one zip whose name carries the time and the content
fingerprint, and the panel says so where somebody is about to choose a folder.
Deduplication came the next day; see "Backup" under PR #9 above.

### Author metadata (2026-09-28, PR #9)

Settings → Author (it started under Writing and became its own group) holds
**two author profiles**, work and personal, and each field states in the UI
where it lands. The fields were chosen by what the formats can carry, not by
what a form usually asks for:

| Field | Where it goes |
|---|---|
| name | creator in EPUB, DOCX, PDF, Markdown |
| sortAs | EPUB `file-as`, guessed from the name when empty (the guess is the placeholder); `sortAs:` in Markdown |
| role | EPUB, as a MARC relator (an unlisted code is dropped); `role:` in Markdown; no binary format but EPUB carries it |
| organization | `dc:publisher` in EPUB, `Company` in DOCX, `publisher:` in Markdown |
| rights | `dc:rights` in EPUB, `/Subject` in PDF, `dc:description` in DOCX, `rights:` in Markdown |

The full per-format table is in `FORMATS.md`.

No email and no address: no export format has a slot for either, and storing a
contact detail only to look at it is not a feature.

Three gaps this closed, all of them silent until somebody opened the file
properties: DOCX had **no app.xml at all**, so Word showed the manuscript as
coming from no application; PDF had **no information dictionary**, so every
reader's properties panel was blank; EPUB had a creator with **no file-as**, so
a library shelved *El largo invierno* under A for Ana.

### Chapter order is data, not a numbering (2026-09-28, PR #9)

`versorium.json` gains `chapterOrder`. Reorder used to be impossible to do
safely because order came from the id, the id is in the filename, and renaming
files is what git history follows, what a backup archive contains, and what
`.versorium/ops/<id>` is keyed by. It is an override, not the whole truth:
anything missing from the list still sorts by id, after the ordered ones, so a
chapter restored from a backup appears rather than vanishing.

### Model catalogue (2026-09-28, PR #9)

Four models under 1.3 GB — Qwen3.5 0.8B (0.58 GB), Llama 3.2 1B (0.81 GB),
SmolLM2 1.7B (1.06 GB), Qwen3.5 2B Q3\_K\_M (1.22 GB) — with sizes and hashes
taken from the Hugging Face **LFS object ids**, which are the sha256 the
downloader checks. `tests/catalog/hf-files.py` is how, so the next person adding
a model does not work it out again. The catalogue now has twelve entries:
eleven writing models, listed smallest first (0.58 GB to 17.44 GB), then the
0.08 GB embedder last. On
2026-09-28 every URL in it returned 200. The panel gained search, family chips,
a "runs on this machine" filter, a sort and a count, with each card's
quant/context/RAM/licence folded behind Details.

## M7 DoD checklist (done)

- [x] **Onboarding with no signup** — spec §14's five steps, every one skippable, a Skip that always works, and nothing created until the project step is confirmed
- [x] **Corkboard** — a card per chapter with title, words, status and a preview, opening the chapter on click
- [x] **Continuity check stub** — runs through a selected Ollama model, and returns `ran: false` with a reason rather than an empty report when there is none (a `builtin` model also runs it since PR #7)
- [x] **Crash log local + Report** — scrubbed entries on disk, an issue URL prefilled from the scrubbed entry, and nothing sent unless the writer presses Report
- [x] **Focus mode + typewriter** — both through CodeMirror compartments, so toggling never rebuilds the editor
- [x] **Font catalogue stub** — the faces already on the machine, with Source Serif 4 listed as unavailable rather than offered with a dead URL

**Limit of the M7 real-app pass** (2026-09-28): the corkboard and focus mode
were driven through the browser end-to-end suite, which exercises the same
components via the same buttons, but coordinate-driven clicks in the desktop
window kept landing on the wrong control, so they were not clicked in the real
app.

## M6 DoD checklist (done)

- [x] Tauri updater plugin (2.13) wired, with `createUpdaterArtifacts` and the real minisign public key
- [x] Reads GitHub Releases of the app's own repo, over the **API asset endpoint** — the only form that serves bytes from a private repository
- [x] **minisign + sha256** — the plugin verifies the signature, and the client verifies the digest against the release's `SHA256SUMS` before installing
- [x] Settings → Updates (now a section of Settings → Application), using the Updates token slot that has always been separate from the novel token — optional since 2026-10-03, when checking without a token became the rule (§11 amendment)
- [x] Dialog with **Download & Install / Later / Skip this version**
- [x] CI workflow that builds and publishes a signed release on a `vX.Y.Z` tag, plus `RELEASING.md` (it publishes a draft; it has never run, because no tag exists)
- [x] Channels `stable` (default) and `beta`; automatic checking on by default on stable; offline never nags

## M5 DoD checklist (done)

- [x] Export **Markdown** (canonical, lossless round trip), **DOCX** in standard manuscript format, **EPUB 3** (passed epubcheck 5.2.1 with zero errors and zero warnings at M5; since PR #9 added the title page, the default export fails with 1 error, `RSC-005` — see `FORMATS.md`) and **PDF** (base-14 Times-Roman, nothing embedded, chapter per page, running heads)
- [x] Import **Markdown** (tolerant of setext, CRLF, BOM, no headings, prose before the first heading), **DOCX** (H1 = chapter, across Word / Google Docs / LibreOffice / pandoc spellings), **Scrivener** best-effort (v2 and v3 layouts, binder order, trash skipped; synopses are read but not saved — see `FORMATS.md`)
- [x] **Round trip documented** — `FORMATS.md`, per format and per direction, plus the commands to verify each output
- [x] Losses are said out loud: an export reports what it could not carry, an import shows its losses **before** writing a project

## M4 DoD checklist (done)

- [x] Settings → Local AI cards moving **Download → % + Cancel → Ready → Selected**, with the weight icon, one-liner, badge, size/quality/quant/context/RAM meta, licence and repo the spec's card bullet list asks for
- [x] `models/catalog.json` with the LOW → MID → MID+ → HIGH ladder plus an embeddings pack; **nothing downloads on its own**, HIGH least of all
- [x] Ollama tab: daemon state, the pulled models, pull by name, remove with confirmation, install hint when it is not there
- [x] Slots for Rewrite, Chat, Continuity, Embeddings — and Dictation — each picking its own model instead of one global choice (labelled Rewrite, Project chat, Continuity, Search, Dictation today)
- [x] Hardware wizard: memory, cores, platform, graphics, and the largest tier that fits with 20% headroom, stated in a sentence
- [x] Real downloads: streamed, resumable from a `.part`, one at a time, SHA256-verified, destroyed on mismatch
- [x] Studio tab (LM Studio / llama-server, labelled "Local server" today) with a connection test; Dictation is the UI hole the spec asks for until the Whisper packs land
- [x] i18n EN + ES (81 `localAi.*` keys at the time; 117 today)

## M3 DoD checklist (done)

- [x] `versorium mcp` serves stdio from the same binary — `--client <id>` comes from the config the user approved, not from the wire, so a client cannot claim another's permission
- [x] Read tools: `list_projects`, `read_document`, `search`, `assemble_context`, `history_list` — plus `get_app_state`, `open_project`, `list_documents`, `history_blame`, `diff`, `git_status`, `git_log`, `get_style`, `codex_search`, `codex_get` (15 total)
- [x] Write tools exist but REJECT unless the writer grants that client writing (Settings → MCP then, Settings → Assistants now): `write_document`, `insert_text`, `delete_text`, `replace_text`, `create_document`, `codex_upsert`, `git_commit`, `delete_document` (8)
- [x] Write path: preview (no `confirm: true` → diff only, nothing touched) → git checkpoint → apply → ops `author=ai:<client>` at UTF-16 offsets. Deleting a chapter needs `acknowledge_delete` on top of `confirm`
- [x] README documents the config snippet for Claude Code, Codex, Claude Desktop, OpenCode, Cursor and VS Code; Settings → Assistants writes it for four of them — Claude Code, Claude Desktop, Codex and OpenCode
- [x] Warning copy about AI deleting text, verbatim from spec §7, shown above the Allow-write controls rather than behind them
- [x] Tool log in Settings (now under Assistants): tool, client, scope, outcome, paths — never manuscript text
- [x] i18n EN + ES (29 `mcp.*` keys at the time; 35 today); actionable copy for every error code a tool can return

## How the crash log is kept from carrying a manuscript

Spec §12 says zero prose, and a panic payload is whatever someone passed to
`panic!`, so the scrubber removes rather than trusts: absolute paths collapse to
an extension, emails and credential-shaped tokens go, and any run of six plain
words goes with them — chapter filenames are slugified titles, so a path is
prose too. Proved gone in tests: Spanish prose, chapter paths, `ghp_` tokens,
sha256 hex, emails, Windows and `file://` paths, and all of their
percent-encoded forms inside the report URL.

That threshold has a price, taken deliberately: `index out of bounds: the len is
3 but the index is 5` opens with seven plain words and that run collapses. No
threshold both keeps that and drops seven words of somebody's novel, so the
manuscript wins — the numbers and the panic location survive, which is what
identifies the bug.

## How the updater is kept from being a backdoor

An automated review flagged the runtime-endpoint design, and it was right to
look. The answer is that the endpoint is not configurable at all:

- Owner, repo and host are **compile-time constants** (`MAECLY`,
  `versorium-app`, `api.github.com`). There is no environment variable, no
  setting and no command parameter that can change where an update comes from —
  anything that could would be arbitrary code execution carrying our own
  signature. An override "for testing" was planned and deliberately dropped for
  exactly this reason.
- Every URL the updater asks for is re-validated to be **https on
  `api.github.com`** before anything is sent: the asset URLs in the API's
  answer and, since 2026-10-03, the installer URL in `latest.json`. So a
  tampered response cannot redirect the download. Tests run hostile inputs
  through it, including `api.github.com.evil.example.com`.
- **A redirect is followed only out of `api.github.com`**, and only over
  https (`update::may_follow`), on the app's client and on the plugin's. The
  storage host GitHub redirects a download to has to answer by itself, which
  keeps the updates token, when there is one, on `api.github.com`.
- `endpoints: []` in the config is not an omission: the plugin refuses a check
  that did not set an endpoint at runtime, which closes the JS path around
  these pins rather than opening one. A static URL could not work anyway — the
  asset id changes with every release.
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

M5 added only two dependencies: `zip` and `quick-xml`. The PDF needs neither a
crate nor a font file — Times-Roman is one of the base-14, so nothing is
embedded.

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

## Bugs found and fixed during M7

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

## Next

M0–M7 are complete. The spec's own "Criterios de aceptación" (§17) lists eight
criteria. One is a real release, published as `v0.1.0` and detected,
verified, installed and relaunched on three platforms. The others include
rewinding any word of a 4k-word chapter in under 100 ms, OpenCode replacing a
paragraph through MCP, working fully offline with a MID GGUF, and a DOCX that
opens in Word in basic manuscript format. `PROMPT-VERSORIUM.md`'s
implementation notes record that no measurement or acceptance test of most of
these is in the repo.

For the release criterion, what stands in the way is the "Going public"
sequence in `TODO.md` (signing secrets, a public repo, Pages, DNS, the first
tag). The code change that used to be on this list is done: the updater
checks without a GitHub token since 2026-10-03 (see "Updater without a
token"). Whether an ordinary install, with no token, detects, verifies and
installs a release is the part that needs the public repository and the tag.
