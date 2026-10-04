import type { BackupState } from "$lib/tauri";

/** Before the first report arrives: nothing known to be running. */
export const UNKNOWN_STATE: BackupState = { running: null, seq: -1 };

/**
 * The newer of two reports about the backup in progress.
 *
 * The backup panel asks Rust when it opens and listens for changes from then
 * on. The answer to the question can reach the page after an event that is
 * newer than it, and believing the answer would show a finished backup as
 * still running, or a running one as finished.
 */
export function newerState(current: BackupState, next: BackupState): BackupState {
  return next.seq >= current.seq ? next : current;
}
