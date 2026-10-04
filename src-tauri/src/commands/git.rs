//! Tauri commands wrapping the git engine + GitHub API.

use crate::git::lock::{self, Wait};
use crate::git::{github, repo};
use std::path::PathBuf;

#[tauri::command]
pub fn git_status(path: PathBuf) -> Result<repo::StatusInfo, String> {
    repo::status(&path)
}

#[tauri::command]
pub fn git_log(path: PathBuf, limit: Option<usize>) -> Result<Vec<repo::CommitInfo>, String> {
    repo::log(&path, limit.unwrap_or(50).clamp(1, 200))
}

#[tauri::command]
pub fn git_diff(path: PathBuf) -> Result<String, String> {
    repo::diff(&path)
}

/// Save snapshot.
///
/// Off the main thread, because it can wait: a backup reading the history
/// holds the repository lock for a moment, and the window must not freeze for
/// it. `App.doCommit` saves before calling this, so nothing is reordered.
#[tauri::command(async)]
pub fn git_commit(path: PathBuf, message: String) -> Result<String, String> {
    let msg = message.trim();
    if msg.is_empty() {
        return Err("empty_message".to_string());
    }
    repo::commit_all_waiting(&path, msg, Wait::Upto(lock::BACKGROUND_WAIT))
}

/// The 60-second checkpoint. It never waits: while a backup is reading the
/// history it commits nothing, and the next minute does.
#[tauri::command]
pub fn git_auto_checkpoint(path: PathBuf) -> Result<Option<String>, String> {
    let st = repo::status(&path)?;
    let dirty =
        !st.modified.is_empty() || !st.staged.is_empty() || !st.untracked.is_empty();
    if !dirty {
        return Ok(None);
    }
    match repo::commit_all_waiting(&path, "checkpoint: autosave", Wait::TryOnly) {
        Ok(sha) => Ok(Some(sha)),
        Err(code) if code == lock::BUSY => Ok(None),
        Err(code) => Err(code),
    }
}

#[tauri::command]
pub fn git_branches(path: PathBuf) -> Result<repo::BranchInfo, String> {
    repo::branches(&path)
}

#[tauri::command]
pub fn git_branch_create(path: PathBuf, name: String) -> Result<String, String> {
    repo::branch_create(&path, &name)
}

#[tauri::command]
pub fn git_checkout_file(path: PathBuf, file: String, sha: Option<String>) -> Result<(), String> {
    repo::checkout_file(&path, &file, sha.as_deref())
}

#[tauri::command]
pub fn git_remotes(path: PathBuf) -> Result<Vec<repo::RemoteInfo>, String> {
    repo::remotes(&path)
}

#[tauri::command]
pub fn git_remote_add(path: PathBuf, name: String, url: String) -> Result<(), String> {
    repo::remote_add(&path, &name, &url)
}

#[tauri::command]
pub fn git_remote_remove(path: PathBuf, name: String) -> Result<(), String> {
    repo::remote_remove(&path, &name)
}

/// Validate a GitHub token and return the login (used by both OAuth slots).
#[tauri::command]
pub async fn github_me(token: String) -> Result<String, String> {
    let u = github::me(&token).await?;
    Ok(u.login)
}

/// Create a private repo under the token's user; returns clone URL.
#[tauri::command]
pub async fn github_create_repo(token: String, name: String, owner: Option<String>) -> Result<String, String> {
    github::create_repo(&token, &name, true, owner.as_deref()).await
}

#[tauri::command]
pub async fn github_owners(token: String) -> Result<Vec<github::GhOwner>, String> {
    github::owners(&token).await
}

#[tauri::command]
pub async fn github_list_repos(token: String) -> Result<Vec<serde_json::Value>, String> {
    let repos = github::list_repos(&token).await?;
    Ok(repos
        .into_iter()
        .map(|(n, p)| serde_json::json!({ "name": n, "private": p }))
        .collect())
}

/// Send the novel's current branch to its remote.
///
/// The token comes from the credential store, not from the caller: a frontend
/// that had to pass it would need to hold it, which is the round trip the
/// keychain change removed.
///
/// Blocking, and it is network work, so it goes to a blocking thread.
#[tauri::command]
pub async fn git_push(path: PathBuf, remote: Option<String>) -> Result<String, String> {
    let remote = remote.unwrap_or_else(|| "origin".to_string());
    let token = novel_token().await?;
    tauri::async_runtime::spawn_blocking(move || repo::push(&path, &remote, &token))
        .await
        .map_err(|_| "io".to_string())?
}

/// Fetch and fast-forward. Refuses rather than merging when the histories have
/// diverged: resolving a conflict is a feature this editor does not have yet,
/// and a half-merged manuscript is worse than a clear refusal.
#[tauri::command]
pub async fn git_pull(path: PathBuf, remote: Option<String>) -> Result<repo::PullOutcome, String> {
    let remote = remote.unwrap_or_else(|| "origin".to_string());
    let token = novel_token().await?;
    tauri::async_runtime::spawn_blocking(move || repo::pull(&path, &remote, &token))
        .await
        .map_err(|_| "io".to_string())?
}

/// The writer's own GitHub token, from the OS credential store.
async fn novel_token() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| crate::secrets::get(crate::secrets::Slot::Novel))
        .await
        .map_err(|_| "io".to_string())??
        .ok_or_else(|| "not_signed_in".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::lock::RepoLock;
    use std::path::Path;
    use std::time::{Duration, Instant};

    fn novel_with_a_change() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("el-faro");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("ch-01.md"), "Uno.\n").unwrap();
        repo::init_with_commit(&root).unwrap();
        std::fs::write(root.join("ch-01.md"), "Dos.\n").unwrap();
        (dir, root)
    }

    /// The novel's history held, as a backup reading it holds it, for `held`.
    fn read_for(root: &Path, held: Duration) -> std::thread::JoinHandle<()> {
        let lock = RepoLock::acquire(root, Wait::TryOnly).unwrap();
        std::thread::spawn(move || {
            std::thread::sleep(held);
            drop(lock);
        })
    }

    #[test]
    fn save_snapshot_waits_out_a_backup_reading_the_history() {
        // Longer than a commit on the main thread would wait.
        let (_dir, root) = novel_with_a_change();
        let backup = read_for(&root, Duration::from_millis(2500));
        let sha = git_commit(root.clone(), "Instantánea".into());
        backup.join().unwrap();
        assert_eq!(sha.map(|sha| sha.len()), Ok(40));
    }

    #[test]
    fn a_commit_made_on_the_main_thread_waits_two_seconds_at_most() {
        // The checkpoint before an AI rewrite or a chapter delete: it waits
        // out a capture, and past two seconds says the history is busy.
        let (_dir, root) = novel_with_a_change();
        let backup = read_for(&root, Duration::from_millis(300));
        assert!(repo::commit_all(&root, "checkpoint: before ai rewrite").is_ok());
        backup.join().unwrap();

        std::fs::write(root.join("ch-01.md"), "Tres.\n").unwrap();
        let _stuck = RepoLock::acquire(&root, Wait::TryOnly).unwrap();
        let started = Instant::now();
        assert_eq!(repo::commit_all(&root, "checkpoint: before deleting ch-01.md").unwrap_err(), lock::BUSY);
        let waited = started.elapsed();
        assert!(waited >= Duration::from_secs(2) && waited < Duration::from_secs(3), "{waited:?}");
    }
}
