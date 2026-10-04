# TODO

Unfinished work that someone is expected to pick up next, and where it is in
the code. Not a roadmap, and not the complete list of gaps. Finished work goes
in `STATUS.md`.

Everything the spec or the design asks for that the app does not do is
recorded, with a code reference per item, in two other places:

- `PROMPT-VERSORIUM.md`, "Implementation notes (2026-10-03)": among others, no
  command palette, no BYOK, no CLI subcommands besides `versorium mcp`
  (`new`, `open`, `status`, `commit`, `rollback`, `export`, `update` do not
  exist), no split/merge of scenes, no Fetch button, no ICU MessageFormat or
  Hunspell, no 12-hour update check (one check at start-up).
- `DESIGN-VERSORIUM.md`, "Implementation notes (2026-10-03)": among others, no
  downloadable font catalogue, no density setting, no editor theme separate
  from the panel theme, no AI spans in the editor.

Those items are not repeated here. This file covers the half-done work and the
spec items that already have a slot or a surface in the app.

## Half-done

### Form controls still hand-written

The shared primitives exist in `src/lib/components/forms/` — `Field`,
`TextField`, `NumberField`, `Select`, `Checkbox`. So far they are used in
`AuthorSection.svelte`, `ProjectSettingsDialog.svelte`, the backup retention
count in `BackupGroup.svelte` and the per-slot model picker in
`LocalAiSection.svelte`.

The stylesheet (`src/styles.css`) already fixes how every native control
*looks*, component or not: accent colour on checkboxes and radios, no
text-field padding on checkboxes, `color-scheme` per theme. The chevron needs
the `.v-select` wrapper, and every hand-written `<select>` already has one.
What the remaining call sites still lack is the wiring: the hint as
`aria-describedby` instead of inside the `<label>` or in an unconnected `<p>`,
and a status readout outside the accessible name. Two checkboxes carry their
status inside the `<label>`, so it becomes part of the name: the censorship
checkbox in `LocalAiGroup.svelte` reads "Censorship — On" / "Censorship —
Off", and the MCP write checkbox in `AssistantsGroup.svelte` reads "Allow
write — write" / "Allow write — Read-only".

Still hand-written, 25 control tags in 14 files:

| File | Controls |
|---|---|
| `src/lib/settings/LocalAiSection.svelte` | 5 |
| `src/lib/components/ManuscriptDialog.svelte` | 3 |
| `src/lib/settings/groups/AssistantsGroup.svelte` | 2 |
| `src/lib/settings/UpdatesSection.svelte` | 2 |
| `src/lib/onboarding/Onboarding.svelte` | 2 |
| `src/lib/components/GitPanel.svelte` | 2 |
| `src/lib/binder/NewProjectDialog.svelte` | 2 |
| `src/lib/settings/groups/LocalAiGroup.svelte` | 1 |
| `src/lib/settings/groups/BackupGroup.svelte` | 1 |
| `src/lib/settings/groups/AppearanceGroup.svelte` | 1 |
| `src/lib/settings/groups/AppGroup.svelte` | 1 |
| `src/lib/components/RewriteDialog.svelte` | 1 |
| `src/lib/binder/RenameDialog.svelte` | 1 |
| `src/lib/binder/NewChapterDialog.svelte` | 1 |

These are tags in the source. The export-format radio in `ManuscriptDialog`
is one tag rendered once per format. Recount with:

```
grep -ro '<select\|<input\|<textarea' src/lib src/App.svelte | grep -v components/forms/ | cut -d: -f1 | sort | uniq -c | sort -rn
```

The local-server port was one of them, and had a live bug: a bare
`<input type="number" bind:value>`, which Svelte binds as `null` when emptied,
feeding `studio_test` / `studio_save` that take `port: u16`. It now uses
`NumberField`, pinned by `tests/e2e/forms.spec.ts`. The table above counts
25 tags after that change, not 26.

Two things to keep while migrating, both caught in review:

- `Checkbox` is strictly controlled on purpose. A call site that wants two-way
  binding writes `checked={x} onChange={(v) => (x = v)}`. Do not make it
  `$bindable` again: an unbound bindable keeps the child's write, so a
  permission the backend refused still shows as granted.
- Specs find these controls with `getByLabel`, `getByRole('checkbox')` and
  `getByRole('combobox')` (for example `tests/e2e/forms.spec.ts`,
  `m3-mcp.spec.ts`, `m4-models.spec.ts`). A migration that changes an
  accessible name breaks them — which is the point; read the failure before
  "fixing" the spec.

### `RadioCardGroup` is named, not designed or written

The export-format picker in `ManuscriptDialog.svelte` is a radio group inside a
real `<fieldset>`/`<legend>`, but each format's explanatory sentence sits
inside its `<label>`, so the whole sentence is the radio's accessible name.

Commit `0ccb279` names `RadioCardGroup` among the components the form audit
designed. Neither a design nor a file for it is in the repository, so it is
named, not designed or written. A proposal, not taken from any document in the
repo: keep the `<fieldset>`/`<legend>` and a real `<input type="radio">` per
option, and move the blurb to `aria-describedby`. If its focus ring uses
`:has()`, wrap that in `@supports selector(:has(*))` so the native outline
survives where `:has()` does not.

### Spelling on Linux, and on the release builds

Settings → Editor checks spelling as you type (see "Settings → Editor" in
`STATUS.md`), and the manuscript says so with `spellcheck="true"`. Whether a
word gets underlined is the webview's decision:

- **WebKitGTK underlines nothing yet.** It checks only after
  `WebContext::set_spell_checking_enabled(true)` and a language list from
  `set_spell_checking_languages`, reached through `with_webview` and the
  `webkit2gtk` crate as a Linux-only dependency. Not written, because on a Mac
  it can neither be compiled nor seen, and CI would only compile it. Until
  then the switch's hint says so on Linux instead of promising underlines;
  wiring it means deleting `spellingUnderlines` in
  `src/lib/editor/preferences.ts`, the `hintLinux` key and the spec in
  `tests/e2e/editor-settings.spec.ts` that pins Linux.
- **macOS is shown in a WKWebView, not in a release build.**
  `src-tauri/src/spelling.rs` registers the default WebKit reads
  (`WebContinuousSpellCheckingEnabled`);
  `tests/scratch/wkwebview-manuscript-spellcheck-probe.swift` runs the app's
  own page on the mock in a WKWebView and types into the manuscript: no
  underlines without the default, underlines with it. Still to see in
  `make bundle`'s app: a misspelling underlined, the guesses on right-click,
  and "Check Spelling While Typing" ticked under Spelling and Grammar in that
  menu.
- **WebView2 is unverified**: that spelling is on without being asked, and
  that `autocorrect="off"` (Edge 153 and later) keeps Windows from replacing
  words.

### A novel's language is fixed at creation, and imports are English

The manuscript's `lang` comes from `versorium.json`, and so do EPUB's
`dc:language` and `xml:lang`, DOCX's style language and the colophon. Two gaps
make that value wrong more often than it should be:

- `import_apply` (`src-tauri/src/commands/formats.rs`) creates every imported
  project with `language: "en"`, even from a Markdown file whose frontmatter
  says `language: es`, so an imported Spanish novel is declared English
  everywhere.
- Nothing can change it afterwards: `update_project` takes no language, and
  Project settings only shows it.

The importer should take the language (the Markdown frontmatter carries one;
the import dialog could ask), and Project settings needs a language picker.

### A visit to Settings rebuilds the editor

`App.svelte` swaps the editor for `SettingsPage` (`{#if showSettings}`), so
opening Settings destroys the CodeMirror view: the undo history, the selection
and the session that Restore works from are gone on the way back. The editor's
preferences themselves reconfigure a running editor in place
(`createPreferenceCompartments` in `src/lib/editor/preferences.ts`), but no
preference can change while the editor is on screen, so the visit is what
costs the history. Settings as an overlay, or the editor kept mounted beneath
it, would keep it.

### The typeface chosen in Settings never reaches the editor

Settings → Editor → Typography stores a face (`set_editor_font`), and the
group's purpose line names the typeface because that choice lives there. But
nothing applies it: `.cm-editor .cm-content` in `src/styles.css` names its own
fixed stack, and `api.editorFont()` is called only by
`TypographySection.svelte`. That section also compares the CSS stack
`editor_font` returns with a catalogue id, so going by the code its "selected"
mark never matches (DESIGN-VERSORIUM.md, implementation notes). The face could
reach the page the way size and spacing do, as a custom property on
`.cm-editor`, without rebuilding the editor.

## Queued, designed or under review

### Settings: redesign Local AI and Assistants, and group the sidebar

Requested on 2026-10-04. Local AI and Assistants are hard to understand: too
much on one page, different kinds of thing mixed together. Study both as they
are, research how comparable apps present model management and connected
tools, and redesign them — possibly split into more pages, or a second or
third level in the Settings sidebar. The sidebar itself should be grouped into
categories so each page's purpose is clear; today all seven groups sit at one
level. Research and design first. The collapsible binder/top bar work it
waited on is in (2026-10-04); it touched `SettingsPage.svelte` only to drop
the old Focus fade from the rail.

### Choose when the backup runs

Requested on 2026-10-04: the zip backup runs only when the writer presses Back
up now; the writer should be able to pick when it runs on its own. Specified on
2026-10-04 in three phases (the spec sits outside the repo, at
`/tmp/versorium-backup-schedule/SPEC.md`; copy it in before /tmp is cleared).

- **Phase 0 is done** (STATUS.md, "Backup Phase 0"), the repository lock
  included. Open for the owner: a second Back up now queues behind the first
  and makes its own run, after its own save; the spec's Phase 1 has it join
  the first, whose plan predates that save. Phase 1's scheduler has to pick
  one. A pull locks the history for its local half only, not for the fetch.
- **Found in Phase 0's review, for Phase 1:** the id that tells this
  computer's temporary files from another's lives in the app's folder, so a
  Mac set up with Migration Assistant shares it with the old one (one failed
  run at worst, when both write one novel into one synced folder at once); an
  id tied to the machine, or a stored fingerprint of it, would end that. And
  a sync client's conflict copies (`… 2.zip`) are never listed: they could be
  shown read-only, for Restore.
- **Phase 1 is next:** a ledger of each novel's backups per destination, the
  runner on its own Rust thread (manual runs only), a lock against a second app
  instance, rows in Settings that survive leaving the page, a status-bar item,
  the destination marker, pack once then copy, the shrink, partial and
  source-gone guards, the weekly verify that never downloads an evicted file,
  the free-space guard, and fsync before the rename.
- **Phase 2 ships as one release:** the schedule together with the
  close-and-quit backups, retention spread over time, and the "Next:" lines.

The owner's answers (2026-10-04) replace the spec's options. "When to back up"
offers: only when I press Back up now; when I close the novel or quit (the
default for new setups, plus once a day while it stays open); when I switch
chapters (after the outgoing chapter is saved; a switch during a run marks it
due again rather than queueing a second); every N minutes while open (N = 1, 5,
10, 15, 20, 30, 40 or 50); every N hours while open (N = 1 to 4); once a day.
The interval is one select. A short interval writes nothing while the novel is
unchanged, waits for a pause in typing scaled to it (about 20 s at 5 minutes or
less), and skips a run rather than stacking one; the hint says frequent
backups to iCloud use upload bandwidth. Under close-or-quit, a checkbox
"Always back up before quitting, even right after a backup" replaces the
spec's small-change shortcut.

### Notifications have no module and never hide

There is no notification module. 21 files render their own notice or error
paragraph; `store.error` is written in 11 places; 17 elements carry
`role="alert"` and 15 `aria-live="polite"`; not one of them hides itself — there
is no timer anywhere. A hint is pushed through the error channel:
`App.svelte` sets `store.error = t("ai.selectFirst")` ("Select a passage
first."), which then renders as a warning box with a manual ✕.

Centralise the transient ones and leave the rest where they are:

- **Transient, auto-hide:** confirmations ("Saved.", "Backups are off.") and
  hints ("Select a passage first."). Pause the timer while the pointer or focus
  is on the message.
- **Persistent:** an error the writer has to read to resolve. Auto-hiding it
  fails WCAG 2.2.1 (timing) and loses the one message that matters.
- **Inline, not a toast:** anything tied to a place — per-destination backup
  outcomes, a field's validation error. Those are the record the writer reads
  where they are.

### Collapsible binder and top bar: the checks no automation reaches

Built on 2026-10-04 (see "Collapsible binder, top bar and Focus options" in
`STATUS.md`). Playwright drives it in Chrome on the mocked IPC
(`tests/e2e/chrome.spec.ts`); the real webviews are still to be checked by
hand:

- **macOS, WKWebView:** seen once, read-only, through accessibility while the
  dev app ran: the rail and the lip are buttons named "Mostrar proyectos y
  capítulos" / "Mostrar barra superior", collapsed, and nothing of the folded
  panel or bar is in the tree. Not yet pressed or keyed: that ⌃⌘S, ⌥⌘T and
  ⇧⌘F reach the page (no menu item takes them); that a click on the ⋯ still
  puts focus on the first item, so Escape stays in the menu; that the rail's
  words render bottom to top; that in Focus the faded rail and lip stay faded
  while the mouse moves and show only with the pointer on them; and, in full screen, that the lip
  just under the system menu bar can be clicked once that bar retracts.
  Keyboard navigation off (the macOS default): Tab skips every button in
  WebKit, so check that Option+Tab reaches the rail, the lip, both Hides and
  ⋯ (Focus options), and from ⋯ the two items, with ↓ and Space. Playwright's
  WebKit does all of it (`tests/scratch/fix-webkit-tab-probe.mjs` for the Tab
  order; `chrome.spec.ts` presses Option+Tab there). Also that a click on
  Hide, the rail or the lip while writing leaves the caret in the text:
  Playwright's WebKit passes `chrome.spec.ts` (`tests/scratch/pw-webkit.config.ts`),
  but WKWebView is the one that ships.
- **Windows, WebView2:** see the Windows list under Right-click below.
- **Linux, WebKitGTK:** Ctrl+Shift+S, T and F reach the page; `inert` is
  honoured (WebKitGTK 2.40 and later).

Deferred, by design: a native View menu carrying the same three commands.
It would mean translating the whole macOS menu bar, checking that an
accelerator does not fire twice, and a Rust surface the mock cannot exercise;
the in-window controls already reach every state on all three platforms.

### Right-click: the checks no automation reaches

The policy is built (`src/lib/contextmenu/policy.ts`; see "Right-click" in
`STATUS.md`). Playwright drives Chrome on the mocked IPC, and
`tests/scratch/context-menu-webkit-probe.mjs` drives Playwright's WebKit, but
neither is a release build of the real webviews. Still to do by hand:

- **macOS, WKWebView release build:** a real Ctrl+click and a two-finger click
  on a binder row and on Save snapshot; Tab and Option+Tab reaching rows, ⋯
  and cards with Full Keyboard Access off and on; VO-Shift-M on a card.
- **Windows, WebView2 release build:** F5, Ctrl+R and Ctrl+P do nothing; the
  Menu key and Shift+F10 on a row open the item menu exactly once; a
  right-click on a row still opens it (WebView2 sends contextmenu after
  mouseup, with the press already cancelled at pointerdown); selected text
  and fields still show their menu with spelling. If preventDefault does not
  stop F5 or Ctrl+R, the fallback is `with_webview` →
  `ICoreWebView2Settings3::SetAreBrowserAcceleratorKeysEnabled(false)`.
  Ctrl+Shift+S, Ctrl+Shift+T and Ctrl+Shift+F reach the page (they fold the
  binder and the top bar and toggle Focus) and start no Edge feature, Web
  Capture (Ctrl+Shift+S in Edge) included.
- **Linux, WebKitGTK:** a right-click on the disabled Creative button, and on a
  row while a chapter is loading, shows no page menu. If it does, give
  `.v-list-item:disabled` and `.v-corkcard:disabled` `pointer-events: none`, so
  the hit lands on the zone around them. A right-click on a checkbox and on
  its label leaves it as it was (WebKit toggles it on the release's
  `auxclick`, which the policy cancels; shown on macOS WebKit only).

### See what changed, the way a code editor shows it

Requested: let the writer see the differences between versions, the way VS
Code or Cursor show them. What exists today:

- The history panel's "diff" tab (`src/lib/components/GitPanel.svelte`) prints
  git's raw unified patch in a `<pre>`: `+` and `-` prefixes, no colour, no
  structure.
- It only compares the working tree with the last snapshot
  (`git::repo::diff` in `src-tauri/src/git/repo.rs`, HEAD tree to workdir).
  Two snapshots cannot be compared, nor an old one against today.
- `src/lib/ai/diff.ts` has a `lineDiff` used by the Rewrite dialog, coloured
  with the theme's `--diff-add` / `--diff-del` tokens.

The design question that matters most: a line diff is the wrong unit for
prose. In Markdown a whole paragraph is one line, so changing one word marks
the entire paragraph deleted and re-added. Code editors get away with line
diffs because code lines are short, and even they highlight the changed
characters inside a line. For a novel, that in-paragraph, word-level highlight
is the whole point.

Starting points: the editor is already CodeMirror 6, and `@codemirror/merge`
provides both views VS Code has — side by side and unified — with in-line
change highlighting, on the same engine. On the Rust side, a per-file diff
between any two commits (or a commit and the working tree) is a git2
`diff_tree_to_tree` / `diff_tree_to_workdir` away. Choosing what to compare —
the last snapshot, any snapshot from the history list, or two of them — is
part of the design.

The owner's layouts (2026-10-04), all three wanted:

- **The code-editor view:** `[earlier] [action] [current]`.
- **Two points in time against today:** `[earlier, date/time] [later, date/time] [action] [current]` —
  any two snapshots, plus the text as it is now.
- **Comparison with notes:** `[earlier] [current] [notes]`, the third column
  showing the notes (next item) anchored to the passages being compared.

### Go back to an earlier version from the app

Belongs with the diff view above: seeing a change and saying "I want that
version" are one task. Today nothing in the UI restores a snapshot or a
deleted chapter. `git_checkout_file` exists (`src-tauri/src/commands/git.rs:53`,
`api.gitCheckoutFile` in `src/lib/tauri.ts:554`) but no component calls it,
and three strings promise what the app cannot do: `binder.confirm.chapterBody`
("can be brought back"), `git.commitHint` ("You can come back to it") and
`ai.checkpointNote` ("You can roll back"). Restoring must itself snapshot
first, so going back is never a way to lose today's text; a deleted chapter
also has to come back into `versorium.json`'s order, not just onto disk.

### Notes on the novel, anchored anywhere (like comments in Google Docs)

Requested on 2026-10-04. The writer leaves notes — an idea, an observation, a
brainstorm, a reference — on the project, on a chapter, or on a paragraph,
sentence, line, word or single character, the way Google Docs comments work.
Notes are saved with the novel (inside its folder, so they go into its git
snapshots and its zip backups), never into the manuscript text or the exports
unless asked. They also appear as the third column of the comparison view
above.

Questions the design has to answer, from a review of the whole app first:
where notes live on disk (a file per chapter beside the manuscript, or
`.versorium/`), how an anchor survives edits — inside the app (CodeMirror
change mapping, the ops log) and outside it (a chapter edited in another
editor: re-anchor by quoted text and its context, as the W3C Web Annotation
TextQuoteSelector does); what happens on rename, reorder, delete and restore of
a chapter, on import and export, in git snapshots and restores, in backups, in
the MCP tools (read-only by default, writes behind the existing setting,
warning and checkpoint), in search, and in the corkboard; and how notes look
in the editor (margin markers, highlight, a side panel) without disturbing the
writing. i18n EN+ES; no note text in crash logs.

### The local server cannot be given to a task

Settings → Local AI → Local server lets you test and save an
OpenAI-compatible endpoint, but `SLOT_KINDS` in
`src-tauri/src/commands/settings.rs` is `none | builtin | ollama | cli`, so no
task can use it and nothing dispatches to it. The interface now says so.

### Scrivener synopses are read and dropped

The Scrivener importer reads each document's synopsis; `import_apply` in
`src-tauri/src/commands/formats.rs` never writes it anywhere, because a chapter
has no place to keep one — the corkboard derives its card text from the first
lines of the body. Storing it means deciding where a synopsis lives (a
frontmatter key is the obvious candidate) and teaching the corkboard to prefer
it.

## Specified, not started

Five slots exist in Settings → Local AI — Rewrite, Project chat, Continuity,
Search, Dictation (`SLOT_NAMES` in `src-tauri/src/commands/settings.rs`). Two
have a working surface: Rewrite (read by `RewriteDialog.svelte`) and Continuity
(read by `src-tauri/src/commands/polish.rs`). These three do not:

- **Project chat.** The `chat` slot can be assigned a model; nothing in the app
  opens a conversation with it.
- **Search by meaning.** The `embeddings` slot and the Nomic embedding model
  (`nomic-embed-text-v15-q4km`) are in the catalogue; there is no index and no
  search box that uses them. New projects get an empty `.versorium/embeddings/`
  folder and nothing writes to it.
- **Dictation.** There is no Whisper pack in `models/catalog.json` (no model
  with `"task": "dictation"`). The Dictation tab says so rather than pretending.

## Going public

The recommended order is below. Only two dependencies are hard: the signing
secrets (step 1) must be set before the tag (step 5), because the `guard` job
reads them on a tag push and nothing else does; and the landing page is live
only once steps 2, 3 and 4 are all done. Making the repository public does not
depend on the secrets, and the DNS record can be added before Pages exists.

1. **Signing secrets.** `TAURI_SIGNING_PRIVATE_KEY` (the contents of
   `~/.versorium/signing.key`) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty —
   the key is encrypted but signs with an empty password; an unset secret
   expands to an empty string in `release.yml`, which has the same effect).
   **Done** — both set on 2026-10-03 (17:18 UTC). GitHub never shows a secret
   back, so the first tag build is the end-to-end proof that they are right. The pair is
   verified: `tests/release/verify-signing-pair.py FILE FILE.sig` checks that a
   signature made with the private key verifies against the public key
   compiled into `src-tauri/tauri.conf.json` (it needs Python's
   `cryptography` package).
2. **Make the repository public.** MAECLY is on GitHub's free plan, where Pages
   does not serve private repositories, and a private repository's release
   assets cannot be downloaded by the people the landing page sends there.
3. **Enable Pages** with "GitHub Actions" as the source, and set
   `versorium.maecly.com` as the custom domain in Settings → Pages. With an
   Actions source the custom domain is set there; a `CNAME` file in the
   published folder is not used for it. `.github/workflows/pages.yml`
   publishes `docs/`; both are being written on `feat/landing-and-docs` and
   are not in the tree yet. They have to be **merged to `main`** before Pages
   can deploy them: by default the `github-pages` environment only accepts
   deployments from the default branch, so enabling Pages while they exist
   only on this branch publishes nothing.
4. **DNS.** In Cloudflare, `versorium` CNAME → `maecly.github.io`, DNS only
   (not proxied), the same as `gaming-toggles.maecly.com`: on 2026-10-03
   `dig gaming-toggles.maecly.com` returned the CNAME `maecly.github.io` and
   GitHub's addresses, not Cloudflare's, and `dig versorium.maecly.com`
   returned no record.
5. **First release.** Tag `v0.1.0`. The `guard` job refuses a tag that does not
   match the version in `tauri.conf.json`, `package.json` and
   `src-tauri/Cargo.toml` (all three are `0.1.0`). The release workflow builds
   a *draft* so a person checks `latest.json` and `SHA256SUMS` before any
   client is offered it (see `RELEASING.md`).

   Before tagging, decide whether to set `"requireSignedVersion": true` under
   `plugins.updater` in `src-tauri/tauri.conf.json` (raised in review on
   2026-10-03, separate from the token change). Left off, as now (the
   plugin's default), the updater accepts a signature that names no version,
   so a tampered `latest.json` could announce a newer version for an older
   installer signed that way. No release signature should lack one:
   `pnpm-lock.yaml` locks `@tauri-apps/cli` 2.12.0, whose changelog says
   `tauri build` records the app version in every updater signature, and the
   plugin already refuses a signature whose version differs from the one
   announced. The flag makes the version a requirement. If it is set for
   `v0.1.0`, decode a `.sig` from the draft (it is base64) and confirm its
   trusted comment contains `version:0.1.0` before publishing: an install with
   the flag refuses every later release whose signature names no version.

Two things in the app reach the repository directly. What going public does
for each:

- **The in-app updater: decided and changed, not yet proven.** On 2026-10-03
  the founder decided that once the repository is public, updates must work
  without a token, and `PROMPT-VERSORIUM.md` §11 opens with that amendment.
  The code follows it: `update_check` in `src-tauri/src/commands/update.rs`
  no longer returns early without a token, and `src-tauri/src/update/mod.rs`
  sends `Authorization` only when one is saved. A saved token is still sent,
  for while the repository is private and to lift GitHub's anonymous rate
  limit. Going public is what makes the anonymous check find anything: until
  then GitHub answers it with a 404, and Settings → Updates says no published
  version is visible yet. **To do after step 5:** on an install with no token
  saved, press Check now and see the release offered and installed. Until
  that is done, the anonymous path is proven only against the mocked IPC and
  the unit tests.
- **The crash reporter's "report" action** opens
  `https://github.com/MAECLY/versorium-app/issues/new` with a prefilled title
  and body (`report_url` in `src-tauri/src/crash/mod.rs`, owner and repo
  compiled in as `ISSUES_OWNER` / `ISSUES_REPO`). While the repository is
  private, anyone outside the org gets a 404 there. Going public fixes this
  with no code change.

Not on this list's critical path: Apple notarisation and Windows Authenticode.
Both need purchased certificates, and buying them is not the whole job:
`release.yml` passes no Apple or Windows codesigning variables to
`tauri-action`, and `tauri.conf.json` has no signing identity or certificate
thumbprint, so both have to be wired in once the certificates exist. Until
then, the release body written by `release.yml` carries, in English and
Spanish, the instructions for clearing the macOS quarantine flag
(`xattr -rd com.apple.quarantine /Applications/Versorium.app`) and for getting
past SmartScreen (More info → Run anyway).

## Unexplained

- One `cargo test` run, on an earlier and smaller suite, reported 1 failure
  without naming it in the captured output; the ten runs after it were
  reported clean (no logs of those runs are kept). Not diagnosed, so not
  claimed fixed. A port clash is not the cause: the only test that opened a
  socket then (`live_a_real_request_over_a_real_socket_is_answered` in
  `src-tauri/src/mcp/http.rs`) is `#[ignore]`d, and it binds port 0 anyway.
  The updater's two redirect tests, added since, open loopback sockets on
  port 0 too.
  The suite measured on 2026-10-03 passed: 464 unit + 4 integration, 16
  ignored.
