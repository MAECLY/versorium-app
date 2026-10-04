//! Settings → History & backup: a copy in a folder the OS already syncs.

use crate::backup::{self, code, flight};
use crate::commands::settings::SettingsStore;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use tauri::{Emitter, Manager};

/// Sent when a backup starts and when it ends, whoever started it. The panel
/// takes "a backup is running" from here, so leaving Settings and coming back
/// cannot forget a run that is still going.
///
/// The page listens for `BACKUP_STATE_EVENT` in `src/lib/backup/events.ts`,
/// and a test reads that file, so a rename on one side cannot leave the panel
/// listening to nothing.
pub const STATE_EVENT: &str = "versorium://backup-state";

/// Folders on this machine a backup could go to, plus whether each is there.
///
/// Off the main thread: finding them writes a probe file into every candidate
/// folder and disk, and a sleeping disk or a network share would freeze the
/// window while it answered.
#[tauri::command]
pub async fn backup_destinations() -> Result<Vec<backup::Destination>, String> {
    tauri::async_runtime::spawn_blocking(backup::destinations)
        .await
        .map_err(|_| code::IO.to_string())
}

/// The most destinations worth offering.
///
/// 3-2-1 asks for three copies counting the original, so two backup
/// destinations already satisfies it and a third is headroom. Past that the
/// slowest destination decides how long every backup takes, for a copy nobody
/// asked for.
pub const MAX_DESTINATIONS: usize = 3;

/// What happened at one destination.
///
/// Never collapsed into a single result. Two of three succeeding is the case
/// every other writing app avoids by having one destination, and reporting it
/// as either "backed up" or "failed" would be a lie in one direction or the
/// other.
///
/// `held` says pruning was withheld at that destination; it is left out of
/// the JSON when nothing was.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum Outcome {
    /// A state that was not here before, written and read back.
    Ok {
        path: String,
        archive: backup::Archive,
        pruned: usize,
        #[serde(skip_serializing_if = "Option::is_none")]
        held: Option<backup::Held>,
    },
    /// The same state as the copy already here, kept a second time. One file
    /// is one file, and a destination holding a single archive of a state has
    /// nothing left if that archive goes bad.
    Copy {
        path: String,
        archive: backup::Archive,
        pruned: usize,
        #[serde(skip_serializing_if = "Option::is_none")]
        held: Option<backup::Held>,
    },
    /// Nothing has changed and there are already enough copies. Neither a save
    /// nor a failure: there was nothing to write, and saying "saved" would be
    /// a lie about what is on the disk.
    Unchanged {
        path: String,
        archive: backup::Archive,
        pruned: usize,
        #[serde(skip_serializing_if = "Option::is_none")]
        held: Option<backup::Held>,
    },
    /// The copy that was here could not be read back. A new one was written
    /// and the bad one left where it is.
    Repaired {
        path: String,
        archive: backup::Archive,
        pruned: usize,
        #[serde(skip_serializing_if = "Option::is_none")]
        held: Option<backup::Held>,
        reason: String,
        damaged: String,
    },
    /// The folder is not there: an unplugged disk, a signed-out client, or a
    /// disk pulled out mid-write. Not an error.
    Unavailable { path: String },
    /// The novel's history was being written (a commit or a pull held it) for
    /// longer than a backup waits to read it. Nothing was written, and neither
    /// the destination nor the novel is at fault.
    Busy { path: String },
    /// It is there and the write failed. That is an error.
    Failed { path: String, reason: String },
}

/// One destination's result as the writer is told it.
fn outcome(path: String, result: Result<backup::Written, String>) -> Outcome {
    match result {
        Ok(backup::Written::Fresh { archive, pruned, held }) => Outcome::Ok { path, archive, pruned, held },
        Ok(backup::Written::Copy { archive, pruned, held }) => Outcome::Copy { path, archive, pruned, held },
        Ok(backup::Written::Same { archive, pruned, held }) => {
            Outcome::Unchanged { path, archive, pruned, held }
        }
        Ok(backup::Written::Repaired { archive, pruned, held, reason, damaged }) => {
            Outcome::Repaired { path, archive, pruned, held, reason, damaged }
        }
        // There a moment ago and gone mid-write: the disk was pulled out.
        // Unavailable, like a disk that was never plugged in.
        Err(reason) if reason == code::DEST_MISSING => Outcome::Unavailable { path },
        Err(reason) => Outcome::Failed { path, reason },
    }
}

/// Validate and store the destinations and the number to keep.
///
/// An empty list turns backups off rather than storing meaningless paths.
pub fn configure_in(state: &SettingsStore, paths: Vec<String>, keep: usize) -> Result<(), String> {
    let mut kept: Vec<String> = Vec::new();
    for path in paths {
        let trimmed = path.trim().to_string();
        if trimmed.is_empty() {
            continue;
        }
        if !Path::new(&trimmed).is_dir() {
            return Err(code::DEST_MISSING.into());
        }
        // The same folder twice is one copy wearing two hats.
        if !kept.contains(&trimmed) {
            kept.push(trimmed);
        }
    }
    kept.truncate(MAX_DESTINATIONS);
    state.update(|s| {
        s.backup_dirs = kept.clone();
        // Zero would mean "back up and then delete it", so the floor is one.
        s.backup_keep = keep.clamp(1, 200);
    });
    Ok(())
}

/// Remember where backups go and how many to keep.
///
/// Off the main thread: checking that each folder exists is a stat, and a
/// sleeping disk can take seconds to answer one.
#[tauri::command]
pub async fn backup_configure(app: tauri::AppHandle, paths: Vec<String>, keep: usize) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || configure_in(&app.state::<SettingsStore>(), paths, keep))
        .await
        .map_err(|_| code::IO.to_string())?
}

fn configured(state: &SettingsStore) -> Result<(Vec<PathBuf>, usize), String> {
    let settings = state.get();
    if settings.backup_dirs.is_empty() {
        return Err(code::NOT_CONFIGURED.into());
    }
    Ok((settings.backup_dirs.iter().map(PathBuf::from).collect(), settings.backup_keep))
}

/// Write one archive into every configured destination, once no other backup
/// is running.
///
/// Each destination is attempted independently and reported separately. A
/// destination that is gone does not fail the ones that are there, which is the
/// whole reason the list exists.
///
/// `settings` and `clock` are read when the run starts, not when it was asked
/// for. A press that waited behind another run must not be stamped earlier
/// than the run it waited for, nor write to a destination the writer stopped
/// using while it waited.
pub fn run_now(
    flight: &flight::Flight,
    ctx: &backup::RunCtx,
    project: &Path,
    settings: &dyn Fn() -> Result<(Vec<PathBuf>, usize), String>,
    clock: &dyn Fn() -> SystemTime,
    on_change: &dyn Fn(&flight::State),
) -> Result<Vec<Outcome>, String> {
    let named = project.to_string_lossy().into_owned();
    flight.exclusive(&named, on_change, || {
        let (dirs, keep) = settings()?;
        let now = clock();
        // Walked and hashed once, not once per destination: a large project
        // across three folders would otherwise be read three times, and two
        // destinations could be handed different answers from one press.
        let plan = match backup::plan(project) {
            Ok(plan) => plan,
            // One unreadable project is not three destinations' fault, but it
            // is every destination's outcome. The list is never collapsed, not
            // even into an error.
            Err(reason) => {
                let each = |dir: &PathBuf| {
                    let path = dir.to_string_lossy().into_owned();
                    if reason == code::REPO_BUSY {
                        Outcome::Busy { path }
                    } else {
                        Outcome::Failed { path, reason: reason.clone() }
                    }
                };
                return Ok(dirs.iter().map(each).collect());
            }
        };
        Ok(dirs
            .iter()
            .map(|dir| {
                let shown = dir.to_string_lossy().into_owned();
                if !dir.is_dir() {
                    return Outcome::Unavailable { path: shown };
                }
                outcome(shown, backup::create_planned(project, dir, keep, now, &plan, ctx))
            })
            .collect())
    })
}

/// Back the novel at `path` up now.
///
/// A second call while one is running waits for it, then makes its own run.
/// The frontend saves what is on screen before calling this.
#[tauri::command]
pub async fn backup_now(app: tauri::AppHandle, path: PathBuf) -> Result<Vec<Outcome>, String> {
    press(app, path, backup::RunCtx::this_process).await
}

/// `backup_now`, with who is writing passed in, so a test can name the
/// computer without writing into the app's real folder.
async fn press<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    path: PathBuf,
    ctx: fn() -> backup::RunCtx,
) -> Result<Vec<Outcome>, String> {
    // Refused at once, rather than after waiting behind another run.
    configured(&app.state::<SettingsStore>())?;
    tauri::async_runtime::spawn_blocking(move || {
        let settings = || configured(&app.state::<SettingsStore>());
        let tell = |state: &flight::State| {
            let _ = app.emit(STATE_EVENT, state);
        };
        run_now(&flight::FLIGHT, &ctx(), &path, &settings, &SystemTime::now, &tell)
    })
    .await
    .map_err(|_| code::IO.to_string())?
}

/// Whether a backup is running right now, for a panel that has just opened.
#[tauri::command]
pub fn backup_state() -> flight::State {
    flight::FLIGHT.state()
}

/// Archives stored for this project, newest first, per destination.
///
/// Off the main thread: it lists every destination, and one of them can be a
/// disk that takes seconds to wake.
#[tauri::command]
pub async fn backup_list(
    state: tauri::State<'_, SettingsStore>,
    path: PathBuf,
) -> Result<Vec<(String, Vec<backup::Archive>)>, String> {
    let (dirs, _) = configured(&state)?;
    let title = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "novel".into());
    tauri::async_runtime::spawn_blocking(move || {
        dirs.into_iter()
            .map(|dir| {
                let listed = backup::list_in(&dir, &title).unwrap_or_default();
                (dir.to_string_lossy().into_owned(), listed)
            })
            .collect()
    })
    .await
    .map_err(|_| code::IO.to_string())
}

/// What the configured destinations actually protect this novel against.
///
/// Computed here rather than in the UI because it needs device numbers, and a
/// frontend comparing path prefixes would call `/Volumes/Backup` and
/// `/Volumes/Backup2` different disks. Off the main thread, and detection runs
/// once per call rather than once per destination.
#[tauri::command]
pub async fn backup_coverage(
    state: tauri::State<'_, SettingsStore>,
    path: PathBuf,
) -> Result<backup::Coverage, String> {
    let dirs: Vec<PathBuf> = state.get().backup_dirs.iter().map(PathBuf::from).collect();
    tauri::async_runtime::spawn_blocking(move || {
        let detected = backup::destinations();
        backup::coverage_with(&path, &dirs, &detected)
    })
    .await
    .map_err(|_| code::IO.to_string())
}

/// Read an archive back and confirm it is complete and extractable.
///
/// Offered on demand because an archive that sat on a disk for a year is
/// exactly the one 3-2-1 exists for and the one nobody ever checks.
#[tauri::command]
pub async fn backup_verify(archive: PathBuf) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || backup::verify(&archive))
        .await
        .map_err(|_| code::IO.to_string())?
}

/// Extract an archive beside the project it came from, never over it.
///
/// Returns the new folder so the caller can open it. `label` is localized by the
/// frontend, because a folder name is something the writer reads.
#[tauri::command]
pub async fn backup_restore(
    archive: PathBuf,
    project: PathBuf,
    label: String,
) -> Result<String, String> {
    let label = label.trim().to_string();
    if label.is_empty() {
        return Err(code::BAD_ARGS.into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        backup::restore_beside(&archive, &project, &label)
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|_| code::IO.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::lock::{RepoLock, Wait};
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{mpsc, Arc, Mutex};
    use std::time::{Duration, UNIX_EPOCH};

    /// 2026-09-28T00:00:00Z.
    const DAY: u64 = 1_790_553_600;

    fn store(dir: &Path) -> SettingsStore {
        SettingsStore::load(dir.join("settings.json"))
    }

    fn folder(parent: &Path, name: &str) -> String {
        let path = parent.join(name);
        fs::create_dir_all(&path).unwrap();
        path.to_string_lossy().into_owned()
    }

    fn at(secs: u64) -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(secs)
    }

    fn novel(parent: &Path) -> PathBuf {
        let root = parent.join("el-faro");
        fs::create_dir_all(root.join("chapters")).unwrap();
        fs::write(root.join("project.json"), br#"{"title":"El faro"}"#).unwrap();
        fs::write(root.join("chapters/ch-01.md"), "La luz giraba sobre el agua.").unwrap();
        root
    }

    #[test]
    fn nothing_happens_until_a_destination_is_chosen() {
        // The alternative — silently picking iCloud — would write a novel
        // somewhere the writer never agreed to.
        let tmp = tempfile::tempdir().unwrap();
        let state = store(tmp.path());
        assert_eq!(configured(&state).unwrap_err(), "backup_not_configured");
    }

    #[test]
    fn a_destination_that_does_not_exist_is_refused_rather_than_stored() {
        let tmp = tempfile::tempdir().unwrap();
        let state = store(tmp.path());
        let missing = tmp.path().join("absent").to_string_lossy().into_owned();
        // Storing it would fail later, at the moment the writer most needs the
        // backup to have worked.
        assert_eq!(configure_in(&state, vec![missing], 10).unwrap_err(), "backup_dest_missing");
        assert!(state.get().backup_dirs.is_empty());
    }

    #[test]
    fn several_destinations_are_kept_in_the_order_they_were_chosen() {
        // 3-2-1 needs copies on different media, and one folder can only be one.
        let tmp = tempfile::tempdir().unwrap();
        let state = store(tmp.path());
        let a = folder(tmp.path(), "icloud");
        let b = folder(tmp.path(), "usb");
        configure_in(&state, vec![a.clone(), b.clone()], 5).unwrap();
        assert_eq!(state.get().backup_dirs, vec![a, b]);
        assert_eq!(state.get().backup_keep, 5);
    }

    #[test]
    fn the_same_folder_twice_is_one_copy_and_is_stored_once() {
        let tmp = tempfile::tempdir().unwrap();
        let state = store(tmp.path());
        let a = folder(tmp.path(), "icloud");
        configure_in(&state, vec![a.clone(), a.clone(), a.clone()], 10).unwrap();
        assert_eq!(state.get().backup_dirs, vec![a]);
    }

    #[test]
    fn more_destinations_than_are_useful_are_dropped() {
        // Past three, the slowest destination decides how long every backup
        // takes, for a copy nobody asked for.
        let tmp = tempfile::tempdir().unwrap();
        let state = store(tmp.path());
        let chosen: Vec<String> = (0..6).map(|i| folder(tmp.path(), &format!("d{i}"))).collect();
        configure_in(&state, chosen, 10).unwrap();
        assert_eq!(state.get().backup_dirs.len(), MAX_DESTINATIONS);
    }

    #[test]
    fn the_kept_count_is_clamped_to_something_sensible() {
        let tmp = tempfile::tempdir().unwrap();
        let state = store(tmp.path());
        let a = folder(tmp.path(), "icloud");
        configure_in(&state, vec![a.clone()], 0).unwrap();
        assert_eq!(state.get().backup_keep, 1, "zero would delete what it just wrote");
        configure_in(&state, vec![a.clone()], 5_000).unwrap();
        assert_eq!(state.get().backup_keep, 200, "an absurd count fills the folder");
    }

    #[test]
    fn an_empty_list_turns_backups_off() {
        let tmp = tempfile::tempdir().unwrap();
        let state = store(tmp.path());
        let a = folder(tmp.path(), "icloud");
        configure_in(&state, vec![a], 3).unwrap();
        assert!(!state.get().backup_dirs.is_empty());

        configure_in(&state, vec!["  ".into()], 3).unwrap();
        assert!(state.get().backup_dirs.is_empty());
    }

    fn archive() -> backup::Archive {
        backup::Archive {
            path: "/a/x.zip".into(),
            name: "x.zip".into(),
            bytes: 1,
            modified: 0,
            stamped: Some(0),
            print: Some("0123456789abcdef".into()),
            sha256: Some("abc".into()),
        }
    }

    #[test]
    fn an_outcome_names_its_destination_whatever_happened() {
        // The UI shows per-destination state, so every variant has to say which
        // one it is talking about.
        let ok = Outcome::Ok { path: "/a".into(), pruned: 0, archive: archive(), held: None };
        let gone = Outcome::Unavailable { path: "/b".into() };
        let bad = Outcome::Failed { path: "/c".into(), reason: "io".into() };
        for (outcome, expected) in [(ok, "/a"), (gone, "/b"), (bad, "/c")] {
            let json = serde_json::to_value(&outcome).unwrap();
            assert_eq!(json["path"], expected);
            assert!(json["state"].is_string(), "the UI branches on this");
        }
    }

    #[test]
    fn a_held_prune_travels_with_the_outcome_and_is_absent_otherwise() {
        let held = Outcome::Ok {
            path: "/a".into(),
            pruned: 0,
            archive: archive(),
            held: Some(backup::Held::ClockBehind { stamp: 1_790_640_000 }),
        };
        let json = serde_json::to_value(&held).unwrap();
        assert_eq!(json["held"], serde_json::json!({ "kind": "clockBehind", "stamp": 1_790_640_000u64 }));
        let plain = Outcome::Unchanged { path: "/a".into(), pruned: 0, archive: archive(), held: None };
        assert!(serde_json::to_value(&plain).unwrap().get("held").is_none());

        // And what the backup reported is what the outcome carries.
        let behind = Some(backup::Held::ClockBehind { stamp: 1_790_640_000 });
        let written = backup::Written::Fresh { archive: archive(), pruned: 0, held: behind.clone() };
        assert_eq!(
            outcome("/a".into(), Ok(written)),
            Outcome::Ok { path: "/a".into(), archive: archive(), pruned: 0, held: behind }
        );
    }

    #[test]
    fn a_disk_pulled_out_mid_write_is_unavailable_not_a_failure() {
        assert_eq!(
            outcome("/a".into(), Err(code::DEST_MISSING.into())),
            Outcome::Unavailable { path: "/a".into() }
        );
        assert_eq!(
            outcome("/a".into(), Err(code::NO_SPACE.into())),
            Outcome::Failed { path: "/a".into(), reason: "backup_no_space".into() }
        );
    }

    #[test]
    fn two_presses_at_once_back_up_one_after_the_other() {
        // In its Phase 0 form: two calls race on one novel and one folder. One
        // writes the state, the other keeps its second copy, nothing is left
        // half-written and both archives read back whole.
        let tmp = tempfile::tempdir().unwrap();
        let root = novel(tmp.path());
        let dest = tmp.path().join("icloud");
        fs::create_dir_all(&dest).unwrap();
        let flight = flight::Flight::new();
        let ctx = backup::RunCtx::for_tests();
        let barrier = std::sync::Barrier::new(2);
        let told = Mutex::new(Vec::<bool>::new());
        let tell = |state: &flight::State| told.lock().unwrap().push(state.running.is_some());
        let dirs = [dest.clone()];

        let results: Vec<Vec<Outcome>> = std::thread::scope(|s| {
            let runs: Vec<_> = (0..2)
                .map(|_| {
                    s.spawn(|| {
                        barrier.wait();
                        run_now(&flight, &ctx, &root, &|| Ok((dirs.to_vec(), 10)), &|| at(DAY), &tell).unwrap()
                    })
                })
                .collect();
            runs.into_iter().map(|run| run.join().unwrap()).collect()
        });

        let mut states: Vec<&str> = results
            .iter()
            .flatten()
            .map(|o| match o {
                Outcome::Ok { .. } => "ok",
                Outcome::Copy { .. } => "copy",
                _ => "something else",
            })
            .collect();
        states.sort_unstable();
        assert_eq!(states, ["copy", "ok"], "{results:?}");
        assert_eq!(*told.lock().unwrap(), [true, false, true, false], "each run starts after the other ends");

        let left: Vec<String> = fs::read_dir(&dest)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(left.iter().all(|n| n.ends_with(".zip")), "a temporary file was left: {left:?}");
        assert_eq!(left.len(), 2);
        for name in left {
            backup::verify(&dest.join(name)).unwrap();
        }
    }

    /// The event name the page listens for, read out of the page's own source.
    fn page_event() -> String {
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/lib/backup/events.ts");
        let source = fs::read_to_string(source).unwrap();
        let line = source
            .lines()
            .find(|line| line.contains("export const BACKUP_STATE_EVENT"))
            .expect("events.ts no longer exports BACKUP_STATE_EVENT");
        line.split('"').nth(1).expect("the event name is not a string literal").to_string()
    }

    #[test]
    fn rust_sends_the_event_the_page_listens_for() {
        // Renamed on one side only, the panel would listen to nothing and keep
        // Back up now disabled after a run it did not start had ended.
        assert_eq!(STATE_EVENT, page_event());
    }

    #[test]
    fn the_state_reaches_the_page_in_the_shape_it_reads() {
        // `BackupState` in src/lib/tauri.ts.
        let running = flight::State {
            running: Some(flight::Running { project: "/novels/el-faro".into(), started_at: DAY }),
            seq: 3,
        };
        assert_eq!(
            serde_json::to_value(&running).unwrap(),
            serde_json::json!({ "running": { "project": "/novels/el-faro", "startedAt": DAY }, "seq": 3 })
        );
        let idle = flight::State { running: None, seq: 4 };
        assert_eq!(serde_json::to_value(&idle).unwrap(), serde_json::json!({ "running": null, "seq": 4 }));
    }

    #[test]
    fn back_up_now_tells_the_page_when_it_starts_and_when_it_ends() {
        // Through the command itself, on Tauri's mock runtime, listening for
        // the name the page uses.
        use tauri::Listener;
        let tmp = tempfile::tempdir().unwrap();
        let root = novel(tmp.path());
        let settings = store(tmp.path());
        configure_in(&settings, vec![folder(tmp.path(), "icloud")], 10).unwrap();
        let app = tauri::test::mock_builder()
            .manage(settings)
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let heard = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
        let sink = heard.clone();
        app.listen_any(page_event(), move |event| {
            sink.lock().unwrap().push(serde_json::from_str(event.payload()).unwrap());
        });

        let outcomes =
            tauri::async_runtime::block_on(press(app.handle().clone(), root.clone(), backup::RunCtx::for_tests))
                .unwrap();

        assert!(matches!(outcomes[..], [Outcome::Ok { .. }]), "{outcomes:?}");
        let heard = heard.lock().unwrap().clone();
        assert_eq!(heard.len(), 2, "a start and an end: {heard:?}");
        assert_eq!(heard[0]["running"]["project"], root.to_string_lossy().as_ref());
        assert!(heard[0]["running"]["startedAt"].is_u64(), "{heard:?}");
        assert_eq!(heard[1]["running"], serde_json::Value::Null);
        assert!(heard[1]["seq"].as_u64() > heard[0]["seq"].as_u64(), "{heard:?}");
    }

    /// Hold the run on this thread inside the queue, after its first packed
    /// entry, until `released` hears from the test.
    fn hold_after_first_entry(paused: mpsc::Sender<()>, released: mpsc::Receiver<()>) {
        let mut first = true;
        backup::hooks::AFTER_ENTRY.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move || {
                if std::mem::take(&mut first) {
                    paused.send(()).unwrap();
                    let _ = released.recv_timeout(Duration::from_secs(20));
                }
            }));
        });
    }

    /// `first` runs and is held inside the queue; `second` is started and
    /// given time to reach the queue and wait there; `meanwhile` runs; then
    /// `first` is let go.
    fn one_behind_another<A: Send, B: Send>(
        first: impl FnOnce() -> A + Send,
        second: impl FnOnce() -> B + Send,
        meanwhile: impl FnOnce(),
    ) -> (A, B) {
        let (paused, is_paused) = mpsc::channel::<()>();
        let (release, released) = mpsc::channel::<()>();
        std::thread::scope(|s| {
            let a = s.spawn(move || {
                hold_after_first_entry(paused, released);
                first()
            });
            is_paused.recv_timeout(Duration::from_secs(20)).expect("the first run never started packing");
            let b = s.spawn(second);
            std::thread::sleep(Duration::from_millis(300));
            meanwhile();
            release.send(()).unwrap();
            (a.join().unwrap(), b.join().unwrap())
        })
    }

    fn written(outcomes: &[Outcome]) -> Vec<(&str, u64)> {
        outcomes
            .iter()
            .map(|o| match o {
                Outcome::Ok { path, archive, .. } | Outcome::Copy { path, archive, .. } => {
                    (path.as_str(), archive.stamped.unwrap())
                }
                other => panic!("expected a written archive, got {other:?}"),
            })
            .collect()
    }

    #[test]
    fn a_press_that_waited_is_stamped_after_the_run_it_waited_for() {
        // The clock moves on while the second press waits. Read before
        // waiting, its archive would be named as if made before the first.
        let tmp = tempfile::tempdir().unwrap();
        let root = novel(tmp.path());
        let dest = PathBuf::from(folder(tmp.path(), "icloud"));
        let (flight, ctx) = (flight::Flight::new(), backup::RunCtx::for_tests());
        let minutes = AtomicU64::new(0);
        let clock = || at(DAY + 60 * minutes.load(Ordering::SeqCst));
        let settings = || Ok((vec![dest.clone()], 10));
        let run = || run_now(&flight, &ctx, &root, &settings, &clock, &|_| {}).unwrap();

        let (first, second) = one_behind_another(run, run, || minutes.store(1, Ordering::SeqCst));

        assert_eq!(written(&first)[0].1, DAY);
        assert_eq!(written(&second)[0].1, DAY + 60, "stamped before the run it waited for");
    }

    #[test]
    fn a_press_that_waited_backs_up_where_the_writer_backs_up_by_then() {
        // The writer stops using a disk while a press waits behind a run.
        let tmp = tempfile::tempdir().unwrap();
        let root = novel(tmp.path());
        let (old, new) = (folder(tmp.path(), "old-disk"), folder(tmp.path(), "icloud"));
        let state = store(tmp.path());
        configure_in(&state, vec![old.clone()], 10).unwrap();
        let (flight, ctx) = (flight::Flight::new(), backup::RunCtx::for_tests());
        let settings = || configured(&state);
        let run = || run_now(&flight, &ctx, &root, &settings, &|| at(DAY), &|_| {});

        let (first, second) =
            one_behind_another(run, run, || configure_in(&state, vec![new.clone()], 10).unwrap());

        assert_eq!(written(&first.unwrap())[0].0, old);
        assert_eq!(written(&second.unwrap())[0].0, new, "the press wrote where the writer no longer backs up");

        // And with backups turned off meanwhile, it says so instead. The run
        // already going when they were turned off finishes.
        let (first, second) = one_behind_another(run, run, || configure_in(&state, vec![], 10).unwrap());
        assert!(first.is_ok(), "{first:?}");
        assert_eq!(second.unwrap_err(), code::NOT_CONFIGURED);
    }

    #[test]
    fn a_novel_whose_history_is_being_written_is_busy_not_failed() {
        // A commit or a pull holds the history for longer than a backup waits:
        // every destination says so, and nothing is written.
        let tmp = tempfile::tempdir().unwrap();
        let root = novel(tmp.path());
        crate::git::repo::init_with_commit(&root).unwrap();
        let dest = folder(tmp.path(), "icloud");
        let (flight, ctx) = (flight::Flight::new(), backup::RunCtx::for_tests());
        let committing = RepoLock::acquire(&root, Wait::TryOnly).unwrap();
        backup::hooks::CAPTURE_WAIT.set(Some(Wait::TryOnly));
        let outcomes = run_now(&flight, &ctx, &root, &|| Ok((vec![PathBuf::from(&dest)], 10)), &|| at(DAY), &|_| {});
        backup::hooks::CAPTURE_WAIT.set(None);
        drop(committing);

        let outcomes = outcomes.unwrap();
        assert_eq!(outcomes, [Outcome::Busy { path: dest.clone() }]);
        assert_eq!(serde_json::to_value(&outcomes[0]).unwrap()["state"], "busy");
        assert_eq!(fs::read_dir(&dest).unwrap().count(), 0, "something was written");
    }

    #[test]
    fn a_disk_pulled_out_mid_backup_is_reported_unavailable() {
        // The folder vanishes while the archive is being packed into it.
        let tmp = tempfile::tempdir().unwrap();
        let root = novel(tmp.path());
        let dest = folder(tmp.path(), "usb");
        let (flight, ctx) = (flight::Flight::new(), backup::RunCtx::for_tests());
        let gone = PathBuf::from(&dest);
        backup::hooks::AFTER_ENTRY.with(|hook| {
            *hook.borrow_mut() = Some(Box::new(move || {
                let _ = fs::remove_dir_all(&gone);
            }));
        });
        let outcomes = run_now(&flight, &ctx, &root, &|| Ok((vec![PathBuf::from(&dest)], 10)), &|| at(DAY), &|_| {});
        backup::hooks::AFTER_ENTRY.with(|hook| *hook.borrow_mut() = None);
        assert_eq!(outcomes.unwrap(), [Outcome::Unavailable { path: dest }]);
    }
}
