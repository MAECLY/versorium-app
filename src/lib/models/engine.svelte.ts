import { api, isTauri, type LlamaBackendState } from "$lib/tauri";

/**
 * The in-process engine (llama.cpp), as Tasks and Models both show it: Tasks
 * says when a task's built-in model cannot run, Models says what the engine
 * is doing under About this computer.
 *
 * Warm-up runs on a background thread in Rust with nothing to notify us, so
 * `poll` asks again until it settles. The interval is slow on purpose: the
 * cost being waited on is ~15s of Metal shader compilation, once per
 * computer. One poll at a time, whichever page asked first.
 */
export class EngineStore {
  /** Null until the first answer arrives. */
  state = $state<LlamaBackendState | null>(null);
  private polling = false;

  get failed(): boolean {
    return this.state?.state === "failed";
  }

  /** The GPU check keeps the engine off on this computer (src-tauri/src/gpu). */
  get unavailable(): boolean {
    return this.state?.state === "unavailable";
  }

  get warming(): boolean {
    return this.state === null || this.state.state === "warming";
  }

  async poll(): Promise<void> {
    if (!isTauri() || this.polling) return;
    this.polling = true;
    try {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        this.state = await api.llamaBackend();
        if (this.state.state !== "warming") return;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch {
      // No answer is not a state: the last one stands.
    } finally {
      this.polling = false;
    }
  }
}

export const engine = new EngineStore();
