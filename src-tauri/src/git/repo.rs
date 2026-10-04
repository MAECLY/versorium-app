//! libgit2 repository operations for novel projects.

use crate::git::lock::{RepoLock, Wait, BACKGROUND_WAIT, COMMIT_WAIT};
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
///
/// Waits up to `COMMIT_WAIT` for a backup that is reading the history: the
/// commands that call this run on the main thread.
pub fn commit_all(root: &Path, message: &str) -> Result<String, String> {
    commit_all_waiting(root, message, Wait::Upto(COMMIT_WAIT))
}

/// `commit_all`, waiting for the repository lock as long as the caller can
/// afford. `Err("repo_busy")` when it is still held after that.
pub fn commit_all_waiting(root: &Path, message: &str, wait: Wait) -> Result<String, String> {
    let _history = RepoLock::acquire(root, wait)?;
    commit_unlocked(root, message)
}

/// What a writer that never takes the lock does, such as `git` run by hand in
/// a terminal. For the tests that show the backup stays whole even then.
#[cfg(test)]
pub fn commit_ignoring_the_lock(root: &Path, message: &str) -> Result<String, String> {
    commit_unlocked(root, message)
}

fn commit_unlocked(root: &Path, message: &str) -> Result<String, String> {
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

/// What a pull did, so the UI can say "already up to date" rather than claiming
/// it fetched something.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullOutcome {
    pub branch: String,
    pub changed: bool,
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

/// Whether a URL is somewhere this token is allowed to go.
///
/// The token is a GitHub personal access token with `repo` scope — read and
/// write over every private repository the writer owns. It must never be handed
/// to anything else.
///
/// That is not hypothetical here. Nothing in Versorium ever creates a remote:
/// `remote_add` is not reachable from the UI, so every `origin` this code will
/// ever see was written into `.git/config` by something outside the app — a
/// clone, a folder from a writing partner, a self-hosted forge. git's own
/// credential helpers are host-scoped and would never hand a github.com
/// credential to another host; without this check, this app would.
///
/// `http://` is refused as well as the wrong host: plaintext Basic auth puts
/// the token on the wire in the clear.
pub fn is_github_https(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else { return false };
    // Credentials in the URL are ignored by everything downstream, so a
    // `user@evil.tld` prefix must not be read as the host.
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = authority.rsplit('@').next().unwrap_or("");
    // A port is allowed to be present but not to smuggle a second host.
    let host = host.split(':').next().unwrap_or("").to_ascii_lowercase();
    host == "github.com" || host.ends_with(".github.com")
}

/// Read a remote's URL and refuse it if the token has no business going there.
fn checked_remote<'a>(
    repo: &'a Repository,
    remote: &str,
) -> Result<git2::Remote<'a>, String> {
    let origin = repo.find_remote(remote).map_err(|_| "no_remote".to_string())?;
    match origin.url() {
        Some(url) if is_github_https(url) => Ok(origin),
        _ => Err("remote_not_github".to_string()),
    }
}

/// Credentials for a GitHub HTTPS remote.
///
/// A personal access token goes in the password field; GitHub ignores the
/// username, and `x-access-token` is the name it documents. Only
/// `USER_PASS_PLAINTEXT` is offered, so libgit2 cannot wander off into ssh keys
/// or a credential helper that might prompt on a machine with no terminal.
///
/// The URL is checked again here, inside the callback, even though the caller
/// already validated the remote. libgit2 follows redirects, and the host it
/// ends up authenticating against is not necessarily the one configured.
fn token_callbacks(token: &str) -> git2::RemoteCallbacks<'_> {
    let mut callbacks = git2::RemoteCallbacks::new();
    callbacks.credentials(move |url, _username, allowed| {
        if !is_github_https(url) {
            return Err(git2::Error::from_str("refusing to send credentials to a non-GitHub host"));
        }
        if allowed.contains(git2::CredentialType::USER_PASS_PLAINTEXT) {
            git2::Cred::userpass_plaintext("x-access-token", token)
        } else {
            Err(git2::Error::from_str("unsupported credential type"))
        }
    });
    callbacks
}

/// libgit2's own message is the only way to tell a wrong token from an
/// unreachable host, and both need different sentences.
fn network_code(error: &git2::Error) -> String {
    let message = error.message().to_lowercase();
    if message.contains("authentication") || message.contains("401") || message.contains("403") {
        "git_auth_failed".to_string()
    } else if message.contains("cannot push") || message.contains("non-fast-forward") {
        "git_behind_remote".to_string()
    } else {
        "network".to_string()
    }
}

fn head_branch(repo: &Repository) -> Result<String, String> {
    let head = repo.head().map_err(|_| "no_commits".to_string())?;
    head.shorthand().map(str::to_string).ok_or_else(|| "no_commits".to_string())
}

/// Send the current branch to a remote.
///
/// Sets the upstream on success, so a later pull knows what to compare against
/// without the writer configuring anything.
pub fn push(root: &Path, remote: &str, token: &str) -> Result<String, String> {
    let repo = open(root)?;
    let branch = head_branch(&repo)?;
    let mut origin = checked_remote(&repo, remote)?;

    let mut options = git2::PushOptions::new();
    options.remote_callbacks(token_callbacks(token));
    let refspec = format!("refs/heads/{branch}:refs/heads/{branch}");
    origin
        .push(&[refspec.as_str()], Some(&mut options))
        .map_err(|e| network_code(&e))?;

    // Best effort: the push already succeeded, and failing the call because the
    // bookkeeping did not would report a false negative.
    if let Ok(mut local) = repo.find_branch(&branch, BranchType::Local) {
        let _ = local.set_upstream(Some(&format!("{remote}/{branch}")));
    }
    Ok(branch)
}

/// Fetch and fast-forward the current branch.
///
/// Deliberately not a merge. A real merge can conflict, and resolving a conflict
/// inside a novel editor is a feature of its own; refusing with
/// `git_diverged` and leaving the work untouched is the honest outcome until
/// that exists.
pub fn pull(root: &Path, remote: &str, token: &str) -> Result<PullOutcome, String> {
    let repo = open(root)?;
    let branch = head_branch(&repo)?;
    let mut origin = checked_remote(&repo, remote)?;

    let mut options = git2::FetchOptions::new();
    options.remote_callbacks(token_callbacks(token));
    origin
        .fetch(&[branch.as_str()], Some(&mut options), None)
        .map_err(|e| network_code(&e))?;
    drop(origin);
    drop(repo);
    fast_forward(root, &branch, Wait::Upto(BACKGROUND_WAIT))
}

/// The local half of a pull: move the branch to what was fetched, then make
/// the working tree match it.
///
/// Under the repository lock, so a backup never reads the history halfway
/// through it. The fetch before it stays outside: it is network work that can
/// take minutes, it writes its objects before its refs, and the backup's read
/// order already copes with that.
fn fast_forward(root: &Path, branch: &str, wait: Wait) -> Result<PullOutcome, String> {
    let _history = RepoLock::acquire(root, wait)?;
    let repo = open(root)?;
    let branch = branch.to_string();
    let fetch_head = repo.find_reference("FETCH_HEAD").map_err(|_| "network".to_string())?;
    let incoming = repo.reference_to_annotated_commit(&fetch_head).map_err(|_| "io".to_string())?;
    let (analysis, _) = repo.merge_analysis(&[&incoming]).map_err(|_| "io".to_string())?;

    if analysis.is_up_to_date() {
        return Ok(PullOutcome { branch, changed: false });
    }
    if !analysis.is_fast_forward() {
        return Err("git_diverged".into());
    }

    // Fast-forward: move the ref, then make the working tree match it.
    let name = format!("refs/heads/{branch}");
    let mut reference = repo.find_reference(&name).map_err(|_| "io".to_string())?;
    reference
        .set_target(incoming.id(), "versorium: fast-forward")
        .map_err(|_| "io".to_string())?;
    repo.set_head(&name).map_err(|_| "io".to_string())?;
    repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))
        .map_err(|_| "io".to_string())?;
    Ok(PullOutcome { branch, changed: true })
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

    #[test]
    fn a_wrong_token_is_told_apart_from_an_unreachable_host() {
        // These need different sentences: one is "check your token", the other
        // is "check your connection", and collapsing them sends people to the
        // wrong place.
        let auth = git2::Error::from_str("authentication required but no callback set");
        assert_eq!(network_code(&auth), "git_auth_failed");
        let denied = git2::Error::from_str("too many redirects or authentication replays: 403");
        assert_eq!(network_code(&denied), "git_auth_failed");

        let stale = git2::Error::from_str("cannot push non-fast-forward reference");
        assert_eq!(network_code(&stale), "git_behind_remote");

        let offline = git2::Error::from_str("failed to resolve address for github.com");
        assert_eq!(network_code(&offline), "network");
    }

    #[test]
    fn pushing_without_a_remote_says_so_rather_than_failing_as_a_network_error() {
        let (_dir, root) = tmp_repo();
        init_with_commit(&root).unwrap();
        assert_eq!(push(&root, "origin", "ghp_x").unwrap_err(), "no_remote");
        assert_eq!(pull(&root, "origin", "ghp_x").unwrap_err(), "no_remote");
    }

    #[test]
    fn pushing_a_repository_with_no_commits_is_refused_before_the_network() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        Repository::init(&root).unwrap();
        remote_add(&root, "origin", "https://example.invalid/x.git").unwrap();
        // HEAD points at an unborn branch; there is nothing to send.
        assert_eq!(push(&root, "origin", "ghp_x").unwrap_err(), "no_commits");
    }

    /// Real network and a real token: `cargo test -- --ignored live_`.
    /// Set VERSORIUM_TEST_REMOTE to an https URL you may push to, and
    /// VERSORIUM_TEST_TOKEN to a token with access.
    #[test]
    #[ignore = "pushes to a real GitHub repository"]
    fn live_a_push_and_pull_round_trip() {
        let (Some(url), Some(token)) = (
            std::env::var("VERSORIUM_TEST_REMOTE").ok(),
            std::env::var("VERSORIUM_TEST_TOKEN").ok(),
        ) else {
            eprintln!("VERSORIUM_TEST_REMOTE / VERSORIUM_TEST_TOKEN not set: skipped");
            return;
        };
        let (_dir, root) = tmp_repo();
        init_with_commit(&root).unwrap();
        remote_add(&root, "origin", &url).unwrap();

        let branch = push(&root, "origin", &token).expect("push");
        eprintln!("pushed {branch}");
        let outcome = pull(&root, "origin", &token).expect("pull");
        assert!(!outcome.changed, "a pull right after a push has nothing to bring");

        // A bad token must be reported as a token problem, not as the network.
        assert_eq!(push(&root, "origin", "ghp_definitely_not_valid").unwrap_err(), "git_auth_failed");
    }

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
    fn a_pull_moves_the_branch_only_while_nobody_is_reading_the_history() {
        // The local half of a pull, after a real fetch from a copy of the
        // novel that has moved on. While a backup holds the history, it
        // refuses rather than moving the branch under it.
        let (_upstream_dir, upstream) = tmp_repo();
        init_with_commit(&upstream).unwrap();
        let here_dir = tempfile::tempdir().unwrap();
        let here = here_dir.path().join("here");
        Repository::clone(upstream.to_str().unwrap(), &here).unwrap();
        fs::write(upstream.join("a.md"), "hello, again\n").unwrap();
        let ahead = commit_all(&upstream, "upstream moved on").unwrap();
        let repo = Repository::open(&here).unwrap();
        repo.remote_anonymous(upstream.to_str().unwrap()).unwrap().fetch(&["main"], None, None).unwrap();
        let before = repo.head().unwrap().target().unwrap().to_string();

        let backup = RepoLock::acquire(&here, Wait::TryOnly).unwrap();
        assert_eq!(fast_forward(&here, "main", Wait::TryOnly).unwrap_err(), crate::git::lock::BUSY);
        assert_eq!(repo.head().unwrap().target().unwrap().to_string(), before, "moved while held");
        drop(backup);

        let pulled = fast_forward(&here, "main", Wait::TryOnly).unwrap();
        assert_eq!(pulled, PullOutcome { branch: "main".into(), changed: true });
        assert_eq!(Repository::open(&here).unwrap().head().unwrap().target().unwrap().to_string(), ahead);
        assert_eq!(fs::read_to_string(here.join("a.md")).unwrap(), "hello, again\n");
    }

    #[test]
    fn no_repo_errors() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(status(dir.path()).unwrap_err(), "no_repo");
    }

    #[test]
    fn the_token_only_ever_goes_to_github_over_https() {
        for url in [
            "https://github.com/ana/novela.git",
            "https://GitHub.com/ana/novela.git",
            "https://api.github.com/x",
            "https://github.com:443/ana/novela.git",
        ] {
            assert!(is_github_https(url), "{url} is GitHub");
        }

        for url in [
            // Plaintext puts a repo-scoped token on the wire in the clear.
            "http://github.com/ana/novela.git",
            // The whole point: a remote nobody at GitHub controls.
            "https://collector.attacker.tld/x.git",
            "git@github.com:ana/novela.git",
            "ssh://github.com/ana/novela.git",
            // Userinfo must not be mistaken for the host.
            "https://github.com@attacker.tld/x.git",
            // Nor a lookalike domain that merely contains the name.
            "https://github.com.attacker.tld/x.git",
            "https://notgithub.com/x.git",
            // Nor a path segment.
            "https://attacker.tld/github.com/x.git",
            "",
        ] {
            assert!(!is_github_https(url), "{url} must be refused");
        }
    }

    #[test]
    fn a_remote_pointing_elsewhere_is_refused_before_a_connection_is_made() {
        // The app never creates a remote, so every origin it sees came from
        // outside: a clone, a handed-over folder, a self-hosted forge.
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        std::fs::write(root.join("a.md"), "x").unwrap();
        init_with_commit(&root).unwrap();
        remote_add(&root, "origin", "https://collector.attacker.tld/x.git").unwrap();

        // Distinct from a network or auth failure: nothing was contacted.
        assert_eq!(push(&root, "origin", "ghp_secret").unwrap_err(), "remote_not_github");
        assert_eq!(pull(&root, "origin", "ghp_secret").unwrap_err(), "remote_not_github");
    }
}
