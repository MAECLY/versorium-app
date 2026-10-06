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
count in `BackupGroup.svelte`, every control on Settings → Tasks, Models,
Access to your novel and Activity (`src/lib/settings/groups/`,
`src/lib/settings/models/`) and the import's language picker in
`ManuscriptDialog.svelte`.

The stylesheet (`src/styles.css`) already fixes how every native control
*looks*, component or not: accent colour on checkboxes and radios, no
text-field padding on checkboxes, `color-scheme` per theme. The chevron needs
the `.v-select` wrapper, and every hand-written `<select>` already has one.
What the remaining call sites still lack is the wiring: the hint as
`aria-describedby` instead of inside the `<label>` or in an unconnected `<p>`,
and a status readout outside the accessible name. (The two checkboxes that
carried their status inside the `<label>`, "Censorship — On" and "Allow
write — Read-only", went with the Settings redesign: one is "Show uncensored
models", the other a button and a dialog.)

Still hand-written, 17 control tags in 11 files:

| File | Controls |
|---|---|
| `src/lib/components/ManuscriptDialog.svelte` | 3 |
| `src/lib/settings/UpdatesSection.svelte` | 2 |
| `src/lib/onboarding/Onboarding.svelte` | 2 |
| `src/lib/components/GitPanel.svelte` | 2 |
| `src/lib/binder/NewProjectDialog.svelte` | 2 |
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
feeding `studio_test` / `studio_save` that take `port: u16`. It uses
`NumberField`, pinned by `tests/e2e/forms.spec.ts` (now on Settings → Models
→ Local server).

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

### The landing compares Versorium with the alternatives, and says why it exists

Requested on 2026-10-04, once the landing was live. Research the industry
(Scrivener, Ulysses, iA Writer, Obsidian, Notion, Novelcrafter, Sudowrite,
Dabble, Atticus, Plottr, Reedsy Studio, Google Docs, Word and others): price,
what each does and does not do, where the writer's text lives, backups, AI.
Add to the landing a comparison in its own style and motion that shows the
advantages honestly, dated and sourced, including where the others are ahead,
and that says Versorium keeps improving.

The why, in the owner's words: writing as calmly as possible; AI at several
levels of involvement, from none to a model on this computer to the tools the
writer already pays for; the backup of a manuscript as the thing that matters
most; and apps like Notion lacking what a novelist needs, or charging too much
for it, which is why Versorium is free and open source. The research that led
to the product is not in the repository: the oldest document is the original
product prompt, `PROMPT-APP-NOVELA-DESKTOP.md` (2026-09-11), which still sits
outside it.

### Settings › About and the release names: the checks no automation reaches

Built on 2026-10-04 (see "Settings › About, and platform names on release
assets" in `STATUS.md`). Playwright drives About in Chrome on the mocked IPC,
and `tests/unit/release-assets.test.ts` computes every asset name and
`latest.json` from `release.yml` the way tauri-action `action-v1.0.0` does.
Neither is a real webview or a real release:

- **The links in the real webviews.** Checked once in WKWebView (macOS 27,
  `tauri dev`, 2026-10-04; see "After review" under About in `STATUS.md`): a
  press on the repository link opened it in Chrome once the capability had
  its https scope, and showed the failure line before; with macOS keyboard
  navigation off, Tab went through the six links in order and then to "Check
  for updates in Application ›", a button, so on this Mac Tab reaches buttons
  here too (compare "macOS, the Tab order" below). Option-Tab left the links
  for the page itself. Still to check: the other five links (same code path,
  same scope), the middle button and Cmd-click, a right-click on a selected
  link, Tab with keyboard navigation on (the system setting was not
  changed), and WebView2 and WebKitGTK for all of it. WebKit's handling of
  the middle button's release and of a link drag (`draggable="false"`) is
  not tested anywhere.
- **The first tag build with the new names (v0.1.1).** The draft holds the
  sixteen names `RELEASING.md` §7 lists, `latest.json` has its eleven keys
  pointing at them in the API form, `SHA256SUMS` lists them, and an install of
  v0.1.0 updates to v0.1.1 on at least one platform. The app reads an update
  by asset id and its checksum line by that asset's name, so v0.1.0's
  different names should not matter; until that update runs, this is reading
  the code, not an observation.
- **VoiceOver and NVDA** read each link as its words, then "(opens in your
  browser)"; the author's as "… (opens www.maecly.com/about in your
  browser)". Chrome's computed names are tested; no screen reader has read
  them.

### Found while building About and the release names, not part of them

- ~~The Linux files said `ubuntu`~~: the owner chose `…_linux_amd64[ext]` (2026-10-04), which fits the `.rpm` and the AppImage too.
- ~~`finalise` did not check that every platform is in `latest.json`~~: it now fails when darwin-aarch64, darwin-x86_64, windows-x86_64 or linux-x86_64 is missing.
- **The tests of this build are untracked**: `git status` shows
  `tests/unit/about-group.render.test.ts`, `external.test.ts`,
  `release-assets.test.ts`, `opener-acl.test.ts`, `settings-pages.test.ts`,
  `settings-keys.test.ts` (and eight more unit tests from earlier builds),
  `tests/e2e/settings-about.spec.ts`, `tests/e2e/opener-acl.ts` and
  `src-tauri/tests/opener_scope.rs` as `??`. `make verify` runs them; CI runs
  only what is committed, so they go in the feature's commit.
- **A writer cannot copy an About address** without the browser failing
  first: a link is not text to the right-click policy (deliberately), a drag
  across it selects nothing, and a select-all copy carries the hidden "(opens
  in your browser)". Accept it, or later add a "copy address" action; not
  the engine's link menu.
- **The Windows setup program loses "setup"**: its `[ext]` is `.exe`, so it
  is `Versorium_X.Y.Z_windows_x64.exe` beside the `.msi`.
  `[name]_[version]_windows_x64[setup][ext]` would keep `-setup`; the owner's
  pattern was kept as given.
- **The landing links v0.1.0's files by tauri's names**
  (`docs/index.html` and `docs/en/index.html`, lines 254-258:
  `releases/download/v0.1.0/Versorium_0.1.0_aarch64.dmg`, `…_x64.dmg`,
  `…_x64-setup.exe`, `…_x64_en-US.msi`, `…_amd64.deb`,
  `Versorium-0.1.0-1.x86_64.rpm`, `…_amd64.AppImage`). They keep working for
  v0.1.0. When the landing moves to v0.1.1 it has to use the new names
  (`releases/download/v0.1.1/Versorium_0.1.1_apple_silicon.dmg`,
  `…_apple_intel.dmg`, `…_windows_x64.exe`, `…_windows_x64.msi`,
  `…_linux_ubuntu_amd64.deb`, `.rpm`, `.AppImage`). Every name carries the
  version, so one fixed `releases/latest/download/<name>` link is not possible
  without a version-free pattern.
- **Four places still say no release exists**: the top of `STATUS.md`
  ("No release has been cut"), README's Status, `RELEASING.md`'s "Where
  things stand on 2026-10-03", and step 5 of "Going public" below. v0.1.0 was
  tagged and published on 2026-10-04 (20:23 UTC).
- **`SafetySectionCrash.svelte` opens the issue page with its own copy of the
  opener code** (`openIssue`), without the https check; it could call
  `openExternal` (`src/lib/external.ts`). Its Report button opened nothing in
  v0.1.0: the capability's empty opener scope refused it, as it refused
  About's links. The https scope opens it now (its `issues/new?…` address is
  in `src-tauri/tests/opener_scope.rs`), and a refusal there still says
  nothing on the page.
- **`THIRD-PARTY-NOTICES.md` is bundled** (`bundle.resources` in
  `tauri.conf.json`) but About does not link it.
- **actionlint has one finding in `release.yml`**, older than this change:
  SC2035 (info) on `sha256sum *` in "Write SHA256SUMS". `sha256sum -- *`
  answers it; `./*` would not do, because every line would then name
  `./Versorium_…`, which the app's lookup by name would miss.

### Settings, regrouped: the checks no automation reaches, and what it left

Built on 2026-10-04 (see "Settings, regrouped" in `STATUS.md`; the spec is
`~/Documents/Github/.versorium-design/versorium-settings-redesign/SPEC.md`,
outside the repo). Playwright drives it in Chrome on the mocked IPC; the real
webviews and a real server are still to be checked by hand:

- **macOS, VoiceOver:** the rail reads as a navigation with four labelled
  lists, the current page as "current page"; a page title is announced when a
  page opens; the Allow writing… dialog is announced as an alert, with its
  first paragraph; a task's select is read with the line under it.
- **Windows, WebView2:** a closed select changes on every arrow key there. The
  status line is announced once, 400 ms after the last change, and every
  change is saved in order with the last one standing (`ModelsStore.setSlot`
  chains them); neither has been heard or seen on WebView2.
- **A real LM Studio or llama-server:** saved, its models listed, a rewrite
  through `POST /v1/chat/completions` and a continuity check, and a server that
  stops answering mid-session. Proven against a loopback fake in Rust
  (`agents::tests::FakeServer`) and the mock, not against either app.
- **The local server's address is free text**, so it can name another machine.
  Settings and the Rewrite dialog say so ("The passage goes to the server at
  {address}", "On the server at {address}" in Your models, the Network badge),
  and the one-click offer never picks it. Saving the server at another
  computer's address releases the tasks that ran on it, with a notice that
  says so (`studio_save_in`; a new port, or another name for this computer,
  keeps them), so a task chosen for this computer never follows the server to
  another one. The alternative, refusing anything but a loopback address in
  Rust, is the owner's call.
- **macOS, the Tab order:** WebKit reaches a button with Tab only when Full
  Keyboard Access is on (Safari: "Press Tab to highlight each item"), so on a
  Mac without it Tab skips the rail's pages, as it skips every button in the
  app; Option-Tab reaches them. Playwright's WebKit shows it: "every page is
  reachable with Tab" in `settings-nav.spec.ts` fails there, and passes in
  Chrome, the gate's engine. Not checked in the app. The Manuscript ›
  Continuity link in Tasks takes focus before it opens the dialog, so Escape
  hands it back in WebKit too (WebKit does not focus a clicked button).
- **"Run it from Manuscript › Continuity" with no model chosen** opens a tab
  whose button is disabled and whose link ("Choose one in Settings ›") leads
  back. The spec's wireframe shows the link in that state, and the tab says
  where the check will run, so it stays; hiding it until a model is chosen is
  a spec question.
- **Activity's technical line is in English in Spanish too** ("412 chars",
  a refusal's reason): it is the log as Rust writes it, which the spec asks
  for. Saying the count in the writer's language would mean reading Rust's
  free-form `detail` apart in the page.
- **The ES strings were written by the build**, from the spec's drafts; the
  Spanish of the Allow writing… dialog's first paragraph is a faithful
  translation of the product spec's English sentence (D6), which exists only
  in English (revised after review: "Permitir la escritura…" and "Puedes
  volver atrás", where "Puedes revertirla" read as reverting the snapshot).

### Found while building the Settings redesign, not part of it

- **Author profiles are never saved in the desktop app.** Settings → Author
  saves with `set_settings({ authorProfiles, authorProfile })`, but
  `apply_patch` (`src-tauri/src/commands/settings.rs`) has no arm for either
  key and no other command writes `author_profiles`, so every edit is dropped
  while the page says "Saved.", and exports keep the empty default profile.
  Older than the redesign (`aabe369`); the E2E tests miss it because the
  mock's `set_settings` takes any shape. The fix: validated
  `authorProfiles` (trimmed, field by field) and `authorProfile`
  (`work` | `hobby`) arms, and a Rust test that sends AuthorSection's exact
  patch through `apply_patch` and reads it back.
- **`errors.keyring_unavailable` is in neither locale**, so Settings →
  Application's updates token and History & backup's GitHub card show the raw
  key when the OS credential store cannot be used (`AppGroup.svelte`,
  `BackupGroup.svelte`). `tests/unit/settings-keys.test.ts` lists it as known
  missing, and fails once it is written, to be taken off that list.
- **ES `ai.checkpointNote` still says "punto de control"**, and it, together
  with `git.commitHint` and `binder.confirm.chapterBody`, still promises a
  roll-back the app cannot do yet. Left as they are by the owner's decision
  (D7): they are fixed when in-app restore lands.
- **Hand-written controls outside Settings' AI pages:** `RewriteDialog.svelte`
  (its model picker) and `ManuscriptDialog.svelte` (three), in the table above.
- **`docs/llms.txt` and `docs/en/details/index.html` still name "Local AI" and
  "Assistants"**; they need the new page names once the landing work releases
  `docs/`.
- **`.v-section-title` (`--text-mute`, small capitals) is still used outside
  Settings** (the binder's PROJECTS and CHAPTERS, the corkboard, dialogs). Its
  contrast on `--bg-app` is 4.21:1 in Folio light and 4.40:1 in Quarry light
  by the token math, under AA; measured in the rail only.
- **Ollama's answer is not cleaned of a reasoning block**: the built-in
  engine and the new local-server path take a `<think>…</think>` out of a
  model's reply before it can reach a chapter
  (`llama::runtime::strip_reasoning`); `agents::ollama_generate` does not.
  Whether Ollama sends one depends on the model and on Ollama's version; not
  checked.
- **Test connection and Save ask the server differently.** `studio_test`
  allows 5 seconds and builds its URL without brackets, so an IPv6 address
  such as `::1` cannot be tested; Save and the tasks go through
  `agents::server_status` (2 seconds, brackets added). A server that answers
  in 3 seconds would test as "Answered." and save as "Saved · not answering".
  One probe for both would settle it.
- **A finding's kind was shown raw** ("contradiction", "note") by the old
  continuity runner, in both languages. Manuscript → Continuity translates it
  now (`continuity.kinds.*`); recorded because the old surface shipped that
  way.
- **Contrast outside Settings, measured by the verifiers:** the "· in use"
  inside the pressed Author profile button (`AuthorSection.svelte`, a
  `.v-muted` span in the button) is about 1.05 to 1.45:1 in all six themes;
  the status bar's chapter and word count ("ch-01 · Novela 1", "0 words") are
  4.21:1 in Folio light and 4.40:1 in Quarry light, the same figures as
  `--text-mute` on `--bg-app` by the token math.
- **Onboarding still says "this machine" and "agent tools"**
  (`onboarding.step.machine`, `machineUnknown`, `agentsNone`,
  `firstSceneBody`, `replayHint`), where Settings now says "this computer" and
  "assistants".
- **`chrome.spec.ts`, "Focus is not restored at launch"**, reads
  `window.__VERSORIUM_MOCK__` straight after `page.goto`, the race the
  Settings specs had: the mock is imported inside `boot()`, which can end
  after the load event. `gotoMock` (`tests/e2e/mock-page.ts`) waits for it.

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

Five slots exist in settings — Rewrite, Project chat, Continuity, Search,
Dictation (`SLOT_NAMES` in `src-tauri/src/commands/settings.rs`). Two are
tasks with a working surface, chosen on Settings → Tasks: Rewrite (read by
`RewriteDialog.svelte`) and Continuity (read by
`src-tauri/src/commands/polish.rs`, run from Manuscript → Continuity). The
other three are text under Tasks → "Not built yet", with no control: a value
an older build stored is kept and nothing reads it.

- **Project chat.** Nothing in the app opens a conversation with a model.
- **Search by meaning.** The `embeddings` slot and the Nomic embedding model
  (`nomic-embed-text-v15-q4km`) are in the catalogue; there is no index and no
  search box that uses them. New projects get an empty `.versorium/embeddings/`
  folder and nothing writes to it.
- **Dictation.** There is no Whisper pack in `models/catalog.json` (no model
  with `"task": "dictation"`).

### More AI providers: API keys, MCP and assistants (owner, 2026-10-04)

Bring Cursor, Grok, Antigravity, OpenRouter, Devin, Z.ai and Copilot to
everything Versorium already does with AI. Today that is three paths, and none
of them takes a key:

- **Assistants** run the writer's own CLI on a passage (Rewrite): Claude Code,
  Codex, OpenCode (`CLI_HARNESSES` and `detect_binaries` in
  `src-tauri/src/agents/mod.rs`; the scratch-folder rule from `ae509c6`).
- **Models on this computer:** built-in llama.cpp, Ollama, a saved local server
  (LM Studio, llama-server).
- **Access to your novel (MCP):** Versorium's server registered in Claude Code,
  Claude Desktop, Codex and OpenCode (`catalog()` in
  `src-tauri/src/mcp/clients.rs`), read-only unless the writer grants writes.

What each provider could add. **Check every one of these against the
provider's current docs before building**; this is the request, not research:

| Provider | API key (a new "API" slot kind) | Assistant (CLI) | Access to your novel (MCP client) |
|---|---|---|---|
| Cursor | No public model API (check) | `cursor-agent -p` (check the name and flags) | `~/.cursor/mcp.json`, `mcpServers` |
| Grok (xAI) | xAI API, OpenAI-compatible (`api.x.ai`) | Grok Build, `grok -p` (1.0.46 is on this Mac, per the WHY research) | Grok Build's own config (check) |
| Antigravity (Google) | Gemini API key (check what Antigravity itself exposes) | Gemini CLI, free with a Google account (WHY research) | Antigravity's MCP config (check where it lives) |
| OpenRouter | One OpenAI-compatible key for many models (`openrouter.ai/api/v1`) | — | — |
| Devin | Devin API, by sessions (check whether it can do a one-shot rewrite) | — | Check whether Devin can act as an MCP client; DeepWiki is an MCP server, not a client |
| Z.ai (GLM) | OpenAI-compatible API; also an Anthropic-compatible endpoint that Claude Code can be pointed at (check) | — | — |
| Copilot | GitHub Models API with a GitHub token (check limits and terms) | Copilot CLI, `copilot -p` (check) | VS Code / Copilot `mcp.json` (check the path and key: `servers`, not `mcpServers`?) |

What it takes in the app:

- **An "API" slot kind** next to built-in, Ollama, server and CLI
  (`SlotAssignment` in `src-tauri/src/commands/settings.rs`, dispatch in
  `agents::rewrite`). One OpenAI-compatible client covers OpenRouter, xAI,
  Z.ai and most others: base URL, model, key. The model list comes from the
  provider's `/models` where there is one.
- **Keys only in the system's credential store**, through `src-tauri/src/secrets`
  as the updates token is: never in `settings.json`, a log, a crash file or
  the MCP activity log. A key field shows whether a key is set, never the key.
- **Say plainly that the passage leaves the computer.** Today's AI paths keep
  it local or go through a tool the writer already runs; an API key sends it
  to that company. Same wording rules as the assistants, in both languages,
  and the landing's "Does my novel leave my computer?" answer must change with
  it.
- **More MCP clients** in `catalog()`: each one's config path per OS, JSON or
  CLI strategy, the backup-before-edit rule, and the same read-only default.
- **More assistants** in `CLI_HARNESSES` and `detect_binaries`, each run in
  its own empty scratch folder with whatever flag lets it run outside a
  repository, and tested live from `/` like the others
  (`live_detect_and_rewrite_with_installed_agents`).
- **Continuity** runs only on a model on this computer today; whether it may
  use an API model is a decision for the owner, not a default.
- The spec already plans this order: CLI → MCP write-back → API key → local
  (`PROMPT-VERSORIUM.md` §6, "Grok / xAI" row), and "no BYOK" is listed in its
  implementation notes.

### Choose the model an assistant uses (owner, 2026-10-05)

An assistant runs with whatever model its CLI defaults to: a slot stores
`{ kind: "cli", id: "claude" }` and nothing more (`SlotAssignment` in
`src-tauri/src/commands/settings.rs`), and `CLI_HARNESSES` in
`src-tauri/src/agents/mod.rs` passes no model flag. The writer should pick
the model per assistant, the way a model is picked for Ollama or the local
server: for Claude Code, Fable 5.1, Opus 5.5, Sonnet 5.5 and the others the
writer's plan includes; the same for Codex, OpenCode and every assistant added
by "More AI providers" above (Cursor, Grok Build, Gemini CLI, Copilot CLI…).

**Check against each CLI's current docs before building**; this is the
request, not research:

- **The flag.** Claude Code `--model <alias|id>`, Codex `-m`/`--model`,
  OpenCode `--model provider/model` (check each, and whether aliases like
  `opus`/`sonnet` or full ids are what they accept).
- **The list.** Where each CLI can say which models the writer's account can
  use (a command, a config file, or nothing — then a short curated list per
  CLI with "Default" first, and a free-text field for an id the list does not
  know). Never assume a plan includes a model: a model the account cannot use
  must fail as a clear message, not as "the agent did not answer".

What it takes in the app:

- `SlotAssignment` gains an optional model for `cli` slots (absent = the
  CLI's own default, which is today's behaviour, so old settings keep
  working); `apply_patch` and the settings test cover it.
- `cli_rewrite` adds the harness's model flag only when a model is set, and
  the live test (`live_detect_and_rewrite_with_installed_agents`) runs each
  harness once with its default and once with a named model.
- Settings → Tasks → Rewrite (and Assistants): a model picker under the
  assistant, in both languages, saying which model will answer.
- The MCP activity log and the rewrite dialog name the model that answered,
  with the assistant.

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
2. **Make the repository public.** **Done** on 2026-10-04, after the commit history was rewritten so every commit carries migueltuxd@gmail.com (the nine earlier pull requests on GitHub still show the old work address; GitHub keeps them read-only). MAECLY is on GitHub's free plan, where Pages
   does not serve private repositories, and a private repository's release
   assets cannot be downloaded by the people the landing page sends there.
3. **Done** on 2026-10-04: Pages source GitHub Actions, custom domain versorium.maecly.com, HTTPS certificate approved and enforced; PR #10 merged to `main` and the first deploy succeeded. Originally: **Enable Pages** with "GitHub Actions" as the source, and set
   `versorium.maecly.com` as the custom domain in Settings → Pages. With an
   Actions source the custom domain is set there; a `CNAME` file in the
   published folder is not used for it. `.github/workflows/pages.yml`
   publishes `docs/`; both are being written on `feat/landing-and-docs` and
   are not in the tree yet. They have to be **merged to `main`** before Pages
   can deploy them: by default the `github-pages` environment only accepts
   deployments from the default branch, so enabling Pages while they exist
   only on this branch publishes nothing.
4. **Done** on 2026-10-04 (CNAME `versorium` → `maecly.github.io`, DNS only; `maecly.com` was already a verified domain of the organisation). Originally: **DNS.** In Cloudflare, `versorium` CNAME → `maecly.github.io`, DNS only
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
