<script lang="ts">
  import { t } from "$lib/i18n";
  import AppearanceGroup from "$lib/settings/groups/AppearanceGroup.svelte";
  import AppGroup from "$lib/settings/groups/AppGroup.svelte";
  import AssistantsGroup from "$lib/settings/groups/AssistantsGroup.svelte";
  import AuthorGroup from "$lib/settings/groups/AuthorGroup.svelte";
  import BackupGroup from "$lib/settings/groups/BackupGroup.svelte";
  import EditorGroup from "$lib/settings/groups/EditorGroup.svelte";
  import LocalAiGroup from "$lib/settings/groups/LocalAiGroup.svelte";

  let { onClose }: { onClose: () => void } = $props();

  /**
   * Groups are ordered by how often a writer touches them, not by the milestone
   * that built them. Every group answers one question, which is what the nav
   * label and the line under the heading are for: a setting nobody can place is
   * a setting nobody trusts.
   */
  const GROUPS = ["editor", "author", "appearance", "localAi", "backup", "assistants", "app"] as const;
  type Group = (typeof GROUPS)[number];

  let active = $state<Group>("editor");
  let buttons: HTMLButtonElement[] = [];

  /** Up/down move through the rail, as a vertical list of tabs should. */
  function onNavKey(event: KeyboardEvent, index: number): void {
    const delta = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (index + delta + GROUPS.length) % GROUPS.length;
    active = GROUPS[next];
    buttons[next]?.focus();
  }
</script>

<div class="flex min-h-0 flex-1" role="region" aria-label={t("settings.title")}>
  <!-- The rail: one entry per group, current one marked for screen readers too. -->
  <nav
    class="v-chrome flex flex-shrink-0 flex-col gap-1 overflow-y-auto p-3"
    style="width: 210px; border-right: 1px solid var(--border);"
    aria-label={t("settings.nav")}
  >
    <h2 class="v-section-title m-0 mb-2" style="padding: 0 6px;">{t("settings.title")}</h2>

    {#each GROUPS as group, i (group)}
      <button
        bind:this={buttons[i]}
        class="v-btn"
        aria-current={active === group ? "page" : undefined}
        tabindex={active === group ? 0 : -1}
        style="justify-content: flex-start; text-align: left; padding: 6px 10px; font-size: 13px; border: 0; {active ===
        group
          ? 'background: var(--accent); color: var(--accent-contrast);'
          : 'background: transparent;'}"
        onclick={() => (active = group)}
        onkeydown={(e) => onNavKey(e, i)}
      >
        {t(`settings.groups.${group}`)}
      </button>
    {/each}

    <button
      class="v-btn mt-3"
      style="justify-content: flex-start; padding: 6px 10px; font-size: 12.5px;"
      onclick={onClose}
    >
      {t("settings.backToWriting")}
    </button>
  </nav>

  <div class="min-h-0 flex-1 overflow-y-auto" style="background: var(--bg-editor);">
    <div style="max-width: 760px; padding: 24px 28px;">
      <header class="mb-5">
        <h2 class="m-0" style="font-size: 18px; font-weight: 600;">
          {t(`settings.groups.${active}`)}
        </h2>
        <!-- Why this group exists, in one line. Point of the redesign: a writer
             should never have to guess what a setting belongs to. -->
        <p class="v-muted m-0 mt-1" style="font-size: 12.5px; line-height: 1.6;">
          {t(`settings.purpose.${active}`)}
        </p>
      </header>

      {#if active === "editor"}
        <EditorGroup />
      {:else if active === "author"}
        <AuthorGroup />
      {:else if active === "appearance"}
        <AppearanceGroup />
      {:else if active === "localAi"}
        <LocalAiGroup />
      {:else if active === "backup"}
        <BackupGroup />
      {:else if active === "assistants"}
        <AssistantsGroup />
      {:else}
        <AppGroup />
      {/if}
    </div>
  </div>
</div>
