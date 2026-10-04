# TRADEMARKS

**Versorium**, the lowercase wordmark `versorium`, and the Versorium mark belong to
the founder (maecly).

The mark is a written V: a heavy left stroke and a hairline right stroke. It has
two forms, and both are the mark:

- **With the nib.** A fountain-pen nib caps the hairline. The app icon uses this
  form from 64px up (from 256px it also draws a pool of ink under the join), and
  the app uses it wherever the mark is 40px or larger, as on the opening screen.
- **The letter alone.** The V without the nib. The 16, 32 and 48px icons use this
  form, and so does the top bar, which draws the mark at 20px.

The app icon draws the mark on paper in two teals: Needle Teal (`#2A6F6A`) for the
hairline and a deeper teal (`#1A4A46`) for the heavy stroke and the nib. Inside the
app the mark takes the current theme's accent colour, so in Folio, the default
theme, it is Folio's green and not Needle Teal.

- The code is licensed under Apache-2.0 (see `LICENSE`). Section 6 of that license
  grants no right to use these marks beyond reasonable and customary use in
  describing where the work came from — for example, "a fork of Versorium".
- Forks and derivatives **must** change the product name, wordmark and mark before
  distributing. The name "Versorium" may not be used to market a fork as if it were
  the original product.
- Until September 2026 the icon was a compass needle in a ring. It was retired
  because it read as Safari, and the desktop app no longer uses it. Some files in
  the repository still carry it; see "Old artwork still in the repository".

## What a fork has to replace

The name, identifier and mark live in these places in this repository:

- `src-tauri/icons/` — the desktop icon set: the top-level files (the `NxN.png`
  sizes, `128x128@2x.png`, `icon.png`, the `Square*Logo.png` tiles, `StoreLogo.png`,
  `icon.ico` and `icon.icns`). `tests/icons/generate.py` writes all of them
  (`make icons`); change the generator, not the PNGs. The generator does not write
  `src-tauri/icons/ios/` or `src-tauri/icons/android/`. Replace or delete those by
  hand.
- `src/lib/components/VMark.svelte` — the mark drawn inside the app, in both forms,
  from the same geometry as the icon.
- `src/index.html` — the page `<title>`.
- `src-tauri/tauri.conf.json` — `productName` and the window `title` ("Versorium"),
  the bundle `identifier` (`dev.versorium.app`), and the updater `pubkey`. A fork
  that keeps Versorium's public key cannot publish updates its own builds will
  accept.
- `src-tauri/src/paths.rs` — `APP_IDENTIFIER`, which must equal the bundle
  `identifier` (a test fails if they differ). It names the app-data directory and,
  through `src-tauri/src/secrets/mod.rs`, the namespace of the credentials kept in
  the OS keychain. A fork that keeps it shares Versorium's settings and stored
  credentials on the same machine.
- `src-tauri/Cargo.toml` — the package name `versorium`, which names the binary
  and its `versorium mcp` command.
- `src-tauri/src/mcp/clients.rs` — `ENTRY` (`versorium`), the server name the app
  writes into Claude Code, Claude Desktop, Codex and OpenCode configs, and the
  `.versorium-backup` suffix of the copies it takes before editing them.
- `locales/en/ui.json` and `locales/es/ui.json` — `app.name`, which is the wordmark
  shown in the top bar.
- `src-tauri/src/update/mod.rs` — `UPDATE_OWNER` / `UPDATE_REPO`, compiled in and
  pinned by a test. Leave them and the fork goes looking for Versorium's releases.
- `.github/workflows/release.yml` — the release name (`Versorium <tag>`), the
  English and Spanish release notes, which name `/Applications/Versorium.app`, and
  the `versorium-*` artifact names.

## Old artwork still in the repository

The compass is retired, but these files still carry it. Nothing in the desktop
build uses them, and they are due to be deleted or redrawn:

- `src-tauri/icons/ios/` and `src-tauri/icons/android/` — 33 PNGs (and two XML
  files) from before the redraw, last changed 2026-09-14. `tauri.conf.json` does not
  list them for the desktop bundle, and `make icons` does not touch them.
- `tools/gen-icon.mjs` and the `tools/icon-source.png` it writes — the old generator
  ("needle + compass rose") and its output. Neither the Makefile nor `package.json`
  runs it.
- The comment above the mark in `src/lib/components/TopBar.svelte` still calls it
  "Needle mark (favicon shape)".

## Other names

The app and its docs mention products it works with, can import from and export
to, or runs on. Those names belong to their owners, and their use here only
describes compatibility: Tauri, Svelte, CodeMirror, libgit2, llama.cpp, Ollama,
LM Studio, OpenAI, Claude, Codex, OpenCode, GitHub, Hugging Face, Scrivener,
Microsoft Word, iCloud, Dropbox, Google Drive, OneDrive, Apple, macOS, Gatekeeper,
Microsoft, Windows, SmartScreen, Linux, the model families offered for download
(Qwen, Gemma, Llama, SmolLM, Nomic), and similar marks. Licence notices for the
third-party code compiled into the app are in `THIRD-PARTY-NOTICES.md`; each
downloadable model carries its own licence, recorded in `models/catalog.json`.

Copyright © 2026 maecly.
