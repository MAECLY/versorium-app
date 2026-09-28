# Releasing Versorium

Versorium updates itself from GitHub Releases. Every artifact is signed, and a
client refuses anything it cannot verify — so the signing key is not optional
and a release that skips it simply never installs.

This is the whole procedure. It assumes you have push access and can set
repository secrets.

## 1. The signing key, once

Tauri signs update artifacts with minisign. Generate the pair once, for the
project's lifetime:

```bash
pnpm exec tauri signer generate -w ~/.versorium/signing.key
```

That writes two files:

| File | What it is | Where it belongs |
|---|---|---|
| `~/.versorium/signing.key` | **private** key | a GitHub Actions secret, then delete the local copy |
| `~/.versorium/signing.key.pub` | public key | already in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey` |

The public half is in the repository on purpose — that is how a client knows
which signature to trust. **The private half must never be committed.** Anyone
holding it can sign an update that every installed copy of Versorium will accept
and run.

If you rotate the key, every client on the old key stops updating until it is
reinstalled. Treat it as permanent.

## 2. Repository secrets

Settings → Secrets and variables → Actions:

| Secret | Required | What it is |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | yes | the **contents** of `signing.key`, not a path |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | yes if the key has one | the password you set at `signer generate`; set it to an empty secret if you generated without one |

`GITHUB_TOKEN` is provided by Actions — you do not create it.

The workflow refuses to build when `TAURI_SIGNING_PRIVATE_KEY` is missing rather
than publishing artifacts the updater would reject.

## 3. Cutting a release

Three files carry the version and **all three must agree**:

- `package.json` → `version`
- `src-tauri/Cargo.toml` → `[package] version`
- `src-tauri/tauri.conf.json` → `version`

The updater compares the running app's version against `latest.json`, and that
version comes from `tauri.conf.json`. If the tag says `v0.2.0` but
`tauri.conf.json` still says `0.1.0`, the release publishes cleanly and **no
client is ever offered it** — the most common way an updater appears broken. The
workflow checks this before building and stops if they disagree.

```bash
# 1. Bump all three to the same number, then commit.
git commit -am "chore: v0.2.0"

# 2. Tag and push.
git tag v0.2.0
git push origin main --tags
```

The workflow builds macOS (Apple silicon and Intel), Windows and Linux, signs
each artifact, and opens a **draft** release. It is a draft on purpose: the
moment it is published, clients start being offered it.

## 4. Cutting a beta

Same, with a suffix after the patch number:

```bash
git tag v0.2.0-beta.1
git push origin v0.2.0-beta.1
```

Any tag containing `-` is published as a GitHub prerelease, which is what the
app's `beta` channel looks for. The `stable` channel ignores prereleases
entirely, so a beta cannot reach someone who did not opt in.

## 5. Verify before you publish

The release is a draft. Check these four things, then publish it.

1. **`latest.json` is attached.** Without it there is nothing for a client to
   read. It should list one entry per platform:
   `darwin-aarch64`, `darwin-x86_64`, `windows-x86_64`, `linux-x86_64`. A
   platform missing here is a platform that never updates — usually because its
   build job failed while the others succeeded.

2. **Its URLs point at `api.github.com`.** The workflow rewrites them from
   `github.com/<owner>/<repo>/releases/download/...` to
   `https://api.github.com/repos/<owner>/<repo>/releases/assets/<id>`. This is
   not cosmetic: on a **private** repository the browser-style download URL
   returns 404 even with a valid token, and only the API asset endpoint serves
   the bytes. If you ever make the repository public, either form works.

3. **`SHA256SUMS` covers the installers.** The spec wants minisign *and*
   sha256 — the `.sig` files are the first half, this is the second.

   ```bash
   gh release download v0.2.0 --repo <owner>/<repo> --clobber
   sha256sum -c SHA256SUMS
   ```

4. **Install it yourself** on at least one platform before announcing.

Then publish the draft in the GitHub UI, or:

```bash
gh release edit v0.2.0 --draft=false --repo <owner>/<repo>
```

## 6. Gatekeeper and SmartScreen

There is no Apple Developer ID certificate and no Windows Authenticode
certificate yet, so the OS will not recognise the publisher:

- **macOS** — the first launch is blocked. Right-click the app → **Open**, then
  confirm. After that it opens normally.
- **Windows** — SmartScreen may show "Windows protected your PC". Choose **More
  info → Run anyway**.
- **Linux** — the AppImage just runs; mark it executable if your file manager
  has not.

Say this plainly in release notes rather than letting people discover it. The
workflow already puts it in the generated body, in English and Spanish.

**This does not weaken update security.** Gatekeeper and SmartScreen are about
the OS recognising the publisher. Versorium verifies every update against the
minisign public key compiled into the app, and refuses anything that does not
match, whether or not the OS trusts the installer.

Adding a Developer ID or Authenticode certificate later is an extra step in this
workflow, not a replacement for the signing key.

## 7. If the canonical repository changes

Nothing in `.github/workflows/release.yml` hardcodes an owner — it uses
`github.repository`, so it is correct in any fork.

The **app** is a different matter. The updater's target repository is a Rust
constant in `src-tauri/src/update/mod.rs` (`UPDATE_OWNER` / `UPDATE_REPO`),
deliberately not configurable at runtime: anything that lets an environment
variable or a setting redirect where updates come from is a way to make the app
install someone else's signed code. Changing it is a code change and a rebuild.

At the time of writing the spec names `maecly/versorium-app` while the git
remote is a personal fork. Those constants are the one place to reconcile that.

## Troubleshooting

**The Linux job fails at `libwebkit2gtk`.** Tauri 2 needs `-4.1`, not `-4.0`.
The workflow pins `ubuntu-22.04` rather than `ubuntu-latest` so this does not
change under you; if that runner is retired, `ubuntu-24.04` also ships 4.1.

**Clients never see the update.** In order of likelihood: the release is still a
draft; `tauri.conf.json`'s version was not bumped; the platform key is missing
from `latest.json`; or the URLs were not rewritten to the API form on a private
repository.

**The build fails at `pnpm/action-setup`.** It needs an explicit version
because `package.json` has no `packageManager` field. The workflow pins pnpm 10,
matching `lockfileVersion: '9.0'`. If you adopt a `packageManager` field later,
drop the `version:` input so the two cannot disagree.

**`pnpm install --frozen-lockfile` fails on a build script.** pnpm 12 introduced
`pnpm-workspace.yaml` → `allowBuilds`. If that file is ever committed it must
contain real booleans (`esbuild: true` — esbuild fetches its binary in a
postinstall, and without it `vite build` fails), not the placeholder pnpm writes
on first run.

**A client downloads but refuses to install.** The signature did not verify —
the build was signed with a different key than the `pubkey` in
`tauri.conf.json`. Check which secret the run used.
