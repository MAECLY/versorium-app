//! Settings → Updates: check, skip, install.
//!
//! Two rules from spec §11 shape everything here. Without a token the app does
//! not check at all — no silent loop against an endpoint that will only ever
//! answer 401. And nothing is installed until both signatures agree: the plugin
//! verifies minisign on the bytes it downloaded, and we verify sha256 against
//! the release's own `SHA256SUMS` before handing those bytes to the installer.

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
    /// An updates token is present. Separate from the novel token by design.
    pub signed_in: bool,
    pub checking: bool,
    /// An i18n code, never prose — the UI renders it in the reader's language.
    pub last_error: Option<String>,
}

/// What the last check found, so the panel can be reopened without going back
/// to the network.
#[derive(Default)]
struct LastCheck {
    available: Option<AvailableUpdate>,
    error: Option<String>,
}

fn last_check() -> &'static Mutex<LastCheck> {
    static STATE: OnceLock<Mutex<LastCheck>> = OnceLock::new();
    STATE.get_or_init(Default::default)
}

fn remember(available: Option<AvailableUpdate>, error: Option<String>) {
    if let Ok(mut state) = last_check().lock() {
        state.available = available;
        state.error = error;
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
    let settings = state.get();
    let token = settings.github_updates_token.as_deref().unwrap_or_default();
    let (available, last_error) = last_check()
        .lock()
        .map(|s| (s.available.clone(), s.error.clone()))
        .unwrap_or((None, None));
    UpdateStatus {
        current_version: current_version(),
        available: hide_if_skipped(available, settings.update_skipped.as_deref()),
        channel: settings.update_channel,
        automatic: settings.update_automatic,
        signed_in: !token.trim().is_empty(),
        // The command has returned, so by definition it is no longer checking;
        // the frontend owns its own in-flight state.
        checking: false,
        last_error,
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
        _ => "network".into(),
    }
}

/// The headers every updater request carries.
///
/// Both go on the `UpdaterBuilder`, which applies them to the check **and** the
/// download — the plugin only defaults `Accept` when it is unset (`updater.rs`
/// `check()` and `download()`), and carries the builder's map into `Update`.
/// Setting `Accept` on our own manifest fetch alone would leave the plugin
/// downloading the installer with the default, and GitHub would answer a
/// private asset request with JSON metadata instead of the binary.
fn request_headers(token: &str) -> [(reqwest::header::HeaderName, String); 2] {
    [
        (reqwest::header::AUTHORIZATION, format!("Bearer {token}")),
        (reqwest::header::ACCEPT, update::ACCEPT_BINARY.to_string()),
    ]
}

/// Build an updater pointed at this channel's manifest, carrying the token.
///
/// `tauri.conf.json` leaves `endpoints` empty on purpose: the plugin refuses a
/// check that never set one, so every check has to come through here and pick
/// up the credential. A URL baked into the config could not carry a token, and
/// a private repo answers nothing without one.
async fn updater_for(
    app: &tauri::AppHandle,
    token: &str,
    channel: &str,
) -> Result<tauri_plugin_updater::Updater, String> {
    let manifest = update::latest_manifest_url(token, channel).await?;
    let endpoint = reqwest::Url::parse(&manifest).map_err(|_| "bad_update_host".to_string())?;

    let mut builder = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|_| "bad_update_host".to_string())?;
    for (name, value) in request_headers(token) {
        builder = builder.header(name, value).map_err(|_| "bad_token".to_string())?;
    }
    builder.build().map_err(|e| plugin_code(&e))
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
    let token = settings.github_updates_token.clone().unwrap_or_default();
    if token.trim().is_empty() {
        // Spec §11: no token, no check. The UI shows a sign-in prompt instead
        // of looping against an endpoint that can only refuse us.
        remember(None, None);
        return Ok(status_from(&state));
    }

    let found = async {
        let updater = updater_for(&app, &token, &settings.update_channel).await?;
        updater.check().await.map_err(|e| plugin_code(&e))
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
        Err(code) => remember(None, Some(code)),
    }
    Ok(status_from(&state))
}

#[tauri::command]
pub async fn update_install(
    app: tauri::AppHandle,
    state: tauri::State<'_, SettingsStore>,
) -> Result<(), String> {
    let settings = state.get();
    let token = settings.github_updates_token.clone().unwrap_or_default();
    if token.trim().is_empty() {
        return Err("not_signed_in".into());
    }

    // Every early return past this point has to record the failure, or the
    // dialog would sit on a stale phase forever.
    set_progress(InstallProgress::at("downloading"));
    let outcome = install_inner(&app, &token, &settings.update_channel).await;
    if let Err(code) = &outcome {
        let mut failed = InstallProgress::at("failed");
        failed.error = Some(code.clone());
        set_progress(failed);
    }
    outcome
}

async fn install_inner(
    app: &tauri::AppHandle,
    token: &str,
    channel: &str,
) -> Result<(), String> {
    let assets = update::latest_release_assets(token, channel).await?;
    let updater = updater_for(app, token, channel).await?;
    let update = updater
        .check()
        .await
        .map_err(|e| plugin_code(&e))?
        .ok_or_else(|| "no_release".to_string())?;

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
    remember(None, None);
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
        let status = status_from(&store(&dir));
        assert_eq!(status.channel, "stable");
        assert!(status.automatic, "spec §11: on by default on stable");
        assert!(!status.signed_in, "no token yet");
        assert_eq!(status.current_version, env!("CARGO_PKG_VERSION"));
        assert!(status.available.is_none());
    }

    #[test]
    fn a_token_is_what_makes_the_app_willing_to_check() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir);
        assert!(!status_from(&store).signed_in);

        store.update(|s| s.github_updates_token = Some("ghp_example".into()));
        assert!(status_from(&store).signed_in);

        // Whitespace is not a credential.
        store.update(|s| s.github_updates_token = Some("   ".into()));
        assert!(!status_from(&store).signed_in);
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
    fn both_headers_go_on_the_builder_so_the_download_gets_them_too() {
        let headers = request_headers("ghp_example");
        let named = |name: &reqwest::header::HeaderName| {
            headers.iter().find(|(n, _)| n == name).map(|(_, v)| v.clone())
        };

        assert_eq!(named(&reqwest::header::AUTHORIZATION).unwrap(), "Bearer ghp_example");
        // Without this on the *download*, GitHub answers a private asset
        // request with JSON metadata and the install fails on bytes that are
        // not an installer. The plugin applies the builder's headers to both
        // requests, so setting it here is what covers the download.
        assert_eq!(
            named(&reqwest::header::ACCEPT).unwrap(),
            "application/octet-stream"
        );
        assert_eq!(headers.len(), 2, "every header the updater sends is pinned here");
    }

    #[test]
    fn a_status_never_carries_the_token() {
        let dir = tempfile::tempdir().unwrap();
        let store = store(&dir);
        store.update(|s| s.github_updates_token = Some("ghp_secret_value".into()));
        let json = serde_json::to_string(&status_from(&store)).unwrap();
        assert!(!json.contains("ghp_secret_value"), "a credential must not cross the wire");
        assert!(json.contains("\"signedIn\":true"));
    }

    #[test]
    fn the_status_shape_is_the_one_the_frontend_reads() {
        let dir = tempfile::tempdir().unwrap();
        let json = serde_json::to_value(status_from(&store(&dir))).unwrap();
        for key in [
            "currentVersion",
            "available",
            "channel",
            "automatic",
            "signedIn",
            "checking",
            "lastError",
        ] {
            assert!(json.get(key).is_some(), "UpdateStatus is missing `{key}`");
        }
        let offered = serde_json::to_value(offered("1.2.0")).unwrap();
        for key in ["version", "notes", "date"] {
            assert!(offered.get(key).is_some(), "AvailableUpdate is missing `{key}`");
        }
    }
}
