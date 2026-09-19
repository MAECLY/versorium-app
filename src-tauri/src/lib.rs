//! Versorium — local-first novel studio.
//!
//! Business logic that touches files, git, models, or MCP lives in Rust.
//! The frontend talks to these modules through Tauri commands.

mod commands;
mod git;
mod ops;
mod storage;
mod text;
mod agents;
pub mod i18n;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let store = commands::settings::SettingsStore::load(dir.join("settings.json"));
            app.manage(store);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::project::app_info,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Versorium");
}
