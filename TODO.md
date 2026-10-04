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
count in `BackupGroup.svelte`, the per-slot model picker in
`LocalAiSection.svelte` and the import's language picker in
`ManuscriptDialog.svelte`.

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
`/tmp/versorium-backup-schedule/SPEC.md`, copied to `~/Documents/Github/.versorium-design/` outside the repo).

- **Phase 0 is done** (STATUS.md, "Backup Phase 0"), the repository lock
  included. Open for the owner: a second Back up now queues behind the first
  and makes its own run, after its own save; the spec's Phase 1 has it join
  the first, whose plan predates that save. Phase 1's scheduler has to pick
  one. A pull locks the history for its local half only, not for the fetch.
- **Two git writers skip the repository lock:** `git_branch_create`
  (writes the branch, then HEAD) and `git_checkout_file` (rewrites
  `.git/index`). A branch created during a backup's capture can leave an
  archive whose HEAD names a branch file it does not hold. Narrow window; take
  the lock in both before Phase 1. Also, `errors.repo_busy` blames a backup,
  but the holder can be a pull or an MCP commit.
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

### Notifications: the checks no automation reaches, and what is left

Built on 2026-10-04 (see "Notifications" in `STATUS.md`): `src/lib/notices/`,
one stack for hints and confirmations that go by themselves and errors that
stay until closed or cleared. A message tied to a place stays in it. Still to
do:

- **macOS, WKWebView:** VoiceOver reads a hint once, politely, and an error
  once, as an alert, and not again when the error's words change in place;
  with keyboard navigation off, Option+Tab from the text reaches the
  notice's Close; Escape on a notice closes it and leaves Focus on; a click
  on Close while writing leaves the caret in the text. On the mock,
  Playwright's Chrome and WebKit pass the last three and check the live
  regions' words for the first (`tests/e2e/notices.spec.ts`;
  `tests/scratch/notices/pw-webkit.config.ts`); no screen reader was run.
- **A notice raised while a modal dialog is open** (an autosave failing
  behind the Rewrite dialog) sits behind the backdrop and is not announced:
  `showModal()` makes the rest of the page inert, its live regions included.
  It is read only if the writer finds it after the dialog closes. A dialog's
  own action no longer does this: New project, New chapter, the tour and
  Project settings say their failure inside, and Rename and Delete close
  before they run.
- **An error raised on the Settings page covers the foot of the form** until
  it is closed: at 1100×640 the stack sits over the third backup card's path
  and part of Author's "Publisher or company". The manuscript keeps room for
  the stack (`--v-notes-room`); the Settings page could do the same.
- **The words of a background failure** say why and not what: a save, the
  change log and the minute's snapshot that fail on a full disk all say "File
  system error.". The owner's call: a line per source ("The chapter was not
  saved. …"), which would also stop them sharing one box.
- **A notice keeps the language it was raised in** until it goes. The
  contract carries text, not a key (backup schedule SPEC §6.3).
- **Save snapshot says nothing when it works.** A transient "Snapshot
  saved." would be the first confirmation the status bar's own button gives.
- **Copy:** "Nothing to roll back here." answers a button labelled "↩
  Restore"; the Spanish says "restaurar" for both. "Nothing to restore here."
  in the next copy pass.
- **Scheduled backups (Phase 1)** report through `notices.show`, `dismiss`
  and `close`, with ids `backup:<kind>:<project>:<dest>`; the adapter
  (`src/lib/backup/notices.ts`) is theirs to write. Where the module is
  narrower than SPEC §6.3, for the owner to confirm or the spec to take in:
  - A transient notice takes no action, by type: it could hide on its way to
    being pressed. So `shrunk` and `skipped` (SPEC §6.1) go without "Open
    backup settings".
  - `show` under the same id in the same words is a refresh and is not read
    out, as §6.3 says. A transient whose words changed is read again: it goes
    in five seconds, and the announcement is the only time a screen reader
    hears it. A persistent notice is never read again under its id (§6.4).
  - Persistent notices in the same words are drawn as one box unless one
    carries an action; a box has room for one action, and its ✕ closes every
    id in it and fires each `onDismiss`. §6.2's texts name the novel and the
    destination, so they never share words; an adapter that dropped those
    names would merge destinations.

### Found while building the notices, not part of them

- **Typewriter mode puts the line being written below the window** once the
  chapter is longer than a screen: at 1000×640, after 30 lines, the caret's
  line sits at y 850–886 in a scroller that ends at 608. HEAD without the
  notices does the same (`tests/scratch/notices-fix/typewriter-probe-base.mjs`,
  run against both). Probe: `tests/scratch/notices/typewriter-probe.mjs`.
- **The censorship checkbox stays ticked after a save that failed**
  (`LocalAiGroup.svelte`, `setCensorship`): it sets the state before the
  write and never sets it back, so the box says it took while the notice says
  it did not. The shared `Checkbox` is strictly controlled for exactly this;
  this one is a raw `<input>`.

### Settings over the editor: the checks no automation reaches, and what it left

Built on 2026-10-04 (see "Settings over the editor, and the typeface on the
page" in `STATUS.md`). Playwright drives it on the mocked IPC in Chrome (the
gate) and in Playwright's WebKit; the real webviews are still to be checked:

- **macOS, WKWebView:** Edit → Undo from the menu bar while Settings is open
  leaves the page alone (the tests press the key, which the menu item
  shares, in Playwright's WebKit, not in the app); VoiceOver finds nothing of
  the covered page; with keyboard navigation off, Option+Tab never lands in
  it; Back to the manuscript puts the caret where it was.
- **The typeface on a machine that has Source Serif 4 installed.** Choosing it
  changes the page there; here, without the face, the page stays in its
  stack's next family, Iowan Old Style, and looks the same (its row now says
  it shows only where it is installed).
- **`DESIGN-VERSORIUM.md`, implementation notes**, still say the chosen face
  never reaches the editor, that Typography's mark never matches, and that
  the stylesheet names Source Serif 4 first ("Fuente por defecto del editor",
  "La fuente elegida no llega al editor"). None of it holds now; the plan
  left those lines to the owner.

### Found while building Settings over the editor, not part of it

- **The undo key outside the page undoes the page.** With the manuscript on
  screen and keyboard focus on a button (the probe used the status bar's
  Typewriter), Cmd/Ctrl+Z reaches the browser's own undo, which walks the
  document-wide stack into the typing done in the editor and takes it back
  as a fresh edit, outside CodeMirror's history, which the change log would
  record as the writer's deletion. Playwright's Chrome
  (`tests/scratch/settings-visit/undo-elsewhere-probe.mjs`). Under Settings
  the page is read-only now, so this build closed it there only.
- **The corkboard still rebuilds the editor**: the status bar's Corkboard
  swaps it out (`{#if corkboard}` in `App.svelte`), with the same loss of the
  undo history, the selection and Restore's session that Settings had.
- **Settings has no Escape**, and opened with a click on its top-bar button
  keeps focus on that button (WebKit drops it, and App now moves it to the
  group Settings opens on).
- **`set_editor_font` takes any catalogue id**, the `ui` and `mono` faces
  included, which Typography never offers: settings naming one render the
  page in it with no row marked (the sample paragraph follows the page, so
  the panel at least shows the face in use). And `fonts/catalog.json` says
  `system-ui` is "offered for writers who prefer a sans page", while its
  `ui` role keeps it out of Typography.
- **Typography in Spanish reads "System serif · system"**: the row shows the
  catalogue's `family` and `license` as they are written, in English. The
  system faces want names of their own in both languages (keyed by catalogue
  id, falling back to `family`), and "system" a translated license label;
  "Source Serif 4" and "OFL-1.1" are names and stay.
- **"Manuscript" names two things while Settings is open**: "← Back to the
  manuscript" / "← Volver al manuscrito" (`settings.backToWriting`) returns
  to the page, and the top bar's "Manuscript" / "Manuscrito", in view beside
  it, opens the separate Manuscript dialog. One of them wants another word,
  such as "← Back to the page", or "Back to writing" as the key itself says.
- **Restore on a word typed key by key takes back its last letter only.**
  `RollbackHistory.take` undoes the latest change inside the word, and the
  editor records one change per key, so a typed word needs a press per
  letter; a word that arrived in one insertion (a paste) goes at once. The
  status bar's hint promises the word. `tests/e2e/bars.spec.ts` accepts
  either outcome, and the Settings specs insert their words whole. Seen in
  Playwright's Chrome while writing the Settings test for Restore.
- **The manuscript's editing host is named "Chapters"**
  (`role="textbox"` and `aria-label={t("binder.chapters")}` in
  `MarkdownEditor.svelte`).
- **`SettingsPage.svelte` binds `bind:this={buttons[i]}` to a plain array**,
  and Svelte warns about it in the dev console on every visit
  (`binding_property_non_reactive`).
- **A hand-edited `editorFont` that is not a string** (a number, `null`)
  costs the whole settings.json, going by the code: serde rejects the file
  and `SettingsStore::load` falls back to every default, not only the face's.
  The same holds for any mistyped key outside the `editor` and `layout`
  blocks, the two read leniently. Not run. The mock does not mirror it
  (`?persist=1` merges what it reads with `Object.assign`, keeping the other
  keys, and answers the default face); no spec depends on either.

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

### Synopses are kept and shown, but nothing writes one

A Scrivener import keeps each document's synopsis as `synopsis:` in its
chapter's frontmatter, the corkboard card shows it, and a Scrivener export
writes it back (`STATUS.md`, 2026-10-04). What is left:

- **Nothing in the app creates or edits a synopsis.** Only an import writes
  one (`set_synopsis` in `src-tauri/src/commands/chapters.rs`); a card shows
  it and cannot change it. Hand-editing the chapter file works, but a YAML
  block (`synopsis: |` and lines under it) reads as no synopsis, because the
  frontmatter reader takes one line per key.
- **Only Scrivener export carries it.** Markdown exports one document with a
  single frontmatter block, and DOCX, EPUB and PDF have no per-chapter place
  for one, so a synopsis does not survive a Markdown round trip.
- **A Scrivener project's language is not read.** The importer reads only the
  binder file, which has none; no Scrivener bundle was at hand to see where
  Scrivener keeps one, if anywhere. The import dialog asks instead.

### Found while building the novel's language and synopses, not part of them

- **One chapter, three word counts.** The binder and the corkboard count
  every whitespace-separated token, `##` and the scene heading included
  (`count_words` in `src-tauri/src/commands/project.rs`); the import preview
  drops heading lines (`bodyWords` in `src/lib/formats/state.svelte.ts`); the
  colophon counts paragraphs only (`word_count` in
  `src-tauri/src/formats/mod.rs`). The mock's "North" (`## Morning`, then
  `The road bent north.`) is 4 words in the preview and 6 on its card
  seconds later. Project settings' preview of the closing page adds up the
  binder's counts, so for a novel with scene headings it says more words
  than the page the export writes. One counter for all three.
- **New project offers the languages in another order, from a list of its
  own.** `NewProjectDialog.svelte` hardcodes Español then English;
  `Onboarding.svelte` keeps its own `LANGUAGES` (English, Español); Project
  settings and the import use `NOVEL_LANGUAGES` and `languageOptions` in
  `src/lib/i18n/languages.ts`. All four are called "Manuscript language" now
  (`dialog.language`). Both older ones are hand-written controls (the table
  above); moving them to `Select` with `languageOptions("")` gives one list
  in one order.
- **The closing page's preview leaves out the publisher and rights rows**
  that `colophon_lines` writes when the author profile has them. The title
  page preview beside it shows both.

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
