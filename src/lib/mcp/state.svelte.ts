import { api, isTauri, type McpClient, type McpLogEntry, type McpStatus } from "$lib/tauri";
import { errorMessage } from "$lib/i18n/errors";

/** What Rust keeps readable (`mcp::log::read_from` caps at 500): Activity filters over all of it. */
export const LOG_LIMIT = 500;

/**
 * Settings → Access to your novel and Activity. Every call goes through
 * `run`, so a rejected command surfaces a localized message and leaves the
 * previous status in place — a failed config write must not make an app look
 * disconnected.
 */
export class McpStore {
  status = $state<McpStatus | null>(null);
  log = $state<McpLogEntry[]>([]);
  loading = $state(false);
  error = $state<string | null>(null);

  get clients(): McpClient[] {
    return this.status?.clients ?? [];
  }

  async load(): Promise<void> {
    await this.run(async () => {
      this.status = await api.mcpStatus();
      this.log = await api.mcpLog(LOG_LIMIT);
    });
  }

  async refreshLog(): Promise<void> {
    await this.run(async () => {
      this.log = await api.mcpLog(LOG_LIMIT);
    });
  }

  setWrite(client: string, allowed: boolean): Promise<void> {
    return this.adopt(() => api.mcpSetWrite(client, allowed));
  }

  install(client: string): Promise<void> {
    return this.adopt(() => api.mcpInstallClient(client));
  }

  uninstall(client: string): Promise<void> {
    return this.adopt(() => api.mcpUninstallClient(client));
  }

  /**
   * Take write access back from every app that has it, one after another:
   * `run` drops a call made while another is on its way, so all at once
   * would revoke the first and silently skip the rest. Stops at a refusal.
   */
  async makeAllReadOnly(): Promise<void> {
    for (const id of this.clients.filter((c) => c.writeAllowed).map((c) => c.id)) {
      await this.setWrite(id, false);
      if (this.error) return;
    }
  }

  /**
   * The last error, which the caller says itself, where it was asked (an
   * app's row): taken, so the page does not say it a second time.
   */
  takeError(): string | null {
    const error = this.error;
    this.error = null;
    return error;
  }

  /** Rust returns the whole status after a mutation; take it as the truth. */
  private adopt(call: () => Promise<McpStatus>): Promise<void> {
    return this.run(async () => {
      this.status = await call();
    });
  }

  private async run(body: () => Promise<void>): Promise<void> {
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

export const mcp = new McpStore();
