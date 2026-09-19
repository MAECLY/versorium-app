import { api, isTauri, type AgentInfo } from "$lib/tauri";

let cached: AgentInfo[] | null = null;
let inflight: Promise<AgentInfo[]> | null = null;

/**
 * Detection spawns five `--version` probes and pings the Ollama daemon, so it
 * takes seconds. One scan per session is shared by every caller; Re-check
 * forces a fresh one.
 */
export function detectAgents(force = false): Promise<AgentInfo[]> {
  if (!isTauri()) return Promise.resolve([]);
  if (!force && cached) return Promise.resolve(cached);
  if (!force && inflight) return inflight;
  const scan = api.agentsDetect().then((list) => {
    cached = list;
    return list;
  }).finally(() => {
    if (inflight === scan) inflight = null;
  });
  inflight = scan;
  return scan;
}

/** Test seam. */
export function resetAgentCache(): void {
  cached = null;
  inflight = null;
}
