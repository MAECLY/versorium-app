<script lang="ts">
  import { t } from "$lib/i18n";
  import RenameDialog from "$lib/binder/RenameDialog.svelte";
  import ConfirmDialog from "$lib/components/ConfirmDialog.svelte";
  import ProjectSettingsDialog from "$lib/binder/ProjectSettingsDialog.svelte";
  import { doDelete, doRename, pending } from "$lib/binder/itemActions.svelte";

  /**
   * The dialogs an item menu opens, whichever surface it was opened from.
   * Mounted once, in App: the corkboard's menu reaches the same Rename and
   * Delete as the binder's, and must not depend on the sidebar being mounted.
   */
</script>

{#if pending.renaming}
  <RenameDialog
    kind={pending.renaming.kind}
    current={pending.renaming.title}
    onClose={() => (pending.renaming = null)}
    onRename={doRename}
  />
{/if}

{#if pending.confirming}
  <ConfirmDialog
    title={t(`binder.confirm.${pending.confirming.kind}Title`, { title: pending.confirming.title })}
    body={t(`binder.confirm.${pending.confirming.kind}Body`)}
    confirmLabel={t(pending.confirming.kind === "project" ? "binder.menu.deleteProject" : "binder.menu.deleteChapter")}
    onCancel={() => (pending.confirming = null)}
    onConfirm={doDelete}
  />
{/if}

{#if pending.settingsFor}
  <ProjectSettingsDialog path={pending.settingsFor} onClose={() => (pending.settingsFor = null)} />
{/if}
