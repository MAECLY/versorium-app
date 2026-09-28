//! Paths shared by the GUI process and the `versorium mcp` CLI process.
//!
//! Both must resolve the same app-data directory or they would read different
//! settings. Tauri's `app_data_dir()` is `dirs::data_dir()/<identifier>`, so the
//! CLI — which runs before any Tauri app exists — reproduces it from the same
//! identifier. A test pins the identifier to `tauri.conf.json`.

use std::path::PathBuf;

/// Must equal `identifier` in `tauri.conf.json`.
pub const APP_IDENTIFIER: &str = "dev.versorium.app";

/// Overrides the app-data location. Exists so a test can drive the real binary
/// without writing into the user's settings and MCP log; it is not a supported
/// way to run the app (portable mode is a later version, spec §20).
pub const DATA_DIR_ENV: &str = "VERSORIUM_DATA_DIR";

/// `~/Library/Application Support/dev.versorium.app` (macOS) and the platform
/// equivalents. Same value as Tauri's `app.path().app_data_dir()`.
pub fn app_data_dir() -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os(DATA_DIR_ENV).filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(dir));
    }
    dirs::data_dir()
        .map(|dir| dir.join(APP_IDENTIFIER))
        .ok_or_else(|| "no_home".to_string())
}

pub fn settings_path() -> Result<PathBuf, String> {
    app_data_dir().map(|dir| dir.join("settings.json"))
}

/// Tool-call log surfaced in Settings → MCP. Never holds manuscript prose.
pub fn mcp_log_path() -> Result<PathBuf, String> {
    app_data_dir().map(|dir| dir.join("mcp-log.jsonl"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifier_matches_tauri_config() {
        let raw = include_str!("../tauri.conf.json");
        let conf: serde_json::Value = serde_json::from_str(raw).unwrap();
        assert_eq!(conf["identifier"].as_str(), Some(APP_IDENTIFIER));
    }

    #[test]
    fn settings_and_log_live_in_the_app_data_dir() {
        let dir = app_data_dir().unwrap();
        assert!(dir.ends_with(APP_IDENTIFIER));
        assert_eq!(settings_path().unwrap(), dir.join("settings.json"));
        assert_eq!(mcp_log_path().unwrap(), dir.join("mcp-log.jsonl"));
    }
}
