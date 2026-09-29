//! Versorium — local-first novel studio.
//!
//! Business logic that touches files, git, models, or MCP lives in Rust.
//! The frontend talks to these modules through Tauri commands.

mod backup;
mod commands;
mod continuity;
mod crash;
mod fonts;
mod formats;
mod git;
mod llama;
mod ops;
mod mcp;
mod models;
pub mod paths;
mod secrets;
mod storage;
mod text;
mod update;
mod agents;
pub mod i18n;

use tauri::Manager;

pub fn run() {
    // Records a scrubbed crash file locally. Nothing is sent: spec §12.
    crash::install_panic_hook();

    // `versorium mcp` serves stdio instead of opening a window (spec §7/§13).
    if let Some(options) = mcp::parse_cli(std::env::args()) {
        std::process::exit(mcp::serve_stdio(options));
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
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
            // Start llama.cpp now, not on the first rewrite. Initializing it
            // compiles the embedded Metal shaders, measured at ~15 s on an M4
            // Max, so paying it here makes it invisible unless somebody asks
            // for a rewrite in the first few seconds of a session.
            llama::warm_up();

            // Serve MCP over HTTP too, if the writer asked for it. Off by
            // default: it opens a listener on a machine whose MCP tools can
            // write to a manuscript.
            {
                let enabled = app
                    .state::<commands::settings::SettingsStore>()
                    .get()
                    .mcp_http_enabled;
                mcp::http::start_if_enabled(enabled, mcp::DEFAULT_CLIENT.to_string());
            }

            // Move any token still in settings.json into the OS credential
            // store. Blocking and possibly prompt-raising, so not on the path
            // that opens the window.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let store = handle.state::<commands::settings::SettingsStore>();
                secrets::migrate_from_settings(&store);
            });

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
            commands::secrets::secrets_status,
            commands::secrets::secrets_connect,
            commands::secrets::secrets_forget,
            commands::backup::backup_destinations,
            commands::backup::backup_configure,
            commands::backup::backup_now,
            commands::backup::backup_list,
            commands::backup::backup_restore,
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
            commands::git::git_push,
            commands::git::git_pull,
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
            commands::mcp::mcp_http_status,
            commands::mcp::mcp_set_http,
            commands::models::models_view,
            commands::models::models_download,
            commands::models::models_cancel,
            commands::models::models_delete,
            commands::models::models_progress,
            commands::llama::llama_backend,
            commands::llama::llama_progress,
            commands::llama::llama_cancel,
            commands::llama::llama_unload,
            commands::models::models_set_slot,
            commands::models::ollama_pull,
            commands::models::ollama_remove,
            commands::models::studio_test,
            commands::models::studio_save,
            commands::formats::export_manuscript,
            commands::formats::import_preview,
            commands::formats::import_apply,
            commands::formats::set_author,
            commands::update::update_status,
            commands::update::update_check,
            commands::update::update_install,
            commands::update::update_progress,
            commands::update::update_relaunch,
            commands::update::update_skip,
            commands::update::update_set_channel,
            commands::update::update_set_automatic,
            commands::polish::crash_list,
            commands::polish::crash_report_url,
            commands::polish::crash_clear,
            commands::polish::continuity_check,
            commands::polish::fonts_catalog,
            commands::polish::editor_font,
            commands::polish::set_editor_font,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Versorium");
}
