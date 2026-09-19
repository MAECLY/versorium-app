//! libgit2 repository operations for novel projects.

use git2::{BranchType, DiffOptions, Repository, Signature};
use serde::Serialize;
use std::path::Path;

const APP_NAME: &str = "Versorium";
const APP_EMAIL: &str = "versorium@local";

fn open(root: &Path) -> Result<Repository, String> {
    Repository::open(root).map_err(|_| "no_repo".to_string())
}

fn sig() -> Result<Signature<'static>, String> {
    Signature::now(APP_NAME, APP_EMAIL).map_err(|_| "io".to_string())
}

/// Init a repo if needed and create the first commit with everything present.
pub fn init_with_commit(root: &Path) -> Result<String, String> {
    let repo = Repository::init(root).map_err(|_| "io".to_string())?;
    // libgit2 defaults the initial branch to master; pin it to main.
    if repo.head().is_err() {
        repo.set_head("refs/heads/main").map_err(|_| "io".to_string())?;
    }
    commit_all(root, "m0: project created")
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusInfo {
    pub branch: Option<String>,
    pub modified: Vec<String>,
    pub staged: Vec<String>,
    pub untracked: Vec<String>,
    pub ahead: i32,
    pub behind: i32,
}

fn ahead_behind(repo: &Repository) -> (i32, i32) {
    let upstream = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(String::from))
        .and_then(|name| repo.find_branch(&name, BranchType::Local).ok())
        .and_then(|b| b.upstream().ok())
        .and_then(|b| b.name().ok().flatten().map(String::from));
    let Some(upstream) = upstream else { return (0, 0) };
    let count = |range: &str| -> i32 {
        repo.revwalk()
            .ok()
            .and_then(|mut w| {
                w.push_range(range).ok()?;
                Some(w)
            })
            .map(|w| w.flatten().count() as i32)
            .unwrap_or(0)
    };
    (count(&format!("{upstream}..HEAD")), count(&format!("HEAD..{upstream}")))
}

pub fn status(root: &Path) -> Result<StatusInfo, String> {
    let repo = open(root)?;
    let mut modified = Vec::new();
    let mut staged = Vec::new();
    let mut untracked = Vec::new();
    let mut si = git2::StatusOptions::new();
    si.include_untracked(true).recurse_untracked_dirs(true).exclude_submodules(true);
    let statuses = repo.statuses(Some(&mut si)).map_err(|_| "io".to_string())?;
    for e in statuses.iter() {
        let name = e.path().unwrap_or("?").to_string();
        let st = e.status();
        if st.is_wt_new() {
            untracked.push(name.clone());
        }
        if st.is_wt_modified() || st.is_wt_deleted() || st.is_wt_renamed() || st.is_wt_typechange() || st.is_conflicted() {
            modified.push(name.clone());
        }
        if st.is_index_modified() || st.is_index_new() || st.is_index_deleted() || st.is_index_renamed() || st.is_index_typechange() {
            staged.push(name);
        }
    }
    let branch = repo.head().ok().and_then(|h| h.shorthand().map(String::from));
    let (ahead, behind) = ahead_behind(&repo);
    Ok(StatusInfo { branch, modified, staged, untracked, ahead, behind })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub sha: String,
    pub short: String,
    pub author: String,
    pub time: i64,
    pub message: String,
}

pub fn log(root: &Path, limit: usize) -> Result<Vec<CommitInfo>, String> {
    let repo = open(root)?;
    let mut walk = repo.revwalk().map_err(|_| "io".to_string())?;
    walk.push_head().map_err(|_| "no_commits".to_string())?;
    let mut out = Vec::new();
    for sha in walk.flatten().take(limit) {
        if let Ok(c) = repo.find_commit(sha) {
            out.push(CommitInfo {
                sha: c.id().to_string(),
                short: c.id().to_string().chars().take(7).collect(),
                author: c.author().name().unwrap_or("?").to_string(),
                time: c.time().seconds(),
                message: c.message().unwrap_or("").trim().to_string(),
            });
        }
    }
    Ok(out)
}

/// Unified diff HEAD -> workdir (staged + unstaged).
pub fn diff(root: &Path) -> Result<String, String> {
    let repo = open(root)?;
    let head = match repo.head().and_then(|h| h.peel_to_commit()) {
        Ok(c) => c,
        Err(_) => return Ok(String::new()), // unborn HEAD: nothing to diff
    };
    let tree = head.tree().map_err(|_| "io".to_string())?;
    let mut opts = DiffOptions::new();
    opts.context_lines(3);
    opts.include_untracked(true).recurse_untracked_dirs(true).show_untracked_content(true);
    let d = repo
        .diff_tree_to_workdir_with_index(Some(&tree), Some(&mut opts))
        .map_err(|_| "io".to_string())?;
    let mut out = String::new();
    d.print(git2::DiffFormat::Patch, |_, _, line| {
        if matches!(line.origin(), '+' | '-' | ' ') { out.push(line.origin()); }
        out.push_str(&String::from_utf8_lossy(line.content()));
        true
    })
    .map_err(|_| "io".to_string())?;
    Ok(out)
}

/// Stage everything and commit. Returns the new sha.
pub fn commit_all(root: &Path, message: &str) -> Result<String, String> {
    let repo = open(root)?;
    let mut index = repo.index().map_err(|_| "io".to_string())?;
    index.update_all(["*"], None).map_err(|_| "io".to_string())?;
    index
        .add_all(["*"], git2::IndexAddOption::DEFAULT, None)
        .map_err(|_| "io".to_string())?;
    index.write().map_err(|_| "io".to_string())?;
    let tree_id = index.write_tree().map_err(|_| "io".to_string())?;
    let tree = repo.find_tree(tree_id).map_err(|_| "io".to_string())?;
    let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    if parent.as_ref().is_some_and(|commit| commit.tree_id() == tree_id) {
        return Err("nothing_to_commit".into());
    }
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    let s = sig()?;
    let oid = repo
        .commit(Some("HEAD"), &s, &s, message, &tree, &parents)
        .map_err(|e| {
            let m = e.message();
            if m.contains("nothing to commit") || m.contains("cannot commit") {
                "nothing_to_commit".to_string()
            } else {
                "io".to_string()
            }
        })?;
    Ok(oid.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub current: Option<String>,
    pub branches: Vec<String>,
}

pub fn branches(root: &Path) -> Result<BranchInfo, String> {
    let repo = open(root)?;
    let current = repo.head().ok().and_then(|h| h.shorthand().map(|s| s.to_string()));
    let mut list = Vec::new();
    if let Ok(bs) = repo.branches(Some(BranchType::Local)) {
        for (branch, _t) in bs.flatten() {
            if let Ok(Some(name)) = branch.name() {
                list.push(name.to_string());
            }
        }
    }
    Ok(BranchInfo { current, branches: list })
}

pub fn branch_create(root: &Path, name: &str) -> Result<String, String> {
    if name.is_empty() || name.contains('/') {
        return Err("bad_branch".to_string());
    }
    let repo = open(root)?;
    let head = repo
        .head()
        .map_err(|_| "no_commits".to_string())?
        .peel_to_commit()
        .map_err(|_| "no_commits".to_string())?;
    repo.branch(name, &head, false).map_err(|_| "branch_exists".to_string())?;
    repo.set_head(&format!("refs/heads/{name}"))
        .map_err(|_| "io".to_string())?;
    Ok(name.to_string())
}

/// Restore one file from a commit (default HEAD). Used by rollback.
pub fn checkout_file(root: &Path, file: &str, sha: Option<&str>) -> Result<(), String> {
    let repo = open(root)?;
    let commit = match sha {
        Some(s) => repo
            .find_commit(git2::Oid::from_str(s).map_err(|_| "bad_sha".to_string())?)
            .map_err(|_| "no_commit".to_string())?,
        None => {
            let head = repo.head().map_err(|_| "no_commits".to_string())?;
            head.peel_to_commit().map_err(|_| "no_commits".to_string())?
        }
    };
    let tree = commit.tree().map_err(|_| "io".to_string())?;
    let entry =
        tree.get_path(Path::new(file)).map_err(|_| "not_found".to_string())?;
    let obj = entry.to_object(&repo).map_err(|_| "not_found".to_string())?;
    let blob = obj.as_blob().ok_or("not_found".to_string())?;
    crate::storage::atomic_write(&crate::storage::project_file(root, file)?, blob.content())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub name: String,
    pub url: String,
}

pub fn remotes(root: &Path) -> Result<Vec<RemoteInfo>, String> {
    let repo = open(root)?;
    let mut out = Vec::new();
    for name in repo.remotes().map_err(|_| "io".to_string())?.iter().flatten() {
        if let Ok(r) = repo.find_remote(name) {
            out.push(RemoteInfo {
                name: name.to_string(),
                url: r.url().unwrap_or("").to_string(),
            });
        }
    }
    Ok(out)
}

pub fn remote_add(root: &Path, name: &str, url: &str) -> Result<(), String> {
    let repo = open(root)?;
    repo.remote(name, url).map_err(|_| "io".to_string())?;
    Ok(())
}

pub fn remote_remove(root: &Path, name: &str) -> Result<(), String> {
    let repo = open(root)?;
    repo.remote_delete(name).map_err(|_| "not_found".to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp_repo() -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        fs::write(root.join("a.md"), "hello\n").unwrap();
        (dir, root)
    }

    #[test]
    fn init_status_commit_log() {
        let (_dir, root) = tmp_repo();
        init_with_commit(&root).unwrap();
        let st = status(&root).unwrap();
        assert_eq!(st.modified.len(), 0);
        assert_eq!(st.branch.as_deref(), Some("main"));

        fs::write(root.join("a.md"), "hello world\n").unwrap();
        let st = status(&root).unwrap();
        assert!(st.modified.iter().any(|f| f == "a.md"));

        let d = diff(&root).unwrap();
        assert!(d.contains("+hello world"));

        let sha = commit_all(&root, "tweak").unwrap();
        assert_eq!(sha.len(), 40);
        let log = log(&root, 10).unwrap();
        assert_eq!(log.len(), 2);
        assert_eq!(log[0].message, "tweak");
        assert_eq!(status(&root).unwrap().modified.len(), 0);
    }

    #[test]
    fn branches_and_checkout() {
        let (_dir, root) = tmp_repo();
        init_with_commit(&root).unwrap();
        let b = branch_create(&root, "drafts").unwrap();
        assert_eq!(b, "drafts");
        assert_eq!(branches(&root).unwrap().current.as_deref(), Some("drafts"));

        fs::write(root.join("a.md"), "changed\n").unwrap();
        commit_all(&root, "on branch").unwrap();
        checkout_file(&root, "a.md", None).unwrap();
        // back at branch tip content
        assert_eq!(fs::read_to_string(root.join("a.md")).unwrap(), "changed\n");
    }

    #[test]
    fn remote_roundtrip() {
        let (_dir, root) = tmp_repo();
        init_with_commit(&root).unwrap();
        remote_add(&root, "origin", "https://example.com/x.git").unwrap();
        let rs = remotes(&root).unwrap();
        assert_eq!(rs[0].name, "origin");
        remote_remove(&root, "origin").unwrap();
        assert!(remotes(&root).unwrap().is_empty());
    }

    #[test]
    fn no_repo_errors() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(status(dir.path()).unwrap_err(), "no_repo");
    }
}
