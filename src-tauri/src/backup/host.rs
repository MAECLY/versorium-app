//! A random name for this computer, written once into the app's own folder.
//!
//! Two Macs can write into one synced folder. Each run's temporary file carries
//! this id, so the leftovers sweep can tell a file this computer abandoned
//! from one another computer is still writing, which it must never touch.
//! The id is random and local: nothing about the machine goes into it, and it
//! is never sent anywhere.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Lowercase hex digits in an id.
pub const HOST_HEX: usize = 10;

const FILE: &str = "backup-host-id";

/// The id stored in `dir`, created on first use.
///
/// A file that cannot be read back as an id is replaced. One that cannot be
/// written leaves an id held in memory for this session: this computer's
/// earlier temporary files then look like another computer's and wait out
/// the longer delay before they are swept, which is the safe direction.
pub fn load_or_create(dir: &Path) -> String {
    let path = dir.join(FILE);
    if let Ok(text) = fs::read_to_string(&path) {
        let id = text.trim();
        if is_id(id) {
            return id.to_string();
        }
    }
    let fresh = random();
    if fs::create_dir_all(dir).is_ok() {
        let _ = crate::storage::atomic_write(&path, &fresh);
    }
    fresh
}

/// This computer's id, read once per process.
pub fn this_host() -> &'static str {
    static HOST: OnceLock<String> = OnceLock::new();
    HOST.get_or_init(|| host_in(crate::paths::app_data_dir()))
}

/// The id kept in the app's own folder, when there is one.
///
/// It has to be the stored one. A new id at every launch would make this
/// computer's leftovers from the last session look like another computer's,
/// and they would wait out a week instead of being swept on the next run.
fn host_in(app_data: Result<PathBuf, String>) -> String {
    match app_data {
        Ok(dir) => load_or_create(&dir),
        Err(_) => random(),
    }
}

pub fn is_id(text: &str) -> bool {
    text.len() == HOST_HEX && text.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn random() -> String {
    let mut bytes = [0u8; HOST_HEX / 2];
    if getrandom::fill(&mut bytes).is_err() {
        // No OS randomness at all is not a reason to stop backing up. The id
        // only has to differ between the computers sharing one folder.
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let mixed = nanos ^ (u128::from(std::process::id()) << 64);
        bytes.copy_from_slice(&mixed.to_le_bytes()[..HOST_HEX / 2]);
    }
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_id_is_written_once_and_read_back_after() {
        let tmp = tempfile::tempdir().unwrap();
        let first = load_or_create(tmp.path());
        assert!(is_id(&first), "{first:?} is not ten lowercase hex digits");
        assert_eq!(fs::read_to_string(tmp.path().join(FILE)).unwrap(), first);
        assert_eq!(load_or_create(tmp.path()), first, "a second launch got a new id");
    }

    #[test]
    fn two_computers_get_different_ids() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        assert_ne!(load_or_create(a.path()), load_or_create(b.path()));
    }

    #[test]
    fn a_broken_file_is_replaced_with_a_real_id() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join(FILE), "not an id").unwrap();
        let id = load_or_create(tmp.path());
        assert!(is_id(&id));
        assert_eq!(fs::read_to_string(tmp.path().join(FILE)).unwrap(), id);
    }

    #[test]
    fn the_app_uses_the_id_it_stored_and_keeps_it_across_launches() {
        let tmp = tempfile::tempdir().unwrap();
        let first = host_in(Ok(tmp.path().to_path_buf()));
        assert_eq!(fs::read_to_string(tmp.path().join(FILE)).unwrap(), first, "the id in use is not the stored one");
        assert_eq!(host_in(Ok(tmp.path().to_path_buf())), first, "a second launch got a new id");
        // No app folder at all still gives an id to write with.
        assert!(is_id(&host_in(Err("no_home".into()))));
    }

    #[test]
    fn a_folder_that_cannot_be_written_still_gives_a_working_id() {
        // A path under a file can never be created, whoever runs the test.
        let tmp = tempfile::tempdir().unwrap();
        let blocker = tmp.path().join("a-file");
        fs::write(&blocker, "x").unwrap();
        let id = load_or_create(&blocker.join("app-data"));
        assert!(is_id(&id));
    }
}
