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
 * Settings → Local AI state. Mutations re-read the whole view from Rust rather
 * than patching locally: disk state, slots and the download queue all move
 * together, and a half-applied view would show a model as Ready that is not.
 */
export class ModelsStore {
  view = $state<LocalAiView | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);
  /** Result of the last Studio test; null until one has been run. */
  studioReachable = $state<boolean | null>(null);

  private timer: ReturnType<typeof setInterval> | undefined;
  private disposed = false;

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
      this.view = await api.modelsView();
      // A download may already be running from an earlier visit to the panel.
      if (this.view.progress && !this.view.progress.done) this.startPolling();
    });
  }

  async download(id: string): Promise<void> {
    await this.run(async () => {
      await api.modelsDownload(id);
      this.startPolling();
    });
    if (!this.error) await this.refresh();
  }

  async cancel(id: string): Promise<void> {
    await this.run(() => api.modelsCancel(id));
    this.stopPolling();
    await this.refresh();
  }

  async remove(id: string): Promise<void> {
    await this.run(() => api.modelsDelete(id));
    await this.refresh();
  }

  async setSlot(slot: SlotName, kind: SlotKind, id: string): Promise<void> {
    await this.run(async () => {
      const slots = await api.modelsSetSlot(slot, kind, id);
      if (this.view) this.view = { ...this.view, slots };
    });
  }

  async pullOllama(name: string): Promise<void> {
    await this.run(() => api.ollamaPull(name.trim()));
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

  async saveStudio(host: string, port: number, enabled: boolean): Promise<void> {
    await this.run(async () => {
      const studio = await api.studioSave(host, port, enabled);
      if (this.view) this.view = { ...this.view, studio };
    });
  }

  /** Stop the poller when the panel goes away. `load` revives the store. */
  dispose(): void {
    this.disposed = true;
    this.stopPolling();
  }

  private async refresh(): Promise<void> {
    if (!isTauri() || this.disposed) return;
    try {
      this.view = await api.modelsView();
    } catch {
      // Keep the previous view: a failed refresh is not worth blanking the panel.
    }
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
