//! Backing a novel up to a folder the operating system already syncs.
//!
//! ## Why not just put the project in iCloud Drive
//!
//! Because it corrupts repositories, and this is the one thing a writing tool
//! must not do. iCloud Drive, OneDrive and Dropbox sync file by file with no
//! regard for git's ordering or atomicity — a ref can arrive before the objects
//! it points at — they evict files to placeholders that are briefly unreadable,
//! and on conflict they create `file 2.md` copies, which inside `.git` is fatal.
//! Git assumes a filesystem it controls.
//!
//! So the unit of backup is **one file**, because a single file is what these
//! services do sync atomically. `git bundle` would be the ideal artefact, but
//! libgit2 has never implemented bundles and shelling out to the system `git`
//! would break the property that Versorium needs no git installed. A zip of the
//! whole project including `.git` is the same idea with a tool already here: the
//! `zip` crate ships the DOCX and EPUB writers.
//!
//! ## Why this is more local-first than the GitHub option
//!
//! Versorium writes a file to a local path. The OS syncs it. No account, no
//! token, no service contacted — strictly less than what the GitHub remote asks
//! for, and it works offline.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};

/// Prefix on every archive, so a folder shared with other files stays legible
/// and pruning can never delete something Versorium did not write.
const PREFIX: &str = "versorium-backup";
const EXTENSION: &str = "zip";

/// How many archives to keep by default. Enough to recover from a mistake
/// noticed days later, few enough not to fill a synced folder.
pub const DEFAULT_KEEP: usize = 10;

/// Where a backup can go. `kind` exists so the UI can name the destination in
/// the writer's own terms rather than showing a path.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Destination {
    /// `icloud` | `onedrive` | `nextcloud` | `dropbox` | `folder`
    pub kind: String,
    pub path: String,
    /// The folder exists right now. A destination can be offered and absent —
    /// OneDrive on a machine where it was uninstalled, for instance.
    pub available: bool,
}

/// A stored archive.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Archive {
    pub path: String,
    pub name: String,
    pub bytes: u64,
    /// Unix seconds, from the file's own mtime.
    pub modified: u64,
}

fn home() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "no_home".to_string())
}

/// Candidate sync folders on this machine, most conventional first.
///
/// Linux has no standard location, so the common third-party clients are probed
/// and the writer can always pick a folder instead. Reporting a destination that
/// does not exist, rather than hiding it, is deliberate: "OneDrive — not found"
/// tells someone their assumption was wrong, while silence looks like a bug.
pub fn destinations() -> Vec<Destination> {
    let Ok(home) = home() else { return Vec::new() };
    let mut found = Vec::new();

    let mut add = |kind: &str, path: PathBuf| {
        found.push(Destination {
            kind: kind.to_string(),
            available: path.is_dir(),
            path: path.to_string_lossy().into_owned(),
        });
    };

    #[cfg(target_os = "macos")]
    add("icloud", home.join("Library/Mobile Documents/com~apple~CloudDocs"));

    #[cfg(target_os = "windows")]
    {
        // Set by the OneDrive client itself; the folder is not always under the
        // profile root, and business accounts use a second variable.
        for var in ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"] {
            if let Some(value) = std::env::var_os(var).filter(|v| !v.is_empty()) {
                add("onedrive", PathBuf::from(value));
                break;
            }
        }
    }

    // Offered everywhere: these clients run on all three platforms, and someone
    // on macOS may well prefer Dropbox to iCloud.
    for (kind, dir) in [("nextcloud", "Nextcloud"), ("dropbox", "Dropbox")] {
        let path = home.join(dir);
        if path.is_dir() {
            add(kind, path);
        }
    }

    found
}

fn stamp(now: std::time::SystemTime) -> String {
    let secs = now
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Hand-rolled rather than adding a date crate for one filename. Sortable,
    // which is what pruning and listing both rely on.
    let days = secs / 86_400;
    let (year, month, day) = civil_from_days(days as i64);
    let rest = secs % 86_400;
    format!(
        "{year:04}-{month:02}-{day:02}-{:02}{:02}{:02}",
        rest / 3600,
        (rest % 3600) / 60,
        rest % 60
    )
}

/// Days since the Unix epoch to a calendar date (Howard Hinnant's algorithm).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn slug(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect();
    let trimmed = cleaned.trim_matches('-').to_string();
    let collapsed = trimmed.split('-').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("-");
    if collapsed.is_empty() { "novel".into() } else { collapsed }
}

/// The archive name for a project at a moment.
pub fn archive_name(project: &str, now: std::time::SystemTime) -> String {
    format!("{PREFIX}-{}-{}.{EXTENSION}", slug(project), stamp(now))
}

/// Whether Versorium wrote this file, so pruning cannot touch anything else in
/// a folder the writer also keeps their own files in.
fn is_ours(name: &str, project: &str) -> bool {
    name.starts_with(&format!("{PREFIX}-{}-", slug(project))) && name.ends_with(EXTENSION)
}

/// Every file in `dir` that is one of `project`'s backups, newest first.
pub fn list_in(dir: &Path, project: &str) -> Result<Vec<Archive>, String> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err("io".into()),
    };
    let mut archives: Vec<Archive> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !is_ours(&name, project) {
                return None;
            }
            let meta = entry.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            Some(Archive {
                path: entry.path().to_string_lossy().into_owned(),
                name,
                bytes: meta.len(),
                modified,
            })
        })
        .collect();
    // By name, because the stamp sorts and an mtime can be rewritten by a sync
    // client re-downloading a file.
    archives.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(archives)
}

/// Delete all but the newest `keep`. Returns how many went.
pub fn prune_in(dir: &Path, project: &str, keep: usize) -> Result<usize, String> {
    let archives = list_in(dir, project)?;
    let mut removed = 0;
    for old in archives.into_iter().skip(keep.max(1)) {
        if fs::remove_file(&old.path).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

/// Files that must never enter an archive.
///
/// `.DS_Store` and `Thumbs.db` are the OS's, not the novel's. Nested backups
/// are excluded so a project that once held one cannot grow geometrically.
fn skip(name: &str) -> bool {
    name == ".DS_Store" || name == "Thumbs.db" || name.starts_with(PREFIX)
}

fn add_dir<W: Write + Seek>(
    zip: &mut zip::ZipWriter<W>,
    root: &Path,
    dir: &Path,
    options: zip::write::SimpleFileOptions,
) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|_| "io".to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if skip(&name) {
            continue;
        }
        let relative = path.strip_prefix(root).map_err(|_| "io".to_string())?;
        // Zip paths are always forward-slashed, including archives written on
        // Windows.
        let inside = relative.to_string_lossy().replace('\\', "/");
        let meta = entry.metadata().map_err(|_| "io".to_string())?;
        if meta.is_dir() {
            zip.add_directory(format!("{inside}/"), options).map_err(|_| "io".to_string())?;
            add_dir(zip, root, &path, options)?;
        } else if meta.is_file() {
            zip.start_file(inside, options).map_err(|_| "io".to_string())?;
            let mut file = fs::File::open(&path).map_err(|_| "io".to_string())?;
            let mut buffer = vec![0u8; 64 * 1024];
            loop {
                let read = file.read(&mut buffer).map_err(|_| "io".to_string())?;
                if read == 0 {
                    break;
                }
                zip.write_all(&buffer[..read]).map_err(|_| "io".to_string())?;
            }
        }
        // Symlinks are skipped: following one could pull in the whole disk, and
        // a novel has no reason to contain any.
    }
    Ok(())
}

/// Write one archive of `project` into `dir`, then prune.
///
/// The archive is built under a temporary name and renamed once complete, so a
/// sync client never uploads a half-written zip and a crash mid-backup leaves
/// nothing that looks restorable.
pub fn create_in(
    project: &Path,
    dir: &Path,
    keep: usize,
    now: std::time::SystemTime,
) -> Result<Archive, String> {
    if !project.is_dir() {
        return Err("not_found".into());
    }
    fs::create_dir_all(dir).map_err(|_| "backup_dest_unwritable".to_string())?;

    let title = project
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "novel".into());
    let name = archive_name(&title, now);
    let final_path = dir.join(&name);
    let partial = dir.join(format!("{name}.part"));

    {
        let file = fs::File::create(&partial).map_err(|_| "backup_dest_unwritable".to_string())?;
        let mut zip = zip::ZipWriter::new(file);
        // Deflate: a manuscript is text and compresses to a fraction, which is
        // the difference between a synced folder noticing and not.
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        if let Err(e) = add_dir(&mut zip, project, project, options) {
            let _ = fs::remove_file(&partial);
            return Err(e);
        }
        if zip.finish().is_err() {
            let _ = fs::remove_file(&partial);
            return Err("io".into());
        }
    }

    fs::rename(&partial, &final_path).map_err(|_| "io".to_string())?;
    let bytes = fs::metadata(&final_path).map(|m| m.len()).unwrap_or(0);
    prune_in(dir, &title, keep)?;

    Ok(Archive {
        path: final_path.to_string_lossy().into_owned(),
        name,
        bytes,
        modified: now
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    })
}

/// Extract an archive **beside** the original, never over it.
///
/// Restoring in place would be the one operation capable of destroying the work
/// it exists to protect — a writer reaching for a backup is already having a bad
/// day. The extracted copy is a normal project folder they can open and compare.
pub fn restore_beside(archive: &Path, parent: &Path, label: &str) -> Result<PathBuf, String> {
    let file = fs::File::open(archive).map_err(|_| "not_found".to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| "backup_unreadable".to_string())?;

    // Never overwrite: find a free name rather than merging into an existing
    // folder, where a half-restored project would be worse than no restore.
    let base = format!("{}-{label}", parent.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "novel".into()));
    let target_parent = parent.parent().ok_or_else(|| "io".to_string())?;
    let mut target = target_parent.join(&base);
    let mut attempt = 2;
    while target.exists() {
        target = target_parent.join(format!("{base}-{attempt}"));
        attempt += 1;
        if attempt > 100 {
            return Err("io".into());
        }
    }
    fs::create_dir_all(&target).map_err(|_| "io".to_string())?;

    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|_| "backup_unreadable".to_string())?;
        // `enclosed_name` is what refuses `../` entries; a crafted zip must not
        // be able to write outside the folder being restored into.
        let Some(relative) = entry.enclosed_name() else {
            return Err("backup_unreadable".into());
        };
        let out = target.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&out).map_err(|_| "io".to_string())?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|_| "io".to_string())?;
        }
        let mut sink = fs::File::create(&out).map_err(|_| "io".to_string())?;
        std::io::copy(&mut entry, &mut sink).map_err(|_| "io".to_string())?;
    }
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(dir: &Path, name: &str) -> PathBuf {
        let root = dir.join(name);
        fs::create_dir_all(root.join("chapters")).unwrap();
        fs::create_dir_all(root.join(".git/refs/heads")).unwrap();
        fs::write(root.join("project.json"), br#"{"title":"El faro"}"#).unwrap();
        fs::write(root.join("chapters/ch-01.md"), "La luz giraba sobre el agua.").unwrap();
        fs::write(root.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        fs::write(root.join(".git/refs/heads/main"), "abc123\n").unwrap();
        fs::write(root.join(".DS_Store"), "junk").unwrap();
        root
    }

    fn at(secs: u64) -> std::time::SystemTime {
        std::time::UNIX_EPOCH + std::time::Duration::from_secs(secs)
    }

    #[test]
    fn the_archive_carries_the_git_history_because_that_is_the_point() {
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("synced");

        let archive = create_in(&root, &dest, DEFAULT_KEEP, at(1_759_000_000)).unwrap();
        let file = fs::File::open(&archive.path).unwrap();
        let mut zip = zip::ZipArchive::new(file).unwrap();
        let names: Vec<String> = (0..zip.len()).map(|i| zip.by_index(i).unwrap().name().to_string()).collect();

        // Without `.git` the archive would be a copy, not a backup: every
        // snapshot the writer can return to lives in there.
        assert!(names.iter().any(|n| n == ".git/HEAD"), "missing .git: {names:?}");
        assert!(names.iter().any(|n| n == ".git/refs/heads/main"));
        assert!(names.iter().any(|n| n == "chapters/ch-01.md"));
        assert!(names.iter().any(|n| n == "project.json"));
        // The OS's file, not the novel's.
        assert!(!names.iter().any(|n| n.contains(".DS_Store")), "packed an OS file");
    }

    #[test]
    fn nothing_half_written_is_left_where_a_sync_client_could_upload_it() {
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("synced");
        create_in(&root, &dest, DEFAULT_KEEP, at(1_759_000_000)).unwrap();

        let leftovers: Vec<String> = fs::read_dir(&dest)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".part"))
            .collect();
        assert!(leftovers.is_empty(), "a partial archive survived: {leftovers:?}");
    }

    #[test]
    fn an_archive_of_a_project_that_held_a_backup_does_not_nest_it() {
        // Otherwise each backup would contain every previous one and the folder
        // would grow geometrically.
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        fs::write(root.join("versorium-backup-el-faro-2026-01-01-000000.zip"), "old").unwrap();
        let dest = tmp.path().join("synced");

        let archive = create_in(&root, &dest, DEFAULT_KEEP, at(1_759_000_000)).unwrap();
        let file = fs::File::open(&archive.path).unwrap();
        let mut zip = zip::ZipArchive::new(file).unwrap();
        let names: Vec<String> = (0..zip.len()).map(|i| zip.by_index(i).unwrap().name().to_string()).collect();
        assert!(!names.iter().any(|n| n.contains(PREFIX)), "nested a backup: {names:?}");
    }

    #[test]
    fn pruning_keeps_the_newest_and_never_touches_a_stranger() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path();
        for day in 1..=5 {
            fs::write(dest.join(format!("versorium-backup-el-faro-2026-01-0{day}-120000.zip")), "x").unwrap();
        }
        // Things the writer put in their own synced folder.
        fs::write(dest.join("taxes.pdf"), "x").unwrap();
        fs::write(dest.join("versorium-backup-otra-novela-2026-01-01-120000.zip"), "x").unwrap();

        assert_eq!(prune_in(dest, "el-faro", 2).unwrap(), 3);
        let kept = list_in(dest, "el-faro").unwrap();
        assert_eq!(kept.len(), 2);
        assert_eq!(kept[0].name, "versorium-backup-el-faro-2026-01-05-120000.zip");
        assert!(dest.join("taxes.pdf").exists(), "deleted a file Versorium did not write");
        assert!(
            dest.join("versorium-backup-otra-novela-2026-01-01-120000.zip").exists(),
            "pruned another novel's backups"
        );
    }

    #[test]
    fn keeping_zero_still_keeps_one() {
        // A setting of 0 would mean "back up and then delete it", which cannot
        // be what anybody wants.
        let tmp = tempfile::tempdir().unwrap();
        for day in 1..=3 {
            fs::write(tmp.path().join(format!("versorium-backup-n-2026-01-0{day}-120000.zip")), "x").unwrap();
        }
        prune_in(tmp.path(), "n", 0).unwrap();
        assert_eq!(list_in(tmp.path(), "n").unwrap().len(), 1);
    }

    #[test]
    fn restoring_never_writes_over_the_project_it_came_from() {
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("synced");
        let archive = create_in(&root, &dest, DEFAULT_KEEP, at(1_759_000_000)).unwrap();

        let restored = restore_beside(Path::new(&archive.path), &root, "restored").unwrap();
        assert_ne!(restored, root, "restored over the original");
        assert_eq!(fs::read_to_string(restored.join("chapters/ch-01.md")).unwrap(), "La luz giraba sobre el agua.");
        assert!(restored.join(".git/HEAD").exists(), "restored without its history");
        // The original is untouched.
        assert!(root.join("chapters/ch-01.md").exists());

        // Restoring twice does not merge into the first copy.
        let again = restore_beside(Path::new(&archive.path), &root, "restored").unwrap();
        assert_ne!(again, restored);
    }

    #[test]
    fn a_zip_that_tries_to_escape_the_folder_is_refused() {
        // `enclosed_name` is the guard; without it a crafted archive could write
        // anywhere the process can reach.
        let tmp = tempfile::tempdir().unwrap();
        let evil = tmp.path().join("evil.zip");
        {
            let mut zip = zip::ZipWriter::new(fs::File::create(&evil).unwrap());
            zip.start_file("../escaped.txt", zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(b"pwned").unwrap();
            zip.finish().unwrap();
        }
        let root = project(tmp.path(), "el-faro");
        assert_eq!(restore_beside(&evil, &root, "restored").unwrap_err(), "backup_unreadable");
        assert!(!tmp.path().join("escaped.txt").exists());
    }

    #[test]
    fn the_name_sorts_chronologically_and_is_safe_on_every_filesystem() {
        let early = archive_name("El Faro", at(1_700_000_000));
        let late = archive_name("El Faro", at(1_759_000_000));
        assert!(early < late, "names must sort by time: {early} vs {late}");
        // Accents, spaces and punctuation cannot reach the filename.
        let awkward = archive_name("La Niña: ¿Dónde? / Parte 2", at(1_759_000_000));
        assert!(
            awkward.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.'),
            "unsafe filename: {awkward}"
        );
        assert!(awkward.starts_with(PREFIX));
        assert!(awkward.ends_with(".zip"));
        // An untitled project still produces a usable name.
        assert!(archive_name("", at(0)).contains("novel"));
    }

    #[test]
    fn the_stamp_is_a_real_date() {
        // 2026-09-28T00:00:00Z. A wrong epoch conversion would sort fine and
        // still tell the writer the wrong day.
        assert_eq!(stamp(at(1_790_553_600)), "2026-09-28-000000");
        assert_eq!(stamp(at(0)), "1970-01-01-000000");
    }

    #[test]
    fn a_missing_project_is_refused_before_anything_is_written() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("synced");
        assert_eq!(
            create_in(&tmp.path().join("nope"), &dest, DEFAULT_KEEP, at(0)).unwrap_err(),
            "not_found"
        );
        assert!(!dest.exists(), "created the destination for a project that does not exist");
    }

    #[test]
    fn listing_a_folder_that_is_not_there_is_empty_rather_than_an_error() {
        // A sync folder can vanish: an unmounted drive, a signed-out client.
        let tmp = tempfile::tempdir().unwrap();
        assert!(list_in(&tmp.path().join("absent"), "el-faro").unwrap().is_empty());
    }

    #[test]
    fn destinations_are_reported_even_when_absent() {
        // Every entry names a kind the UI can translate, and a path.
        for destination in destinations() {
            assert!(!destination.kind.is_empty());
            assert!(!destination.path.is_empty());
            assert_eq!(destination.available, Path::new(&destination.path).is_dir());
        }
    }
}
