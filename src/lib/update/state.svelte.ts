import { api, isTauri, type InstallProgress, type UpdateStatus } from "$lib/tauri";
import { errorMessage } from "$lib/i18n/errors";

/**
 * Settings → Updates and the update dialog share this state.
 *
 * Every call goes through `run`, so a failed check leaves the previous status
 * in place: spec §11.7 is explicit that a network problem must not nag, and a
 * status that blanks itself on every flaky check reads like a broken app.
 */
export class UpdateStore {
  status = $state<UpdateStatus | null>(null);
  busy = $state(false);
  error = $state<string | null>(null);
  /** Null until an install starts. Polled, like a model download's bytes. */
  progress = $state<InstallProgress | null>(null);

  /** Often enough to look live without hammering a command that takes a lock. */
  private static readonly POLL_MS = 400;
  private timer: ReturnType<typeof setInterval> | undefined;

  get available(): UpdateStatus["available"] {
    return this.status?.available ?? null;
  }

  get signedIn(): boolean {
    return this.status?.signedIn ?? false;
  }

  /** Read the current state without touching the network. */
  load(): Promise<void> {
    return this.adopt(() => api.updateStatus());
  }

  check(): Promise<void> {
    return this.adopt(() => api.updateCheck());
  }

  /** Never offered again, even if it is still the newest release. */
  skip(): Promise<void> {
    const version = this.available?.version;
    if (!version) return Promise.resolve();
    return this.adopt(() => api.updateSkip(version));
  }

  setChannel(channel: "stable" | "beta"): Promise<void> {
    return this.adopt(() => api.updateSetChannel(channel));
  }

  setAutomatic(automatic: boolean): Promise<void> {
    return this.adopt(() => api.updateSetAutomatic(automatic));
  }

  /**
   * Verify, replace, relaunch — the process may not come back, so nothing is
   * reset afterwards on the success path.
   */
  async install(): Promise<void> {
    if (!isTauri() || this.busy) return;
    this.busy = true;
    this.error = null;
    this.progress = { phase: "downloading", received: 0, total: null, error: null };
    this.startPolling();
    try {
      await api.updateInstall();
      // On macOS the bundle is swapped in place and control returns here, so
      // the dialog asks for a restart. On Windows the installer may replace the
      // process and this line is never reached — both are correct.
      this.progress = await api.updateProgress();
    } catch (e) {
      this.error = errorMessage(e);
      this.progress = null;
    } finally {
      this.stopPolling();
      this.busy = false;
    }
  }

  /** Restart into the version that was just installed. */
  async relaunch(): Promise<void> {
    if (!isTauri()) return;
    await api.updateRelaunch();
  }

  private startPolling(): void {
    this.stopPolling();
    this.timer = setInterval(() => {
      void api
        .updateProgress()
        .then((p) => {
          if (this.busy) this.progress = p;
        })
        .catch(() => this.stopPolling());
    }, UpdateStore.POLL_MS);
  }

  private stopPolling(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * The startup check (spec §11): quiet, once, and only when the writer both
   * asked for automatic updates and signed in. A failure here is deliberately
   * swallowed — it must not greet anyone with an error on launch.
   */
  async checkOnStartup(): Promise<void> {
    if (!isTauri()) return;
    await this.load();
    if (!this.status?.automatic || !this.status.signedIn) return;
    await this.check();
    this.error = null;
  }

  private async adopt(call: () => Promise<UpdateStatus>): Promise<void> {
    if (!isTauri() || this.busy) return;
    this.busy = true;
    this.error = null;
    try {
      this.status = await call();
    } catch (e) {
      this.error = errorMessage(e);
    } finally {
      this.busy = false;
    }
  }
}

export const updates = new UpdateStore();
