//! One backup at a time in this process.
//!
//! Back up now used to keep its "busy" flag inside the Settings panel. Leaving
//! that page and coming back reset the flag while the run went on in Rust, so a
//! second press started a second run into the same folders. Runs now queue
//! here, and the panel asks Rust whether one is going instead of remembering
//! it.

use serde::Serialize;
use std::sync::{Condvar, Mutex, MutexGuard};

/// The backup in progress.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Running {
    /// The novel being backed up, as the frontend named it.
    pub project: String,
    /// Unix seconds.
    pub started_at: u64,
}

/// What the frontend is told.
///
/// `seq` grows with every change. An answer to `backup_state` can reach the
/// page after an event that is newer than it, and the number is how the page
/// tells which of the two to believe.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub running: Option<Running>,
    pub seq: u64,
}

pub struct Flight {
    state: Mutex<State>,
    turn: Condvar,
}

impl Flight {
    pub const fn new() -> Self {
        Self { state: Mutex::new(State { running: None, seq: 0 }), turn: Condvar::new() }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        // Every change under this lock is two assignments, so a panic while
        // holding it cannot leave it half-made.
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn state(&self) -> State {
        self.lock().clone()
    }

    /// Run `f` once no other backup is running, and report the start and the
    /// end through `on_change`.
    ///
    /// A second call waits for the first and then makes its own run, rather
    /// than joining the first: the first run's plan was taken before the
    /// second press flushed what the writer had just typed.
    ///
    /// `on_change` is called with the lock held, so the end of one run can
    /// never be reported after the start of the next.
    pub fn exclusive<T>(&self, project: &str, on_change: &dyn Fn(&State), f: impl FnOnce() -> T) -> T {
        let mut state = self.lock();
        while state.running.is_some() {
            state = self.turn.wait(state).unwrap_or_else(|poisoned| poisoned.into_inner());
        }
        state.running = Some(Running { project: project.to_string(), started_at: now_secs() });
        state.seq += 1;
        on_change(&state);
        drop(state);
        let _finished = Finished { flight: self, on_change };
        f()
    }
}

/// Ends the run even when it panics, so one crashed backup cannot leave Back
/// up now disabled for the rest of the session.
struct Finished<'a> {
    flight: &'a Flight,
    on_change: &'a dyn Fn(&State),
}

impl Drop for Finished<'_> {
    fn drop(&mut self) {
        let mut state = self.flight.lock();
        state.running = None;
        state.seq += 1;
        (self.on_change)(&state);
        drop(state);
        self.flight.turn.notify_one();
    }
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// The app's one queue. Tests build their own, so parallel tests never wait
/// on each other.
pub static FLIGHT: Flight = Flight::new();

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn a_second_run_waits_for_the_first_and_both_are_reported_in_order() {
        let flight = &Flight::new();
        let log = &Mutex::new(Vec::<&str>::new());
        let changes = &Mutex::new(Vec::<Option<String>>::new());
        let record = &|state: &State| {
            changes.lock().unwrap().push(state.running.as_ref().map(|r| r.project.clone()));
        };
        let (a_started, a_has_started) = mpsc::channel::<()>();
        let (b_started, b_has_started) = mpsc::channel::<()>();

        std::thread::scope(|s| {
            s.spawn(move || {
                flight.exclusive("A", record, || {
                    log.lock().unwrap().push("A start");
                    let running = flight.state().running.map(|r| r.project);
                    assert_eq!(running.as_deref(), Some("A"), "the run in progress is reported");
                    a_started.send(()).unwrap();
                    // Holds A open, for up to a second, for B to start inside it.
                    if b_has_started.recv_timeout(Duration::from_secs(1)).is_ok() {
                        log.lock().unwrap().push("B started inside A");
                    }
                    log.lock().unwrap().push("A end");
                })
            });
            a_has_started.recv().unwrap();
            s.spawn(move || {
                flight.exclusive("B", record, || {
                    log.lock().unwrap().push("B start");
                    let _ = b_started.send(());
                    log.lock().unwrap().push("B end");
                })
            });
        });

        assert_eq!(*log.lock().unwrap(), ["A start", "A end", "B start", "B end"]);
        let changes = changes.lock().unwrap().clone();
        assert_eq!(changes, [Some("A".to_string()), None, Some("B".to_string()), None]);
        assert_eq!(flight.state(), State { running: None, seq: 4 }, "every change is numbered");
    }

    #[test]
    fn a_run_that_panics_still_ends() {
        let flight = Flight::new();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            flight.exclusive::<()>("A", &|_| {}, || panic!("a backup crashed"))
        }));
        assert!(result.is_err());
        assert_eq!(flight.state().running, None, "Back up now would stay disabled");
        // And the next run is not left waiting for it.
        assert_eq!(flight.exclusive("B", &|_| {}, || 7), 7);
    }
}
