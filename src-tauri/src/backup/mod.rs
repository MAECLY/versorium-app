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
pub fn coverage(project: &Path, dirs: &[PathBuf]) -> Coverage {
    let project_volume = volume_of(project);
    let mut volumes: Vec<String> = project_volume.iter().cloned().collect();
    let mut unknown = project_volume.is_none();
    let mut shared = Vec::new();
    let mut offsite = false;

    for dir in dirs {
        if is_offsite(&kind_of(dir)) {
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

/// Which provider a already-chosen path belongs to, for a destination stored in
/// settings rather than freshly detected.
fn kind_of(path: &Path) -> String {
    destinations()
        .into_iter()
        .find(|d| d.path == path.to_string_lossy())
        .map(|d| d.kind)
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
    pub modified: u64,
    /// Of the archive as it sits on the destination, read back after writing.
    /// `None` for an archive found by listing, which has not been re-verified.
    pub sha256: Option<String>,
}

fn home() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "no_home".to_string())
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
                // Listing does not re-read gigabytes; `verify` does that on
                // demand.
                sha256: None,
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

    // Before pruning, so a destination that cannot hold this archive does not
    // also lose the older ones that were fine.
    let digest = match verify(&final_path) {
        Ok(digest) => digest,
        Err(e) => {
            let _ = fs::remove_file(&final_path);
            return Err(e);
        }
    };

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
        sha256: Some(digest),
    })
}

/// Read a file back and hash it.
///
/// Deliberately reopened rather than hashed while writing: the point is to
/// learn what the destination will hand back, which is the only durability
/// signal a network share or a sync folder gives at all. It proves the
/// filesystem agrees, not that the platters do — say "verified", not "safe".
fn hash_of(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let mut file = fs::File::open(path).map_err(|_| "io".to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|_| "io".to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().iter().fold(String::with_capacity(64), |mut out, byte| {
        use std::fmt::Write;
        let _ = write!(out, "{byte:02x}");
        out
    }))
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
    let file = fs::File::open(path).map_err(|_| "io".to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| "backup_unreadable".to_string())?;
    if zip.is_empty() {
        return Err("backup_unreadable".into());
    }
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|_| "backup_unreadable".to_string())?;
        if entry.is_dir() {
            continue;
        }
        // Reading to a sink is what makes the zip crate check the CRC.
        std::io::copy(&mut entry, &mut std::io::sink()).map_err(|_| "backup_corrupt".to_string())?;
    }
    Ok(digest)
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
    fn an_archive_is_verified_before_it_is_called_a_backup() {
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("synced");
        let archive = create_in(&root, &dest, DEFAULT_KEEP, at(1_759_000_000)).unwrap();

        // The hash is of what the destination hands back, not of what we meant
        // to write.
        let digest = archive.sha256.expect("a written archive carries its hash");
        assert_eq!(digest.len(), 64);
        assert_eq!(verify(Path::new(&archive.path)).unwrap(), digest);
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

        let bytes = fs::read(&archive.path).unwrap();
        fs::write(&archive.path, &bytes[..bytes.len() / 2]).unwrap();
        assert_eq!(verify(Path::new(&archive.path)).unwrap_err(), "backup_unreadable");
    }

    #[test]
    fn a_destination_that_cannot_hold_the_archive_keeps_the_older_ones() {
        // Verification runs before pruning on purpose: a failed write must not
        // also cost the backups that were fine.
        let tmp = tempfile::tempdir().unwrap();
        let root = project(tmp.path(), "el-faro");
        let dest = tmp.path().join("synced");
        for day in 1..=3 {
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

        let c = super::coverage(&project, &[a.clone(), b.clone()]);
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

        let c = super::coverage(&project, &[missing]);
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
