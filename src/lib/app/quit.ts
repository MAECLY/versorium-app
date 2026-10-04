/**
 * The frontend's half of "quitting waits for the last save"
 * (src-tauri/src/quit.rs): save, then tell Rust whether quitting is safe.
 *
 * A failed save answers false, which cancels the quit — quitting would throw
 * away exactly the text that could not be written. Rust quits anyway if no
 * answer comes at all, so a broken page can never keep the app open.
 */
export async function answerQuit(
  save: () => Promise<void>,
  reply: (saved: boolean) => Promise<void>,
  onFailure: (error: unknown) => void,
): Promise<void> {
  let saved = true;
  try {
    await save();
  } catch (error) {
    saved = false;
    onFailure(error);
  }
  await reply(saved);
}
