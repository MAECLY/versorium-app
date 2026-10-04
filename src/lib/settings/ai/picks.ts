import { getLocale, t } from "$lib/i18n";
import { humanSize } from "$lib/models/state.svelte";
import type { AgentInfo, LocalAiView, ModelCard, SlotAssignment, SlotKind, StudioView } from "$lib/tauri";

/**
 * What Settings → Tasks and Models decide, without the markup: which model a
 * task can be given, what each choice means for the passage, the one-click
 * offer, the single recommended download. Pure, so the rules are tested on
 * the real catalogue (tests/unit/ai-picks.test.ts).
 *
 * The two tasks that exist are Rewrite and Continuity. Project chat, search by
 * meaning and dictation are not built, and nothing here offers them.
 */

export type TaskSlot = "rewrite" | "continuity";
export const TASKS: readonly TaskSlot[] = ["rewrite", "continuity"];

export type Tier = ModelCard["tier"];
export const TIER_RANK: Record<Tier, number> = { low: 0, mid: 1, midPlus: 2, high: 3 };

/** The assistants that rewrite prose, in the order Settings lists them. `gh` is a git tool. */
export const PROSE_ASSISTANTS = ["claude", "codex", "opencode"] as const;

/** Where a choice sends the passage, as the status line's leading bar says it. */
export type Bar = "local" | "network" | "cli" | "warn" | "mute";

export interface TaskOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface TaskGroup {
  label: string;
  options: TaskOption[];
}

export interface TaskChoices {
  /** Always a value the select shows: a stored choice never silently becomes the first option. */
  value: string;
  options: TaskOption[];
  groups: TaskGroup[];
}

export interface Line {
  text: string;
  warn: boolean;
}

export interface Candidate {
  kind: "builtin" | "ollama" | "server";
  id: string;
  label: string;
  model?: ModelCard;
}

export type SummaryButton =
  | { kind: "getModel" }
  | { kind: "both" | "continuity"; candidate: Candidate; meta: string }
  | { kind: "checkAgain" };

export interface TaskSummary {
  sentences: Line[];
  button: SummaryButton | null;
}

/** One vocabulary for a model's size, everywhere (onboarding included). */
export function sizeWordKey(tier: string): string {
  return `settings.models.size.${tier in TIER_RANK ? tier : "low"}`;
}

export function slotValue(assignment: SlotAssignment): string {
  return assignment.kind === "none" ? "none" : `${assignment.kind}:${assignment.id}`;
}

/** The kind is up to the first colon: Ollama tags carry colons of their own. */
export function parseValue(value: string): { kind: SlotKind; id: string } {
  if (value === "none") return { kind: "none", id: "" };
  const at = value.indexOf(":");
  if (at < 0) return { kind: value as SlotKind, id: "" };
  return { kind: value.slice(0, at) as SlotKind, id: value.slice(at + 1) };
}

/** Ready catalogue models that write. The embedding model is never a task's (C6). */
export function writingReady(view: LocalAiView): ModelCard[] {
  return view.models.filter((m) => m.task === "writing" && m.state === "ready");
}

function byTierThenSize(a: ModelCard, b: ModelCard): number {
  return TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.sizeBytes - b.sizeBytes;
}

function largest(models: readonly ModelCard[]): ModelCard | null {
  return models.reduce<ModelCard | null>((best, m) => (best && byTierThenSize(best, m) >= 0 ? best : m), null);
}

/**
 * The one model "Start here" offers and the catalogue marks Recommended: the
 * smallest Medium model that fits this computer, else the largest Small one.
 * Never an uncensored model, and never more than one.
 */
export function recommendedModel(models: readonly ModelCard[]): ModelCard | null {
  const fit = models.filter((m) => m.task === "writing" && !m.uncensored && m.fits);
  const mids = fit.filter((m) => m.tier === "mid");
  if (mids.length > 0) return mids.reduce((a, b) => (b.sizeBytes < a.sizeBytes ? b : a));
  const lows = fit.filter((m) => m.tier === "low");
  if (lows.length > 0) return lows.reduce((a, b) => (b.sizeBytes > a.sizeBytes ? b : a));
  return null;
}

/** 127.0.0.0/8, `localhost` and `::1`: a server on this computer. */
export function isLoopback(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1");
  if (h === "localhost" || h === "::1") return true;
  const parts = h.split(".");
  return (
    parts.length === 4 &&
    parts[0] === "127" &&
    parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
  );
}

/** As a writer would type it back: `[::1]:1234`, `192.168.1.20:1234`. */
export function serverAddress(studio: Pick<StudioView, "host" | "port">): string {
  return studio.host.includes(":") ? `[${studio.host}]:${studio.port}` : `${studio.host}:${studio.port}`;
}

/** The prose assistants found on this computer, in Settings' order. */
export function foundAssistants(agents: readonly AgentInfo[]): AgentInfo[] {
  return PROSE_ASSISTANTS.map((id) => agents.find((a) => a.id === id)).filter(
    (a): a is AgentInfo => a !== undefined && a.state !== "missing",
  );
}

/** What the server's models can do for a task now: offered only while saved and answering. */
function servedModels(view: LocalAiView): string[] {
  const studio = view.studio;
  return studio.enabled && studio.running ? studio.models : [];
}

/**
 * The best ready model on this computer, for "Use {model} for both": the
 * largest built-in model that fits and is not uncensored (an uncensored one
 * only when nothing else is ready), then a model in Ollama, then one on a
 * local server on this computer. Never an assistant, never a server elsewhere.
 */
export function oneClickCandidate(view: LocalAiView): Candidate | null {
  const ready = writingReady(view).filter((m) => m.fits);
  const best = largest(ready.filter((m) => !m.uncensored)) ?? largest(ready);
  if (best) return { kind: "builtin", id: best.id, label: best.label, model: best };
  const tag = view.ollama.running ? view.ollama.models[0]?.name : undefined;
  if (tag) return { kind: "ollama", id: tag, label: tag };
  const served = isLoopback(view.studio.host) ? servedModels(view)[0] : undefined;
  if (served) return { kind: "server", id: served, label: served };
  return null;
}

/** What a slot points at now, read against what is on this computer. */
export type Resolved =
  | { state: "none" }
  | { state: "builtin"; model: ModelCard }
  | { state: "tooLarge"; model: ModelCard }
  | { state: "ollama"; tag: string }
  | { state: "server"; model: string; remote: boolean }
  | { state: "cli"; agent: AgentInfo }
  | { state: "ollamaDown"; tag: string }
  | { state: "serverDown"; model: string }
  | { state: "cannotWrite"; label: string }
  | { state: "gone"; label: string };

export function resolveSlot(assignment: SlotAssignment, view: LocalAiView, agents: readonly AgentInfo[]): Resolved {
  const id = assignment.id;
  switch (assignment.kind) {
    case "builtin": {
      const model = view.models.find((m) => m.id === id);
      if (!model || model.state !== "ready") return { state: "gone", label: model?.label ?? id };
      // The old pickers listed the embedding model too (C6): it is on this
      // computer, so "gone" would be untrue; it cannot write.
      if (model.task !== "writing") return { state: "cannotWrite", label: model.label };
      return model.fits ? { state: "builtin", model } : { state: "tooLarge", model };
    }
    case "ollama":
      if (!view.ollama.running) return { state: "ollamaDown", tag: id };
      return view.ollama.models.some((m) => m.name === id) ? { state: "ollama", tag: id } : { state: "gone", label: id };
    case "server": {
      const studio = view.studio;
      if (!studio.enabled) return { state: "gone", label: id };
      if (!studio.running) return { state: "serverDown", model: id };
      return studio.models.includes(id)
        ? { state: "server", model: id, remote: !isLoopback(studio.host) }
        : { state: "gone", label: id };
    }
    case "cli": {
      const agent = foundAssistants(agents).find((a) => a.id === id);
      if (agent) return { state: "cli", agent };
      return { state: "gone", label: agents.find((a) => a.id === id)?.name ?? id };
    }
    default:
      return { state: "none" };
  }
}

/**
 * A task's slot as that task can use it. Continuity never runs on an
 * assistant, so one stored there (the old pickers allowed it) reads as
 * nothing chosen, found or not.
 */
export function resolveTask(
  slot: TaskSlot,
  assignment: SlotAssignment,
  view: LocalAiView,
  agents: readonly AgentInfo[],
): Resolved {
  if (slot === "continuity" && assignment.kind === "cli") return { state: "none" };
  return resolveSlot(assignment, view, agents);
}

const K = "settings.tasks";

function taskTitle(slot: TaskSlot): string {
  return t(`${K}.${slot}.title`);
}

/** Tasks by title, as a list in the interface's language: "Rewrite and Continuity". */
export function taskNames(slots: readonly TaskSlot[]): string {
  return new Intl.ListFormat(getLocale(), { type: "conjunction" }).format(slots.map(taskTitle));
}

/**
 * The choices for one task's select, grouped by where the passage goes.
 * Every ready built-in writing model (largest first), every Ollama tag while
 * Ollama runs, the saved server's models while it answers; for Rewrite the
 * assistants found, for Continuity the same assistants, disabled, with the
 * reason in their group's label. A stored choice that is no longer there is
 * shown, disabled and selected, under "No longer available".
 */
export function taskOptions(
  slot: TaskSlot,
  assignment: SlotAssignment,
  view: LocalAiView,
  agents: readonly AgentInfo[],
): TaskChoices {
  const value = slotValue(assignment);
  const options: TaskOption[] = [{ value: "none", label: t(`${K}.${slot}.none`) }];
  const groups: TaskGroup[] = [];

  const local: TaskOption[] = writingReady(view)
    .sort((a, b) => byTierThenSize(b, a))
    .map((m) => ({ value: `builtin:${m.id}`, label: t(`${K}.option.builtin`, { model: m.label }) }));
  if (view.ollama.running) {
    for (const o of view.ollama.models) {
      local.push({ value: `ollama:${o.name}`, label: t(`${K}.option.ollama`, { model: o.name }) });
    }
  }

  const studio = view.studio;
  const remote = !isLoopback(studio.host);
  const address = serverAddress(studio);
  const server: TaskOption[] = [];
  if (studio.enabled) {
    if (studio.running) {
      for (const model of studio.models) {
        server.push({
          value: `server:${model}`,
          label: remote
            ? t(`${K}.option.serverRemote`, { model, address })
            : t(`${K}.option.server`, { model }),
        });
      }
    } else if (assignment.kind !== "server") {
      // Saved and silent: said once, and never stored.
      server.push({ value: "server", label: t(`${K}.option.serverOff`), disabled: true });
    }
  }
  if (!remote) local.push(...server);
  if (local.length > 0) groups.push({ label: t(`${K}.group.local`), options: local });
  if (remote && server.length > 0) groups.push({ label: t(`${K}.group.network`, { address }), options: server });

  const assistants = foundAssistants(agents);
  if (assistants.length > 0) {
    groups.push(
      slot === "rewrite"
        ? {
            label: t(`${K}.group.assistants`),
            options: assistants.map((a) => ({ value: `cli:${a.id}`, label: a.name })),
          }
        : {
            label: t(`${K}.group.assistantsOff`),
            options: assistants.map((a) => ({ value: `cli:${a.id}`, label: a.name, disabled: true })),
          },
    );
  }

  const every = [...options, ...groups.flatMap((g) => g.options)];
  if (!every.some((o) => o.value === value)) {
    const resolved = resolveSlot(assignment, view, agents);
    const label =
      resolved.state === "ollamaDown"
        ? t(`${K}.option.ollamaDown`, { model: resolved.tag })
        : resolved.state === "serverDown"
          ? t(`${K}.option.serverDown`, { model: resolved.model })
          : resolved.state === "cannotWrite"
            ? t(`${K}.option.cannotWrite`, { model: resolved.label })
            : t(`${K}.option.gone`, { model: "label" in resolved ? resolved.label : assignment.id });
    groups.push({ label: t(`${K}.group.gone`), options: [{ value, label, disabled: true }] });
  }
  return { value, options, groups };
}

/** The status line under a task's select: where the passage goes with this choice. */
export function taskStatus(
  slot: TaskSlot,
  assignment: SlotAssignment,
  view: LocalAiView,
  agents: readonly AgentInfo[],
): { text: string; bar: Bar } {
  const resolved = resolveTask(slot, assignment, view, agents);
  const rewrite = slot === "rewrite";
  const address = serverAddress(view.studio);
  switch (resolved.state) {
    case "none":
      return rewrite ? { text: t(`${K}.status.asks`), bar: "local" } : { text: t(`${K}.status.off`), bar: "mute" };
    case "builtin":
      return { text: t(rewrite ? `${K}.status.local` : `${K}.status.continuityLocal`), bar: "local" };
    case "ollama":
      return { text: t(rewrite ? `${K}.status.ollama` : `${K}.status.continuityLocal`), bar: "local" };
    case "server":
      if (resolved.remote) {
        return {
          text: t(rewrite ? `${K}.status.serverRemote` : `${K}.status.continuityRemote`, { address }),
          bar: "network",
        };
      }
      return { text: t(rewrite ? `${K}.status.server` : `${K}.status.continuityLocal`), bar: "local" };
    case "cli":
      return { text: t(`${K}.status.cli`, { assistant: resolved.agent.name }), bar: "cli" };
    default:
      return { text: warning(slot, resolved), bar: "warn" };
  }
}

/** The sentence for a choice that cannot run as it stands. */
function warning(slot: TaskSlot, resolved: Resolved): string {
  const task = taskTitle(slot);
  switch (resolved.state) {
    case "tooLarge":
      return t(`${K}.summary.tooLarge`, { model: resolved.model.label, task });
    case "ollamaDown":
      return t(`${K}.summary.ollamaDown`, { model: resolved.tag, task });
    case "serverDown":
      return t(`${K}.summary.serverDown`, { model: resolved.model, task });
    case "cannotWrite":
      return t(`${K}.summary.cannotWrite`, { model: resolved.label, task });
    case "gone":
      return t(`${K}.summary.gone`, { model: resolved.label, task });
    default:
      return "";
  }
}

function sentence(slot: TaskSlot, resolved: Resolved, view: LocalAiView): Line {
  const rewrite = slot === "rewrite";
  const address = serverAddress(view.studio);
  switch (resolved.state) {
    case "none":
      return { text: t(rewrite ? `${K}.summary.rewriteAsks` : `${K}.summary.continuityNone`), warn: false };
    case "builtin":
      return {
        text: t(rewrite ? `${K}.summary.rewriteLocal` : `${K}.summary.continuityLocal`, { model: resolved.model.label }),
        warn: false,
      };
    case "ollama":
      return {
        text: t(rewrite ? `${K}.summary.rewriteOllama` : `${K}.summary.continuityOllama`, { model: resolved.tag }),
        warn: false,
      };
    case "server":
      return resolved.remote
        ? {
            text: t(rewrite ? `${K}.summary.rewriteRemote` : `${K}.summary.continuityRemote`, {
              model: resolved.model,
              address,
            }),
            warn: false,
          }
        : {
            text: t(rewrite ? `${K}.summary.rewriteServer` : `${K}.summary.continuityServer`, { model: resolved.model }),
            warn: false,
          };
    case "cli":
      return { text: t(`${K}.summary.rewriteCli`, { assistant: resolved.agent.name }), warn: false };
    default:
      return { text: warning(slot, resolved), warn: true };
  }
}

/** The size word, the size and the fit, beside a one-click button. */
export function candidateMeta(candidate: Candidate): string {
  if (candidate.kind === "builtin" && candidate.model) {
    return t(`${K}.summary.metaBuiltin`, {
      size: t(sizeWordKey(candidate.model.tier)),
      bytes: humanSize(candidate.model.sizeBytes),
    });
  }
  return t(candidate.kind === "ollama" ? `${K}.summary.metaOllama` : `${K}.summary.metaServer`);
}

/**
 * The summary at the top of Tasks: at most two sentences and one button.
 * With nothing ready to run either task, one sentence and "Get a model";
 * otherwise a sentence per task, then the first button that applies: one
 * click for both, one click for Continuity, or Check again when a task waits
 * on Ollama or the local server.
 */
export function taskSummary(view: LocalAiView, agents: readonly AgentInfo[]): TaskSummary {
  const rewrite = resolveTask("rewrite", view.slots.rewrite, view, agents);
  const continuity = resolveTask("continuity", view.slots.continuity, view, agents);
  const waiting = [rewrite, continuity].some((r) => r.state === "ollamaDown" || r.state === "serverDown");
  const anyModel =
    writingReady(view).length > 0 ||
    (view.ollama.running && view.ollama.models.length > 0) ||
    servedModels(view).length > 0;

  if (!anyModel && !waiting) {
    const assistant = foundAssistants(agents).length > 0;
    return {
      sentences: [{ text: t(assistant ? `${K}.summary.noLocalModel` : `${K}.summary.noModel`), warn: false }],
      button: { kind: "getModel" },
    };
  }

  const sentences = [sentence("rewrite", rewrite, view), sentence("continuity", continuity, view)];
  const candidate = oneClickCandidate(view);
  let button: SummaryButton | null = null;
  if (candidate && rewrite.state === "none" && continuity.state === "none") {
    button = { kind: "both", candidate, meta: candidateMeta(candidate) };
  } else if (candidate && continuity.state === "none") {
    button = { kind: "continuity", candidate, meta: candidateMeta(candidate) };
  } else if (waiting) {
    button = { kind: "checkAgain" };
  }
  return { sentences, button };
}

/** The tasks that use a model, by title, for "Used by {tasks}". */
export function tasksUsing(kind: SlotKind, id: string, view: LocalAiView): TaskSlot[] {
  return TASKS.filter((slot) => view.slots[slot].kind === kind && view.slots[slot].id === id);
}

/**
 * The name Continuity's runner gives its model: the catalogue label, the
 * Ollama tag, or the server's model and where it runs. Null when nothing
 * that can run Continuity is chosen.
 */
export function continuityModel(view: LocalAiView, agents: readonly AgentInfo[]): { label: string; remote: string | null } | null {
  const resolved = resolveTask("continuity", view.slots.continuity, view, agents);
  switch (resolved.state) {
    case "none":
      return null;
    case "builtin":
    case "tooLarge":
      return { label: resolved.model.label, remote: null };
    case "ollama":
    case "ollamaDown":
      return { label: resolved.tag, remote: null };
    case "server":
      return resolved.remote
        ? { label: resolved.model, remote: serverAddress(view.studio) }
        : { label: t("continuity.onServer", { model: resolved.model }), remote: null };
    case "serverDown":
      return { label: t("continuity.onServer", { model: resolved.model }), remote: null };
    case "cli":
      return null;
    default:
      return { label: resolved.label, remote: null };
  }
}
