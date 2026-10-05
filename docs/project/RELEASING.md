# Releasing Versorium

Versorium updates itself from GitHub Releases. Every update artifact is signed,
and the app refuses an update it cannot verify, so a release built without the
signing key is worse than no release: it installs nowhere.

Where things stand on 2026-10-03:

- **No release and no tag exist yet.** Nothing in this document has run end to
  end. The workflow (`.github/workflows/release.yml`) is written; its first real
  run will be `v0.1.0`.
- The repository, `github.com/MAECLY/versorium-app`, is **private**.
- The in-app updater checks without a GitHub token (spec §11, amended on
  2026-10-03), so once the repository is public it needs no token at all
  (section 3).
- The signing key exists and its pair is verified (section 1). The two GitHub
  secrets are **set** — set on 2026-10-03 (17:18 UTC). GitHub never shows a secret back, so the first
  tag build is the end-to-end proof that they are right.
- The app is version `0.1.0` in all three places that carry it (section 5).

This document assumes you have admin access to the repository: you need it to
set secrets, change visibility and enable Pages.

## 1. The signing key

Tauri signs update artifacts with minisign (Ed25519). The pair already exists,
generated on 2026-09-27. **Do not generate a new one.**

| File | What it is | Where it belongs |
|---|---|---|
| `~/.versorium/signing.key` | **private** key, encrypted with an **empty** password | the `TAURI_SIGNING_PRIVATE_KEY` secret, *and* kept on disk |
| `~/.versorium/signing.key.pub` | public key, minisign key id `397AC687499AD349` | already compiled into the app: `src-tauri/tauri.conf.json` → `plugins.updater.pubkey` |

The public half is in the repository on purpose: that is how an installed copy
knows which signature to trust. **The private half must never be committed.**
Anyone holding it can sign an update that every installed copy of Versorium will
accept and run.

**Do not delete the local private key after setting the secret.** A GitHub
secret cannot be read back, so once the file is gone the secret is the only copy
and nobody can ever sign outside that workflow again. Keep the file, and keep a
backup of it somewhere offline.

Rotating the key is not a routine operation: every installed copy trusts only
the public key it was built with, so a new key strands every existing install
until it is reinstalled by hand. Treat the pair as permanent.

For reference only — this is how the pair was made, and running it again would
replace it:

```bash
pnpm exec tauri signer generate -w ~/.versorium/signing.key
```

### Verify the pair before you set the secrets

The release workflow can check that a key *is set*. It cannot check that it is
the *right* key. If the private key is not the partner of the public key
compiled into the app, every installed copy rejects every release it produces.
The Tauri CLI has a message for that mismatch, but whether it stops the build
has not been tested here, so do not rely on it. Prove the pair first:

```bash
# Sign any file with the private key. The password is empty.
echo probe > /tmp/probe.txt
pnpm exec tauri signer sign -f ~/.versorium/signing.key -p "" /tmp/probe.txt

# Verify that signature against the key in tauri.conf.json (not the .pub file).
# The script needs the `cryptography` package; `uv` provides it without
# installing anything globally.
uv run --with cryptography python3 tests/release/verify-signing-pair.py \
  /tmp/probe.txt /tmp/probe.txt.sig
```

It must print `OK — key id 49d39a4987c67a39: ...` (the same id as
`397AC687499AD349`, in the opposite byte order) and exit 0.

Then run the negative control, so you know the check can fail:

```bash
echo tampered >> /tmp/probe.txt
uv run --with cryptography python3 tests/release/verify-signing-pair.py \
  /tmp/probe.txt /tmp/probe.txt.sig
```

It must print `SIGNATURE DOES NOT VERIFY against the key compiled into the app`
and exit 1. Both results were observed with the current key on 2026-10-03.

## 2. Repository secrets

Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | the **contents** of `~/.versorium/signing.key`, not its path |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | **empty.** This key signs with an empty password, as the `-p ""` above shows |

The workflow passes both to the build as environment variables. An Actions
secret that is not set reaches the workflow as an empty string, so if the web
form refuses a blank value, leaving `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` unset
has the same effect. That the empty value works inside the CI build is expected
but not yet observed: no release run has happened.

`GITHUB_TOKEN` is provided by Actions; you do not create it.

The workflow's `guard` job stops a tag build when `TAURI_SIGNING_PRIVATE_KEY` is
empty, rather than producing artifacts the updater would reject.

## 3. Going live, in order

Each step depends on the one before it.

1. **Set the two secrets** (section 2), after verifying the pair (section 1).
2. **Make the repository public.** MAECLY is on GitHub's free plan. On that plan
   Pages does not serve a private repository, and a private repository's
   release assets cannot be downloaded by the people the landing page sends to
   them. Both need the repository public.
3. **Enable Pages** with **GitHub Actions** as the source (Settings → Pages →
   Build and deployment), **and enter `versorium.maecly.com` under Settings →
   Pages → Custom domain.** When an Actions workflow publishes the site, GitHub
   ignores a `CNAME` file in the uploaded artifact; the custom domain set in
   that field is the only one it serves. Without it the DNS record in step 4
   reaches `maecly.github.io` and GitHub answers 404 for that host name.
   The landing page is meant to live in `docs/` and be published by
   `.github/workflows/pages.yml`. Neither is in the tree yet (they are being
   written on the `feat/landing-and-docs` branch), so check both are on `main`
   before this step.
4. **DNS.** In Cloudflare, add a CNAME `versorium` → `maecly.github.io`, set to
   **DNS only** (not proxied), so the site answers at `versorium.maecly.com`.
   DNS-only is the plan in `TODO.md`; it has not been tried yet with this host
   name. Today `versorium.maecly.com` has no record.
5. **Tag `v0.1.0`** from `main` (section 5). The workflow builds a **draft**
   release. A person checks it (section 7) and only then publishes it.

The landing page is not live until steps 2, 3 (including the custom domain) and
4 are all done.

Going public is also what makes in-app updates reach everyone. Since
2026-10-03 the updater does not need a GitHub token (spec §11, amended): with
none saved, `src-tauri/src/commands/update.rs` still checks, and every request
`src-tauri/src/update/mod.rs` makes is anonymous, with no `Authorization`
header. While the repository is private, that anonymous check gets a 404 and
the app says that no published version is visible yet. Once the repository is
public and a release is published, the same check finds it. Downloading from
the release page needs no token once the repository is public either.

After step 5, check this once by hand: on an install with no token saved, press
**Check now**, see the release offered (it has to be newer than the installed
version), and let it install. That is the end-to-end proof of the anonymous
path; until then it has only run against the mock and the unit tests.

The token is still accepted, and still sent when saved. It goes in **Settings →
Application**, in the section titled **Updates token (optional)** ("Token de
actualizaciones (opcional)" in Spanish), below the **Updates** section, which
has no token field. It is what keeps updates working for whoever has one while
the repository is private, and it lifts GitHub's limit of 60 anonymous requests
an hour per address. When that limit is reached, the panel says so, says when
it resets, and points to the same section.

## 4. Signing that this does not cover

There is no Apple Developer ID certificate and no Windows Authenticode
certificate, so the operating systems do not recognise the publisher. Buying the
certificates is not the whole job. The build steps in `release.yml` pass
`tauri-action` only `GITHUB_TOKEN` and the two `TAURI_SIGNING_*` variables, and
`src-tauri/tauri.conf.json` has no `signingIdentity` or `certificateThumbprint`.
Both platforms need certificates, new secrets, and changes to the workflow and
the config. Until then every release body carries the two notices in section 8.

**This does not weaken update security.** Gatekeeper and SmartScreen are about
the OS recognising the publisher. The updater verifies every update against the
minisign public key compiled into the app, and also checks it against the
release's `SHA256SUMS`, before installing anything. Adding Developer ID or
Authenticode later is an extra step in the workflow, not a replacement for the
minisign key.

## 5. Cutting a release

Three files carry the version and **all three must agree**:

- `package.json` → `version`
- `src-tauri/Cargo.toml` → `[package] version`
- `src-tauri/tauri.conf.json` → `version`

All three say `0.1.0` today, so the first release needs no bump.

The updater compares the running app's version with the version in
`latest.json`, and the build takes that version from `tauri.conf.json`. If the
tag says `v0.2.0` but `tauri.conf.json` still says `0.1.0`, the release would
publish cleanly and **no client would ever be offered it**. The `guard` job
checks this before building: it stops if the tag differs from `tauri.conf.json`,
or if the three files disagree.

`src-tauri/Cargo.lock` is tracked and also records the crate's version. After
bumping `Cargo.toml`, run a cargo command so the lockfile is bumped in the same
commit. Otherwise the release commit carries a stale lockfile, and the next
cargo command rewrites it and leaves the tree dirty.

```bash
# Later releases: bump all three to the same number, then update Cargo.lock.
(cd src-tauri && cargo check)
git commit -am "chore: v0.2.0"

# Tag and push.
git tag v0.2.0
git push origin main --tags
```

The workflow builds macOS (Apple silicon and Intel, as separate builds), Windows
and Linux, signs each artifact, and uploads them into a **draft** release, each
file named for the computer it is for (section 7 lists the names). It is
a draft on purpose: the moment it is published, clients start being offered it.
A final job then adds `SHA256SUMS` and rewrites `latest.json` (section 7).

## 6. Cutting a beta

Same as section 5, with a suffix after the patch number — **in the three
version files as well as in the tag.** The `guard` job compares the whole tag,
suffix included, with `tauri.conf.json`. Bumping the files to `0.2.0` and
tagging `v0.2.0-1` stops at "Tag must match the app version".

Use a **numeric** suffix:

```bash
# package.json, Cargo.toml and tauri.conf.json all say 0.2.0-1
(cd src-tauri && cargo check)
git commit -am "chore: v0.2.0-1"
git tag v0.2.0-1
git push origin main v0.2.0-1
```

Why not `-beta.1`, as the comment at the top of `release.yml` suggests:
`tauri.conf.json` has `bundle.targets: "all"`, so the Windows job also builds an
MSI, and Tauri's MSI bundler is reported to reject a pre-release identifier that
is not numeric (or is above 65535). That would fail the Windows build; `finalise`
only runs when every build succeeded, so the beta would get no `SHA256SUMS` and
would keep the browser-form URLs in `latest.json` (section 7). **This is
unverified:** the rule lives in Windows-only bundler code and has not been run
here. The other way out is to stop building the MSI (for example, Windows
`--bundles nsis` in the workflow), which is a workflow change.

Any tag containing `-` is marked as a GitHub prerelease. The app's `beta`
channel accepts prereleases; the `stable` channel ignores them, so a beta cannot
reach someone who did not opt in. Neither channel ever takes a draft.

To check that the pipeline still compiles without touching any release, run the
workflow by hand (Actions → release → Run workflow). That builds every target and
uploads the results as workflow artifacts, not as a release. **It needs the
signing secret too.** `tauri.conf.json` sets `bundle.createUpdaterArtifacts:
true` and carries a `pubkey`, so `tauri build` refuses to bundle without
`TAURI_SIGNING_PRIVATE_KEY` ("A public key has been found, but no private key").
The `guard` job, which gives the clear error, only runs on tag pushes, so a dry
run before the secrets are set (section 2) fails at bundling with only that
message.

## 7. Verify the draft before you publish

Check these five things, then publish.

1. **The sixteen files are there, under these names** (version `X.Y.Z`), plus
   `latest.json` and `SHA256SUMS`. A name missing is a build that failed; a name
   in tauri's own form (`_aarch64`, `_x64-setup`, `_x64_en-US`,
   `-X.Y.Z-1.x86_64`) means the pattern did not reach tauri-action.

   | Build | Files |
   |---|---|
   | macOS (Apple silicon) | `Versorium_X.Y.Z_apple_silicon.dmg`, `.app.tar.gz`, `.app.tar.gz.sig` |
   | macOS (Intel) | `Versorium_X.Y.Z_apple_intel.dmg`, `.app.tar.gz`, `.app.tar.gz.sig` |
   | Windows | `Versorium_X.Y.Z_windows_x64.exe` (the setup program), `.exe.sig`, `.msi`, `.msi.sig` |
   | Linux | `Versorium_X.Y.Z_linux_amd64.deb`, `.deb.sig`, `.rpm`, `.rpm.sig`, `.AppImage`, `.AppImage.sig` |

   Each build's matrix entry in `release.yml` gives the pattern
   (`assetPattern`, passed to tauri-action as `releaseAssetNamePattern`), and
   tauri-action writes `latest.json` from the same names:

   | `latest.json` key | File |
   |---|---|
   | `darwin-aarch64`, `darwin-aarch64-app` | `Versorium_X.Y.Z_apple_silicon.app.tar.gz` |
   | `darwin-x86_64`, `darwin-x86_64-app` | `Versorium_X.Y.Z_apple_intel.app.tar.gz` |
   | `windows-x86_64`, `windows-x86_64-msi` | `Versorium_X.Y.Z_windows_x64.msi` |
   | `windows-x86_64-nsis` | `Versorium_X.Y.Z_windows_x64.exe` |
   | `linux-x86_64`, `linux-x86_64-appimage` | `Versorium_X.Y.Z_linux_amd64.AppImage` |
   | `linux-x86_64-deb` | `Versorium_X.Y.Z_linux_amd64.deb` |
   | `linux-x86_64-rpm` | `Versorium_X.Y.Z_linux_amd64.rpm` |

   `v0.1.0` was published before the patterns, with tauri's own names
   (`Versorium_0.1.0_aarch64.dmg`, `Versorium_0.1.0_x64-setup.exe`,
   `Versorium_0.1.0_x64_en-US.msi`, `Versorium-0.1.0-1.x86_64.rpm`, …). The
   app does not mind: it downloads by asset id and finds the checksum line by
   the name the same release gives that id. The names carry the version, so a
   link to `releases/latest/download/<name>` changes with every release, and
   the landing page's download links (`docs/index.html` and
   `docs/en/index.html`, which name v0.1.0's files today) have to be moved to
   the new release's names by hand.

   `[ext]` drops what told tauri's own names apart (`-setup`, `_en-US`), so two
   files of one kind in one build would get one name. GitHub refuses the
   second and that build fails; across builds it is worse, because tauri-action
   deletes an asset of the same name before it uploads, so the later build
   replaces the earlier one's file and nothing says so. A second WiX language,
   or another bundle with an extension already used, needs a pattern that tells
   them apart. `tests/unit/release-assets.test.ts` computes every name and the
   `latest.json` from `release.yml` and `tauri.conf.json`, the way tauri-action
   `action-v1.0.0` does, and fails on a clash.

2. **`latest.json` is attached** and has an entry for each platform:
   `darwin-aarch64`, `darwin-x86_64`, `windows-x86_64`, `linux-x86_64`. A
   platform missing here is a platform that never updates — usually because its
   build job failed while the others succeeded. (The workflow does not run its
   final job unless every build job succeeded, so a failed platform normally
   shows up as a missing `SHA256SUMS` too.)

3. **Its URLs point at `api.github.com`.** The workflow rewrites them from
   `github.com/<owner>/<repo>/releases/download/...` to
   `https://api.github.com/repos/<owner>/<repo>/releases/assets/<id>`. While the
   repository is private only the API asset endpoint serves the bytes; the
   browser-style URL returns 404 even with a valid token. Once it is public both
   forms download, but the app still needs the API form. It refuses any URL
   that is not https on `api.github.com` before downloading anything
   (`bad_update_host`), because the updater sends its headers, a saved token
   among them, to that URL. And it finds the installer's line in `SHA256SUMS`
   from the numeric asset id at the end of the URL (`asset_name_for` in
   `src-tauri/src/update/mod.rs`).

4. **`SHA256SUMS` covers the installers.** The spec (§11) asks for minisign
   *and* sha256: the `.sig` files are the first half, this is the second.

   ```bash
   gh release download v0.2.0 --repo MAECLY/versorium-app --clobber
   sha256sum -c SHA256SUMS        # on macOS: shasum -a 256 -c SHA256SUMS
   ```

5. **Install it yourself** on at least one platform before announcing, following
   the notice for that platform in section 8.

Then publish the draft in the GitHub UI, or:

```bash
gh release edit v0.2.0 --draft=false --repo MAECLY/versorium-app
```

## 8. The install notices

The workflow writes these into every release body, in English and Spanish
(`releaseBody` in `release.yml`). They are reproduced here so the wording stays
the same wherever it is repeated.

> **macOS will say the app is damaged. It is not.**
> The bundle carries no Developer ID signature, so macOS quarantines it and
> Gatekeeper reports the most misleading message it has. Clear the quarantine
> flag once, in Terminal:
>
> ```
> xattr -rd com.apple.quarantine /Applications/Versorium.app
> ```
>
> Run it only on a build you took from this release page — that flag is the
> check that protects you from a tampered download.

> **SmartScreen will interrupt the installer.**
> The installer is unsigned for the same reason the macOS bundle is, so Windows
> shows the blue "Windows protected your PC" screen. Choose **More info**, then
> **Run anyway**. Signed builds need Apple and Microsoft
> certificates, which the project does not have yet.

The older advice — right-click the app and choose **Open** — is **wrong on
current macOS**. A quarantined bundle without a Developer ID signature is
reported as damaged, and right-click → Open does not get past that. The release
body used to say it; it no longer does. The product spec
(`PROMPT-VERSORIUM.md`, §11) still says it and should not be followed on this
point.

On Linux the AppImage runs as is; mark it executable if your file manager has
not.

## 9. If the canonical repository changes

Nothing in `.github/workflows/release.yml` hardcodes an owner: it uses
`github.repository`, so it is correct in any fork.

The **app** is a different matter. The updater's target repository is a pair of
Rust constants in `src-tauri/src/update/mod.rs` (`UPDATE_OWNER = "MAECLY"`,
`UPDATE_REPO = "versorium-app"`), deliberately not configurable at runtime:
anything that lets an environment variable or a setting redirect where updates
come from is a way to make the app install someone else's signed code. Changing
it is a code change and a rebuild.

The repository was transferred from a personal account to the **MAECLY** org on
2026-09-28, so the constants and the git remote agree. They match the org's
casing exactly rather than relying on GitHub being case-insensitive about
owners.

The spec (§11) names the signing secret `VERSORIUM_MINISIGN_KEY`. The workflow
uses `TAURI_SIGNING_PRIVATE_KEY`, the name the Tauri build reads; that is the
one to set.

## Troubleshooting

**The tag build stops at "Signing key must be configured".**
`TAURI_SIGNING_PRIVATE_KEY` is not set or is empty. Set it (section 2) and push
the tag again — delete the remote tag first if it already exists.

**The tag build stops at "Tag must match the app version".** The tag and
`tauri.conf.json` disagree, or the three version files disagree. Fix the files,
commit, and re-tag.

**The Linux job fails at `libwebkit2gtk`.** Tauri 2 needs `-4.1`, not `-4.0`.
The workflow pins `ubuntu-22.04` rather than `ubuntu-latest` so this does not
change under you. If that runner is retired, `ubuntu-24.04` also ships 4.1, but
the Vulkan SDK step installs LunarG's `jammy` repository and would need the
24.04 equivalent.

**The build fails at `pnpm/action-setup`.** The action takes pnpm's version from
`package.json` → `packageManager` (`pnpm@12.4.1`), so the workflow gives it no
`version:` input. Supplying both makes it refuse with "Multiple versions of pnpm
specified". Keep it that way.

**`pnpm install --frozen-lockfile` fails with `ERR_PNPM_IGNORED_BUILDS`.**
`pnpm-workspace.yaml` is committed and its `allowBuilds` list must keep
`esbuild: true`: esbuild links its platform binary in an install script, and
without it `vite build` fails. A dependency that newly needs an install script
has to be added there too.

**A manual (dry) run fails at bundling with "A public key has been found, but
no private key".** `TAURI_SIGNING_PRIVATE_KEY` is not set. The dry run needs it
as much as a tag build does (section 6).

**A beta's Windows job fails on the MSI version.** The pre-release suffix is not
numeric. Use a tag like `v0.2.0-1` (section 6).

**Clients never see the update.** In order of likelihood: the repository is
still private and the user has no token that can read it (Settings → Updates
says no published version is visible yet); the release is still a draft;
`tauri.conf.json`'s version was not bumped; the platform key is missing from
`latest.json`; the URLs in `latest.json` are not the `api.github.com` form (the
install then stops with `bad_update_host`); or GitHub's anonymous rate limit,
which the panel names along with the time it resets.

**A client downloads but refuses to install.** Either the signature did not
verify — the build was signed with a different key than the `pubkey` in
`tauri.conf.json`, which section 1's check exists to prevent — or the download
did not match its line in `SHA256SUMS`.
