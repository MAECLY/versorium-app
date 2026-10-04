<script lang="ts">
  import { untrack } from "svelte";
  import { t } from "$lib/i18n";
  import type { LocalAiView } from "$lib/tauri";
  import { models } from "$lib/models/state.svelte";
  import { notices } from "$lib/notices/state.svelte";
  import { isLoopback, serverAddress, taskNames, TASKS } from "$lib/settings/ai/picks";
  import TextField from "$lib/components/forms/TextField.svelte";
  import NumberField from "$lib/components/forms/NumberField.svelte";
  import ExpanderRow from "$lib/settings/ExpanderRow.svelte";

  /**
   * LM Studio, llama-server or any app that serves the OpenAI API at an
   * address. Saved, it is asked what it serves, and its models can do Rewrite
   * and Continuity; forgotten, the tasks that ran on it are released. Nothing
   * reaches the address before Save.
   */
  let {
    view,
    open = $bindable(false),
    inUse,
  }: {
    view: LocalAiView;
    open?: boolean;
    /** A task runs on the server, which turns silence into a warning. */
    inUse: boolean;
  } = $props();

  let studio = $derived(view.studio);
  // Seeded once from what is saved; the writer's typing is theirs after that.
  let host = $state(untrack(() => view.studio.host));
  let port = $state(untrack(() => view.studio.port));

  let status = $derived(
    !studio.enabled
      ? t("settings.models.server.notSet")
      : studio.running
        ? studio.models.length === 1
          ? t("settings.models.server.answering.one")
          : t("settings.models.server.answering.other", { count: studio.models.length })
        : t("settings.models.server.notAnswering"),
  );
  let tone = $derived<"ok" | "warn" | "mute">(
    !studio.enabled ? "mute" : studio.running ? "ok" : inUse ? "warn" : "mute",
  );

  /**
   * Save what is typed. Saved at another computer's address, the server
   * keeps no task that ran on it here (Rust releases them), and the writer is
   * told which, and why.
   */
  async function save(): Promise<void> {
    const before = models.view;
    const onServer = before ? TASKS.filter((slot) => before.slots[slot].kind === "server") : [];
    await models.saveStudio(host.trim(), port, true);
    const after = models.view;
    if (models.error || !after) return;
    const released = onServer.filter((slot) => after.slots[slot].kind !== "server");
    if (released.length === 0) return;
    const address = serverAddress(after.studio);
    notices.inform(
      released.length === 1
        ? t("settings.models.server.released.one", { task: taskNames(released), address })
        : t("settings.models.server.released.other", { tasks: taskNames(released), address }),
      "settings.models.server",
    );
  }
</script>

<ExpanderRow id="models-server" focusKey="models:server" title={t("settings.models.server.name")} {status} {tone} bind:open>
  <p class="v-muted m-0 mb-2" style="font-size: 12.5px; line-height: 1.6;">{t("settings.models.server.about")}</p>
  {#if studio.enabled && !isLoopback(studio.host)}
    <p class="m-0 mb-2" style="font-size: 12.5px; line-height: 1.6; color: var(--warn);">
      {t("settings.models.server.elsewhere")}
    </p>
  {/if}
  <div class="v-row" style="gap: 10px; align-items: flex-end; flex-wrap: wrap;">
    <TextField label={t("settings.models.server.host")} value={host} trim onInput={(next) => (host = next)} />
    <!-- NumberField, not a bound number input: Svelte binds an emptied
         number box as null, and studio_test/studio_save take a u16. -->
    <NumberField
      label={t("settings.models.server.port")}
      value={port}
      min={1}
      max={65535}
      chars={5}
      onCommit={(next) => (port = next)}
    />
    <button class="v-btn" disabled={models.loading || !host.trim()} onclick={() => void models.testStudio(host.trim(), port)}>
      {t("settings.models.server.test")}
    </button>
  </div>
  <p
    class="m-0 mt-2"
    aria-live="polite"
    style="font-size: 12.5px; color: {models.studioReachable ? 'var(--ok)' : 'var(--warn)'};"
  >
    {models.studioReachable === null
      ? ""
      : models.studioReachable
        ? t("settings.models.server.reachable")
        : t("settings.models.server.unreachable")}
  </p>
  <div class="v-row mt-2" style="gap: 8px;">
    <button class="v-btn" disabled={models.loading || !host.trim()} onclick={() => void save()}>
      {t("settings.models.server.save")}
    </button>
    {#if studio.enabled}
      <!-- What is saved, not what is typed: an address never tried is not
           written to settings by forgetting another one. -->
      <button class="v-btn" disabled={models.loading} onclick={() => void models.saveStudio(studio.host, studio.port, false)}>
        {t("settings.models.server.forget")}
      </button>
    {/if}
  </div>
</ExpanderRow>
