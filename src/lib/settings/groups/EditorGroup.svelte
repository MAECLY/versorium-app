<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "$lib/i18n";
  import TypographySection from "$lib/settings/TypographySection.svelte";
  import Checkbox from "$lib/components/forms/Checkbox.svelte";
  import Select from "$lib/components/forms/Select.svelte";
  import { editorPreferences } from "$lib/editor/state.svelte";
  import {
    LINE_SPACINGS,
    TAB_KEYS,
    TEXT_SIZES,
    TEXT_WIDTHS,
    spellingUnderlines,
    type EditorPreferences,
  } from "$lib/editor/preferences";

  // App adopted these at launch; reading them again here means the panel shows
  // what settings.json holds now, not what it held when the window opened.
  onMount(() => void editorPreferences.load());

  // No `busy` on these controls: a save is one local write, and disabling a
  // focused control blurs it, so a keyboard user stepping through a Select
  // with the arrow keys would be thrown out of it on every step.
  let current = $derived(editorPreferences.current);

  // The box stays usable on Linux: the choice is kept, and takes effect the
  // day Rust switches WebKitGTK's checker on. Only the promise changes.
  const spellingHint = spellingUnderlines(navigator.platform)
    ? "editorSettings.spelling.hint"
    : "editorSettings.spelling.hintLinux";

  /**
   * A Select keeps the option the writer picked even when the save fails,
   * because its value is only written back when the parent's value changes —
   * and a refused save leaves it unchanged. Remounting on a failure puts the
   * control back on what the page is actually doing.
   */
  let failures = $state(0);
  async function choose<K extends keyof EditorPreferences>(key: K, value: EditorPreferences[K]): Promise<void> {
    await editorPreferences.set(key, value);
    if (editorPreferences.error) failures += 1;
  }
</script>

<!-- Focus and Typewriter are not here: they are modes, switched in the status
     bar with their state on the button, not preferences. -->
<TypographySection />

<section class="mb-6" aria-label={t("editorSettings.spelling.title")}>
  <h3 class="v-h3 mb-2">{t("editorSettings.spelling.title")}</h3>
  <Checkbox
    label={t("editorSettings.spelling.label")}
    hint={t(spellingHint)}
    checked={current.spellcheck}
    onChange={(next) => void choose("spellcheck", next)}
  />
</section>

{#key failures}
  <section class="mb-6" aria-label={t("editorSettings.text.title")}>
    <h3 class="v-h3 mb-2">{t("editorSettings.text.title")}</h3>
    <div class="v-row" style="gap: 16px; flex-wrap: wrap; align-items: flex-start;">
      <Select
        label={t("editorSettings.text.size")}
        value={current.textSize}
        minWidth="150px"
        options={TEXT_SIZES.map((value) => ({ value, label: t(`editorSettings.text.sizes.${value}`) }))}
        onChange={(next) => void choose("textSize", next)}
      />
      <Select
        label={t("editorSettings.text.spacing")}
        value={current.lineSpacing}
        minWidth="150px"
        options={LINE_SPACINGS.map((value) => ({ value, label: t(`editorSettings.text.spacings.${value}`) }))}
        onChange={(next) => void choose("lineSpacing", next)}
      />
      <Select
        label={t("editorSettings.text.width")}
        value={current.textWidth}
        minWidth="150px"
        options={TEXT_WIDTHS.map((value) => ({ value, label: t(`editorSettings.text.widths.${value}`) }))}
        onChange={(next) => void choose("textWidth", next)}
      />
    </div>
  </section>
{/key}

<section class="mb-6" aria-label={t("editorSettings.guides.title")}>
  <h3 class="v-h3 mb-2">{t("editorSettings.guides.title")}</h3>
  <div class="flex flex-col gap-3">
    <Checkbox
      label={t("editorSettings.guides.lineNumbers")}
      hint={t("editorSettings.guides.lineNumbersHint")}
      checked={current.lineNumbers}
      onChange={(next) => void choose("lineNumbers", next)}
    />
    <Checkbox
      label={t("editorSettings.guides.activeLine")}
      hint={t("editorSettings.guides.activeLineHint")}
      checked={current.activeLine}
      onChange={(next) => void choose("activeLine", next)}
    />
  </div>
</section>

{#key failures}
  <section class="mb-6" aria-label={t("editorSettings.keyboard.title")}>
    <h3 class="v-h3 mb-2">{t("editorSettings.keyboard.title")}</h3>
    <!-- Capped, not as wide as the panel: a select stretched across 760px
         reads as a text field. -->
    <div style="max-width: 460px;">
      <Select
        label={t("editorSettings.keyboard.tab")}
        hint={t("editorSettings.keyboard.tabHint")}
        value={current.tabKey}
        options={TAB_KEYS.map((value) => ({ value, label: t(`editorSettings.keyboard.tabs.${value}`) }))}
        onChange={(next) => void choose("tabKey", next)}
      />
    </div>
  </section>
{/key}

{#if editorPreferences.error}
  <p role="alert" class="m-0" style="font-size: 12px; color: var(--warn);">{editorPreferences.error}</p>
{/if}
