<script lang="ts">
  import { t } from "$lib/i18n";
  import Menu, { type MenuItem } from "$lib/components/Menu.svelte";
  import { chordAria, chordLabel, platformOf } from "$lib/chrome/keys";
  import type { Surface } from "$lib/chrome/chrome";

  /**
   * Focus, and what it hides: [Focus|⋯].
   *
   * The left half is the mode toggle, in the status bar with Corkboard and
   * Typewriter because modes live there. The right half opens Focus options,
   * two checkbox items saying which surfaces Focus folds away. Two real
   * buttons joined by one shared border, so each keeps its own name, its own
   * focus ring and its own job; only the toggle ever shows the pressed fill.
   */
  let {
    focus,
    disabled,
    recipe,
    onToggle,
    onRecipe,
    onMenuChange,
  }: {
    focus: boolean;
    /** No chapter to clear the page for. */
    disabled: boolean;
    recipe: Record<Surface, boolean>;
    onToggle: () => void;
    onRecipe: (surface: Surface, hides: boolean) => void;
    onMenuChange: (open: boolean) => void;
  } = $props();

  const platform = platformOf();

  let items = $derived<MenuItem[]>([
    { id: "binder", label: t("chrome.binderItem"), kind: "checkbox", checked: recipe.binder },
    { id: "topBar", label: t("chrome.topBarItem"), kind: "checkbox", checked: recipe.topBar },
  ]);

  let title = $derived(
    disabled
      ? t("editor.focusNeedsChapter")
      : t("editor.focusHint", { keys: chordLabel("toggleFocus", platform) }),
  );

  /**
   * The line under the items. With nothing ticked, Focus still shows pressed
   * but hides nothing and only quiets the status bar; with Focus off, nothing
   * moves until it is on.
   */
  let note = $derived(
    !recipe.binder && !recipe.topBar
      ? t("editor.focusNothingNote")
      : focus
        ? undefined
        : t("editor.focusOffNote"),
  );
</script>

<div class="v-split">
  <button
    class="v-btn v-bar-btn v-split-start"
    aria-pressed={focus}
    aria-keyshortcuts={chordAria("toggleFocus", platform)}
    {title}
    {disabled}
    onclick={onToggle}
  >
    {t("editor.focus")}
  </button>
  <Menu
    {items}
    label={t("editor.focusOptions")}
    triggerClass="v-btn v-bar-btn v-split-end"
    triggerTitle={t("editor.focusOptions")}
    menuId="focus-options-menu"
    placement="above-end"
    heading={t("editor.focusHeading")}
    {note}
    onToggle={(id, next) => onRecipe(id as Surface, next)}
    onOpenChange={onMenuChange}
  />
</div>
