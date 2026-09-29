//! Settings → History & backup: a copy in a folder the OS already syncs.

use crate::backup;
use serde::Serialize;
use crate::commands::settings::SettingsStore;
use std::path::{Path, PathBuf};

/// Folders on this machine a backup could go to, plus whether each is there.
#[tauri::command]
pub fn backup_destinations() -> Vec<backup::Destination> {
    backup::destinations()
}

/// The most destinations worth offering.
///
/// 3-2-1 asks for three copies counting the original, so two backup
/// destinations already satisfies it and a third is headroom. Past that the
/// slowest destination decides how long every backup takes, for a copy nobody
/// asked for.
pub const MAX_DESTINATIONS: usize = 3;

/// What happened at one destination.
///
/// Never collapsed into a single result. Two of three succeeding is the case
/// every other writing app avoids by having one destination, and reporting it
/// as either "backed up" or "failed" would be a lie in one direction or the
/// other.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum Outcome {
    /// Written and read back.
    Ok { path: String, archive: backup::Archive },
    /// The folder is not there: an unplugged disk, a signed-out client. Not an
    /// error — the writer is told, and it is retried next time.
    Unavailable { path: String },
    /// It is there and the write failed. That is an error.
    Failed { path: String, reason: String },
}

/// Remember where backups go and how many to keep.
///
/// An empty list turns backups off rather than storing meaningless paths.
#[tauri::command]
pub fn backup_configure(
    state: tauri::State<SettingsStore>,
    paths: Vec<String>,
    keep: usize,
) -> Result<(), String> {
    let mut kept: Vec<String> = Vec::new();
    for path in paths {
        let trimmed = path.trim().to_string();
        if trimmed.is_empty() {
            continue;
        }
        if !Path::new(&trimmed).is_dir() {
            return Err("backup_dest_missing".into());
        }
        // The same folder twice is one copy wearing two hats.
        if !kept.contains(&trimmed) {
            kept.push(trimmed);
        }
    }
    kept.truncate(MAX_DESTINATIONS);
    state.update(|s| {
        s.backup_dirs = kept.clone();
        // Zero would mean "back up and then delete it", so the floor is one.
        s.backup_keep = keep.clamp(1, 200);
    });
    Ok(())
}

fn configured(state: &SettingsStore) -> Result<(Vec<PathBuf>, usize), String> {
    let settings = state.get();
    if settings.backup_dirs.is_empty() {
        return Err("backup_not_configured".into());
    }
    Ok((settings.backup_dirs.iter().map(PathBuf::from).collect(), settings.backup_keep))
}

/// Write one archive into every configured destination.
///
/// Each is attempted independently and reported separately. A destination that
/// is gone does not fail the ones that are there, which is the whole reason the
/// list exists.
#[tauri::command]
pub async fn backup_now(
    state: tauri::State<'_, SettingsStore>,
    path: PathBuf,
) -> Result<Vec<Outcome>, String> {
    let (dirs, keep) = configured(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let now = std::time::SystemTime::now();
        dirs.into_iter()
            .map(|dir| {
                let shown = dir.to_string_lossy().into_owned();
                if !dir.is_dir() {
                    return Outcome::Unavailable { path: shown };
                }
                match backup::create_in(&path, &dir, keep, now) {
                    Ok(archive) => Outcome::Ok { path: shown, archive },
                    Err(reason) => Outcome::Failed { path: shown, reason },
                }
            })
            .collect()
    })
    .await
    .map_err(|_| "io".to_string())
}

/// Archives stored for this project, newest first, per destination.
#[tauri::command]
pub fn backup_list(
    state: tauri::State<SettingsStore>,
    path: PathBuf,
) -> Result<Vec<(String, Vec<backup::Archive>)>, String> {
    let (dirs, _) = configured(&state)?;
    let title = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "novel".into());
    Ok(dirs
        .into_iter()
        .map(|dir| {
            let listed = backup::list_in(&dir, &title).unwrap_or_default();
            (dir.to_string_lossy().into_owned(), listed)
        })
        .collect())
}

/// What the configured destinations actually protect this novel against.
///
/// Computed here rather than in the UI because it needs device numbers, and a
/// frontend comparing path prefixes would call `/Volumes/Backup` and
/// `/Volumes/Backup2` different disks.
#[tauri::command]
pub fn backup_coverage(
    state: tauri::State<SettingsStore>,
    path: PathBuf,
) -> backup::Coverage {
    let dirs: Vec<PathBuf> = state.get().backup_dirs.iter().map(PathBuf::from).collect();
    backup::coverage(&path, &dirs)
}

/// Read an archive back and confirm it is complete and extractable.
///
/// Offered on demand because an archive that sat on a disk for a year is
/// exactly the one 3-2-1 exists for and the one nobody ever checks.
#[tauri::command]
pub async fn backup_verify(archive: PathBuf) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || backup::verify(&archive))
        .await
        .map_err(|_| "io".to_string())?
}

/// Extract an archive beside the project it came from, never over it.
///
/// Returns the new folder so the caller can open it. `label` is localized by the
/// frontend, because a folder name is something the writer reads.
#[tauri::command]
pub async fn backup_restore(
    archive: PathBuf,
    project: PathBuf,
    label: String,
) -> Result<String, String> {
    let label = label.trim().to_string();
    if label.is_empty() {
        return Err("bad_args".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        backup::restore_beside(&archive, &project, &label)
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|_| "io".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(dir: &Path) -> SettingsStore {
        SettingsStore::load(dir.join("settings.json"))
    }

    /// The command body without Tauri's `State` wrapper, which cannot be built
    /// in a unit test.
    fn configure(state: &SettingsStore, paths: Vec<String>, keep: usize) -> Result<(), String> {
        let mut kept: Vec<String> = Vec::new();
        for path in paths {
            let trimmed = path.trim().to_string();
            if trimmed.is_empty() {
                continue;
            }
            if !Path::new(&trimmed).is_dir() {
                return Err("backup_dest_missing".into());
            }
            if !kept.contains(&trimmed) {
                kept.push(trimmed);
            }
        }
        kept.truncate(MAX_DESTINATIONS);
        state.update(|s| {
            s.backup_dirs = kept.clone();
            s.backup_keep = keep.clamp(1, 200);
        });
        Ok(())
    }

    fn folder(parent: &Path, name: &str) -> String {
        let path = parent.join(name);
        std::fs::create_dir_all(&path).unwrap();
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn nothing_happens_until_a_destination_is_chosen() {
        // The alternative — silently picking iCloud — would write a novel
        // somewhere the writer never agreed to.
        let tmp = tempfile::tempdir().unwrap();
        let state = store(tmp.path());
        assert_eq!(configured(&state).unwrap_err(), "backup_not_configured");
    }

    #[test]
    fn a_destination_that_does_not_exist_is_refused_rather_than_stored() {
        let tmp = tempfile::tempdir().unwrap();
        let state = store(tmp.path());
        let missing = tmp.path().join("absent").to_string_lossy().into_owned();
        // Storing it would fail later, at the moment the writer most needs the
        // backup to have worked.
        assert_eq!(configure(&state, vec![missing], 10).unwrap_err(), "backup_dest_missing");
        assert!(state.get().backup_dirs.is_empty());
    }

    #[test]
    fn several_destinations_are_kept_in_the_order_they_were_chosen() {
        // 3-2-1 needs copies on different media, and one folder can only be one.
        let tmp = tempfile::tempdir().unwrap();
        let state = store(tmp.path());
        let a = folder(tmp.path(), "icloud");
        let b = folder(tmp.path(), "usb");
        configure(&state, vec![a.clone(), b.clone()], 5).unwrap();
        assert_eq!(state.get().backup_dirs, vec![a, b]);
        assert_eq!(state.get().backup_keep, 5);
    }

    #[test]
    fn the_same_folder_twice_is_one_copy_and_is_stored_once() {
        let tmp = tempfile::tempdir().unwrap();
        let state = store(tmp.path());
        let a = folder(tmp.path(), "icloud");
        configure(&state, vec![a.clone(), a.clone(), a.clone()], 10).unwrap();
        assert_eq!(state.get().backup_dirs, vec![a]);
    }

    #[test]
    fn more_destinations_than_are_useful_are_dropped() {
        // Past three, the slowest destination decides how long every backup
        // takes, for a copy nobody asked for.
        let tmp = tempfile::tempdir().unwrap();
        let state = store(tmp.path());
        let chosen: Vec<String> = (0..6).map(|i| folder(tmp.path(), &format!("d{i}"))).collect();
        configure(&state, chosen, 10).unwrap();
        assert_eq!(state.get().backup_dirs.len(), MAX_DESTINATIONS);
    }

    #[test]
    fn the_kept_count_is_clamped_to_something_sensible() {
        let tmp = tempfile::tempdir().unwrap();
        let state = store(tmp.path());
        let a = folder(tmp.path(), "icloud");
        configure(&state, vec![a.clone()], 0).unwrap();
        assert_eq!(state.get().backup_keep, 1, "zero would delete what it just wrote");
        configure(&state, vec![a.clone()], 5_000).unwrap();
        assert_eq!(state.get().backup_keep, 200, "an absurd count fills the folder");
    }

    #[test]
    fn an_empty_list_turns_backups_off() {
        let tmp = tempfile::tempdir().unwrap();
        let state = store(tmp.path());
        let a = folder(tmp.path(), "icloud");
        configure(&state, vec![a], 3).unwrap();
        assert!(!state.get().backup_dirs.is_empty());

        configure(&state, vec!["  ".into()], 3).unwrap();
        assert!(state.get().backup_dirs.is_empty());
    }

    #[test]
    fn an_outcome_names_its_destination_whatever_happened() {
        // The UI shows per-destination state, so every variant has to say which
        // one it is talking about.
        let ok = Outcome::Ok {
            path: "/a".into(),
            archive: backup::Archive {
                path: "/a/x.zip".into(),
                name: "x.zip".into(),
                bytes: 1,
                modified: 0,
                sha256: Some("abc".into()),
            },
        };
        let gone = Outcome::Unavailable { path: "/b".into() };
        let bad = Outcome::Failed { path: "/c".into(), reason: "io".into() };
        for (outcome, expected) in [(ok, "/a"), (gone, "/b"), (bad, "/c")] {
            let json = serde_json::to_value(&outcome).unwrap();
            assert_eq!(json["path"], expected);
            assert!(json["state"].is_string(), "the UI branches on this");
        }
    }
}
