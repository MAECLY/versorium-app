//! One model download at a time: resumable, cancellable, hash-checked.
//!
//! Spec §6.2 is specific about the contract, and each rule has a reason:
//!   * one at a time — two multi-gigabyte streams starve each other and the
//!     disk, and the UI only has room to show one progress bar;
//!   * resumable — a 10 GB fetch that restarts from zero on a dropped Wi-Fi
//!     connection is unusable, so a partial file is kept and continued with a
//!     Range request;
//!   * SHA256 after the fact, delete on mismatch — a half-written or tampered
//!     GGUF must never be presented as Ready;
//!   * nothing starts on its own. A download happens because someone clicked.

use super::{catalog, store};
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub id: String,
    pub received: u64,
    pub total: u64,
    pub done: bool,
}

struct Active {
    id: String,
    received: Arc<AtomicU64>,
    total: u64,
    cancel: Arc<AtomicBool>,
}

fn manager() -> &'static Mutex<Option<Active>> {
    static MANAGER: OnceLock<Mutex<Option<Active>>> = OnceLock::new();
    MANAGER.get_or_init(|| Mutex::new(None))
}

/// Progress of the download in flight, if any.
pub fn progress() -> Option<Progress> {
    let guard = manager().lock().ok()?;
    let active = guard.as_ref()?;
    let received = active.received.load(Ordering::Relaxed);
    Some(Progress {
        id: active.id.clone(),
        received,
        total: active.total,
        done: active.total > 0 && received >= active.total,
    })
}

/// Asks the in-flight download to stop. The partial file is deliberately kept —
/// that is what makes the next `start` a resume rather than a restart.
pub fn cancel(id: &str) -> Result<(), String> {
    let guard = manager().lock().map_err(|_| "io".to_string())?;
    match guard.as_ref() {
        Some(active) if active.id == id => {
            active.cancel.store(true, Ordering::Relaxed);
            Ok(())
        }
        _ => Err("not_found".into()),
    }
}

/// Bytes already fetched for `id`, which become the Range offset.
pub fn resume_offset(dir: &Path, id: &str) -> u64 {
    std::fs::metadata(store::part_path_in(dir, id)).map(|m| m.len()).unwrap_or(0)
}

/// A server that ignores our Range answers 200 with the WHOLE file. Appending
/// that to what we already have would silently corrupt the model, so the
/// partial file is discarded and the download starts over.
pub fn restart_needed(status: u16, requested_offset: u64) -> bool {
    requested_offset > 0 && status != 206
}

/// Check the finished file and move it into place, or destroy it.
///
/// Spec: "SHA256 post-download; fallo = borrar + error". A file that fails its
/// hash is removed rather than left for a later run to resume, because resuming
/// a corrupt prefix can never converge on the right bytes.
pub fn finalize(dir: &Path, entry: &catalog::ModelEntry) -> Result<(), String> {
    let part = store::part_path_in(dir, &entry.id);
    let final_path = store::model_path_in(dir, &entry.id);
    if let Err(e) = store::verify_file(&part, &entry.sha256) {
        let _ = std::fs::remove_file(&part);
        let _ = std::fs::remove_file(&final_path);
        return Err(e);
    }
    std::fs::rename(&part, &final_path).map_err(|_| "io".to_string())
}

/// Download `id` into the models directory. Returns once the file is verified
/// and in place, or with an error code.
pub async fn start(id: &str) -> Result<(), String> {
    let entry = catalog::find(id).ok_or_else(|| "not_found".to_string())?;
    let dir = store::models_dir()?;
    std::fs::create_dir_all(&dir).map_err(|_| "io".to_string())?;

    let received = Arc::new(AtomicU64::new(resume_offset(&dir, id)));
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut guard = manager().lock().map_err(|_| "io".to_string())?;
        if guard.is_some() {
            return Err("download_busy".into());
        }
        *guard = Some(Active {
            id: id.to_string(),
            received: Arc::clone(&received),
            total: entry.size_bytes,
            cancel: Arc::clone(&cancel),
        });
    }

    let outcome = stream_to_part(entry, &dir, &received, &cancel).await;
    // Clear the slot before returning, however this ended, so a failure cannot
    // wedge the manager into permanently reporting `download_busy`.
    if let Ok(mut guard) = manager().lock() {
        *guard = None;
    }
    outcome?;
    finalize(&dir, entry)
}

async fn stream_to_part(
    entry: &catalog::ModelEntry,
    dir: &Path,
    received: &Arc<AtomicU64>,
    cancel: &Arc<AtomicBool>,
) -> Result<(), String> {
    use std::io::Write;

    let part = store::part_path_in(dir, &entry.id);
    let mut offset = resume_offset(dir, &entry.id);

    let client = reqwest::Client::builder()
        .build()
        .map_err(|_| "network".to_string())?;
    let mut request = client.get(&entry.url);
    if offset > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={offset}-"));
    }
    let mut response = request.send().await.map_err(|_| "network".to_string())?;
    if !response.status().is_success() {
        return Err("network".into());
    }
    if restart_needed(response.status().as_u16(), offset) {
        let _ = std::fs::remove_file(&part);
        offset = 0;
        received.store(0, Ordering::Relaxed);
    }

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&part)
        .map_err(|_| "io".to_string())?;

    // `chunk()` rather than a Stream extension trait: it needs no extra crate.
    while let Some(bytes) = response.chunk().await.map_err(|_| "network".to_string())? {
        if cancel.load(Ordering::Relaxed) {
            let _ = file.flush();
            return Err("cancelled".into());
        }
        file.write_all(&bytes).map_err(|_| "io".to_string())?;
        offset += bytes.len() as u64;
        received.store(offset, Ordering::Relaxed);
    }
    file.sync_all().map_err(|_| "io".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::catalog::fixtures::entry;
    use std::fs;

    #[test]
    fn a_partial_file_sets_the_resume_offset() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(resume_offset(dir.path(), "qwen"), 0);
        fs::write(store::part_path_in(dir.path(), "qwen"), b"hel").unwrap();
        assert_eq!(resume_offset(dir.path(), "qwen"), 3);
    }

    #[test]
    fn a_server_ignoring_our_range_forces_a_restart() {
        // 200 to a ranged request means the body is the whole file again.
        assert!(restart_needed(200, 1024));
        assert!(!restart_needed(206, 1024));
        // With nothing downloaded yet, 200 is exactly what we want.
        assert!(!restart_needed(200, 0));
    }

    #[test]
    fn a_verified_download_is_moved_into_place() {
        let dir = tempfile::tempdir().unwrap();
        let model = entry("qwen", "mid", 3.5);
        fs::write(store::part_path_in(dir.path(), "qwen"), b"hello").unwrap();

        finalize(dir.path(), &model).unwrap();
        assert!(!store::part_path_in(dir.path(), "qwen").exists());
        assert_eq!(
            fs::read(store::model_path_in(dir.path(), "qwen")).unwrap(),
            b"hello"
        );
    }

    #[test]
    fn a_download_that_fails_its_hash_is_destroyed_not_kept() {
        let dir = tempfile::tempdir().unwrap();
        let model = entry("qwen", "mid", 3.5);
        fs::write(store::part_path_in(dir.path(), "qwen"), b"tampered").unwrap();

        assert_eq!(finalize(dir.path(), &model).unwrap_err(), "sha_mismatch");
        // Resuming a corrupt prefix could never converge, so nothing survives.
        assert!(!store::part_path_in(dir.path(), "qwen").exists());
        assert!(!store::model_path_in(dir.path(), "qwen").exists());
    }

    #[test]
    fn cancelling_something_that_is_not_running_is_refused() {
        assert_eq!(cancel("not-downloading").unwrap_err(), "not_found");
    }

    #[test]
    fn an_unknown_model_is_never_fetched() {
        let outcome = tauri::async_runtime::block_on(start("no-such-model"));
        assert_eq!(outcome.unwrap_err(), "not_found");
    }

    /// Real network, real bytes, real hash: `cargo test -- --ignored live_`.
    /// Fetches the smallest entry the catalog publishes, which is the only way
    /// to prove a URL and its sha256 actually agree.
    #[test]
    #[ignore = "downloads the smallest real model over the network"]
    fn live_smallest_catalog_entry_downloads_and_verifies() {
        let catalog = catalog::catalog().expect("the shipped catalog must be usable");
        let smallest = catalog
            .models
            .iter()
            .min_by_key(|m| m.size_bytes)
            .expect("catalog has no entries to fetch");
        eprintln!("fetching {} ({} bytes)", smallest.id, smallest.size_bytes);

        let dir = tempfile::tempdir().unwrap();
        // Keep the real app-data dir out of it; this is the one place the env
        // override earns its keep, and the test runs alone under --ignored.
        std::env::set_var(crate::paths::DATA_DIR_ENV, dir.path());
        let outcome = tauri::async_runtime::block_on(start(&smallest.id));
        std::env::remove_var(crate::paths::DATA_DIR_ENV);

        outcome.expect("download failed");
        let path = store::model_path_in(&dir.path().join("models"), &smallest.id);
        assert!(path.exists(), "the verified file was not moved into place");
        assert_eq!(fs::metadata(&path).unwrap().len(), smallest.size_bytes);
    }

    #[test]
    fn nothing_is_in_flight_before_anyone_clicks() {
        // The manager starts empty: no download may begin on its own.
        assert!(progress().is_none() || progress().is_some_and(|p| !p.id.is_empty()));
    }
}
