//! Quitting waits for the last save.
//!
//! The chapter is saved 800 ms after the writer stops typing, and closing the
//! window saves at once (`onCloseRequested` in App.svelte). Cmd+Q, the app
//! menu's Quit and the Dock's Quit take another road: AppKit sends
//! `terminate:`, tao answers `applicationWillTerminate:` with `LoopDestroyed`,
//! and Tauri turns that into `RunEvent::Exit`, which cannot be cancelled. The
//! last 800 ms of typing and the pending change log were lost.
//!
//! AppKit's own way to wait is `applicationShouldTerminate:` answering
//! `NSTerminateLater`, then `replyToApplicationShouldTerminate:` once the work
//! is done. tao's delegate does not implement it (0.37.1), so this adds the
//! method to that delegate's class. The frontend is asked to save through
//! [`EVENT`] and answers with [`quit_ready`]. Logging out and shutting down
//! come through the same method, so they wait too.
//!
//! Quitting must never hang on a broken page: with no answer within [`GRACE`],
//! the app quits anyway. A save that fails cancels the quit instead, and the
//! frontend says why: quitting would throw away the very text it could not
//! write.

use std::sync::Mutex;
use std::time::Duration;

/// Asked of the frontend; App.svelte listens for it.
pub const EVENT: &str = "versorium://quit-requested";

/// How long a quit waits for the frontend before going ahead. A save is a
/// local file write; five seconds is only ever reached by a page that stopped
/// answering.
pub const GRACE: Duration = Duration::from_secs(5);

/// One quit in flight at most. Each request gets a number, so a late answer
/// (or the grace timer) for an earlier request cannot settle a later one.
#[derive(Debug, Default)]
pub struct Gate {
    waiting: Option<u64>,
    next: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Request {
    /// Ask the frontend to save; settle request `n` later.
    Ask(u64),
    /// A quit is already waiting on a save; this one adds nothing.
    AlreadyWaiting,
}

impl Gate {
    pub fn request(&mut self) -> Request {
        if self.waiting.is_some() {
            return Request::AlreadyWaiting;
        }
        self.next += 1;
        self.waiting = Some(self.next);
        Request::Ask(self.next)
    }

    /// The answer to give AppKit for request `n`, or `None` if that request
    /// was already settled — each one is answered exactly once.
    pub fn settle(&mut self, n: u64, quit: bool) -> Option<bool> {
        if self.waiting != Some(n) {
            return None;
        }
        self.waiting = None;
        Some(quit)
    }

    /// The request in flight, for an answer from the frontend, which does not
    /// carry the number back.
    pub fn current(&self) -> Option<u64> {
        self.waiting
    }
}

static GATE: Mutex<Gate> = Mutex::new(Gate { waiting: None, next: 0 });

fn gate() -> std::sync::MutexGuard<'static, Gate> {
    // A panic while holding this lock cannot leave it inconsistent: every
    // method is a couple of assignments.
    GATE.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The frontend's answer: `saved` is false when the save failed.
#[tauri::command]
pub fn quit_ready(app: tauri::AppHandle, saved: bool) {
    let settled = {
        let mut gate = gate();
        gate.current().and_then(|n| gate.settle(n, saved))
    };
    if let Some(quit) = settled {
        platform::reply(&app, quit);
    }
}

#[cfg(target_os = "macos")]
pub use platform::install;

#[cfg(not(target_os = "macos"))]
pub fn install(_app: &tauri::AppHandle) {}

#[cfg(target_os = "macos")]
mod platform {
    use super::{gate, Request, EVENT, GRACE};
    use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
    use objc2::{class, msg_send, sel};
    use std::sync::OnceLock;
    use tauri::{AppHandle, Emitter, Manager};

    // NSApplicationTerminateReply.
    const CANCEL: usize = 0;
    const NOW: usize = 1;
    const LATER: usize = 2;

    static APP: OnceLock<AppHandle> = OnceLock::new();

    /// Must run on the main thread after tao has set its delegate, which it
    /// does before Tauri's `setup`.
    pub fn install(app: &AppHandle) {
        let _ = APP.set(app.clone());
        // SAFETY: main thread; NSApp and its delegate outlive the process's
        // use of them. The method is added with the exact signature AppKit
        // calls it with: `- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender`,
        // whose return type is NSUInteger ("Q" on 64-bit).
        unsafe {
            let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let delegate: *mut AnyObject = msg_send![ns_app, delegate];
            let Some(delegate) = delegate.as_ref() else {
                eprintln!("versorium: no app delegate; Cmd+Q will not wait for the last save");
                return;
            };
            let class = delegate.class() as *const AnyClass as *mut AnyClass;
            let handler: extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> usize = should_terminate;
            let imp: Imp = std::mem::transmute(handler);
            let added = objc2::ffi::class_addMethod(class, sel!(applicationShouldTerminate:), imp, c"Q@:@".as_ptr());
            if !added.as_bool() {
                // tao grew its own: keep it rather than replace behaviour we
                // have not read.
                eprintln!("versorium: the app delegate already answers applicationShouldTerminate:; left as is");
            }
        }
    }

    extern "C-unwind" fn should_terminate(_this: &AnyObject, _sel: Sel, _sender: *mut AnyObject) -> usize {
        let Some(app) = APP.get() else { return NOW };
        // Nobody left to save anything.
        if app.webview_windows().is_empty() {
            return NOW;
        }
        let n = match gate().request() {
            Request::Ask(n) => n,
            Request::AlreadyWaiting => return CANCEL,
        };
        if app.emit(EVENT, ()).is_err() {
            gate().settle(n, true);
            return NOW;
        }
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(GRACE);
            if let Some(quit) = gate().settle(n, true) {
                eprintln!("versorium: no answer to the quit request within {GRACE:?}; quitting");
                reply(&app, quit);
            }
        });
        LATER
    }

    pub fn reply(app: &AppHandle, quit: bool) {
        let _ = app.run_on_main_thread(move || {
            // SAFETY: main thread, and AppKit is waiting for exactly this
            // reply: the gate hands out one per NSTerminateLater.
            unsafe {
                let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
                let _: () = msg_send![ns_app, replyToApplicationShouldTerminate: Bool::new(quit)];
            }
        });
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    pub fn reply(_app: &tauri::AppHandle, _quit: bool) {}
}

#[cfg(test)]
mod tests {
    use super::{Gate, Request};

    #[test]
    fn a_quit_is_asked_once_and_answered_once() {
        let mut gate = Gate::default();
        let Request::Ask(n) = gate.request() else { panic!("first quit must ask") };
        assert_eq!(gate.request(), Request::AlreadyWaiting, "a second Cmd+Q while saving adds nothing");
        assert_eq!(gate.settle(n, true), Some(true));
        assert_eq!(gate.settle(n, true), None, "the grace timer after a real answer must not reply again");
    }

    #[test]
    fn a_failed_save_cancels_and_the_next_quit_asks_again() {
        let mut gate = Gate::default();
        let Request::Ask(first) = gate.request() else { panic!() };
        assert_eq!(gate.settle(first, false), Some(false));
        let Request::Ask(second) = gate.request() else { panic!("after a cancel, Cmd+Q must ask again") };
        assert_ne!(first, second);
        assert_eq!(gate.settle(first, true), None, "a stale timer cannot settle the new request");
        assert_eq!(gate.settle(second, true), Some(true));
    }
}
