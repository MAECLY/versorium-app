<script lang="ts">
  import { keepFocusOnPress } from "$lib/components/restoreFocus";

  /**
   * What a folded surface leaves behind: one ordinary, labelled button.
   *
   * The rail stands where the projects-and-chapters panel was, 28px wide,
   * its words written bottom to top. The lip runs along the top of the window,
   * 24px tall (WCAG 2.5.8), where the top bar was. Outside Focus they are
   * always visible. In Focus they sleep while the writer types and wake when
   * the pointer moves (styles.css, "edges"), and while asleep they take no
   * click, so nothing invisible can be hit.
   *
   * The accessible name contains the visible words (WCAG 2.5.3): "Projects
   * and chapters" reads as "Show projects and chapters". A press leaves focus
   * where it was, so clicking the rail while writing keeps the caret.
   */
  let {
    kind,
    text,
    name,
    expanded,
    controls,
    keys,
    title,
    onclick,
  }: {
    kind: "rail" | "lip";
    /** What is written on it. */
    text: string;
    /** Its accessible name; contains `text`. */
    name: string;
    /** True while the surface it stands for floats open over the page. */
    expanded: boolean;
    controls: string;
    /** aria-keyshortcuts. */
    keys: string;
    title: string;
    onclick: () => void;
  } = $props();
</script>

<button
  class="v-edge v-edge-{kind}"
  aria-label={name}
  aria-expanded={expanded}
  aria-controls={controls}
  aria-keyshortcuts={keys}
  {title}
  onmousedown={keepFocusOnPress}
  {onclick}
>
  <span class="v-edge-label">{text}</span>
</button>
