# AGENTS.md — working on Versorium

Versorium is a local-first desktop app for writing novels: one Markdown file per
chapter, every change tracked in a git repository that belongs to the novel. It
is a Tauri 2 shell with the logic in Rust and a Svelte 5 + CodeMirror 6
frontend; git goes through libgit2 (`git2`), so the app never needs system git.

The original build (milestones M0–M7) is finished and merged. You are not here
to build the app; you are here to change one that exists. Before you start,
read `STATUS.md` for what shipped, and `TODO.md` plus the "Implementation
notes" at the end of `PROMPT-VERSORIUM.md` and `DESIGN-VERSORIUM.md` for what
is unfinished. When a request is ambiguous, ask the maintainer.

## Rules that do not bend

These are the maintainer's, not conventions. Do not weaken them in code, copy,
or docs.

- **Local-first.** No SaaS, no telemetry, no account required.
- **One `.md` file per chapter.** Scenes are `##` headings inside it.
- **No Creative Mode engine.** The UI may say "Coming soon"; nothing generates
  chapters. No engine exists today. The copy does not follow the rule yet: the
  disabled button in `src/lib/components/TopBar.svelte` is titled
  `ai.creativeSoon`, which reads "Creative mode arrives in v1.1." / "El modo
  creativo llega en la v1.1." and so promises a version. The maintainer has not
  yet picked the wording. Do not copy it into new strings or docs.
- **MCP starts read-only.** A write requires a setting, a warning, and a git
  checkpoint before it applies. (`mcp_write_clients` in
  `src-tauri/src/commands/settings.rs` is empty by default.) The write path in
  `src-tauri/src/mcp/write.rs` also does two things a new write tool must keep:
  without `confirm: true` it returns a preview diff and writes nothing, and the
  chapter edits it applies are recorded in the op log with author
  `ai:<client>` (spec §7). The order is permission → validate → preview unless
  confirmed → checkpoint → apply → ops. The preview is not yet the mandatory
  diff the spec asks for: an agent that sends `confirm: true` on its first
  call skips it, and the writer never sees a diff. PROMPT-VERSORIUM.md's
  implementation notes (§7) record this gap. A new write tool must not widen it.
- **i18n EN + ES, no hardcoded strings.** Every user-facing string is a key in
  both locales. Rust returns error *codes*, never prose.
- **Themes are Folio, Quarry and Needle**, light and dark, with the Needle Teal
  accent (`#2A6F6A` light, `#7EB8B2` dark). The code meets this in Quarry and
  Needle only. Folio is the default theme, and `src/styles.css` gives it its
  own green accent (`#3d5a45` light, `#a3b89a` dark), so on a fresh install
  buttons, focus rings and checkboxes are not Needle Teal. Whether the code
  changes to meet the rule is the maintainer's decision. Leave the rule as it
  is written either way.
- **Stack is locked:** Tauri 2 + Rust + Svelte 5 + CodeMirror 6 + git2. No
  Electron, no React, no web app, no system git.
- **Never mix the two GitHubs.** `MAECLY/versorium-app` is this codebase and the
  source of app updates. A writer's novels live in *their* account, private by
  default. Code, tokens and settings for the two stay separate.
- **Crash logs never contain novel text.** Everything written to a crash record
  or an issue body goes through the scrubber in `src-tauri/src/crash/mod.rs`.

## Where things live

| Path | What |
|---|---|
| `src-tauri/src/lib.rs` | App setup and command registration; also routes `versorium mcp` to the MCP server |
| `src-tauri/src/commands/` | The Tauri commands the frontend calls, one file per area |
| `src-tauri/src/{git,ops,mcp,models,llama,formats,backup,update,crash,secrets,continuity,agents,fonts}/` | The logic behind those commands |
| `src-tauri/src/paths.rs` | App-data paths shared by the GUI and the `versorium mcp` process |
| `src-tauri/tests/mcp_stdio.rs` | Rust integration test (drives the real binary over stdio) |
| `src/App.svelte`, `src/main.ts`, `src/styles.css` | Frontend entry and the theme tokens |
| `src/lib/tauri.ts` | Typed wrappers over `invoke`; the only place the frontend calls a Rust command |
| `src/lib/*/` | Feature folders: `binder`, `editor`, `settings`, `git`, `mcp`, `models`, `formats`, `update`, `onboarding`, `themes`, `i18n`, `ai` |
| `src/lib/components/` | Shared components; `forms/` holds the form primitives |
| `src/lib/i18n/` | `t()` and `errorMessage()`, which maps a Rust error code to `errors.<code>` |
| `locales/en/ui.json`, `locales/es/ui.json` | All UI copy, one file per language |
| `models/catalog.json` | The downloadable model catalogue (`tests/catalog/hf-files.py` fetches sizes and sha256) |
| `fonts/catalog.json` | Font catalogue: four entries, nothing downloadable yet (see DESIGN-VERSORIUM.md's implementation notes) |
| `tests/e2e/` | Playwright specs, and `mock-tauri.ts`, the in-browser IPC mock they run against |
| `tests/locale-parity.mjs` | EN/ES key parity check |
| `tests/scratch/`, `tests/icons/`, `tests/release/`, `tests/catalog/` | Scratch code and helper scripts |
| `.github/workflows/ci.yml` | CI on every push to `main` and every pull request |
| `.github/workflows/release.yml` | Builds a **draft** release on a `vX.Y.Z` tag; a `vX.Y.Z-beta.N` tag gives a draft marked prerelease, for the beta channel. "Signed" means the updater (minisign) signature only. See "State of things outside the code" for why a tag pushed today fails |
| `tools/gen-icon.mjs`, `tools/icon-source.png` | Legacy icon generator, still tracked at the root. `make icons` no longer uses it; it uses `tests/icons/generate.py` |

Component tests sit next to the code as `src/**/*.test.ts` (vitest, jsdom).
Rust unit tests are `#[cfg(test)]` modules in the file they test.

## Commands

Run them through the Makefile. `make help` lists every target.

| Command | Does |
|---|---|
| `make verify` | **The gate.** In order: `check`, `locales`, `test-ui`, `test`, `clippy`, `test-e2e`. Green before you call anything done. Green does not mean zero svelte-check warnings or a clean CI clippy; see below. |
| `make dev` | Desktop app with hot reload (`pnpm tauri dev`) |
| `make devtools` | Same, with the Web Inspector open (`VERSORIUM_DEVTOOLS=1`) |
| `make mock` | Frontend only, against the IPC mock: open `http://localhost:1420/?mock=tauri` |
| `make web` | Frontend only, no mock (Tauri calls fail) |
| `make check` | `svelte-check`. The project expects 0 errors and 0 warnings, but only errors fail the command: `pnpm check` has no `--fail-on-warnings`, so `make check`, `make verify` and CI all pass with warnings. Read the summary line yourself |
| `make locales` | `node tests/locale-parity.mjs`: EN/ES parity, no spaces in error codes, no empty strings |
| `make test` | `cargo test` (unit + integration) |
| `make test-ui` | vitest |
| `make test-e2e` | Playwright against the IPC mock (`make test-e2e-ui` for the inspector) |
| `make clippy` | `cargo clippy -- -D warnings` |
| `make lint` | `check` + `clippy`, no tests |
| `make test-live` | Every `#[ignore]`d test whose name contains `live_` (15 of the 16 ignored tests; the crash panic-hook test is not matched). Not in `verify`. It touches this machine; see below before running it |
| `make mcp` | Run Versorium as a stdio MCP server |
| `make bundle` | Build the installable app |
| `make icons` | Regenerate the icon set (`tests/icons/generate.py`) |

The Makefile hardcodes two paths for the maintainer's machine:
`PNPM=/opt/homebrew/bin/pnpm` and `JAVA=/opt/homebrew/opt/openjdk/bin/java`.
Elsewhere, override them: `make verify PNPM=pnpm`. CI uses Node 20.

Playwright also depends on the machine. Locally it drives the system Chrome
(`channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome"` in
`playwright.config.ts`), so `make test-e2e`, and with it `make verify`, fails
where Chrome is not installed. Do what CI does: run
`pnpm exec playwright install chromium` once, then set
`PLAYWRIGHT_CHANNEL=chromium`.

`make test-live` is not a format-writer check. It runs every `live_` test at
once, and several have side effects on the machine running them:

- read and write the real OS credential store (`secrets/mod.rs`);
- move a folder to the system trash (`commands/project.rs`);
- call the agent CLIs installed on the machine, which may bill the owner's
  subscriptions (`agents/mod.rs`), and talk to the Ollama daemon
  (`agents/mod.rs`, `continuity/mod.rs`);
- download a real model (`models/download.rs`) and load a real GGUF
  (`llama/runtime.rs`);
- call the GitHub API, with the configured updates token or anonymously when
  there is none (`update/mod.rs`);
- push to a real repository when `VERSORIUM_TEST_REMOTE` and
  `VERSORIUM_TEST_TOKEN` are set (`git/repo.rs`);
- bind a localhost port and write the MCP endpoint file (`mcp/http.rs`).

It also needs pandoc, poppler and a JDK (epubcheck is fetched by `make tools`).
To run one test, pass its name instead:
`cargo test --manifest-path src-tauri/Cargo.toml -- --ignored live_pandoc_reads_our_chapters_back`.
Ask the maintainer before running the whole target.

`make clippy` runs exactly what CI runs
(`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`),
tests included, so `make verify` catches the same lints CI would.

`make fmt` is deliberately not part of `verify`: the Rust code is hand-formatted
wider than rustfmt's defaults and there is no `rustfmt.toml`. Do not run it as a
side effect of another change.

Baseline measured on 2026-10-03, on `main` after PR #9: `cargo test` 462 unit +
4 integration passed, 16 ignored; clippy with `--all-targets` 0 findings;
vitest 93 passed; Playwright 95 passed; svelte-check 0 errors, 0 warnings over
377 files; 679 locale keys in each of `en` and `es`; CI green. These numbers
move; re-run rather than quote them.

## Conventions the code follows

- **Every string in both locales.** Add the key to `locales/en/ui.json` and
  `locales/es/ui.json` in the same change. `make locales` fails on a missing
  key, an error code containing a space, or an empty value. Do not hunt for a
  missing translation on screen. `t()` tries the current locale, then English,
  then the raw key (`src/lib/i18n/state.svelte.ts`). A key missing only from
  `es` shows English text in the Spanish UI; only a key missing from `en`
  shows the raw key.
- **Rust errors are codes.** A command rejects with a short code such as
  `not_found`; `errorMessage()` (`src/lib/i18n/errors.ts`) shows
  `errors.<code>`, and when that key does not exist it shows `errors.generic`
  ("Something went wrong."), never the raw key. A missing error code therefore
  looks like a generic failure. Add the code to both locales.
- **A new Tauri command needs three things:** the Rust command, its wrapper in
  `src/lib/tauri.ts`, and a matching handler in `tests/e2e/mock-tauri.ts`. The
  mock rejects any command it does not know with `unknown_command <name>`, so
  without the handler the e2e suite and `make mock` cannot exercise it.
- **The native window starts hidden.** `src/main.ts` mounts the app and then
  calls `api.uiReady()`, and only then is the window shown. A change to the
  boot path that skips or breaks that call leaves an invisible or white window
  in the real app. The e2e suite cannot catch it, because `isTauri()` is false
  under the mock. Check boot changes in the real app (`make dev`).
- **Scratch code and test scripts go in `tests/`.** Not the repo root, not
  `/tmp` scripts left behind. The tracked `tools/` directory at the root
  predates this rule (see "Where things live").
- **Comments explain why.** The code says what it does. Read the existing
  comments in `src-tauri/src/crash/mod.rs` or `src/lib/components/forms/Checkbox.svelte`
  for the register.
- **Conventional commits**, `type(scope): subject`, with a subject that says
  what changed for the person using the app, e.g.
  `fix(backup): a press that changes nothing no longer costs you a backup`.
  No `Co-Authored-By` trailer; none of the commits on `main` has one.
- **Form controls use the shared primitives** in `src/lib/components/forms/`:
  `Field`, `TextField`, `NumberField`, `Select`, `Checkbox`. The hint goes in
  `aria-describedby`, and a live status readout stays outside the label so it
  never becomes part of the accessible name. 26 controls in 14 files are still
  hand-written; `TODO.md` lists them and the command to recount.
- **`Checkbox` stays strictly controlled.** Two-way call sites write
  `checked={x} onChange={(v) => (x = v)}`. Do not make `checked` `$bindable`:
  an unbound bindable keeps the child's write, so a permission the backend
  refused still shows as granted.
- **Specs find controls by accessible name** (`getByLabel`, `getByRole`). If a
  change breaks one, read why before editing the spec.

## Documents

| File | Read it for |
|---|---|
| `README.md` | The public entry point. Update it when a change alters a feature, the build steps or the landing page |
| `PROMPT-VERSORIUM.md` | The product and architecture spec. Wins on product questions. Its "Implementation notes (2026-10-03)" section lists where the code differs from the spec, with evidence |
| `DESIGN-VERSORIUM.md` | Themes, tokens, type. Wins on visual questions. Its "Implementation notes (2026-10-03)" section does the same for design |
| `STATUS.md` | What shipped, per milestone and after, with the known limits |
| `TODO.md` | Half-done work, three unstarted Local AI surfaces, and the steps to go public. It is not the complete list of unbuilt spec items: the two implementation-notes sections above list more (command palette, BYOK, most CLI subcommands, the downloadable font catalogue, and others) |
| `THIRD-PARTY-NOTICES.md` | Licences of bundled dependencies. A new dependency updates it |
| `FORMATS.md` | What each import/export format keeps and loses |
| `RELEASING.md` | The release procedure and the signing key |
| `TRADEMARKS.md`, `LICENSE` | Name and mark use; Apache-2.0 |
| `AGENT-BOOTSTRAP.md` | The original prompt that built M0–M7. Kept for history. Do not follow it: it tells an agent to build the app from scratch without asking questions. |

## State of things outside the code

- The repository `github.com/MAECLY/versorium-app` is private. MAECLY is on
  GitHub's free plan, where Pages does not serve private repositories.
- There is no release and no tag yet. Version is `0.1.0`, identifier
  `dev.versorium.app`, product name `Versorium`.
- The landing page for `versorium.maecly.com` (a GitHub Pages site built from
  `docs/` by `.github/workflows/pages.yml`) is being added on this branch and is
  not live. It needs the repo public, Pages enabled, and a Cloudflare CNAME
  `versorium` → `maecly.github.io`. `TODO.md` has the order.
- The release signing secrets (`TAURI_SIGNING_PRIVATE_KEY`,
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) are set in the repository; only the
  maintainer changes them. Never commit a key, and never set or rotate these
  from an agent. A tag push now runs the full release, so do not push a tag
  unless you were asked to cut one.
- The same `guard` job fails unless the tag (without its `v`) equals the
  version in `src-tauri/tauri.conf.json`, `package.json` and
  `src-tauri/Cargo.toml`. Bump all three together. Every release is created as
  a draft; a tag with a suffix such as `vX.Y.Z-beta.N` is also marked as a
  prerelease, for the beta channel.
- Builds carry no Apple Developer ID or Windows Authenticode signature. The
  release notes tell macOS users to clear the quarantine flag
  (`xattr -rd com.apple.quarantine /Applications/Versorium.app`) and Windows
  users to get past SmartScreen with More info → Run anyway.
