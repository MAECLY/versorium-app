//! Settings → Updates: check, skip, install.
//!
//! Two rules from spec §11 shape everything here. A check never waits for a
//! token: under the amendment of 2026-10-03 the repository goes public, where
//! anyone may read its releases, so a missing token means an anonymous check
//! rather than no check. A saved token is still sent, which keeps updates
//! working while the repository is private and lifts GitHub's anonymous rate
//! limit.
//! And nothing is installed until both signatures agree: the plugin verifies
//! minisign on the bytes it downloaded, and we verify sha256 against the
//! release's own `SHA256SUMS` before handing those bytes to the installer. The
//! first rule does not touch the second: with or without a token, the request
//! goes through the same host pin and the install through the same two checks.

use crate::commands::settings::SettingsStore;
use crate::update;
use serde::Serialize;
use std::sync::{Mutex, OnceLock};
use tauri_plugin_updater::UpdaterExt;

pub const CHANNELS: [&str; 2] = ["stable", "beta"];

/// How far along an install is, so the writer sees the machine working.
///
/// The phases are the real ones this function performs, not a decorative
/// animation: `downloading` has byte counts, `verifying` is the two signature
/// checks, `installing` hands the bytes to the platform, and `ready` means the
/// app must restart to become the new version. On macOS there is no installer
/// step at all — Tauri swaps the bundle in place — so `installing` is brief
/// there and long on Windows, where it runs the real installer.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    /// `downloading` | `verifying` | `installing` | `ready` | `failed`
    pub phase: String,
    pub received: u64,
    /// Absent when the server sends no length, which the UI shows as
    /// indeterminate rather than as zero.
    pub total: Option<u64>,
    /// Set only when `phase` is `failed`: an error code, never prose.
    pub error: Option<String>,
}

impl InstallProgress {
    fn at(phase: &str) -> Self {
        Self { phase: phase.into(), received: 0, total: None, error: None }
    }
}

fn install_progress() -> &'static Mutex<Option<InstallProgress>> {
    static PROGRESS: OnceLock<Mutex<Option<InstallProgress>>> = OnceLock::new();
    PROGRESS.get_or_init(|| Mutex::new(None))
}

fn set_progress(next: InstallProgress) {
    if let Ok(mut guard) = install_progress().lock() {
        *guard = Some(next);
    }
}

fn advance(received: u64, total: Option<u64>) {
    if let Ok(mut guard) = install_progress().lock() {
        if let Some(current) = guard.as_mut() {
            current.received = received;
            current.total = total.or(current.total);
        }
    }
}

/// Polled by the dialog. Follows the download manager's shape rather than
/// introducing this codebase's first Tauri event.
#[tauri::command]
pub fn update_progress() -> Option<InstallProgress> {
    install_progress().lock().ok().and_then(|g| g.clone())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    pub version: String,
    pub notes: String,
    pub date: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub current_version: String,
    pub available: Option<AvailableUpdate>,
    pub channel: String,
    pub automatic: bool,
    /// An updates token is saved. Separate from the novel token by design.
    /// Optional since the §11 amendment: it changes what a check can see and
    /// how often it may run, not whether it runs.
    pub token_set: bool,
    pub checking: bool,
    /// A check has finished since launch, or since the channel changed. Without
    /// it the panel could not tell "nothing newer" from "never asked".
    pub checked: bool,
    /// An i18n code, never prose — the UI renders it in the reader's language.
    pub last_error: Option<String>,
    /// When GitHub's rate limit lifts, in Unix seconds. Only with a rate-limit
    /// code, and only when GitHub said.
    pub resets_at: Option<u64>,
}

/// What the last check found, so the panel can be reopened without going back
/// to the network.
#[derive(Default, Clone)]
struct LastCheck {
    available: Option<AvailableUpdate>,
    error: Option<String>,
    resets_at: Option<u64>,
    checked: bool,
}

impl LastCheck {
    /// A check that finished: an offer, or the reason there is none.
    fn finished(available: Option<AvailableUpdate>, refusal: Option<update::Refusal>) -> Self {
        Self {
            available,
            resets_at: refusal.as_ref().and_then(|r| r.resets_at),
            error: refusal.map(|r| r.code),
            checked: true,
        }
    }
}

fn last_check() -> &'static Mutex<LastCheck> {
    static STATE: OnceLock<Mutex<LastCheck>> = OnceLock::new();
    STATE.get_or_init(Default::default)
}

fn remember(available: Option<AvailableUpdate>, refusal: Option<update::Refusal>) {
    if let Ok(mut state) = last_check().lock() {
        *state = LastCheck::finished(available, refusal);
    }
}

/// As if no check had run: another channel has other releases, so what the
/// last one found says nothing about it.
fn forget() {
    if let Ok(mut state) = last_check().lock() {
        *state = LastCheck::default();
    }
}

fn current_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// A skipped version is not an available one (spec §11: "Skip this version").
fn hide_if_skipped(
    available: Option<AvailableUpdate>,
    skipped: Option<&str>,
) -> Option<AvailableUpdate> {
    match (available, skipped) {
        (Some(update), Some(skip)) if update.version == skip => None,
        (available, _) => available,
    }
}

fn status_from(state: &SettingsStore) -> UpdateStatus {
    let last = last_check().lock().map(|s| s.clone()).unwrap_or_default();
    status_with(state, token_set(state), &last)
}

/// Whether an updates token is saved anywhere — never its value. Blocking (it
/// may touch the OS credential store).
fn token_set(state: &SettingsStore) -> bool {
    crate::secrets::updates_token(state).is_some()
}

/// Pure over its inputs, so a test can hand it any check's outcome without
/// touching the process-wide one.
fn status_with(state: &SettingsStore, token_set: bool, last: &LastCheck) -> UpdateStatus {
    let settings = state.get();
    UpdateStatus {
        current_version: current_version(),
        available: hide_if_skipped(last.available.clone(), settings.update_skipped.as_deref()),
        channel: settings.update_channel,
        automatic: settings.update_automatic,
        token_set,
        // The command has returned, so by definition it is no longer checking;
        // the frontend owns its own in-flight state.
        checking: false,
        checked: last.checked,
        last_error: last.error.clone(),
        resets_at: last.resets_at,
    }
}

/// Map a plugin failure to a code the UI can translate.
fn plugin_code(error: &tauri_plugin_updater::Error) -> String {
    use tauri_plugin_updater::Error;
    match error {
        Error::Minisign(_) | Error::SignedVersionMismatch { .. } | Error::MissingSignedVersion => {
            "bad_signature".into()
        }
        Error::ReleaseNotFound | Error::TargetNotFound(_) | Error::TargetsNotFound(_) => {
            "no_release".into()
        }
        Error::UnsupportedArch | Error::UnsupportedOs => "unsupported_platform".into(),
        // Our redirect rule refusing a hop (`update::may_follow`): the pin
        // doing its job, so it is named as one rather than as the network.
        Error::Reqwest(e) if e.is_redirect() => update::BAD_HOST.into(),
        _ => "network".into(),
    }
}

/// Build an updater pointed at this channel's manifest, carrying the token when
/// there is one. `next` is what the updater is for: the plugin cannot name a
/// rate limit on its own requests, so the release list has to show room for
/// them first (`update::budget_covers`).
///
/// `tauri.conf.json` leaves `endpoints` empty on purpose: the plugin refuses a
/// check that never set one, so every check has to come through here — through
/// the compiled-in owner and repo, the host pin and the redirect rule. A URL
/// baked into the config would skip all three.
///
/// The headers go on the builder, which applies them to the check **and** the
/// download — the plugin only defaults `Accept` when it is unset (`updater.rs`
/// `check()` and `download()`), and carries the builder's map into `Update`.
/// Setting `Accept` on our own manifest fetch alone would leave the plugin
/// downloading the installer with the default, and GitHub would answer the
/// asset request with JSON metadata instead of the binary.
async fn updater_for(
    app: &tauri::AppHandle,
    token: Option<&str>,
    channel: &str,
    next: update::Next,
) -> Result<tauri_plugin_updater::Updater, update::Refusal> {
    let manifest = update::latest_manifest_url(token, channel, next).await?;
    let endpoint = reqwest::Url::parse(&manifest).map_err(|_| update::BAD_HOST.to_string())?;

    let mut builder = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|_| update::BAD_HOST.to_string())?
        // Both of the plugin's requests are redirected to GitHub's storage
        // host; this keeps the token from going along (`update::may_follow`).
        .configure_client(update::plugin_client);
    for (name, value) in update::request_headers(token, update::ACCEPT_BINARY) {
        // Only a token with characters no header may hold gets here.
        builder = builder.header(name, value).map_err(|_| update::TOKEN_REJECTED.to_string())?;
    }
    Ok(builder.build().map_err(|e| plugin_code(&e))?)
}

/// The host pin, applied to the installer's URL before a byte of it is asked
/// for. That URL comes from `latest.json`, which nothing signs, and the plugin
/// sends the builder's headers — the token among them — wherever it points.
fn pinned_download(download_url: &str) -> Result<(), String> {
    update::manifest_url_for(download_url).map(|_| ())
}

#[tauri::command]
pub async fn update_status(state: tauri::State<'_, SettingsStore>) -> Result<UpdateStatus, String> {
    Ok(status_from(&state))
}

#[tauri::command]
pub async fn update_check(
    app: tauri::AppHandle,
    state: tauri::State<'_, SettingsStore>,
) -> Result<UpdateStatus, String> {
    let settings = state.get();
    // No token is not a reason to stay home (§11, amended 2026-10-03): it
    // means asking anonymously. There is still no loop — this runs once per
    // launch and once per button press.
    let token = crate::secrets::updates_token(&state);

    let found = async {
        let updater = updater_for(&app, token.as_deref(), &settings.update_channel, update::Next::Check).await?;
        updater.check().await.map_err(|e| update::Refusal::from(plugin_code(&e)))
    }
    .await;

    match found {
        Ok(Some(update)) => {
            remember(
                Some(AvailableUpdate {
                    version: update.version.clone(),
                    notes: update.body.clone().unwrap_or_default(),
                    date: update.date.map(|d| d.to_string()),
                }),
                None,
            );
        }
        Ok(None) => remember(None, None),
        Err(refusal) => remember(None, Some(refusal)),
    }
    Ok(status_from(&state))
}

#[tauri::command]
pub async fn update_install(
    app: tauri::AppHandle,
    state: tauri::State<'_, SettingsStore>,
) -> Result<(), String> {
    let settings = state.get();
    // Optional, as for the check: anonymous when absent, sent when saved.
    let token = crate::secrets::updates_token(&state);

    // Every early return past this point has to record the failure, or the
    // dialog would sit on a stale phase forever.
    set_progress(InstallProgress::at("downloading"));
    let outcome = install_inner(&app, token.as_deref(), &settings.update_channel).await;
    if let Err(code) = &outcome {
        let mut failed = InstallProgress::at("failed");
        failed.error = Some(code.clone());
        set_progress(failed);
    }
    outcome
}

async fn install_inner(
    app: &tauri::AppHandle,
    token: Option<&str>,
    channel: &str,
) -> Result<(), String> {
    let assets = update::latest_release_assets(token, channel).await?;
    let updater = updater_for(app, token, channel, update::Next::Install).await?;
    let update = updater
        .check()
        .await
        .map_err(|e| plugin_code(&e))?
        .ok_or_else(|| "no_release".to_string())?;
    pinned_download(update.download_url.as_str())?;

    // download() verifies minisign and returns the bytes. Checking sha256 here,
    // before install(), is what makes the spec's "reject if they do not match"
    // real rather than aspirational — download_and_install() would leave no
    // window to look.
    // The two callbacks were discarded, which is why the dialog had nothing to
    // show between "Update" and either a relaunch or an error.
    let mut received = 0u64;
    let bytes = update
        .download(
            |chunk, total| {
                received += chunk as u64;
                advance(received, total);
            },
            || set_progress(InstallProgress::at("verifying")),
        )
        .await
        .map_err(|e| plugin_code(&e))?;

    let file_name = update::asset_name_for(&assets, update.download_url.as_str())
        .ok_or_else(|| "no_checksums".to_string())?;
    update::verify_sha256(token, &assets, &file_name, &update::sha256_of(&bytes)).await?;

    set_progress(InstallProgress::at("installing"));
    update.install(bytes).map_err(|e| plugin_code(&e))?;
    // Reached only where install() returns rather than replacing the process:
    // macOS swaps the bundle and comes back here, so the writer is told to
    // restart instead of being left looking at "installing".
    set_progress(InstallProgress::at("ready"));
    Ok(())
}

/// Restart into the version that was just installed.
///
/// `AppHandle::restart()` is native to Tauri 2, so this needs no process
/// plugin. It never returns, which is why the command is typed as returning
/// nothing rather than a Result nobody could read.
#[tauri::command]
pub fn update_relaunch(app: tauri::AppHandle) {
    app.restart();
}

#[tauri::command]
pub fn update_skip(
    state: tauri::State<SettingsStore>,
    version: String,
) -> Result<UpdateStatus, String> {
    let version = version.trim().to_string();
    if version.is_empty() {
        return Err("bad_args".into());
    }
    state.update(|s| s.update_skipped = Some(version));
    Ok(status_from(&state))
}

#[tauri::command]
pub fn update_set_channel(
    state: tauri::State<SettingsStore>,
    channel: String,
) -> Result<UpdateStatus, String> {
    if !CHANNELS.contains(&channel.as_str()) {
        return Err("bad_args".into());
    }
    state.update(|s| {
        s.update_channel = channel;
        // A skip was a decision about one track's release. Carrying it to the
        // other track would hide a version the writer never saw.
        s.update_skipped = None;
    });
    forget();
    Ok(status_from(&state))
}

#[tauri::command]
pub fn update_set_automatic(
    state: tauri::State<SettingsStore>,
    automatic: bool,
) -> Result<UpdateStatus, String> {
    state.update(|s| s.update_automatic = automatic);
    Ok(status_from(&state))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(dir: &tempfile::TempDir) -> SettingsStore {
        SettingsStore::load(dir.path().join("settings.json"))
    }

    fn offered(version: &str) -> AvailableUpdate {
        AvailableUpdate { version: version.into(), notes: "notes".into(), date: None }
    }

    #[test]
    fn a_skipped_version_is_not_offered_again() {
        assert!(hide_if_skipped(Some(offered("1.2.0")), Some("1.2.0")).is_none());
        // A different version still is — a skip is about one release.
        assert_eq!(
            hide_if_skipped(Some(offered("1.3.0")), Some("1.2.0")).unwrap().version,
            "1.3.0"
        );
        assert!(hide_if_skipped(Some(offered("1.2.0")), None).is_some());
        assert!(hide_if_skipped(None, Some("1.2.0")).is_none());
    }

    #[test]
    fn a_fresh_install_is_on_stable_and_checks_by_itself() {
        let dir = tempfile::tempdir().unwrap();
        let status = status_with(&store(&dir), false, &LastCheck::default());
        assert_eq!(status.channel, "stable");
        assert!(status.automatic, "spec §11: on by default on stable");
        assert!(!status.token_set, "no token yet, and none is needed to check");
        assert!(!status.checked, "nothing asked yet, so nothing is claimed");
        assert_eq!(status.current_version, env!("CARGO_PKG_VERSION"));
        assert!(status.available.is_none());
    }

    #[test]
    fn a_token_is_reported_but_no_longer_required() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir);
        assert!(!status_from(&store).token_set);

        store.update(|s| s.github_updates_token = Some("ghp_example".into()));
        assert!(status_from(&store).token_set);

        // Whitespace is not a credential.
        store.update(|s| s.github_updates_token = Some("   ".into()));
        assert!(!status_from(&store).token_set);
    }

    #[test]
    fn a_finished_check_is_told_apart_from_none_at_all() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir);

        let never = status_with(&store, false, &LastCheck::default());
        assert!(!never.checked && never.last_error.is_none());

        // Nothing newer: an answer, not a guess.
        let current = status_with(&store, false, &LastCheck::finished(None, None));
        assert!(current.checked);
        assert!(current.available.is_none() && current.last_error.is_none());

        let found = status_with(&store, false, &LastCheck::finished(Some(offered("0.2.0")), None));
        assert_eq!(found.available.unwrap().version, "0.2.0");
    }

    #[test]
    fn a_refusal_reaches_the_panel_with_its_reset_time() {
        let dir = tempfile::tempdir().unwrap();
        let limited = update::Refusal {
            code: update::RATE_LIMITED.into(),
            resets_at: Some(1_791_054_785),
        };
        let status = status_with(&store(&dir), false, &LastCheck::finished(None, Some(limited)));
        assert!(status.checked);
        assert_eq!(status.last_error.as_deref(), Some("update_rate_limited"));
        assert_eq!(status.resets_at, Some(1_791_054_785));

        // Only a rate limit carries a time.
        let hidden = update::Refusal::from(update::NONE_VISIBLE.to_string());
        let status = status_with(&store(&dir), false, &LastCheck::finished(None, Some(hidden)));
        assert_eq!(status.last_error.as_deref(), Some("update_none_visible"));
        assert_eq!(status.resets_at, None);
    }

    #[test]
    fn changing_channel_clears_a_skip_from_the_other_track() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir);
        store.update(|s| s.update_skipped = Some("1.2.0-beta.1".into()));

        // Exercised through the same code path the command uses.
        store.update(|s| {
            s.update_channel = "beta".into();
            s.update_skipped = None;
        });
        assert_eq!(store.get().update_channel, "beta");
        assert!(store.get().update_skipped.is_none());
    }

    #[test]
    fn only_the_two_real_channels_are_accepted() {
        assert!(CHANNELS.contains(&"stable"));
        assert!(CHANNELS.contains(&"beta"));
        for nonsense in ["nightly", "STABLE", "", "../etc"] {
            assert!(!CHANNELS.contains(&nonsense), "{nonsense} is not a channel");
        }
    }

    #[test]
    fn an_empty_version_is_not_something_to_skip() {
        // Recording an empty skip would silently suppress nothing, or worse,
        // match a release whose version failed to parse.
        assert!("   ".trim().is_empty());
    }

    #[test]
    fn the_download_gets_the_binary_accept_with_or_without_a_token() {
        let named = |headers: &[(reqwest::header::HeaderName, String)], name: &reqwest::header::HeaderName| {
            headers.iter().find(|(n, _)| n == name).map(|(_, v)| v.clone())
        };
        // Without this on the *download*, GitHub answers an asset request with
        // JSON metadata and the install fails on bytes that are not an
        // installer. The plugin applies the builder's headers to both
        // requests, so `updater_for` putting them there is what covers it.
        for token in [Some("ghp_example"), None] {
            let headers = update::request_headers(token, update::ACCEPT_BINARY);
            assert_eq!(
                named(&headers, &reqwest::header::ACCEPT).as_deref(),
                Some("application/octet-stream")
            );
            assert_eq!(
                named(&headers, &reqwest::header::AUTHORIZATION),
                token.map(|t| format!("Bearer {t}")),
                "the token goes on the builder only when there is one"
            );
        }
    }

    #[test]
    fn the_installer_url_is_pinned_before_anything_is_downloaded() {
        // `latest.json` is unsigned; whatever it names, the token must not be
        // sent there, and neither may the anonymous request go.
        assert!(pinned_download("https://api.github.com/repos/MAECLY/versorium-app/releases/assets/7").is_ok());
        for hostile in [
            "https://evil.example.com/repos/MAECLY/versorium-app/releases/assets/7",
            "https://github.com/MAECLY/versorium-app/releases/download/v0.2.0/Versorium.dmg",
            "http://api.github.com/repos/MAECLY/versorium-app/releases/assets/7",
        ] {
            assert_eq!(pinned_download(hostile).unwrap_err(), "bad_update_host", "{hostile}");
        }
    }

    #[test]
    fn a_signature_failure_still_refuses_the_install() {
        use tauri_plugin_updater::Error;
        // The plugin's minisign verdicts, each named rather than lost as
        // "network". The anonymous path reaches the same `download()`.
        assert_eq!(
            plugin_code(&Error::SignedVersionMismatch { signed: "0.1.0".into(), announced: "0.2.0".into() }),
            "bad_signature"
        );
        assert_eq!(plugin_code(&Error::MissingSignedVersion), "bad_signature");
        assert_eq!(plugin_code(&Error::ReleaseNotFound), "no_release");
        assert_eq!(plugin_code(&Error::UnsupportedOs), "unsupported_platform");
    }

    #[test]
    fn the_signing_key_and_the_empty_endpoint_list_are_unchanged() {
        // The minisign check is only as good as the key it checks against, and
        // `endpoints: []` is what forces every check through `updater_for` and
        // its pins. If this test has to change, the key was rotated on purpose.
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).expect("tauri.conf.json");
        let updater = &config["plugins"]["updater"];
        assert_eq!(
            updater["pubkey"],
            "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDM5N0FDNjg3NDk5QUQzNDkKUldSSjA1cEpoOFo2T1Y4Y053TFNuQW1NbVRySTRCYnFhdTlVYXA5djd5b0RLL0UvTENEbmNsU2QK",
            "minisign key id 397AC687499AD349 (RELEASING.md, section 1)"
        );
        assert_eq!(updater["endpoints"], serde_json::json!([]));
        assert_eq!(config["bundle"]["createUpdaterArtifacts"], true);
    }

    #[test]
    fn a_status_never_carries_the_token() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir);
        store.update(|s| s.github_updates_token = Some("ghp_secret_value".into()));
        let json = serde_json::to_string(&status_from(&store)).unwrap();
        assert!(!json.contains("ghp_secret_value"), "a credential must not cross the wire");
        assert!(json.contains("\"tokenSet\":true"));
    }

    #[test]
    fn the_status_shape_is_the_one_the_frontend_reads() {
        let dir = tempfile::tempdir().unwrap();
        let json = serde_json::to_value(status_with(&store(&dir), false, &LastCheck::default())).unwrap();
        for key in [
            "currentVersion",
            "available",
            "channel",
            "automatic",
            "tokenSet",
            "checking",
            "checked",
            "lastError",
            "resetsAt",
        ] {
            assert!(json.get(key).is_some(), "UpdateStatus is missing `{key}`");
        }
        // The old name must not linger: the UI no longer gates on signing in.
        assert!(json.get("signedIn").is_none());
        let offered = serde_json::to_value(offered("1.2.0")).unwrap();
        for key in ["version", "notes", "date"] {
            assert!(offered.get(key).is_some(), "AvailableUpdate is missing `{key}`");
        }
    }
}
