import { describe, expect, it } from "vitest";
import catalog from "../../models/catalog.json";
import type { AgentInfo, LocalAiView, ModelCard, Slots, StudioView } from "$lib/tauri";
import {
  isLoopback,
  oneClickCandidate,
  recommendedModel,
  taskOptions,
  taskStatus,
  taskSummary,
  type TaskChoices,
} from "$lib/settings/ai/picks";

// What Settings → Tasks and Models decide (src/lib/settings/ai/picks.ts), on
// the catalogue that ships (models/catalog.json), not on made-up models.

/** The catalogue as Rust sends it to a machine with `ram` GB: `fits` is hardware::fits (20% headroom). */
function cards(ram: number, ready: string[] = []): ModelCard[] {
  return catalog.models.map((m) => ({
    id: m.id,
    family: m.family,
    label: m.label,
    task: m.task as ModelCard["task"],
    tier: m.tier as ModelCard["tier"],
    params: m.params,
    quant: m.quant,
    sizeBytes: m.sizeBytes,
    ramHintGB: m.ramHintGB,
    ctx: m.ctx,
    speed: m.speed as ModelCard["speed"],
    quality: m.quality as ModelCard["quality"],
    badge: m.badge ?? null,
    uncensored: m.uncensored,
    license: m.license,
    repo: m.repo,
    state: ready.includes(m.id) ? "ready" : "missing",
    receivedBytes: 0,
    fits: m.ramHintGB * 1.2 <= ram,
  }));
}

const none = () => ({ kind: "none" as const, id: "" });
const slots = (over: Partial<Slots> = {}): Slots => ({
  rewrite: none(),
  chat: none(),
  continuity: none(),
  embeddings: none(),
  dictation: none(),
  ...over,
});

const studio = (over: Partial<StudioView> = {}): StudioView => ({
  host: "127.0.0.1",
  port: 1234,
  enabled: false,
  running: false,
  models: [],
  ...over,
});

function view(over: Partial<LocalAiView> & { ram?: number; ready?: string[] } = {}): LocalAiView {
  const { ram = 16, ready = [], ...rest } = over;
  return {
    models: cards(ram, ready),
    hardware: {
      totalRamGb: ram, availableRamGb: ram / 2, cpuCores: 8, arch: "aarch64", os: "macos",
      gpu: "Metal (Apple M2)", recommendedTier: "mid",
    },
    slots: slots(),
    progress: null,
    ollama: { running: false, installed: false, models: [] },
    studio: studio(),
    censorship: false,
    diskUsedBytes: 0,
    modelsDir: "/data/models",
    ...rest,
  };
}

const agent = (id: string, name: string, state: AgentInfo["state"] = "connected"): AgentInfo => ({
  id, name, path: state === "missing" ? null : `/bin/${id}`, version: null, state, models: null,
});
const AGENTS = [
  agent("claude", "Claude Code"),
  agent("codex", "Codex"),
  agent("opencode", "OpenCode", "missing"),
  agent("gh", "GitHub CLI"),
];

const labels = (choices: TaskChoices) => [
  ...choices.options.map((o) => o.label),
  ...choices.groups.flatMap((g) => g.options.map((o) => o.label)),
];
const option = (choices: TaskChoices, value: string) =>
  [...choices.options, ...choices.groups.flatMap((g) => g.options)].find((o) => o.value === value);
const groupOf = (choices: TaskChoices, value: string) =>
  choices.groups.find((g) => g.options.some((o) => o.value === value))?.label;

describe("the one recommended download", () => {
  it("is the smallest Medium model that fits: Qwen3 4B Instruct 2507 on 8 GB", () => {
    expect(recommendedModel(cards(8))?.id).toBe("qwen3-4b-instruct-2507-q4km");
  });

  it("is the largest Small model when no Medium one fits", () => {
    // 4 GB: Medium needs 4.2 with the headroom, Small at most 2.4.
    expect(recommendedModel(cards(4))?.id).toBe("qwen35-2b-q4km");
  });

  it("is nothing when nothing fits", () => {
    expect(recommendedModel(cards(1))).toBeNull();
  });

  it("is never uncensored, and never more than one, whatever the machine", () => {
    for (const ram of [2, 4, 8, 16, 32, 64, 128]) {
      const pick = recommendedModel(cards(ram));
      if (pick) {
        expect(pick.uncensored, `${ram} GB`).toBe(false);
        expect(pick.task).toBe("writing");
      }
    }
    // The only Medium models are censored, so take them away and make the
    // uncensored ones the only big ones: the pick falls to Small, not to them.
    const noMid = cards(64).filter((m) => m.tier !== "mid");
    expect(recommendedModel(noMid)?.tier).toBe("low");
    // An uncensored Medium model smaller than every other is still passed over.
    const base = cards(16).find((m) => m.id === "qwen3-4b-instruct-2507-q4km")!;
    const spicy = { ...base, id: "spicy-mid", label: "Spicy Mid", sizeBytes: 1_000, uncensored: true };
    expect(recommendedModel([...cards(16), spicy])?.id).toBe("qwen3-4b-instruct-2507-q4km");
  });
});

describe("the one-click candidate", () => {
  it("is the largest ready model that fits and is not uncensored", () => {
    const v = view({
      ram: 32,
      ready: ["qwen35-08b-q4km", "gemma4-12b-it-q5km", "gemma4-12b-abliterated-q4k", "qwen38-27b-q4km"],
    });
    // Qwen3.8 27B needs 24 GB with the headroom, which 32 has; it is the largest.
    expect(oneClickCandidate(v)?.id).toBe("qwen38-27b-q4km");
    const smaller = view({ ram: 16, ready: ["qwen35-08b-q4km", "gemma4-12b-it-q5km", "qwen38-27b-q4km"] });
    // 27B does not fit 16 GB, so the 12B, which does.
    expect(oneClickCandidate(smaller)?.id).toBe("gemma4-12b-it-q5km");
  });

  it("takes an uncensored model only when nothing else is ready", () => {
    expect(oneClickCandidate(view({ ram: 32, ready: ["gemma4-12b-abliterated-q4k", "qwen35-08b-q4km"] }))?.id).toBe(
      "qwen35-08b-q4km",
    );
    expect(oneClickCandidate(view({ ram: 32, ready: ["gemma4-12b-abliterated-q4k"] }))?.id).toBe(
      "gemma4-12b-abliterated-q4k",
    );
  });

  it("is never the embedding model, and never an assistant", () => {
    const v = view({ ready: ["nomic-embed-text-v15-q4km"] });
    expect(oneClickCandidate(v)).toBeNull();
  });

  it("falls back to Ollama, then to a local server on this computer, never one elsewhere", () => {
    const ollama = view({ ollama: { running: true, installed: true, models: [{ name: "qwen3:4b", sizeBytes: 1, modified: "" }] } });
    expect(oneClickCandidate(ollama)).toMatchObject({ kind: "ollama", id: "qwen3:4b" });
    const local = view({ studio: studio({ enabled: true, running: true, models: ["local-model"] }) });
    expect(oneClickCandidate(local)).toMatchObject({ kind: "server", id: "local-model" });
    const remote = view({ studio: studio({ host: "192.168.1.20", enabled: true, running: true, models: ["big"] }) });
    expect(oneClickCandidate(remote)).toBeNull();
  });
});

describe("a task's choices", () => {
  const ready = ["qwen35-08b-q4km", "qwen3-4b-instruct-2507-q4km", "nomic-embed-text-v15-q4km"];

  it("never include the embedding model (C6), and list the largest first", () => {
    const choices = taskOptions("rewrite", none(), view({ ready }), AGENTS);
    expect(labels(choices)).not.toContain("Nomic Embed Text v1.5 — in Versorium");
    expect(labels(choices).filter((l) => l.endsWith("— in Versorium"))).toEqual([
      "Qwen3 4B Instruct 2507 — in Versorium",
      "Qwen3.5 0.8B — in Versorium",
    ]);
  });

  it("group by where the passage goes: assistants for Rewrite, offered", () => {
    const choices = taskOptions("rewrite", none(), view({ ready }), AGENTS);
    expect(choices.groups.map((g) => g.label)).toEqual(["On this computer", "Assistants, with your own account"]);
    const assistants = choices.groups[1].options;
    // Found ones only, and never the git tool.
    expect(assistants.map((o) => o.label)).toEqual(["Claude Code", "Codex"]);
    expect(assistants.every((o) => !o.disabled)).toBe(true);
  });

  it("show Continuity the assistants, disabled, with the reason in the group", () => {
    const choices = taskOptions("continuity", none(), view({ ready }), AGENTS);
    const group = choices.groups.find((g) => g.label === "Assistants: Continuity runs only on one of your models");
    expect(group?.options.every((o) => o.disabled)).toBe(true);
    expect(choices.options[0].label).toBe("No model: the check stays off");
  });

  it("keep a choice that is no longer there, shown and selected but not offered", () => {
    const gone = taskOptions("rewrite", { kind: "ollama", id: "llama3:8b" }, view({ ready, ollama: { running: true, installed: true, models: [] } }), AGENTS);
    expect(gone.value).toBe("ollama:llama3:8b");
    expect(option(gone, "ollama:llama3:8b")).toEqual({
      value: "ollama:llama3:8b",
      label: "llama3:8b — not on this computer any more",
      disabled: true,
    });
    expect(groupOf(gone, "ollama:llama3:8b")).toBe("No longer available");

    const down = taskOptions("rewrite", { kind: "ollama", id: "qwen3:4b" }, view({ ready }), AGENTS);
    expect(option(down, "ollama:qwen3:4b")?.label).toBe("qwen3:4b — Ollama isn't running");
  });

  it("keep a stored assistant on Continuity as the disabled option it was", () => {
    const legacy = taskOptions("continuity", { kind: "cli", id: "claude" }, view({ ready }), AGENTS);
    expect(legacy.value).toBe("cli:claude");
    expect(option(legacy, "cli:claude")?.disabled).toBe(true);
    expect(legacy.groups.some((g) => g.label === "No longer available")).toBe(false);
  });

  it("offer a saved server's models while it answers, under this computer when it is here", () => {
    const answering = view({ ready, studio: studio({ enabled: true, running: true, models: ["local-model"] }) });
    const choices = taskOptions("rewrite", none(), answering, AGENTS);
    expect(option(choices, "server:local-model")).toEqual({
      value: "server:local-model",
      label: "local-model — on the local server",
    });
    expect(groupOf(choices, "server:local-model")).toBe("On this computer");
  });

  it("put a server elsewhere in a group that says where", () => {
    const remote = view({ studio: studio({ host: "192.168.1.20", enabled: true, running: true, models: ["big"] }) });
    const choices = taskOptions("rewrite", none(), remote, AGENTS);
    expect(groupOf(choices, "server:big")).toBe("On the server at 192.168.1.20:1234");
    expect(option(choices, "server:big")?.label).toBe("big — on the server at 192.168.1.20:1234");
  });

  it("say a saved server is silent, and never offer one that is not saved", () => {
    const silent = taskOptions("rewrite", none(), view({ studio: studio({ enabled: true, running: false }) }), AGENTS);
    expect(option(silent, "server")).toEqual({ value: "server", label: "Local server — not answering", disabled: true });
    const unsaved = taskOptions("rewrite", none(), view({ studio: studio({ running: true, models: ["local-model"] }) }), AGENTS);
    expect(labels(unsaved).some((l) => l.includes("server"))).toBe(false);

    // A task on it while it is silent shows that choice, disabled and selected.
    const stored = taskOptions("continuity", { kind: "server", id: "local-model" }, view({ studio: studio({ enabled: true }) }), AGENTS);
    expect(stored.value).toBe("server:local-model");
    expect(option(stored, "server:local-model")).toEqual({
      value: "server:local-model",
      label: "local-model — the local server isn't answering",
      disabled: true,
    });
    expect(option(stored, "server")).toBeUndefined();
  });

  it("name a model kept from the old pickers that cannot write", () => {
    const embed = taskOptions("rewrite", { kind: "builtin", id: "nomic-embed-text-v15-q4km" }, view({ ready }), AGENTS);
    expect(option(embed, "builtin:nomic-embed-text-v15-q4km")?.label).toBe("Nomic Embed Text v1.5 — doesn't write");
  });
});

describe("where the passage goes", () => {
  const ready = ["qwen3-4b-instruct-2507-q4km"];

  it("says so under each choice, with the bar that matches", () => {
    const v = view({ ready, ollama: { running: true, installed: true, models: [{ name: "qwen3:4b", sizeBytes: 1, modified: "" }] } });
    expect(taskStatus("rewrite", none(), v, AGENTS)).toEqual({
      text: "Asks each time, starting with models on this computer.",
      bar: "local",
    });
    expect(taskStatus("continuity", none(), v, AGENTS)).toEqual({ text: "Off until it has a model.", bar: "mute" });
    expect(taskStatus("rewrite", { kind: "builtin", id: "qwen3-4b-instruct-2507-q4km" }, v, AGENTS)).toEqual({
      text: "Runs on this computer. The passage stays here.",
      bar: "local",
    });
    expect(taskStatus("rewrite", { kind: "ollama", id: "qwen3:4b" }, v, AGENTS).text).toBe(
      "Runs on this computer, in Ollama. The passage stays here.",
    );
    expect(taskStatus("rewrite", { kind: "cli", id: "claude" }, v, AGENTS)).toEqual({
      text: "The passage goes to Claude Code's service, under your account.",
      bar: "cli",
    });
    // Continuity never runs on an assistant: a stored one is no model at all.
    expect(taskStatus("continuity", { kind: "cli", id: "claude" }, v, AGENTS).bar).toBe("mute");
  });

  it("tells a server here from a server elsewhere", () => {
    const here = view({ studio: studio({ enabled: true, running: true, models: ["m"] }) });
    expect(taskStatus("rewrite", { kind: "server", id: "m" }, here, AGENTS)).toEqual({
      text: "Runs on the local server on this computer. The passage stays here.",
      bar: "local",
    });
    const there = view({ studio: studio({ host: "10.0.0.5", port: 8080, enabled: true, running: true, models: ["m"] }) });
    expect(taskStatus("rewrite", { kind: "server", id: "m" }, there, AGENTS)).toEqual({
      text: "The passage goes to the server at 10.0.0.5:8080.",
      bar: "network",
    });
  });

  it("warns, in the summary's words, when a choice cannot run", () => {
    const tooBig = view({ ram: 8, ready: ["qwen38-27b-q4km"] });
    expect(taskStatus("rewrite", { kind: "builtin", id: "qwen38-27b-q4km" }, tooBig, AGENTS)).toEqual({
      text: "Qwen3.8 27B needs more memory than this computer has, so Rewrite will refuse it.",
      bar: "warn",
    });
    const stopped = view({ ollama: { running: false, installed: true, models: [] } });
    expect(taskStatus("continuity", { kind: "ollama", id: "qwen3:4b" }, stopped, AGENTS)).toEqual({
      text: "Continuity uses qwen3:4b in Ollama, but Ollama isn't running.",
      bar: "warn",
    });
    const silent = view({ studio: studio({ enabled: true }) });
    expect(taskStatus("rewrite", { kind: "server", id: "m" }, silent, AGENTS).text).toBe(
      "Rewrite uses m on the local server, but it isn't answering.",
    );
    expect(taskStatus("rewrite", { kind: "builtin", id: "qwen3-4b-instruct-2507-q4km" }, view(), AGENTS).text).toBe(
      "Rewrite was set to Qwen3 4B Instruct 2507, which isn't on this computer any more.",
    );
  });
});

describe("the Tasks summary", () => {
  const sentences = (v: LocalAiView, agents = AGENTS) => taskSummary(v, agents).sentences.map((s) => s.text);

  it("with nothing ready anywhere, says so and leads to Models", () => {
    const empty = taskSummary(view(), [agent("claude", "Claude Code", "missing")]);
    expect(empty.sentences.map((s) => s.text)).toEqual(["No model is ready yet, so Rewrite and Continuity can't run."]);
    expect(empty.button).toEqual({ kind: "getModel" });
    // An assistant can still do Rewrite meanwhile.
    expect(sentences(view())).toEqual([
      "No model on this computer is ready yet. Rewrite can use an assistant meanwhile; Continuity can't.",
    ]);
  });

  it("offers one click for both while neither task has a model", () => {
    const summary = taskSummary(view({ ready: ["qwen35-08b-q4km"] }), AGENTS);
    expect(summary.sentences.map((s) => s.text)).toEqual([
      "Rewrite asks each time, starting with models on this computer.",
      "Continuity has no model yet.",
    ]);
    expect(summary.button).toMatchObject({ kind: "both", candidate: { id: "qwen35-08b-q4km" } });
    expect(summary.button && "meta" in summary.button ? summary.button.meta : "").toBe("Small · 553 MB · fits this computer");
  });

  it("offers one click for Continuity once Rewrite has an assistant", () => {
    const v = view({ ready: ["qwen35-08b-q4km"], slots: slots({ rewrite: { kind: "cli", id: "claude" } }) });
    const summary = taskSummary(v, AGENTS);
    expect(summary.sentences[0].text).toBe(
      "Rewrite hands the passage to Claude Code, which sends it to its own service under your account.",
    );
    expect(summary.button).toMatchObject({ kind: "continuity" });
  });

  it("says where each task runs, and offers nothing once both have one", () => {
    const v = view({
      ready: ["qwen35-08b-q4km"],
      ollama: { running: true, installed: true, models: [{ name: "qwen3:4b", sizeBytes: 1, modified: "" }] },
      slots: slots({ rewrite: { kind: "builtin", id: "qwen35-08b-q4km" }, continuity: { kind: "ollama", id: "qwen3:4b" } }),
    });
    expect(sentences(v)).toEqual([
      "Rewrite runs on this computer, with Qwen3.5 0.8B.",
      "Continuity runs on this computer, with qwen3:4b in Ollama.",
    ]);
    expect(taskSummary(v, AGENTS).button).toBeNull();
  });

  it("asks to check again when a task waits on Ollama or the server", () => {
    const v = view({
      ollama: { running: false, installed: true, models: [] },
      slots: slots({ rewrite: { kind: "ollama", id: "qwen3:4b" } }),
    });
    const summary = taskSummary(v, AGENTS);
    expect(summary.sentences[0]).toEqual({ text: "Rewrite uses qwen3:4b in Ollama, but Ollama isn't running.", warn: true });
    expect(summary.button).toEqual({ kind: "checkAgain" });
  });

  it("names a server elsewhere in the sentence", () => {
    const v = view({
      studio: studio({ host: "10.0.0.5", enabled: true, running: true, models: ["big"] }),
      slots: slots({ rewrite: { kind: "server", id: "big" }, continuity: { kind: "server", id: "big" } }),
    });
    expect(sentences(v)).toEqual([
      "Rewrite sends the passage to big, on the server at 10.0.0.5:1234.",
      "Continuity runs on big, on the server at 10.0.0.5:1234.",
    ]);
  });
});

it("knows a server on this computer from one elsewhere", () => {
  for (const host of ["127.0.0.1", "127.1.2.3", "localhost", "LOCALHOST", "::1", "[::1]", " 127.0.0.1 "]) {
    expect(isLoopback(host), host).toBe(true);
  }
  for (const host of ["192.168.1.20", "10.0.0.5", "studio.lan", "128.0.0.1", "127.0.0.256", "0.0.0.0", ""]) {
    expect(isLoopback(host), host).toBe(false);
  }
});
