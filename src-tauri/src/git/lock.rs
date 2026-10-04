//! One writer of a novel's history at a time, in every process.
//!
//! A backup reads `.git` while the 60-second checkpoint, Save snapshot, an AI
//! rewrite, a chapter delete, a pull and the MCP server (a separate process)
//! can all commit. The backup reads the refs before it lists the objects, and
//! that order alone keeps the archived history whole against any writer (see
//! `backup::capture`). This lock adds what the order cannot: while a backup
//! holds it, none of this app's writes lands, so the index, the refs and the
//! logs in an archive all describe one moment.
//!
//! A file lock, so it excludes another process as well as another thread: each
//! acquisition opens its own handle, and the operating system holds the lock
//! per handle, releasing it when the handle closes, a crash included. The file
//! lives in the app's own folder, never in the novel's, where it would change
//! what a backup fingerprints.

use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions, TryLockError};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// What a write that gave up waiting returns. The writer reads
/// `errors.repo_busy`.
pub const BUSY: &str = "repo_busy";

/// How long a commit made on the main thread waits: an AI rewrite and a
/// chapter delete. The window is frozen meanwhile, and a capture holds the
/// lock for a fraction of a second.
pub const COMMIT_WAIT: Duration = Duration::from_secs(2);

/// How long a write off the main thread waits: Save snapshot, a pull and the
/// MCP server.
pub const BACKGROUND_WAIT: Duration = Duration::from_secs(10);

/// How often a waiting writer tries again.
const POLL: Duration = Duration::from_millis(25);

/// How long to wait for the lock.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Wait {
    /// Take it if it is free, and give up at once if not. The 60-second
    /// checkpoint skips a minute rather than wait.
    TryOnly,
    /// Try again every 25 ms, for up to this long.
    Upto(Duration),
}

/// The lock on one novel's history, held until this is dropped.
#[must_use = "the lock is released as soon as this is dropped"]
pub struct RepoLock {
    /// `None` when no lock file could be made (see `acquire_at`).
    file: Option<File>,
}

impl RepoLock {
    /// Take the lock on the novel at `root`, waiting as `wait` says.
    ///
    /// `Err(BUSY)` only when somebody else holds it.
    pub fn acquire(root: &Path, wait: Wait) -> Result<RepoLock, String> {
        acquire_at(&lock_path(root), wait)
    }
}

impl Drop for RepoLock {
    fn drop(&mut self) {
        // Closing the handle releases it as well, but Windows only promises
        // to do that eventually.
        if let Some(file) = &self.file {
            let _ = file.unlock();
        }
    }
}

/// A lock file that cannot be made or locked (an app folder gone read-only,
/// a filesystem without locks) is not a reason to refuse the writer a commit
/// or a backup: the lock is then simply not held, and the backup's read order
/// still keeps the archived history whole.
fn acquire_at(path: &Path, wait: Wait) -> Result<RepoLock, String> {
    let unheld = RepoLock { file: None };
    if let Some(dir) = path.parent() {
        if fs::create_dir_all(dir).is_err() {
            return Ok(unheld);
        }
    }
    // Never truncated and never deleted: another process may have it open,
    // and a lock taken on a file somebody removed excludes nobody.
    let Ok(file) = OpenOptions::new().create(true).write(true).truncate(false).open(path) else {
        return Ok(unheld);
    };
    let deadline = match wait {
        Wait::TryOnly => None,
        Wait::Upto(limit) => Some(Instant::now() + limit),
    };
    loop {
        match file.try_lock() {
            Ok(()) => return Ok(RepoLock { file: Some(file) }),
            Err(TryLockError::WouldBlock) => {}
            Err(TryLockError::Error(_)) => return Ok(unheld),
        }
        match deadline {
            Some(deadline) if Instant::now() < deadline => std::thread::sleep(POLL),
            _ => return Err(BUSY.into()),
        }
    }
}

/// `<app data>/locks/repo-<16 hex>.lock`, one per novel. Named from the
/// canonical path, so two spellings of one folder share one lock.
fn lock_path(root: &Path) -> PathBuf {
    let canonical = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let digest = Sha256::digest(canonical.to_string_lossy().as_bytes());
    let name: String = digest.iter().take(8).map(|byte| format!("{byte:02x}")).collect();
    lock_dir().join(format!("repo-{name}.lock"))
}

fn lock_dir() -> PathBuf {
    if cfg!(test) {
        // Tests lock novels in temporary folders, and must not leave a file
        // for each of them in the app's real folder.
        std::env::temp_dir().join("versorium-test-locks")
    } else {
        locks_in(crate::paths::app_data_dir())
    }
}

/// Shared by the app and `versorium mcp`, which resolve the same app folder.
/// Without one, the temporary folder both of them also share.
fn locks_in(app_data: Result<PathBuf, String>) -> PathBuf {
    app_data
        .map(|dir| dir.join("locks"))
        .unwrap_or_else(|_| std::env::temp_dir().join("versorium-locks"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::process::{Command, Stdio};
    use std::sync::mpsc;

    fn novel() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("el-faro");
        fs::create_dir_all(&root).unwrap();
        (dir, root)
    }

    #[test]
    fn a_second_holder_is_turned_away_until_the_first_lets_go() {
        let (_dir, root) = novel();
        let first = RepoLock::acquire(&root, Wait::TryOnly).unwrap();
        assert!(first.file.is_some(), "the lock was not really held");
        // Another handle in this very process: threads exclude each other too.
        assert_eq!(RepoLock::acquire(&root, Wait::TryOnly).err().as_deref(), Some(BUSY));
        drop(first);
        assert!(RepoLock::acquire(&root, Wait::TryOnly).is_ok());
    }

    #[test]
    fn a_wait_ends_when_its_time_is_up() {
        let (_dir, root) = novel();
        let _held = RepoLock::acquire(&root, Wait::TryOnly).unwrap();
        let started = Instant::now();
        let waited = RepoLock::acquire(&root, Wait::Upto(Duration::from_millis(150)));
        assert_eq!(waited.err().as_deref(), Some(BUSY));
        assert!(started.elapsed() >= Duration::from_millis(150), "gave up early: {:?}", started.elapsed());
    }

    #[test]
    fn a_waiter_gets_the_lock_once_it_is_released() {
        let (_dir, root) = novel();
        let held = RepoLock::acquire(&root, Wait::TryOnly).unwrap();
        let waiter = {
            let root = root.clone();
            std::thread::spawn(move || RepoLock::acquire(&root, Wait::Upto(Duration::from_secs(10))).map(|_| ()))
        };
        std::thread::sleep(Duration::from_millis(100));
        drop(held);
        assert_eq!(waiter.join().unwrap(), Ok(()));
    }

    #[test]
    fn two_novels_never_share_a_lock_and_one_novel_always_does() {
        let (_dir, root) = novel();
        let other = root.with_file_name("el-faro-del-norte");
        fs::create_dir_all(&other).unwrap();
        assert_ne!(lock_path(&root), lock_path(&other));
        // The same folder spelled through `..` is the same novel.
        assert_eq!(lock_path(&root), lock_path(&other.join("../el-faro")));
        let _held = RepoLock::acquire(&other, Wait::TryOnly).unwrap();
        assert!(RepoLock::acquire(&root, Wait::TryOnly).is_ok(), "one novel's lock held up another");
    }

    #[test]
    fn the_lock_lives_in_the_app_folder_that_both_processes_share() {
        let app = PathBuf::from("/app-data");
        assert_eq!(locks_in(Ok(app.clone())), app.join("locks"));
        assert_eq!(locks_in(Err("no_home".into())), std::env::temp_dir().join("versorium-locks"));
    }

    #[test]
    fn a_lock_file_that_cannot_be_made_does_not_stop_the_writer() {
        // A path under a file can never be created, whoever runs the test.
        let (_dir, root) = novel();
        let blocker = root.join("a-file");
        fs::write(&blocker, "x").unwrap();
        let lock = acquire_at(&blocker.join("locks/repo.lock"), Wait::TryOnly).unwrap();
        assert!(lock.file.is_none());
        // A folder where the lock file should be cannot be opened as one.
        let taken = root.join("repo.lock");
        fs::create_dir_all(&taken).unwrap();
        let lock = acquire_at(&taken, Wait::TryOnly).unwrap();
        assert!(lock.file.is_none());
    }

    /// Set by the test below for the copy of this binary it starts.
    const CHILD_ENV: &str = "VERSORIUM_TEST_HOLD_REPO_LOCK";
    const HELD: &str = "versorium-test: repo lock held";

    /// The other process in the test below. Does nothing unless that test
    /// started it.
    #[test]
    fn child_process_holding_the_lock() {
        let Some(root) = std::env::var_os(CHILD_ENV) else { return };
        let _held = RepoLock::acquire(Path::new(&root), Wait::TryOnly).expect("the child could not take the lock");
        println!("{HELD}");
        std::io::stdout().flush().unwrap();
        // Held until the parent closes this process's input.
        let _ = std::io::stdin().read(&mut [0u8; 1]);
    }

    #[test]
    fn another_process_holding_the_lock_makes_a_commit_wait_then_succeed() {
        // The MCP server is a separate process. While it holds the history,
        // the app's checkpoint is turned away at once and a commit waits.
        let (_dir, root) = novel();
        fs::write(root.join("ch-01.md"), "Uno.\n").unwrap();
        crate::git::repo::init_with_commit(&root).unwrap();
        fs::write(root.join("ch-01.md"), "Dos.\n").unwrap();

        let mut child = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "git::lock::tests::child_process_holding_the_lock", "--nocapture", "--test-threads=1"])
            .env(CHILD_ENV, &root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let (held, child_has_it) = mpsc::channel::<()>();
        let output = child.stdout.take().unwrap();
        let reader = std::thread::spawn(move || {
            for line in BufReader::new(output).lines().map_while(Result::ok) {
                if line.contains(HELD) {
                    let _ = held.send(());
                }
            }
        });
        child_has_it.recv_timeout(Duration::from_secs(60)).expect("the child never took the lock");

        assert_eq!(RepoLock::acquire(&root, Wait::TryOnly).err().as_deref(), Some(BUSY));
        let (done, committed) = mpsc::channel::<()>();
        let committer = {
            let root = root.clone();
            std::thread::spawn(move || {
                let result = crate::git::repo::commit_all_waiting(&root, "while another process held it", Wait::Upto(Duration::from_secs(30)));
                let _ = done.send(());
                result
            })
        };
        assert!(committed.recv_timeout(Duration::from_millis(400)).is_err(), "the commit did not wait for the other process");

        drop(child.stdin.take());
        child.wait().unwrap();
        reader.join().unwrap();
        let sha = committer.join().unwrap().expect("the commit failed once the other process let go");
        assert_eq!(sha.len(), 40);
    }
}
