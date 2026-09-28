//! Versorium — local-first novel studio.
//!
//! Business logic that touches files, git, models, or MCP lives in Rust.
//! The frontend talks to these modules through Tauri commands.

mod commands;
mod formats;
mod git;
mod ops;
mod mcp;
mod models;
pub mod paths;
mod storage;
mod text;
mod agents;
pub mod i18n;

use tauri::Manager;

pub fn run() {
    // `versorium mcp` serves stdio instead of opening a window (spec §7/§13).
    if let Some(options) = mcp::parse_cli(std::env::args()) {
        std::process::exit(mcp::serve_stdio(options));
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // paths::settings_path() so the `versorium mcp` process reads the same file.
            let store = commands::settings::SettingsStore::load(paths::settings_path()?);
            app.manage(store);
            // Debug builds only: VERSORIUM_DEVTOOLS=1 opens the WebKit/WebView2
            // inspector at launch so a blank window can be diagnosed from a terminal.
            #[cfg(debug_assertions)]
            if std::env::var_os("VERSORIUM_DEVTOOLS").is_some() {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            // The window starts hidden (tauri.conf.json) and the frontend shows it
            // once mounted: no white flash, and WebKit starts painting from a
            // visible state. If the frontend never reports, show it anyway.
            if let Some(window) = app.get_webview_window("main") {
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    if !window.is_visible().unwrap_or(true) {
                        let _ = window.show();
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::project::app_info,
            commands::project::ui_ready,
            commands::project::default_projects_dir,
            commands::project::list_projects,
            commands::project::create_project,
            commands::project::open_project,
            commands::project::create_chapter,
            commands::chapters::list_chapters,
            commands::chapters::read_chapter,
            commands::chapters::save_chapter,
            commands::settings::get_settings,
            commands::settings::set_settings,
            commands::git::git_status,
            commands::git::git_log,
            commands::git::git_diff,
            commands::git::git_commit,
            commands::git::git_auto_checkpoint,
            commands::git::git_branches,
            commands::git::git_branch_create,
            commands::git::git_checkout_file,
            commands::git::git_remotes,
            commands::git::git_remote_add,
            commands::git::git_remote_remove,
            commands::git::github_me,
            commands::git::github_owners,
            commands::git::github_create_repo,
            commands::git::github_list_repos,
            commands::ops::ops_append,
            commands::ops::ops_recent,
            commands::ops::ops_snapshots,
            commands::ops::ops_restore_snapshot,
            commands::ai::agents_detect,
            commands::ai::ai_rewrite,
            commands::ai::ai_apply_rewrite,
            commands::mcp::mcp_status,
            commands::mcp::mcp_set_write,
            commands::mcp::mcp_install_client,
            commands::mcp::mcp_uninstall_client,
            commands::mcp::mcp_log,
            commands::mcp::mcp_set_active_project,
            commands::models::models_view,
            commands::models::models_download,
            commands::models::models_cancel,
            commands::models::models_delete,
            commands::models::models_progress,
            commands::models::models_set_slot,
            commands::models::ollama_pull,
            commands::models::ollama_remove,
            commands::models::studio_test,
            commands::models::studio_save,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Versorium");
}
