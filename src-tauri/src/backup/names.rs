//! The names Versorium gives the files it writes into a destination, read
//! back exactly.
//!
//! Exactness is the point. Listing and pruning used to match a prefix, so
//! `el-faro` claimed every archive of `el-faro-del-norte`, and
//! `la-aguja-del-norte` claimed those of `la-aguja-del-norte-restored`, the
//! folder the app's own Restore creates. Pruning one novel could delete
//! another's backups. A name is now read from the right, field by field, and
//! belongs to a novel only when what is left is exactly that novel's slug.
//!
//! Every name an earlier version wrote still parses: an archive with or
//! without the fingerprint, a stamp bumped by `free_name`, and both older
//! forms of the temporary `.part` file.

use super::host::HOST_HEX;
use super::{EXTENSION, PREFIX, PRINT_HEX};

/// An archive's name, taken apart.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveName<'a> {
    pub slug: &'a str,
    /// When the backup was asked for, in Unix seconds.
    pub stamp: u64,
    /// The short fingerprint. `None` for an archive written before
    /// fingerprints existed.
    pub print: Option<&'a str>,
}

/// `versorium-backup-<slug>-<YYYY-MM-DD-HHMMSS>[-<16 hex>].zip`, or `None`.
///
/// Only the shape the app writes: four digits of year, and every field in its
/// range. The app has never written anything else (its clock starts in 1970
/// and `stamp` renders a real date), so this turns away no archive of ours.
/// What it turns away is a hand-made or foreign name: a year of seventeen
/// digits overflowed the date arithmetic and stopped the listing, and a
/// five-digit year read as a stamp far enough ahead to hold pruning forever.
/// A name nobody can parse is never listed and never pruned, which is the
/// safe direction.
pub fn parse_archive(name: &str) -> Option<ArchiveName<'_>> {
    let stem = name.strip_suffix(EXTENSION)?.strip_suffix('.')?;
    let (rest, print) = split_print(stem);
    let (rest, time) = rest.rsplit_once('-')?;
    let (rest, day) = rest.rsplit_once('-')?;
    let (rest, month) = rest.rsplit_once('-')?;
    let (rest, year) = rest.rsplit_once('-')?;
    if !(digits(time, 6) && digits(day, 2) && digits(month, 2) && digits(year, 4)) {
        return None;
    }
    let slug = own_slug(rest)?;
    let stamp = seconds(year, month, day, time)?;
    Some(ArchiveName { slug, stamp, print })
}

/// Whether `name` is one of the archives of the novel whose slug is `slug`.
pub fn archive_of<'a>(name: &'a str, slug: &str) -> Option<ArchiveName<'a>> {
    parse_archive(name).filter(|parsed| parsed.slug == slug)
}

/// The fingerprint at the end of a name, and what comes before it.
///
/// Two conditions, not one: sixteen lowercase hex digits AND a six-digit field
/// immediately before them. A slug turns every non-alphanumeric into a dash,
/// so a novel called "Caso 0123456789abcdef" can put sixteen hex characters in
/// a filename on its own; only the stamp before them proves the app put them
/// there.
fn split_print(stem: &str) -> (&str, Option<&str>) {
    if let Some((head, last)) = stem.rsplit_once('-') {
        let hex = last.len() == PRINT_HEX && last.bytes().all(lower_hex);
        let stamped = head.rsplit_once('-').is_some_and(|(_, before)| digits(before, 6));
        if hex && stamped {
            return (head, Some(last));
        }
    }
    (stem, None)
}

/// A temporary file a run writes before renaming it into an archive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PartName<'a> {
    /// `versorium-backup-<slug>.<host>.<pid>.<run>.part`: whose computer,
    /// which process and which run, so no two writers ever share one.
    Run { slug: &'a str, host: &'a str, pid: u32, run: u64 },
    /// `versorium-backup-<slug>-<pid>.part`, written before host ids. Two runs
    /// in one process, or two computers writing one synced folder, shared it.
    LegacyPid { slug: &'a str },
    /// `<archive>.zip.part`, written by the first versions of the backup.
    LegacyArchive { slug: &'a str },
}

impl<'a> PartName<'a> {
    pub fn slug(&self) -> &'a str {
        match self {
            PartName::Run { slug, .. } | PartName::LegacyPid { slug } | PartName::LegacyArchive { slug } => slug,
        }
    }
}

/// The temporary name for one run. A slug holds only `[a-z0-9-]`, so the dots
/// separate the fields with no way to confuse them.
pub fn part_name(slug: &str, host: &str, pid: u32, run: u64) -> String {
    format!("{PREFIX}-{slug}.{host}.{pid}.{run}.part")
}

pub fn parse_part(name: &str) -> Option<PartName<'_>> {
    let stem = name.strip_suffix(".part")?;
    if stem.ends_with(".zip") {
        return parse_archive(stem).map(|archive| PartName::LegacyArchive { slug: archive.slug });
    }
    if stem.contains('.') {
        let mut fields = stem.split('.');
        let (base, host, pid, run) = (fields.next()?, fields.next()?, fields.next()?, fields.next()?);
        if fields.next().is_some() || host.len() != HOST_HEX || !host.bytes().all(lower_hex) {
            return None;
        }
        if !all_digits(pid) || !all_digits(run) {
            return None;
        }
        return Some(PartName::Run { slug: own_slug(base)?, host, pid: pid.parse().ok()?, run: run.parse().ok()? });
    }
    let (base, pid) = stem.rsplit_once('-')?;
    if !all_digits(pid) {
        return None;
    }
    Some(PartName::LegacyPid { slug: own_slug(base)? })
}

/// What follows `versorium-backup-`, when there is something.
fn own_slug(base: &str) -> Option<&str> {
    base.strip_prefix(PREFIX)?.strip_prefix('-').filter(|slug| !slug.is_empty())
}

fn digits(field: &str, count: usize) -> bool {
    field.len() == count && all_digits(field)
}

/// Checked by hand, because `str::parse` also accepts a leading `+`.
fn all_digits(field: &str) -> bool {
    !field.is_empty() && field.bytes().all(|b| b.is_ascii_digit())
}

fn lower_hex(b: u8) -> bool {
    b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
}

/// The stamp as Unix seconds. `None` for a field out of its range, and for a
/// date before 1970, which no run could have written and which would
/// otherwise wrap around. A four-digit year keeps the arithmetic far from
/// overflowing either way.
fn seconds(year: &str, month: &str, day: &str, time: &str) -> Option<u64> {
    let month: u32 = month.parse().ok().filter(|m| (1..=12).contains(m))?;
    let day: u32 = day.parse().ok().filter(|d| (1..=31).contains(d))?;
    let hour: i64 = time[0..2].parse().ok().filter(|h| *h < 24)?;
    let minute: i64 = time[2..4].parse().ok().filter(|m| *m < 60)?;
    let second: i64 = time[4..6].parse().ok().filter(|s| *s < 60)?;
    let days = super::days_from_civil(year.parse().ok()?, month, day);
    u64::try_from(days * 86_400 + hour * 3600 + minute * 60 + second).ok()
}

/// Today's rule, kept so a test can show what it did: a prefix match claims
/// every novel whose slug starts with this one's.
#[cfg(test)]
pub fn is_ours_prefix_legacy(name: &str, project: &str) -> bool {
    name.starts_with(&format!("{PREFIX}-{}-", super::slug(project))) && name.ends_with(EXTENSION)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backup::{archive_name, slug};
    use std::time::{Duration, UNIX_EPOCH};

    fn at(secs: u64) -> std::time::SystemTime {
        UNIX_EPOCH + Duration::from_secs(secs)
    }

    fn ours(name: &str, project: &str) -> bool {
        archive_of(name, &slug(project)).is_some()
    }

    /// Pairs where one slug is a prefix of the other, from `slugcheck.rs` and
    /// from the folder names the app's own Restore creates.
    const SIBLINGS: [(&str, &str); 6] = [
        ("Novel", "Novel 2"),
        ("El faro", "El faro del norte"),
        ("La aguja del norte", "la-aguja-del-norte-restored"),
        ("La aguja del norte", "la-aguja-del-norte-restaurado"),
        ("La aguja del norte", "la-aguja-del-norte-restored-2"),
        ("Diario", "Diario 2026-01-01-120000"),
    ];

    #[test]
    fn a_novel_never_claims_a_sibling_whose_slug_starts_like_its_own() {
        for (short, long) in SIBLINGS {
            for print in ["0123456789abcdef", ""] {
                let mut name = archive_name(long, at(1_790_553_600), "0123456789abcdef");
                if print.is_empty() {
                    // Written before fingerprints existed.
                    name = name.replace("-0123456789abcdef", "");
                }
                assert!(ours(&name, long), "{long} must still own {name}");
                assert!(!ours(&name, short), "{short} claimed {long}'s archive {name}");
            }
            let mine = archive_name(short, at(1_790_553_600), "fedcba9876543210");
            assert!(!ours(&mine, long), "{long} claimed {short}'s archive {mine}");
        }
    }

    #[test]
    fn control_the_old_prefix_rule_claims_the_sibling() {
        // Reproduces the bug this module fixes, on the same names. If this ever
        // stops claiming the sibling, the test above proves nothing.
        for (short, long) in SIBLINGS {
            let name = archive_name(long, at(1_790_553_600), "0123456789abcdef");
            assert!(is_ours_prefix_legacy(&name, short), "{short} vs {name}");
        }
    }

    #[test]
    fn every_name_an_earlier_version_wrote_still_parses() {
        let cases = [
            // 80c563c to ad0f73a: no fingerprint.
            ("versorium-backup-el-faro-2026-09-28-011316.zip", "el-faro", 1_790_557_996, None),
            // b92e3d3 on: the fingerprint after the stamp.
            (
                "versorium-backup-el-faro-2026-09-28-011316-0123456789abcdef.zip",
                "el-faro",
                1_790_557_996,
                Some("0123456789abcdef"),
            ),
            // The last second of a day.
            ("versorium-backup-n-2026-09-28-235959-aaaaaaaaaaaaaaaa.zip", "n", 1_790_639_999, Some("aaaaaaaaaaaaaaaa")),
            // The last second the four-digit year can name.
            ("versorium-backup-n-9999-12-31-235959.zip", "n", 253_402_300_799, None),
            // The slug of an empty title.
            ("versorium-backup-novel-1970-01-01-000000.zip", "novel", 0, None),
        ];
        for (name, slug, stamp, print) in cases {
            let parsed = parse_archive(name).unwrap_or_else(|| panic!("{name} no longer parses"));
            assert_eq!(parsed.slug, slug, "{name}");
            assert_eq!(parsed.stamp, stamp, "{name}");
            assert_eq!(parsed.print, print, "{name}");
        }
    }

    #[test]
    fn the_name_this_version_writes_reads_back_as_written() {
        for title in ["El Faro", "La Niña: ¿Dónde? / Parte 2", "", "Caso 0123456789abcdef", "Diario 2026-01-01-120000"] {
            for secs in [0, 1_700_000_000, 1_790_553_600, 4_102_444_799] {
                let name = archive_name(title, at(secs), "0123456789abcdef");
                let parsed = parse_archive(&name).unwrap_or_else(|| panic!("{name}"));
                assert_eq!(parsed.slug, slug(title));
                assert_eq!(parsed.stamp, secs);
                assert_eq!(parsed.print, Some("0123456789abcdef"));
            }
        }
    }

    #[test]
    fn a_title_that_looks_like_a_fingerprint_or_a_date_stays_a_title() {
        // Sixteen hex characters with no stamp in front of them are part of the
        // slug, and a date inside a title does not end it early.
        let name = "versorium-backup-caso-0123456789abcdef-2026-09-29-061321.zip";
        let parsed = parse_archive(name).unwrap();
        assert_eq!(parsed.slug, "caso-0123456789abcdef");
        assert_eq!(parsed.print, None);
        let name = "versorium-backup-diario-2026-01-01-120000-2026-09-29-061321-0123456789abcdef.zip";
        assert_eq!(parse_archive(name).unwrap().slug, "diario-2026-01-01-120000");
        assert!(!ours(name, "Diario"));
    }

    #[test]
    fn names_that_are_not_archives_are_not_anybodys() {
        for name in [
            "taxes.pdf",
            "versorium-backup-el-faro.zip",
            "versorium-backup-el-faro-2026-09-29.zip",
            "versorium-backup-2026-09-29-061321.zip",
            "versorium-backup-el-faro-2026-09-29-061321.zip.part",
            "versorium-backup-el-faro-2026-09-29-061321xzip",
            "versorium-backup-el-faro-2026-9-29-061321.zip",
            "versorium-backup-el-faro-0000-01-01-000000.zip",
            "versorium-backup-el-faro-2026-09-29-+61321.zip",
            "versorium-backupel-faro-2026-09-29-061321.zip",
            // A year the date arithmetic cannot hold: it overflowed, and the
            // listing stopped there.
            "versorium-backup-el-faro-30000000000000000-01-01-000000.zip",
            // Five digits: a stamp far enough ahead to hold pruning for ever.
            "versorium-backup-el-faro-99999-01-01-000000.zip",
            // Each field out of its range, once.
            "versorium-backup-el-faro-2026-13-01-000000.zip",
            "versorium-backup-el-faro-2026-00-01-000000.zip",
            "versorium-backup-el-faro-2026-09-32-000000.zip",
            "versorium-backup-el-faro-2026-09-00-000000.zip",
            "versorium-backup-el-faro-2026-09-29-240000.zip",
            "versorium-backup-el-faro-2026-09-29-236000.zip",
            "versorium-backup-el-faro-2026-09-29-235960.zip",
        ] {
            assert!(parse_archive(name).is_none(), "{name} parsed");
        }
    }

    #[test]
    fn a_folder_holding_a_name_with_an_impossible_year_still_lists() {
        // Before the year was held to four digits, this name made the date
        // arithmetic overflow, which stops a debug build, and with it Back
        // up now and the list of stored backups.
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("versorium-backup-el-faro-30000000000000000-01-01-000000.zip"), "x").unwrap();
        std::fs::write(tmp.path().join("versorium-backup-el-faro-2026-09-29-061321.zip"), "x").unwrap();
        let listed = crate::backup::list_in(tmp.path(), "el-faro").unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "versorium-backup-el-faro-2026-09-29-061321.zip");
    }

    #[test]
    fn a_part_name_carries_its_host_process_and_run() {
        let name = part_name("el-faro", "a1b2c3d4e5", 4242, 7);
        assert_eq!(name, "versorium-backup-el-faro.a1b2c3d4e5.4242.7.part");
        assert_eq!(
            parse_part(&name),
            Some(PartName::Run { slug: "el-faro", host: "a1b2c3d4e5", pid: 4242, run: 7 })
        );
        // Two runs in one process never share a file.
        assert_ne!(part_name("el-faro", "a1b2c3d4e5", 4242, 7), part_name("el-faro", "a1b2c3d4e5", 4242, 8));
    }

    #[test]
    fn both_older_part_names_parse_with_their_exact_slug() {
        assert_eq!(parse_part("versorium-backup-el-faro-4242.part"), Some(PartName::LegacyPid { slug: "el-faro" }));
        assert_eq!(parse_part("versorium-backup-novel-2-345.part"), Some(PartName::LegacyPid { slug: "novel-2" }));
        assert_eq!(
            parse_part("versorium-backup-el-faro-2026-09-28-011316.zip.part"),
            Some(PartName::LegacyArchive { slug: "el-faro" })
        );
        assert_eq!(
            parse_part("versorium-backup-el-faro-del-norte-2026-09-28-011316.zip.part").map(|p| p.slug()),
            Some("el-faro-del-norte")
        );
    }

    #[test]
    fn a_part_name_that_is_not_quite_one_is_left_alone() {
        for name in [
            "versorium-backup-el-faro.part",
            "versorium-backup-el-faro.A1B2C3D4E5.1.1.part",
            "versorium-backup-el-faro.a1b2c3.1.1.part",
            "versorium-backup-el-faro.a1b2c3d4e5.1.part",
            "versorium-backup-el-faro.a1b2c3d4e5.+1.1.part",
            "versorium-backup-el-faro.a1b2c3d4e5.1.1.1.part",
            "versorium-backup.a1b2c3d4e5.1.1.part",
            "versorium-backup-el-faro-x.part",
            "notes.part",
        ] {
            assert!(parse_part(name).is_none(), "{name} parsed");
        }
    }
}
