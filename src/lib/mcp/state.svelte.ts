import { api, isTauri, type McpClient, type McpLogEntry, type McpStatus } from "$lib/tauri";
import { errorMessage } from "$lib/i18n/errors";

/** The panel shows a recent tail, not the whole history. */
const LOG_LIMIT = 50;

/**
 * Settings → MCP panel state. Every call goes through `run`, so a rejected
 * command surfaces a localized message and leaves the previous status in place
 * — a failed config write must not make the panel look disconnected.
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
