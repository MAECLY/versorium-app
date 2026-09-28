//! The built-in model catalog, shipped with the app.
//!
//! `models/catalog.json` is embedded at build time: it is app data, not user
//! data, and the UI renders whatever it finds there rather than hardcoding a
//! list (spec §6.2). Every entry drives a download that is checked against its
//! `sha256` and deleted on mismatch, so a catalog with a wrong hash or a
//! non-https URL would break every download of that model. `catalog()`
//! therefore validates before handing anything back.

use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

const EMBEDDED: &str = include_str!("../../../models/catalog.json");

/// Smallest to largest. Order matters: the hardware wizard walks it upward.
pub const TIERS: [&str; 4] = ["low", "mid", "midPlus", "high"];
pub const TASKS: [&str; 3] = ["writing", "embeddings", "dictation"];
pub const SPEEDS: [&str; 3] = ["fast", "balanced", "slow"];
pub const QUALITIES: [&str; 3] = ["basic", "good", "high"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelEntry {
    pub id: String,
    pub family: String,
    pub label: String,
    /// `writing` | `embeddings` | `dictation`
    pub task: String,
    /// `low` | `mid` | `midPlus` | `high`
    pub tier: String,
    pub params: String,
    pub quant: String,
    pub size_bytes: u64,
    pub ram_hint_gb: f32,
    pub ctx: u32,
    /// `fast` | `balanced` | `slow` — the card picks its weight icon from this.
    pub speed: String,
    /// `basic` | `good` | `high`
    pub quality: String,
    /// `Balanced` | `Balanced+` | null
    pub badge: Option<String>,
    /// Hidden by the UI while the censorship toggle is on (spec §6.2).
    pub uncensored: bool,
    pub sha256: String,
    pub url: String,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub repo: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Catalog {
    pub version: u32,
    #[serde(default)]
    pub slots: Vec<String>,
    pub models: Vec<ModelEntry>,
}

/// Rejects a catalog that would misbehave at download time. Returning an error
/// is deliberate: shipping a bad hash silently is worse than showing no models.
pub fn validate(catalog: &Catalog) -> Result<(), String> {
    if catalog.models.is_empty() {
        return Err("bad_catalog".into());
    }
    let mut seen = std::collections::HashSet::new();
    for model in &catalog.models {
        if model.id.trim().is_empty() || !seen.insert(model.id.as_str()) {
            return Err("bad_catalog".into());
        }
        let sha_ok = model.sha256.len() == 64
            && model.sha256.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase());
        if !sha_ok
            || !model.url.starts_with("https://")
            || model.size_bytes == 0
            || model.ram_hint_gb <= 0.0
            || !TIERS.contains(&model.tier.as_str())
            || !TASKS.contains(&model.task.as_str())
            || !SPEEDS.contains(&model.speed.as_str())
            || !QUALITIES.contains(&model.quality.as_str())
        {
            return Err("bad_catalog".into());
        }
    }
    Ok(())
}

fn parse(raw: &str) -> Result<Catalog, String> {
    let catalog: Catalog = serde_json::from_str(raw).map_err(|_| "bad_catalog".to_string())?;
    validate(&catalog)?;
    Ok(catalog)
}

/// Parsed once; the file cannot change while the app runs.
pub fn catalog() -> Result<&'static Catalog, String> {
    static PARSED: OnceLock<Result<Catalog, String>> = OnceLock::new();
    PARSED.get_or_init(|| parse(EMBEDDED)).as_ref().map_err(|e| e.clone())
}

pub fn find(id: &str) -> Option<&'static ModelEntry> {
    catalog().ok()?.models.iter().find(|m| m.id == id)
}

#[cfg(test)]
pub(crate) mod fixtures {
    use super::*;

    pub fn entry(id: &str, tier: &str, ram_hint_gb: f32) -> ModelEntry {
        ModelEntry {
            id: id.into(),
            family: "Qwen".into(),
            label: "Test".into(),
            task: "writing".into(),
            tier: tier.into(),
            params: "4B".into(),
            quant: "Q4_K_M".into(),
            size_bytes: 1024,
            ram_hint_gb,
            ctx: 32768,
            speed: "balanced".into(),
            quality: "good".into(),
            badge: Some("Balanced".into()),
            uncensored: false,
            // sha256 of the 5 bytes "hello" — real, so store tests can verify.
            sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824".into(),
            url: "https://example.invalid/model.gguf".into(),
            license: "apache-2.0".into(),
            repo: "test/repo".into(),
        }
    }

    pub fn catalog(models: Vec<ModelEntry>) -> Catalog {
        Catalog { version: 1, slots: vec!["rewrite".into()], models }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fixtures::{catalog as fixture_catalog, entry};

    #[test]
    fn a_well_formed_catalog_is_accepted() {
        let c = fixture_catalog(vec![entry("a", "low", 2.0), entry("b", "mid", 3.5)]);
        assert!(validate(&c).is_ok());
    }

    #[test]
    fn every_defect_that_would_break_a_download_is_rejected() {
        // An empty catalog is a stub, not a shippable list.
        assert_eq!(validate(&fixture_catalog(vec![])).unwrap_err(), "bad_catalog");

        let broken: Vec<(&str, fn(&mut ModelEntry))> = vec![
            ("short sha", |m| m.sha256.truncate(10)),
            ("uppercase sha", |m| m.sha256 = m.sha256.to_uppercase()),
            ("non-hex sha", |m| m.sha256 = "z".repeat(64)),
            ("plain http", |m| m.url = "http://example.invalid/m.gguf".into()),
            ("no size", |m| m.size_bytes = 0),
            ("no ram hint", |m| m.ram_hint_gb = 0.0),
            ("unknown tier", |m| m.tier = "medium".into()),
            ("unknown task", |m| m.task = "chat".into()),
            ("unknown speed", |m| m.speed = "quick".into()),
            ("unknown quality", |m| m.quality = "great".into()),
            ("blank id", |m| m.id = "  ".into()),
        ];
        for (what, break_it) in broken {
            let mut model = entry("a", "mid", 3.5);
            break_it(&mut model);
            assert_eq!(
                validate(&fixture_catalog(vec![model])).unwrap_err(),
                "bad_catalog",
                "{what} should have been rejected"
            );
        }
    }

    #[test]
    fn duplicate_ids_are_rejected() {
        let c = fixture_catalog(vec![entry("same", "low", 2.0), entry("same", "mid", 3.5)]);
        assert_eq!(validate(&c).unwrap_err(), "bad_catalog");
    }

    #[test]
    fn malformed_json_is_an_error_not_a_panic() {
        assert_eq!(parse("{").unwrap_err(), "bad_catalog");
        assert_eq!(parse("{\"version\":1,\"models\":[]}").unwrap_err(), "bad_catalog");
    }

    /// The guard on the catalog we actually ship: every entry present must be
    /// downloadable. A wrong hash or a non-https URL here would fail on every
    /// user's machine, so this runs against the real embedded file.
    ///
    /// It deliberately does not require entries to EXIST. `models/catalog.json`
    /// still holds the version-0 stub, which `catalog()` rejects as
    /// `bad_catalog` — the right behaviour, since an empty catalog has nothing
    /// to offer. Filling the ladder is tracked as its own M4 deliverable.
    #[test]
    fn no_entry_in_the_shipped_catalog_would_break_its_download() {
        let raw: Catalog = serde_json::from_str(EMBEDDED)
            .expect("models/catalog.json must at least be well-formed JSON");
        for model in &raw.models {
            assert!(
                validate(&fixture_catalog(vec![model.clone()])).is_ok(),
                "catalog entry {} would break at download time",
                model.id
            );
        }
        if raw.models.is_empty() {
            assert_eq!(catalog().unwrap_err(), "bad_catalog", "a stub must not load as usable");
        }
    }
}
