//! Safe local file replacement and project-relative paths.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

/// Replace a file only after the new content has reached the filesystem.
pub fn atomic_write(path: &Path, content: impl AsRef<[u8]>) -> Result<(), String> {
    atomic_write_mode(path, content, None)
}

/// `atomic_write`, but the replacement carries `mode` from the moment it exists.
///
/// Agent config files hold third-party API keys in cleartext and are 0600.
/// Setting the mode *after* the rename would publish the secrets at the umask
/// default for however long that takes, so the temp file is narrowed before any
/// content is written to it.
pub fn atomic_write_mode(
    path: &Path,
    content: impl AsRef<[u8]>,
    mode: Option<u32>,
) -> Result<(), String> {
    let parent = path.parent().ok_or("io")?;
    let id = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
    let temp = parent.join(format!(".versorium-save-{}-{id}.tmp", std::process::id()));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        if let Some(mode) = mode {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(mode);
        }
        let mut file = options.open(&temp)?;
        file.write_all(content.as_ref())?;
        file.sync_all()?;
        fs::rename(&temp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(|_| "io".to_string())
}

/// Permission bits of an existing file, for round-tripping them through a
/// rewrite. `None` when the file is new or the platform has no mode.
pub fn file_mode(path: &Path) -> Option<u32> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(path).ok().map(|m| m.permissions().mode() & 0o7777)
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        None
    }
}

/// Reject traversal and symlinks escaping the project. The leaf may be new.
pub fn project_file(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative);
    if relative.as_os_str().is_empty()
        || relative.components().any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err("not_found".into());
    }
    let root = root.canonicalize().map_err(|_| "not_found".to_string())?;
    let full = root.join(relative);
    let resolved = if full.exists() {
        full.canonicalize().map_err(|_| "not_found".to_string())?
    } else {
        let parent = full.parent().ok_or("not_found")?;
        parent.canonicalize().map_err(|_| "not_found".to_string())?
            .join(full.file_name().ok_or("not_found")?)
    };
    if !resolved.starts_with(&root) {
        return Err("not_found".into());
    }
    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replacement_is_complete_and_paths_stay_inside_project() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("chapter.md");
        atomic_write(&file, "original").unwrap();
        atomic_write(&file, "updated").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "updated");
        assert!(project_file(dir.path(), "../outside.md").is_err());
        assert!(project_file(dir.path(), "/outside.md").is_err());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn a_private_file_is_never_briefly_world_readable() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("config.json");
        atomic_write_mode(&file, "{}", Some(0o600)).unwrap();
        assert_eq!(file_mode(&file), Some(0o600));

        // Rewriting round-trips the mode instead of falling back to the umask.
        let mode = file_mode(&file);
        atomic_write_mode(&file, "{\"a\":1}", mode).unwrap();
        assert_eq!(
            fs::metadata(&file).unwrap().permissions().mode() & 0o777,
            0o600,
            "a config holding cleartext secrets must never widen"
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        let project = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), project.path().join("linked")).unwrap();
        assert!(project_file(project.path(), "linked/chapter.md").is_err());
    }
}
