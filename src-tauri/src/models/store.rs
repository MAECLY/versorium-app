//! Downloaded models on disk.
//!
//! Weights live in the app-data dir (spec §6.2: Application Support/Versorium/
//! models), never in the project folder and never in git.
//!
//! Every public function has an `_in` twin taking the models directory. The
//! wrappers resolve the real one; tests drive the twins against a tempdir, so
//! nothing here can touch the user's app-data and tests stay safe to run in
//! parallel (an env-var override would be process-global and racy).

use super::catalog::ModelEntry;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

/// Hashing reads the whole file; 1 MiB at a time keeps a 10 GB model off the heap.
const HASH_CHUNK: usize = 1024 * 1024;

pub const PART_SUFFIX: &str = ".part";

/// sha2 0.11 hands back a raw byte array rather than something `{:x}` accepts,
/// and a hex crate is not worth a dependency for sixteen characters of code.
fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::with_capacity(bytes.len() * 2), |mut out, byte| {
        use std::fmt::Write;
        let _ = write!(out, "{byte:02x}");
        out
    })
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ModelState {
    Missing,
    Partial { received: u64 },
    Ready,
    /// Present but the wrong size — a truncated or replaced file.
    Corrupt,
}

pub fn models_dir() -> Result<PathBuf, String> {
    crate::paths::app_data_dir().map(|dir| dir.join("models"))
}

pub fn model_path_in(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.gguf"))
}

pub fn part_path_in(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.gguf{PART_SUFFIX}"))
}

/// Cheap: size only. Hashing here would re-read gigabytes on every UI refresh,
/// so the hash is checked once, when a download finishes.
pub fn state_of_in(dir: &Path, entry: &ModelEntry) -> ModelState {
    let final_path = model_path_in(dir, &entry.id);
    if let Ok(meta) = fs::metadata(&final_path) {
        return if meta.len() == entry.size_bytes { ModelState::Ready } else { ModelState::Corrupt };
    }
    match fs::metadata(part_path_in(dir, &entry.id)) {
        Ok(meta) => ModelState::Partial { received: meta.len() },
        Err(_) => ModelState::Missing,
    }
}

/// Streaming SHA256 of `path`, lowercase hex.
pub fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|_| "io".to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; HASH_CHUNK];
    loop {
        let read = file.read(&mut buffer).map_err(|_| "io".to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(to_hex(&hasher.finalize()))
}

pub fn verify_file(path: &Path, expected: &str) -> Result<(), String> {
    let actual = hash_file(path)?;
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err("sha_mismatch".into())
    }
}

/// Removes the model and any partial download. Missing is success: the caller
/// asked for it to be gone.
pub fn delete_in(dir: &Path, id: &str) -> Result<(), String> {
    for path in [model_path_in(dir, id), part_path_in(dir, id)] {
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("io".into()),
        }
    }
    Ok(())
}

pub fn disk_usage_in(dir: &Path) -> Result<u64, String> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(_) => return Err("io".into()),
    };
    let mut total = 0;
    for entry in entries.flatten() {
        if let Ok(meta) = entry.metadata() {
            if meta.is_file() {
                total += meta.len();
            }
        }
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::catalog::fixtures::entry;

    /// The fixture's sha256 is the real hash of these five bytes.
    const HELLO: &[u8] = b"hello";

    fn dir() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn hex_encoding_pads_every_byte() {
        // A byte under 0x10 must still produce two characters, or the digest
        // would be short and never match a published 64-character hash.
        assert_eq!(to_hex(&[0x00, 0x0f, 0xff, 0xa5]), "000fffa5");
        assert_eq!(to_hex(&[]), "");
    }

    #[test]
    fn a_missing_model_is_missing_and_a_partial_one_reports_its_progress() {
        let d = dir();
        let mut model = entry("qwen", "mid", 3.5);
        model.size_bytes = 5;
        assert_eq!(state_of_in(d.path(), &model), ModelState::Missing);

        fs::write(part_path_in(d.path(), "qwen"), b"hel").unwrap();
        assert_eq!(state_of_in(d.path(), &model), ModelState::Partial { received: 3 });
    }

    #[test]
    fn the_right_size_is_ready_and_the_wrong_size_is_corrupt() {
        let d = dir();
        let mut model = entry("qwen", "mid", 3.5);
        model.size_bytes = 5;

        fs::write(model_path_in(d.path(), "qwen"), HELLO).unwrap();
        assert_eq!(state_of_in(d.path(), &model), ModelState::Ready);

        fs::write(model_path_in(d.path(), "qwen"), b"hell").unwrap();
        assert_eq!(state_of_in(d.path(), &model), ModelState::Corrupt);
    }

    #[test]
    fn a_finished_file_is_checked_against_its_published_hash() {
        let d = dir();
        let model = entry("qwen", "mid", 3.5);
        fs::write(model_path_in(d.path(), "qwen"), HELLO).unwrap();
        let weights = model_path_in(d.path(), "qwen");
        assert!(verify_file(&weights, &model.sha256).is_ok());

        fs::write(&weights, b"tampered").unwrap();
        assert_eq!(verify_file(&weights, &model.sha256).unwrap_err(), "sha_mismatch");
    }

    #[test]
    fn hashing_spans_chunk_boundaries() {
        // Larger than HASH_CHUNK, so the loop runs more than once and a bug in
        // the buffer handling would change the digest.
        let d = dir();
        let path = d.path().join("big.bin");
        let blob: Vec<u8> = (0..(HASH_CHUNK * 2 + 7)).map(|i| (i % 251) as u8).collect();
        fs::write(&path, &blob).unwrap();

        let mut expected = Sha256::new();
        expected.update(&blob);
        assert_eq!(hash_file(&path).unwrap(), to_hex(&expected.finalize()));
    }

    #[test]
    fn deleting_removes_both_files_and_a_missing_model_is_not_an_error() {
        let d = dir();
        fs::write(model_path_in(d.path(), "qwen"), HELLO).unwrap();
        fs::write(part_path_in(d.path(), "qwen"), b"partial").unwrap();

        delete_in(d.path(), "qwen").unwrap();
        assert!(!model_path_in(d.path(), "qwen").exists());
        assert!(!part_path_in(d.path(), "qwen").exists());
        assert!(delete_in(d.path(), "qwen").is_ok(), "deleting twice is fine");
    }

    #[test]
    fn disk_usage_counts_what_is_downloaded_and_survives_a_missing_dir() {
        let d = dir();
        assert_eq!(disk_usage_in(&d.path().join("absent")).unwrap(), 0);
        fs::write(model_path_in(d.path(), "a"), HELLO).unwrap();
        fs::write(part_path_in(d.path(), "b"), b"xyz").unwrap();
        assert_eq!(disk_usage_in(d.path()).unwrap(), 8);
    }

    #[test]
    fn weights_land_in_app_data_never_in_a_project() {
        let dir = models_dir().unwrap();
        assert!(dir.ends_with("models"));
        assert!(dir.parent().is_some_and(|p| p.ends_with(crate::paths::APP_IDENTIFIER))
            || std::env::var_os(crate::paths::DATA_DIR_ENV).is_some());
    }
}
