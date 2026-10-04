//! The font catalogue shipped with the app.
//!
//! `fonts/catalog.json` is embedded at build time and validated on load, the
//! same contract `models::catalog` follows: the UI renders whatever it finds
//! rather than hardcoding a list (DESIGN-VERSORIUM.md).
//!
//! M7 ships a stub by design. Every entry resolves to a CSS font stack of
//! families the machine already has, so nothing downloads. `Source Serif 4` is
//! listed because it is the design default, but marked `available: false` —
//! there is no downloader yet, and an entry carrying a URL it cannot honour
//! would be a worse lie than an honest absence.

use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

const EMBEDDED: &str = include_str!("../../../fonts/catalog.json");

pub const ROLES: [&str; 3] = ["body", "ui", "mono"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FontEntry {
    pub id: String,
    pub family: String,
    /// `body` | `ui` | `mono`
    pub role: String,
    /// A complete CSS `font-family` list, applied verbatim by the editor.
    pub stack: String,
    pub license: String,
    /// Whether the binary carries the font file. Nothing is bundled in M7.
    pub bundled: bool,
    /// Whether choosing it will actually change what the writer sees. A font
    /// that is neither bundled nor guaranteed installed is offered but marked.
    pub available: bool,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontCatalog {
    pub version: u32,
    /// The id used when settings carry no choice yet.
    pub default_body: String,
    pub fonts: Vec<FontEntry>,
}

/// Rejects a catalogue the editor could not render from. An empty stack would
/// leave the page with no font at all, so it fails loudly rather than blankly.
pub fn validate(catalog: &FontCatalog) -> Result<(), String> {
    if catalog.fonts.is_empty() {
        return Err("bad_font_catalog".into());
    }
    let mut seen = std::collections::HashSet::new();
    for font in &catalog.fonts {
        if font.id.trim().is_empty()
            || !seen.insert(font.id.as_str())
            || font.stack.trim().is_empty()
            || font.family.trim().is_empty()
            || !ROLES.contains(&font.role.as_str())
        {
            return Err("bad_font_catalog".into());
        }
    }
    // A default nothing points at would leave the editor unstyled.
    if !catalog.fonts.iter().any(|f| f.id == catalog.default_body) {
        return Err("bad_font_catalog".into());
    }
    Ok(())
}

fn parse(raw: &str) -> Result<FontCatalog, String> {
    let catalog: FontCatalog =
        serde_json::from_str(raw).map_err(|_| "bad_font_catalog".to_string())?;
    validate(&catalog)?;
    Ok(catalog)
}

/// Parsed once; the file cannot change while the app runs.
pub fn catalog() -> Result<&'static FontCatalog, String> {
    static PARSED: OnceLock<Result<FontCatalog, String>> = OnceLock::new();
    PARSED.get_or_init(|| parse(EMBEDDED)).as_ref().map_err(|e| e.clone())
}

pub fn find(id: &str) -> Option<&'static FontEntry> {
    catalog().ok()?.fonts.iter().find(|f| f.id == id)
}

/// The entry a stored id names, or the catalogue's default when settings name
/// something this catalogue does not hold: a font a later catalogue dropped, or
/// a value that was never an id. The answer is the entry, id included, so a
/// caller never pairs the id it was asked about with another face's stack.
pub fn resolve(id: &str) -> Result<&'static FontEntry, String> {
    let catalog = catalog()?;
    catalog
        .fonts
        .iter()
        .find(|f| f.id == id)
        .or_else(|| catalog.fonts.iter().find(|f| f.id == catalog.default_body))
        .ok_or_else(|| "bad_font_catalog".to_string())
}

/// What the editor renders in, as the frontend receives it: the catalogue id
/// Settings marks as chosen, and the stack the page applies.
///
/// Both, because one string could not serve both readers: the command used to
/// answer the stack alone, which the Typography panel compared with ids, so
/// its "selected" mark never matched anything.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EditorFont {
    pub id: String,
    pub stack: String,
}

impl From<&FontEntry> for EditorFont {
    fn from(entry: &FontEntry) -> Self {
        Self {
            id: entry.id.clone(),
            stack: entry.stack.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, role: &str) -> FontEntry {
        FontEntry {
            id: id.into(),
            family: "Test".into(),
            role: role.into(),
            stack: "Test, serif".into(),
            license: "system".into(),
            bundled: false,
            available: true,
            note: String::new(),
        }
    }

    fn catalog_of(fonts: Vec<FontEntry>, default_body: &str) -> FontCatalog {
        FontCatalog { version: 1, default_body: default_body.into(), fonts }
    }

    #[test]
    fn a_well_formed_catalog_is_accepted() {
        let c = catalog_of(vec![entry("a", "body"), entry("b", "mono")], "a");
        assert!(validate(&c).is_ok());
    }

    #[test]
    fn every_defect_that_would_leave_the_page_unstyled_is_rejected() {
        assert_eq!(validate(&catalog_of(vec![], "a")).unwrap_err(), "bad_font_catalog");

        /// A named mutation and the edit that breaks an entry that way.
        type Break = (&'static str, fn(&mut FontEntry));
        let broken: Vec<Break> = vec![
            ("blank id", |f| f.id = "  ".into()),
            ("empty stack", |f| f.stack = String::new()),
            ("blank family", |f| f.family = " ".into()),
            ("unknown role", |f| f.role = "display".into()),
        ];
        for (what, break_it) in broken {
            let mut font = entry("a", "body");
            break_it(&mut font);
            let id = font.id.clone();
            assert_eq!(
                validate(&catalog_of(vec![font], &id)).unwrap_err(),
                "bad_font_catalog",
                "{what} should have been rejected"
            );
        }
    }

    #[test]
    fn duplicate_ids_are_rejected() {
        let c = catalog_of(vec![entry("same", "body"), entry("same", "ui")], "same");
        assert_eq!(validate(&c).unwrap_err(), "bad_font_catalog");
    }

    #[test]
    fn a_default_pointing_at_nothing_is_rejected() {
        let c = catalog_of(vec![entry("a", "body")], "missing");
        assert_eq!(validate(&c).unwrap_err(), "bad_font_catalog");
    }

    #[test]
    fn malformed_json_is_an_error_not_a_panic() {
        assert_eq!(parse("{").unwrap_err(), "bad_font_catalog");
    }

    /// The guard on the file we actually ship.
    #[test]
    fn the_shipped_catalog_loads_and_offers_the_design_default() {
        let c = catalog().expect("fonts/catalog.json must be usable");
        assert_eq!(c.default_body, "system-serif");
        // DESIGN-VERSORIUM.md's zero-download fallback stack.
        let fallback = &find("system-serif").unwrap().stack;
        assert!(fallback.contains("Iowan Old Style"));
        assert!(fallback.ends_with("serif"));
        // Source Serif 4 is named but honestly marked as not yet shippable.
        let source = find("source-serif-4").unwrap();
        assert!(!source.bundled);
        assert!(!source.available, "nothing may claim to be installable without a downloader");
        assert!(c.fonts.iter().any(|f| f.role == "mono"), "word counts want tabular figures");
    }

    #[test]
    fn a_stored_id_resolves_to_itself_and_an_unknown_one_to_the_default() {
        assert_eq!(resolve("system-mono").unwrap(), find("system-mono").unwrap());
        // Settings could name a font a later catalogue dropped, or hold a
        // value that was never an id. Either falls back rather than failing,
        // and the answer names the face it fell back to.
        for stored in ["a-font-that-was-removed", "\"Iowan Old Style\", serif", ""] {
            let fallback = resolve(stored).unwrap();
            assert_eq!(fallback.id, "system-serif", "{stored:?}");
            assert_eq!(fallback.stack, find("system-serif").unwrap().stack, "{stored:?}");
        }
    }

    #[test]
    fn an_editor_font_carries_its_entry_s_id_and_stack() {
        let entry = find("source-serif-4").unwrap();
        let font = EditorFont::from(entry);
        assert_eq!(font.id, "source-serif-4");
        assert_eq!(font.stack, entry.stack);
    }
}
