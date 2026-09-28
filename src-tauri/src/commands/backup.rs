//! Settings → History & backup: a copy in a folder the OS already syncs.

use crate::backup;
use crate::commands::settings::SettingsStore;
use std::path::{Path, PathBuf};

/// Folders on this machine a backup could go to, plus whether each is there.
#[tauri::command]
pub fn backup_destinations() -> Vec<backup::Destination> {
    backup::destinations()
}

/// Remember where backups go and how many to keep.
///
/// An empty path turns backups off rather than storing a meaningless one.
#[tauri::command]
pub fn backup_configure(
    state: tauri::State<SettingsStore>,
    path: String,
    keep: usize,
) -> Result<(), String> {
    let trimmed = path.trim().to_string();
    if trimmed.is_empty() {
        state.update(|s| s.backup_dir = None);
        return Ok(());
    }
    if !Path::new(&trimmed).is_dir() {
        return Err("backup_dest_missing".into());
    }
    state.update(|s| {
        s.backup_dir = Some(trimmed);
        // Zero would mean "back up and then delete it", so the floor is one.
        s.backup_keep = keep.clamp(1, 200);
    });
    Ok(())
}

fn configured(state: &SettingsStore) -> Result<(PathBuf, usize), String> {
    let settings = state.get();
    let dir = settings.backup_dir.ok_or_else(|| "backup_not_configured".to_string())?;
    Ok((PathBuf::from(dir), settings.backup_keep))
}

/// Write one archive now. Blocking work, so it goes to a blocking thread: a
/// novel with a long history is megabytes of zip and the UI must not freeze.
#[tauri::command]
pub async fn backup_now(
    state: tauri::State<'_, SettingsStore>,
    path: PathBuf,
) -> Result<backup::Archive, String> {
    let (dir, keep) = configured(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        backup::create_in(&path, &dir, keep, std::time::SystemTime::now())
    })
    .await
    .map_err(|_| "io".to_string())?
}

/// Archives already stored for this project, newest first.
#[tauri::command]
pub fn backup_list(
    state: tauri::State<SettingsStore>,
    path: PathBuf,
) -> Result<Vec<backup::Archive>, String> {
    let (dir, _) = configured(&state)?;
    let title = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "novel".into());
    backup::list_in(&dir, &title)
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
        assert!(matches!(
            backup_configure_in(&state, missing, 10),
            Err(e) if e == "backup_dest_missing"
        ));
        assert!(state.get().backup_dir.is_none());
    }

    #[test]
    fn choosing_a_folder_stores_it_and_clamps_the_count() {
        let tmp = tempfile::tempdir().unwrap();
        let state = store(tmp.path());
        let dest = tmp.path().join("synced");
        std::fs::create_dir_all(&dest).unwrap();
        let path = dest.to_string_lossy().into_owned();

        backup_configure_in(&state, path.clone(), 0).unwrap();
        assert_eq!(state.get().backup_keep, 1, "zero would delete what it just wrote");

        backup_configure_in(&state, path.clone(), 5_000).unwrap();
        assert_eq!(state.get().backup_keep, 200, "an absurd count fills the folder");

        backup_configure_in(&state, path, 7).unwrap();
        assert_eq!(state.get().backup_keep, 7);
    }

    #[test]
    fn an_empty_path_turns_backups_off() {
        let tmp = tempfile::tempdir().unwrap();
        let state = store(tmp.path());
        let dest = tmp.path().join("synced");
        std::fs::create_dir_all(&dest).unwrap();
        backup_configure_in(&state, dest.to_string_lossy().into_owned(), 3).unwrap();
        assert!(state.get().backup_dir.is_some());

        backup_configure_in(&state, "  ".to_string(), 3).unwrap();
        assert!(state.get().backup_dir.is_none());
    }

    /// The command body without Tauri's `State` wrapper, which cannot be built
    /// in a unit test.
    fn backup_configure_in(state: &SettingsStore, path: String, keep: usize) -> Result<(), String> {
        let trimmed = path.trim().to_string();
        if trimmed.is_empty() {
            state.update(|s| s.backup_dir = None);
            return Ok(());
        }
        if !Path::new(&trimmed).is_dir() {
            return Err("backup_dest_missing".into());
        }
        state.update(|s| {
            s.backup_dir = Some(trimmed);
            s.backup_keep = keep.clamp(1, 200);
        });
        Ok(())
    }
}
