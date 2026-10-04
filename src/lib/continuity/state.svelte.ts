import { api, isTauri, type ContinuityReport } from "$lib/tauri";
import { errorMessage } from "$lib/i18n/errors";

/**
 * The continuity check, run from Manuscript › Continuity.
 *
 * Its own state rather than the panel's: the dialog's footer holds the button
 * and the panel the result, and both have to agree on whether a check is
 * running. A report says it did not run, with a code, as often as it lists
 * findings; that is an answer, not an error. `error` is for a command that
 * failed outright.
 */
export class ContinuityRunner {
  report = $state<ContinuityReport | null>(null);
  busy = $state(false);
  error = $state<string | null>(null);

  /**
   * Which check the panel is waiting for. `reset` moves it on, so a check
   * still running when the dialog closed answers nobody: the dialog may open
   * next on another novel, and its findings are not that novel's.
   */
  private ticket = 0;

  async run(path: string): Promise<void> {
    if (!isTauri() || this.busy) return;
    const mine = ++this.ticket;
    this.busy = true;
    this.error = null;
    try {
      const report = await api.continuityCheck(path);
      if (mine === this.ticket) this.report = report;
    } catch (e) {
      if (mine === this.ticket) this.error = errorMessage(e);
    } finally {
      if (mine === this.ticket) this.busy = false;
    }
  }

  /**
   * A fresh dialog shows no result from another visit, or another novel, and
   * a check still on its way from one is not waited for: its answer is
   * dropped when it comes.
   */
  reset(): void {
    this.ticket += 1;
    this.busy = false;
    this.report = null;
    this.error = null;
  }
}

export const continuityRunner = new ContinuityRunner();
