/**
 * Sent by Rust (`STATE_EVENT` in `src-tauri/src/commands/backup.rs`) when a
 * backup starts and when it ends. A Rust test reads this file, so the two
 * names cannot drift apart, and the e2e mock imports it rather than repeating
 * it. Kept free of imports for the mock, which loads before the app.
 */
export const BACKUP_STATE_EVENT = "versorium://backup-state";
