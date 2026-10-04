import {
  api,
  isTauri,
  type LocalAiView,
  type ModelCard,
  type SlotKind,
  type SlotName,
} from "$lib/tauri";
import { errorMessage } from "$lib/i18n/errors";

/** A download reports bytes often enough to feel live without busy-waiting. */
const POLL_MS = 700;

/**
 * Settings → Tasks and Models state. Mutations re-read the whole view from
 * Rust rather than patching locally: disk state, slots and the download queue
 * all move together, and a half-applied view would show a model as Ready that
 * is not. Censorship is the one exception (`setCensorship`), because it only
 * filters what is already on screen.
 */
export class ModelsStore {
  view = $state<LocalAiView | null>(null);
  /** A change is on its way to Rust (a slot, Ollama, the server, a delete). */
  loading = $state(false);
  /**
   * The catalogue model being downloaded. Its own state, not `loading`: a
   * download takes minutes, and held under `loading` it used to drop every
   * other change made meanwhile without a word, and lock the task pickers.
   */
  downloadingId = $state<string | null>(null);
  /** The Ollama tag being pulled; its own state for the same reason. */
  pulling = $state<string | null>(null);
  /** Why the last pull failed, said in the Ollama row rather than at the top. */
  pullError = $state<string | null>(null);
  error = $state<string | null>(null);
  /** Result of the last Studio test; null until one has been run. */
  studioReachable = $state<boolean | null>(null);

  private timer: ReturnType<typeof setInterval> | undefined;
  private disposed = false;
  /** Slot changes, one after another; see `setSlot`. */
  private slotChain: Promise<void> = Promise.resolve();
  /**
   * Bumped as a slot or the censorship starts changing, and again as the
   * change lands. A view asked for before then carries what Rust held when it
   * was asked, which is older than what is on screen; see `fetchView`.
   */
  private changes = 0;
  /** The surfaces showing the models now (Settings, Manuscript › Continuity); see `open`. */
  private users = 0;

  get models(): ModelCard[] {
    return this.view?.models ?? [];
  }

  /** Writing-tab cards, hiding uncensored ones while censorship is on (§6.2). */
  get writing(): ModelCard[] {
    const censored = this.view?.censorship ?? false;
    return this.models.filter((m) => m.task === "writing" && !(censored && m.uncensored));
  }

  get dictation(): ModelCard[] {
    return this.models.filter((m) => m.task === "dictation");
  }

  async load(): Promise<void> {
    // The panel can be closed and reopened; a previous dispose must not leave
    // the store permanently deaf to progress.
    this.disposed = false;
    await this.run(async () => {
      this.view = await this.fetchView();
      // A download may already be running from an earlier visit to the panel.
      if (this.view.progress && !this.view.progress.done) this.startPolling();
    });
  }

  /**
   * Settings, or the Manuscript dialog's Continuity tab (which can open over
   * Settings), starts showing the models: the view is read afresh. The
   * download poller is let go only when the last of them closes (`close`),
   * so closing the dialog never stops the bar Settings still shows under it.
   */
  open(): Promise<void> {
    this.users += 1;
    return this.load();
  }

  close(): void {
    this.users = Math.max(0, this.users - 1);
    if (this.users === 0) this.dispose();
  }

  /**
   * One download at a time, as Rust allows (`download_busy`): a second press
   * while one runs starts nothing, and the buttons say why (Models).
   */
  async download(id: string): Promise<void> {
    if (!isTauri() || this.downloadingId !== null) return;
    // `models_download` does not resolve until the file is on disk, so polling
    // has to begin BEFORE the await. It used to start after, which is the
    // moment the download finished — so a writer pressing Download watched a
    // greyed-out button and nothing else for however long a 3 GB file takes.
    const card = this.models.find((m) => m.id === id);
    if (this.view) {
      // Seeded rather than waited for: the first poll is 700ms away, and a
      // button that does nothing for most of a second reads as broken.
      this.view = {
        ...this.view,
        progress: { id, received: card?.receivedBytes ?? 0, total: card?.sizeBytes ?? 0, done: false },
      };
    }
    this.downloadingId = id;
    this.error = null;
    this.startPolling();
    try {
      await api.modelsDownload(id);
    } catch (e) {
      // Rust ends a download the writer cancelled with `cancelled`: their own
      // press, not a failure to report.
      if (e !== "cancelled") this.error = errorMessage(e);
    } finally {
      this.downloadingId = null;
      this.stopPolling();
    }
    await this.refresh();
  }

  /**
   * Stop a download in flight.
   *
   * Deliberately not routed through `run`: Cancel must work whatever else is
   * on its way to Rust. (When the download itself held `loading`, routing it
   * through `run` made Cancel dead for exactly as long as it was the only
   * button on screen.)
   */
  async cancel(id: string): Promise<void> {
    if (!isTauri()) return;
    try {
      await api.modelsCancel(id);
    } catch (e) {
      this.error = errorMessage(e);
    }
    this.stopPolling();
    await this.refresh();
  }

  async remove(id: string): Promise<void> {
    await this.run(() => api.modelsDelete(id));
    await this.refresh();
  }

  /**
   * Choose a task's model. Chained rather than guarded: two quick choices
   * (WebView2 changes a closed select on every arrow key) both reach Rust, in
   * order, so the last one stands. Through `run` the second was dropped while
   * the first was on its way, and the select went on showing a choice that
   * was never saved. It holds nothing else either, so a select never locks
   * (and loses focus) while its own change is saved.
   */
  setSlot(slot: SlotName, kind: SlotKind, id: string): Promise<void> {
    const job = this.slotChain.then(() => this.saveSlot(slot, kind, id));
    this.slotChain = job.catch(() => undefined);
    return job;
  }

  private async saveSlot(slot: SlotName, kind: SlotKind, id: string): Promise<void> {
    if (!isTauri()) return;
    this.error = null;
    this.changes += 1;
    try {
      const slots = await api.modelsSetSlot(slot, kind, id);
      if (this.view) this.view = { ...this.view, slots };
    } catch (e) {
      this.error = errorMessage(e);
    } finally {
      this.changes += 1;
    }
  }

  /**
   * Get a model into Ollama by name. Minutes, like a download, so it holds
   * its own state and never `loading`: the task pickers stay usable.
   */
  async pullOllama(name: string): Promise<void> {
    const tag = name.trim();
    if (!isTauri() || !tag || this.pulling !== null) return;
    this.pulling = tag;
    this.pullError = null;
    try {
      await api.ollamaPull(tag);
    } catch (e) {
      this.pullError = errorMessage(e);
    } finally {
      this.pulling = null;
    }
    await this.refresh();
  }

  async removeOllama(name: string): Promise<void> {
    await this.run(() => api.ollamaRemove(name));
    await this.refresh();
  }

  async testStudio(host: string, port: number): Promise<void> {
    this.studioReachable = null;
    await this.run(async () => {
      this.studioReachable = await api.studioTest(host, port);
    });
  }

  /**
   * Save the local server (`saved`), or forget it. Forgetting releases every
   * task that ran on it, in Rust, and so does saving it at another
   * computer's address; when a task ran on it, the slots are read back.
   */
  async saveStudio(host: string, port: number, saved: boolean): Promise<void> {
    await this.run(async () => {
      const onServer = this.view !== null && Object.values(this.view.slots).some((s) => s.kind === "server");
      const studio = await api.studioSave(host, port, saved);
      if (this.view) this.view = { ...this.view, studio };
      if (!saved || onServer) await this.refresh();
    });
  }

  /**
   * Show or hide uncensored models. The list follows at once, rather than on
   * the next visit (SPEC C4); a save that fails puts it back, and the error
   * goes to the caller, which says so.
   */
  async setCensorship(show: boolean): Promise<void> {
    if (!isTauri()) return;
    const before = this.view?.censorship;
    if (this.view) this.view = { ...this.view, censorship: !show };
    this.changes += 1;
    try {
      await api.setSettings({ censorship: !show });
    } catch (e) {
      if (this.view && before !== undefined) this.view = { ...this.view, censorship: before };
      throw e;
    } finally {
      this.changes += 1;
    }
  }

  /** Stop the poller when the panel goes away. `load` revives the store. */
  dispose(): void {
    this.disposed = true;
    this.stopPolling();
  }

  private async refresh(): Promise<void> {
    if (!isTauri() || this.disposed) return;
    try {
      this.view = await this.fetchView();
    } catch {
      // Keep the previous view: a failed refresh is not worth blanking the panel.
    }
  }

  /**
   * The view from Rust. If a slot or the censorship changed while it was on
   * its way (`models_view` reads the settings, then waits on Ollama and the
   * saved server), its slots and censorship are older than the ones on
   * screen, which came from the change itself: those stay. A download's
   * closing refresh used to put the old task back in the select while Rust
   * held the new one.
   */
  private async fetchView(): Promise<LocalAiView> {
    const asked = this.changes;
    const next = await api.modelsView();
    if (asked === this.changes || !this.view) return next;
    return { ...next, slots: this.view.slots, censorship: this.view.censorship };
  }

  private startPolling(): void {
    if (this.timer || this.disposed || !isTauri()) return;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
  }

  private stopPolling(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    let progress;
    try {
      progress = await api.modelsProgress();
    } catch {
      this.stopPolling();
      return;
    }
    if (this.view) this.view = { ...this.view, progress };
    // A finished or vanished download has nothing left to report.
    if (!progress || progress.done) {
      this.stopPolling();
      await this.refresh();
    }
  }

  private async run(body: () => Promise<unknown>): Promise<void> {
    if (!isTauri() || this.loading) return;
    this.loading = true;
    this.error = null;
    try {
      await body();
    } catch (e) {
      this.error = errorMessage(e);
    } finally {
      this.loading = false;
    }
  }
}

export const models = new ModelsStore();

/** Bytes as the shortest honest unit, so copy never hardcodes "GB". */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Whole percent of a download, clamped so a bad total cannot show NaN. */
export function percent(received: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((received / total) * 100)));
}
