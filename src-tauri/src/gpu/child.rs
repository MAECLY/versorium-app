//! Running the probe in a process of its own, with a time limit.
//!
//! The app starts itself as `versorium --gpu-probe`, which prints one JSON
//! line (`ProbeOutcome`) and exits. A driver that crashes or hangs inside
//! Vulkan takes that process down, never the app; what comes back here is
//! `Crashed` or `TimedOut`, and the engine stays off.

use super::classify::ProbeOutcome;
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// The flag that turns the app into the probe.
pub const FLAG: &str = "--gpu-probe";

/// Long enough for a first Vulkan instance on Windows, where Defender scans
/// the driver's DLLs; a hung driver still gives up in good time.
pub const TIMEOUT: Duration = Duration::from_secs(30);

/// `versorium --gpu-probe`: answer and exit, without opening a window.
pub fn parse_cli(mut args: impl Iterator<Item = String>) -> Option<i32> {
    if !args.any(|a| a == FLAG) {
        return None;
    }
    let outcome = super::probe::run();
    println!("{}", serde_json::to_string(&outcome).unwrap_or_default());
    Some(0)
}

/// What the probe's output says, or a crash when it said nothing usable.
pub fn read_outcome(success: bool, code: Option<i32>, stdout: &str) -> ProbeOutcome {
    let parsed = stdout.lines().rev().find_map(|line| serde_json::from_str::<ProbeOutcome>(line.trim()).ok());
    match parsed {
        Some(outcome) if success => outcome,
        _ => ProbeOutcome::Crashed { code },
    }
}

/// Run the probe as a child of this executable.
pub fn probe(timeout: Duration) -> ProbeOutcome {
    let Ok(exe) = std::env::current_exe() else {
        return ProbeOutcome::Crashed { code: None };
    };
    probe_with(&exe, &[FLAG], timeout)
}

fn probe_with(program: &std::path::Path, args: &[&str], timeout: Duration) -> ProbeOutcome {
    let mut command = Command::new(program);
    command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: no console flashes up behind the app.
        command.creation_flags(0x0800_0000);
    }
    let Ok(mut child) = command.spawn() else {
        return ProbeOutcome::Crashed { code: None };
    };
    let mut stdout = child.stdout.take();
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(out) = stdout.as_mut() {
            let _ = out.read_to_string(&mut text);
        }
        text
    });
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started.elapsed() < timeout => std::thread::sleep(Duration::from_millis(50)),
            _ => break None,
        }
    };
    let Some(status) = status else {
        let _ = child.kill();
        let _ = child.wait();
        return ProbeOutcome::TimedOut;
    };
    let text = reader.join().unwrap_or_default();
    read_outcome(status.success(), status.code(), &text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_probe_flag_is_recognised_anywhere_on_the_line() {
        assert!(parse_cli(["versorium".into(), "mcp".into()].into_iter()).is_none());
    }

    #[test]
    fn the_last_json_line_is_the_answer_and_anything_else_is_a_crash() {
        let out = "warning from a driver\n{\"probe\":\"loaderMissing\"}\n";
        assert_eq!(read_outcome(true, Some(0), out), ProbeOutcome::LoaderMissing);
        assert_eq!(read_outcome(false, Some(-1073741819), out), ProbeOutcome::Crashed { code: Some(-1073741819) });
        assert_eq!(read_outcome(true, Some(0), "no json"), ProbeOutcome::Crashed { code: Some(0) });
        assert_eq!(read_outcome(true, Some(0), ""), ProbeOutcome::Crashed { code: Some(0) });
    }

    #[cfg(unix)]
    #[test]
    fn a_probe_that_hangs_is_stopped_and_one_that_dies_is_a_crash() {
        let started = Instant::now();
        let hung = probe_with(std::path::Path::new("/bin/sh"), &["-c", "sleep 30"], Duration::from_millis(300));
        assert_eq!(hung, ProbeOutcome::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(5), "killed, not waited out");
        let died = probe_with(std::path::Path::new("/bin/sh"), &["-c", "exit 3"], Duration::from_secs(5));
        assert_eq!(died, ProbeOutcome::Crashed { code: Some(3) });
        let answered = probe_with(std::path::Path::new("/bin/sh"), &["-c", "echo '{\"probe\":\"notApplicable\"}'"], Duration::from_secs(5));
        assert_eq!(answered, ProbeOutcome::NotApplicable);
    }
}
