# STATUS

## Where things stand (2026-10-06)

M0–M7 are complete, and so is the work after them up to two releases.

- **Released:** v0.1.0 (2026-10-04, 20:23 UTC) and v0.1.1 (2026-10-04,
  23:17 UTC), from `.github/workflows/release.yml`, signed with the app's key
  and checked against `SHA256SUMS`. v0.1.1's files are named for the computer
  they are for (`_apple_silicon`, `_apple_intel`, `_windows_x64`,
  `_linux_amd64`).
- **Tested:** macOS on Apple silicon; Windows 11 (both installers); Ubuntu
  22.04 (v0.1.0's `.deb`). Not yet: Intel Macs, the `.rpm`, the `.AppImage`,
  and v0.1.1 on Linux.
- **The update works end to end:** an install of v0.1.0 offered v0.1.1,
  downloaded it, installed it and restarted into it, on macOS and on
  Windows 11.
- **Public:** the repository (`github.com/MAECLY/versorium-app`) since
  2026-10-04, and the landing at `versorium.maecly.com`, published from
  `docs/` by `.github/workflows/pages.yml` (which leaves `docs/project/` out).

Work continues on `feat/landing-and-docs`, merged into `main` for each release
and each landing deploy.

`TODO.md` lists the work that is half-done in the code, the three AI tasks
that are specified and not started (Settings → Tasks lists them under "Not
built yet"), and the steps to going public. It is
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

## Right-click (2026-10-03, on `feat/landing-and-docs`)

Neither wry nor Tauri touches the webview's context menu, so until now every
right-click showed the engine's own: over plain UI that is a page menu whose
main item is Reload, in release builds too. A reload loses up to 800 ms of
typing (the save debounce), the queued ops batch, CodeMirror's undo history
and the session Restore works from; nothing listens for `beforeunload`. One
module now decides every right-click, in this order:

- **Binder rows and corkboard cards open their item menu,** the same
  menu as the row's ⋯ (`src/lib/components/Menu.svelte` since 2026-10-04), built by the same `chapterActions` /
  `projectActions` (`src/lib/binder/itemActions.svelte.ts`), at the pointer.
  Shift+F10 and the Menu key open it on a focused row, its ⋯ or a card. The
  row or card is outlined (`.v-menu-target`) while its menu is open; nothing
  opens while `store.loading` has the rows disabled. The dialogs those menus
  open (`ItemActionDialogs.svelte`) are mounted once in `App.svelte`, so the
  corkboard's menu does not depend on the sidebar.
- **Editable text, and text the writer has already selected, keep the
  engine's own menu untouched**: spelling guesses, Look Up, Writing Tools,
  Paste and AutoFill exist nowhere else. "Selected" is strict: the pointer on
  the selection's glyphs, not on a control drawn over it.
- **Everything else is cancelled,** and a cancelled or claimed right-click no
  longer moves focus, selects a word or presses what is under it. The press
  guard cancels that press's `pointerdown` (a disabled button gets no
  `mousedown`, and focus still went to `<body>` for it), its `mousedown` and
  its `selectstart`. Two one-shot guards cover the release, which a native
  menu's tracking loop used to swallow: the click WebKit sends after a
  cancelled Ctrl+click, and the `auxclick` on which WebKit toggles a checkbox,
  or clicks it through its `<label>`.

How it is wired, and why:

- `src/lib/contextmenu/policy.ts`, capture-phase listeners on `window`,
  installed from `App.svelte`'s `onMount`. Not from `main.ts`: the
  boot-failure screen keeps the engine's Reload, its only way out. Capture on
  `window` runs ahead of Svelte's delegated handlers, so no component can
  leak the page menu and later components are covered without knowing.
- **Windows only, the same module cancels F5, Ctrl+R and Ctrl+P.** WebView2
  keeps browser accelerator keys on in release and Tauri 2.12 exposes no
  switch. Not on macOS or Linux, where WKWebView and WebKitGTK bind no reload
  key and Ctrl+P is CodeMirror's line-up. Alt+Arrow (CodeMirror's
  cursorSyntaxLeft/Right off macOS) and Ctrl+F (search) are left alone.
- **Debug builds keep Inspect Element** behind Shift+right-click, and Shift
  also lets Shift+F5 reload the dev window; only the refresh keys, so
  Ctrl+Shift+R (Rewrite) stays cancelled there too. `import.meta.env.DEV` is
  a build-time constant, so none of it is in a release bundle.
- **Focus is handed back.** The menu is `role="menu"` with roving focus
  (arrows wrap, Home/End, Escape, Tab), `position: fixed` and clamped inside
  the window, one open at a time, and on every close returns focus to what had
  it, going through `EditorView.focus()` for the manuscript
  (`src/lib/components/restoreFocus.ts`). Focus moved out of an open menu by
  code or by VoiceOver closes it, since only the panel hears Escape. Focus
  dropped to `<body>` with no new target does not: pressing the ⋯ in WebKit
  does exactly that, and its click must still find the menu open to close it.
  `Modal.svelte` now returns focus when a dialog is closed by its own
  buttons, which unmount the `<dialog>` without `close()` and used to leave
  focus on `<body>`; this applies to all nine dialogs. Move earlier/later
  keeps focus on the moved row or card, and a delete moves it to the next
  item, the previous one, or "+ New chapter" / the home screen's primary
  button.
- **A right-click or a Mac Ctrl+click on a dialog's backdrop no longer closes
  it.** It used to, which skipped the tour for good, threw away an unapplied
  rewrite and dismissed an update.
- `RenameDialog` now cancels the Enter that submits it: with focus handed
  back, that keystroke's newline landed in the manuscript (or pressed the row)
  whenever the rename finished within the keystroke, as it does on the mock.

Tests: `tests/e2e/context-menu.spec.ts` (21 cases on the mocked IPC, pinning
the platform where a rule depends on it), `src/lib/contextmenu/policy.test.ts`
(the rules in isolation), and `tests/scratch/context-menu-webkit-probe.mjs`
for what only WebKit does (its word selection on a right-click, the click it
sends after a cancelled Ctrl+click, the checkbox it toggles on a cancelled
right-click's `auxclick`). The Chrome suite also pins two mechanisms whose
outcome it cannot see: that `auxclick` is cancelled (Chrome never toggles
the box), and that the caret is redrawn the moment focus comes back to the
manuscript (typing afterwards lands right either way, because CodeMirror's
own focus handler puts it back 10 ms later). The mock's `delete_chapter` now
tolerates a clean tree as the Rust command does; a second delete in a row
used to fail only there. What no automation reaches, the release builds of
the three webviews, is listed in `TODO.md`.

Known limits: the Windows key guard and WebKitGTK's handling of disabled
buttons are unverified on those platforms (see `TODO.md`); on WebView2 the
selected-text menu still lists Print, which only prints. Spelling guesses now
appear in the manuscript's menu where the webview checks spelling (see
"Settings → Editor" below); WebKitGTK still shows none without Rust.

## Settings → Editor (2026-10-03, on `feat/landing-and-docs`)

On 2026-10-03 the founder decided to turn spelling on in the manuscript and
give it a home: a Settings group called Editor ("Editor" in Spanish too). The
group that was Writing / Escritura is that group now
(`src/lib/settings/groups/EditorGroup.svelte`); Focus and Typewriter stay modes
in the status bar. Each option lives in `settings.json` under `editor`
(`EditorSettings` in `src-tauri/src/commands/settings.rs`): patched key by key,
and read back from disk through the same gate, so a hand-edited value of the
wrong type, a step this build does not know or a `null` block costs that value
rather than the whole file; and applied to a running editor through CodeMirror
compartments and custom properties (`src/lib/editor/preferences.ts`), never by
rebuilding it.

- **Typography**: the existing section, unchanged.
- **Spelling — "Check spelling as you type", on.** The manuscript's
  `spellcheck` follows it, and its content now carries the novel's `lang` from
  `versorium.json`; before, it inherited `<html lang>`, which follows the
  interface. `autocorrect` stays off, now stated: once spelling is checked,
  WebKit's automatic correction follows macOS's own text correction settings,
  on by default, which could replace invented names and dialect as they are
  typed and log the replacement as the writer's keystroke. `autocapitalize` is `sentences` (on-screen keyboards and
  dictation only); `writingsuggestions` stays off. The reasons are on
  `contentAttributes`.
- **On macOS the attribute alone drew nothing.** WKWebView underlines only
  when the app's defaults say `WebContinuousSpellCheckingEnabled`, and WebKit
  registers no default for it (`TextCheckerMac.mm` reads it with
  `boolForKey:`). `src-tauri/src/spelling.rs` registers it before the window is
  built. `tests/scratch/wkwebview-manuscript-spellcheck-probe.swift` loads the
  app on the mock in a WKWebView and types into the manuscript with real key
  events: without the default nothing is underlined; with it "nina",
  "ventanna", "quikc" and "jumpd" are, and the correct Spanish and English
  words around them are not. `wkwebview-spellcheck-probe.swift` shows the same
  on bare editing hosts, and that WKWebView picks the dictionary from the
  text, not from `lang`: Spanish in a `lang="en"` host was checked as Spanish,
  so on a Mac `lang` matters to VoiceOver and hyphenation rather than to
  spelling. WebKitGTK underlines nothing yet, and no release build has been
  looked at (`TODO.md`). The switch's hint names the system's checker as what
  underlines, and on Linux says instead that nothing is underlined there yet;
  the box stays usable, and its choice is kept.
- **Text size** Small / Medium / Large = 18 / 21 / 24px, **line spacing**
  Compact / Comfortable / Airy = 1.5 / 1.7 / 2, **text width** Narrow / Medium
  / Wide = 60 / 72 / 84ch. The middle steps are the old fixed values. They
  reach `.cm-content` as custom properties on `.cm-editor`, read by the one
  rule in `styles.css` that declares those properties, so there is no cascade
  to win. Typewriter's padding (0,3,0) is untouched, and a spec turns it on
  with the new steps set.
- **Line numbers**, off. The fold markers stay; the gutter's rule now shows
  only beside numbers, and a number sits level with its paragraph's first line
  at every size. They count the chapter as the editor shows it: the header
  Rust keeps at the top of the file is not counted, so they run behind the
  file lines git and the assistants' `search` report (seven behind, in a
  chapter Versorium wrote). The hint says what they count and promises no
  more.
- **Highlight the current paragraph**, on. `.cm-activeLine` was `transparent`
  in `styles.css`, so `highlightActiveLine()` drew nothing and a switch for it
  would have changed nothing. It is a translucent band of `--sel` now.
  "Paragraph", because a wrapped CodeMirror line is the whole paragraph.
- **Tab key**: "Moves to the next control" by default, "Indents the paragraph"
  on request. Established before deciding: Tab indents by writing the indent
  unit, two spaces, at the paragraph's start; one press reaches no export
  (all five exporters are built from `scenes_of`, which trims each line), two
  presses turn a paragraph after a blank line into a CommonMark indented code
  block (the editor stops parsing its italics, an indented `##` stops being a
  heading, and GitHub would show it as code), and with Tab bound the keyboard
  cannot leave the manuscript. `src/lib/editor/preferences.test.ts` and
  `formats::tests::a_paragraph_indented_with_tab_reaches_every_export_as_prose`
  prove it; the reasons sit next to the keymap. Mod-] and Mod-[ still indent.

Tests: Rust for the defaults, an old file, half a block, unknown values,
wrongly typed values and a `null` block, the patch, a round trip through the
file, the macOS default, and all five exporters on Tab-indented text; vitest
for the helpers, a live reconfigure that keeps caret, text and undo history,
and Tab; `tests/e2e/editor-settings.spec.ts` reads what renders (the attributes
on `.cm-content`, computed size, spacing and measure, the gutter, the band,
where Tab leaves focus) before and after a reload, in English and Spanish, and
the spelling hint as the box's description with the platform pinned to Linux
and to macOS. The mock keeps its settings across a reload with
`?mock=tauri&persist=1`, as settings.json outlives a relaunch. The three specs
that opened "Writing" open "Editor".

Gate on this change (`make verify`, 2026-10-03, after the review fixes):
svelte-check 0 errors and 0 warnings over 387 files; 714 locale keys in each
language; vitest 143 passed in 19 files; `cargo test` 492 unit and 4
integration passed, 16 ignored; clippy `--all-targets` clean; Playwright 128
passed.

Known limits: a visit to Settings still unmounts the editor, as it always
has, so it costs the undo history whatever the preferences do (`TODO.md`). The
font chosen under Typography still does not reach the editor (`TODO.md`, and
`DESIGN-VERSORIUM.md`, implementation notes). A novel's language is fixed at
creation and every import is created as English, so the manuscript's `lang` is
only as right as that (`TODO.md`).
(The first two were fixed on 2026-10-04: "Settings over the editor, and the
typeface on the page", below; the third the same day: "A novel's language can
be changed, imports keep theirs, and Scrivener synopses are kept", below.)

## Quitting waits for the last save (2026-10-04, on `feat/landing-and-docs`)

Cmd+Q, Quit from the Dock, logging out and shutting down used to skip the
save: AppKit's `terminate:` reaches tao's `applicationWillTerminate`, which
Tauri turns into an exit that cannot be cancelled, so up to 800 ms of typing
and the pending change-log batch were lost. `src-tauri/src/quit.rs` adds
`applicationShouldTerminate:` to tao's app delegate class, answers
`NSTerminateLater`, asks the frontend to save (`versorium://quit-requested`,
`src/lib/app/quit.ts`) and replies once it has. A save that fails cancels the
quit and says so; no answer within 5 s quits anyway, so a broken page cannot
keep the app open. macOS only; Windows and Linux quit through the window's
close, which already saved.

Measured on the real app, in an instance with its own `HOME` and data folder
on a copy of a novel: " QUITTEST" typed and Cmd+Q pressed straight after
(about 2 ms after the last keystroke). With the fix the chapter file and the
change log both held it. The same steps on the build without the fix showed
the word on screen in a capture taken between typing and Cmd+Q, and left the
file without it and no change log for the day. Unit tests cover the reply-once
gate (`quit::tests`) and the save-then-answer order (`quit.test.ts`).

## Collapsible binder, top bar and Focus options (2026-10-04, on `feat/landing-and-docs`)

The projects-and-chapters panel and the top bar fold away and come back, and
Focus is a toggle with a menu saying what it hides. Built from the design
chosen on 2026-10-04 (proposal #1, amended; summarised under "Collapsible
binder and top bar" in `TODO.md` until now).

- **Each surface has a Hide and leaves a labelled way back.** Hide sits at the
  end of the PROJECTS row, and at the end of the top bar as "Hide top bar"
  (a bare "Hide" in an app's chrome reads as ⌘H). The panel folds to a 28px
  rail reading "Projects and chapters" bottom to top (named "Show projects
  and chapters"), the bar to a 24px lip, "Show top bar". A folded surface is
  `inert` at once and `visibility: hidden` once its 160ms are over; it stays
  mounted. A click on Hide, the rail or the lip leaves focus where it was,
  so a writer's caret stays in the text; keyboard focus inside a folding
  surface moves to its rail or lip, and from there back to its Hide; and
  focus that was nowhere (WebKit leaves it on `<body>` after a click on any
  button) lands in the text. Chords: ⌃⌘S, ⌥⌘T and ⇧⌘F on macOS,
  Ctrl+Shift+S/T/F elsewhere, checked against every keymap the editor loads
  (`src/lib/chrome/keys.ts`); a chord says what it did through a polite live
  region.
- **The layout is remembered; Focus is not.** `layout` in settings.json
  (`binderOpen`, `topBarOpen`, `focusHidesBinder`, `focusHidesTopBar`, all
  true by default) is read leniently, like `editor`, so a hand-edited value
  costs only itself. `focusMode` is kept so files round-trip, and never read:
  every launch starts with Focus off, so an upgrade never opens into hidden
  bars.
- **Focus is a mask over that layout.** `[Focus|⋯]`: the ⋯ opens Focus
  options, two `menuitemcheckbox` items under "When Focus is on, hide"
  (Projects and chapters, Top bar). Focus folds the ticked surfaces and never
  writes the layout, so leaving it puts back exactly what was there. The rules
  are one pure module, `src/lib/chrome/chrome.ts` ("act on what you see":
  Show on a surface Focus hid opens a floating peek that moves no text and
  closes once used; anywhere else Hide and Show change the layout).
- **Nothing is a trap.** The status bar never folds and holds the pressed
  Focus pill. In Focus the rail and lip stay in place but faded, their room
  kept, however the mouse moves; the pointer on one, or keyboard focus,
  shows it. (Built first to wake on 8px of pointer travel anywhere; the owner
  rejected that on 2026-10-04 because moving the mouse brought the bars'
  traces back and undid the feeling of the bars being gone.) While you type the bar's buttons drop their borders and
  keep their fills, which hold their labels at AA. A peek closes once used
  (a chapter chosen or made with its +, a top-bar action), on Escape, on a
  press outside it, and when Tab takes focus out of it. Escape peels one
  layer: an open menu, then a peek, then Focus; a key the editor already used
  (search panel, a completion list, collapsing a selection) is not taken.
  Focus needs an open chapter, ends when the last one goes, and never shares
  the page with the corkboard or Settings. The first entry each session shows
  "Press Esc to leave Focus" for 4s in place of where you are. With both
  Focus options unticked, Focus only quiets the status bar, and its menu
  says so.
- **One menu.** `ItemMenu.svelte` became `src/lib/components/Menu.svelte`,
  which also renders checkbox items, opens upward from the status bar (and
  keeps growing upward when its note changes while open), does type-ahead
  and ↑/↓ on its button, and exports `closeOpenMenu()` for a panel that folds
  with a menu open in it. A highlighted destructive item gets a lighter fill,
  so its --warn label holds AA (4.61:1 at the least).
- **The editor keeps its layers to itself.** `.cm-editor` is
  `isolation: isolate`, so CodeMirror's search panel (z-index 300) no longer
  paints over, and takes the clicks of, the panel peeking above it.
- **Focus's editor half is gone.** `focusMode()`'s 12vh and 1.02em never
  rendered (the cascade typewriter's padding once lost); it was deleted rather
  than made to move every line under the caret. This replaces M7 decision 5
  ("Focus dims the chrome") below.
- **Escape straight after typing.** CodeMirror's completion closed its pending,
  invisible query on Escape for ~100ms after each keystroke, which would have
  swallowed the Escape that leaves Focus. Escape now closes a completion list
  only while one is showing (`src/lib/editor/cm.ts`).

Tests: five Rust tests on `layout` and `apply_patch` (which `set_settings` now
calls, so the patch the frontend sends is tested as Rust reads it); 32 unit
tests in `tests/unit/` (the model, the chords, the menu in jsdom); 29 E2E tests
in `tests/e2e/chrome.spec.ts`, plus updated `bars`, `m7-polish` and
`context-menu` specs. Each mechanism was removed in turn to see its test fail
(`tests/scratch/mutate.py`, `tests/scratch/mutate-e2e.py`, and
`tests/scratch/fix-mutate.py` for the verifier round). `chrome.spec.ts` and
`bars.spec.ts` also pass in Playwright's WebKit, the engine of the macOS app
(`tests/scratch/pw-webkit.config.ts`; not in the gate, which runs Chrome
only). The real webviews are not driven yet: see "Collapsible binder and top
bar: the checks no automation reaches" in `TODO.md`.

## Backup Phase 0: the bugs that lost or tore backups (2026-10-04, on `feat/landing-and-docs`)

Phase 0 of "Choose when the backup runs" (`TODO.md`): the confirmed bugs, fixed
before anything is allowed to back up on its own. Back up now is still the only
trigger. Built, then reworked after a review round that found 28 points; what
the rework changed is folded into each item below.

- **One novel pruned another's backups.** Listing matched a prefix, so
  `el-faro` claimed every archive of `el-faro-del-norte` (and
  `la-aguja-del-norte` those of its own `-restored` copy), sorted them as its
  newest and pruned with them; an unchanged novel also never matched its own
  newest and wrote a fresh archive on every press. A name is now read from the
  right (`src-tauri/src/backup/names.rs`) and belongs to a novel only when what
  is left is exactly its slug, in the shape the app writes: four digits of
  year and every field in range. Every name an earlier version wrote still
  parses: without the fingerprint (80c563c to ad0f73a), with it, and with a
  bumped stamp. A hand-made name with a seventeen-digit year used to overflow
  the date arithmetic and stop the listing (a panic in a debug build); a
  five-digit year read as a stamp that held pruning for good. Both are now
  nobody's.
- **A clock set back deleted the archive it had just verified.** Pruning kept
  "the newest N" by name, and today's archive sorted after tomorrow's. Pruning
  never deletes the archive the run just wrote, and deletes nothing while this
  computer's clock reads more than 10 minutes earlier than an archive already
  in the folder. While the clock stays behind, an unchanged novel is compared
  with the newest archive this clock could have written, not with the
  future-dated one that sorts first: comparing with that one wrote a full copy
  on every press and pruned nothing (a reviewer's probe: three archives stamped
  tomorrow, six presses, nine archives). Each state is now written twice, then
  nothing. The
  line no longer assumes this computer is the one that is wrong: "A backup
  here is dated …, later than this computer's clock, so no backups were
  deleted. Check the date and time on this computer and on any other that
  backs up here, or remove that file yourself."
- **A commit during a backup tore the archived history.** The 60-second
  checkpoint, Save snapshot or an MCP write could commit between the walk and
  the packing; the archive passed `verify()` and its HEAD named a commit it did
  not hold. The files in `.git` that name commits (HEAD, refs, packed-refs, the
  index, the logs) are now read into memory first, and the object store is
  listed after them; libgit2 writes objects before refs and never deletes one,
  so every object a frozen ref names is in the list, however long packing
  takes. Both halves are read under a repository lock
  (`src-tauri/src/git/lock.rs`): a file lock in `<app data>/locks/`, one per
  novel, taken by the capture and by every commit and pull of this app's, in
  the app or in `versorium mcp`. While it is held the 60-second checkpoint
  skips that minute, Save snapshot (now off the main thread) waits up to 10 s,
  the checkpoint before an AI rewrite or a chapter delete waits up to 2 s on
  the main thread, and the MCP server waits up to 10 s. A commit still waiting
  after that says "A backup is reading the novel's history. Try again in a
  moment."; a backup that cannot read the history within 30 s reports every
  destination as skipped because the history was being written, not as failed.
  The order keeps the history whole against a writer that never takes the
  lock (`git` run by hand); the lock adds that the index, the refs and the
  logs in an archive describe one moment. What is held in memory is small:
  8 KB outside `objects/` on the 400 MB model, about 36 KB on disk for the real
  novel. `*.lock` files in `.git` are no longer archived (a restored copy
  holding one refused to commit); a novel's own file ending in `.lock` still
  is.
- **Two runs shared one temporary file.** The `.part` name carried only the
  process id, so a second run truncated the first one's half-written archive;
  observed leaving no archive at all. The name now carries a random id of this
  computer (`<app data>/backup-host-id`, ten hex digits, never sent anywhere),
  the process and the run. Leftovers are swept at the start of each run, for
  that novel only: this computer's when its process is gone or its run is not
  active, another computer's only after 7 days, the two older names after 24
  hours.
- **Back up now could start a second run.** Its busy flag lived in the panel,
  and leaving Settings reset it. Runs now queue in Rust
  (`src-tauri/src/backup/flight.rs`); the panel asks `backup_state` when it
  opens and follows `versorium://backup-state`, so after leaving and coming
  back the button is still disabled, with "Backing up…" beside it in a status
  line (on the button itself the text was faded to 2.2–3.0:1). The line names
  another novel's run ("Backing up “Novela 1”…"). When a run the panel did not
  start ends, it says "The backup has finished; the list below is up to date."
  and reads the list again; it never sees that run's outcomes. A press reads
  the destinations, the number to keep and the clock when its turn comes, so
  one that waited writes where the writer backs up by then, stamped after the
  run it waited for.
- **Every failed destination read "Something went wrong."** The backup codes
  had no translation. Eight codes now have EN and ES text, and a write error is
  named by its kind: the disk is full, the folder refuses new files, the folder
  is gone (reported as unavailable, like an unplugged disk), or the archive
  could not be written. Reading the novel's own files still fails as `io`. The
  line reads "Another disk: not saved. The disk is full." rather than gluing a
  sentence after a dash, and an unplugged disk no longer promises "It will be
  written next time", which nothing did: "Press Back up now again once it is
  connected."
- **The press backed up what was last saved, not what was on the page.** It
  saves first now. A save that fails stops the press and says so under the
  button: "Not backed up: the chapter could not be saved first. …".
- `backup_destinations`, `backup_list`, `backup_coverage` and
  `backup_configure` no longer run on the main thread (finding destinations
  writes a probe into every candidate folder and disk), and coverage detects
  once per call instead of once per destination.

Where this departs from the spec. None of these is confirmed by the owner yet:

1. **A second press queues behind the first and makes its own run**, after its
   own save. That is Phase 0's "process-wide Mutex around `backup_now`"; the
   spec's "a second press joins a running manual run" belongs to Phase 1's
   scheduler, and joining would back up a plan taken before the second press
   saved. Phase 1 has to pick one (`TODO.md`).
2. **A pull holds the repository lock for its local half only** (moving the
   branch and checking it out), not for the fetch: that is network work that
   can outlast the 30 s a backup waits, and it writes its objects before its
   refs, which the capture's order already copes with.
3. A lock file that cannot be made or opened does not stop a commit or a
   backup: the lock is then not held, and the order still protects the
   archive. The explicit unlock on release is for Windows, which only promises
   to free a closed handle's lock eventually; on macOS closing the handle
   frees it, so no test here can tell the two apart.
4. Process liveness uses `sysinfo`, already a dependency, not `libc::kill`.
5. The outcome carries `held: { kind: "clockBehind", stamp }`, because the line
   needs the stamp and there is no ledger yet. The `busy` outcome of spec §4.13
   is added now, because the lock can time out in Phase 0.
6. `backup_busy` and `backup_source_gone` have no text yet: nothing returns
   them before Phase 1, and the translation test covers every code that is
   added to the list.
7. Pruning stays inside each write, as before (the spec moves it to Phase 1's
   runner).
8. The sweep also knows the first versions' `<archive>.zip.part` name.

Honest limits found in review, for the docs and for Phase 1 (`TODO.md`):

- **The computer's id lives in the app's folder.** A Mac set up from another
  with Migration Assistant, or from a restored home folder, carries the same
  id. If both then write the same novel into one synced folder at the same
  time, one can sweep the other's live temporary file, and that run fails as
  "not reachable". Nothing already saved is lost.
- **A sync client's conflict copies are invisible.** Exact names drop
  `… 2.zip` and "(conflicted copy)" files, so they are never listed for
  Restore, and never pruned.
- An archive stamped years ahead with a four-digit year (a clock once set
  wrong) holds pruning at that destination until its date; the line names the
  date (spec §9, limit 11).

Tests. The first build added 37 Rust tests, 5 vitest cases and 4 E2E specs
(two novels sharing a folder; the clock set back; commits around the capture;
a stale `index.lock`; the fingerprint across the upgrade; two runs in one
folder; the sweep; write errors by kind; every code translated; two presses at
once; the button across a remount; save before backing up). The rework added
38 Rust tests and 5 E2E specs:

- `git/lock.rs` (8, one of them the second process of a test): a second
  holder is turned away until the first lets go; a wait ends when its time is
  up; a waiter gets the lock once it is free; one lock per novel however its
  folder is spelled; the lock lives in the app folder both processes share; a
  lock file that cannot be made or opened does not stop the writer; another
  process holding the lock turns a checkpoint away and makes a commit wait,
  then succeed (spec row 14: the test binary started again as the holder).
  `git/repo.rs`: a pull moves the branch only while nobody reads the history
  (a real fetch from a local copy). `commands/git.rs`: Save snapshot waits out
  a 2.5 s capture; a commit on the main thread waits two seconds, then says the
  history is busy. `mcp/write.rs`: an agent's write and commit wait out a
  capture instead of failing.
- `backup/mod.rs` (17): the checkpoint skips and a save goes through while the
  history is read (spec row 13); a commit from the app waits until the history
  has been read, and the archive's index matches its HEAD; a backup waits out a
  commit holding the history for 2.5 s; a clock set back writes each state
  twice and then nothing, with `held` on every press, the unchanged ones
  included; a clock set back on an unchanged novel keeps a second copy, not a
  new state; a destination that cannot be created, one removed mid-write, an
  archive gone before its read-back and a disk that fills as the archive is
  closed each say what happened; every name taken, and a failed rename, leave
  no temporary file; a novel's own `notes.lock` is backed up; a finished run is
  no longer live; a history file that vanishes before it is read is left out;
  the sweep's week and day, pinned an hour either side. Three new permanent
  controls reproduce the rest of spec rows 2, 3 and 10: with the process id
  alone two runs damaged each other, the prefix rule deleted the other novel's
  archives, and judging by pid alone deleted another computer's live file.
- `backup/names.rs` and `backup/host.rs`: a folder holding an impossible year
  still lists; the app uses the id it stored, across launches.
- `commands/backup.rs` (7): Rust sends the event the page listens for (read
  out of `src/lib/backup/events.ts`, which the E2E mock now imports too); the
  state reaches the page in the shape it reads; `backup_now` itself, on Tauri's
  mock runtime (its `test` feature, in dev-dependencies only, no new crate),
  tells the page when it starts and when it ends; a press that waited is
  stamped after the run it waited for, and writes where the writer backs up by
  then, or says backups are off; a busy history is reported busy, with nothing
  written; a disk pulled mid-backup is unavailable.
- E2E: the busy line; the status line from the moment of the press; a press
  overtaken by another run waits for it; a run that ends while the panel starts
  listening is not missed; another novel's run is named; after a run the panel
  did not start, the finished line, the list read again, and one listener after
  reopening; the new failed, held and unavailable wording. The mock can hold a
  press, queues like Rust and counts listeners. Vitest: the failed save's line,
  under the button.

Each mechanism was removed once and its test watched fail
(`tests/scratch/backup-p0-fix/mutate.py`; the Rust side on a copy of
`src-tauri` with its own target, so nothing else building this checkout saw a
mutated file): Rust 77 of 77, the first build's 17 and the 25 the reviewers
used included; frontend 17 of 17. One miss on the way: the test of the main
thread's two seconds compared the wait with the constant itself, so a
ten-second constant passed; it now reads two seconds. Not covered by a
behavioural test: moving the four commands off the main thread (review only),
the explicit unlock on release (Windows only), and a lock call that fails
outright, which no filesystem here produces.

Measured with `make verify` (exit 0, 58 s): svelte-check 395 → 396 files, 0
errors, 0 warnings; locale keys 745 → 750; vitest 180; `cargo test` 536 → 574
unit plus 4 integration, 16 ignored; clippy `--all-targets` 0 findings;
Playwright 161 → 166. The new lines were looked at in Chrome on the mock, in
EN and ES and in Folio light, Quarry dark and Needle dark
(`tests/scratch/backup-p0-fix/look.mjs`); they use the tokens and sizes of the
lines measured in the first build (status 4.74–6.28:1, warnings
4.99–9.12:1). The desktop app was not driven: the lock, its waits and the
second process run in Rust tests, every new line shows on the mock, and the
spec's manual checks belong to the phases with a schedule.

## Notifications: hints that go, errors that stay, one stack (2026-10-04, on `feat/landing-and-docs`)

"Select a passage first." reached the writer through the error channel and sat
in a warning box until somebody pressed ✕; so did "Nothing to roll back here.",
"Nothing has changed since the last snapshot." and every failure written to
`store.error` (13 places), while Settings kept its own "Saved." and "Backups are
off." lines that never left. Nothing hid itself except the Focus hint. They now
go through one module, `src/lib/notices/`, built from the TODO item
"Notifications have no module and never hide".

- **Two tiers.** A *transient* notice (a confirmation, a hint) goes after 5 s;
  it waits while the pointer or keyboard focus is on it and then runs on with
  the time it had left; ✕ or Escape closes it; a polite live region reads it
  when it appears, again when its words change or the writer asks again
  (`inform`), and not when the same words are shown again under its id (a
  refresh, SPEC §6.3). A *persistent* notice (an error the writer has to read)
  never goes on a timer, which would fail WCAG 2.2.1; it stays until ✕ or
  Escape, or until the code that raised it sees the condition clear. An
  assertive live region (`role="alert"`) reads it once, and not again when its
  words change in place. Both regions are always in the page; the notices
  themselves carry no live role. Each region keeps its words while a notice of
  its tier still says one of them, and is emptied once none does: a notice
  closed, an error whose words changed in place, two read together that have
  both gone.
- **One notice per condition.** Every notice has an id; the same id replaces in
  place and keeps its position. `inform(text)` and `fail(text)` take the id from
  the words, so the same words twice are one notice. Persistent notices with the
  same words under different ids are drawn once: a full disk fails the save,
  the change log and the minute's snapshot together, and one "File system
  error." says more than three; the box goes when the last of them clears, and
  its ✕ closes all of them. One that carries an action keeps its own box: a box
  has room for one. Past three transient notices the oldest goes, never one
  being read.
- **Where it sits.** Mounted once in `App.svelte` between the page and what is
  under it, so the stack hangs 8 px above History when that is open and above
  the status bar otherwise, at the end edge (centred, it sat on the text
  column). z-index 25: over the page, under menus, peeks and dialogs, so Focus
  options, which opens from the status bar, covers a notice. Nothing in it takes
  focus by itself. Tab reaches it straight after the page; a press on ✕ leaves
  the caret in the text; a notice closed from the keyboard hands focus to the
  next notice's ✕, or back to where focus came from. Escape on a notice closes
  it and goes no further, so it never ends Focus or closes a peek. In Focus the
  stack is where it always is, and it never wakes the faded edges.
- **Never over the line being written.** Where the stack covers the text
  column, CodeMirror gets a bottom scroll margin of that height
  (`src/lib/notices/editor.ts`), so typing keeps the caret's line above it; a
  notice that lands on that line scrolls it up once, and never when the caret
  is off screen (the writer scrolled away; the page stays where they put it).
  When a tall stack would still cover the last line, the page's foot grows
  past its 120 px (`--v-notes-room`), and does not shrink again for that
  chapter, so a notice going never drops the page under a writer at its end.
- **The look.** `--bg-elev`, `--border`, `--radius-card`, `--shadow-menu`; words
  in `--text` (11.19–17.39:1 over the six themes), ✕ in `--text-mute`
  (4.75–5.63:1), 24 px square. A persistent notice has a `--warn` bar inside its
  start edge, and its words say it failed, so colour is never the only sign. A
  150 ms fade in, none under reduced motion or before the layout is drawn. Two
  new keys: `notices.region` ("Notifications" / "Notificaciones") and
  `notices.dismiss` ("Close" / "Cerrar", the name every other ✕ in the app
  has; "Descartar" is the word for throwing a rewrite away), the ✕'s name,
  described by the notice's words.
- **What goes through it** (id in brackets):
  - `App.svelte`: Save snapshot failing (`git.commit`, cleared by a snapshot
    that goes through), and with nothing new now a hint that goes; Rewrite
    with nothing selected and Restore with nothing to restore, as hints; the
    minute's snapshot (`git.checkpoint`, cleared by the next minute that
    works); a quit or a window close that the last save stopped (`app.quit`),
    both in the quit's words ("Versorium did not quit: the chapter could not
    be saved. …"; closing the one window is quitting); the change log
    (`editor.ops`, cleared by the next batch written). `app.quit` is the one
    error no later success clears: it is the record of a quit that did not
    happen, and says why the app is still open, so it stays until the writer
    closes it, or quits.
  - The binder store: each action on a novel or chapter under an id of its own
    (`binder.renameProject`, `binder.deleteProject`, `binder.renameChapter`,
    `binder.chapterStatus`, `binder.moveChapter`, `binder.deleteChapter`),
    cleared when the same action next works and left up by another, since
    what failed still has not happened; the list of novels (`binder.list`),
    the save (`binder.save`) and opening a novel or chapter
    (`binder.navigate`), each cleared by the next that works. New project, New
    chapter, the tour's project step and Project settings get their failure
    back and say it in their own dialog (Project settings under the box that
    did not change), where a notice would sit behind the backdrop.
  - Settings: "Author profile saved." and its failure (`settings.author`, so a
    save that works replaces one that did not); the censorship setting
    (`settings.censorship`); "{destination}: backups will go there too." and
    "Backups are off." (`backup.configure`); the GitHub backup's "GitHub
    backup connected as @login.", "Sent main to GitHub.", "Brought the latest
    changes from GitHub." and "Already up to date with GitHub."
    (`backup.github`, one answer at a time); the three destinations hint; the
    updates token's "Updates token connected as @login."
    (`settings.updatesToken`). Each names its subject: in the corner, "Saved."
    sat over the status bar's "Saved" about the chapter, "here" pointed at
    nothing, and both tokens said the same "Connected as".
- **`store.error` is gone**, not kept as an adapter: besides the box it had four
  readers (the two dialogs, the tour, tests), all moved to return values.
- **The contract for scheduled backups** (backup schedule SPEC §6.3):
  `notices.show({ id, tier, text, action?, onDismiss? })`, `dismiss(id)` when
  the condition clears (no `onDismiss`, so nothing records a dismissal the
  writer did not make), `close(id)` for the writer's ✕ (calls `onDismiss`),
  `inform`, `fail`, and `hold`/`release`. A transient notice cannot carry an
  action, by type: it could hide on its way to being pressed. `show` under the
  same id in the same words is a refresh and is not read out.

Fixed on the way:

- The New project and New chapter dialogs opened showing any older, unrelated
  error (an autosave's, a rename's) as their own, and the same error was drawn
  again behind the backdrop.
- The tour's project step said "Something went wrong." for a name already
  taken: the binder handed it a sentence, and it read the sentence's last word
  as an error code.
- The updates token's errors were drawn in the accent, in a polite region, so a
  refusal read as a success; they are an alert in `--warn` now.
- Author's "Saved." never went away, and was there from the first field left to
  the last.
- A rename that failed wrote its alert while the Rename dialog was still
  modal, into a region the dialog had made inert
  (`tests/scratch/notices-fix/rename-probe.mjs`). Rename now closes before it
  runs, as Delete does.
- Project settings' two boxes posted their failure behind the dialog's
  backdrop.

Left where they are, because each belongs to a place:

| Where | Why it stays |
|---|---|
| Backup: each destination's outcome, the line beside Back up now, the press's own failure ("Not backed up: …"), coverage, a verified archive, the section's error | Tied to a destination, an archive or the button; the outcomes are the record the writer reads where they are |
| Backup: "Restored to {path}" | It names the folder to go and find; a notice that went by would lose the only place the path is shown |
| New project, New chapter, the tour, Project settings, Rewrite, Manuscript (export done, with its path), Update dialogs | Inside a modal dialog; a notice would sit behind its backdrop (Rename and Delete have no line of their own: they close before they run, and a failure is a notice) |
| `Field` and `Checkbox` errors | Field validation, tied to the field by `aria-describedby` |
| Updates' check outcome | Every outcome of a check is a line in its section, never an alert (spec §11.7) |
| Assistants: "Restart … to see the change", MCP errors | Under the client's card, or about the section |
| Local AI, continuity, typography, crash reports, editor settings errors; the corkboard's "Loading…" | Section state, progress or a count, read where it appears |
| History panel's errors | Inside the panel the action was taken in |
| The updates token's error (now an alert) | Beside the field it is about |
| The Focus hint in the status bar and the chords' announcements | They belong to the Focus control, and the hint already hid itself |

Where this departs from the plan or the spec, none confirmed by the owner yet:

1. A transient notice takes no action, which is narrower than SPEC §6.3's type:
   `shrunk` and `skipped` (SPEC §6.1) will go without "Open backup settings".
2. The stack sits before History and the status bar in the page, not after the
   status bar: Tab reaches it straight after the page, and it hangs above
   History when that is open instead of covering it.
3. Persistent notices with the same words are drawn once unless one carries
   an action (above), and each screen-reader region is emptied once no
   notice says its words.
4. "Nothing has changed since the last snapshot." is a hint now, not an error.
5. The change log's notice clears itself on the next batch written.
6. The page's foot grows under a tall stack (above).
7. The mock gains `failures` (a command rejects with a code until a spec
   deletes it) and a `quit_ready` handler, which it never had.
8. A transient notice shown again under its id is read again when its words
   changed; SPEC §6.3's comment says no re-announcement for the same id. It
   goes in five seconds, and the announcement is the only time a screen
   reader hears it. The same words again are not read (the writer asking
   again through `inform` is).

Tests. Vitest: the store on a fake clock (`tests/unit/notices.test.ts`, 18:
hides at 5000 ms and not at 4999, held by the pointer and by focus counted
apart, the time left after a hold, a persistent notice an hour later, a repeat
is one notice heard again, a replacement keeps its place and is not read
again, a persistent one turned transient, `close` against `dismiss`, the cap,
the same words under two ids, the screen-reader copy, words raised together);
the geometry (`notices-cover.test.ts`, 7); the stack in jsdom
(`notices.render.test.ts`, 8: both regions before the first notice, the pointer
and focus holds through the DOM, Escape used up, ✕ and an action, ✕ on shared
words, where focus lands); the binder (5 new) and the tour (1 new, 1
rewritten without the mock that hid its bug). Playwright:
`tests/e2e/notices.spec.ts`, 27, one per routed caller and per mechanism
(hint timing and hover, Tab, Escape and Focus, the dedupe, the snapshot, the
minute's snapshot, the save, the change log, one box for one failure,
Settings' confirmations against the backup's outcomes, the updates token, the
censorship setting, a binder action, the New chapter dialog, the tour, GitHub
backup, quit, window close, the press's own failure, the caret's line with
three notices in a 900×600 window, a page scrolled away from the caret, Focus
and the caret on ✕, Focus options over the stack, reduced motion, Spanish, and
contrast in all six themes); five specs edited for the stack's region and the
chords' region (`author`, `backup`, `chrome`, `context-menu`, `m2-rewrite`).

Each mechanism was removed once and its test watched fail
(`tests/scratch/notices/mutate.py`, every file restored byte for byte after
each run): 56 removals, 71 checks (31 vitest, 40 Playwright), 71 failed. Five
checks missed on the way, over four removals, each fixed before that count.
Removing the persistent tier's guard left a later `disarm` that undid it, so
the removal changed nothing; it now arms persistent notices. With the lookup
by id gone, Svelte refuses the duplicate key and the page still showed one
notice, so the page-level control now gives the same words two ids. The
window-close test read the status bar's "Saved", which an unsaved edit also
shows, so it passed with the close's failure unreported; it now waits for the
save on disk. The Focus options test first probed the empty part of the list,
which lets clicks through, and passed with the stack painted over the menu; it
now probes a notice.

Measured with `make verify` (exit 0, 64 s): svelte-check 396 → 400 files, 0
errors, 0 warnings; locale keys 750 → 752; vitest 180 → 219; `cargo test` 574
unit plus 4 integration, 16 ignored (no Rust changed); clippy `--all-targets`
0 findings; Playwright 166 → 193.

Looked at in Chrome on the mock (`tests/scratch/notices/look.mjs`, `look2.mjs`)
at 1280×800, 900×600 and 640×600, in EN and ES, in all six themes between the
two passes: the stack, Focus, Settings, History open with a two-line error, a
narrow window with keyboard focus on ✕, the caret's line lifted clear of three
notices, and hover. One change came from looking: the persistent mark was a
3 px border that the card's 12 px corners bent into a bracket; it is a bar
inside the card now. The page logs nothing while notices come and go
(`console-probe.mjs`; the one 404 is the favicon).

Not done, or not reachable from here:

- The real webviews were not driven: VoiceOver on WKWebView reading each notice
  once, Option+Tab reaching ✕ with keyboard navigation off, Escape on a notice
  in Focus (`TODO.md`). Playwright's WebKit passes `notices.spec.ts` (27 of 27,
  Option+Tab there; `tests/scratch/notices/pw-webkit.config.ts`).
- A notice raised while a modal dialog is open sits behind its backdrop and is
  not announced: `showModal()` makes the rest of the page inert, live regions
  included. A dialog's own action no longer does (second pass, below); a
  background failure behind a dialog still does.
- A notice keeps the language it was raised in until it goes.
- A failure in the background says only why, not what failed: the save, the
  change log and the minute's snapshot all say "File system error.". Which
  words to add is the owner's call (`TODO.md`).

### Second pass: what the verifiers found (2026-10-04)

Twenty-five findings; each was checked against the code before anything
changed. Fixed, each with a test that fails without the fix:

- **Stale screen-reader copy.** The regions were cleared only when their text
  equalled the words of the notice that went, so an error whose words changed
  in place left its old words in the alert region for good, and two hints read
  together ("A B") stayed in the polite one after both hid. Each region now
  keeps the lines it holds and is emptied when no notice of its tier says any
  of them (`prune`, run on every change to the list).
- **Re-reading on a refresh.** `show` read a transient notice out again on
  every call under its id; Phase 1's adapter calls it for every notice it sees
  change. The same words under the same id are now a refresh; new words are
  read, and `inform`, the writer asking again, is always heard.
- **A box with an action is never shared** with another notice in the same
  words (it would lose the second action, and one ✕ would close both).
- **Binder actions** got an id each, cleared when the same action next works
  (above). Before, a rename that failed and then worked left "File system
  error." up until closed.
- **The window close** said only "File system error." under `app.quit`; it
  says the quit's sentence now, and stays after the save recovers because it
  is still true. The first report said every persistent notice clears with
  the next success of its kind; `app.quit` does not, by design (above).
- **Rename** wrote its failure into an inert region (Fixed on the way, above);
  **Project settings** posted its failure behind its backdrop and now says it
  under the box.
- **The tour** checks `store.loading` before making the project or seeding
  chapters: `navigate` answers null both when it worked and when it did
  nothing because another navigation was running.
- **Copy:** the routed confirmations name their subject (above), and the ✕ is
  "Close" / "Cerrar".
- **Tests for mechanisms nothing caught:** a transient's clock surviving into
  the error that took its id (it would have hidden the error after five
  seconds), a closed notice's hold surviving into the next under its id (the
  hint would never hide again), a hold taken for a notice not yet raised,
  words announced after their notice went, any key closing a notice, a hint
  folded into an error's box, Restore's hint as an error, New project's own
  error line, an empty notice when one of two destinations is unticked, and
  the page's foot shrinking when the notices go.

Not changed: the "three destinations" hint (`backup.full`) stays routed but
untested, because no path in the UI reaches it (the buttons that would are
disabled when three are chosen). Recorded in `TODO.md`, not built: the Restore
hint's "roll back" against the button's "Restore", the stack covering the
foot of the Settings form, the module's departures from SPEC §6.3, and two
older bugs found on the way (typewriter's caret line below the window, which
HEAD shows too, and the censorship box staying ticked after a failed save).

Tests now: `notices.test.ts` 25 (was 18), `notices.render.test.ts` 9 (was 8),
the binder 7 new (was 5), the tour 2 new (was 1), `notices.spec.ts` 33 (was
27). Each removal was made in a copy of the tree served by a Vite of its own
on :1438, never in the live `src/` under the shared :1420, and every check ran
only once that Vite served the edit; each verdict names the test that failed
(`tests/scratch/notices-fix/mutate.py`, logs in
`tests/scratch/out/notices-fix/`). First, all 36 checks passed unmutated; then
35 removals, 48 checks (30 vitest, 18 Playwright), 48 failed, each in the test
meant for it. Six of the 35 re-prove first-pass mechanisms in the code this
pass rewrote. Playwright's WebKit passes `notices.spec.ts`, 33 of 33
(`tests/scratch/notices-fix/pw-webkit.config.ts`).

Measured with `make verify` (exit 0, 73 s): svelte-check 400 files, 0 errors,
0 warnings; locale keys 752 → 753; vitest 219 → 230; `cargo test` 574 unit
plus 4 integration, 16 ignored (no Rust changed); clippy `--all-targets` 0
findings; Playwright 193 → 199.

## Settings over the editor, and the typeface on the page (2026-10-04, on `feat/landing-and-docs`)

Two items from `TODO.md`, built together because both run through the
editor's compartments: "A visit to Settings rebuilds the editor" and "The
typeface chosen in Settings never reaches the editor".

**Settings covers the page instead of replacing it.**

- `App.svelte` no longer swaps the panel and the page for `SettingsPage`
  (`{#if showSettings}…{:else}`). Both now sit in `.v-under`, and Settings
  opens in a layer over them (`.v-settings-layer`: absolute over `.v-middle`,
  `--bg-app`, no z-index, so the notices, menus, peeks and dialogs stay above
  it). The CodeMirror view lives through the visit, and with it the undo
  history, the selection, the scroll, the session Restore works from
  (`RollbackHistory`), and the change log's `OpsLogger`, whose pending batch
  now goes on its own 500 ms or with the quit (`store.beforeLeave`), not at
  the moment Settings opened.
- While covered, `.v-under` is `inert` and `visibility: hidden` (styles.css,
  "Settings over the page"). `visibility`, not `display: none`: the page
  keeps its layout while it is covered, so a face or a size chosen in
  Settings is measured there and then, not on the way back. The plan
  expected `display: none` to lose the scroll as well; measured, it kept it
  in both engines (`tests/scratch/settings-visit/display-probe.mjs`), so
  that is not a reason. Also measured (`focus-probe*.mjs`,
  `scroll-probe.mjs`): in Chrome `inert` or `visibility` alone keeps focus
  and keys out of a focused editor; in Playwright's WebKit `visibility`
  alone did not. With it alone, keys typed after the caret was left in the
  page went into the hidden editor, and PageDown, the arrows, End and Space
  pressed with focus nowhere scrolled it; `inert` stopped both.
- **The covered page is read-only too.** Found by the keyboard test: the
  browser keeps one undo stack for the whole document, and Cmd/Ctrl+Z
  pressed anywhere in Settings (on a button, with focus nowhere, in Author's
  Name field once its own typing was undone) walked it into the editor's
  typing and took that back as a fresh edit, outside CodeMirror's history,
  which the autosave and the change log would have kept. Chrome and
  Playwright's WebKit both (`undo-probe.mjs`). `MarkdownEditor` now locks
  the editor while `covered`, through the compartment `disabled` already
  used (`readOnly`, `contenteditable="false"`): the browser's undo skips text
  that is not editable, and CodeMirror ignores DOM changes in a read-only
  editor. On the way back it is editable again before the caret returns.
  The same undo still reaches the page from any button while the page is on
  screen; that is older than this build (`TODO.md`).
- **Focus.** Settings opened with focus left on the page (a click on a
  button moves none in WebKit) or nowhere takes it to the group Settings
  opens on; focus on the top bar's Settings, where a click in Chrome leaves
  it, stays there. Back to the manuscript returns the caret through
  CodeMirror's own focus, which redraws the selection and does not scroll.
  With no chapter to return to (none open, or the corkboard) focus goes to
  the top bar's Settings (`data-opens="settings"`), or to its lip when the
  bar is folded. The Focus chord from Settings still closes it and enters
  Focus, and the caret now comes back with its history.
- **Rewrite and Restore close Settings first.** Rewrite (Cmd/Ctrl+Shift+R
  and the top bar's button) and Restore (Cmd/Ctrl+Alt+R and the status
  bar's) stay in reach while Settings is open; pressed there, Settings
  closes, the caret comes back, and they act on the page, so what they act
  on is on screen when they do. (As first built they did nothing there, not
  even the "Select a passage first." they said before; changed with the
  verifier fixes below.)
- **Notices.** The editor's notices effect (`--v-notes-room` and
  `liftCaret`) does nothing while the page is covered: the stack is over
  Settings, and the hidden page has real geometry, so a confirmation raised
  in Settings would have scrolled the page under it. Coming back runs it
  once (`covered` is tracked): a stack still showing then gets its room
  below the last line, and is lifted off the caret's line, as one raised on
  the page is. (As first built, `covered` was read untracked and coming back
  ran nothing; changed with the verifier fixes below.)
- Unchanged: Focus and Settings never share the page (`isEditorOnScreen`),
  and the binder's chord stays off in Settings.

**The typeface reaches the page.**

- **An id and its stack at the boundary.** `editor_font` and
  `set_editor_font` answered a CSS stack, which Typography compared with
  catalogue ids, so its mark never matched anything; the mock answered ids,
  so no spec saw it. Both now answer `fonts::EditorFont { id, stack }`.
  `fonts::resolve`, which replaces `stack_for`, gives the stored id's entry,
  or the default's under its own id when settings name a face this catalogue
  lacks, so the mark and the page agree. Settings files have only ever held
  ids (one writer, `49d972c`); a missing key still defaults to
  `system-serif`, and a dropped face or a stack where an id belongs resolves
  to it. The command bodies are `current_font` and `choose_font`, which the
  tests call; the old tests exercised a copy of them.
- **On the page the way size and spacing are.** `pageStyle` adds
  `--editor-font` in the `page` compartment, so a choice reconfigures the
  running editor (under Settings too) and CodeMirror measures again; the
  content's rule reads `var(--editor-font, …)`. `fontFamilyValue` keeps out a
  stack that could end the declaration (`;`, braces, angle brackets, a
  backslash, a line break), and a unit test runs every face in the shipped
  catalogue through it.
- **The default face changed for some writers.** The stylesheet named
  "Source Serif 4" first, which no setting chose. Its fallback is now the
  catalogue default's own stack (`system-serif`), kept equal by a unit test,
  so a writer who has Source Serif 4 installed and never chose it now sees
  Iowan Old Style, Palatino or the next of that stack, which is what
  Typography marks; choosing Source Serif 4 brings it back.
- **State.** `editorPreferences.font` holds what Rust answered, read at
  launch and on each visit to Typography (which retries a launch read that
  failed); the mark is `markedFont(body faces, font)`, and the sample
  paragraph is set in the face the page is in, marked or not; a refused
  choice leaves the page and the mark where they were and says why under the
  list.
- **Typography's mark and notes.** The chosen row carries
  `.v-list-item-active`, which now draws a bar of `--accent` down its leading
  edge (styles.css): its fill and border alone were 1.05–1.13:1 and
  1.33–1.47:1 against the page, under WCAG 1.4.11's 3:1, and hover drew the
  same fill. The class is shared, so the panel's open project and chapter
  and the tour's chosen template wear the bar too. A face the catalogue
  marks `available: false` (Source Serif 4) says "shows only where it is
  installed" / "solo se ve donde esté instalada" instead of "already on this
  machine".
- **The gutter.** Line height is unitless and the gutter's rule uses only
  size and spacing, so a face cannot change a line's height; what it changes
  is the wrapping, and with it each paragraph's block. With numbers on and a
  test-only monospace face, every number's top and height match its line's
  within 1px before and after the switch, and the paragraphs take more lines
  in it.
- **The mock** imports `fonts/catalog.json` instead of a drifted copy of its
  own (no `available`, `note`, `defaultBody` or `system-mono`, another
  `system-serif` stack), answers `{ id, stack }` with Rust's fallback, and
  exposes `fonts` so a spec can add a face.

Tests. Rust, 5 new and 2 rewritten against what the commands now run: a
stored id resolves to its entry, and anything else to the default under
the default's id; an `EditorFont` carries its entry's id and stack; the
answer is the id settings hold plus its stack, never the stack twice; a
settings file naming a dropped face, holding a stack, or written before
fonts shows and renders the default; the wire shape is exactly
`{ id, stack }`; a choice answers what was kept and survives a reload of
the file; only a catalogue id can be chosen. Vitest, 10 in
`tests/unit/editor-font.test.ts`: the page style with and without a face,
the guard on the value, every shipped face accepted, the stylesheet's
fallback equal to the catalogue's default, the mark (an id, a stack, an id
not offered, nothing), a face changed in place on a live editor (same DOM,
caret and undo depth), and the store (what Rust answered, a refusal keeping
the face); `tauri.test.ts` checks `set_editor_font` is sent an id.
Playwright, 15 new. `tests/e2e/settings-visit.spec.ts` (11): undo and
Restore after a visit; the caret, the selection and the scroll, with and
without Typewriter; under Settings nothing on the page answers Tab, typing,
undo or the scrolling keys (Rewrite and Restore were in this test as first
built), nothing of it is offered to assistive technology, and it is inert;
the undo key in Settings stays in Settings; Settings opened with the caret
still on the page takes the keyboard; the layer covers exactly the panel
and the page; a notice raised in Settings leaves the covered page where it
was; a quit from Settings writes the change log first; the Focus chord from
Settings; and focus with no chapter to go back to.
`tests/e2e/editor-settings.spec.ts` (4): the chosen face on the page live,
under Settings, in the same editor and after a reload; a refusal; settings
naming a dropped face; the gutter.

Each mechanism was removed once and the test meant for it watched fail
(`tests/scratch/settings-visit/mutate.py`, logs in
`tests/scratch/out/settings-visit/`), in a copy of the tree served by a Vite
of its own on :1441 and a Rust target dir cloned from this one, never in
the live `src/` under the shared :1420. First, all 31 checks passed
unmutated; then 33 removals (28 in the frontend and the mock, 5 in Rust),
53 checks (34 Playwright in Chrome, 3 in Playwright's WebKit, 8 vitest, 8
cargo), 53 failed, each in the test meant for it. Settings swapped for the
page again (`{#if}`) fails undo and Restore, the caret, the selection and
the scroll with and without Typewriter, the Focus chord and the face's
same-editor check; the old wire's stack in the id fails three Rust tests;
the mark compared with the stack fails the face test and the dropped-face
test. Four more checks ran for the record and passed, as expected: with
`inert` gone, Settings opened with the caret on the page, in both engines
(departure 3); and with the face set on the editor's host, outside
CodeMirror, the gutter and the face tests, because CodeMirror measures again
by itself when its content changes size. So the gutter test guards the
alignment, not the route the face takes to the page. Missed on the way,
each fixed before that count: removing `inert` failed nothing in either
engine, so the keyboard test now reads the attribute; the dropped-face test
was listed against the face read at launch, which it cannot see (the page
shows the default either way); and the first run stopped at the mock's
removal on a 403 from the sandbox's Vite (`/tmp` is `/private/tmp` there),
fixed and run again. The first baseline also ran pnpm in the sandbox,
whose check before running installed into this checkout's `node_modules`
through the link (it recorded esbuild's build as ignored); the next pnpm
command here put that back (`allowBuilds`, esbuild's binary in place), and
the harness now calls the binaries.

Measured with `make verify` (exit 0, 76 s): svelte-check 401 files, 0
errors, 0 warnings; locale keys 753 in each language (no new strings);
vitest 230 → 240 in 29 files; `cargo test` 574 → 579 unit plus 4
integration, 16 ignored; clippy `--all-targets` 0 findings; Playwright
199 → 214.

Playwright's WebKit, the macOS app's engine, passes both specs
(`tests/scratch/settings-visit/pw-webkit.config.ts`, 22 of 22; not in the
gate, which runs Chrome). Looked at in Chrome on the mock
(`tests/scratch/settings-visit/look.mjs`) at 1280×800 and 900×600, in
English and Spanish, in Folio, Quarry and Needle, light and dark: the
page, Settings over it, a face chosen, the way back with the selection
where it was, keyboard focus, and a notice raised in Settings. Settings
looks as it did; nothing about the layer animates, with or without reduced
motion; the page logs no errors.

Where this departs from the plan, none confirmed by the owner yet:

1. The covered page is read-only as well as inert and hidden (above). The
   plan had the guards in App only; the browser's own undo goes round them.
2. The keyboard test also presses the undo key, types and presses the
   scrolling keys with focus nowhere, and has a twin for the undo key in a
   Settings field.
3. `inert`, `visibility: hidden` and the read-only lock back each other up.
   Removing both of the first two fails the keyboard test's Tab; removing
   `visibility` fails what the page offers to assistive technology and
   whether it reads as hidden; removing `inert` alone fails no key in Chrome
   or in Playwright's WebKit once the page is read-only (before the lock,
   WebKit showed what it adds, above). The keyboard test reads the attribute
   itself, as `chrome.spec.ts` does for the folded bars.
4. Typewriter's variant switches Typewriter on after selecting: on, it
   pulls the page back to the caret at every change of geometry, so a scroll
   made after it does not hold.
5. Back from Settings with no page to go back to, focus falls to the top
   bar's lip when the bar is folded and its Settings button is inert; the
   top bar's Settings carries `data-opens="settings"` for App to find it.
6. The old "Known limits" under "Settings → Editor" stays as written, with a
   line saying the first two were fixed here.
7. `DESIGN-VERSORIUM.md`'s implementation notes still say the chosen face
   never reaches the editor and that the stylesheet names Source Serif 4
   first ("Fuente por defecto del editor", "La fuente elegida no llega al
   editor"); the plan left updating them to the owner.

Not done, or not reachable from here: the real webviews (`TODO.md`); a
machine with Source Serif 4 installed, where choosing it changes the page
(here the page stays in the stack's next family and looks the same, and the
row now says so beforehand). Found on the way and recorded in `TODO.md`, not
built: the undo key reaching the page from any button, the corkboard still
rebuilding the editor, Settings' missing Escape, `set_editor_font` taking
`ui` and `mono` faces, the editing host named "Chapters", a dev-console
warning in `SettingsPage.svelte`, a non-string `editorFont` costing the
whole settings file, Typography's English face names in Spanish, "Manuscript"
naming two things while Settings is open, and Restore taking back a typed
word one letter at a time.

**Verifier fixes (2026-10-04).** Seventeen findings came back; each was
confirmed before acting.

- **A notice stack still showing on the way back** (minor, and its twin from
  the regressions pass). Notices raised in Settings never got their room
  (`--v-notes-room`) or their caret lift, because the effect read `covered`
  untracked and so did not run on the way back. Reproduced in Chrome with
  the build's code put back (mutation M01, below), at 900×600: a caret at
  the foot of the page came back with its line's bottom 47px below the top
  of a one-notice stack; and with four errors raised in Settings (a 170px
  stack over the scroller's last 178px, past the 120px foot), the chapter's
  last line, typed at after Cmd+End, ended 54px below the stack's top. The
  effect now tracks `covered`: nothing while it is covered, once on the way
  back.
- **Rewrite and Restore did nothing under Settings** (minor and nit).
  Before this build Rewrite there said "Select a passage first."; the build
  made it silent. Both now close Settings and act (above).
- **The Typography mark was under 3:1** (major). Fixed with the bar above.
  Measured in Chrome in the six theme variants
  (`tests/scratch/settings-visit-fix/measure.mjs`), the bar is 5.85:1 to
  6.97:1 against its own row and 5.04:1 to 7.99:1 against what is around it,
  for Typography's chosen face and the panel's open chapter; a hovered row
  draws none.
- **Source Serif 4 said "already on this machine"** (minor): the note now
  follows `available`, in a new string in both languages (754 keys each).
- **Typography's sample previewed a face the page was not in** (nit): with
  settings naming a face the panel does not offer (`system-mono`, by a hand
  edit), the sample showed the first row's face. It follows the page now.
- **A notice gone from under focus while Settings is open** (minor): the
  notices module's last fallback was the caret, which is inert there, so
  focus fell to `<body>`. It now tries the caret, then the group Settings
  shows (`HOMES` in `Notices.svelte`). Reachable in WebKit: focus on a
  notice, Settings opened by a click (which moves no focus there), Escape.
- **Tests the gate lacked** (minor and nits): `openSettings`'s
  `holdsFocus` branch failed only WebKit when removed; a twin test from a
  chapter row now fails in Chrome without it (a row keeps focus after it
  goes inert in Chrome, while the caret leaves for `<body>` the moment the
  editor locks). The lip fallback in `closeSettings` and Typography's
  re-read on each visit had no test; both do now.

Rejected or left, with the reason: the Rust and the mock disagreeing on a
non-string `editorFont` (no spec depends on it; recorded in `TODO.md` with
the Rust behaviour it waits on); the face names and license shown in English
in Spanish, and "Manuscript" naming two things (both older than this build;
recorded in `TODO.md`); the dev-console warning in `SettingsPage.svelte`
(already recorded, outside this item); `DESIGN-VERSORIUM.md`'s stale lines
(the plan left them to the owner; listed in `TODO.md` now so they are not
lost). Two removals the verifiers ran that fail no test are defence in
depth, confirmed here for the record: the editor built without the face
(the reconfigure effect applies it before the first paint) and `rollback()`
checking `disabled` instead of `locked` (App's `doRestore` already closes
Settings before it calls it).

Tests, 10 new Playwright and 1 rewritten. `settings-visit.spec.ts`: focus
on a chapter row when Settings opens goes into Settings; Rewrite (the key,
with a selection; the top bar's button, without one) and Restore (the
status bar's) pressed over Settings close it and act; a notice raised in
Settings leaves the covered page alone and, on the way back, the caret's
line clears the stack by the smallest scroll that does it (rewritten from
"does not move the page under it", which also asserted the page did not
move on the way back); a four-notice stack raised in Settings gets its room,
so the last line typed at clears it; with no chapter and the top bar folded,
focus comes back to the lip; a notice closed from the keyboard over Settings
hands focus to Settings. `editor-settings.spec.ts`: a launch read of the
face that failed is retried in Typography; with no read at all the page and
the sample are in the stylesheet's face and the panel says why; settings
naming an unoffered face mark no row and the sample is in the page's face;
each row's note follows `available`; the chosen row's bar is 3:1 or more
against its row and the panel in all six themes, a hovered row draws none,
and the panel's open chapter wears it too.

Each fix was removed once and its test watched fail
(`tests/scratch/settings-visit-fix/mutate.py`, logs in
`tests/scratch/out/settings-visit-fix/`), in a copy of the tree served by a
Vite of its own on :1442, never the shared :1420. All 18 checks passed
unmutated first; then 20 removals, 23 required checks (20 in Chrome, 3 in
Playwright's WebKit), 23 failed, each in the test meant for it, among them
the build's own untracked `covered` and its silent Rewrite and Restore put
back. For the record, as expected: without `holdsFocus` the caret's twin
still passes in Chrome, and without `focusLost` the row's does; the two
defence-in-depth removals pass. Both specs pass in Playwright's WebKit
(`tests/scratch/settings-visit-fix/pw-webkit.config.ts`, 32 of 32). Looked
at in Chrome on the mock (`tests/scratch/settings-visit-fix/look.mjs`):
Typography in the six themes with a row hovered, and the panel's open
project and chapter.

Measured with `make verify` (exit 0, 74 s;
`tests/scratch/out/settings-visit-fix/verify.log`): svelte-check 401 files,
0 errors, 0 warnings; locale keys 753 → 754 in each language; vitest 240 in
29 files (unchanged); `cargo test` 579 unit plus 4 integration, 16 ignored
(no Rust changed); clippy `--all-targets` 0 findings; Playwright 214 → 224.
The two specs also ran four times over in the gate's eight workers, 128 of
128.

## A novel's language can be changed, imports keep theirs, and Scrivener synopses are kept (2026-10-04, on `feat/landing-and-docs`)

Two items from `TODO.md`, built together because both run through the
import: "A novel's language is fixed at creation, and imports are English"
and "Scrivener synopses are read and dropped". What is left of the second is
in `TODO.md` ("Synopses are kept and shown, but nothing writes one"); the
first is gone from it.

**One list of languages.** `LANGUAGES` (`["en", "es"]`) and `language_code`
in `src-tauri/src/commands/project.rs`. A tag counts when it is shaped like
one (the shape `contentLanguage` already asks of a `lang`) and its primary
subtag is on the list, so `es-MX`, ` ES_mx `, `es-419` and `en_US` are `es`
and `en`, and `fr`, `español` and `en-` are refused. `NOVEL_LANGUAGES` in the
new `src/lib/i18n/languages.ts` is the frontend's copy. A Rust test and a
vitest test hold each to the names under `languages` in both locale files,
so neither can offer a language the interface cannot name.
`create_project` now refuses any other code with `bad_language` before the
folder exists, and stores the code (every caller already sent `en` or `es`).

**The language can be changed.**

- `update_project` takes a sixth argument, `language`, refused with
  `bad_language` before anything is written; a call with only a language is a
  change, not `bad_args`. `versorium.json` is written through `write_meta`, as
  before (atomic). `api.updateProject` now takes a patch (`ProjectPatch`)
  instead of positional arguments; the binder store's `setProjectLanguage`
  sends the language alone and hands the answer to the open project and the
  list, as `setExportMatter` does (both go through one `patchProject` now).
- Project settings has a `Select`, "Manuscript language" / "Idioma del
  manuscrito" (`dialog.language`, the name New project already gave the
  setting), above the two checkboxes, with a hint saying what follows it
  (screen readers on the page; every export declares it and writes its
  closing page in it). It is bound to a writable `$derived` of the stored
  language, so a refused change puts the picker back and says why under it,
  without remounting it (focus stays on it). A code outside the list, in a
  hand-edited `versorium.json`, shows as one more option, "fr (not offered)",
  rather than as the first language; a region or a capital of a language on
  the list shows as that language, "Español (es-MX)".
- The open page follows at once and is not rebuilt: `MarkdownEditor` already
  reconfigured its `lang` from `project.meta.language` through a compartment,
  so only the store had to replace `meta`.
- The dialog is `wide` now (560px). At 440px the title page preview and the
  settings never sat side by side, so the dialog was one column and scrolled
  (`scrollHeight` 940 in a 638px dialog at 1280×800 with the new field).
  Wide, the two columns fit, but the dialog still outgrew a laptop screen,
  and its settings now scroll inside it with Done kept in view (below,
  "After review").

**Imports keep theirs, and the dialog asks.**

- `Imported` carries `language` (a code a novel can take, or null) and
  `declaredLanguage` (the tag as the source wrote it, cut to 40 characters).
  Markdown reads `language:` from its frontmatter (quoted either way). DOCX
  reads `dc:language` in `docProps/core.xml`, then `w:themeFontLang` in
  `word/settings.xml`, then `w:lang` under `w:docDefaults` in
  `word/styles.xml`. EPUB reads its first `dc:language`. Scrivener reads none:
  the binder file has none, nothing else in the bundle is read, and no
  Scrivener project was at hand to find out where one keeps a language, so
  none is guessed (a test records the decision).
- The import preview always shows a language picker under the title ("Manuscript
  language", as everywhere else), because
  a language read from Word comes from its template and can be wrong. It is
  preset to the source's language, or to the interface's when the source
  gives none, and its hint says which: the language the file gives ("Change
  it here if that is wrong."); that the file does not say; or the tag the file
  gives when Versorium cannot use it.
- `import_apply(source, title, language)`. Its body is `import_into`, with
  the projects folder as an argument, so Rust tests run the whole apply in a
  temp dir (it was covered only through the mock). It refuses a bad language
  before reading the source, so nothing is created and a missing file is not
  what is reported.

**Scrivener synopses are kept.**

- On the chapter, as `synopsis:` in its frontmatter (`set_synopsis` in
  `commands/chapters.rs`), one line of JSON, which YAML reads as a
  double-quoted string: quotes, a backslash, line breaks and a `---` on a line
  of its own cannot end the frontmatter. `yaml_string` also escapes what JSON
  leaves raw and YAML 1.1 readers take as a line break (U+0085, U+2028,
  U+2029) or refuse (DEL, the C1 controls, a BOM, U+FFFE, U+FFFF). Windows
  endings become `\n`, the margins go, and an empty synopsis writes no key.
- Every write keeps it, because every one keeps keys it does not own:
  `save_chapter` (the editor's saves, an applied rewrite, an agent's edits
  over MCP, a restored snapshot), `update_chapter` (title, status) and a
  reorder, which never opens the file. `save_chapter` and `update_chapter`
  now share `rewrite_header`, which takes a replaced key's YAML block, list
  or blank lines with it: retitling a hand-written `title: >` used to leave
  its lines hanging under the key before it.
- The corkboard prefers it. `cardText` (`src/lib/binder/cardText.ts`, out of
  `Corkboard.svelte`) gives a synopsis, in the text colour with its line
  breaks; or, without one, the chapter's opening prose, muted and in italics,
  as an excerpt; or nothing ("Nothing written yet."). A screen reader hears
  "Synopsis:" or "Opening lines:" first. The excerpt leaves scene headings out
  (they used to be glued to the next sentence: "Morning The road bent
  north.") and is cut at 200 characters between code points, not inside an
  emoji. A synopsis written by hand as a YAML block reaches the card as its
  indicator alone (`|`), and is taken as none.
- A Scrivener export writes the stored synopsis to `synopsis.txt`, whole,
  and the first sentence only for a chapter without one, so a synopsis comes
  back from Scrivener → Versorium → Scrivener as it went. The import leaves
  out a card that is only its chapter's first sentence, so Versorium →
  Scrivener → Versorium makes no synopsis up (below, "After review"). `formats::Chapter`
  has a `synopsis` (20 literals updated); `read_manuscript` fills it, with the
  card's rule about a lone indicator (`readable_synopsis`). The other formats
  have no per-chapter place and are unchanged.
- The card's words were `--text-mute`, which on the open chapter's tinted
  card measured 3.92:1 in Folio dark, 4.29:1 in Folio light and 4.45:1 in
  Quarry dark: small text, under AA's 4.5:1. They are now `--text-mute` mixed
  25% with `--text`: 5.00:1 at the lowest, 4.96 → 6.35:1 on a resting card
  in Folio light.

**The mock** stopped lying about the import: `import_apply` validates the
language, creates the project in it, and puts the previewed chapters in with
their bodies and synopses (it used to make an English project holding only
the placeholder); `read_chapter` returns `synopsis` in the frontmatter;
`update_project` takes and validates a language and checks before writing;
`create_project` validates like Rust; and `importPreview` is exposed so a spec
can give the file a language.

Tests. Rust, 28 new and 1 rewritten: `language_code` accepts and refuses;
`LANGUAGES` equals the locale names; a language changed through
`update_project` reaches the file and nothing else moves, and a refused one
leaves the file byte for byte; `create_project` refuses and leaves no
folder; Markdown's frontmatter language (quoted, unquoted, a region, `fr`,
none, the export round trip); DOCX's three places, their order, a language
on a named style or with no defaults ignored, an entity, none, and the
export round trip; EPUB's `dc:language` and its absence; Scrivener names
none; an import takes the language given (over the file's), and refuses a
bad one before anything exists or is read; a Scrivener synopsis lands in its
chapter's frontmatter exactly, with the body intact; a chapter without one
gets no key; the synopsis survives Scrivener → Versorium → Scrivener; it
survives a save, a save with a status, a rename, a status change and a
reorder (bytes unchanged); it is one line of JSON and an empty one writes
nothing; a replaced key's block, list and blank lines go with it; an agent's
four write tools over MCP and an applied rewrite keep it; the export prefers
it; `read_manuscript` carries it; a lone indicator is none; a declared tag is
kept as written. `importing_replaces_the_placeholder_chapter_rather_than_appending`
now runs the apply instead of only the preview. Vitest, 15 new in
`tests/unit/` (`card-text`, `corkboard-synopsis.render`, `novel-languages`,
`project-language`), plus `tauri.test.ts` (the patch and the import's
language on the wire) and `state.test.ts` (the language reaches
`importApply`). Playwright, 6 new and 2 extended: the language changed live
in the same editor and kept on reopening; a refused one springs back with
its reason; the import asks when the file does not say and the new novel is
in the one chosen; a declared language is the preset and an unusable one is
named; the corkboard shows the imported synopsis and says which kind each
card is; the card's words hold 4.5:1 in the six themes, on the open card
too; and the Spanish Project settings and import question.

Each mechanism was removed once and the test meant for it watched fail
(`tests/scratch/novel-language/mutate.py`, logs in
`tests/scratch/out/novel-language/`), in a copy of the tree served by a Vite
of its own on :1444, with a Rust target dir cloned from this one, never in
the live `src/` under the shared :1420. All 40 checks passed unmutated
first (the two tests strengthened afterwards, below, pass too). Then 38
removals (16 in the frontend and the mock, 22 in Rust), 57 required checks
(12 Playwright, 11 vitest, 34 cargo), 57 failed, each in the test meant for
it. Missed on the way and fixed before that count: the first
run had 54 of 55; ignoring `w:docDefaults` when reading `w:lang` failed
nothing, because the reader also stops at `</w:docDefaults>`, so the test
now has a styles file with no defaults at all (and stopping there got a
removal of its own); and taking `import_into`'s own check out failed nothing
while `create_project` still refused, so the test now imports a missing file
with a bad language and expects `bad_language`. One check ran for the record
and passed, as expected: with the core properties unread, an exported DOCX
still comes back in its language, from `styles.xml`.

Measured with `make verify` (exit 0, 81 s;
`tests/scratch/out/novel-language/verify-final.log`): svelte-check 403 files, 0
errors, 0 warnings; locale keys 754 → 764 in each language; vitest 240 → 255
in 33 files; `cargo test` 579 → 607 unit plus 4 integration, 16 ignored;
clippy `--all-targets` 0 findings; Playwright 225 → 231. The two specs this
touched also pass in Playwright's WebKit, the macOS app's engine (18 of 18,
`tests/scratch/novel-language/pw-webkit.config.ts`; not in the gate).

Looked at in Chrome on the mock (`tests/scratch/novel-language/look.mjs`,
shots in `tests/scratch/out/novel-language/look/`) at 1280×800, in English
and Spanish, in Folio, Quarry and Needle, light and dark: Project settings
with its picker, focused, and with a refused change; the import preview in
its three hints; the corkboard after an import with a synopsis of two lines.
Found that way and fixed: the dialog scrolling (now wide), the heading glued
to the excerpt, and the card's contrast on the open card. The only console
error is the dev server's missing `favicon.ico`.

Where this departs from the plan:

1. `language_code` also asks for the shape of a tag, so `en-` and `español`
   are refused rather than read by their first letters.
2. `rewrite_header` is shared by `save_chapter` as well as by the title and
   status path, so the block rule applies to `status:` and `words:` too. A
   blank line after a replaced key goes with it.
3. `yaml_string` escapes the YAML 1.1 line breaks and unprintables on top of
   JSON.
4. The Project dialog is wide; the card excerpt leaves headings out and is
   cut between code points; the card's words are less muted (above). None of
   these was in the plan; each came from looking at the screenshots or
   measuring them.
5. The import hint names the language the file gives by its name ("Español"),
   not by the tag the file wrote (`es-MX`).
6. `declaredLanguage` is cut to 40 characters, so a field holding a paragraph
   does not fill the hint.
7. DOCX's three readers share one entity resolver with the paragraph reader
   (`resolve_entity`), which replaced its inline copy.

Not done: nothing in the app creates or edits a synopsis, only Scrivener
export carries one, and a Scrivener project's language is not read
(`TODO.md`); the real webviews and a real Scrivener bundle were not tried.
Found on the way, not built: the DOCX importer reads `<dc:title>` without
unescaping it, so "A &amp; B" arrives as such; a failed import leaves the
half-made project folder behind, and the placeholder chapter's removal
ignores errors (`import_into`); the corkboard caches each card for as long as
it is open, so a chapter changed meanwhile shows its old card; the open
chapter's card's id, status and word count (`--text-mute`, 11px) measure
3.92:1 to 4.88:1, under 4.5:1 in Folio light and dark and Quarry dark;
`NewProjectDialog.svelte` and `Onboarding.svelte` keep their own copies of
the language list; `create_project` writes `versorium.json` with `fs::write`
rather than atomically; and the mock's import preview warnings are English
prose where Rust sends codes, so the Spanish mock shows them in English.

### After review (2026-10-04)

The build was reviewed, and 19 findings came back. Each was checked before
anything changed.

**Fixed, each with a test that fails without the fix:**

1. **Versorium → Scrivener → Versorium no longer makes up synopses.** For a
   chapter with no synopsis, the export writes its first sentence as the
   card, and the import kept every card it found. So each such chapter came
   back with a "synopsis" that the corkboard announced as one, and the next
   export repeated it after the opening had changed. A test failed on this
   first (`a_card_that_only_repeats_the_first_sentence_is_not_a_synopsis`).
   The import now leaves out a card equal to what `first_sentence` makes of
   the imported chapter. `first_sentence` is the exporter's rule, now one
   function that both sides use. The comparison is trimmed, since a card cut
   at 200 characters can end on a space. A synopsis typed in Scrivener that
   is word for word the first sentence is dropped the same way, and the next
   export writes it back (FORMATS.md).
2. **The last language picked is the one kept.** If the writer picked a
   second language before the first answer came, the second pick was
   compared with the stored language and dropped. Writes now go one at a
   time. A pick made during a write waits for it and then goes, and the
   picker shows that pick meanwhile. The picker is not disabled while it
   writes, because that would take the focus from a keyboard user.
3. **The closing page's preview is in the novel's language.** It uses
   `exportLabels(language)`, the wording the export sends, and carries
   `lang` for screen readers. The language row stays the code, as
   `colophon_lines` writes it. The word count is bare digits, as the export
   writes it: grouped by the interface's locale, 12,345 reads as a decimal
   in a Spanish card.
4. **The setting has one name.** Both pickers use `dialog.language`,
   "Manuscript language" / "Idioma del manuscrito", as New project and
   Onboarding already did. The two labels this build had added are gone.
5. **Project settings fits a laptop screen.** At 1280×800 it overflowed by
   8px in English, but by 62px in Spanish and 84px with an error showing,
   and Done sat wholly below the edge
   (`tests/scratch/novel-language-fix/measure-project.mjs`). Its settings now
   scroll in a body of their own, as in the Manuscript, Rewrite and
   onboarding dialogs, and Done stays in view. The dialog itself overflows
   by 0px at 1280×800 and 1280×720 in both languages, and is unchanged at
   1440×900, where it fits. A scroll box clips at its edges, and the picker
   reaches the right one. So the body reaches 4px into the dialog's padding
   and gives the 4px back inside, which leaves room for the 3px focus ring
   without moving anything. The import preview's new picker and its title
   field had the same cut on both sides (0px of room), and are fixed the
   same way (3.5px on each side now).
6. **A region of an offered language reads as that language.** `es-MX` shows
   as "Español (es-MX)" (`project.languageRegion`), not as "es-MX (not
   offered)". `novelLanguageOf` reads a tag the way `language_code` does,
   and a test holds it to that function's test cases.
7. **A tag that gives no language is no answer.** `und`, `mul`, `zxx`, `mis`
   and private-use tags (Word's `x-none`) count as nothing said, in every
   importer. A DOCX then reads its next place, instead of reporting `x-none`
   as a language Versorium cannot use.
8. **The Spanish hint quotes the picker's label** («Español») instead of
   capitalising a language name mid-sentence.
9. **Mechanisms that had no test now have one:** the synopsis card's line
   breaks, the excerpt's italics and the synopsis's colour (computed styles
   in Chrome, since jsdom loads no CSS); EPUB's unprefixed `<language>`;
   the dialog passing the picker the novel's own code (a `seedLanguage` on
   the mock's seed); and each of the mock's three language checks, seen
   refusing with its message (`update_project` under the picker,
   `create_project` in New project, `import_apply` in the import).
10. **The mock.** Every answer that holds chapters now has exactly
    `ChapterMeta`'s six fields; `update_chapter`, `reorder_chapters`,
    `delete_chapter` and `delete_project` used to send body and synopsis
    too, and a test now holds them to it. The preview and the apply share
    one rule for which files can be imported, `.txt` included, as in
    `importer_for`. A spec can hold a command's next call (`hold`,
    `release`).

**Not done, and why:**

- **Half of finding 4 (DOCX).** When the core properties name a language
  Versorium cannot use (`fr-FR`), the search still ends there; it does not
  fall through to Word's template language further down. The core
  properties are what somebody declared. The template's language is the
  guess that the importer's own comment warns about, and the dialog would
  then tell the writer "the file gives its language as Español" about a
  file that declares French. A test pins this choice (mutation R05 below).
- **Finding 17** (three word counters for one chapter) is outside this item.
  It is recorded in `TODO.md`, together with how it affects the Project
  settings preview.
- **Finding 19** needed no code. FORMATS.md now says that a key the app
  writes replaces any block written under it by hand.
- **The other half of finding 14** is outside the item: New project lists
  Español first, and both it and Onboarding keep their own language lists.
  It is in `TODO.md`. Onboarding already listed English first, so only New
  project differs.
- **Finding 12:** the 84 GB clone under
  `tests/scratch/out/novel-language/target` has been deleted.

**Measured.** Each mechanism above was removed once in a copy of the tree.
The harness is the first round's, `tests/scratch/novel-language-fix/mutate.py`,
with its own Vite on :1444 and logs in `tests/scratch/out/novel-language-fix/`.
All 19 checks passed unmutated first; a 20th, added with the import
dialog's fix, passed in the live tree before its own removal. Then came 28
removals (22 in the frontend and the mock, 6 in Rust) with 31 required
checks (21 Playwright, 2 vitest, 8 cargo); all 31 failed, each in the test
meant for it. The four removals behind the mock-shape test were run again
after its boot wait was added (`mutate-rerun.log`), and all four still
failed. Six more
checks ran for the record and passed, as expected, because another mechanism
holds there. For example, the mock's `import_apply` check alone is masked by
`create_project`'s, as `import_into`'s is in Rust; with both removed, the
import test fails.

`make verify` exits 0 in 79 s
(`tests/scratch/out/novel-language-fix/verify-final.log`):

- svelte-check: 403 files, 0 errors, 0 warnings
- locale keys: 764 → 763 in each language
- vitest: 255 → 257, in 33 files
- `cargo test`: 607 → 612 unit plus 4 integration, 16 ignored
- clippy `--all-targets`: 0 findings
- Playwright: 231 → 238

The three specs this round touched also pass in Playwright's WebKit, the
macOS app's engine: 36 of 36
(`tests/scratch/novel-language-fix/pw-webkit.config.ts`; not in the gate).
WebKit is where the new mock-shape test's race showed up: it read the mock
before the app had booted. It now waits for the app first.

In Chrome on the mock, at 1280×800, the following were checked by eye
(shots in `tests/scratch/out/novel-language-fix/`): Project settings in both
languages, the picker's focus ring at 2x at the box's edge, and the Spanish
import preview with its picker focused.

## Settings, regrouped: Tasks, Models, Assistants, Access, Activity (2026-10-04, on `feat/landing-and-docs`)

Three items from `TODO.md`, built together: "Settings: redesign Local AI and
Assistants, and group the sidebar", "The local server cannot be given to a
task", and the "Form controls still hand-written" rows for `LocalAiSection`,
`LocalAiGroup` and `AssistantsGroup`. The spec is
`~/Documents/Github/.versorium-design/versorium-settings-redesign/SPEC.md`
(outside the repo); its §15 owner answers override its §13 defaults. It was
written before Settings opened over the editor, before the notices module and
before Settings → Editor; where it was stale, the build followed the code
(below, "Where the spec was stale").

**The rail.** Ten pages under four labelled categories and a footer, two
levels only (`src/lib/settings/pages.ts`): Writing (Editor, Appearance), Your
novel (Author, History & backup), AI (Tasks, Models, Assistants), Other apps
(Access to your novel, Activity), then a rule and Application. Every page is
in the Tab order in Chrome (the roving tabindex is gone, and with it the
dev-console warning `SettingsPage` raised on every visit; WebKit, the macOS
webview, reaches a button with Tab only when Full Keyboard Access is on, as
everywhere in the app: `TODO.md`); Up, Down, Home and End move
focus only, and Enter, Space or a click opens a page and puts focus on its
title (`#settings-page-title`). No tabs, no `aria-selected`: destinations, with
`aria-current="page"`. The page you are on is `--sel` with a 3px `--accent`
bar, the way the open chapter is marked; an `--accent` fill is left for a
page's one primary action. The title and the labels are `--text`:
`--text-mute` on `--bg-app`, which the old "SETTINGS" title used, is 4.21:1 in
Folio light and 4.40:1 in Quarry light (C3). The content pane is not a named
region, so the pages' own regions ("Author", "Backup") keep their names (C8).
Section headings inside Settings are sentence case (`.v-h3`, `.v-h4`), not
small capitals; their words did not change.

**Where everything went.** Local AI became Tasks and Models; Assistants
became Assistants, Access to your novel and Activity; the continuity runner
left Settings for a third tab of the Manuscript dialog. Settings and its links
share one model of where to go (`SettingsTarget`): "Change in Settings ›",
"Get a model", "Used by Rewrite", "Change access ›" and the Rewrite dialog's
"Open Settings › Models" land on a page and on the control they name.
Settings stays open under a dialog that links back into it (App bumps a
`request` count, so the same target twice still moves it), and "Run it from
Manuscript › Continuity" opens the dialog over Settings rather than closing
it: Escape comes back to the link.

**Tasks.** One native select per task, grouped by where the passage goes
("On this computer", "Assistants, with your own account"), with a line under
it that says so, wired as the select's description; for Continuity the
assistants are listed, disabled, with the reason as their group's label. The
settled choice is read once, 400 ms after the last change
(`chrome.announce`): on Windows a closed select changes on each arrow key.
Every change reaches Rust in order and the last one stands (below, C5). A
choice that no longer exists stays shown, disabled and selected, under "No
longer available", never silently the first option. A summary says what
each task runs on and offers one click ("Use Gemma 3 1B for both", with the
size word, the size and the fit beside it); it never offers an assistant or a
server at another address. A refused choice puts the select back and says
why. Project chat, search by meaning and dictation are plain text under "Not
built yet". The pure rules are `src/lib/settings/ai/picks.ts`.

**Models.** One sentence about this computer, the measurements behind it in
"About this computer" (and the engine's state there), "Start here" with the
one Recommended model while nothing can write yet (the smallest Medium model
that fits, never an uncensored one: Qwen3 4B Instruct 2507 on the real
catalogue), Your models (built in, partial, damaged, Ollama's, the server's,
the embedding model last), Ollama and the local server as one row each, and
the catalogue with search, family, sort, "Only models that fit" and "Show
uncensored models". Size words replace "pack" and "Balanced" everywhere,
onboarding included. One download at a time, and the other Download buttons
say why (`aria-describedby`). A download's button turns into its bar and
Cancel, so focus moves to Cancel, and when it ends the row moves to Your
models and focus moves to what the new model can do.

**The local server is a task's model.** A new slot kind, `server`, whose id is
the model id the saved server reports (`GET /v1/models`). `agents::rewrite`
and `continuity::check` send it `POST /v1/chat/completions` with the chosen
model, and say `server_offline` (`continuity_server_offline`) when it does not
answer. Nothing reaches a server before Save: `models_view` asks it only once
saved (`studio_view`, tested with a counting probe), `models_set_slot` refuses a
model it does not serve, and Forget releases every task that ran on it, as
does saving it at another computer's address (a notice says which). A
reasoning block in its answer is taken out, as the built-in engine does. Its
address is free text, so it can be another computer: Tasks then groups its
models under "On the server at {address}" and says the passage goes there,
the Rewrite dialog shows "Network", and the row on Models says the address is
not this computer.

**Assistants.** Claude Code, Codex and OpenCode only, as Found (with the
version) or Not found on this computer; never "Connected", which now means one
thing, on Access. Ollama moved to Models; the GitHub CLI, which nothing uses,
is no longer listed. "Used for Rewrite" links to the choice; links go both
ways between Tasks, Assistants and Access.

**Access to your novel.** One row per app that opens below itself; Connect
sits beside the header, never inside it. Read only until the writer presses
"Allow writing…", disabled with "Connect {app} first." until the app is
connected; it opens an `alertdialog` that starts on "Keep read only" and
whose first paragraph is the product spec's §7 sentence, word for word (owner
decision D6), followed by what the app could do, that a snapshot comes first
and that bringing one back is done with Git, outside Versorium, and that
History is where to look. Rust refuses a grant for an app that is not
connected (`mcp_client_not_connected`). "Make all read only" takes every
grant back, one at a time, a grant an older build left on an unconnected app
included ("Not set up · writing still allowed"). The warning colour appears
only where writing is on. HTTP is under Advanced, with the line saying apps
that connect by address can only read.

**Activity.** What outside apps asked for, newest first, in words ("Replace a
chapter's text"), filtered by app, kind and result, a hundred at a time. Rust
now logs a write that only returned its diff as `preview`, never `ok`
(`outcome_of` in `mcp/tools.rs`), and the page says "Preview only, nothing
changed". Each line carries the log's format (`mcp::log::FORMAT`, 2); a write
an older build logged `ok` may have been a preview, so it reads "Done, or only
a preview: logged before Versorium told them apart" and is listed under both
filters. A refusal links to that app on Access. No row claims a snapshot was
saved.

**Manuscript › Continuity.** Says which model runs the check ("Runs on Gemma 3
1B, on this computer.") or that there is none, with "Choose one in Settings ›";
the footer's "Check the manuscript" waits for a model, a novel and the desktop
app. It reads the models afresh the first time the tab is shown in a visit
(opened on Export, it asks Ollama and the server nothing), and lets them go
when the dialog closes unless Settings still shows them. A check still running
when the dialog closed is not waited for: its answer is dropped, so it never
lands in a dialog opened over another novel. A finding's kind (`contradiction`,
`note`) was shown raw in both languages; it is translated, and its chapter is
named by its title.

**The four bugs the spec found** (C3–C6), each with a test that failed on the
old code's behaviour:

| # | Before | After | Pinned by |
|---|---|---|---|
| C3 | Rail title and category-level text in `--text-mute`: 4.21:1 (Folio light), 4.40:1 (Quarry light) | `--text`: 11.32:1 or more in all six themes | `settings-nav.spec.ts`, contrast in every theme |
| C4 | Ticking Censorship left the uncensored card on screen until the page was left; a refused save left the box ticked | "Show uncensored models" updates the list before the save answers, and a refused save puts it back | `models-store.test.ts`, `m4-models.spec.ts`, `notices.spec.ts` |
| C5 | A download held the store's one busy flag for minutes: every slot, Ollama or server change made meanwhile was dropped without a word, and the task pickers were locked | Downloads (and Ollama pulls) have their own state; slot changes are chained, not dropped | `models-store.test.ts`, `settings-tasks.spec.ts` (download held) |
| C6 | The Rewrite picker offered the embedding model | Task selects list writing models only; a slot an old build pointed at it says the model does not write | `ai-picks.test.ts`, `settings-tasks.spec.ts` |

**Other changes.** `ConfirmDialog` takes paragraphs, a named safe answer
focused first, a neutral tone and the alert role (`Modal` gained `role` and
`describedBy`); the existing delete dialogs are unchanged. `Select` hands out
its element for focus. The Manuscript dialog's tab references are reactive,
which ends the dev-console warning it raised on every opening. Confirmations go through the notices (one click,
grants, a finished download); errors tied to a place stay there as alerts.
The mock (`tests/e2e/mock-tauri.ts`) mirrors the new Rust rules, exposes
`ollama`, `studio` and `llama` for specs to change, takes `?agents=none` for a
computer with no assistant (the app scans once per session), and its GPU label
is a device name, as Rust's is (C2). 163 locale keys per language whose only
readers were deleted are gone; `mcp.writeWarning` stays (D6).

**Owner decisions applied (§15).** D1–D5 as the spec's defaults. D6: the §7
sentence kept verbatim as the dialog's first paragraph; its Spanish is the
build's faithful translation (four sentences; it replaced a three-sentence
version that merged two), since the product spec gives it only in English.
D7: `ai.checkpointNote`, `git.commitHint` and `binder.confirm.chapterBody` are
untouched, so the Spanish Rewrite note still says "punto de control".

**Where the spec was stale.** Its HEAD and its wait for the collapsible bars;
"opening Settings unmounts the editor" (Settings covers it now, which is why
links into Settings move an open one and the Manuscript link keeps it open);
its own `aria-live` region in Settings (the notices and `chrome.announce` are
used instead); a censorship failure that "sets `error`" (it is a notice,
pinned by `notices.spec.ts`); the server copy that said no task can use it
(this build makes it one); its §13 D6/D7 defaults (§15 overrides them); two
specs that navigate Settings it did not list (`settings-visit`, `notices`);
line numbers in README, `ManuscriptDialog` and TODO; "›" in error text where
the repo says "→"; store tests that live beside their code; and pages that
each called `models.dispose()`, which Settings now owns so moving between
Tasks and Models never stops a download's bar.

**Measured.** `make verify` on the finished build: svelte-check 0 errors and
0 warnings over 420 files (403 before); locale parity 904 keys per language
(763 before: 304 added, 163 retired); vitest 40 files, 312 tests (33 and 257
before); `cargo test` 628 unit and 4 integration, 16 ignored (612 before);
clippy `--all-targets -D warnings` clean; Playwright 280 passed (239 before).
New tests: Rust 16 (B1 previews logged, B2 grants refused, the server slot,
its dispatch against a loopback fake OpenAI server, a server that does not
answer, a model it no longer serves, an unsaved server never contacted, the
probe only once saved, Forget releasing tasks, the continuity pass on the
server, IPv6 addresses); vitest 8 new files (`confirm-dialog`, `models-store`,
`settings-pages`, `ai-picks` on the real catalogue, `models-group`,
`mcp-activity` against Rust's tool list, `access-group`, `settings-keys`), the
Continuity tab in `ManuscriptDialog.render.test.ts`, and
`LocalAiSection.test.ts` deleted with its component, its cases moved to
`ai-picks` and `models-group`; Playwright
`settings-nav.spec.ts` and `settings-tasks.spec.ts` new, `m3-mcp` and
`m4-models` rewritten, `m2-rewrite`, `m7-polish`, `forms`, `notices`,
`settings-visit` and `m5-formats` updated. Each mechanism was then broken on
purpose, once, to see its test fail (`tests/scratch/settings-redesign/mutate.py`,
log in `tests/scratch/settings-redesign/mutations.log`): 49 mutations, every
one caught in the end. Three were not caught the first time, and their tests
were made to catch them: the C5 test looked at the pickers after the download
had ended (it now holds the download); "Recommended is never uncensored" held
on the real catalogue only because it has no uncensored Medium or Small model
(a synthetic one was added); and the announcement test checked the final
words, not how many times they were said (it now records every
announcement).

**Contrast, in the browser, all six themes** (`settings-nav.spec.ts`,
composited backgrounds as `m5-formats.spec.ts` does): the rail's title, labels,
current and resting pages; on Tasks the one-click meta, both status lines, a
warning line, the Manuscript link and a hint; on Models the Recommended tag,
the too-large line, Ollama's status and a model's line; on Activity a
refusal and the technical line. Every one is 4.5:1 or more. The spec's token
script (`spec-work/contrast.py`) gives the same pairs as before (no token
changed): `--text-mute` on `--bg-app` 4.21 and 4.40 in Folio and Quarry light,
which is why nothing in the rail uses it now.

**Not reached by automation.** VoiceOver on the rail, the page titles, the
alertdialog and the selects' descriptions; WebView2's arrow keys on a closed
select, and the 400 ms announcement there; a real LM Studio or llama-server
round trip. `TODO.md`, "Settings, regrouped: the checks no automation
reaches, and what it left", lists them with what else the build found.

**After review.** Three verifiers read the build and found 26 things; each was
confirmed before it was acted on (`tests/scratch/verify-settings/` holds their
two reproductions, which failed before and pass now). Fixed, each with a test:

| Finding | Before | After |
|---|---|---|
| A refresh that started before a task change | A download's closing refresh (or any `models_view` asked before a change, which waits up to 2 s on the saved server) put the old task back in the select while Rust held the new one; the same for "Show uncensored models" | `ModelsStore` counts changes as they start and land; a view asked for before one keeps the slots and censorship on screen (`fetchView`) |
| A check still running when the dialog closed | Its findings landed in the next dialog, over another novel | `ContinuityRunner.reset` drops the answer of a check started before it |
| Previews logged before this build | A write previewed without `confirm` was logged `ok` and Activity read every such line as Done | Each log line carries its format (`mcp::log::FORMAT` = 2); an `ok` write without it reads "Done, or only a preview: logged before Versorium told them apart" and is listed under Done and under Previews |
| The server saved at a new address | Tasks assigned to it followed it to another computer unasked | Saved at another computer's address it releases its tasks, and a notice says which (a new port or `localhost` keeps them) |
| Forget | Wrote the address typed in the field, saved or not | Forgets what was saved |
| Continuity's copy with a server elsewhere | "Continuity runs only on a model on this computer" next to "Runs on the server at 192.168.1.20" | "Continuity runs only on one of your models", in Tasks, its optgroup and Assistants |
| A remote server's model in Your models | "On the local server" | "On the server at {address}" |
| The Spanish of the D6 sentence | "Puedes revertirla" (the snapshot) and "La escritura" | "Permitir la escritura… Puedes volver atrás." (PROMPT §7 note updated) |
| A finding's chapter | The id, "ch-02" | Its title, the id only for a chapter the novel does not have |
| The Manuscript dialog | Read the models, asking Ollama and the saved server, on every opening, Export included; never let the download poller go | Reads them when the Continuity tab is first shown; Settings and the tab share `ModelsStore.open`/`close`, which stops the poller once neither shows it |
| The Continuity link in WebKit | A click does not focus a button there, so Escape left focus nowhere | The link takes focus before it opens the dialog; Playwright's WebKit returns to it |
| A refused grant | Said twice, at the top of Access and in the row, both `role="alert"` | Said once, in the row (`McpStore.takeError`) |
| "Use for Rewrite and Continuity" on Models | Once both tasks had the model the button went, and focus fell to `<body>` | Focus goes to the "Used by Rewrite and Continuity" line that took its place |
| A cancelled download | Rust ends it with `cancelled`, which the page showed as an error alert; the mock resolved instead, which hid it | Not an error; the mock rejects as Rust does, and the paused model's Resume takes focus |
| Spanish Result filter | "Todo / Hecho / Rechazado / Falló" | "Todas / Hechas / Rechazadas / Fallidas" |

The test gaps they found are closed too: the command bodies are now tested
with a store of their own (`rewrite_in`, `check_in`, `set_slot_cmd`,
`view_in`), so a command that stops passing the saved server fails `cargo
test`; the fake server answers a chosen HTTP status, so a 500 listing is
`server_offline`, a failed completion `ai_failed` and an empty one `ai_empty`;
the mock's Ollama pull and remove behave as Rust's (a pull lists the tag, a
remove releases the tasks on it), its unknown built-in id is `not_found`,
`studio_test` asks the saved address and a busy engine is checked first; and
specs that change the mock right after navigating wait for it
(`tests/e2e/mock-page.ts`): on a cold Vite that race failed one or two of
m3's eleven tests per run, as the verifiers measured. Three cold runs of the six touched specs on a fresh Vite
(`tests/scratch/settings-redesign-fix/vite.cold.config.ts`): 92 passed, 91
passed with one browser that closed mid-test (not the race), 92 passed.

Not done, and why: the Continuity link with no model chosen (the spec draws
it there; `TODO.md`), Activity's technical line in English (the spec asks for
it as logged; `TODO.md`), and three things older than this build and outside
it, recorded in `TODO.md`: author profiles that the desktop app never saves
(`apply_patch` has no arm for them), contrast under AA in the Author profile
button and the status bar, and onboarding's "this machine".

**Measured, after review.** `make verify` on the final tree: svelte-check 0 errors
and 0 warnings over 420 files; locale parity 908 keys per language (904
before review: four added); vitest 42 files, 336 tests (40 and 313);
`cargo test` 639 unit and 4 integration, 16 ignored (628); clippy
`--all-targets -D warnings` clean; Playwright 300 passed (280). Each mechanism
this round added or tested was broken once on purpose
(`tests/scratch/settings-redesign-fix/mutate_all.py`, log beside it): 75
mutations, every one the verifiers listed among them (R1–R6, R11; X1–X11,
X14–X16; Y1–Y6, Y8, Y9, Y11, Y15–Y18, Y21, Y22, Y24; O1, O2; T2, T3; Z1, Z4,
Z7; N1; W1, W2, W4; C1–C3; E1, E2), and all are caught. Of the first 74, three
were not caught the first time, and their tests were made to catch them:
hiding uncensored models while a stale view lands in the middle of the save
(the test let it land after); a refused grant left out of its row (the test
found the page's own alert instead, which is how the duplicate was found; the
75th mutation brings the duplicate back); and `navigate()` not scrolling to
the top (the test went to a page too short to scroll). In Playwright's WebKit,
outside the gate (`settings-tasks`, `settings-nav`, `m3-mcp`, `m4-models`,
`m2-rewrite`, `m7-polish`): 91 of 92 pass; the one that fails is "every page
is reachable with Tab", for the reason in `TODO.md`.

## Settings › About, and platform names on release assets (2026-10-04, on `feat/landing-and-docs`)

The content of v0.1.1, as the owner asked for it on 2026-10-04. The version
is not bumped and nothing was tagged or published: the owner's release step
does both.

**About / Acerca de.** A new page in Settings' footer, after Application:
- **Versorium**, its tagline, and the installed version as the running app
  reports it (`app_info`, Cargo's version, which the top bar already showed),
  not the updater's record of it. In the browser preview, which has no app, a
  dash.
- **Made by** Miguel Angel Esparza Calero (→ `https://www.maecly.com/about`),
  **Website** `www.maecly.com`, **Source code** `github.com/MAECLY/versorium-app`.
- **License**: open source under the GNU AGPL-3.0, with "Read the license on
  GitHub" (`…/blob/main/LICENSE`); contributions under the CLA, with "Read the
  CLA on GitHub" (`…/blob/main/CLA.md`). Both files are on `main`.
- **Where updates come from**: only the releases of that repository, each
  checked against Versorium's signing key and against the published checksums
  before it is installed (what `src-tauri/src/update/mod.rs` does); "See the
  releases on GitHub"; and "Check for updates in Application ›", which goes to
  Application with focus on Check now (a new target, `{ page: "app", focus:
  "updates" }`). The updater is not duplicated. This section is shown in the
  desktop app only, as the updater is.

Names and addresses are data (`src/lib/about.ts`); a unit test holds
`REPOSITORY` to the updater's compiled-in `UPDATE_OWNER`/`UPDATE_REPO`. The
words are 17 new keys per language (925 each, 908 before).

**The first links that leave the app.** `src/` had no `<a href>` until now.
`ExternalLink.svelte` is one: it opens through `openExternal`
(`src/lib/external.ts`), which hands an https address to the opener plugin
(`openUrl`; as first built, the capability granted `open-url` with no scope,
which the plugin reads as "open nothing": see "After review" below),
opens a tab with `noopener,noreferrer` in the browser preview, and refuses
any other scheme before either. Every way a webview follows a link by itself
is cancelled: a click (with Ctrl, ⌘ or Shift, and Enter, included), the middle
button (which opens the browser instead) and a drag. A link's name is its
words and then a hidden "(opens in your browser)"; the author's name says
"(opens www.maecly.com/about in your browser)". No icon: the redesign allows
only `›`, `▸`/`▾` and `←`. When the opener refuses, the link's own section
says "Your browser could not be opened. The address is:" with the address,
selectable, and the next link that opens takes the line away. Two app-wide
rules had to learn about links:
- the focus ring (`styles.css`) covered inputs, selects, textareas and
  buttons; it covers `a[href]` too;
- the right-click policy counts `a[href]` as a control (`NOT_TEXT` in
  `src/lib/contextmenu/policy.ts`), so a right-click on a selected link never
  gets the engine's menu, whose Open Link would load the page in Versorium's
  own window.

**Release asset names.** Each build in `.github/workflows/release.yml` now
has an `assetPattern`, which the tag build passes to tauri-action as
`releaseAssetNamePattern`: `[name]_[version]_apple_silicon[ext]`,
`…_apple_intel[ext]`, `…_windows_x64[ext]` and `…_linux_ubuntu_amd64[ext]`
(quoted: an unquoted `[name]…` is a YAML list). What tauri-action does with
them was read in its source at `action-v1.0.0` (commit `1deb371`), not
assumed:
- `src/utils.ts` `renderNamePattern` replaces `[key]` with the artifact's
  field of that name: `[name]` is `productName`, `[version]` is
  `tauri.conf.json`'s version.
- `[ext]` is the first entry of the action's extension list that the file name
  contains, so `.app.tar.gz.sig`, `.msi.sig` and `.exe.sig` stay whole, while
  the `-setup` and `_en-US` of tauri's own names drop out. The `.app`
  directory is never uploaded (`src/index.ts`).
- With a pattern, every file takes it except `latest.json`. GitHub keeps
  these names as given, so name and label agree.
- `src/upload-version-json.ts` pairs each `.sig` with the file named like it
  less `.sig`, and takes the platform keys from the target, not from the name.
- A clash between builds is silent: `src/upload-release-assets.ts` deletes an
  asset of the same name before it uploads. Within one build GitHub refuses
  the second file and the job fails.

The sixteen files are
`Versorium_<version>_apple_silicon.{dmg,app.tar.gz,app.tar.gz.sig}`, the same
for `apple_intel`, `…_windows_x64.{exe,exe.sig,msi,msi.sig}` and
`…_linux_ubuntu_amd64.{deb,deb.sig,rpm,rpm.sig,AppImage,AppImage.sig}`, and
`latest.json`'s eleven keys point at the `.app.tar.gz` (both darwin keys and
their `-app`), the `.msi` (`windows-x86_64` and `-msi`), the `.exe` (`-nsis`),
the `.AppImage` (`linux-x86_64` and `-appimage`), the `.deb` and the `.rpm`.
`finalise` matches `latest.json` against the release's own listing by id or
by name, so its logic did not change; its comment says so. The app reads an
update by asset id and its checksum line by that asset's name, so neither
cares about the scheme. `actionlint` on the workflow reports one finding,
SC2035 (info) on `sha256sum *`, which it reports on the file before this
change too. `RELEASING.md` §5 and §7 list the names, the `latest.json` keys,
v0.1.0's older names, the landing's links that name files, and what makes two
names clash.

**Where the redesign spec was overridden or stale.** The spec
(`~/Documents/Github/.versorium-design/versorium-settings-redesign/SPEC.md`,
outside the repo, so not edited) fixes the rail at ten pages and says new
features never add rail items (§0.1, §2.1). About is the owner's explicit
request and sits in the footer, outside the categories, with Application,
the other page about Versorium itself: the rail is eleven pages. The rule for
features is unchanged. §2.3 estimated the rail at 537 px and checked it only
at 1280×800. Measured in Chrome, it is 584 px with eleven pages (about 553 px
with ten, from the same measurements). The shortest window
(`tauri.conf.json`'s 1024×640) leaves it 560 px under the two bars, so the
rail scrolled there and cut "← Back to the manuscript" in half. Below 680 px
of window height the rail's rhythm is now a little tighter: the labels' top
margin goes from 14 to 10 px, the gaps between pages from 2 to 1 px, the
rule's margins from 10 to 8 px and the Back button's from 14 to 10 px. It fits
then (about 555 px). Taller windows keep the spec's spacing. §6.1 had no focus
target on Application; it has one now. §3's glyph list never considered a
link that leaves the app, so those links carry no glyph and say it in their
accessible name. §8 relied on a focus ring that did not cover links. §10.3's
"Application in the footer" is "Application, then About".

**Tests.** Vitest: `release-assets.test.ts` (new, 11 tests: a port of
tauri-action's naming, extension, signature-pairing and priority rules,
checked first against the published v0.1.0, whose sixteen names and
`latest.json` it reproduces exactly; then the patterns as the workflow
writes them, all sixteen new names, no clash with each other or with
`latest.json` and `SHA256SUMS`, the `latest.json` keys, a pre-release
version, one WiX language, the pinned action version, and the `finalise`
Python itself, run with `python3` on new-name inputs: API URLs accepted,
browser URLs rewritten to API ids, an old name or a foreign id refused with
`::error::`), `about-group.render.test.ts` (new, 9), `external.test.ts`
(new, 4), `settings-pages.test.ts` (the footer and the new target),
`settings-keys.test.ts` (scans `ExternalLink.svelte` too) and
`policy.test.ts` (a selected link is not text). Playwright:
`settings-about.spec.ts` (new, 8 tests: the page in English and Spanish, the
version the mock's `app_info` reports, `0.1.0-mock`, which the updater's
`0.1.0` is not; every link's address and accessible name; every link, the
middle button, ⌘/Ctrl and Shift through `plugin:opener|open_url` with the
window still on Versorium and no second page; the Tab order, the focus ring
and Enter; landing on Check now; the failure line; and a right-click on a
selected link) and `settings-nav.spec.ts` (eleven pages, End reaches About,
the Spanish rail, the whole rail inside the shortest window, and About's
muted words, links and failure line at AA in all six themes).

**Each mechanism broken once.** Two scratch scripts, logs beside them:
- `tests/scratch/about-release/mutate-release.mjs` mutates copies of
  `release.yml` and `tauri.conf.json`, never the tree. All 11 mutations were
  caught: the input removed, Intel given Apple silicon's pattern, a pattern
  unquoted, one without `[ext]`, Windows keeping `[setup]`, the action bumped
  past the version the port was read from, `finalise` no longer rewriting by
  name, no longer refusing a missing name, or no longer checking an id, two
  WiX languages, and the v1 updater archives.
- `tests/scratch/about-release/mutate-about.py` mutates in place and restores
  each file byte for byte. Of its first 25 mutations, 24 were caught the
  first time; the 26th, added with the short-window rhythm, was caught when
  it was added. They are: a click not cancelled; nothing opened; the middle
  button ignored; the right button's release opening the link; the hidden
  name gone; the place never named; a draggable link; any scheme opened; a
  new tab that keeps its opener; the updater's version shown instead of the
  app's; a failure swallowed or never cleared; the shortcut landing on
  Application's title; Check now unmarked; `focusKey` ignoring Application;
  About missing from the rail or showing Application's page; no focus ring on
  links; links as text to the right-click policy; a changed address; a
  repository that no longer matches the updater's; Spanish names in English;
  the updates section or the `app_info` call outside the app; the Spanish page
  name missing; and the short-window rhythm gone (584 px in 560).
- The one that was not, a link opening on the right button's release, got
  past a unit test that looked one microtask after the release, while the
  opener waits on a dynamic import. That test now waits for a later middle
  press to land first, and the E2E right-click test checks that the opener
  heard nothing. Both catch it now (`mutate-about-rerun.log`, with the middle
  button and the policy mutations run again against the stronger tests).

**Measured.** `make verify` on the finished tree exits 0:
- svelte-check: 0 errors and 0 warnings over 424 files (420 before);
- locale parity: 925 keys per language (908);
- vitest: 45 files, 362 tests (42 and 336);
- `cargo test`: 641 unit and 4 integration, 16 ignored (Rust is unchanged);
- clippy `--all-targets -D warnings`: clean;
- Playwright: 309 passed (300).

The baseline run before the build had 299 Playwright tests passing and one
(`notices.spec.ts`, "a notice never sits on the line being written") failing
with "Test timeout of 30000ms exceeded while setting up "page"", which is not
the test's own code. It passed in the final run. The new test files also
type-check under a scratch `tsconfig` (`tests/scratch/about-release/`); the
project's own `tsconfig` does not include `tests/`. The page was looked at in
Chrome on `?mock=tauri&seed=1` (`tests/scratch/about-release/about-look.mjs`):
English and Spanish, Folio light, Quarry dark and Needle light and dark, at
1280×800 and 1024×640, with a link focused and with the failure line.

**Not reached by automation**, listed in `TODO.md` ("Settings › About and the
release names: the checks no automation reaches"): the links in WKWebView,
WebView2 and WebKitGTK; screen readers on the links' names; and the first tag
build with the new names, an update from v0.1.0 to v0.1.1 included.

### After review (2026-10-04)

**No link opened in the real app.** `opener:allow-open-url` "enables the
open_url command without any pre-configured scope" (tauri-plugin-opener
2.6.0), and the plugin's `open_url` opens only what its scope allows:
`Scope::is_url_allowed` is `allowed.iter().any(..)`, false for an empty list.
Nothing else in the capability or in `tauri.conf.json` gave it a scope. So
every About link was refused with "Not allowed to open url …", and so was a
crash report's Report button, which shipped like that in v0.1.0. Seen in the
real window before the fix (`tauri dev` on this Mac, Ajustes › Acerca de, the
repository link pressed through macOS accessibility): the page said "No se
pudo abrir el navegador. La dirección es:
https://github.com/MAECLY/versorium-app" and Chrome got no tab
(`tests/scratch/about-release/real-app-before.log`). The capability now
grants the command with an https scope, the rule `openExternal` already
applies in the page:
`{ "identifier": "opener:allow-open-url", "allow": [{ "url": "https://*" }] }`.
`opener:default` was not taken: it also opens `http:`, `mailto:` and `tel:`.
The build regenerated `src-tauri/gen/schemas/capabilities.json`. After the
fix the same press opened the repository in Chrome. Chrome's history has the
visit at 16:46:27, its selected tab is `github.com/MAECLY/versorium-app`, and
the page shows no failure line (`real-app-after.log`). In that window, with
macOS keyboard navigation off, Tab went from About's title through the six
links in page order, then to "Busca actualizaciones en Aplicación ›" and the
status bar's "EN"; Option-Tab went to the page itself and stayed there
(`real-app-tab.log`).

**Why no test saw it.** The in-browser mock answered every `plugin:*`
command, and the tests checked that `plugin:opener|open_url` was called, not
that anything opened. Two layers now hold the capability:
- `src-tauri/tests/opener_scope.rs` (new, 3 tests) builds the app's own
  context (`generate_context!(test = true)`: the capabilities resolved
  against the plugins' ACL manifests, as the shipped binary is built) on
  Tauri's mock runtime and asks `plugin:opener|open_url` from the main window,
  through Tauri's IPC authorisation and scope lookup. A stand-in plugin named
  `opener` does what the real command does short of opening anything: the
  command and global scopes, a deny before any allow, the same glob type, and
  the same words for a refusal. About's six addresses and a crash report's
  `issues/new?…` are allowed. `http`, `file`, `mailto`, `tel`, `javascript`,
  `data`, `ftp`, `smb`, `x-apple.systempreferences` and a named program are
  refused. The real plugin, under the same context, refuses in the same
  words. It is asked only what would start nothing if it were wrongly let
  through: a file and a program that do not exist.
- The mock's opener (`tests/e2e/opener-acl.ts`, used by `mock-tauri.ts`)
  resolves `src-tauri/capabilities/*.json` against
  `src-tauri/gen/schemas/acl-manifests.json` the way tauri-utils does. That
  covers permissions, sets and `default`; inline and permission scopes; the
  plugin's global scope; the window; a denial from any capability; and
  `tauri.conf.json`'s list of capabilities. It then checks the address the
  way the plugin does. A refused address never reaches
  `__VERSORIUM_MOCK__.browser`, which the About tests read now instead of
  the IPC call. `tests/unit/opener-acl.test.ts` (new, 9 tests) pins each rule
  and the shipped capability.

The Rust test's first version had a defect, which its own mutation run
found. `#[tauri::command]` names a command's plugin after its crate
(`tauri-plugin-*`), so in this crate the stand-in's `GlobalScope` read the
app's global scope, not the opener's. Under `opener:default` it refused https,
which the plugin allows. It also let the real plugin be asked
`http://www.maecly.com`, which Chrome opened twice (16:57:59 in the mutation
run, 17:04:22 reproducing it). The stand-in now reads the plugin's global
scope (`OpenerGlobalScope`), and the real plugin is only asked addresses
that start nothing.

**The other findings.** The failure line is now tested for each of the six
links, in that link's own section (unit, and E2E in English and Spanish).
Before, only License's was tested. The three section titles are checked as
level-3 headings under the page's level-2 title, in both languages. When
`app_info` refuses, the version shows "—" and the refusal is handled; vitest
fails a run on an unhandled rejection. `releaseAssetNamePattern` is checked as
an input directly under the step's `with:`, not in an `env:` block or in
another input's text. Recorded in `TODO.md` and not changed:
- `finalise` does not check that all four platforms are in `latest.json`;
- "ubuntu" is on the AppImage too, not just the rpm;
- an About address cannot be copied unless the browser fails first;
- the tests of this build are untracked until the feature's commit.

**Each mechanism broken once.** `tests/scratch/about-release/mutate-opener.py`
caught 17 of 17 (`mutate-opener.log`):
- the capability with no scope, with the plugin's default set, or without
  the command;
- the mock's opener ignoring the scope, or never reaching the browser;
- the resolver dropping the global scope, a deny, the window check, an
  inline scope or the program, counting a denial for its window only, or
  granting regardless;
- the releases link's or the card's failure line removed;
- License's or the updates title not a heading;
- `app_info`'s refusal unhandled.

Run again against the final Rust test, the no-scope and no-command
capabilities are caught, and the default set fails at the stand-in, not at
the plugin (`mutate-opener-r2.log`). `mutate-release.mjs` has two more
mutations: the pattern in an `env:` block, and the pattern only in the
release body's text. It caught 13 of 13 (`mutate-release-r2.log`).

**Measured.** `make verify` exits 0 (2 min 1 s):
- svelte-check: 0 errors and 0 warnings over 426 files;
- locale parity: 925 keys per language;
- vitest: 46 files, 372 tests;
- `cargo test`: 643 unit, 4 `mcp_stdio` and 3 `opener_scope`, 16 ignored.
  The 2 new unit tests are ae509c6's (Codex), committed meanwhile by another
  session;
- clippy `--all-targets -D warnings`: clean;
- Playwright: 311 passed.

The run before it failed one Playwright test of 311, `chrome.spec.ts` "a
chapter made with the peek's + opens", in setup: "browser.newContext:
Target page, context or browser has been closed". It passed alone (29 of 29
in that file) and in the run above.

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
  still refused as empty, title page or not. The EPUB title page first
  carried `role="doc-tithead"`, which epubcheck rejects (`RSC-005`); fixed, and
  the default export passes epubcheck again (see `FORMATS.md`).
- **Author metadata**, with a work profile and a personal one; see "Author
  metadata" below.

### Binder, project and home screen

- **Rename, restatus and delete** novels and chapters. A deleted chapter is
  snapshotted into the project's git history first; a deleted novel goes to the
  system trash, and `delete_project` refuses any folder that is not a
  Versorium project. Renaming a novel changes `versorium.json` only, never the
  folder.
- **Reorder** through `chapterOrder`, Move earlier / Move later in the chapter
  menu (Move up / Move down until the right-click work renamed them, so the
  binder and the corkboard say the same thing); no file is renamed. See
  "Chapter order is data" below.
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
- **The right-click policy is unchecked on the real webviews' release
  builds**: a real Ctrl+click on macOS, the reload keys and the Menu key on
  WebView2, disabled buttons on WebKitGTK (see "Right-click" above).
- **Spelling is not checked on Linux**, and on macOS it is shown on a plain
  WKWebView, not yet on a release build (see "Settings → Editor" above).
- **The undo key with focus off the page undoes the page's typing**,
  outside CodeMirror's history; and the corkboard still rebuilds the editor,
  losing its undo history as Settings used to.
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

- [x] Export **Markdown** (canonical, lossless round trip), **DOCX** in standard manuscript format, **EPUB 3** (passed epubcheck 5.2.1 with zero errors and zero warnings at M5; PR #9's title page broke it with `RSC-005`; fixed, and on 2026-10-03 the default export passed with 0 errors and 0 warnings again — see `FORMATS.md`) and **PDF** (base-14 Times-Roman, nothing embedded, chapter per page, running heads)
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

## Six short fixes from the to-do list (2026-10-06)

- **The credential store's errors have words.** `keyring_unavailable`,
  `keyring_locked` and `keyring_failed` showed the raw key or "Something went
  wrong."; they now say what happened, in English and Spanish, and
  `settings-keys.test.ts` lists no key as known missing.
- **About links the third-party notices** (`THIRD-PARTY-NOTICES.md`, bundled
  with the app), as its seventh link.
- **The crash report's Open an issue** goes through `openExternal` (https only)
  instead of its own copy of the opener, and a browser that does not open is
  said on the report's card with the address.
- **Creating a branch and restoring a file take the history lock**, like every
  commit, so neither writes while a backup captures; `repo_busy` now names a
  backup, bringing changes from GitHub or an assistant's change as the holder.
- **`STATUS.md`, `RELEASING.md` and "Going public"** describe the two releases
  and the proven update instead of "no release exists". All seven of v0.1.1's
  update signatures carry `version:0.1.1`, recorded for the
  `requireSignedVersion` decision.
- **`actionlint` is clean:** `sha256sum -- *` in `release.yml` (SC2035); the
  names in `SHA256SUMS` stay bare, as the app's lookup needs.

## Nine more short fixes (2026-10-06)

- **Ollama's answers lose their reasoning block** (`<think>…</think>`), as the
  built-in engine's and the local server's do, before Rewrite or Continuity
  reads them.
- **The welcome guide speaks like Settings:** "this computer", "assistants",
  "the change", in English and Spanish.
- **"← Back to writing" / "← Volver a escribir"** replaces "Back to the
  manuscript", which shared its word with the top bar's Manuscript dialog.
- **The page is one textbox, named "Chapter text" / "Texto del capítulo"**
  on CodeMirror's editable area, following the interface's language; the
  wrapper is no longer a second textbox named "Chapters".
- **The closing page's preview shows the profile's publisher and rights**, as
  the export writes them.
- **The page is set only in a body face:** `set_editor_font` refuses the
  chrome's and the counters' faces, and a stored one reads as the default.
- **Test connection asks the local server the way Save does**
  (`agents::server_status`), so `::1` can be tested and the two cannot
  disagree.
- **Escape closes Settings**, after an open menu and before a peek and Focus.
- **"Focus is not restored at launch"** waits for the mock (`gotoMock`).

## Eight more short fixes (2026-10-06)

- **"Nothing to restore here."** answers the Restore button (the Spanish
  already said "restaurar").
- **The status bar's Save snapshot says "Snapshot saved."** for five seconds,
  under the id that also takes a previous failure's place.
- **Settings leaves room for the notices stack** below its last field, as the
  manuscript does, so an error raised there no longer covers the foot of the
  form.
- **"in use" on the pressed Author profile button** takes the button's own
  colour (it was 1.05 to 1.45:1).
- **Typography names the system faces in the writer's language** ("Serif del
  sistema · del sistema"); Source Serif 4 and OFL-1.1 stay.
- **One language list, in one order,** for New project, the welcome guide,
  Project settings and the import (`Select` with `languageOptions`).
- **One mistyped key no longer resets every setting:** `settings.json` is
  read key by key, and a bad value keeps its default alone.
- **`--text-mute` holds AA in every theme:** Folio light `#696155` and Quarry
  light `#676561` (4.61:1 and 4.66:1 at worst), in the app and the landing;
  `text-mute-contrast.test.ts` holds all six themes to it.
