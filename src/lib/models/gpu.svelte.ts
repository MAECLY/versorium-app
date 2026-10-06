import { api, isTauri, type GpuReadiness } from "$lib/tauri";
import { errorMessage } from "$lib/i18n/errors";

/**
 * The GPU check (src-tauri/src/gpu), as Models and Tasks show it: whether
 * local AI runs on a GPU, on the processor, or cannot start here, and what
 * this computer would need.
 *
 * The first check runs at launch on a background thread with nothing to
 * notify us, so `load` asks again until it has an answer. "Check again"
 * looks anew; when it passes, Rust starts the engine without a restart.
 */
export class GpuStore {
  /** Null until the first answer arrives, and outside the desktop app. */
  readiness = $state<GpuReadiness | null>(null);
  checking = $state(false);
  error = $state<string | null>(null);
  /** The modal: opened by the notice, or once per visit when unavailable. */
  open = $state(false);
  private loading = false;
  private shownUnavailable = false;

  /** Local AI runs, but on the processor: slower, and the notice says why. */
  get onCpu(): boolean {
    return this.readiness?.state === "cpu";
  }

  /** Local AI cannot start on this computer until something is installed. */
  get unavailable(): boolean {
    return this.readiness?.state === "unavailable";
  }

  async load(): Promise<void> {
    if (!isTauri() || this.loading) return;
    this.loading = true;
    try {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const answer = await api.gpuReadiness();
        if (answer) {
          this.readiness = answer;
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch {
      // No answer is not a state: the last one stands.
    } finally {
      this.loading = false;
    }
  }

  /** Open the modal on its own once per visit to a page, when nothing runs. */
  offerOnce(): void {
    if (this.unavailable && !this.shownUnavailable) {
      this.shownUnavailable = true;
      this.open = true;
    }
  }

  async checkAgain(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    this.error = null;
    try {
      this.readiness = await api.gpuCheckAgain();
    } catch (e) {
      this.error = errorMessage(e);
    } finally {
      this.checking = false;
    }
  }
}

export const gpu = new GpuStore();
