# TODO

The backlog: everything known to be unfinished in Versorium, in the order to do
it. Finished work goes in `STATUS.md`.

Collected on 2026-11-09 from this file's earlier text, the "Implementation
notes" of `PROMPT-VERSORIUM.md` and `DESIGN-VERSORIUM.md`, the known limits in
`STATUS.md`, and the code. The code itself carries no `TODO` or `FIXME`
comments: pending work is written down here instead, with a pointer into the
code. Every item was checked against `main` at `e8886b9`; twelve that the
documents still listed were already done and are not here.

**How to use it**

- Take the first unchecked item of the highest priority, in any area. P0 comes
  before everything.
- Each item has an id (`mcp-preview-mandatory`). Name it in the commit or pull
  request that closes it.
- **Done when** is the bar. When it is met, delete the item (do not tick it and
  leave it) and record the change in `STATUS.md`.
- "Where" points at the code as it was on 2026-11-09; line numbers drift.
  "details" links to the longer notes kept at the end of this file.
- New work goes in at its priority, with a done-when line.
- Decisions only the owner can make are listed apart, under
  [Decisions for the owner](#decisions-for-the-owner). An item that waits on
  one says so.

| Priority | Meaning | Items |
|---|---|---|
| [P0](#p0--fix-first) | Can lose a writer's text, or breaks a rule in AGENTS.md | 5 |
| [P1](#p1--what-a-writer-notices) | A gap or half-done feature a writer runs into | 26 |
| [P2](#p2--polish-manual-checks-and-tests) | Polish, manual checks, tests | 74 |
| [P3](#p3--larger-features-and-ideas) | New features, not started | 52 |
| [Decisions](#decisions-for-the-owner) | The owner's call, not code | 33 |

## P0 — fix first

Can lose or corrupt a writer's text, or breaks a rule in `AGENTS.md`. Fix these before anything else.

### P0 · Editor

- [ ] **Stop Cmd/Ctrl+Z off the editor from undoing manuscript text as a fresh edit** · Bug · `undo-key-outside-editor`
  - Done when: With the manuscript on screen and focus on any non-editor control (e.g. the status bar's Typewriter) or on nothing, Cmd/Ctrl+Z changes no chapter text (or routes to CodeMirror's undo); a Playwright spec based on undo-elsewhere-probe.mjs covers Chrome and WebKit.
  - Where: `src/App.svelte:459`, `src/App.svelte:588`, `src/lib/editor/MarkdownEditor.svelte:60-66`
  - [details](#found-while-building-settings-over-the-editor-not-part-of-it); from `STATUS.md:1012`, `STATUS.md:1196`, `STATUS.md:2417-2418`

### P0 · MCP

- [ ] **Make the MCP preview mandatory: a first call with confirm:true must not write** · Risk · `mcp-preview-mandatory`
  - Done when: Every MCP write tool refuses confirm:true unless a preview for the same arguments was issued first (e.g. a preview token), the writer can see that diff, and a Rust test proves a first-call confirm:true writes nothing (replacing a_confirmed_write_checkpoints_first_then_records_agent_ops).
  - Where: `src-tauri/src/mcp/write.rs:4`, `src-tauri/src/mcp/write.rs:123`, `src-tauri/src/mcp/write.rs:168`
  - from PROMPT implementation notes, `REFERENCE.md:248`, `AGENTS.md#Rules that do not bend`
- [ ] **Require writer confirmation for MCP delete_document, not an agent-set acknowledge_delete** · Risk · `mcp-delete-writer-confirm`
  - Done when: delete_document applies only after a confirmation the writer gives (UI prompt or a preview the writer approved); acknowledge_delete alone no longer deletes; covered by a Rust test.
  - Where: `src-tauri/src/mcp/write.rs:300`, `src-tauri/src/mcp/write.rs:317`, `src-tauri/src/mcp/write.rs:364`
  - from PROMPT implementation notes

### P0 · Import and export

- [ ] **Translate the colophon credit line instead of hardcoding English in Rust** · Bug · `colophon-credit-i18n`
  - Done when: colophon_credit() takes the localized string from the frontend like the other colophon labels; a Spanish project exports 'Escrito en Versorium <version>'; tests cover both languages.
  - Where: `src-tauri/src/formats/mod.rs:174`, `src-tauri/src/formats/epub.rs:215`, `src-tauri/src/formats/docx.rs:363`
  - from `FORMATS.md:155`

### P0 · Updates and releases

- [ ] **Save the dirty chapter before installing an update** · Risk · `save-before-update-install`
  - Done when: Update install flushes and awaits every pending editor save before calling the updater; a test or e2e spec proves the save happens first.
  - Where: `src/lib/update/state.svelte.ts:54-79`, `src/lib/components/UpdateDialog.svelte:132`, `src-tauri/src/commands/update.rs:297-370`
  - from PROMPT implementation notes

## P1 — what a writer notices

A spec gap or half-done feature a writer runs into, or copy that promises what the app cannot do.

### P1 · Editor

- [ ] **Keep the editor mounted when the corkboard opens (undo, selection, Restore)** · Bug · `corkboard-keeps-editor`
  - Done when: A corkboard round trip keeps the same EditorView (same DOM node, undo depth, caret, rollback session), as Settings now does; an e2e spec asserts undo still works after the round trip.
  - Where: `src/App.svelte:702-704`, `src/App.svelte:327-330`, `src/App.svelte:671-675`
  - [details](#found-while-building-settings-over-the-editor-not-part-of-it); from `STATUS.md:1197`, `STATUS.md:1198`, `STATUS.md:2418-2419`
- [ ] **Paint AI-written spans in the editor with .cm-ai-span** · Half-done · `ai-spans-decoration`
  - Done when: A CodeMirror decoration applies .cm-ai-span to ranges the op log attributes to ai:*, with a test checking the decoration.
  - Where: `src/styles.css:767`, `src/lib/editor/cm.ts:44`, `src/lib/editor/MarkdownEditor.svelte`
  - from `DESIGN-VERSORIUM.md:251`
- [ ] **Show privacy level (Local/CLI/API), model, session words and branch in the status bar** · Spec gap · `status-bar-privacy-model`
  - Done when: StatusBar shows the active provider's privacy badge with --privacy-* tokens, the active model, session words and branch; EN+ES keys; a test.
  - Where: `src/lib/components/StatusBar.svelte:53-80`, `src/lib/components/RewriteDialog.svelte:163-168`
  - from `DESIGN-VERSORIUM.md:252`, PROMPT implementation notes

### P1 · Binder and corkboard

- [ ] **Let the writer create and edit a chapter's synopsis in the app** · Half-done · `synopsis-editing`
  - Done when: The writer writes/edits a synopsis from the corkboard card or the chapter; it saves as frontmatter synopsis: (multiline YAML included) through set_synopsis; EN+ES strings, wrapper, mock handler and e2e spec.
  - Where: `src-tauri/src/commands/chapters.rs:207`, `src-tauri/src/commands/formats.rs:151`, `src/lib/binder/Corkboard.svelte:105`
  - [details](#synopses-are-kept-and-shown-but-nothing-writes-one); from `STATUS.md:1303`, `STATUS.md:1503`
- [ ] **Use one word counter for the binder, card, import preview, status bar and colophon** · Bug · `one-word-counter`
  - Done when: count_words, bodyWords and formats word_count share one definition; the mock's 'North' chapter shows the same count in preview, card and colophon; tests cover a chapter with scene headings.
  - Where: `src-tauri/src/commands/project.rs:449`, `src/lib/formats/state.svelte.ts:114`, `src-tauri/src/formats/mod.rs:160`
  - [details](#found-while-building-the-novels-language-and-synopses-not-part-of-them); from `STATUS.md:1599`

### P1 · History and snapshots

- [ ] **Restore a chapter from an earlier snapshot in the app, snapshotting first** · Half-done · `restore-chapter-from-snapshot`
  - Done when: From history (or the diff view) the writer restores a chapter to a chosen snapshot via gitCheckoutFile or a successor; a snapshot of today's text is taken first; e2e spec covers it; README.md note removed.
  - Where: `src-tauri/src/commands/git.rs:64`, `src/lib/tauri.ts:649`, `tests/e2e/mock-tauri.ts:934`
  - [details](#go-back-to-an-earlier-version-from-the-app); from `REFERENCE.md:40`, `REFERENCE.md:257`, `README.md`
- [ ] **Let a deleted chapter come back from history into versorium.json's order** · Feature · `restore-deleted-chapter`
  - Done when: A deleted chapter is restored from a snapshot, its file is back on disk and reinserted in versorium.json's binder order; a snapshot is taken first.
  - Where: `locales/en/ui.json:64`, `src-tauri/src/commands/git.rs:64`, `src-tauri/src/commands/project.rs`
  - [details](#go-back-to-an-earlier-version-from-the-app)

### P1 · Backups

- [ ] **Backup Phase 1: per-destination ledger, Rust runner thread with pruning, instance lock** · Feature · `backup-phase1-runner`
  - Done when: A ledger of each novel's backups per destination exists; the runner runs manual runs on its own Rust thread and owns pruning (moved out of each write); a second app instance cannot run concurrently; backup_busy and backup_source_gone have EN+ES text.
  - Where: `src-tauri/src/commands/backup.rs:226`, `src-tauri/src/commands/backup.rs:239`, `src-tauri/src/backup/mod.rs:1518`
  - [details](#choose-when-the-backup-runs); from `STATUS.md:475`, `STATUS.md:588`, `STATUS.md:591`
- [ ] **Backup Phase 1: persistent Settings rows, status-bar item, destination marker** · Feature · `backup-phase1-ui`
  - Done when: Settings backup rows survive leaving the page; a status-bar item shows backup state; destinations carry a marker; EN+ES strings.
  - Where: `src/lib/settings/groups/BackupGroup.svelte:39`, `src/lib/components/StatusBar.svelte`, `src/lib/backup/state.ts`
  - [details](#choose-when-the-backup-runs)
- [ ] **Backup Phase 1: shrink, partial, source-gone and free-space guards; fsync before rename** · Feature · `backup-phase1-guards`
  - Done when: The runner refuses or warns on a shrunk, partial or source-gone backup and on low free space, and fsyncs the zip before the atomic rename; Rust tests cover each.
  - Where: `src-tauri/src/backup/mod.rs:1561`, `src-tauri/src/backup/mod.rs:1602`
  - [details](#choose-when-the-backup-runs)
- [ ] **Backup Phase 1: pack once then copy, and a weekly verify that never downloads evicted files** · Feature · `backup-phase1-pack-verify`
  - Done when: One zip is packed per run and copied to each destination; a weekly verify checks backups without pulling iCloud-evicted files.
  - Where: `src-tauri/src/backup/mod.rs:1465`, `src-tauri/src/backup/mod.rs:1338`, `src-tauri/src/commands/backup.rs:308`
  - [details](#choose-when-the-backup-runs)
- [ ] **Write the backup notices adapter (src/lib/backup/notices.ts) for Phase 1** · Half-done · `backup-notices-adapter`
  - Done when: src/lib/backup/notices.ts maps backup events to notices.show/dismiss/close with ids backup:<kind>:<project>:<dest>, texts naming novel and destination.
  - Where: `src/lib/backup/events.ts`, `src/lib/backup/state.ts`, `src/lib/notices/state.svelte.ts`
  - [details](#notifications-the-checks-no-automation-reaches-and-what-is-left)
- [ ] **Backup Phase 2: schedule options, close/quit backups, retention over time, 'Next:' lines** · Feature · `backup-phase2-schedule`
  - Done when: One release ships the 'When to back up' select (manual; close/quit default + daily; on chapter switch; every N min 1–50; every N h 1–4; daily), idle-wait and skip rules, iCloud bandwidth hint, 'Always back up before quitting', retention spread over time and 'Next:' lines, EN+ES.
  - Where: `src/lib/settings/groups/BackupGroup.svelte`, `src-tauri/src/commands/settings.rs`, `src-tauri/src/backup/mod.rs:756`
  - [details](#choose-when-the-backup-runs)

### P1 · Import and export

- [ ] **Unescape XML entities in the DOCX importer's dc:title** · Bug · `docx-title-unescape`
  - Done when: Importing a DOCX titled 'A & B' gives a project titled 'A & B' via resolve_entity; a Rust test covers it.
  - Where: `src-tauri/src/formats/docx.rs:786-792`, `src-tauri/src/formats/docx.rs:687`
  - from `STATUS.md:1506`
- [ ] **Remove the half-made project folder when an import fails; report removal errors** · Bug · `failed-import-cleanup`
  - Done when: import_into removes the folder it created on any failure and reports a failed placeholder removal; Rust tests cover both.
  - Where: `src-tauri/src/commands/formats.rs:118-156`, `src-tauri/src/commands/formats.rs:138`
  - from `STATUS.md:1507`
- [ ] **Make PDF export keep characters outside WinAnsi** · Spec gap · `pdf-non-winansi`
  - Done when: A chapter with Polish/Greek/symbol characters exports to PDF with every character present (checked with pdftotext) by embedding a covering font, or the maintainer keeps the limit and FORMATS.md records the decision.
  - Where: `src-tauri/src/formats/pdf.rs:6`, `src-tauri/src/formats/pdf.rs:57-95`, `src-tauri/src/formats/pdf.rs:369`
  - from `STATUS.md:2450-2452`, `STATUS.md:2778-2780`
- [ ] **Warn on EPUB import when bold and italics are dropped** · Spec gap · `epub-import-emphasis-warning`
  - Done when: EPUB import preview raises a formatting-dropped warning (mirroring import_docx_formatting_dropped) or keeps emphasis as Markdown.
  - Where: `src-tauri/src/formats/epub.rs:432-433`, `src-tauri/src/formats/epub.rs:495-500`, `src-tauri/src/formats/epub.rs:526`
  - from `FORMATS.md:15`, `FORMATS.md:307`
- [ ] **Skip EPUB front/back matter whose epub:type carries several values** · Bug · `epub-multi-value-type`
  - Done when: The skip check matches any token of epub:type (e.g. 'frontmatter titlepage'); unit test with multi-value types.
  - Where: `src-tauri/src/formats/epub.rs:435-445`, `src-tauri/src/formats/epub.rs:518-524`
  - from `FORMATS.md:302`
- [ ] **Read or warn about DOCX footnotes and comments on import** · Spec gap · `docx-footnotes-comments`
  - Done when: DOCX import reads word/footnotes.xml and comments.xml, or raises a warning code (EN+ES) when they exist.
  - Where: `src-tauri/src/formats/docx.rs:17-18`, `src-tauri/src/formats/docx.rs:775-786`
  - from `FORMATS.md:17`, `FORMATS.md:288`
- [ ] **Keep scene headings in PDF and DOCX export (PDF drops only the first scene's)** · Spec gap · `pdf-scene-titles`
  - Done when: The first scene's ## heading appears in exported PDF (or the export warns that it is dropped), DOCX keeps ## headings, and FORMATS.md says what each format keeps; tests cover a chapter whose first scene has a heading.
  - Partly done: PDF already prints a scene's heading as its break marker for every scene after the first (pdf.rs:227: scene.heading or '#'). So in PDF only the first scene's heading is lost (see pdf-first-scene-heading-warning), and the docs saying PDF drops all scene titles are stale. DOCX still drops every scene title on purpose ('SceneBreak' '#' with a comment). The remaining work is DOCX, or a recorded decision, plus fixing the docs.
  - Where: `src-tauri/src/formats/docx.rs:336-342`, `src-tauri/src/formats/pdf.rs:225-233`
  - from `STATUS.md:2450-2452`, `STATUS.md:2286-2287`

### P1 · Updates and releases

- [ ] **Verify an in-app update end to end on Linux (AppImage and .deb)** · Manual check · `linux-update-e2e`
  - Done when: An installed AppImage and .deb detect, verify, install and relaunch into a newer release without a token; .deb behaviour documented, with a download + xdg-open fallback if the plugin cannot; result in STATUS.md.
  - Where: `docs/project/STATUS.md:5-16`, `README.md`, `README.md`
  - from PROMPT implementation notes, `STATUS.md:2848-2855`, `STATUS.md:2936-2937`

### P1 · Copy and translations

- [ ] **Make ai.checkpointNote, git.commitHint and binder.confirm.chapterBody tell the truth** · Bug · `rollback-promise-strings`
  - Done when: When restore ships (or earlier by owner choice) the three strings in EN+ES match what the app does, and ES ai.checkpointNote no longer says 'punto de control'.
  - Where: `locales/en/ui.json:64`, `locales/en/ui.json:570`, `locales/en/ui.json:724`
  - [details](#found-while-building-the-settings-redesign-not-part-of-it)

### P1 · Accessibility

- [ ] **Show and announce notices raised while a modal dialog is open** · Bug · `notices-behind-modal`
  - Done when: A failure raised while a showModal() dialog is open is shown and announced (mirrored in the dialog or held/re-announced on close); e2e covers an autosave failure behind Rewrite.
  - Where: `src/lib/notices/Notices.svelte:122`, `src/lib/notices/Notices.svelte:123`, `src/lib/components/RewriteDialog.svelte:209`
  - [details](#notifications-the-checks-no-automation-reaches-and-what-is-left); from `STATUS.md:897`
- [ ] **Bring chrome text (text-mute, warn, status bar, Author profile button) to 4.5:1** · Bug · `chrome-contrast-aa`
  - Done when: Every listed pair reaches 4.5:1 in all six themes (Folio Light text-mute/bg-app 4.21, text-mute/bg-panel 4.49, warn/bg-app 4.43; Quarry Light text-mute/bg-app 4.40, warn/bg-app 4.03, warn/bg-panel 4.33), including the Author profile button and status bar; landing token check re-run.
  - Partly done: The --text-mute half is done. Commit 232376e (2026-10-06) darkened Folio and Quarry light, and tests/unit/text-mute-contrast.test.ts holds it to AA. Measured now: Folio light 4.61 on bg-app and 4.91 on bg-panel; Quarry light 4.66. The DESIGN doc's 4.21/4.49/4.40 figures are out of date. Still under 4.5: --warn on bg-app in Folio light (4.43), and in Quarry light 4.03 on bg-app and 4.33 on bg-panel. --warn is used as text for the status bar's save-error state (StatusBar.svelte:74) and .v-field-error (styles.css:441). No test covers --warn. The landing token check needs re-running after a palette change.
  - Where: `src/styles.css:22`, `src/styles.css:69`, `src/lib/components/StatusBar.svelte:74`
  - from `DESIGN-VERSORIUM.md:258`, `STATUS.md:1898`
- [ ] **Fix contrast of deleted lines in the Rewrite preview (--warn on --diff-del)** · Bug · `diff-del-contrast`
  - Done when: --diff-del or the text colour reaches 4.5:1 in all six variants.
  - Where: `src/lib/components/RewriteDialog.svelte:223`, `src/styles.css:22`, `src/styles.css:28`
  - from `DESIGN-VERSORIUM.md:258`

### P1 · Linux

- [ ] **Enable spell checking on Linux WebKitGTK and drop the Linux hint** · Half-done · `linux-spellcheck`
  - Done when: with_webview + webkit2gtk (Linux-only dep) call set_spell_checking_enabled(true) and set_spell_checking_languages in spelling.rs; spellingUnderlines, the hintLinux key and the Linux-pinning spec in tests/e2e/editor-settings.spec.ts are removed; verified on a Linux build.
  - Where: `src-tauri/src/spelling.rs:16-22`, `src-tauri/src/spelling.rs:41-42`, `src/lib/editor/preferences.ts:85-99`
  - [details](#spelling-on-linux-and-on-the-release-builds); from PROMPT implementation notes, `STATUS.md:273`, `STATUS.md:311`

## P2 — polish, manual checks and tests

Polish, the checks no automation reaches (real webviews, screen readers, release builds), and gaps in the tests.

### P2 · Editor

- [ ] **Add split and merge scene actions** · Spec gap · `split-merge-scenes`
  - Done when: The writer can split a chapter at a ## scene into a new chapter and merge adjacent chapters from the UI, keeping ops history; tests cover it.
  - Where: `src-tauri/src/commands/chapters.rs:51`, `src/lib/tauri.ts`
  - from PROMPT implementation notes
- [ ] **Configure CodeMirror history() for unlimited session undo** · Spec gap · `unlimited-undo`
  - Done when: history() configured with a very large minDepth per spec; a test asserts the config.
  - Where: `src/lib/editor/cm.ts:44`
  - from PROMPT implementation notes
- [ ] **Turn on the spec's OpenType features (ss01 etc.) in the editor** · Spec gap · `opentype-features`
  - Done when: .cm-content declares the spec's font-feature-settings.
  - Where: `src/styles.css`, `src/lib/editor/cm.ts`
  - from `DESIGN-VERSORIUM.md:268`
- [ ] **Click the corkboard and Focus mode in the real desktop app** · Manual check · `corkboard-focus-real-app`
  - Done when: In make dev or a release build the corkboard opens chapters on click and Focus dims/undims and exits on Escape; recorded.
  - Where: `docs/project/STATUS.md:2680-2684`, `src/lib/binder/Corkboard.svelte`
  - from `STATUS.md:2680-2684`

### P2 · Binder and corkboard

- [ ] **Show Git, MCP and update-available indicators outside Settings** · Spec gap · `git-mcp-update-indicators`
  - Done when: Binder or top bar shows Git state, MCP connected/write state and update-available, with EN/ES accessible names.
  - Partly done: The status bar already shows Git state: a dirty/clean dot (git.dirty / git.clean) plus Commit, History and Restore buttons. Neither StatusBar.svelte nor TopBar.svelte mentions MCP or updates, so MCP connected/write state and update-available are still visible only in Settings.
  - Where: `src/lib/components/StatusBar.svelte:91`, `src/lib/components/TopBar.svelte`, `src/lib/components/StatusBar.svelte:69`
  - from PROMPT implementation notes
- [ ] **Write versorium.json atomically in create_project** · Risk · `create-project-atomic-meta`
  - Done when: create_project writes versorium.json through write_meta or an equivalent temp-and-rename.
  - Where: `src-tauri/src/commands/project.rs:223`, `src-tauri/src/commands/project.rs:313`
  - from `STATUS.md:1512`, `STATUS.md:1514`
- [ ] **Refresh corkboard cards when a chapter changes while the corkboard is open** · Bug · `corkboard-card-refresh`
  - Done when: After a chapter is edited or its synopsis changes, its card updates without reopening the corkboard.
  - Where: `src/lib/binder/Corkboard.svelte:21`, `src/lib/binder/Corkboard.svelte:25`, `src/lib/binder/Corkboard.svelte:44`
  - from `STATUS.md:1509`

### P2 · Settings

- [ ] **Check Settings › About links by hand in WKWebView, WebView2 and WebKitGTK** · Manual check · `about-links-webviews`
  - Done when: On each OS's real build: all About links, middle button and Cmd/Ctrl-click, right-click on a selected link, Tab with keyboard navigation on, middle-button release and link drag (draggable=false) behave as the e2e spec expects; recorded in STATUS.md.
  - Where: `src/lib/settings/groups/AboutGroup.svelte`, `tests/e2e/settings-about.spec.ts`
  - [details](#settings--about-and-the-release-names-the-checks-no-automation-reaches); from `STATUS.md:2099-2102`

### P2 · History and snapshots

- [ ] **Tag AI-originated commits with a Versorium-Agent: ai:<client> trailer** · Spec gap · `ai-commit-trailer`
  - Done when: AI-originated commits carry 'Versorium-Agent: ai:<client>'; tests check it.
  - Where: `src-tauri/src/git/repo.rs:163-180`, `src-tauri/src/mcp/write.rs`
  - from PROMPT implementation notes

### P2 · Backups

- [ ] **Tie the backup temp-file id to the machine, not the app folder** · Risk · `backup-machine-id`
  - Done when: Two machines cloned from one home folder get different ids (machine-bound or stored fingerprint), so neither sweeps the other's live temporary archive on a synced folder.
  - Where: `src-tauri/src/backup/host.rs:1-7`, `src-tauri/src/backup/host.rs:24`
  - [details](#choose-when-the-backup-runs); from `STATUS.md:597`
- [ ] **List sync-client conflict copies of backups read-only for Restore, and count them in pruning** · Feature · `backup-conflict-copies`
  - Done when: Files like '… 2.zip' and '(conflicted copy)' in a destination are listed read-only for Restore and accounted for by pruning.
  - Where: `src-tauri/src/backup/mod.rs:692`, `src-tauri/src/backup/names.rs`
  - [details](#choose-when-the-backup-runs); from `STATUS.md:602`
- [ ] **Do backup Phase 0's manual checks in the desktop app, including the Windows unlock** · Manual check · `backup-phase0-manual`
  - Done when: The lock, its waits and the release are seen working in the real app on macOS and Windows.
  - Unclear: This is a manual check, so the code cannot show it done. Nothing in the repo records a desktop run or a Windows run after STATUS.md:677 ('The desktop app was not driven'). Treat it as pending.
  - Where: `src-tauri/src/commands/backup.rs:226`, `docs/project/STATUS.md:666`, `docs/project/STATUS.md:677`
  - from `STATUS.md:666`, `STATUS.md:677`
- [ ] **Stop an archive stamped years ahead from holding pruning at its destination** · Risk · `backup-future-archive`
  - Done when: A future-dated archive does not block pruning, or the writer can clear it.
  - Where: `src-tauri/src/backup/mod.rs:113`, `src-tauri/src/backup/mod.rs:763-767`
  - from `STATUS.md:605`

### P2 · Models

- [ ] **Test the local server path against real LM Studio and llama-server** · Manual check · `local-server-real-apps`
  - Done when: With real LM Studio and llama-server: save, list models, a Rewrite via /v1/chat/completions, a Continuity check, and a server stopping mid-session (server_offline) all behave.
  - Where: `src-tauri/src/agents/mod.rs:673`, `src-tauri/src/agents/mod.rs:698`
  - [details](#settings-regrouped-the-checks-no-automation-reaches-and-what-it-left); from `STATUS.md:1854`
- [ ] **Run the Vulkan inference build on a real GPU (Windows and Linux)** · Manual check · `vulkan-real-gpu`
  - Done when: Release builds on Windows and Linux with Vulkan GPUs load a catalogue GGUF and offload layers; the .deb starts without crashing; recorded.
  - Where: `src-tauri/Cargo.toml:96`, `src-tauri/src/llama/devices.rs`, `src-tauri/src/llama/runtime.rs`
  - from `STATUS.md:85`, `STATUS.md:2558-2565`
- [ ] **Remove or use the unused badge field in models/catalog.json** · Chore · `catalog-badge-field`
  - Done when: badge removed from catalogue and types, or used by the UI.
  - Where: `models/catalog.json:125`, `src-tauri/src/commands/models.rs:37`, `src-tauri/src/commands/models.rs:144`
  - from PROMPT implementation notes

### P2 · Import and export

- [ ] **Keep chapter synopses through a Markdown export and import round trip** · Spec gap · `synopsis-markdown-roundtrip`
  - Done when: Markdown export carries each chapter's synopsis in a form the Markdown import reads back; FORMATS.md documents DOCX, EPUB and PDF behaviour.
  - Where: `src-tauri/src/formats/markdown.rs:219-220`, `src-tauri/src/formats/markdown.rs:273-279`, `src-tauri/src/formats/markdown.rs:354`
  - [details](#synopses-are-kept-and-shown-but-nothing-writes-one); from `FORMATS.md`
- [ ] **Try import and synopsis round trip on a real Scrivener bundle** · Manual check · `scrivener-real-bundle-check`
  - Done when: A real .scriv imports with its synopses, exports, and re-opens in Scrivener with no made-up synopses; recorded.
  - Where: `src-tauri/src/formats/scrivener.rs:85-120`
  - from `STATUS.md:1505`
- [ ] **Start each PDF chapter on a right-hand (odd) page** · Spec gap · `pdf-recto-chapters`
  - Done when: PDF export inserts a blank verso when needed so every chapter opens on an odd page; unit test asserts parity.
  - Where: `src-tauri/src/formats/pdf.rs:211-216`, `src-tauri/src/formats/pdf.rs:384-386`
  - from PROMPT implementation notes, `FORMATS.md:88`
- [ ] **Warn when PDF title page, running head or /Info fields lose characters to WinAnsi** · Spec gap · `pdf-metadata-winansi-warning`
  - Done when: export_pdf_characters_replaced also covers book title, author and byline; test with a Polish/Czech author name.
  - Where: `src-tauri/src/formats/pdf.rs:780-793`, `src-tauri/src/formats/pdf.rs:203-204`, `src-tauri/src/formats/pdf.rs:286`
  - from `FORMATS.md:103`
- [ ] **Warn when a Scrivener import drops keywords** · Spec gap · `scrivener-keywords-warning`
  - Done when: An import_scrivener_keywords_dropped code (EN+ES) appears in the preview when keywords exist.
  - Where: `src-tauri/src/formats/scrivener.rs:18-21`, `src-tauri/src/formats/scrivener.rs:105-119`
  - from `FORMATS.md:18`
- [ ] **Copy or warn about images on Markdown import** · Spec gap · `markdown-images-import`
  - Done when: Markdown import raises import_images_dropped or copies the files when it sees image links.
  - Where: `src-tauri/src/formats/markdown.rs:158-223`, `src-tauri/src/formats/docx.rs:19`
  - from `FORMATS.md:19`, `FORMATS.md:225`

### P2 · Updates and releases

- [ ] **Check for updates every 12 h while running, not only at start-up** · Spec gap · `update-every-12h`
  - Done when: An automatic check fires every 12 h (respecting channel/token), with a unit test on the timer.
  - Where: `src/lib/update/state.svelte.ts:98-110`, `src/App.svelte:570`
  - from PROMPT implementation notes
- [ ] **Show the unsigned-build notice and the package hash in the update dialog** · Spec gap · `update-dialog-unsigned-hash`
  - Done when: Update dialog names the build as not signed by an OS vendor and shows the package sha256, EN+ES.
  - Where: `src/lib/components/UpdateDialog.svelte:36-80`, `locales/en/ui.json:832`, `locales/en/ui.json:841`
  - from PROMPT implementation notes
- [ ] **Test the release on Intel Macs, the .rpm and the AppImage** · Manual check · `release-artifacts-untested`
  - Done when: Each artifact of the latest release installs and opens a novel; README platform lines updated in both languages.
  - Where: `docs/project/STATUS.md:12-14`, `README.md`, `README.md`
  - from `STATUS.md:12`, `README.md`, `README.md`

### P2 · Copy and translations

- [ ] **Have a native speaker review the Settings Spanish strings written by the build** · Manual check · `es-settings-review`
  - Done when: Spanish Settings copy (including the Allow writing… dialog, D6) reviewed and corrected in locales/es/ui.json.
  - Where: `locales/es/ui.json`
  - [details](#settings-regrouped-the-checks-no-automation-reaches-and-what-it-left)
- [ ] **Correct updates.gatekeeper: Microsoft does not notarize builds** · Bug · `gatekeeper-copy-fix`
  - Done when: EN/ES updates.gatekeeper say builds are not notarized by Apple nor Authenticode-signed for Windows.
  - Where: `locales/en/ui.json:832`, `locales/es/ui.json:832`, `src/lib/settings/UpdatesSection.svelte:99`
- [ ] **Default the UI language to the system locale on first run** · Spec gap · `system-locale-default`
  - Done when: With no saved uiLocale, the app picks es when the system locale is Spanish, else en; unit test.
  - Where: `src-tauri/src/commands/settings.rs:370`, `src/lib/i18n/state.svelte.ts:10`, `src/lib/i18n/state.svelte.ts:68-83`
  - from PROMPT implementation notes
- [ ] **Support plurals in i18n** · Spec gap · `plural-i18n`
  - Done when: t() supports plural forms and count strings use them in both locales.
  - Where: `src/lib/i18n/state.svelte.ts:22-28`
  - from PROMPT implementation notes

### P2 · Design and themes

- [ ] **Confirm on a machine with Source Serif 4 installed that choosing it changes the page** · Manual check · `source-serif-installed-check`
  - Done when: With Source Serif 4 installed, choosing it visibly changes the editor page from Iowan Old Style; recorded.
  - Where: `fonts/catalog.json:36-45`, `src/lib/settings/TypographySection.svelte:87-106`
  - [details](#settings-over-the-editor-the-checks-no-automation-reaches-and-what-it-left); from `STATUS.md:1193-1194`
- [ ] **Apply --accent to headings as the Folio table asks, or record otherwise** · Spec gap · `accent-headings`
  - Done when: Editor headings and/or section titles use --accent, or the maintainer decides against it and the note is updated.
  - Where: `src/styles.css:744-754`, `src/styles.css:17`, `docs/project/DESIGN-VERSORIUM.md:255`
  - from `DESIGN-VERSORIUM.md:255`
- [ ] **Show the status-bar word count with tabular-nums** · Spec gap · `tabular-nums-count`
  - Done when: The status bar count uses font-variant-numeric: tabular-nums (and the numeric font if the maintainer wants).
  - Where: `src/lib/components/StatusBar.svelte:73`, `src/styles.css:1372-1374`
  - from `DESIGN-VERSORIUM.md:267`
- [ ] **Use or remove unused theme tokens (--human, --cli, --local, --api, --privacy-api)** · Chore · `unused-tokens`
  - Done when: Every token in styles.css is used by a var(...) or removed and documented.
  - Where: `src/styles.css:21`, `src/styles.css:26`, `src/styles.css:111-113`
  - from `DESIGN-VERSORIUM.md:250`
- [ ] **Give CoverPreview's fade an ease-out curve** · Chore · `coverpreview-ease`
  - Done when: CoverPreview.svelte:58 declares 'transition: opacity 150ms ease-out'.
  - Where: `src/lib/components/CoverPreview.svelte:58`
  - from `DESIGN-VERSORIUM.md:276`
- [ ] **Make tests/icons/generate.py default to the committed paper variant** · Chore · `icon-script-default`
  - Done when: The script's default matches make icons (paper), or the default is documented.
  - Where: `tests/icons/generate.py:358`, `Makefile:98-99`
  - from `DESIGN-VERSORIUM.md:282`
- [ ] **Add a favicon (the V) linked from src/index.html** · Spec gap · `favicon`
  - Done when: src/index.html links a small icon present in the repo.
  - Where: `src/index.html`
  - from `DESIGN-VERSORIUM.md:283`

### P2 · Accessibility

- [ ] **Move hand-written controls in Settings (Updates, Backup, Appearance, App) to form primitives** · Half-done · `form-controls-settings`
  - Done when: UpdatesSection (2), BackupGroup (1, token field), AppearanceGroup (1), AppGroup (1) use Field/TextField/NumberField/Select/Checkbox with hints in aria-describedby and status outside the label; the TODO.md recount shows them gone; make verify green.
  - Where: `src/lib/settings/UpdatesSection.svelte:73`, `src/lib/settings/UpdatesSection.svelte:86`, `src/lib/settings/groups/BackupGroup.svelte:556`
  - [details](#form-controls-still-hand-written); from `STATUS.md:2389`
- [ ] **Move hand-written controls in Manuscript, Rewrite, Rename, New chapter/project dialogs** · Half-done · `form-controls-dialogs`
  - Done when: ManuscriptDialog (3), RewriteDialog (1), RenameDialog (1), NewChapterDialog (1), NewProjectDialog (1) use the shared primitives; Checkbox stays strictly controlled; accessible-name specs still pass.
  - Where: `src/lib/components/ManuscriptDialog.svelte:178`, `src/lib/components/ManuscriptDialog.svelte:193`, `src/lib/components/ManuscriptDialog.svelte:244`
  - [details](#form-controls-still-hand-written)
- [ ] **Move hand-written controls in Onboarding and GitPanel to form primitives** · Half-done · `form-controls-onboarding-git`
  - Done when: Onboarding.svelte (1) and GitPanel.svelte (2) use the shared primitives; the recount returns no hand-written tags outside components/forms/.
  - Where: `src/lib/onboarding/Onboarding.svelte:105`, `src/lib/components/GitPanel.svelte:174`, `src/lib/components/GitPanel.svelte:214`
  - [details](#form-controls-still-hand-written)
- [ ] **Design and build RadioCardGroup for the export-format picker** · Spec gap · `radio-card-group`
  - Done when: A designed RadioCardGroup in src/lib/components/forms/ keeps fieldset/legend and a real input type=radio per option, puts the blurb in aria-describedby, wraps any :has() focus ring in @supports selector(:has(*)); ManuscriptDialog uses it.
  - Where: `src/lib/components/ManuscriptDialog.svelte:178`, `src/lib/components/forms/`
  - [details](#radiocardgroup-is-named-not-designed-or-written); from `STATUS.md:2393-2395`
- [ ] **Run VoiceOver and NVDA over the About links' accessible names** · Manual check · `about-links-screen-readers`
  - Done when: VoiceOver and NVDA read each link as its words then '(opens in your browser)', the author's with the address; recorded.
  - [details](#settings--about-and-the-release-names-the-checks-no-automation-reaches); from `STATUS.md:2101`
- [ ] **VoiceOver pass over Settings: rail, page titles, alert dialog, task selects** · Manual check · `settings-voiceover`
  - Done when: On macOS VoiceOver: the rail reads as navigation with four labelled lists and 'current page'; page title announced on open; Allow writing… announced as alert with first paragraph; task selects read with their hint; recorded.
  - Where: `src/lib/settings/pages.ts`
  - [details](#settings-regrouped-the-checks-no-automation-reaches-and-what-it-left); from `STATUS.md:1852`
- [ ] **Check notices with VoiceOver, Option+Tab and Escape in WKWebView** · Manual check · `notices-real-webviews`
  - Done when: In WKWebView: VoiceOver reads hints once politely and errors once as alert (not again on in-place word change); Option+Tab reaches Close; Escape closes and leaves Focus on; clicking Close keeps the caret.
  - Where: `src/lib/notices/Notices.svelte:122`
  - [details](#notifications-the-checks-no-automation-reaches-and-what-is-left); from `STATUS.md:894`
- [ ] **Bring the open card's id, status and word count to 4.5:1 contrast** · Bug · `card-meta-contrast`
  - Done when: In all six themes the open card's meta line measures at least 4.5:1, checked by the test from `contrast-test`.
  - Partly done: The text-mute fix (232376e) lifted Folio light: computed on the active card's background (10% accent mixed into bg-elev) it is now 4.69. Folio dark is still 3.91 and Quarry dark 4.47, both under 4.5. No Playwright contrast check covers the card; chrome.spec.ts has a contrastOf helper that could be reused.
  - Where: `src/lib/binder/Corkboard.svelte:97`, `src/lib/binder/Corkboard.svelte:100`, `src/lib/binder/Corkboard.svelte:114`
  - from `STATUS.md:1510`
- [ ] **Extend prefers-reduced-motion to fields, buttons, CoverPreview and onboarding** · Half-done · `reduced-motion-coverage`
  - Done when: With reduced motion on, no transitions remain in fields/buttons/selects (styles.css:222,319,486-488), CoverPreview or onboarding steps.
  - Where: `src/styles.css:1694-1718`, `src/styles.css:226`, `src/styles.css:324`
  - from `DESIGN-VERSORIUM.md:277`
- [ ] **Review contrast surface by surface across the six themes** · Manual check · `contrast-surface-review`
  - Done when: A list of every on-screen text/background pair per theme with its ratio exists; failures fixed or recorded.
  - Where: `src/styles.css`, `docs/project/DESIGN-VERSORIUM.md:258`
  - from `DESIGN-VERSORIUM.md:258`

### P2 · Linux

- [ ] **Check binder, top bar and Focus shortcuts and inert in Linux WebKitGTK** · Manual check · `chrome-focus-webkitgtk`
  - Done when: On WebKitGTK 2.40+, Ctrl+Shift+S/T/F reach the page and the folded panel and bar are inert.
  - [details](#collapsible-binder-and-top-bar-the-checks-no-automation-reaches)
- [ ] **Check WebKitGTK right-clicks on disabled controls and checkboxes show no page menu** · Manual check · `right-click-webkitgtk-disabled`
  - Done when: On Linux, right-click on the disabled Creative button and on a row while a chapter loads shows no page menu, and right-click on a checkbox or label leaves it unchanged; else .v-list-item:disabled and .v-corkcard:disabled get pointer-events: none.
  - Where: `src/styles.css:1448`
  - [details](#right-click-the-checks-no-automation-reaches); from `STATUS.md:269`
- [ ] **Add Cantarell to the Linux UI stack and align catalogue system-ui with the chrome** · Spec gap · `cantarell-ui-stack`
  - Done when: src/styles.css and fonts/catalog.json include Cantarell; the catalogue's system-ui stack equals the chrome's including 'Inter Variable'.
  - Where: `src/styles.css:165-177`, `fonts/catalog.json:20`, `docs/project/DESIGN-VERSORIUM.md:174`
  - from `DESIGN-VERSORIUM.md:245`

### P2 · Windows

- [ ] **Verify WebView2 spelling is on by default and autocorrect="off" stops word replacement** · Manual check · `spelling-webview2`
  - Done when: On a Windows 11 release build (Edge 153+): misspellings underline without toggling anything and typed misspellings are not auto-replaced; logged in STATUS.md.
  - Where: `src-tauri/src/spelling.rs:16-17`, `src/lib/editor/preferences.ts:131`
  - [details](#spelling-on-linux-and-on-the-release-builds)
- [ ] **Check Settings task selects' arrow keys and 400 ms announcement on WebView2** · Manual check · `settings-selects-webview2`
  - Done when: On WebView2: arrowing a closed select saves every change in order with the last standing (ModelsStore.setSlot chain) and announces only the settled choice 400 ms after the last change.
  - [details](#settings-regrouped-the-checks-no-automation-reaches-and-what-it-left); from `STATUS.md:1853`
- [ ] **Check browser keys, item menu and shortcuts in a Windows WebView2 release build** · Manual check · `right-click-webview2-release`
  - Done when: In a Windows release build: F5, Ctrl+R, Ctrl+P do nothing; Menu and Shift+F10 on a row open the item menu once; right-click on a row opens it; text and fields keep their spelling menu; Ctrl+Shift+S/T/F work without Edge features; if preventDefault fails, apply SetAreBrowserAcceleratorKeysEnabled(false).
  - Where: `src/lib/contextmenu/policy.ts:308`, `src/lib/contextmenu/policy.ts:339`
  - [details](#collapsible-binder-and-top-bar-the-checks-no-automation-reaches); from `STATUS.md:267`, `STATUS.md:269`, `STATUS.md:2412`
- [ ] **Remove Print from WebView2's selected-text menu, or record keeping it** · Bug · `webview2-print-menu`
  - Done when: Print no longer appears on WebView2's selected-text menu, or the decision to keep it is recorded.
  - Where: `docs/project/STATUS.md:270`, `src/lib/contextmenu/policy.ts:124`
  - from `STATUS.md:270`

### P2 · macOS

- [ ] **Check spelling in the macOS release bundle (underline, guesses, menu tick)** · Manual check · `spelling-macos-release`
  - Done when: In make bundle's app: a misspelling is underlined, right-click shows guesses, and 'Check Spelling While Typing' is ticked; noted in STATUS.md.
  - Where: `src-tauri/src/spelling.rs`
  - [details](#spelling-on-linux-and-on-the-release-builds); from `STATUS.md:312`, `STATUS.md:2416`
- [ ] **Check macOS Tab/Option-Tab reach of the Settings rail in the real app** · Manual check · `macos-tab-rail-real-app`
  - Done when: In the app, with and without Full Keyboard Access, Tab/Option-Tab reach the rail's pages and the Continuity link returns focus on Escape.
  - Where: `tests/e2e/settings-nav.spec.ts`
  - [details](#settings-regrouped-the-checks-no-automation-reaches-and-what-it-left)
- [ ] **Check Settings over the editor and the chosen face in the real webviews** · Manual check · `settings-over-editor-wkwebview`
  - Done when: In the bundled app on each OS: Edit → Undo from the menu bar leaves the page alone with Settings open, VoiceOver finds nothing of the covered page, Option+Tab never lands in it, Back to the manuscript restores caret and undo; recorded in STATUS.md.
  - Where: `src/lib/editor/preferences.ts`
  - [details](#settings-over-the-editor-the-checks-no-automation-reaches-and-what-it-left); from `STATUS.md:1193`
- [ ] **Hand-check collapsible binder, top bar and Focus in macOS WKWebView** · Manual check · `chrome-focus-wkwebview`
  - Done when: In WKWebView: ⌃⌘S, ⌥⌘T, ⇧⌘F reach the page; ⋯ focuses its first item and Escape stays in the menu; the rail text renders bottom to top; Focus's faded rail and lip show only on hover; the full-screen lip is clickable; Option+Tab reaches rail, lip, both Hides, ⋯ and items; clicking Hide/rail/lip keeps the caret.
  - Where: `tests/e2e/chrome.spec.ts`
  - [details](#collapsible-binder-and-top-bar-the-checks-no-automation-reaches)
- [ ] **Check right-click and keyboard reach in a macOS WKWebView release build** · Manual check · `right-click-macos-release`
  - Done when: In a macOS release build: real Ctrl+click and two-finger click on a binder row and Save snapshot behave per policy.ts; Tab/Option+Tab reach rows, ⋯ and cards with Full Keyboard Access off and on; VO-Shift-M works on a card.
  - Where: `src/lib/contextmenu/policy.ts`, `docs/project/STATUS.md:2412-2414`
  - [details](#right-click-the-checks-no-automation-reaches); from `STATUS.md:2412-2414`
- [ ] **Measure the first-run Metal compile on a low-end Mac (M1 Air)** · Manual check · `metal-compile-m1`
  - Done when: First-run Metal compile time on an M1 Air (or similar) is measured and recorded in STATUS.md.
  - Where: `docs/project/STATUS.md:2571-2573`, `src-tauri/src/llama/runtime.rs:97`
  - from `STATUS.md:2571-2573`

### P2 · Tests and CI

- [ ] **Make the mock's import preview send warning codes, as Rust does** · Bug · `mock-import-warning-codes`
  - Done when: tests/e2e/mock-tauri.ts returns warning codes; the Spanish mock shows Spanish warnings.
  - Where: `tests/e2e/mock-tauri.ts:297-300`, `src/lib/components/ManuscriptDialog.svelte:280-282`, `src-tauri/src/formats/scrivener.rs:18-19`
  - from `STATUS.md:1513`, `STATUS.md:1515`
- [ ] **Add an automated WCAG contrast test for the theme tokens** · Chore · `contrast-test`
  - Done when: A vitest computes ratios for the key pairs (editor text at least 7:1, chrome text and card meta at least 4.5:1) in all six themes and fails below them; it is the one automated contrast check.
  - Partly done: A WCAG contrast test exists, but it only checks --text-mute against every --bg-* token (4.5:1) in all six themes. Editor ink on page (7:1) and other chrome pairs such as --text and --accent are not checked. The DESIGN doc's 'no test checks it' is stale for --text-mute only.
  - Where: `tests/unit/text-mute-contrast.test.ts:1-40`, `src/styles.css`
  - from `DESIGN-VERSORIUM.md:258`
- [ ] **Run the crash panic-hook scrubber test in CI or a make target** · Risk · `crash-hook-test-runs`
  - Done when: hook_writes_a_scrubbed_record runs in CI (single-threaded job) or a make target runs it.
  - Where: `src-tauri/src/crash/mod.rs:493-495`, `Makefile:76-77`, `.github/workflows/ci.yml:94-98`
  - from `STATUS.md:77`, `AGENTS.md#Commands`
- [ ] **Run the ignored live tests once, with maintainer consent, and record results** · Manual check · `run-live-tests`
  - Done when: With the maintainer's consent the live tests are run and results recorded in STATUS.md.
  - Where: `Makefile:76-77`, `docs/project/STATUS.md:77`
  - from `STATUS.md:77`, `AGENTS.md#Commands`
- [ ] **Run the side-effect-free live format checks (pandoc, poppler, epubcheck) in CI** · Chore · `live-format-checks-ci`
  - Done when: A CI job installs pandoc, poppler and JDK+epubcheck and runs the three formats:: live tests, keeping output as an artifact.
  - Where: `.github/workflows/ci.yml:94-98`, `src-tauri/src/formats/docx.rs:1202`, `src-tauri/src/formats/epub.rs:1146`
  - from `FORMATS.md:388`
- [ ] **Bring the /tmp/m5 fixtures into the repo so two tests stop passing vacuously** · Chore · `m5-fixtures-into-repo`
  - Done when: Fixtures live under tests/ or are generated; the tests fail when missing; DOCX tracked-change/field-code handling exercised in CI; epubcheck is fetched to one configurable path outside /tmp (Makefile EPUBCHECK_DIR and the epub.rs live test read it).
  - Where: `src-tauri/src/formats/docx.rs:965-970`, `src-tauri/src/formats/scrivener.rs:1093`
  - from `FORMATS.md:409`
- [ ] **Diagnose the one unexplained cargo test failure** · Risk · `unexplained-cargo-failure`
  - Done when: Repeated cargo test runs (e.g. 50, logs kept) show no failure, or the failing test is found and fixed.
  - Unclear: Repeated runs are needed to diagnose it, which needs repeated runs. The timing-sensitive lock tests (elapsed >= 150ms, sleep 100ms at git/lock.rs:166,177) are plausible candidates for a flake under load, but this is not confirmed.
  - Where: `src-tauri/src/git/lock.rs:160-180`
  - [details](#unexplained); from `STATUS.md:2420-2427`
- [ ] **Investigate Playwright setup-time flakes (newContext closed, page setup timeout)** · Risk · `playwright-setup-flakes`
  - Done when: The cause in notices.spec.ts and chrome.spec.ts is found, or retries are configured deliberately and documented.
  - Where: `playwright.config.ts:10`, `tests/e2e/notices.spec.ts`, `tests/e2e/chrome.spec.ts`
  - from `STATUS.md:2089-2092`, `STATUS.md:2209-2212`
- [ ] **Add a CI smoke test for built-in inference with a tiny GGUF fixture** · Chore · `inference-ci-smoke`
  - Done when: CI downloads/caches a small sha256-checked GGUF and runs one generation on at least one OS.
  - Where: `.github/workflows/ci.yml:94-98`, `src-tauri/src/llama/runtime.rs`
  - from `STATUS.md:2578-2580`
- [ ] **Measure and test the spec §17 acceptance criteria** · Spec gap · `acceptance-criteria-17`
  - Done when: Tests or recorded measurements exist for: rewind under 100 ms on a 4k-word chapter with 230 edits, OpenCode replacing a paragraph via MCP, clone on another PC, fully offline with a MID GGUF, and a DOCX opening in Word in manuscript format.
  - Where: `docs/project/PROMPT-VERSORIUM.md:616`, `src-tauri/src/ops/`, `src-tauri/tests/mcp_stdio.rs`
  - from PROMPT implementation notes, `STATUS.md:2846-2855`
- [ ] **Stop hardcoding Homebrew pnpm and java paths in the Makefile** · Chore · `makefile-paths`
  - Done when: PNPM/JAVA default to PATH lookups with Homebrew paths as a fallback; make verify works on a clean machine.
  - Where: `Makefile:5-11`
- [ ] **Add a test path for the 'three destinations' backup hint (backup.full)** · Half-done · `backup-full-test`
  - Done when: A test raises backup.full and checks its notice, or the hint is removed.
  - Where: `src/lib/settings/groups/BackupGroup.svelte:64`, `src/lib/settings/groups/BackupGroup.svelte:133-137`, `src/lib/settings/groups/BackupGroup.svelte:386`
  - from `STATUS.md:947`

### P2 · Documentation

- [ ] **Refresh STATUS.md's 'Still open', 'Known holes' and 'Next' to the current state** · Chore · `refresh-status-md`
  - Done when: STATUS.md's sections "Still open", "Known holes" and "Next" describe today: the public repository, v0.1.0 to v0.1.2, the landing on Vercel, the proven tokenless update, no LocalAiSection port bug, the hand-written control count from the recount command, and Scrivener import saving synopses.
  - Where: `docs/project/STATUS.md:2389-2394`, `docs/project/STATUS.md:2399-2407`, `docs/project/STATUS.md:2439-2440`
  - from `STATUS.md:2384`, `STATUS.md:2389`, `STATUS.md:2399-2408`
- [ ] **Refresh PROMPT-VERSORIUM.md notes: repo public, CLA, releases, secrets, anonymous updates** · Chore · `refresh-prompt-notes`
  - Done when: Notes for §0.9, §0.11/§0.13, Packaging, §11 (secret names, no release, anonymous update path now proven on the public repo) and §17 v0.1.0 are updated or marked superseded with dates.
  - Where: `docs/project/PROMPT-VERSORIUM.md:519`, `docs/project/PROMPT-VERSORIUM.md:520`, `docs/project/PROMPT-VERSORIUM.md:594`
  - from PROMPT implementation notes, `AGENTS.md#State of things outside the code`
- [ ] **Fix the stale llama module doc that says Vulkan is not built** · Chore · `llama-doc-stale`
  - Done when: llama/mod.rs says Vulkan ships in Windows/Linux release builds and CUDA is deliberately off.
  - Where: `src-tauri/src/llama/mod.rs:5-6`, `src-tauri/Cargo.toml:96`, `.github/workflows/release.yml:85`
  - from `REFERENCE.md:58`

## P3 — larger features and ideas

New features and spec items not started. Each needs a design before code.

### P3 · Editor

- [ ] **Build notes anchored to the project, a chapter or any span (margin comments)** · Feature · `anchored-notes-build`
  - Done when: Writers add/edit/delete project, chapter and span notes stored in the novel folder (git and zip backups), never in manuscript or exports unless asked, surviving edits; MCP writes follow permission/preview/checkpoint; EN+ES; no note text in crash logs.
  - Where: `src-tauri/src/commands/`
  - [details](#notes-on-the-novel-anchored-anywhere-like-comments-in-google-docs); from PROMPT implementation notes
- [ ] **Add a command palette (Ctrl/Cmd+K)** · Feature · `command-palette`
  - Done when: Ctrl/Cmd+K opens a keyboard-accessible palette of chapters and actions, EN/ES, with an e2e spec.
  - Where: `src/App.svelte:459`, `src/lib/chrome/`
  - from PROMPT implementation notes
- [ ] **Make Codex names clickable in the editor** · Feature · `codex-clickable-names`
  - Done when: Codex entry names are decorated and open the entry on click.
  - Where: `src/lib/editor/cm.ts`
  - from PROMPT implementation notes
- [ ] **Add a chapter inspector to the right column, or record it dropped** · Spec gap · `chapter-inspector`
  - Done when: The right column shows chapter metadata per spec, or the maintainer records it as dropped.
  - Where: `src/App.svelte:700-720`
  - from PROMPT implementation notes
- [ ] **Add language-specific quotes in the editor** · Spec gap · `language-quotes`
  - Done when: Typing quotes yields the manuscript language's style (e.g. «» for es).
  - Where: `src/lib/editor/preferences.ts`, `src/lib/editor/cm.ts`
  - from PROMPT implementation notes
- [ ] **Count words according to the manuscript language** · Spec gap · `language-aware-word-count`
  - Done when: After `one-word-counter`: the shared counter segments words with Intl.Segmenter / unicode-segmentation for the novel's language; a test counts a Spanish and an English sample.
  - Where: `src-tauri/src/commands/project.rs:449-450`, `src/lib/components/StatusBar.svelte:53-55`, `src-tauri/src/formats/mod.rs:160-166`
  - from PROMPT implementation notes
- [ ] **Add a zen mode to the editor** · Feature · `zen-mode`
  - Done when: A zen mode hides every panel but the page, toggles from the status bar and a shortcut, is labelled in EN and ES, and an e2e spec turns it on and off.
  - Where: `src/lib/editor/modes.ts:91-112`
  - from PROMPT implementation notes
- [ ] **Add a split view of two chapters** · Feature · `split-view`
  - Done when: Two chapters can be open side by side, each editable and saving on its own; an e2e spec edits both.
  - Where: `src/lib/editor/modes.ts:91-112`
  - from PROMPT implementation notes
- [ ] **Add word-count goals per session and per chapter** · Feature · `word-goals`
  - Done when: The writer sets a goal, the status bar shows progress toward it in EN and ES, and a unit test covers the count.
  - Where: `src/lib/editor/modes.ts:91-112`
  - from PROMPT implementation notes

### P3 · Binder and corkboard

- [ ] **Create plot/beats.yml when a project is created** · Spec gap · `plot-beats-yml`
  - Done when: New projects contain plot/beats.yml; a project.rs test asserts it.
  - Where: `src-tauri/src/commands/project.rs:198`, `src-tauri/src/commands/project.rs:235`
  - from PROMPT implementation notes
- [ ] **Add acts and scenes to the Binder, with outliner and timeline views** · Feature · `binder-acts-scenes`
  - Done when: The binder lists each chapter's ## scenes under it and opens one at its heading; outliner and timeline views exist after the owner approves their design; e2e specs cover each.
  - Where: `src/lib/binder/ChapterList.svelte`, `src/lib/binder/store.svelte.ts`
  - from PROMPT implementation notes
- [ ] **Build Codex and Research UI** · Feature · `codex-research-ui`
  - Done when: The writer can list, open, edit and create entries of codex/ and research/ inside the app, saved as files in those folders; an e2e spec covers each action.
  - Where: `src-tauri/src/mcp/tools.rs:128`, `src/lib/binder/`
  - from PROMPT implementation notes

### P3 · Settings

- [ ] **Add a model picker under each assistant in Settings → Tasks and Assistants** · Feature · `assistant-model-picker`
  - Done when: Rewrite and Assistants show 'Default' first, a curated or CLI list and a free-text id, EN+ES, saying which model will answer.
  - Where: `src-tauri/src/commands/settings.rs:14-17`, `src/lib/settings/groups/TasksGroup.svelte`, `src/lib/settings/groups/AssistantsGroup.svelte:28`
  - [details](#choose-the-model-an-assistant-uses-owner-2026-10-05)
- [ ] **Implement a compact / regular / roomy density setting** · Feature · `density-setting`
  - Done when: Appearance offers three densities persisted in settings.json that change spacing tokens, EN/ES.
  - Where: `docs/project/DESIGN-VERSORIUM.md:231`, `docs/project/DESIGN-VERSORIUM.md:271`, `src/lib/settings/groups/AppearanceGroup.svelte`
  - from `DESIGN-VERSORIUM.md:274`

### P3 · History and snapshots

- [ ] **Add a Rust per-file diff between any two snapshots, or a snapshot and the working tree** · Feature · `snapshot-diff-backend`
  - Done when: A Tauri command (wrapper + mock handler) returns a chapter's old/new text for commit-to-commit and commit-to-workdir via git2 diffs, with unit tests.
  - Where: `src-tauri/src/git/repo.rs:117-130`, `src-tauri/src/commands/git.rs:18`
  - [details](#see-what-changed-the-way-a-code-editor-shows-it)
- [ ] **Replace the raw patch in the history diff tab with a word-level merge view** · Feature · `merge-view-diff`
  - Done when: GitPanel's diff tab shows side-by-side and unified [earlier] [action] [current] views with word-level --diff-add/--diff-del highlighting; the writer picks what to compare.
  - Where: `src/lib/components/GitPanel.svelte:202`, `src/lib/ai/diff.ts`
  - [details](#see-what-changed-the-way-a-code-editor-shows-it)
- [ ] **Add the 'two points in time against today' comparison layout** · Feature · `three-way-compare`
  - Done when: The writer picks two snapshots and sees [earlier] [later] [action] [current].
  - Where: `src/lib/components/GitPanel.svelte:202`
  - [details](#see-what-changed-the-way-a-code-editor-shows-it)
- [ ] **Add the comparison-with-notes layout (earlier, current, anchored notes)** · Feature · `compare-with-notes`
  - Done when: The comparison view shows a third column of notes anchored to the compared passages.
  - Where: `src/lib/components/GitPanel.svelte`
  - [details](#see-what-changed-the-way-a-code-editor-shows-it)
- [ ] **Handle diverged histories on Pull (merge or conflict-* branch)** · Feature · `diverged-pull`
  - Done when: A diverged pull offers a merge or saves the remote side to a conflict-* branch without losing local text, or fast-forward-only is recorded as final.
  - Where: `src-tauri/src/git/repo.rs:405-411`, `src-tauri/src/git/repo.rs:445-446`
  - from PROMPT implementation notes, `STATUS.md:2261-2262`
- [ ] **Add a document history scrubber and rollback by sentence, paragraph or chapter** · Feature · `history-scrubber`
  - Done when: The owner approves a design; then a chapter's ops can be replayed with a scrubber, and restoring a sentence, paragraph or chapter from it snapshots first, covered by an e2e spec.
  - Where: `src/lib/git/rollback.ts`, `src/lib/git/ops.ts`
  - from PROMPT implementation notes
- [ ] **Show span blame in the UI** · Feature · `span-blame-ui`
  - Done when: The writer can see who (human or ai:client) wrote a selected span.
  - Where: `src/lib/mcp/activity.ts:20`, `src/styles.css:766`
  - from PROMPT implementation notes
- [ ] **Give the ops-log chapter snapshots a reader** · Half-done · `ops-snapshots-reader`
  - Done when: A screen reads the every-200-ops snapshots back.
  - Where: `src-tauri/src/ops/mod.rs:156`, `src-tauri/src/ops/mod.rs:43`
  - from `REFERENCE.md:32`

### P3 · Backups

- [ ] **Add an unchecked Public option when creating the novel's remote** · Spec gap · `remote-public-checkbox`
  - Done when: Create-remote has an unchecked Public option with a warning; default remains private.
  - Where: `src-tauri/src/commands/git.rs:90-94`, `src/lib/settings/groups/BackupGroup.svelte`
  - from PROMPT implementation notes
- [ ] **Add a separate Fetch action in Backup** · Spec gap · `backup-fetch-action`
  - Done when: Settings → Backup has Fetch that updates remote status without changing files.
  - Where: `src-tauri/src/commands/git.rs:126-130`, `src/lib/settings/groups/BackupGroup.svelte`
  - from PROMPT implementation notes
- [ ] **Add 'Open in GitHub Desktop' with a download link** · Spec gap · `github-desktop-button`
  - Done when: A button opens the novel in GitHub Desktop or links to its download.
  - Where: `src/lib/settings/groups/BackupGroup.svelte`
  - from PROMPT implementation notes

### P3 · AI and assistants

- [ ] **Build Project chat on its existing slot** · Feature · `project-chat`
  - Done when: The writer opens a conversation about the novel with the Chat slot's model; Settings → Tasks gives it a working control; notBuilt.chat removed; EN+ES.
  - Where: `src-tauri/src/commands/settings.rs:33`, `src/lib/settings/ai/picks.ts:15`, `src/lib/settings/groups/TasksGroup.svelte:214`
  - [details](#specified-not-started); from `STATUS.md:2396-2399`, `REFERENCE.md:84`, `README.md`
- [ ] **Build search by meaning with the Nomic embeddings index** · Feature · `semantic-search`
  - Done when: An index in .versorium/embeddings/ built with nomic-embed-text-v15-q4km stays local, a search box queries it, Tasks → Search has a control, notBuilt.search removed.
  - Where: `src-tauri/src/commands/project.rs:205`, `src-tauri/src/commands/settings.rs:35`, `models/catalog.json:233`
  - [details](#specified-not-started); from `STATUS.md:2397`, `REFERENCE.md:85`
- [ ] **Verify each requested provider's API, CLI and MCP details against current docs** · Chore · `provider-docs-research`
  - Done when: Each provider row (Cursor, Grok, Antigravity, OpenRouter, Devin, Z.ai, Copilot) is confirmed or corrected and every '(check)' resolved.
  - [details](#more-ai-providers-api-keys-mcp-and-assistants-owner-2026-10-04)
- [ ] **Add an OpenAI-compatible API slot kind (BYOK) with keys in the OS credential store** · Feature · `byok-api-slot`
  - Done when: SlotAssignment gains an api kind (base URL, model, key) dispatched in agents::rewrite with /models listing; keys only via src-tauri/src/secrets, never in settings, logs, crash files or MCP activity; key field shows only whether set.
  - Where: `src-tauri/src/commands/settings.rs:40`, `src-tauri/src/agents/mod.rs:532-547`, `src-tauri/src/secrets/mod.rs:39-46`
  - [details](#more-ai-providers-api-keys-mcp-and-assistants-owner-2026-10-04); from PROMPT implementation notes
- [ ] **Warn plainly (--warn banner) that an API model sends the passage off the computer** · Feature · `api-leaves-computer-warning`
  - Done when: An inline --warn banner in EN+ES shows wherever an API slot is chosen or used, before text is sent; the landing's 'Does my novel leave my computer?' answer is updated.
  - Where: `src/lib/settings/ai/picks.ts:25`, `src/lib/settings/groups/TasksGroup.svelte:108-123`, `src/lib/components/RewriteDialog.svelte:24`
  - [details](#more-ai-providers-api-keys-mcp-and-assistants-owner-2026-10-04); from `DESIGN-VERSORIUM.md:253`
- [ ] **Detect more assistant CLIs and desktop harnesses (Cursor, Grok, Gemini, Copilot)** · Feature · `cli-harnesses-more`
  - Done when: Verified CLIs are in CLI_HARNESSES and detect_binaries, each run in an empty scratch folder; desktop harnesses detected if feasible; live_detect_and_rewrite_with_installed_agents covers them.
  - Where: `src-tauri/src/agents/mod.rs:319-326`, `src-tauri/src/agents/mod.rs:513-517`, `src/lib/settings/ai/picks.ts:21`
  - [details](#more-ai-providers-api-keys-mcp-and-assistants-owner-2026-10-04); from PROMPT implementation notes
- [ ] **Check each assistant CLI's model flag and model listing** · Chore · `cli-model-flag-research`
  - Done when: For Claude Code, Codex, OpenCode and new CLIs the flag, accepted ids/aliases and listing method are written down.
  - Where: `src-tauri/src/agents/mod.rs:513-517`
  - [details](#choose-the-model-an-assistant-uses-owner-2026-10-05)
- [ ] **Let a cli slot store an optional model and pass it to the assistant's CLI** · Feature · `cli-slot-model`
  - Done when: SlotAssignment has an optional model for cli slots covered by apply_patch and tests; cli_rewrite adds the flag only when set; a model the account cannot use fails with a clear error code.
  - Where: `src-tauri/src/commands/settings.rs:14-17`, `src-tauri/src/agents/mod.rs:539-542`, `src-tauri/src/agents/mod.rs:574-579`
  - [details](#choose-the-model-an-assistant-uses-owner-2026-10-05)
- [ ] **Name the model that answered in the MCP activity log and Rewrite dialog** · Feature · `name-answering-model`
  - Done when: Activity log and RewriteDialog show the assistant and model that answered.
  - Partly done: RewriteDialog's choices are slot assignments, so for builtin, ollama and server the chosen model id is known and shown. A CLI choice names only the assistant, never the model that answered. The MCP activity log (activity.ts) records the client and the tool, with no model.
  - Where: `src/lib/components/RewriteDialog.svelte:17`, `src/lib/components/RewriteDialog.svelte:60-90`, `src/lib/mcp/activity.ts:37`
  - [details](#choose-the-model-an-assistant-uses-owner-2026-10-05)
- [ ] **Add Describe, Shorten and Voice selection actions** · Feature · `describe-shorten-voice`
  - Done when: Each runs through a slot, shows the diff before applying like Rewrite, and checkpoints first.
  - Where: `src-tauri/src/agents/mod.rs:497`, `src-tauri/src/agents/mod.rs:532`, `src/lib/components/RewriteDialog.svelte`
  - from PROMPT implementation notes
- [ ] **Add a 'what was sent' screen per non-local AI call** · Feature · `what-was-sent`
  - Done when: Each call leaving the machine is logged with destination and payload, viewable in Settings.
  - Where: `src/lib/settings/groups/ActivityGroup.svelte`, `src-tauri/src/agents/mod.rs:574`
  - from PROMPT implementation notes

### P3 · MCP

- [ ] **Add Cursor, VS Code/Copilot and other verified clients to MCP catalog()** · Feature · `mcp-clients-catalog`
  - Done when: catalog() registers each verified client with per-OS paths, JSON/CLI strategy, backup before edit and read-only default, or REFERENCE keeps the untested note deliberately.
  - Where: `src-tauri/src/mcp/clients.rs:37`, `docs/project/REFERENCE.md:326`
  - [details](#more-ai-providers-api-keys-mcp-and-assistants-owner-2026-10-04); from `REFERENCE.md:326`
- [ ] **Add MCP tools apply_edit_set, rename_document and move_document** · Spec gap · `mcp-tools-edit-rename-move`
  - Done when: Tools follow permission → validate → preview → checkpoint → apply → ops, log ai:<client>, tested in mcp_stdio.
  - Where: `src-tauri/src/mcp/tools.rs:134`, `src-tauri/src/mcp/tools.rs:159`, `src-tauri/src/mcp/write.rs:33`
  - from PROMPT implementation notes
- [ ] **Add MCP tools continuity_check and rollback** · Spec gap · `mcp-tools-continuity-rollback`
  - Done when: Both exist; rollback goes through permission, preview and checkpoint; tested.
  - Where: `src-tauri/src/mcp/tools.rs:109`, `src-tauri/src/mcp/tools.rs:159`, `src-tauri/src/continuity/mod.rs`
  - from PROMPT implementation notes
- [ ] **Add MCP tools git_push and git_pull** · Spec gap · `mcp-tools-push-pull`
  - Done when: Tools sit behind write permission, use the novel's token never the updates one, tested.
  - Where: `src-tauri/src/mcp/tools.rs:157`, `src-tauri/src/mcp/write.rs:277`, `src-tauri/src/git/repo.rs`
  - from PROMPT implementation notes

### P3 · Models

- [ ] **Ship an ahead-of-time default.metallib once the Xcode Metal Toolchain works** · Feature · `metallib-aot`
  - Done when: macOS release builds bundle a precompiled metallib and first inference compiles no shaders.
  - Where: `src-tauri/src/llama/runtime.rs:101`, `src-tauri/src/commands/llama.rs:56`
  - from `STATUS.md:2570`, `STATUS.md:2573-2575`
- [ ] **Build dictation with a Whisper model pack and a runtime that loads it** · Feature · `dictation-whisper`
  - Done when: models/catalog.json has a 'task': 'dictation' entry with sha256 and size, a Whisper-capable runtime exists, and dictation types into the chapter; notBuilt.dictation removed.
  - Where: `models/catalog.json:3`, `models/catalog.json:9`, `locales/en/ui.json:314`
  - [details](#specified-not-started); from `STATUS.md:2398`, `STATUS.md:2447`, `STATUS.md:2576-2577`

### P3 · Import and export

- [ ] **Read the project's language from a Scrivener bundle, if Scrivener stores one** · Spec gap · `scrivener-language`
  - Done when: A real bundle is inspected; if it holds a language the importer pre-fills the picker (tested), otherwise that is recorded.
  - Where: `src-tauri/src/formats/scrivener.rs:121-125`, `src-tauri/src/formats/scrivener.rs:899-906`
  - [details](#synopses-are-kept-and-shown-but-nothing-writes-one); from `STATUS.md:1354`, `STATUS.md:1504`

### P3 · Copy and translations

- [ ] **Write uiLanguage from the current UI locale, or stop writing it** · Half-done · `ui-language-field`
  - Done when: versorium.json uiLanguage reflects the chosen locale or is removed, with a test.
  - Where: `src-tauri/src/commands/project.rs:20`, `src-tauri/src/commands/project.rs:215`, `src-tauri/src/commands/project.rs:692`
  - from PROMPT implementation notes

### P3 · Design and themes

- [ ] **Build the downloadable font catalogue (Source Serif 4 and the v1 pack)** · Feature · `font-downloader`
  - Done when: fonts/catalog.json lists v1 families with url, sha256, size and axes; Typography has Download/Ready states, verifies and registers via document.fonts; Source Serif 4 available; typography.downloadLater removed; verification tested.
  - Where: `fonts/catalog.json:3`, `fonts/catalog.json:36-45`, `src/lib/settings/TypographySection.svelte:119-121`
  - from PROMPT implementation notes, `DESIGN-VERSORIUM.md:262-263`, `STATUS.md:2678`
- [ ] **Add 'Add from folder' (local fonts) to Typography** · Feature · `fonts-from-folder`
  - Done when: The writer picks a font file/folder; it registers and persists as a body option.
  - Where: `src/lib/settings/TypographySection.svelte:80-121`, `src-tauri/src/fonts/mod.rs`
  - from `DESIGN-VERSORIUM.md:263`
- [ ] **Fit UI type sizes to the spec scale or extend the scale** · Spec gap · `type-scale`
  - Done when: Every size in use is on the scale, or the spec adds the agreed sizes.
  - Where: `src/lib/settings/TypographySection.svelte:95`, `src/lib/settings/models/DownloadProgress.svelte:44`, `src/lib/components/EmptyState.svelte:59`
  - from `DESIGN-VERSORIUM.md:269`
- [ ] **Introduce spacing tokens on the 4/8/12/16/24/32/48 scale** · Spec gap · `spacing-tokens`
  - Done when: Spacing tokens in :root used by fields, buttons and lists; off-scale paddings fixed or justified.
  - Where: `src/styles.css:221`, `src/styles.css:484`, `src/styles.css:593`
  - from `DESIGN-VERSORIUM.md:273`

### P3 · Command line

- [ ] **Add CLI subcommands new, open, status, commit, rollback, export, update** · Feature · `cli-subcommands`
  - Done when: Each exists with help text and an integration test.
  - Where: `src-tauri/src/mcp/mod.rs:36-45`, `src-tauri/src/lib.rs:34`
  - from PROMPT implementation notes

### P3 · Documentation

- [ ] **Add a sourced, dated comparison with alternatives and the 'why' to the landing** · Feature · `landing-comparison`
  - Done when: The landing compares Scrivener, Ulysses, iA Writer, Obsidian, Notion, Novelcrafter, Sudowrite etc. (price, features, where text lives, backups, AI), dated and sourced, honest about where others lead, plus the owner's 'why'.
  - [details](#the-landing-compares-versorium-with-the-alternatives-and-says-why-it-exists)

### P3 · Other

- [ ] **Add an airplane mode that blocks every network call** · Feature · `airplane-mode`
  - Done when: A toggle disables update checks, remote AI, git push/pull and downloads; tested.
  - Where: `src-tauri/src/commands/settings.rs`, `src-tauri/src/commands/git.rs:118`, `src-tauri/src/commands/git.rs:130`
  - from PROMPT implementation notes
- [ ] **Add optional encryption of the project folder** · Feature · `folder-encryption`
  - Done when: The owner approves a design (threat model, key handling, what git and backups see); then a novel folder can be locked with a passphrase, its files on disk are unreadable without it, and a test opens a locked novel.
  - Where: `src-tauri/src/commands/project.rs`, `src-tauri/Cargo.toml`
  - from PROMPT implementation notes

## Decisions for the owner

Nothing here can be closed in code until the owner chooses. Each line says what is waiting on the answer.

### P1

- [ ] **Decide whether to set requireSignedVersion: true in the updater config** · Decision · `require-signed-version`
  - Done when: Maintainer decides; if yes, plugins.updater.requireSignedVersion is true in src-tauri/tauri.conf.json, an update from the previous release is verified, and RELEASING.md says every signature must name its version.
  - Where: `src-tauri/tauri.conf.json:61-67`, `docs/project/RELEASING.md`
  - [details](#going-public); from `STATUS.md:2879-2881`

### P2

- [ ] **Decide whether the local server address must be loopback-only** · Decision · `local-server-loopback-decision`
  - Done when: Owner decides; either Rust rejects non-loopback addresses, or the disclose-and-release-tasks behaviour is recorded as final.
  - Where: `src-tauri/src/agents/mod.rs:64`, `src-tauri/src/commands/models.rs:328`, `src/lib/settings/ai/picks.ts`
  - [details](#settings-regrouped-the-checks-no-automation-reaches-and-what-it-left)
- [ ] **Decide whether Activity's technical line is localised or stays as logged** · Decision · `activity-line-language`
  - Done when: Owner accepts English log detail (documented exception) or Rust emits structured fields shown through locale keys in both languages.
  - Where: `src/lib/settings/groups/ActivityGroup.svelte:135`
  - [details](#settings-regrouped-the-checks-no-automation-reaches-and-what-it-left); from `STATUS.md:1895`
- [ ] **Give each background failure its own words instead of 'File system error.'** · Decision · `background-failure-words`
  - Done when: Owner picks wording; save, change-log and snapshot failures each get a line naming their subject in EN+ES and stop sharing one notice.
  - Where: `locales/en/ui.json:625`, `locales/es/ui.json:625`
  - [details](#notifications-the-checks-no-automation-reaches-and-what-is-left); from `STATUS.md:902`

### P3

- [ ] **Settle whether Tasks shows the Continuity link with no model chosen** · Decision · `continuity-link-no-model`
  - Done when: The owner keeps the link as the redesign spec draws it (recorded in STATUS.md), or asks for it to be hidden until a model is chosen.
  - Where: `src/lib/settings/groups/TasksGroup.svelte:193-206`, `locales/en/ui.json:279`
  - [details](#settings-regrouped-the-checks-no-automation-reaches-and-what-it-left); from `STATUS.md:1894`
- [ ] **Confirm or revise backup Phase 0's eight departures from the spec** · Decision · `backup-phase0-departures`
  - Done when: Maintainer confirms or rejects each departure (pull lock scope, unheld lock fallback, held clockBehind, pruning in the write, etc.).
  - Where: `docs/project/STATUS.md:567`, `src-tauri/src/backup/mod.rs:756`
  - from `STATUS.md:567`
- [ ] **Confirm or revise the notices module's departures from backup SPEC §6.3** · Decision · `notices-spec-departures`
  - Done when: Owner confirms or spec adopts: transient notices take no action; same-id same-words is a silent refresh; changed transient re-read, persistent never; same-words persistent notices merge unless one has an action.
  - Where: `src/lib/notices/state.svelte.ts`
  - [details](#notifications-the-checks-no-automation-reaches-and-what-is-left); from `STATUS.md:820`
- [ ] **Decide whether a visible notice follows a language switch** · Decision · `notices-language-switch`
  - Done when: Owner accepts the limit, or the notices contract carries keys so a live notice re-renders in the new language.
  - Where: `src/lib/notices/`
  - [details](#notifications-the-checks-no-automation-reaches-and-what-is-left); from `STATUS.md:901`
- [ ] **Decide: accept, or add a 'copy address' action for About links** · Decision · `about-copy-address`
  - Done when: Owner accepts the limit, or a copy-address action exists with EN/ES strings (not the engine's link menu).
  - Where: `src/lib/settings/groups/AboutGroup.svelte`
  - [details](#found-while-building-about-and-the-release-names-not-part-of-them); from `STATUS.md:2178`
- [ ] **Decide whether the Windows setup .exe keeps '-setup' in its release name** · Decision · `windows-setup-name`
  - Done when: Owner keeps Versorium_X.Y.Z_windows_x64.exe or switches release.yml to [name]_[version]_windows_x64[setup][ext]; release-assets test updated.
  - Where: `.github/workflows/release.yml:91`, `tests/unit/release-assets.test.ts`
  - [details](#found-while-building-about-and-the-release-names-not-part-of-them)
- [ ] **Decide whether to add a native View menu for binder, top bar and Focus** · Decision · `native-view-menu`
  - Done when: Maintainer confirms deferral or schedules it (translated menu bar, no double accelerators, Rust covered).
  - Where: `src-tauri/src/lib.rs`
  - [details](#collapsible-binder-and-top-bar-the-checks-no-automation-reaches)
- [ ] **Confirm or reject the seven departures from the Settings-over-editor plan** · Decision · `settings-departures`
  - Done when: Maintainer accepts or rejects departures 1–7 and STATUS.md records it.
  - Where: `docs/project/STATUS.md:1166`, `docs/project/STATUS.md:820`
  - from `STATUS.md:1166`
- [ ] **Reconcile the external settings-redesign SPEC with the shipped eleven-page rail** · Decision · `settings-spec-external`
  - Done when: Maintainer updates SPEC.md §2.1/§2.3/§10.3 to eleven pages and 584 px, or retires it.
  - Unclear: The external SPEC.md is not at the path cited in the details below and STATUS.md:2010 (~/Documents/Github/.versorium-design/versorium-settings-redesign/SPEC.md), so whether it was updated is unknown, moved or retired. This is the maintainer's decision; at most the repo docs should say where the spec lives now.
  - Where: `docs/project/STATUS.md:2009-2027`
  - from `STATUS.md:2009-2027`
- [ ] **Pick the Creative mode tooltip wording and fix the docs that misquote it** · Decision · `creative-soon-wording`
  - Done when: The owner confirms the ai.creativeSoon wording (today 'Creative mode is coming. It is not available yet.' / 'El modo creativo llegará. Todavía no está disponible.'), and STATUS.md quotes it as it is.
  - Partly done: The locales already dropped the version (commit 4fd7608): 'Creative mode is coming. It is not available yet.' / 'El modo creativo llegará. Todavía no está disponible.' AGENTS.md and STATUS.md:2455-2457 still quote 'arrives in v1.1'. The maintainer still has to confirm the wording (decision), then the docs need fixing.
  - Where: `locales/en/ui.json:726`, `locales/es/ui.json:726`, `src/lib/components/TopBar.svelte:89`
  - from `AGENTS.md:25`, `STATUS.md:2453-2457`, PROMPT implementation notes
- [ ] **Decide whether Folio's accent becomes Needle Teal or the design doc is reconciled** · Decision · `folio-accent-decision`
  - Done when: Maintainer records a choice: Folio --accent becomes #2A6F6A/#7EB8B2 (landing token sync run), or the design doc header is reconciled with the Folio table.
  - Where: `src/styles.css:17`, `src/styles.css:44`, `src/styles.css:65`
  - from `AGENTS.md#Rules that do not bend`, `DESIGN-VERSORIUM.md:254`
- [ ] **Decide on Apple notarisation and Windows Authenticode signing** · Decision · `os-code-signing`
  - Done when: Maintainer decides; if yes, release.yml passes signing variables, tauri.conf.json has an identity and thumbprint, and the xattr/SmartScreen steps leave the release body.
  - Where: `.github/workflows/release.yml:265-275`, `src-tauri/tauri.conf.json`
  - [details](#going-public); from PROMPT implementation notes, `STATUS.md:109`, `STATUS.md:2408-2411`
- [ ] **Decide whether DOCX and PDF metadata name Versorium when the colophon is off** · Decision · `colophon-metadata-decision`
  - Done when: DOCX app.xml and PDF /Creator,/Producer follow exportColophon (with a test), or keeping them is documented in FORMATS.md.
  - Where: `src-tauri/src/formats/docx.rs:119-135`, `src-tauri/src/formats/pdf.rs:317`
  - from `STATUS.md:2289-2295`
- [ ] **Decide whether to move inference into a sidecar so a ggml abort cannot kill the editor** · Decision · `inference-sidecar-decision`
  - Done when: Maintainer confirms the in-process runtime or schedules a sidecar.
  - Where: `src-tauri/src/llama/runtime.rs`
  - from `STATUS.md:2565-2570`
- [ ] **Design anchored notes: storage, anchoring and lifecycle** · Decision · `anchored-notes-design`
  - Done when: A written design, approved by the maintainer, answers where notes live, how anchors survive edits inside and outside the app, and behaviour on rename, reorder, delete, restore, import/export, snapshots, backups, MCP, search, corkboard and editor display.
  - [details](#notes-on-the-novel-anchored-anywhere-like-comments-in-google-docs)
- [ ] **Decide whether Continuity may run on an API model** · Decision · `continuity-api-decision`
  - Done when: Maintainer records yes or no; code follows with no default on.
  - Where: `src-tauri/src/continuity/mod.rs:161-165`
  - [details](#more-ai-providers-api-keys-mcp-and-assistants-owner-2026-10-04)
- [ ] **Decide on the CLI → MCP → BYOK → local fallback chain** · Decision · `fallback-chain-decision`
  - Done when: Maintainer confirms no fallback (spec annotated) or a chain that never silently changes the destination is built.
  - Where: `src-tauri/src/agents/mod.rs:519-547`, `docs/project/PROMPT-VERSORIUM.md:554`
  - from PROMPT implementation notes
- [ ] **Decide on per-task router defaults (§6.3)** · Decision · `router-defaults-decision`
  - Done when: Maintainer records defaults or confirms 'unassigned' as final.
  - Where: `src-tauri/src/commands/settings.rs:19-24`, `docs/project/PROMPT-VERSORIUM.md:555`
  - from PROMPT implementation notes
- [ ] **Decide on GitHub OAuth vs pasted personal tokens** · Decision · `github-oauth-decision`
  - Done when: Maintainer records decision; spec or code updated.
  - Where: `src-tauri/src/git/github.rs:1`, `src-tauri/src/commands/git.rs:83`, `src-tauri/src/secrets/mod.rs`
  - from PROMPT implementation notes
- [ ] **Decide on the op shape (id, docId, prevId) and pack compaction** · Decision · `op-shape-decision`
  - Done when: Maintainer records whether ops keep their shape; if not, a migration and compaction are implemented.
  - Where: `src-tauri/src/ops/mod.rs:18-29`
  - from PROMPT implementation notes
- [ ] **Resolve the empty root snapshots/ folder vs .versorium/snapshots** · Decision · `snapshots-folder-decision`
  - Done when: Ops snapshots move to snapshots/, or the empty folder is no longer created and spec §4 notes it.
  - Where: `src-tauri/src/commands/project.rs:203`, `src-tauri/src/commands/project.rs:749`, `src-tauri/src/ops/mod.rs:6`
  - from PROMPT implementation notes
- [ ] **Decide on censorship per-provider override and whether it routes providers** · Decision · `censorship-decision`
  - Done when: Maintainer decides; implemented or recorded as final; versorium.json censorship field is read or removed.
  - Where: `src-tauri/src/commands/settings.rs:87`, `src-tauri/src/commands/project.rs:22`, `src-tauri/src/commands/project.rs:217`
  - from PROMPT implementation notes
- [ ] **Decide on a SQLite (sqlx) index and job queue, or drop it from the spec** · Decision · `sqlite-decision`
  - Done when: Maintainer records whether SQLite is needed; spec or code updated.
  - Where: `src-tauri/Cargo.toml`, `src-tauri/src/paths.rs:30`, `src-tauri/src/ops/mod.rs:1-6`
  - from PROMPT implementation notes
- [ ] **Decide on bundling Hunspell dictionaries (en_US, es_ES, es_419)** · Decision · `hunspell-decision`
  - Done when: Maintainer decides; if yes, dictionaries ship and spellcheck follows the manuscript lang.
  - Where: `src-tauri/src/spelling.rs`
  - from PROMPT implementation notes
- [ ] **Decide whether to bundle Source Serif 4, iA Writer Quattro and Inter** · Decision · `font-bundle-decision`
  - Done when: Maintainer decides; if bundled, fonts ship, THIRD-PARTY-NOTICES.md updated, Source Serif 4 shows available.
  - Where: `fonts/catalog.json:42`, `docs/project/DESIGN-VERSORIUM.md:263`
  - from `DESIGN-VERSORIUM.md:263`, `DESIGN-VERSORIUM.md:264`
- [ ] **Decide whether to allow separate themes for the editor and the chrome** · Decision · `separate-editor-theme`
  - Done when: Maintainer decides; if yes, two settings and separately scoped editor CSS.
  - Where: `src/lib/themes/state.svelte.ts:19-22`
  - from `DESIGN-VERSORIUM.md:257`
- [ ] **Decide on the 'many MCP panels → Needle Dark' rule and an 'Industry' option** · Decision · `mcp-panels-needle-dark`
  - Done when: Maintainer confirms current behaviour and the spec is updated, or asks for the rule.
  - Where: `src/lib/themes/state.svelte.ts:9-31`, `docs/project/DESIGN-VERSORIUM.md:256`
  - from `DESIGN-VERSORIUM.md:256`
- [ ] **Decide whether to keep the V with a nib and update the logo spec** · Decision · `logo-nib-decision`
  - Done when: Maintainer confirms the nib V and the Logo section is updated, or asks for a mark without it.
  - Where: `tests/icons/generate.py:11-21`, `src/lib/components/VMark.svelte`, `docs/project/DESIGN-VERSORIUM.md:281`
  - from `DESIGN-VERSORIUM.md:281`
- [ ] **Decide whether the icon stays two-tone with gradient and ink pool, and VMark's colour** · Decision · `icon-color-decision`
  - Done when: Maintainer decides; spec or generate.py aligned; VMark ink pool / Needle Teal vs var(--accent) decided.
  - Where: `tests/icons/generate.py:64-101`, `tests/icons/generate.py:288-292`, `src/lib/components/VMark.svelte:46-49`
  - from `DESIGN-VERSORIUM.md:282`

## Details

The longer notes behind the items above, as they were written while the work was built. They are history and context; the items above are the list.

### Half-done

#### Form controls still hand-written

The shared primitives exist in `src/lib/components/forms/` — `Field`,
`TextField`, `NumberField`, `Select`, `Checkbox`. So far they are used in
`AuthorSection.svelte`, `ProjectSettingsDialog.svelte`, the backup retention
count in `BackupGroup.svelte`, every control on Settings → Tasks, Models,
Access to your novel and Activity (`src/lib/settings/groups/`,
`src/lib/settings/models/`) and the language pickers of the import
(`ManuscriptDialog.svelte`), New project and the welcome guide.

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

Still hand-written, 15 control tags in 11 files:

| File | Controls |
|---|---|
| `src/lib/components/ManuscriptDialog.svelte` | 3 |
| `src/lib/settings/UpdatesSection.svelte` | 2 |
| `src/lib/onboarding/Onboarding.svelte` | 1 |
| `src/lib/components/GitPanel.svelte` | 2 |
| `src/lib/binder/NewProjectDialog.svelte` | 1 |
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

#### `RadioCardGroup` is named, not designed or written

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

#### Spelling on Linux, and on the release builds

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

### Queued, designed or under review

#### The landing compares Versorium with the alternatives, and says why it exists

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

#### Settings › About and the release names: the checks no automation reaches

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
- **VoiceOver and NVDA** read each link as its words, then "(opens in your
  browser)"; the author's as "… (opens www.maecly.com/about in your
  browser)". Chrome's computed names are tested; no screen reader has read
  them.

#### Found while building About and the release names, not part of them

- ~~The Linux files said `ubuntu`~~: the owner chose `…_linux_amd64[ext]` (2026-10-04), which fits the `.rpm` and the AppImage too.
- ~~`finalise` did not check that every platform is in `latest.json`~~: it now fails when darwin-aarch64, darwin-x86_64, windows-x86_64 or linux-x86_64 is missing.
- **A writer cannot copy an About address** without the browser failing
  first: a link is not text to the right-click policy (deliberately), a drag
  across it selects nothing, and a select-all copy carries the hidden "(opens
  in your browser)". Accept it, or later add a "copy address" action; not
  the engine's link menu.
- **The Windows setup program loses "setup"**: its `[ext]` is `.exe`, so it
  is `Versorium_X.Y.Z_windows_x64.exe` beside the `.msi`.
  `[name]_[version]_windows_x64[setup][ext]` would keep `-setup`; the owner's
  pattern was kept as given.

#### Settings, regrouped: the checks no automation reaches, and what it left

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

#### Found while building the Settings redesign, not part of it

- **ES `ai.checkpointNote` still says "punto de control"**, and it, together
  with `git.commitHint` and `binder.confirm.chapterBody`, still promises a
  roll-back the app cannot do yet. Left as they are by the owner's decision
  (D7): they are fixed when in-app restore lands.
- **Hand-written controls outside Settings' AI pages:** `RewriteDialog.svelte`
  (its model picker) and `ManuscriptDialog.svelte` (three), in the table above.

#### Choose when the backup runs

Requested on 2026-10-04: the zip backup runs only when the writer presses Back
up now; the writer should be able to pick when it runs on its own. Specified on
2026-10-04 in three phases (the spec sits outside the repo, at
`/tmp/versorium-backup-schedule/SPEC.md`, copied to `~/Documents/Github/.versorium-design/` outside the repo).

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

#### Notifications: the checks no automation reaches, and what is left

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
- **The words of a background failure** say why and not what: a save, the
  change log and the minute's snapshot that fail on a full disk all say "File
  system error.". The owner's call: a line per source ("The chapter was not
  saved. …"), which would also stop them sharing one box.
- **A notice keeps the language it was raised in** until it goes. The
  contract carries text, not a key (backup schedule SPEC §6.3).
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

#### Settings over the editor: the checks no automation reaches, and what it left

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

#### Found while building Settings over the editor, not part of it

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

#### Collapsible binder and top bar: the checks no automation reaches

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

#### Right-click: the checks no automation reaches

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

#### See what changed, the way a code editor shows it

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

#### Go back to an earlier version from the app

Belongs with the diff view above: seeing a change and saying "I want that
version" are one task. Today nothing in the UI restores a snapshot or a
deleted chapter. `git_checkout_file` exists (`src-tauri/src/commands/git.rs`,
`api.gitCheckoutFile` in `src/lib/tauri.ts`) but no component calls it,
and three strings promise what the app cannot do: `binder.confirm.chapterBody`
("can be brought back"), `git.commitHint` ("You can come back to it") and
`ai.checkpointNote` ("You can roll back"). Restoring must itself snapshot
first, so going back is never a way to lose today's text; a deleted chapter
also has to come back into `versorium.json`'s order, not just onto disk.

#### Notes on the novel, anchored anywhere (like comments in Google Docs)

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

#### Synopses are kept and shown, but nothing writes one

A Scrivener import keeps each document's synopsis as `synopsis:` in its
chapter's frontmatter, the corkboard card shows it, and a Scrivener export
writes it back (`STATUS.md`, 2026-10-04). What is left:

- **Nothing in the app creates or edits a synopsis.** Only an import writes
  one (`set_synopsis` in `src-tauri/src/commands/chapters.rs`); a card shows
  it and cannot change it. Hand-editing the chapter file works, as one line
  or as a YAML block (`synopsis: |` and indented lines under it, read whole
  since 2026-10-06).
- **Only Scrivener export carries it.** Markdown exports one document with a
  single frontmatter block, and DOCX, EPUB and PDF have no per-chapter place
  for one, so a synopsis does not survive a Markdown round trip.
- **A Scrivener project's language is not read.** The importer reads only the
  binder file, which has none; no Scrivener bundle was at hand to see where
  Scrivener keeps one, if anywhere. The import dialog asks instead.

#### Found while building the novel's language and synopses, not part of them

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

### Specified, not started

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

#### More AI providers: API keys, MCP and assistants (owner, 2026-10-04)

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

#### Choose the model an assistant uses (owner, 2026-10-05)

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

### Going public

*Steps 3 and 4 below describe GitHub Pages. On 2026-10-17 the landing moved to
`MAECLY/versorium-app-landing` and to Vercel (project `versorium-landing-page`); the
CNAME `versorium` now points at Vercel, DNS only, and Pages is off.*

Done, in this order, on 2026-10-03 and 2026-10-04; kept as the record. Only
the `requireSignedVersion` question under step 5 is still open, and it is the
`require-signed-version` decision above.

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
5. **Done** on 2026-10-04: `v0.1.0` published at 20:23 UTC and `v0.1.1` at
   23:17 UTC (`v0.1.2` followed on 2026-10-06), each checked as a draft first (`latest.json`, `SHA256SUMS`, every
   signature against the app's key; see `RELEASING.md`).

   **Still open, for the owner:** whether to set `"requireSignedVersion": true` under
   `plugins.updater` in `src-tauri/tauri.conf.json` (raised in review on
   2026-10-03, separate from the token change). Left off, as now (the
   plugin's default), the updater accepts a signature that names no version,
   so a tampered `latest.json` could announce a newer version for an older
   installer signed that way. No release signature should lack one:
   `pnpm-lock.yaml` locks `@tauri-apps/cli` 2.12.0, whose changelog says
   `tauri build` records the app version in every updater signature, and the
   plugin already refuses a signature whose version differs from the one
   announced. The flag makes the version a requirement. Checked on
   2026-10-06: all seven of v0.1.1's update signatures carry
   `version:0.1.1` in their trusted comment, so setting the flag would refuse
   nothing the workflow publishes; an install with the flag refuses every
   later release whose signature names no version.

Two things in the app reach the repository directly. What going public does
for each:

- **The in-app updater: proven.** v0.1.0 updated itself to v0.1.1 with no
  token, on macOS and on Windows 11 (2026-10-04). What follows is how it got
  there. On 2026-10-03
  the founder decided that once the repository is public, updates must work
  without a token, and `PROMPT-VERSORIUM.md` §11 opens with that amendment.
  The code follows it: `update_check` in `src-tauri/src/commands/update.rs`
  no longer returns early without a token, and `src-tauri/src/update/mod.rs`
  sends `Authorization` only when one is saved. A saved token is still sent,
  for while the repository is private and to lift GitHub's anonymous rate
  limit. Going public is what makes the anonymous check find anything: until
  then GitHub answers it with a 404, and Settings → Updates says no published
  version is visible yet. Done after step 5: an install with no token saved
  was offered v0.1.1 and installed it.
- **The crash reporter's "report" action** opens
  `https://github.com/MAECLY/versorium-app/issues/new` with a prefilled title
  and body (`report_url` in `src-tauri/src/crash/mod.rs`, owner and repo
  compiled in as `ISSUES_OWNER` / `ISSUES_REPO`). The repository is public, so
  the page opens for anyone; in v0.1.0 the button opened nothing at all (the
  opener's empty scope), which v0.1.1 fixes.

Not on this list's critical path: Apple notarisation and Windows Authenticode.
Both need purchased certificates, and buying them is not the whole job:
`release.yml` passes no Apple or Windows codesigning variables to
`tauri-action`, and `tauri.conf.json` has no signing identity or certificate
thumbprint, so both have to be wired in once the certificates exist. Until
then, the release body written by `release.yml` carries, in English and
Spanish, the instructions for clearing the macOS quarantine flag
(`xattr -rd com.apple.quarantine /Applications/Versorium.app`) and for getting
past SmartScreen (More info → Run anyway).

### Unexplained

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
