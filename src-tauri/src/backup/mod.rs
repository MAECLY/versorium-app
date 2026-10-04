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

pub mod flight;
pub mod host;
mod names;

use crate::git::lock::{RepoLock, Wait};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs;
use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

/// Prefix on every archive, so a folder shared with other files stays legible
/// and pruning can never delete something Versorium did not write.
const PREFIX: &str = "versorium-backup";
const EXTENSION: &str = "zip";

/// The error codes a backup returns. Rust carries no prose: each code has an
/// `errors.<code>` line in both locales, and a test reads the locale files to
/// hold that true, so none of them reaches the writer as "Something went
/// wrong.".
pub mod code {
    pub const NOT_CONFIGURED: &str = "backup_not_configured";
    /// The folder is not there: chosen in Settings and gone since, or pulled
    /// out mid-write. The command reports the second as unavailable.
    pub const DEST_MISSING: &str = "backup_dest_missing";
    pub const DEST_UNWRITABLE: &str = "backup_dest_unwritable";
    pub const NO_SPACE: &str = "backup_no_space";
    pub const WRITE_FAILED: &str = "backup_write_failed";
    pub const UNREADABLE: &str = "backup_unreadable";
    pub const CORRUPT: &str = "backup_corrupt";
    /// The novel's own folder is gone.
    pub const NOT_FOUND: &str = "not_found";
    /// Reading the novel's own files failed: not the destination's fault.
    pub const IO: &str = "io";
    pub const BAD_ARGS: &str = "bad_args";
    pub const NO_HOME: &str = "no_home";
    /// The repository lock was still held when the wait ran out. A backup
    /// reports it as busy; a commit that waited on a backup returns it.
    pub const REPO_BUSY: &str = crate::git::lock::BUSY;
}

/// Every code in [`code`], for the test that holds each one to a translation.
#[cfg(test)]
pub const CODES: &[&str] = &[
    code::NOT_CONFIGURED,
    code::DEST_MISSING,
    code::DEST_UNWRITABLE,
    code::NO_SPACE,
    code::WRITE_FAILED,
    code::UNREADABLE,
    code::CORRUPT,
    code::NOT_FOUND,
    code::IO,
    code::BAD_ARGS,
    code::NO_HOME,
    code::REPO_BUSY,
];

/// What a failed write into a destination means to the writer.
///
/// The kind decides, never the message: a full disk and a read-only folder
/// need different things done about them, and before this every one of them
/// read "Something went wrong.".
pub fn write_code(error: &std::io::Error) -> &'static str {
    use std::io::ErrorKind;
    match error.kind() {
        ErrorKind::StorageFull | ErrorKind::QuotaExceeded => code::NO_SPACE,
        ErrorKind::PermissionDenied | ErrorKind::ReadOnlyFilesystem => code::DEST_UNWRITABLE,
        // The disk was pulled out mid-write: unavailable, not failed.
        ErrorKind::NotFound => code::DEST_MISSING,
        _ => code::WRITE_FAILED,
    }
}

/// `write_code` for the zip writer, which wraps the I/O error of the file
/// underneath it.
fn zip_code(error: zip::result::ZipError) -> &'static str {
    match error {
        zip::result::ZipError::Io(io) => write_code(&io),
        _ => code::WRITE_FAILED,
    }
}

/// How far ahead of this computer's clock an archive may be stamped before
/// pruning stops. Two Macs sharing a folder rarely agree to the second.
const CLOCK_TOLERANCE: u64 = 600;

/// How long a backup waits to read the novel's history while a commit or a
/// pull holds it. Past this, every destination is told the novel was busy.
const CAPTURE_WAIT: std::time::Duration = std::time::Duration::from_secs(30);

/// A temporary file of this computer's is swept after this long, whatever
/// else is true of it. No run lasts a day.
const PART_OWN_AGE: u64 = 24 * 3600;
/// Another computer's temporary file is swept only after this long. A sync
/// client re-touching its mtime only delays the cleanup.
const PART_FOREIGN_AGE: u64 = 7 * 24 * 3600;
/// The two older names carry no host, so whose they are cannot be known.
const PART_LEGACY_AGE: u64 = 24 * 3600;

/// How many archives to keep by default. Enough to recover from a mistake
/// noticed days later, few enough not to fill a synced folder.
pub const DEFAULT_KEEP: usize = 10;

/// How many hex digits of the fingerprint ride in the filename.
const PRINT_HEX: usize = 16;

/// Copies of one state a destination keeps.
///
/// One would make "keep the newest 10" mean ten states with one copy each,
/// which is fewer physical files than today — the one thing this change must
/// not do. Two is the smallest number that survives a single corrupt file.
const COPIES_PER_STATE: usize = 2;

/// Hashed first, so changing what the fingerprint covers can never read as
/// "nothing has changed". Bumping it makes every project look changed, which is
/// the safe direction to be wrong in.
const PRINT_SCHEME: &[u8] = b"versorium-backup-fingerprint-v1\0";

/// Where a backup can go. `kind` exists so the UI can name the destination in
/// the writer's own terms rather than showing a path.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Destination {
    /// A provider slug (`icloud`, `dropbox`, …), `disk` for a second drive, or
    /// `folder` for one the writer picked.
    pub kind: String,
    pub path: String,
    /// The folder exists right now. A destination can be offered and absent —
    /// OneDrive on a machine where it was uninstalled, for instance.
    pub available: bool,
    /// Which physical volume this sits on, for telling two copies apart from
    /// one copy stored twice. `None` where the platform will not say, which is
    /// reported as unknown rather than guessed at.
    pub volume: Option<String>,
    /// A provider carries the copy off this machine. A second disk does not:
    /// it survives a dead drive, not a burnt flat.
    pub offsite: bool,
}

/// Kinds that leave the building. Everything else is a local copy, which is a
/// different kind of protection and is labelled as one.
pub fn is_offsite(kind: &str) -> bool {
    !matches!(kind, "folder" | "disk")
}

/// An id for the volume a path lives on.
///
/// Two backups on one disk are one copy as far as a failing disk is concerned,
/// which is the whole point of the "2" in 3-2-1. Unix has the device number;
/// Windows has the drive letter, which is as far as std goes without pulling in
/// a winapi dependency for one string.
pub fn volume_of(path: &Path) -> Option<String> {
    volume_id(path)
}

#[cfg(unix)]
fn volume_id(path: &Path) -> Option<String> {
    use std::os::unix::fs::MetadataExt;
    fs::metadata(path).ok().map(|m| m.dev().to_string())
}

#[cfg(windows)]
fn volume_id(path: &Path) -> Option<String> {
    let text = path.to_string_lossy();
    let bytes = text.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        return Some((bytes[0].to_ascii_uppercase() as char).to_string());
    }
    // A UNC share is its own storage; \\server\share identifies it.
    let rest = text.strip_prefix(r"\\")?;
    let mut parts = rest.split(['\\', '/']);
    match (parts.next(), parts.next()) {
        (Some(server), Some(share)) => Some(format!(r"\\{server}\{share}").to_lowercase()),
        _ => None,
    }
}

#[cfg(not(any(unix, windows)))]
fn volume_id(_path: &Path) -> Option<String> {
    None
}

/// What the current choice actually protects against.
///
/// Reported rather than scored. A writer with two copies on one disk is not
/// failing a test, they are one disk failure from losing a novel, and those are
/// different sentences.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Coverage {
    /// Counting the novel itself, as 3-2-1 does.
    pub copies: usize,
    /// Distinct volumes those copies sit on. `None` when at least one could not
    /// be identified, so "2 media" is never claimed on a guess.
    pub media: Option<usize>,
    /// At least one copy leaves this machine.
    pub offsite: bool,
    /// Destinations sharing a disk with the novel: a copy that dies with it.
    pub on_the_novels_disk: Vec<String>,
}

/// Grade a set of destinations against the novel's own location.
///
/// `detected` is what `destinations()` found, looked up once per call.
/// Finding it probes every candidate folder and disk with a write, and doing
/// that once per chosen destination tripled the probing for nothing.
pub fn coverage_with(project: &Path, dirs: &[PathBuf], detected: &[Destination]) -> Coverage {
    let project_volume = volume_of(project);
    let mut volumes: Vec<String> = project_volume.iter().cloned().collect();
    let mut unknown = project_volume.is_none();
    let mut shared = Vec::new();
    let mut offsite = false;

    for dir in dirs {
        if is_offsite(&kind_in(dir, detected)) {
            offsite = true;
        }
        match volume_of(dir) {
            Some(volume) => {
                if Some(&volume) == project_volume.as_ref() {
                    shared.push(dir.to_string_lossy().into_owned());
                }
                if !volumes.contains(&volume) {
                    volumes.push(volume);
                }
            }
            None => unknown = true,
        }
    }

    Coverage {
        copies: 1 + dirs.len(),
        media: (!unknown).then_some(volumes.len()),
        offsite,
        on_the_novels_disk: shared,
    }
}

/// Which provider an already-chosen path belongs to, for a destination stored
/// in settings rather than freshly detected. A path detection did not find is
/// a folder the writer picked.
fn kind_in(path: &Path, detected: &[Destination]) -> String {
    detected
        .iter()
        .find(|d| d.path == path.to_string_lossy())
        .map(|d| d.kind.clone())
        .unwrap_or_else(|| "folder".to_string())
}

/// A stored archive.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Archive {
    pub path: String,
    pub name: String,
    pub bytes: u64,
    /// Unix seconds, from the file's own mtime.
    ///
    /// Not what the UI should show. One press gave this app's first reporter
    /// 1:13:16 in one folder and 1:13:17 in another, because each destination
    /// writes at its own speed and a sync client rewrites mtimes when it
    /// re-downloads a file.
    pub modified: u64,
    /// When the backup was asked for, read back out of the name. This is the
    /// time the writer means.
    pub stamped: Option<u64>,
    /// Which state of the novel this archive holds, read out of the name.
    /// `None` for an archive written before fingerprints existed — which is
    /// exactly why such an archive can never be mistaken for a match.
    pub print: Option<String>,
    /// Of the archive as it sits on the destination, read back after writing.
    /// `None` for an archive found by listing, which has not been re-verified.
    pub sha256: Option<String>,
}

fn home() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| code::NO_HOME.to_string())
}

/// Whether a directory will actually accept a file.
///
/// `is_dir()` is not enough. Google Drive's root is `dr-x------`: a real
/// directory that rejects every write. Offering it as a destination and failing
/// at backup time is the worst possible moment to find out.
fn writable(path: &Path) -> bool {
    if !path.is_dir() {
        return false;
    }
    let probe = path.join(".versorium-write-probe");
    match fs::write(&probe, b"") {
        Ok(()) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// The first writable directory inside `root`, for providers whose root is not.
///
/// Google Drive puts the real target one level down, and names it in the user's
/// own language — `Mi unidad` here, `My Drive` in English. Probing beats a
/// translation table nobody can keep complete.
fn writable_child(root: &Path) -> Option<PathBuf> {
    let mut children: Vec<PathBuf> = fs::read_dir(root)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .filter(|p| {
            !p.file_name()
                .map(|n| n.to_string_lossy().starts_with('.'))
                .unwrap_or(true)
        })
        .collect();
    children.sort();
    children.into_iter().find(|p| writable(p))
}

fn usable(root: &Path) -> Option<PathBuf> {
    if writable(root) {
        Some(root.to_path_buf())
    } else {
        writable_child(root)
    }
}

/// Vendor prefixes macOS uses under `~/Library/CloudStorage`, which it names
/// `Vendor-Account`. Apple forces this layout: file-provider extensions have
/// been the only sanctioned route since kexts were deprecated in 12.3, so this
/// finds providers this code has never heard of.
#[cfg(target_os = "macos")]
const CLOUD_STORAGE_VENDORS: [(&str, &str); 6] = [
    ("GoogleDrive", "googledrive"),
    ("OneDrive", "onedrive"),
    ("Box", "box"),
    ("Dropbox", "dropbox"),
    ("ProtonDrive", "protondrive"),
    ("pCloud", "pcloud"),
];

/// Read Dropbox's own record of where its folder is.
///
/// `~/Dropbox` is a guess, and a wrong one for anybody who moved it. Dropbox
/// writes the real path into `info.json`, one entry per linked account.
fn dropbox_paths(home: &Path) -> Vec<PathBuf> {
    let mut candidates = vec![home.join(".dropbox").join("info.json")];
    for var in ["APPDATA", "LOCALAPPDATA"] {
        if let Some(dir) = std::env::var_os(var) {
            candidates.push(PathBuf::from(dir).join("Dropbox").join("info.json"));
        }
    }
    for path in candidates {
        let Ok(text) = fs::read_to_string(&path) else { continue };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        let Some(accounts) = value.as_object() else { continue };
        let found: Vec<PathBuf> = accounts
            .values()
            .filter_map(|account| account.get("path").and_then(|p| p.as_str()))
            .map(PathBuf::from)
            .collect();
        if !found.is_empty() {
            return found;
        }
    }
    Vec::new()
}

/// Read a Nextcloud or ownCloud client config for its sync roots.
///
/// The config moved on macOS with client v33, so both locations are tried.
fn sync_client_paths(home: &Path, file: &str, vendor: &str) -> Vec<PathBuf> {
    let candidates = [
        home.join("Library/Preferences").join(vendor).join(file),
        home.join("Library/Containers")
            .join(format!("com.{}.desktopclient", vendor.to_lowercase()))
            .join("Data/Library/Preferences")
            .join(vendor)
            .join(file),
        home.join(".config").join(vendor).join(file),
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_default()
            .join(vendor)
            .join(file),
    ];
    for path in candidates {
        let Ok(text) = fs::read_to_string(&path) else { continue };
        let found: Vec<PathBuf> = text
            .lines()
            .filter_map(|line| {
                let line = line.trim();
                let at = line.find("localPath=")?;
                // Only a whole key, so a value that happens to contain the word
                // is not mistaken for one.
                if at > 0 && !matches!(line.as_bytes().get(at - 1), Some(b'\\') | Some(b'/')) {
                    return None;
                }
                let value = line[at + "localPath=".len()..].trim();
                (!value.is_empty()).then(|| PathBuf::from(value))
            })
            .collect();
        if !found.is_empty() {
            return found;
        }
    }
    Vec::new()
}

/// Candidate sync folders on this machine.
///
/// Detected rather than guessed wherever the provider records the answer:
/// somebody who moved their Dropbox folder still gets a working backup, and a
/// destination that would reject the write is never offered.
pub fn destinations() -> Vec<Destination> {
    let Ok(home) = home() else { return Vec::new() };
    let mut found: Vec<Destination> = Vec::new();

    let mut add = |kind: &str, path: PathBuf| {
        let resolved = usable(&path);
        let available = resolved.is_some();
        let path = resolved.unwrap_or(path);
        if found.iter().any(|d: &Destination| d.path == path.to_string_lossy()) {
            return;
        }
        found.push(Destination {
            kind: kind.to_string(),
            available,
            volume: available.then(|| volume_of(&path)).flatten(),
            offsite: is_offsite(kind),
            path: path.to_string_lossy().into_owned(),
        });
    };

    // Fixed and locale-independent: only the Finder label is translated.
    #[cfg(target_os = "macos")]
    add("icloud", home.join("Library/Mobile Documents/com~apple~CloudDocs"));

    // Everything macOS syncs lives here, named `Vendor-Account`.
    #[cfg(target_os = "macos")]
    if let Ok(entries) = fs::read_dir(home.join("Library/CloudStorage")) {
        let mut dirs: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
        dirs.sort();
        for dir in dirs {
            let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let kind = CLOUD_STORAGE_VENDORS
                .iter()
                .find(|(prefix, _)| name.starts_with(prefix))
                .map(|(_, kind)| *kind)
                .unwrap_or("folder");
            add(kind, dir);
        }
    }

    // Set by the OneDrive client; the folder is not always under the profile.
    for var in ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"] {
        if let Some(value) = std::env::var_os(var).filter(|v| !v.is_empty()) {
            add("onedrive", PathBuf::from(value));
        }
    }

    for path in dropbox_paths(&home) {
        add("dropbox", path);
    }
    for path in sync_client_paths(&home, "nextcloud.cfg", "Nextcloud") {
        add("nextcloud", path);
    }
    for path in sync_client_paths(&home, "owncloud.cfg", "ownCloud") {
        add("owncloud", path);
    }

    // Last, and only if nothing authoritative was found: the conventional names
    // these clients use when nobody moved them.
    for (kind, dir) in [
        ("dropbox", "Dropbox"),
        ("nextcloud", "Nextcloud"),
        ("owncloud", "ownCloud"),
        ("mega", "MEGA"),
        ("pcloud", "pCloud"),
        ("seafile", "Seafile"),
        ("koofr", "Koofr"),
        ("syncthing", "Sync"),
    ] {
        let path = home.join(dir);
        if path.is_dir() {
            add(kind, path);
        }
    }

    // A second physical disk. Not a substitute for a provider — it is in the
    // same room, so it survives a dead drive and not a burglary — but it is the
    // only thing here that protects a novel with no network at all.
    for disk in other_disks(&home) {
        add("disk", disk);
    }

    found
}

/// Mounted volumes that are not the one the writer's home folder is on.
///
/// The boot volume is excluded by device number rather than by name, so a
/// renamed system disk or a home folder on a second internal drive both behave.
fn other_disks(home: &Path) -> Vec<PathBuf> {
    let here = volume_of(home);

    #[cfg(target_os = "macos")]
    let roots: Vec<PathBuf> = vec![PathBuf::from("/Volumes")];
    #[cfg(target_os = "linux")]
    let roots: Vec<PathBuf> = {
        let mut roots = vec![
            PathBuf::from("/media"),
            PathBuf::from("/run/media"),
            PathBuf::from("/mnt"),
        ];
        if let Some(user) = std::env::var_os("USER") {
            roots.push(PathBuf::from("/media").join(&user));
            roots.push(PathBuf::from("/run/media").join(&user));
        }
        roots
    };
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let roots: Vec<PathBuf> = Vec::new();

    let mut found: Vec<PathBuf> = Vec::new();
    for root in roots {
        let Ok(entries) = fs::read_dir(&root) else { continue };
        let mut dirs: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
        dirs.sort();
        for dir in dirs {
            // A mount point on the boot volume is a folder, not a disk: an
            // empty `/Volumes/Something` left behind by an ejected drive reads
            // as writable and would silently take backups nowhere useful.
            if volume_of(&dir) == here || found.contains(&dir) {
                continue;
            }
            if writable(&dir) {
                found.push(dir);
            }
        }
    }

    #[cfg(windows)]
    for letter in b'D'..=b'Z' {
        let path = PathBuf::from(format!("{}:\\", letter as char));
        if path.is_dir() && volume_of(&path) != here && writable(&path) {
            found.push(path);
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
/// `versorium-backup-<slug>-<YYYY-MM-DD-HHMMSS>-<16 hex>.zip`
///
/// The fingerprint goes after the stamp so a name sort is still chronological,
/// which both `list_in` and `prune_in` depend on.
pub fn archive_name(project: &str, now: std::time::SystemTime, print: &str) -> String {
    let short: String = print.chars().take(PRINT_HEX).collect();
    format!("{PREFIX}-{}-{}-{short}.{EXTENSION}", slug(project), stamp(now))
}

/// The fingerprint a name carries, if it carries one. `None` for an archive
/// written before fingerprints existed, which is why such an archive is never
/// read as a match. The rule that keeps a title from forging one lives in
/// `names::parse_archive`.
fn print_in_name(name: &str) -> Option<&str> {
    names::parse_archive(name).and_then(|parsed| parsed.print)
}

/// The moment a backup was asked for, out of its name.
fn stamped_in_name(name: &str) -> Option<u64> {
    names::parse_archive(name).map(|parsed| parsed.stamp)
}

/// A calendar date to days since the Unix epoch (Howard Hinnant's algorithm,
/// the inverse of `civil_from_days`).
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let m = month as i64;
    let d = day as i64;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn unix(at: std::time::SystemTime) -> u64 {
    at.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// A name nothing is standing on.
///
/// `archive_name` has one-second resolution and `fs::rename` replaces silently,
/// so two presses inside the same second with an edit between them would
/// destroy the first verified snapshot. The stamp is bumped rather than a "-2"
/// suffix appended, because a suffix would push the fingerprint out of the last
/// field and `print_in_name` would stop finding it.
fn free_name(
    dir: &Path,
    title: &str,
    now: std::time::SystemTime,
    print: &str,
) -> Result<(String, PathBuf), String> {
    for bump in 0..100u64 {
        let at = now + std::time::Duration::from_secs(bump);
        let name = archive_name(title, at, print);
        let path = dir.join(&name);
        if !path.exists() {
            return Ok((name, path));
        }
    }
    Err(code::WRITE_FAILED.into())
}

/// Every file in `dir` that is one of `project`'s backups, newest first.
///
/// Matched exactly (`names::archive_of`). A prefix match let `el-faro` list,
/// and then prune, the archives of `el-faro-del-norte`.
pub fn list_in(dir: &Path, project: &str) -> Result<Vec<Archive>, String> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err(code::IO.into()),
    };
    let mine = slug(project);
    let mut archives: Vec<Archive> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let parsed = names::archive_of(&name, &mine)?;
            let (stamped, print) = (parsed.stamp, parsed.print.map(str::to_string));
            let meta = entry.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            Some(Archive {
                path: entry.path().to_string_lossy().into_owned(),
                bytes: meta.len(),
                modified: meta.modified().map(unix).unwrap_or(0),
                stamped: Some(stamped),
                print,
                name,
                // Listing does not re-read gigabytes; `verify` does that on
                // demand.
                sha256: None,
            })
        })
        .collect();
    // By name, because the stamp sorts and an mtime can be rewritten by a sync
    // client re-downloading a file. One slug only, so name order is stamp order.
    archives.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(archives)
}

/// Why a run deleted none of the older archives at a destination. The new
/// archive was still written and read back; only the clean-up waited.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Held {
    /// This computer's clock reads earlier than an archive already in the
    /// folder, by more than two computers sharing a folder ever disagree.
    ClockBehind {
        /// The latest stamp in the folder, Unix seconds.
        stamp: u64,
    },
}

/// What pruning did at one destination.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pruned {
    pub removed: usize,
    pub held: Option<Held>,
}

/// Delete all but the newest `keep`, never `protect`, and nothing at all while
/// this computer's clock is behind an archive already in the folder.
///
/// `protect` is the archive this run just wrote and read back. Names sort by
/// their stamp, so once the clock had been set back a day, the new archive
/// sorted oldest and keeping "the newest" deleted it the moment it was
/// verified. The clock guard stops the rest: with archives stamped tomorrow,
/// "the newest" would keep tomorrow's and delete today's until tomorrow came.
pub fn prune_in(
    dir: &Path,
    project: &str,
    keep: usize,
    protect: Option<&str>,
    now: u64,
) -> Result<Pruned, String> {
    let archives = list_in(dir, project)?;
    if let Some(stamp) = archives.iter().filter_map(|a| a.stamped).max() {
        if now.saturating_add(CLOCK_TOLERANCE) < stamp {
            return Ok(Pruned { removed: 0, held: Some(Held::ClockBehind { stamp }) });
        }
    }
    let keep = keep.max(1);
    let mut kept: BTreeSet<&str> = protect
        .filter(|name| archives.iter().any(|a| a.name == *name))
        .into_iter()
        .collect();
    for archive in &archives {
        if kept.len() >= keep {
            break;
        }
        kept.insert(&archive.name);
    }
    let mut removed = 0;
    for archive in &archives {
        if !kept.contains(archive.name.as_str()) && fs::remove_file(&archive.path).is_ok() {
            removed += 1;
        }
    }
    Ok(Pruned { removed, held: None })
}

/// Listing and pruning as they were before names were read exactly: every
/// name that starts like this novel's, newest first by name, all but `keep`
/// deleted. Kept for the test that shows whose archives that deleted.
#[cfg(test)]
pub fn prune_by_prefix_legacy(dir: &Path, project: &str, keep: usize) -> Result<usize, String> {
    let mut ours: Vec<String> = fs::read_dir(dir)
        .map_err(|_| code::IO.to_string())?
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| names::is_ours_prefix_legacy(name, project))
        .collect();
    ours.sort_by(|a, b| b.cmp(a));
    let mut removed = 0;
    for name in ours.into_iter().skip(keep.max(1)) {
        if fs::remove_file(dir.join(name)).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

/// The pruning `prune_in` replaced: keep the first `keep` by name, whatever
/// this run just wrote. Kept for the tests that show what it did.
#[cfg(test)]
pub fn prune_newest_legacy(dir: &Path, project: &str, keep: usize) -> Result<usize, String> {
    let archives = list_in(dir, project)?;
    let mut removed = 0;
    for old in archives.into_iter().skip(keep.max(1)) {
        if fs::remove_file(&old.path).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

/// Who is writing: this computer and this process. Each run adds a number of
/// its own, so no two writers ever share a temporary file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunCtx {
    /// `host::this_host()`, ten hex digits.
    pub host: String,
    pub pid: u32,
}

impl RunCtx {
    pub fn this_process() -> Self {
        Self { host: host::this_host().to_string(), pid: std::process::id() }
    }

    /// A fixed computer, for tests that do not care which.
    #[cfg(test)]
    pub fn for_tests() -> Self {
        Self { host: "a1b2c3d4e5".into(), pid: std::process::id() }
    }
}

static NEXT_RUN: AtomicU64 = AtomicU64::new(1);

/// Runs of this process whose temporary file may exist right now.
static ACTIVE_RUNS: Mutex<BTreeSet<u64>> = Mutex::new(BTreeSet::new());

fn active_runs() -> std::sync::MutexGuard<'static, BTreeSet<u64>> {
    // Each change is one insert or one remove; a panic cannot leave it torn.
    ACTIVE_RUNS.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// A run's number. Registered before its temporary file exists and released
/// however the run ends, so the sweep never takes a live file for a leftover.
struct ActiveRun(u64);

impl ActiveRun {
    fn start() -> Self {
        let id = NEXT_RUN.fetch_add(1, Ordering::Relaxed);
        active_runs().insert(id);
        Self(id)
    }
}

impl Drop for ActiveRun {
    fn drop(&mut self) {
        active_runs().remove(&self.0);
    }
}

/// Remove the temporary files runs left behind in `dir`, for this novel only.
///
/// A run cut short before its rename (a quit, a crash, a disk pulled out)
/// leaves a `.part` as large as the archive, and a sync client uploads it.
/// Nothing ever cleaned them up. The rules lean towards keeping: another
/// computer's file may still be written, so it waits a week.
pub fn sweep(dir: &Path, project: &str, ctx: &RunCtx, now: u64) -> usize {
    sweep_with(dir, project, ctx, now, abandoned)
}

/// Whether a temporary file may go: what it is, who is asking, how old it is.
type Rule = fn(&names::PartName<'_>, &RunCtx, u64) -> bool;

fn sweep_with(dir: &Path, project: &str, ctx: &RunCtx, now: u64, abandoned: Rule) -> usize {
    let Ok(entries) = fs::read_dir(dir) else { return 0 };
    let mine = slug(project);
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(part) = names::parse_part(&name) else { continue };
        if part.slug() != mine {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        // An mtime in the future (another computer's clock) reads as new.
        let age = meta.modified().map(|t| now.saturating_sub(unix(t))).unwrap_or(0);
        if abandoned(&part, ctx, age) && fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

/// Whether nobody can still be writing this file.
fn abandoned(part: &names::PartName<'_>, ctx: &RunCtx, age: u64) -> bool {
    match part {
        names::PartName::Run { host, pid, run, .. } if *host == ctx.host => {
            age > PART_OWN_AGE
                || if *pid == ctx.pid { !active_runs().contains(run) } else { !pid_alive(*pid) }
        }
        names::PartName::Run { .. } => age > PART_FOREIGN_AGE,
        names::PartName::LegacyPid { .. } | names::PartName::LegacyArchive { .. } => age > PART_LEGACY_AGE,
    }
}

/// The rule the host id replaced: a process id read as if every computer
/// shared one table of them. Kept for the test that shows what it deleted.
#[cfg(test)]
fn abandoned_by_pid_alone(part: &names::PartName<'_>, ctx: &RunCtx, age: u64) -> bool {
    match part {
        names::PartName::Run { pid, run, .. } => {
            age > PART_OWN_AGE || if *pid == ctx.pid { !active_runs().contains(run) } else { !pid_alive(*pid) }
        }
        _ => abandoned(part, ctx, age),
    }
}

/// Whether a process with this id is running on this computer.
///
/// `sysinfo` is already here for the hardware probe and answers the same way
/// on all three platforms, without a new dependency or `unsafe`.
fn pid_alive(pid: u32) -> bool {
    let pid = sysinfo::Pid::from_u32(pid);
    let mut system = sysinfo::System::new();
    system.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::Some(&[pid]),
        true,
        sysinfo::ProcessRefreshKind::nothing(),
    );
    system.process(pid).is_some()
}

/// Files that must never enter an archive.
///
/// `.DS_Store` and `Thumbs.db` are the OS's, not the novel's. Nested backups
/// are excluded so a project that once held one cannot grow geometrically.
fn skip(name: &str) -> bool {
    name == ".DS_Store"
        || name == "Thumbs.db"
        || name.starts_with(PREFIX)
        // `storage::atomic_write` parks a `.versorium-save-<pid>-<n>.tmp`
        // beside the file it is replacing. One caught mid-flight would enter
        // the archive as a phantom file, and would make an untouched novel look
        // changed on the next press.
        || name.starts_with(".versorium-save-")
}

/// Where an entry's bytes come from.
enum Source {
    Dir,
    /// Read from disk: once to hash it, and again when it is packed.
    Disk(PathBuf),
    /// Read once, when the plan was made, and packed from memory.
    Frozen { bytes: Vec<u8>, modified: Option<std::time::SystemTime> },
}

/// One thing the archive will hold.
struct Entry {
    /// Forward-slashed path inside the archive.
    inside: String,
    source: Source,
}

/// In what order the repository is read. Only the tests ask for the other
/// order, to show what it does.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Order {
    /// Every file in `.git` outside `objects/` is read into memory first, and
    /// only then is the object store listed.
    FreezeFirst,
    /// The object store first: a commit landing in between leaves the frozen
    /// refs naming objects the list does not hold.
    #[cfg(test)]
    ObjectsFirst,
}

/// Which part of the novel a walk covers.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Pass {
    /// `.git`, outside `objects/`: read into memory as it is found.
    Repository,
    /// `.git/objects`: listed now, read when packed.
    Objects,
    /// Everything outside `.git`: listed now, read when packed.
    WorkingTree,
}

/// Everything `root` would pack, in one canonical order.
///
/// ## Why `.git` is read in two steps
///
/// The 60-second checkpoint, Save snapshot and MCP writes can all commit while
/// a backup runs. A commit writes its objects first and moves the ref after,
/// and libgit2 never deletes an object. So the files that name commits (HEAD,
/// refs, packed-refs, the index, the logs) are read into memory first, and the
/// object store is listed after them: every object a frozen ref can name was
/// already on disk when the list was made, however long the packing then
/// takes. One sorted walk put `objects/` before `refs/` and read both at pack
/// time, so a commit landing during a backup archived a HEAD that named a
/// commit the archive did not hold.
///
/// Both halves are read under the repository lock (`git::lock`), so no commit
/// or pull of this app's, in any process, lands while they are read: the
/// index, the refs and the logs in the archive describe one moment. The order
/// is what keeps the history whole against a writer that never takes the
/// lock, such as `git` run by hand. The lock is let go before the working
/// tree is walked, so a commit waits for a fraction of a second at most.
///
/// `*.lock` files in `.git` are left out. Each is either stale, from a write
/// that crashed, or live, from a write that will rename it in a moment; a
/// restored copy holding one refuses to commit.
///
/// Sorted at the end, because `fs::read_dir` is unordered on every platform —
/// in the archives that produced the fingerprint, `research/` came before
/// `manuscript/` — and the order is the only thing that makes a fingerprint
/// the same twice for the same novel.
fn capture(root: &Path, order: Order, wait: Wait, between: &mut dyn FnMut()) -> Result<Vec<Entry>, String> {
    let git = root.join(".git");
    let objects = git.join("objects");
    // A link is not followed, the same as the walk treats every other one.
    let is_dir = |path: &Path| fs::symlink_metadata(path).map(|m| m.is_dir()).unwrap_or(false);
    let has_git = is_dir(&git);
    let has_objects = has_git && is_dir(&objects);
    let mut out: Vec<Entry> = Vec::new();
    {
        let _history = if has_git { Some(RepoLock::acquire(root, wait)?) } else { None };
        match order {
            Order::FreezeFirst => {
                if has_git {
                    walk(root, &git, Pass::Repository, &mut out)?;
                }
                between();
                if has_objects {
                    walk(root, &objects, Pass::Objects, &mut out)?;
                }
            }
            #[cfg(test)]
            Order::ObjectsFirst => {
                if has_objects {
                    walk(root, &objects, Pass::Objects, &mut out)?;
                }
                between();
                if has_git {
                    walk(root, &git, Pass::Repository, &mut out)?;
                }
            }
        }
    }
    walk(root, root, Pass::WorkingTree, &mut out)?;
    out.sort_unstable_by(|a, b| a.inside.as_bytes().cmp(b.inside.as_bytes()));
    Ok(out)
}

fn walk(root: &Path, dir: &Path, pass: Pass, out: &mut Vec<Entry>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|_| code::IO.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if skip(&name) {
            continue;
        }
        let relative = path.strip_prefix(root).map_err(|_| code::IO.to_string())?;
        // Zip paths are always forward-slashed, including archives written on
        // Windows.
        let inside = relative.to_string_lossy().replace('\\', "/");
        // From the directory listing, not a stat per file: the repository is
        // most of a novel's files.
        let kind = entry.file_type().map_err(|_| code::IO.to_string())?;
        if kind.is_dir() {
            // Each of these is walked by a pass of its own.
            let boundary = match pass {
                Pass::WorkingTree => dir == root && name == ".git",
                Pass::Repository => inside == ".git/objects",
                Pass::Objects => false,
            };
            out.push(Entry { inside, source: Source::Dir });
            if !boundary {
                walk(root, &path, pass, out)?;
            }
        } else if kind.is_file() {
            if pass != Pass::WorkingTree && name.ends_with(".lock") {
                continue;
            }
            let source = if pass == Pass::Repository {
                #[cfg(test)]
                hooks::before_freeze(&path);
                match freeze(&path) {
                    Ok(source) => source,
                    // Gone between the listing and the read: renamed over by a
                    // write that is finishing. Packing would skip it too.
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                    Err(_) => return Err(code::IO.into()),
                }
            } else {
                Source::Disk(path)
            };
            out.push(Entry { inside, source });
        }
    }
    Ok(())
}

/// A file's bytes and date, through one handle, so the two describe the same
/// file even if a write renames a new one over it meanwhile.
fn freeze(path: &Path) -> std::io::Result<Source> {
    let mut file = fs::File::open(path)?;
    let modified = file.metadata().ok().and_then(|m| m.modified().ok());
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    Ok(Source::Frozen { bytes, modified })
}

/// The walk `capture` replaced: one pass, with every file, `.git` included,
/// read again when packed, and lock files kept. For the tests that show what
/// it did.
#[cfg(test)]
fn collect_legacy(root: &Path) -> Result<Vec<Entry>, String> {
    fn walk_all(root: &Path, dir: &Path, out: &mut Vec<Entry>) -> Result<(), String> {
        for entry in fs::read_dir(dir).map_err(|_| code::IO.to_string())?.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if skip(&name) {
                continue;
            }
            let relative = path.strip_prefix(root).map_err(|_| code::IO.to_string())?;
            let inside = relative.to_string_lossy().replace('\\', "/");
            let meta = entry.metadata().map_err(|_| code::IO.to_string())?;
            if meta.is_dir() {
                out.push(Entry { inside, source: Source::Dir });
                walk_all(root, &path, out)?;
            } else if meta.is_file() {
                out.push(Entry { inside, source: Source::Disk(path) });
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    walk_all(root, root, &mut out)?;
    out.sort_unstable_by(|a, b| a.inside.as_bytes().cmp(b.inside.as_bytes()));
    Ok(out)
}

/// What the novel is right now: one walk, one hash.
pub struct Plan {
    /// 64 lowercase hex.
    pub print: String,
    entries: Vec<Entry>,
}

/// `Err(code::REPO_BUSY)` when the history stayed locked for `CAPTURE_WAIT`.
pub fn plan(project: &Path) -> Result<Plan, String> {
    plan_with(project, Order::FreezeFirst, capture_wait(), &mut || {})
}

fn capture_wait() -> Wait {
    #[cfg(test)]
    if let Some(wait) = hooks::CAPTURE_WAIT.get() {
        return wait;
    }
    Wait::Upto(CAPTURE_WAIT)
}

/// `plan`, with a point between the two halves of the repository where a test
/// can commit.
fn plan_with(project: &Path, order: Order, wait: Wait, between: &mut dyn FnMut()) -> Result<Plan, String> {
    if !project.is_dir() {
        return Err(code::NOT_FOUND.into());
    }
    let entries = capture(project, order, wait, between)?;
    let print = fingerprint(&entries)?;
    Ok(Plan { print, entries })
}

/// The plan as it was made before the repository was frozen.
#[cfg(test)]
fn plan_unfrozen(project: &Path) -> Result<Plan, String> {
    let entries = collect_legacy(project)?;
    let print = fingerprint(&entries)?;
    Ok(Plan { print, entries })
}

/// A digest of names and contents, in order.
///
/// Every field is length-prefixed. Without that, a file `ab` holding `c` and a
/// file `a` holding `bc` hash to the same value, and a fingerprint a rename can
/// fool is worse than no fingerprint at all.
fn fingerprint(entries: &[Entry]) -> Result<String, String> {
    let mut hasher = Sha256::new();
    hasher.update(PRINT_SCHEME);
    let mut buffer = vec![0u8; 64 * 1024];
    for entry in entries {
        hasher.update(if matches!(entry.source, Source::Dir) { *b"d" } else { *b"f" });
        hasher.update((entry.inside.len() as u64).to_le_bytes());
        hasher.update(entry.inside.as_bytes());
        match &entry.source {
            Source::Dir => {}
            // Exactly what reading the file from disk would hash, so every
            // archive written before the repository was frozen still matches
            // the novel it holds.
            Source::Frozen { bytes, .. } => {
                hasher.update((bytes.len() as u64).to_le_bytes());
                hasher.update(bytes);
            }
            Source::Disk(path) => {
                let mut file = match fs::File::open(path) {
                    Ok(file) => file,
                    // Vanished between the walk and the read: a save in
                    // flight. The pack will notice the same thing.
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                    Err(_) => return Err(code::IO.into()),
                };
                let len = file.metadata().map(|m| m.len()).unwrap_or(0);
                hasher.update(len.to_le_bytes());
                loop {
                    let read = file.read(&mut buffer).map_err(|_| code::IO.to_string())?;
                    if read == 0 {
                        break;
                    }
                    hasher.update(&buffer[..read]);
                }
            }
        }
    }
    Ok(hex(&hasher.finalize()))
}

/// A file's own mtime as a zip timestamp.
///
/// So a chapter unzipped in Finder keeps the date it was written on, rather
/// than the instant somebody pressed a button.
fn zip_time(at: Option<std::time::SystemTime>) -> zip::DateTime {
    let Some(secs) = at
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
    else {
        return zip::DateTime::default();
    };
    let (year, month, day) = civil_from_days((secs / 86_400) as i64);
    let rest = secs % 86_400;
    zip::DateTime::from_date_and_time(
        year as u16,
        month as u8,
        day as u8,
        (rest / 3600) as u8,
        ((rest % 3600) / 60) as u8,
        (rest % 60) as u8,
    )
    .unwrap_or_default()
}

/// Pack every entry and hash exactly the bytes that went in.
///
/// Hashed here rather than reused from `plan` so the digest in the name
/// describes the archive's real contents. A save landing mid-backup then makes
/// the two differ, which is true, instead of stamping a name that lies.
///
/// A failure to read the novel is `io`; a failure to write the archive is
/// named for what the destination did (`write_code`).
fn write_entries<W: Write + Seek>(
    zip: &mut zip::ZipWriter<W>,
    entries: &[Entry],
    base: zip::write::SimpleFileOptions,
) -> Result<String, String> {
    let mut hasher = Sha256::new();
    hasher.update(PRINT_SCHEME);
    let mut buffer = vec![0u8; 64 * 1024];
    for entry in entries {
        match &entry.source {
            Source::Dir => {
                hasher.update(*b"d");
                hasher.update((entry.inside.len() as u64).to_le_bytes());
                hasher.update(entry.inside.as_bytes());
                zip.add_directory(format!("{}/", entry.inside), base).map_err(zip_code)?;
            }
            Source::Frozen { bytes, modified } => {
                hasher.update(*b"f");
                hasher.update((entry.inside.len() as u64).to_le_bytes());
                hasher.update(entry.inside.as_bytes());
                hasher.update((bytes.len() as u64).to_le_bytes());
                hasher.update(bytes);
                let options = base.last_modified_time(zip_time(*modified));
                zip.start_file(&entry.inside, options).map_err(zip_code)?;
                zip.write_all(bytes).map_err(|e| write_code(&e))?;
            }
            Source::Disk(path) => {
                // Opened before the entry is started, so a file that vanished
                // does not leave a headed-but-empty member in the archive.
                let mut file = match fs::File::open(path) {
                    Ok(file) => file,
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                    Err(_) => return Err(code::IO.into()),
                };
                let meta = file.metadata().map_err(|_| code::IO.to_string())?;
                hasher.update(*b"f");
                hasher.update((entry.inside.len() as u64).to_le_bytes());
                hasher.update(entry.inside.as_bytes());
                hasher.update(meta.len().to_le_bytes());

                let options = base.last_modified_time(zip_time(meta.modified().ok()));
                zip.start_file(&entry.inside, options).map_err(zip_code)?;
                loop {
                    let read = file.read(&mut buffer).map_err(|_| code::IO.to_string())?;
                    if read == 0 {
                        break;
                    }
                    hasher.update(&buffer[..read]);
                    zip.write_all(&buffer[..read]).map_err(|e| write_code(&e))?;
                }
            }
        }
        #[cfg(test)]
        hooks::after_entry();
    }
    Ok(hex(&hasher.finalize()))
}

/// Pack every entry and close the archive, with the full digest as its
/// comment so the short form in the filename can be confirmed. Returns the
/// digest.
///
/// Closing writes the central directory and whatever the compressor still
/// held, so a disk that fills there fails here, and is named for it too.
fn pack<W: Write + Seek>(mut zip: zip::ZipWriter<W>, entries: &[Entry]) -> Result<String, String> {
    // Deflate: a manuscript is text and compresses to a fraction, which is
    // the difference between a synced folder noticing and not.
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let packed = write_entries(&mut zip, entries, options)?;
    zip.set_comment(packed.clone());
    zip.finish().map_err(zip_code)?;
    Ok(packed)
}

/// Points where a test can hold or disturb a run, on the thread doing the
/// work, and two knobs that bring back what the code used to do.
#[cfg(test)]
pub(crate) mod hooks {
    use super::Wait;
    use std::cell::{Cell, RefCell};
    use std::path::Path;

    type Hook = Box<dyn FnMut()>;
    type PathHook = Box<dyn FnMut(&Path)>;

    thread_local! {
        /// Called after each entry is packed.
        pub static AFTER_ENTRY: RefCell<Option<Hook>> = const { RefCell::new(None) };
        /// Called with a file in `.git` after it was listed, before it is read.
        pub static BEFORE_FREEZE: RefCell<Option<PathHook>> = const { RefCell::new(None) };
        /// Called with the archive's name just before the temporary file is
        /// renamed to it.
        pub static BEFORE_RENAME: RefCell<Option<PathHook>> = const { RefCell::new(None) };
        /// Called with the archive just before it is read back.
        pub static BEFORE_VERIFY: RefCell<Option<PathHook>> = const { RefCell::new(None) };
        /// How long a capture waits for the repository lock, instead of
        /// `CAPTURE_WAIT`.
        pub static CAPTURE_WAIT: Cell<Option<Wait>> = const { Cell::new(None) };
        /// Names the temporary file by the process alone, as runs did before
        /// host ids.
        pub static PID_ONLY_PART: Cell<bool> = const { Cell::new(false) };
    }

    pub fn after_entry() {
        AFTER_ENTRY.with(|hook| {
            if let Some(hook) = hook.borrow_mut().as_mut() {
                hook();
            }
        });
    }

    fn at(hook: &'static std::thread::LocalKey<RefCell<Option<PathHook>>>, path: &Path) {
        hook.with(|hook| {
            if let Some(hook) = hook.borrow_mut().as_mut() {
                hook(path);
            }
        });
    }

    pub fn before_freeze(path: &Path) {
        at(&BEFORE_FREEZE, path);
    }

    pub fn before_rename(path: &Path) {
        at(&BEFORE_RENAME, path);
    }

    pub fn before_verify(path: &Path) {
        at(&BEFORE_VERIFY, path);
    }
}

/// What happened at one destination that did not fail outright.
///
/// `held` is set when pruning was withheld; the archive itself is unaffected.
#[derive(Debug, Clone, PartialEq)]
pub enum Written {
    /// A state that was not here before, written and read back.
    Fresh { archive: Archive, pruned: usize, held: Option<Held> },
    /// The same state again, kept a second time, because one file is one file.
    Copy { archive: Archive, pruned: usize, held: Option<Held> },
    /// Nothing has changed and there are already enough copies. The newest was
    /// read back in full anyway — that is the only proof a press which writes
    /// nothing can offer.
    Same { archive: Archive, pruned: usize, held: Option<Held> },
    /// The copy that was here could not be read back whole. A fresh one was
    /// written and the bad one left where it is, to age out through pruning
    /// rather than be deleted on a guess.
    Repaired { archive: Archive, pruned: usize, held: Option<Held>, reason: String, damaged: String },
}

/// Reading a `Written` without caring which kind it is.
///
/// Only the tests need this: the command matches on the variant, because the
/// whole point of the variants is that the writer is told which one happened.
#[cfg(test)]
impl Written {
    pub fn archive(&self) -> &Archive {
        match self {
            Written::Fresh { archive, .. }
            | Written::Copy { archive, .. }
            | Written::Same { archive, .. }
            | Written::Repaired { archive, .. } => archive,
        }
    }

    pub fn pruned(&self) -> usize {
        match self {
            Written::Fresh { pruned, .. }
            | Written::Copy { pruned, .. }
            | Written::Same { pruned, .. }
            | Written::Repaired { pruned, .. } => *pruned,
        }
    }

    pub fn held(&self) -> Option<&Held> {
        match self {
            Written::Fresh { held, .. }
            | Written::Copy { held, .. }
            | Written::Same { held, .. }
            | Written::Repaired { held, .. } => held.as_ref(),
        }
    }
}

/// Back `project` up into `dir`, then prune.
///
/// Takes a `Plan` so a novel is walked and hashed once per press rather than
/// once per destination — a 200 MB project across three folders is otherwise
/// read three times, and two destinations could disagree about what state they
/// were given.
pub fn create_planned(
    project: &Path,
    dir: &Path,
    keep: usize,
    now: std::time::SystemTime,
    plan: &Plan,
    ctx: &RunCtx,
) -> Result<Written, String> {
    if !project.is_dir() {
        return Err(code::NOT_FOUND.into());
    }
    fs::create_dir_all(dir).map_err(|e| write_code(&e).to_string())?;

    let title = project
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "novel".into());
    // Before anything is counted, so what a dead run left behind is gone first.
    sweep(dir, &title, ctx, unix(now));

    let short: String = plan.print.chars().take(PRINT_HEX).collect();
    // Clamped, or a writer keeping one archive gets a second copy written and
    // pruned away in the same breath.
    let copies = COPIES_PER_STATE.min(keep.max(1));

    let archives = list_in(dir, &title)?;
    let holding = archives.iter().filter(|a| a.print.as_deref() == Some(short.as_str())).count();

    // Compared against the NEWEST only, never "any archive in the folder". That
    // is what keeps the property a writer relies on: the newest archive in every
    // destination is the novel as it stands now. Matching against any archive
    // would leave a reverted state looking already-backed-up while the newest
    // file on disk held something else.
    //
    // The newest this computer's clock could have written, though. While the
    // clock reads earlier than an archive already here, that archive sorts
    // first whatever is written, and comparing against it alone wrote a fresh
    // archive on every press of an unchanged novel, with pruning held back by
    // the same clock: the folder grew by a whole copy each time. When every
    // archive is ahead of the clock, the newest is still the one to match.
    let newest = archives
        .iter()
        .find(|a| a.stamped.is_some_and(|stamp| stamp <= unix(now).saturating_add(CLOCK_TOLERANCE)))
        .or(archives.first());
    let matches_newest = newest.and_then(|a| a.print.as_deref()) == Some(short.as_str());

    let mut damaged: Option<(String, String)> = None;
    if let Some(newest) = newest.filter(|_| matches_newest) {
        match confirm(newest, &plan.print) {
            Ok(digest) if holding >= copies => {
                // Nothing to write. Pruning still runs, so a `keep` the writer
                // just lowered takes effect now rather than waiting for the
                // next edit.
                let pruned = prune_in(dir, &title, keep, Some(&newest.name), unix(now))?;
                let mut archive = newest.clone();
                // The message says the copy was read back in full, so the
                // evidence that it was travels with it.
                archive.sha256 = Some(digest);
                return Ok(Written::Same { archive, pruned: pruned.removed, held: pruned.held });
            }
            Ok(_) => {}
            Err(reason) => damaged = Some((reason, newest.name.clone())),
        }
    }

    let (archive, pruned) = write_archive(dir, &title, now, keep, plan, ctx)?;
    let Pruned { removed: pruned, held } = pruned;
    Ok(match damaged {
        Some((reason, name)) => Written::Repaired { archive, pruned, held, reason, damaged: name },
        None if matches_newest => Written::Copy { archive, pruned, held },
        None => Written::Fresh { archive, pruned, held },
    })
}

/// Is the archive on disk really the state its name claims, and is it whole?
///
/// The name carries sixteen hex digits; the archive's own comment carries all
/// sixty-four. Confirming the long form costs nothing, because the file has to
/// be opened to verify it anyway, and it is what makes the short form in the
/// name safe to rely on at all.
///
/// An archive whose name matches but which cannot be opened, or whose comment
/// no longer agrees, is reported rather than quietly written past: something
/// rewrote the file the writer is counting on.
fn confirm(newest: &Archive, print: &str) -> Result<String, String> {
    let path = Path::new(&newest.path);
    let file = fs::File::open(path).map_err(|_| code::UNREADABLE.to_string())?;
    let zip = zip::ZipArchive::new(file).map_err(|_| code::UNREADABLE.to_string())?;
    let comment = String::from_utf8_lossy(zip.comment()).into_owned();
    if comment != print {
        return Err(code::CORRUPT.into());
    }
    drop(zip);
    verify(path)
}

/// Build the archive under a temporary name and rename it once complete, so a
/// sync client never uploads a half-written zip and a crash mid-backup leaves
/// nothing that looks restorable.
fn write_archive(
    dir: &Path,
    title: &str,
    now: std::time::SystemTime,
    keep: usize,
    plan: &Plan,
    ctx: &RunCtx,
) -> Result<(Archive, Pruned), String> {
    // Registered before the file exists, so no sweep takes it for a leftover.
    let run = ActiveRun::start();
    // Whose computer, which process, which run. With the process id alone, two
    // runs in one process, or two computers writing one synced folder, shared
    // one file: `File::create` truncated the other's half-written archive.
    let part = names::part_name(&slug(title), &ctx.host, ctx.pid, run.0);
    #[cfg(test)]
    let part = if hooks::PID_ONLY_PART.get() { format!("{PREFIX}-{}-{}.part", slug(title), ctx.pid) } else { part };
    let partial = dir.join(part);

    let file = fs::File::create(&partial).map_err(|e| write_code(&e).to_string())?;
    let packed = match pack(zip::ZipWriter::new(file), &plan.entries) {
        Ok(packed) => packed,
        Err(e) => {
            let _ = fs::remove_file(&partial);
            return Err(e);
        }
    };

    // Named from what was packed, not from the plan: a save landing mid-backup
    // makes the two differ, and the name should describe these bytes.
    let (name, final_path) = match free_name(dir, title, now, &packed) {
        Ok(found) => found,
        Err(e) => {
            let _ = fs::remove_file(&partial);
            return Err(e);
        }
    };
    #[cfg(test)]
    hooks::before_rename(&final_path);
    if let Err(e) = fs::rename(&partial, &final_path) {
        let _ = fs::remove_file(&partial);
        return Err(write_code(&e).into());
    }

    // Before pruning, so a destination that cannot hold this archive does not
    // also lose the older ones that were fine.
    #[cfg(test)]
    hooks::before_verify(&final_path);
    let digest = match verify(&final_path) {
        Ok(digest) => digest,
        Err(e) => {
            let _ = fs::remove_file(&final_path);
            // Gone straight after its own rename: the disk went with it.
            return Err(if e == code::NOT_FOUND { code::DEST_MISSING.into() } else { e });
        }
    };

    let bytes = fs::metadata(&final_path).map(|m| m.len()).unwrap_or(0);
    let pruned = prune_in(dir, title, keep, Some(&name), unix(now))?;

    Ok((
        Archive {
            path: final_path.to_string_lossy().into_owned(),
            stamped: stamped_in_name(&name),
            print: print_in_name(&name).map(str::to_string),
            name,
            bytes,
            modified: unix(now),
            sha256: Some(digest),
        },
        pruned,
    ))
}

/// One destination, walking and hashing the project itself.
///
/// The app never calls this: `backup_now` plans once and hands the same plan to
/// every destination, so a large novel is read once per press rather than once
/// per folder. This is here for tests about a single destination.
#[cfg(test)]
pub fn create_in(
    project: &Path,
    dir: &Path,
    keep: usize,
    now: std::time::SystemTime,
) -> Result<Written, String> {
    let plan = plan(project)?;
    create_planned(project, dir, keep, now, &plan, &RunCtx::for_tests())
}

/// Read a file back and hash it.
///
/// Deliberately reopened rather than hashed while writing: the point is to
/// learn what the destination will hand back, which is the only durability
/// signal a network share or a sync folder gives at all. It proves the
/// filesystem agrees, not that the platters do — say "verified", not "safe".
fn hash_of(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| read_back_code(&e).to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|_| code::UNREADABLE.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex(&hasher.finalize()))
}

/// Opening an archive to read it back failed. A file that is gone is not
/// a damaged one; the caller decides what its absence means.
fn read_back_code(error: &std::io::Error) -> &'static str {
    if error.kind() == std::io::ErrorKind::NotFound {
        code::NOT_FOUND
    } else {
        code::UNREADABLE
    }
}

/// Lowercase hex, the only form any of this compares against.
fn hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::with_capacity(bytes.len() * 2), |mut out, byte| {
        use std::fmt::Write;
        let _ = write!(out, "{byte:02x}");
        out
    })
}

/// Confirm an archive is there, complete and extractable.
///
/// Two checks, because they catch different things. The hash proves the bytes
/// round-tripped — it is what catches a lying network share, a full disk that
/// truncated silently, and a failing USB controller. Walking every entry and
/// checking its CRC proves the *archive* is well-formed and could actually be
/// extracted, which is the thing the writer needs. A backup nobody verified is
/// a belief, not a backup.
pub fn verify(path: &Path) -> Result<String, String> {
    let digest = hash_of(path)?;
    let file = fs::File::open(path).map_err(|e| read_back_code(&e).to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| code::UNREADABLE.to_string())?;
    if zip.is_empty() {
        return Err(code::UNREADABLE.into());
    }
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|_| code::UNREADABLE.to_string())?;
        if entry.is_dir() {
            continue;
        }
        // Reading to a sink is what makes the zip crate check the CRC.
        std::io::copy(&mut entry, &mut std::io::sink()).map_err(|_| code::CORRUPT.to_string())?;
    }
    Ok(digest)
}

/// Extract an archive **beside** the original, never over it.
///
/// Restoring in place would be the one operation capable of destroying the work
/// it exists to protect — a writer reaching for a backup is already having a bad
/// day. The extracted copy is a normal project folder they can open and compare.
pub fn restore_beside(archive: &Path, parent: &Path, label: &str) -> Result<PathBuf, String> {
    let file = fs::File::open(archive).map_err(|_| code::NOT_FOUND.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| code::UNREADABLE.to_string())?;

    // Never overwrite: find a free name rather than merging into an existing
    // folder, where a half-restored project would be worse than no restore.
    let base = format!("{}-{label}", parent.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "novel".into()));
    let target_parent = parent.parent().ok_or_else(|| code::IO.to_string())?;
    let mut target = target_parent.join(&base);
    let mut attempt = 2;
    while target.exists() {
        target = target_parent.join(format!("{base}-{attempt}"));
        attempt += 1;
        if attempt > 100 {
            return Err(code::IO.into());
        }
    }
    fs::create_dir_all(&target).map_err(|_| code::IO.to_string())?;

    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|_| code::UNREADABLE.to_string())?;
        // `enclosed_name` is what refuses `../` entries; a crafted zip must not
        // be able to write outside the folder being restored into.
        let Some(relative) = entry.enclosed_name() else {
            return Err(code::UNREADABLE.into());
        };
        let out = target.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&out).map_err(|_| code::IO.to_string())?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|_| code::IO.to_string())?;
        }
        let mut sink = fs::File::create(&out).map_err(|_| code::IO.to_string())?;
        std::io::copy(&mut entry, &mut sink).map_err(|_| code::IO.to_string())?;
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
        let file = fs::File::open(&archive.archive().path).unwrap();
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
        let file = fs::File::open(&archive.archive().path).unwrap();
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

        assert_eq!(prune_in(dest, "el-faro", 2, None, 1_790_553_600).unwrap().removed, 3);
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
        prune_in(tmp.path(), "n", 0, None, 1_790_553_600).unwrap();
        assert_eq!(list_in(tmp.path(), "n").unwrap().len(), 1);
    }

    #[test]
    fn restoring_never_writes_over_the_project_it_came_from() {
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("synced");
        let archive = create_in(&root, &dest, DEFAULT_KEEP, at(1_759_000_000)).unwrap();

        let restored = restore_beside(Path::new(&archive.archive().path), &root, "restored").unwrap();
        assert_ne!(restored, root, "restored over the original");
        assert_eq!(fs::read_to_string(restored.join("chapters/ch-01.md")).unwrap(), "La luz giraba sobre el agua.");
        assert!(restored.join(".git/HEAD").exists(), "restored without its history");
        // The original is untouched.
        assert!(root.join("chapters/ch-01.md").exists());

        // Restoring twice does not merge into the first copy.
        let again = restore_beside(Path::new(&archive.archive().path), &root, "restored").unwrap();
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
        let early = archive_name("El Faro", at(1_700_000_000), "0123456789abcdef");
        let late = archive_name("El Faro", at(1_759_000_000), "0123456789abcdef");
        assert!(early < late, "names must sort by time: {early} vs {late}");
        // Accents, spaces and punctuation cannot reach the filename.
        let awkward = archive_name("La Niña: ¿Dónde? / Parte 2", at(1_759_000_000), "0123456789abcdef");
        assert!(
            awkward.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.'),
            "unsafe filename: {awkward}"
        );
        assert!(awkward.starts_with(PREFIX));
        assert!(awkward.ends_with(".zip"));
        // An untitled project still produces a usable name.
        assert!(archive_name("", at(0), "0123456789abcdef").contains("novel"));
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
    fn an_archive_is_verified_before_it_is_called_a_backup() {
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("synced");
        let archive = create_in(&root, &dest, DEFAULT_KEEP, at(1_759_000_000)).unwrap();

        // The hash is of what the destination hands back, not of what we meant
        // to write.
        let digest = archive.archive().sha256.clone().expect("a written archive carries its hash");
        assert_eq!(digest.len(), 64);
        assert_eq!(verify(Path::new(&archive.archive().path)).unwrap(), digest);
    }

    #[test]
    fn a_truncated_archive_is_refused_rather_than_listed_as_a_backup() {
        // What a full disk or a lying network share produces. A zip that cannot
        // be walked is not a backup, and saying otherwise is the failure this
        // whole feature exists to prevent.
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("synced");
        let archive = create_in(&root, &dest, DEFAULT_KEEP, at(1_759_000_000)).unwrap();

        let bytes = fs::read(&archive.archive().path).unwrap();
        fs::write(&archive.archive().path, &bytes[..bytes.len() / 2]).unwrap();
        assert_eq!(verify(Path::new(&archive.archive().path)).unwrap_err(), "backup_unreadable");
    }

    #[test]
    fn a_destination_that_cannot_hold_the_archive_keeps_the_older_ones() {
        // Verification runs before pruning on purpose: a failed write must not
        // also cost the backups that were fine.
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("synced");
        for day in 1..=3 {
            // Edited between presses. Three identical presses would now produce
            // two archives, not three, and this test is about pruning rather
            // than about deduplication.
            fs::write(root.join("chapters/ch-01.md"), format!("Día {day}.")).unwrap();
            create_in(&root, &dest, DEFAULT_KEEP, at(1_759_000_000 + day * 86_400)).unwrap();
        }
        assert_eq!(list_in(&dest, "el-faro").unwrap().len(), 3);
    }

    #[test]
    fn a_listed_archive_does_not_claim_to_have_been_verified() {
        // Listing must not re-read gigabytes, so it reports no hash rather than
        // an unchecked one.
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("synced");
        create_in(&root, &dest, DEFAULT_KEEP, at(1_759_000_000)).unwrap();
        assert!(list_in(&dest, "el-faro").unwrap()[0].sha256.is_none());
    }

    #[test]
    fn a_hidden_directory_is_never_chosen_as_a_destination() {
        // Found against a real Google Drive: its root is read-only and `.Trash`
        // sorts before `Mi unidad`, so the first writable child was the trash.
        // Backups written there get deleted, which is worse than none.
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("readonly-root");
        fs::create_dir_all(root.join(".Trash")).unwrap();
        fs::create_dir_all(root.join("Mi unidad")).unwrap();
        assert_eq!(writable_child(&root), Some(root.join("Mi unidad")));
    }

    #[test]
    fn a_directory_that_refuses_writes_is_not_offered() {
        // `is_dir()` is not enough: Google Drive's root is a real directory
        // that rejects every write.
        let tmp = tempfile::tempdir().unwrap();
        let good = tmp.path().join("good");
        fs::create_dir_all(&good).unwrap();
        assert!(writable(&good));
        assert!(!writable(&tmp.path().join("absent")));

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let locked = tmp.path().join("locked");
            fs::create_dir_all(&locked).unwrap();
            fs::set_permissions(&locked, fs::Permissions::from_mode(0o500)).unwrap();
            assert!(!writable(&locked), "a read-only directory was offered");
            // Leave it removable by the tempdir teardown.
            fs::set_permissions(&locked, fs::Permissions::from_mode(0o700)).unwrap();
        }
    }

    #[test]
    fn the_probe_leaves_nothing_behind() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(writable(tmp.path()));
        let leftovers: Vec<String> = fs::read_dir(tmp.path())
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(leftovers.is_empty(), "the write probe was not cleaned up: {leftovers:?}");
    }

    #[test]
    fn dropbox_is_read_from_its_own_record_rather_than_guessed() {
        // `~/Dropbox` is wrong for anybody who moved it, and Dropbox writes the
        // real answer into info.json.
        let tmp = tempfile::tempdir().unwrap();
        let moved = tmp.path().join("Somewhere Else");
        fs::create_dir_all(&moved).unwrap();
        fs::create_dir_all(tmp.path().join(".dropbox")).unwrap();
        fs::write(
            tmp.path().join(".dropbox").join("info.json"),
            serde_json::to_vec(&serde_json::json!({
                "personal": { "path": moved.to_string_lossy(), "host": 1 }
            }))
            .unwrap(),
        )
        .unwrap();
        assert_eq!(dropbox_paths(tmp.path()), vec![moved]);

        // No file, no guess.
        let empty = tempfile::tempdir().unwrap();
        assert!(dropbox_paths(empty.path()).is_empty());
    }

    #[test]
    fn a_nextcloud_config_yields_every_folder_it_syncs() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join(".config").join("Nextcloud");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("nextcloud.cfg"),
            "[Accounts]\n0\\Folders\\1\\localPath=/home/ana/Nextcloud/\n\
             0\\Folders\\2\\localPath=/home/ana/Novelas/\n",
        )
        .unwrap();
        let found = sync_client_paths(tmp.path(), "nextcloud.cfg", "Nextcloud");
        assert_eq!(found.len(), 2, "{found:?}");
        assert!(found.contains(&PathBuf::from("/home/ana/Novelas/")));
    }

    #[test]
    fn destinations_are_reported_even_when_absent() {
        // Every entry names a kind the UI can translate, and a path.
        for destination in destinations() {
            assert!(!destination.kind.is_empty());
            assert!(!destination.path.is_empty());
            if destination.available {
                assert!(Path::new(&destination.path).is_dir());
            }
        }
    }

    #[test]
    fn two_folders_on_one_disk_are_not_two_media() {
        // The mistake 3-2-1 exists to prevent: a second copy that dies with the
        // first. Both temp folders are on whatever volume the test runs on.
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("novel");
        let a = tmp.path().join("a");
        let b = tmp.path().join("b");
        for dir in [&project, &a, &b] {
            std::fs::create_dir_all(dir).unwrap();
        }

        let c = super::coverage_with(&project, &[a.clone(), b.clone()], &[]);
        assert_eq!(c.copies, 3, "the novel counts as one");
        assert_eq!(c.media, Some(1), "three copies, one disk");
        assert!(!c.offsite, "a plain folder does not leave the machine");
        assert_eq!(
            c.on_the_novels_disk.len(),
            2,
            "both share the novel's disk and the writer should be told"
        );
    }

    #[test]
    fn a_destination_that_cannot_be_placed_makes_the_count_unknown_not_optimistic() {
        // Reporting "2 media" because one volume could not be read would be the
        // one lie this whole feature exists to avoid.
        let tmp = tempfile::tempdir().unwrap();
        let project = tmp.path().join("novel");
        std::fs::create_dir_all(&project).unwrap();
        let missing = tmp.path().join("unplugged");

        let c = super::coverage_with(&project, &[missing], &[]);
        assert_eq!(c.media, None);
        assert!(c.on_the_novels_disk.is_empty(), "a disk nobody can see is not this one");
    }

    #[test]
    fn a_second_disk_is_a_copy_but_not_an_offsite_one() {
        // Both halves matter: the UI says "survives a dead drive" and must not
        // say "survives a fire".
        assert!(!super::is_offsite("disk"));
        assert!(!super::is_offsite("folder"));
        for kind in ["icloud", "dropbox", "onedrive", "nextcloud", "mega"] {
            assert!(super::is_offsite(kind), "{kind} syncs off this machine");
        }
    }

    #[test]
    fn a_volume_id_is_stable_for_one_disk_and_absent_for_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        let a = tmp.path().join("a");
        let b = tmp.path().join("b");
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        assert_eq!(super::volume_of(&a), super::volume_of(&b));
        assert!(super::volume_of(&a).is_some(), "the test host has a filesystem");
        assert_eq!(super::volume_of(&tmp.path().join("nope")), None);
    }

    #[test]
    fn pressing_again_with_nothing_changed_writes_no_third_copy() {
        // THE REPORTED BUG. Three presses in under a minute produced three
        // identical archives, each one eating a slot of "keep the newest ten" —
        // so ten presses would evict ten real states of the novel and leave a
        // window that covers sixty seconds of nothing.
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("icloud");

        let first = create_in(&root, &dest, DEFAULT_KEEP, at(1_759_000_000)).unwrap();
        let second = create_in(&root, &dest, DEFAULT_KEEP, at(1_759_000_005)).unwrap();
        let third = create_in(&root, &dest, DEFAULT_KEEP, at(1_759_000_010)).unwrap();

        assert!(matches!(first, Written::Fresh { .. }));
        assert!(matches!(second, Written::Copy { .. }), "one file is one file");
        assert!(matches!(third, Written::Same { .. }), "and there it stops");
        assert_eq!(list_in(&dest, "el-faro").unwrap().len(), 2);

        // The press that wrote nothing still read the newest back in full —
        // that is the only proof it can offer for saying the copy is intact.
        assert!(third.archive().sha256.is_some());
    }

    #[test]
    fn an_edited_chapter_is_always_a_new_archive_even_a_second_later() {
        // The skip must never swallow a real change.
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("icloud");
        create_in(&root, &dest, DEFAULT_KEEP, at(1_759_000_000)).unwrap();

        fs::write(root.join("chapters/ch-01.md"), "Otra cosa.").unwrap();
        let after = create_in(&root, &dest, DEFAULT_KEEP, at(1_759_000_001)).unwrap();

        assert!(matches!(after, Written::Fresh { .. }));
        let listed = list_in(&dest, "el-faro").unwrap();
        assert_eq!(listed.len(), 2);
        assert_ne!(listed[0].print, listed[1].print, "a different state, a different name");
    }

    #[test]
    fn a_revert_to_an_older_state_is_still_a_new_archive() {
        // Compared against the NEWEST only. Matching against any archive in the
        // folder would leave the newest file holding B while the app claimed
        // the novel was already backed up.
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("icloud");
        let chapter = root.join("chapters/ch-01.md");
        let original = fs::read(&chapter).unwrap();

        create_in(&root, &dest, DEFAULT_KEEP, at(1_759_000_000)).unwrap();
        fs::write(&chapter, "Estado B.").unwrap();
        create_in(&root, &dest, DEFAULT_KEEP, at(1_759_000_100)).unwrap();
        fs::write(&chapter, original).unwrap();
        let back = create_in(&root, &dest, DEFAULT_KEEP, at(1_759_000_200)).unwrap();

        assert!(matches!(back, Written::Fresh { .. }));
        assert_eq!(list_in(&dest, "el-faro").unwrap().len(), 3);
    }

    #[test]
    fn keeping_only_one_does_not_write_a_second_copy_just_to_delete_it() {
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("icloud");
        create_in(&root, &dest, 1, at(1_759_000_000)).unwrap();
        let again = create_in(&root, &dest, 1, at(1_759_000_005)).unwrap();

        assert!(matches!(again, Written::Same { .. }));
        assert_eq!(list_in(&dest, "el-faro").unwrap().len(), 1);
    }

    #[test]
    fn the_fingerprint_does_not_depend_on_the_order_the_filesystem_lists_files_in() {
        // `fs::read_dir` is unordered. In the archives that produced this
        // change, `research/` came before `manuscript/`.
        let tmp = tempfile::tempdir().unwrap();
        let a = tmp.path().join("a");
        let b = tmp.path().join("b");
        for (root, order) in [(&a, ["uno", "dos", "tres"]), (&b, ["tres", "dos", "uno"])] {
            fs::create_dir_all(root.join("chapters")).unwrap();
            for name in order {
                fs::write(root.join("chapters").join(format!("{name}.md")), name).unwrap();
            }
        }
        assert_eq!(plan(&a).unwrap().print, plan(&b).unwrap().print);
    }

    #[test]
    fn what_the_fingerprint_hashed_is_exactly_what_the_archive_holds() {
        // Non-negotiable. If the hashing walk and the packing walk ever drift,
        // the app says "nothing has changed" about a file it never looked at.
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("icloud");
        let planned = plan(&root).unwrap();
        let written =
            create_planned(&root, &dest, DEFAULT_KEEP, at(1_759_000_000), &planned, &RunCtx::for_tests()).unwrap();

        let file = fs::File::open(&written.archive().path).unwrap();
        let zip = zip::ZipArchive::new(file).unwrap();
        let packed: std::collections::HashSet<String> =
            zip.file_names().map(|n| n.trim_end_matches('/').to_string()).collect();
        let hashed: std::collections::HashSet<String> =
            planned.entries.iter().map(|e| e.inside.clone()).collect();
        assert_eq!(packed, hashed);
    }

    #[test]
    fn an_archive_written_before_fingerprints_existed_is_never_a_match() {
        // Cannot tell means write.
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("icloud");
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join("versorium-backup-el-faro-2026-01-01-120000.zip"), b"old").unwrap();

        let listed = list_in(&dest, "el-faro").unwrap();
        assert_eq!(listed[0].print, None);
        let written = create_in(&root, &dest, DEFAULT_KEEP, at(1_759_000_000)).unwrap();
        assert!(matches!(written, Written::Fresh { .. }));
    }

    #[test]
    fn a_title_that_looks_like_a_fingerprint_cannot_forge_one() {
        // `slug` maps every non-alphanumeric to a dash, so a novel can put
        // sixteen hex characters in a filename on its own. Only the six-digit
        // stamp immediately before them proves the app put them there.
        assert_eq!(
            print_in_name("versorium-backup-caso-0123456789abcdef.zip"),
            None,
            "no stamp in front of it"
        );
        assert_eq!(
            print_in_name("versorium-backup-x-2026-09-29-061321-0123456789abcdef.zip"),
            Some("0123456789abcdef")
        );
        assert_eq!(print_in_name("versorium-backup-x-2026-09-29-061321.zip"), None);
        assert_eq!(
            print_in_name("versorium-backup-x-2026-09-29-061321-0123456789ABCDEF.zip"),
            None,
            "lowercase is the only form anything writes"
        );
    }

    #[test]
    fn two_presses_in_the_same_second_do_not_overwrite_each_other() {
        // A present-tense data-loss bug in shipped code: `archive_name` has
        // one-second resolution and `fs::rename` replaces silently, so the
        // first verified snapshot was simply destroyed.
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("icloud");
        let same_second = at(1_759_000_000);

        create_in(&root, &dest, DEFAULT_KEEP, same_second).unwrap();
        fs::write(root.join("chapters/ch-01.md"), "Cambiado dentro del mismo segundo.").unwrap();
        create_in(&root, &dest, DEFAULT_KEEP, same_second).unwrap();

        assert_eq!(list_in(&dest, "el-faro").unwrap().len(), 2);
    }

    #[test]
    fn the_number_kept_still_takes_effect_when_nothing_changed() {
        // Pruning runs on the skip path too, so lowering the count acts on the
        // next press rather than waiting for the next edit — and it is
        // reported, so the UI can name the deletion instead of saying nothing
        // happened.
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("icloud");
        for day in 0..6 {
            fs::write(root.join("chapters/ch-01.md"), format!("Día {day}.")).unwrap();
            create_in(&root, &dest, DEFAULT_KEEP, at(1_759_000_000 + day * 86_400)).unwrap();
        }
        assert_eq!(list_in(&dest, "el-faro").unwrap().len(), 6);
        // The second copy of the current state, so the next press has nothing
        // left to write.
        create_in(&root, &dest, DEFAULT_KEEP, at(1_759_900_000)).unwrap();
        assert_eq!(list_in(&dest, "el-faro").unwrap().len(), 7);

        let quiet = create_in(&root, &dest, 3, at(1_759_999_999)).unwrap();
        assert!(matches!(quiet, Written::Same { .. }), "nothing to write");
        assert_eq!(quiet.pruned(), 4, "and it says how many it removed");
        assert_eq!(list_in(&dest, "el-faro").unwrap().len(), 3);
    }

    #[test]
    fn a_save_temp_never_enters_an_archive() {
        // `storage::atomic_write` parks one of these beside the file it is
        // replacing. One caught mid-flight would enter the archive as a phantom
        // and make an untouched novel look changed on the next press.
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let before = plan(&root).unwrap().print;
        fs::write(root.join(".versorium-save-1-0.tmp"), b"half a chapter").unwrap();
        assert_eq!(plan(&root).unwrap().print, before);
    }

    #[test]
    fn a_damaged_newest_archive_is_replaced_and_the_bad_one_left_where_it_is() {
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("icloud");
        create_in(&root, &dest, DEFAULT_KEEP, at(1_759_000_000)).unwrap();
        create_in(&root, &dest, DEFAULT_KEEP, at(1_759_000_005)).unwrap();

        let newest = list_in(&dest, "el-faro").unwrap()[0].clone();
        fs::write(&newest.path, b"not a zip any more").unwrap();

        let after = create_in(&root, &dest, DEFAULT_KEEP, at(1_759_000_010)).unwrap();
        match after {
            Written::Repaired { damaged, .. } => assert_eq!(damaged, newest.name),
            other => panic!("expected Repaired, got {other:?}"),
        }
        // Not deleted on a guess: it ages out through pruning like anything else.
        assert!(Path::new(&newest.path).exists());
    }

    #[test]
    fn a_restored_chapter_keeps_the_date_it_was_written_on() {
        // Rather than the instant somebody pressed a button.
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("icloud");
        let when = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000);
        fs::File::options()
            .write(true)
            .open(root.join("chapters/ch-01.md"))
            .unwrap()
            .set_modified(when)
            .unwrap();

        let written = create_in(&root, &dest, DEFAULT_KEEP, at(1_759_000_000)).unwrap();
        let file = fs::File::open(&written.archive().path).unwrap();
        let mut zip = zip::ZipArchive::new(file).unwrap();
        let entry = zip.by_name("chapters/ch-01.md").unwrap();
        let stamped = entry.last_modified().expect("a real timestamp");
        assert_eq!(stamped.year(), 2023, "the file's own date, not the backup's");
    }

    #[test]
    fn the_time_shown_comes_from_the_name_rather_than_an_mtime_a_client_rewrites() {
        // One press gave the reporter 1:13:16 in one folder and 1:13:17 in
        // another. Those were never two backups; they were two mtimes.
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("icloud");
        let asked = 1_759_000_000u64;
        create_in(&root, &dest, DEFAULT_KEEP, at(asked)).unwrap();

        let listed = list_in(&dest, "el-faro").unwrap();
        assert_eq!(listed[0].stamped, Some(asked));
    }

    // --- Phase 0: what lost or tore a backup before, and what proves it no longer does ---

    /// 2026-09-28T00:00:00Z.
    const DAY: u64 = 1_790_553_600;

    fn names_in(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    fn edit(root: &Path, text: &str) {
        fs::write(root.join("chapters/ch-01.md"), text).unwrap();
    }

    #[test]
    fn two_novels_whose_names_start_alike_never_prune_each_other() {
        // `el-faro` and `el-faro-del-norte` back up into one folder. The old
        // prefix match listed the second's archives as the first's, sorted them
        // as the newest, and pruned with them.
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("icloud");
        let short = project(tmp.path(), "el-faro");
        let long = project(tmp.path(), "el-faro-del-norte");
        for state in 0..3 {
            edit(&long, &format!("Norte {state}."));
            create_in(&long, &dest, DEFAULT_KEEP, at(DAY + state * 3600)).unwrap();
        }
        let theirs: Vec<(String, Vec<u8>)> = list_in(&dest, "el-faro-del-norte")
            .unwrap()
            .into_iter()
            .map(|a| (a.name, fs::read(&a.path).unwrap()))
            .collect();
        assert_eq!(theirs.len(), 3);

        for run in 0..10 {
            edit(&short, &format!("Faro {run}."));
            let written = create_in(&short, &dest, 2, at(DAY + 86_400 + run * 60)).unwrap();
            assert!(matches!(written, Written::Fresh { .. }), "run {run}: {written:?}");
        }
        // And an unchanged novel is recognised: its newest archive is its own.
        let again = create_in(&short, &dest, 2, at(DAY + 2 * 86_400)).unwrap();
        assert!(matches!(again, Written::Copy { .. }), "{again:?}");
        let quiet = create_in(&short, &dest, 2, at(DAY + 2 * 86_400 + 60)).unwrap();
        assert!(matches!(quiet, Written::Same { .. }), "{quiet:?}");

        assert_eq!(list_in(&dest, "el-faro").unwrap().len(), 2);
        for (name, bytes) in &theirs {
            let now = fs::read(dest.join(name)).unwrap_or_default();
            assert!(now == *bytes, "{name}, another novel's backup, was deleted or changed");
        }
    }

    #[test]
    fn a_clock_set_back_keeps_the_archive_it_just_wrote_and_deletes_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("icloud");
        let tomorrow = DAY + 86_400;
        for state in 0..10 {
            edit(&root, &format!("Mañana {state}."));
            create_in(&root, &dest, DEFAULT_KEEP, at(tomorrow + state * 60)).unwrap();
        }
        let before = names_in(&dest);

        edit(&root, "Hoy, con el reloj un día atrás.");
        let written = create_in(&root, &dest, DEFAULT_KEEP, at(DAY)).unwrap();
        assert!(matches!(written, Written::Fresh { .. }), "{written:?}");
        let path = Path::new(&written.archive().path);
        assert!(path.exists(), "the archive it had just verified was deleted");
        assert_eq!(verify(path).unwrap(), written.archive().sha256.clone().unwrap());
        assert_eq!(written.pruned(), 0);
        assert_eq!(written.held(), Some(&Held::ClockBehind { stamp: tomorrow + 9 * 60 }));
        for name in &before {
            assert!(dest.join(name).exists(), "{name} was pruned while the clock was behind it");
        }
    }

    #[test]
    fn control_keeping_the_newest_by_name_deleted_the_archive_just_written() {
        // The same folder through the pruning this replaced: today's archive
        // sorts after ten of tomorrow's, so "keep the newest ten" deletes it.
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("icloud");
        for state in 0..10 {
            edit(&root, &format!("Mañana {state}."));
            create_in(&root, &dest, DEFAULT_KEEP, at(DAY + 86_400 + state * 60)).unwrap();
        }
        edit(&root, "Hoy, con el reloj un día atrás.");
        let written = create_in(&root, &dest, DEFAULT_KEEP, at(DAY)).unwrap();
        assert_eq!(prune_newest_legacy(&dest, "el-faro", DEFAULT_KEEP).unwrap(), 1);
        assert!(!Path::new(&written.archive().path).exists(), "control: the old rule kept it");
    }

    #[test]
    fn the_archive_just_written_outlives_one_stamped_a_few_minutes_ahead() {
        // Another Mac's clock five minutes ahead is normal, not a clock
        // problem, so pruning runs; it just never takes the new archive.
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("icloud");
        let ahead = create_in(&root, &dest, 1, at(DAY + 300)).unwrap();
        edit(&root, "Escrito en este Mac.");
        let written = create_in(&root, &dest, 1, at(DAY)).unwrap();
        assert!(Path::new(&written.archive().path).exists(), "the new archive was pruned");
        assert!(!Path::new(&ahead.archive().path).exists(), "keep is 1");
        assert_eq!(written.pruned(), 1);
        assert_eq!(written.held(), None);
    }

    /// A novel with real history, made by the app's own git code.
    fn repo_project(dir: &Path, name: &str) -> PathBuf {
        let root = dir.join(name);
        fs::create_dir_all(root.join("manuscript")).unwrap();
        fs::write(root.join("manuscript/ch-01.md"), "La luz giraba sobre el agua.\n").unwrap();
        crate::git::repo::init_with_commit(&root).unwrap();
        checkpoint(&root, "Y el mar callaba.\n");
        root
    }

    /// What the 60-second checkpoint does: a chapter changes, everything is
    /// committed.
    fn checkpoint(root: &Path, line: &str) {
        add_line(root, line);
        crate::git::repo::commit_all(root, "checkpoint: autosave").unwrap();
    }

    /// The same commit by a writer that never takes the repository lock, such
    /// as `git` run by hand: the only kind that can land inside a capture.
    fn commit_by_hand(root: &Path, line: &str) {
        add_line(root, line);
        crate::git::repo::commit_ignoring_the_lock(root, "by hand").unwrap();
    }

    fn add_line(root: &Path, line: &str) {
        let chapter = root.join("manuscript/ch-01.md");
        let mut text = fs::read_to_string(&chapter).unwrap();
        text.push_str(line);
        fs::write(&chapter, text).unwrap();
    }

    /// `plan`, with `between` run while the capture holds the history.
    fn plan_holding(root: &Path, order: Order, between: &mut dyn FnMut()) -> Plan {
        plan_with(root, order, Wait::TryOnly, between).unwrap()
    }

    /// Pack a plan into a destination and restore it beside the novel.
    fn pack_and_restore(root: &Path, plan: &Plan) -> PathBuf {
        let dest = root.parent().unwrap().join("synced");
        let written = create_planned(root, &dest, DEFAULT_KEEP, at(DAY), plan, &RunCtx::for_tests()).unwrap();
        restore_beside(Path::new(&written.archive().path), root, "restored").unwrap()
    }

    /// Every object the restored history needs and does not hold: what HEAD
    /// and every ref name, every ancestor, every tree and file they reach, and
    /// every entry of the index.
    fn missing_objects(restored: &Path) -> Vec<String> {
        let repo = git2::Repository::open(restored).expect("the restored copy opens as a repository");
        let odb = repo.odb().unwrap();
        let mut missing = Vec::new();
        let mut tips = Vec::new();
        match repo.refname_to_id("HEAD") {
            Ok(oid) => tips.push(("HEAD".to_string(), oid)),
            Err(e) => missing.push(format!("HEAD: {e}")),
        }
        for reference in repo.references().unwrap().flatten() {
            if let Some(oid) = reference.target() {
                tips.push((reference.name().unwrap_or("?").to_string(), oid));
            }
        }
        let mut walk = repo.revwalk().unwrap();
        for (name, oid) in &tips {
            if odb.exists(*oid) {
                walk.push(*oid).unwrap();
            } else {
                missing.push(format!("{name} names {oid}, which the archive does not hold"));
            }
        }
        for oid in walk {
            let commit = match oid.and_then(|oid| repo.find_commit(oid)) {
                Ok(commit) => commit,
                Err(e) => {
                    missing.push(format!("history: {e}"));
                    continue;
                }
            };
            match commit.tree() {
                Ok(tree) => {
                    tree.walk(git2::TreeWalkMode::PreOrder, |_, entry| {
                        if !odb.exists(entry.id()) {
                            missing.push(format!("{} in {}", entry.name().unwrap_or("?"), commit.id()));
                        }
                        git2::TreeWalkResult::Ok
                    })
                    .unwrap();
                }
                Err(e) => missing.push(format!("tree of {}: {e}", commit.id())),
            }
        }
        for entry in repo.index().unwrap().iter() {
            if !odb.exists(entry.id) {
                missing.push(format!("index: {}", String::from_utf8_lossy(&entry.path)));
            }
        }
        missing
    }

    #[test]
    fn a_commit_during_a_backup_never_tears_the_archived_history() {
        // The two windows a commit used to tear the archive in: between the
        // two halves of the capture (only a writer that ignores the lock can
        // land there), and after the plan, before packing.
        let tmp = tempfile::tempdir().unwrap();
        let root = repo_project(tmp.path(), "el-faro");
        let plan = plan_holding(&root, Order::FreezeFirst, &mut || commit_by_hand(&root, "Un barco.\n"));
        checkpoint(&root, "Otro barco.\n");
        let restored = pack_and_restore(&root, &plan);
        assert_eq!(missing_objects(&restored), Vec::<String>::new());
    }

    #[test]
    fn control_the_walk_this_replaced_archived_a_head_that_names_nothing() {
        // Today's bug, reproduced: everything listed in one walk and read at
        // pack time, so the refs come from after the commit and its objects
        // were never listed. `git log` in the restored copy: bad object HEAD.
        let tmp = tempfile::tempdir().unwrap();
        let root = repo_project(tmp.path(), "el-faro");
        let plan = plan_unfrozen(&root).unwrap();
        checkpoint(&root, "Un barco.\n");
        let missing = missing_objects(&pack_and_restore(&root, &plan));
        assert!(missing.iter().any(|m| m.starts_with("HEAD names")), "control: nothing was torn: {missing:?}");
    }

    #[test]
    fn control_reading_the_objects_before_the_refs_tears_it_too() {
        // The order is the mechanism, not the freezing alone: freeze the refs
        // after listing the objects, commit in between, and HEAD names a
        // commit the list never held.
        let tmp = tempfile::tempdir().unwrap();
        let root = repo_project(tmp.path(), "el-faro");
        let plan = plan_holding(&root, Order::ObjectsFirst, &mut || commit_by_hand(&root, "Un barco.\n"));
        let missing = missing_objects(&pack_and_restore(&root, &plan));
        assert!(missing.iter().any(|m| m.starts_with("HEAD names")), "control: nothing was torn: {missing:?}");
    }

    #[test]
    fn a_stale_lock_never_reaches_a_restored_copy() {
        // What a commit that crashed halfway leaves behind. Restored with it,
        // the copy refuses every commit until somebody deletes it by hand.
        let tmp = tempfile::tempdir().unwrap();
        let root = repo_project(tmp.path(), "el-faro");
        fs::write(root.join(".git/index.lock"), b"").unwrap();
        let restored = pack_and_restore(&root, &plan(&root).unwrap());
        assert!(!restored.join(".git/index.lock").exists(), "the lock was archived");
        fs::write(restored.join("manuscript/ch-01.md"), "Escrito después de restaurar.\n").unwrap();
        crate::git::repo::commit_all(&restored, "after restore").expect("the restored copy cannot commit");
    }

    #[test]
    fn control_with_the_lock_archived_the_restored_copy_cannot_commit() {
        let tmp = tempfile::tempdir().unwrap();
        let root = repo_project(tmp.path(), "el-faro");
        fs::write(root.join(".git/index.lock"), b"").unwrap();
        let restored = pack_and_restore(&root, &plan_unfrozen(&root).unwrap());
        fs::write(restored.join("manuscript/ch-01.md"), "Escrito después de restaurar.\n").unwrap();
        assert!(crate::git::repo::commit_all(&restored, "after restore").is_err(), "control: it committed");
    }

    #[test]
    fn an_archive_from_before_the_repository_was_frozen_still_matches() {
        // Upgrading must not make every unchanged novel look changed: the
        // fingerprint of a frozen file is the fingerprint of the file.
        let tmp = tempfile::tempdir().unwrap();
        let root = repo_project(tmp.path(), "el-faro");
        let dest = tmp.path().join("icloud");
        let before = plan_unfrozen(&root).unwrap();
        let after = plan(&root).unwrap();
        assert_eq!(after.print, before.print);

        let ctx = RunCtx::for_tests();
        let old = create_planned(&root, &dest, DEFAULT_KEEP, at(DAY), &before, &ctx).unwrap();
        assert!(matches!(old, Written::Fresh { .. }));
        let new = create_planned(&root, &dest, DEFAULT_KEEP, at(DAY + 5), &after, &ctx).unwrap();
        assert!(matches!(new, Written::Copy { .. }), "the upgrade wrote the same state as new: {new:?}");
    }

    #[test]
    fn two_runs_writing_one_folder_each_keep_their_own_file() {
        // Same computer, same process: B runs start to finish while A is
        // holding its temporary file half-written. With the process id alone
        // in the name, B's `File::create` truncated A's file and A then wrote
        // into the archive B had just verified. B's sweep must also know A's
        // file is live.
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("icloud");
        fs::create_dir_all(&dest).unwrap();
        let plan = plan(&root).unwrap();
        let ctx = RunCtx::for_tests();
        let (root, dest, plan, ctx) = (&root, &dest, &plan, &ctx);
        let (paused, a_is_paused) = std::sync::mpsc::channel::<()>();
        let (resume, a_may_resume) = std::sync::mpsc::channel::<()>();

        let (a, b) = std::thread::scope(|s| {
            let a = s.spawn(move || {
                let mut first = true;
                hooks::AFTER_ENTRY.with(|hook| {
                    *hook.borrow_mut() = Some(Box::new(move || {
                        if std::mem::take(&mut first) {
                            paused.send(()).unwrap();
                            let _ = a_may_resume.recv_timeout(std::time::Duration::from_secs(20));
                        }
                    }));
                });
                create_planned(root, dest, DEFAULT_KEEP, at(DAY), plan, ctx)
            });
            a_is_paused.recv_timeout(std::time::Duration::from_secs(20)).expect("A never started packing");
            let b = create_planned(root, dest, DEFAULT_KEEP, at(DAY), plan, ctx);
            resume.send(()).unwrap();
            (a.join().unwrap(), b)
        });

        let a = a.expect("A failed");
        let b = b.expect("B failed");
        assert_ne!(a.archive().name, b.archive().name);
        for written in [&a, &b] {
            let path = Path::new(&written.archive().path);
            assert_eq!(verify(path).unwrap(), written.archive().sha256.clone().unwrap(), "{path:?} was damaged");
        }
        let names = names_in(dest);
        assert!(names.iter().all(|n| n.ends_with(".zip")), "a temporary file was left: {names:?}");
    }

    /// The id of a process that has ended.
    #[cfg(unix)]
    fn dead_pid() -> u32 {
        let mut child = std::process::Command::new("true").spawn().unwrap();
        let pid = child.id();
        child.wait().unwrap();
        pid
    }

    #[cfg(unix)]
    #[test]
    fn a_process_that_has_ended_is_not_running_and_a_live_one_is() {
        assert!(pid_alive(std::process::id()));
        assert!(pid_alive(std::os::unix::process::parent_id()));
        assert!(!pid_alive(dead_pid()));
    }

    #[cfg(unix)]
    #[test]
    fn the_sweep_removes_only_what_nobody_can_still_be_writing() {
        const HOUR: u64 = 3600;
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let ctx = RunCtx::for_tests();
        let live = ActiveRun::start();
        let (me, dead, alive) = (ctx.pid, dead_pid(), std::os::unix::process::parent_id());
        let other = "ffffffffff";
        let part = |slug: &str, host: &str, pid: u32, run: u64| names::part_name(slug, host, pid, run);
        const DAYS: u64 = 24 * HOUR;
        let files: Vec<(String, u64, bool)> = vec![
            // (name, age, still there afterwards)
            (part("el-faro", &ctx.host, dead, 1), HOUR, false),
            (part("el-faro", &ctx.host, alive, 2), HOUR, true),
            (part("el-faro", &ctx.host, alive, 7), 23 * HOUR, true),
            (part("el-faro", &ctx.host, alive, 3), 25 * HOUR, false),
            (part("el-faro", &ctx.host, me, live.0), HOUR, true),
            (part("el-faro", &ctx.host, me, u64::MAX - 1), HOUR, false),
            // Another computer's: its process ids mean nothing here, and it
            // waits out a week, to the hour.
            (part("el-faro", other, dead, 4), HOUR, true),
            (part("el-faro", other, dead, 8), 2 * DAYS, true),
            (part("el-faro", other, dead, 9), 7 * DAYS - HOUR, true),
            (part("el-faro", other, dead, 5), 7 * DAYS + HOUR, false),
            // Another novel's, however old and however dead.
            (part("el-faro-del-norte", &ctx.host, dead, 6), 30 * DAYS, true),
            ("versorium-backup-el-faro-del-norte-2026-01-01-120000.zip.part".into(), 30 * DAYS, true),
            // The two older names, which carry no host: a day.
            ("versorium-backup-el-faro-1234.part".into(), 25 * HOUR, false),
            ("versorium-backup-el-faro-1235.part".into(), 23 * HOUR, true),
            ("versorium-backup-el-faro-2026-01-01-120000.zip.part".into(), 25 * HOUR, false),
            ("versorium-backup-el-faro-2026-01-02-120000.zip.part".into(), 23 * HOUR, true),
            // Not temporary files at all.
            ("versorium-backup-el-faro-2026-01-01-120000-0123456789abcdef.zip".into(), 30 * DAYS, true),
            ("notes.part".into(), 30 * DAYS, true),
        ];
        let now = std::time::SystemTime::now();
        for (name, age, _) in &files {
            let path = dir.join(name);
            fs::write(&path, b"partial").unwrap();
            let when = now - std::time::Duration::from_secs(*age);
            fs::File::options().write(true).open(&path).unwrap().set_modified(when).unwrap();
        }

        let removed = sweep(dir, "el-faro", &ctx, unix(now));

        for (name, _, kept) in &files {
            assert_eq!(dir.join(name).exists(), *kept, "{name}: expected {}", if *kept { "kept" } else { "removed" });
        }
        assert_eq!(removed, files.iter().filter(|(_, _, kept)| !kept).count());
        drop(live);
    }

    #[cfg(unix)]
    #[test]
    fn control_judging_by_pid_alone_deleted_another_computers_live_file() {
        // Another Mac is an hour into writing this archive into the shared
        // folder. Its process id means nothing here, and is not running here.
        let tmp = tempfile::tempdir().unwrap();
        let ctx = RunCtx::for_tests();
        let theirs = tmp.path().join(names::part_name("el-faro", "ffffffffff", dead_pid(), 1));
        fs::write(&theirs, b"half an archive").unwrap();
        let an_hour_ago = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
        fs::File::options().write(true).open(&theirs).unwrap().set_modified(an_hour_ago).unwrap();
        let now = unix(std::time::SystemTime::now());

        assert_eq!(sweep(tmp.path(), "el-faro", &ctx, now), 0, "the host rule swept it");
        assert!(theirs.exists());
        assert_eq!(sweep_with(tmp.path(), "el-faro", &ctx, now, abandoned_by_pid_alone), 1);
        assert!(!theirs.exists(), "control: the pid rule kept it");
    }

    #[test]
    fn control_the_prefix_rule_pruned_the_other_novels_archives() {
        // The folder of `two_novels_whose_names_start_alike_never_prune_each_other`,
        // pruned for `el-faro` the way it was before names were read exactly:
        // `el-faro-del-norte` sorts after every date, so its archives counted
        // as el-faro's newest, and the rest went, its own included.
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("icloud");
        let short = project(tmp.path(), "el-faro");
        let long = project(tmp.path(), "el-faro-del-norte");
        for state in 0..3 {
            edit(&long, &format!("Norte {state}."));
            create_in(&long, &dest, DEFAULT_KEEP, at(DAY + state * 3600)).unwrap();
        }
        create_in(&short, &dest, DEFAULT_KEEP, at(DAY + 86_400)).unwrap();
        assert_eq!(prune_by_prefix_legacy(&dest, "el-faro", 2).unwrap(), 2);
        assert_eq!(list_in(&dest, "el-faro-del-norte").unwrap().len(), 2, "control: the other novel kept all three");
        assert!(list_in(&dest, "el-faro").unwrap().is_empty(), "control: el-faro kept its own");
    }

    #[test]
    fn control_with_the_process_id_alone_two_runs_damaged_each_other() {
        // `two_runs_writing_one_folder_each_keep_their_own_file`, with the
        // temporary name every run used before: B truncates A's file, renames
        // it into B's archive, and A goes on writing into that archive.
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("icloud");
        fs::create_dir_all(&dest).unwrap();
        let plan = plan(&root).unwrap();
        let ctx = RunCtx::for_tests();
        let (root, dest, plan, ctx) = (&root, &dest, &plan, &ctx);
        let (paused, a_is_paused) = std::sync::mpsc::channel::<()>();
        let (resume, a_may_resume) = std::sync::mpsc::channel::<()>();

        let (a, b) = std::thread::scope(|s| {
            let a = s.spawn(move || {
                hooks::PID_ONLY_PART.set(true);
                let mut first = true;
                hooks::AFTER_ENTRY.with(|hook| {
                    *hook.borrow_mut() = Some(Box::new(move || {
                        if std::mem::take(&mut first) {
                            paused.send(()).unwrap();
                            let _ = a_may_resume.recv_timeout(std::time::Duration::from_secs(20));
                        }
                    }));
                });
                create_planned(root, dest, DEFAULT_KEEP, at(DAY), plan, ctx)
            });
            a_is_paused.recv_timeout(std::time::Duration::from_secs(20)).expect("A never started packing");
            hooks::PID_ONLY_PART.set(true);
            let b = create_planned(root, dest, DEFAULT_KEEP, at(DAY), plan, ctx);
            hooks::PID_ONLY_PART.set(false);
            resume.send(()).unwrap();
            (a.join().unwrap(), b)
        });

        let intact = |written: &Result<Written, String>| {
            written.as_ref().is_ok_and(|w| verify(Path::new(&w.archive().path)).ok() == w.archive().sha256)
        };
        assert!(!(intact(&a) && intact(&b)), "control: both runs came through whole: {a:?} / {b:?}");
    }

    #[cfg(unix)]
    #[test]
    fn a_destination_that_cannot_be_created_says_the_folder_refuses_files() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let parent = tmp.path().join("locked");
        fs::create_dir_all(&parent).unwrap();
        fs::set_permissions(&parent, fs::Permissions::from_mode(0o555)).unwrap();
        let writable_anyway = fs::create_dir(parent.join("probe")).is_ok();
        let result = create_in(&root, &parent.join("synced"), DEFAULT_KEEP, at(DAY));
        fs::set_permissions(&parent, fs::Permissions::from_mode(0o755)).unwrap();
        if writable_anyway {
            // Root writes anywhere; there is nothing to learn as root.
            return;
        }
        assert_eq!(result.unwrap_err(), code::DEST_UNWRITABLE);
    }

    #[test]
    fn a_destination_removed_mid_write_says_it_is_missing() {
        // An unplugged disk, mid-pack. The open file goes on taking bytes,
        // and the rename into a folder that is gone is what fails.
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("usb");
        fs::create_dir_all(&dest).unwrap();
        let gone = dest.clone();
        hooks::AFTER_ENTRY.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move || {
                let _ = fs::remove_dir_all(&gone);
            }));
        });
        let result = create_in(&root, &dest, DEFAULT_KEEP, at(DAY));
        hooks::AFTER_ENTRY.with(|hook| *hook.borrow_mut() = None);
        assert_eq!(result.unwrap_err(), code::DEST_MISSING);
    }

    #[test]
    fn an_archive_gone_before_it_is_read_back_says_the_destination_is_missing() {
        // The disk goes between the rename and the read-back.
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("usb");
        let gone = dest.clone();
        hooks::BEFORE_VERIFY.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move |_: &Path| {
                let _ = fs::remove_dir_all(&gone);
            }));
        });
        let result = create_in(&root, &dest, DEFAULT_KEEP, at(DAY));
        hooks::BEFORE_VERIFY.with(|hook| *hook.borrow_mut() = None);
        assert_eq!(result.unwrap_err(), code::DEST_MISSING);
    }

    #[test]
    fn a_disk_that_fills_as_the_archive_is_closed_says_the_disk_is_full() {
        // Closing writes the central directory and what the compressor still
        // held, after the last entry.
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let plan = plan(&root).unwrap();
        let full = std::rc::Rc::new(std::cell::Cell::new(false));
        let (fills, entries, mut packed) = (full.clone(), plan.entries.len(), 0);
        hooks::AFTER_ENTRY.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move || {
                packed += 1;
                if packed == entries {
                    fills.set(true);
                }
            }));
        });
        let result = pack(zip::ZipWriter::new(FullDisk::new(&full)), &plan.entries);
        hooks::AFTER_ENTRY.with(|hook| *hook.borrow_mut() = None);
        assert_eq!(result.unwrap_err(), code::NO_SPACE);
        full.set(false);
    }

    fn parts_in(dir: &Path) -> Vec<String> {
        names_in(dir).into_iter().filter(|name| name.ends_with(".part")).collect()
    }

    #[test]
    fn when_every_name_is_taken_no_temporary_file_is_left() {
        // A hundred archives already stand on the names this run could take.
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("icloud");
        fs::create_dir_all(&dest).unwrap();
        let plan = plan(&root).unwrap();
        for bump in 0..100 {
            fs::write(dest.join(archive_name("el-faro", at(DAY + bump), &plan.print)), b"").unwrap();
        }
        let result = create_planned(&root, &dest, DEFAULT_KEEP, at(DAY), &plan, &RunCtx::for_tests());
        assert_eq!(result.unwrap_err(), code::WRITE_FAILED);
        assert_eq!(parts_in(&dest), Vec::<String>::new());
    }

    #[test]
    fn a_rename_that_fails_leaves_no_temporary_file() {
        // Something takes the archive's name between choosing it and renaming
        // onto it: a folder, which a file cannot replace.
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("icloud");
        hooks::BEFORE_RENAME.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(|target: &Path| fs::create_dir(target).unwrap()));
        });
        let result = create_in(&root, &dest, DEFAULT_KEEP, at(DAY));
        hooks::BEFORE_RENAME.with(|hook| *hook.borrow_mut() = None);
        assert_eq!(result.unwrap_err(), code::WRITE_FAILED);
        assert_eq!(parts_in(&dest), Vec::<String>::new());
    }

    #[test]
    fn a_lock_file_the_writer_keeps_is_backed_up() {
        // Only `.git`'s own locks are left out. A file of the novel's that
        // happens to end in `.lock` is the writer's, and goes in.
        let tmp = tempfile::tempdir().unwrap();
        let root = repo_project(tmp.path(), "el-faro");
        fs::create_dir_all(root.join("research")).unwrap();
        fs::write(root.join("research/notes.lock"), "Notas.").unwrap();
        fs::write(root.join(".git/index.lock"), b"").unwrap();
        let held: Vec<String> = plan(&root).unwrap().entries.into_iter().map(|e| e.inside).collect();
        assert!(held.iter().any(|name| name == "research/notes.lock"), "{held:?}");
        assert!(!held.iter().any(|name| name == ".git/index.lock"), "{held:?}");
    }

    #[test]
    fn a_run_that_has_finished_is_no_longer_live() {
        // Otherwise a leftover of this process's would never look abandoned
        // until it was a day old.
        let run = ActiveRun::start();
        let id = run.0;
        assert!(active_runs().contains(&id));
        drop(run);
        assert!(!active_runs().contains(&id), "a finished run still counts as live");
    }

    #[test]
    fn a_history_file_that_vanishes_before_it_is_read_is_left_out() {
        // A commit finishing renames over a file between the listing and the
        // read. That file is skipped, as packing skips one, rather than
        // failing the whole backup.
        let tmp = tempfile::tempdir().unwrap();
        let root = repo_project(tmp.path(), "el-faro");
        let vanished = std::rc::Rc::new(std::cell::RefCell::new(None::<String>));
        let record = vanished.clone();
        let git = root.join(".git");
        hooks::BEFORE_FREEZE.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move |path: &Path| {
                if record.borrow().is_none() && path.parent() == Some(git.as_path()) {
                    fs::remove_file(path).unwrap();
                    *record.borrow_mut() = Some(path.file_name().unwrap().to_string_lossy().into_owned());
                }
            }));
        });
        let planned = plan(&root);
        hooks::BEFORE_FREEZE.with(|hook| *hook.borrow_mut() = None);
        let name = format!(".git/{}", vanished.borrow().clone().expect("no file was removed"));
        let held: Vec<String> = planned.unwrap().entries.into_iter().map(|e| e.inside).collect();
        assert!(!held.contains(&name), "{name} is in the plan");
    }

    #[test]
    fn a_clock_set_back_writes_each_state_twice_and_then_nothing() {
        // With archives stamped tomorrow, the newest by name is always one of
        // them. Matching against it alone made every press of an unchanged
        // novel a fresh archive, with pruning held back by the same clock: one
        // more full copy per press, for as long as the clock stayed behind.
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("icloud");
        let tomorrow = DAY + 86_400;
        for state in 0..3 {
            edit(&root, &format!("Mañana {state}."));
            create_in(&root, &dest, DEFAULT_KEEP, at(tomorrow + state * 60)).unwrap();
        }
        edit(&root, "Hoy, con el reloj un día atrás.");
        let behind = Some(Held::ClockBehind { stamp: tomorrow + 2 * 60 });

        let presses: Vec<Written> =
            (0..4).map(|press| create_in(&root, &dest, DEFAULT_KEEP, at(DAY + press * 60)).unwrap()).collect();

        let kinds: Vec<&str> = presses
            .iter()
            .map(|w| match w {
                Written::Fresh { .. } => "fresh",
                Written::Copy { .. } => "copy",
                Written::Same { .. } => "same",
                Written::Repaired { .. } => "repaired",
            })
            .collect();
        assert_eq!(kinds, ["fresh", "copy", "same", "same"]);
        for written in &presses {
            assert_eq!(written.held(), behind.as_ref(), "{written:?}");
            assert_eq!(written.pruned(), 0);
        }
        assert_eq!(list_in(&dest, "el-faro").unwrap().len(), 5);
    }

    #[test]
    fn a_clock_set_back_on_an_unchanged_novel_keeps_a_second_copy_not_a_new_state() {
        // Backed up with the clock right, then the clock went back a day:
        // every archive is ahead of it, and the newest still holds this state.
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("icloud");
        create_in(&root, &dest, DEFAULT_KEEP, at(DAY + 86_400)).unwrap();
        let again = create_in(&root, &dest, DEFAULT_KEEP, at(DAY)).unwrap();
        assert!(matches!(again, Written::Copy { .. }), "{again:?}");
        let quiet = create_in(&root, &dest, DEFAULT_KEEP, at(DAY + 60)).unwrap();
        assert!(matches!(quiet, Written::Same { .. }), "{quiet:?}");
        assert_eq!(list_in(&dest, "el-faro").unwrap().len(), 2);
    }

    #[test]
    fn the_checkpoint_skips_and_a_save_goes_through_while_the_history_is_read() {
        // Spec row 13. The 60-second checkpoint never waits on a backup: it
        // commits nothing this minute. Saving a chapter takes no lock at all.
        let tmp = tempfile::tempdir().unwrap();
        let root = repo_project(tmp.path(), "el-faro");
        add_line(&root, "Sin guardar todavía.\n");
        let head = || git2::Repository::open(&root).unwrap().head().unwrap().target().unwrap();
        let before = head();
        let mut during = None;
        plan_holding(&root, Order::FreezeFirst, &mut || {
            let started = std::time::Instant::now();
            let checkpoint = crate::commands::git::git_auto_checkpoint(root.clone());
            let saved = crate::storage::atomic_write(&root.join("manuscript/ch-02.md"), "Escrito durante el respaldo.");
            during = Some((checkpoint, started.elapsed(), saved));
        });
        let (checkpoint, waited, saved) = during.unwrap();
        assert_eq!(checkpoint, Ok(None));
        assert!(waited < std::time::Duration::from_secs(1), "the checkpoint waited {waited:?}");
        assert!(saved.is_ok(), "{saved:?}");
        assert_eq!(head(), before, "the checkpoint committed inside the capture");
        // Once the history has been read, the next checkpoint commits.
        assert!(crate::commands::git::git_auto_checkpoint(root.clone()).unwrap().is_some());
    }

    #[test]
    fn a_backup_waits_out_a_commit_holding_the_history_for_a_while() {
        // A pull checking out a large tree can hold the history for seconds:
        // longer than a commit on the main thread waits, and well inside the
        // thirty seconds a backup gives it before calling the novel busy.
        let tmp = tempfile::tempdir().unwrap();
        let root = repo_project(tmp.path(), "el-faro");
        let committing = RepoLock::acquire(&root, Wait::TryOnly).unwrap();
        let held = std::time::Duration::from_millis(2500);
        let releasing = std::thread::spawn(move || {
            std::thread::sleep(held);
            drop(committing);
        });
        let started = std::time::Instant::now();
        let planned = plan(&root);
        releasing.join().unwrap();
        assert!(planned.is_ok(), "{:?}", planned.err());
        assert!(started.elapsed() >= held, "read the history while it was held");
    }

    #[test]
    fn a_commit_from_the_app_waits_until_the_history_has_been_read() {
        // Save snapshot during a backup: it lands after the capture, never
        // inside it, so the archive's index and HEAD describe one moment.
        let tmp = tempfile::tempdir().unwrap();
        let root = repo_project(tmp.path(), "el-faro");
        let head = || git2::Repository::open(&root).unwrap().head().unwrap().target().unwrap().to_string();
        let before = head();
        let (done, committed) = std::sync::mpsc::channel::<()>();
        let mut committer = None;
        let plan = plan_holding(&root, Order::FreezeFirst, &mut || {
            add_line(&root, "Instantánea.\n");
            let (root, done) = (root.clone(), done.clone());
            committer = Some(std::thread::spawn(move || {
                let wait = Wait::Upto(std::time::Duration::from_secs(20));
                let result = crate::git::repo::commit_all_waiting(&root, "Save snapshot", wait);
                let _ = done.send(());
                result
            }));
            assert!(
                committed.recv_timeout(std::time::Duration::from_millis(400)).is_err(),
                "the commit landed while the history was being read"
            );
        });
        let after = committer.unwrap().join().unwrap().expect("the commit failed after the capture");
        assert_ne!(after, before);

        let restored = pack_and_restore(&root, &plan);
        assert_eq!(missing_objects(&restored), Vec::<String>::new());
        let repo = git2::Repository::open(&restored).unwrap();
        assert_eq!(repo.head().unwrap().target().unwrap().to_string(), before, "the archive holds the commit");
        let indexed = repo.index().unwrap().write_tree().unwrap();
        assert_eq!(indexed, repo.head().unwrap().peel_to_tree().unwrap().id(), "the index and HEAD disagree");
    }

    #[test]
    fn a_backup_clears_what_a_run_that_died_left_behind() {
        // A quit or a crash before the rename left a temporary file as large as
        // the archive, and nothing ever removed it. The next run does, for its
        // own novel only.
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("icloud");
        fs::create_dir_all(&dest).unwrap();
        let theirs = dest.join("versorium-backup-el-faro-del-norte-4242.part");
        let ours = dest.join("versorium-backup-el-faro-4242.part");
        for path in [&theirs, &ours] {
            fs::write(path, b"half an archive").unwrap();
            fs::File::options().write(true).open(path).unwrap().set_modified(at(DAY - 25 * 3600)).unwrap();
        }
        create_in(&root, &dest, DEFAULT_KEEP, at(DAY)).unwrap();
        assert!(!ours.exists(), "the leftover was not swept");
        assert!(theirs.exists(), "another novel's file was swept");
    }

    #[test]
    fn a_write_error_is_named_for_what_the_destination_did() {
        use std::io::{Error, ErrorKind};
        for (kind, expected) in [
            (ErrorKind::StorageFull, code::NO_SPACE),
            (ErrorKind::QuotaExceeded, code::NO_SPACE),
            (ErrorKind::PermissionDenied, code::DEST_UNWRITABLE),
            (ErrorKind::ReadOnlyFilesystem, code::DEST_UNWRITABLE),
            (ErrorKind::NotFound, code::DEST_MISSING),
            (ErrorKind::TimedOut, code::WRITE_FAILED),
            (ErrorKind::Other, code::WRITE_FAILED),
        ] {
            assert_eq!(write_code(&Error::from(kind)), expected, "{kind:?}");
        }
        // The operating system's own numbers land on the same kinds.
        #[cfg(unix)]
        for (errno, expected) in [(28, code::NO_SPACE), (30, code::DEST_UNWRITABLE), (13, code::DEST_UNWRITABLE)] {
            assert_eq!(write_code(&Error::from_raw_os_error(errno)), expected, "errno {errno}");
        }
        assert_eq!(zip_code(zip::result::ZipError::Io(Error::from(ErrorKind::StorageFull))), code::NO_SPACE);
        assert_eq!(zip_code(zip::result::ZipError::FileNotFound), code::WRITE_FAILED);
    }

    /// A destination held in memory: while `full`, every write fails the way
    /// a full disk fails.
    struct FullDisk {
        full: std::rc::Rc<std::cell::Cell<bool>>,
        bytes: std::io::Cursor<Vec<u8>>,
    }

    impl FullDisk {
        fn new(full: &std::rc::Rc<std::cell::Cell<bool>>) -> Self {
            Self { full: full.clone(), bytes: std::io::Cursor::default() }
        }
    }

    impl Write for FullDisk {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            if self.full.get() {
                return Err(std::io::Error::from(std::io::ErrorKind::StorageFull));
            }
            self.bytes.write(bytes)
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl Seek for FullDisk {
        fn seek(&mut self, to: std::io::SeekFrom) -> std::io::Result<u64> {
            self.bytes.seek(to)
        }
    }

    #[test]
    fn a_full_disk_mid_archive_says_the_disk_is_full() {
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let plan = plan(&root).unwrap();
        let full = std::rc::Rc::new(std::cell::Cell::new(true));
        let mut zip = zip::ZipWriter::new(FullDisk::new(&full));
        let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        assert_eq!(write_entries(&mut zip, &plan.entries, options).unwrap_err(), code::NO_SPACE);
        // So the writer's own clean-up on drop has somewhere to go.
        full.set(false);
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_that_refuses_new_files_says_so() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("locked");
        fs::create_dir_all(&dest).unwrap();
        fs::set_permissions(&dest, fs::Permissions::from_mode(0o555)).unwrap();
        let writable_anyway = fs::write(dest.join("probe"), b"").is_ok();
        let result = create_in(&root, &dest, DEFAULT_KEEP, at(DAY));
        fs::set_permissions(&dest, fs::Permissions::from_mode(0o755)).unwrap();
        if writable_anyway {
            // Root writes anywhere; there is nothing to learn as root.
            return;
        }
        assert_eq!(result.unwrap_err(), code::DEST_UNWRITABLE);
        assert!(names_in(&dest).is_empty());
    }

    #[test]
    fn every_backup_error_has_words_in_both_languages() {
        // A code with no `errors.<code>` line reaches the writer as "Something
        // went wrong.", which is how every failed destination read before.
        let locales = Path::new(env!("CARGO_MANIFEST_DIR")).join("../locales");
        for lang in ["en", "es"] {
            let text = fs::read_to_string(locales.join(lang).join("ui.json")).unwrap();
            let table: serde_json::Value = serde_json::from_str(&text).unwrap();
            for code in CODES {
                let message = table["errors"][code].as_str().unwrap_or_default();
                assert!(!message.trim().is_empty(), "errors.{code} has no {lang} text");
            }
        }
    }

    #[test]
    fn a_chosen_folder_is_named_from_one_detection() {
        let tmp = tempfile::tempdir().unwrap();
        let novel = tmp.path().join("novel");
        let cloud = tmp.path().join("cloud");
        let plain = tmp.path().join("plain");
        for dir in [&novel, &cloud, &plain] {
            fs::create_dir_all(dir).unwrap();
        }
        let detected = [Destination {
            kind: "icloud".into(),
            path: cloud.to_string_lossy().into_owned(),
            available: true,
            volume: None,
            offsite: true,
        }];
        assert!(!coverage_with(&novel, std::slice::from_ref(&plain), &detected).offsite, "an undetected path is a folder");
        assert!(coverage_with(&novel, &[plain, cloud], &detected).offsite);
    }
}

#[cfg(test)]
mod live_detection {
    /// What this machine really offers. Prints rather than asserts: the answer
    /// depends on which sync clients are installed.
    #[test]
    #[ignore = "reports the sync folders installed on this machine"]
    fn live_what_this_machine_offers() {
        for d in super::destinations() {
            eprintln!("{:<12} available={:<5} {}", d.kind, d.available, d.path);
        }
    }
}
