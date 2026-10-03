<script lang="ts">
  /**
   * What the first page of an export will look like.
   *
   * Drawn to the proportions of a page rather than as a list of fields,
   * because the question it answers is "how does my book look", and a form
   * cannot answer that. Everything is a token, so it follows the theme.
   */
  let {
    title,
    author = "",
    organization = "",
    rights = "",
    width = 180,
    dimmed = false,
    compact = false,
  }: {
    title: string;
    author?: string;
    organization?: string;
    rights?: string;
    width?: number;
    /** The writer has switched the title page off; shown, but visibly not in use. */
    dimmed?: boolean;
    /** Thumbnail: the shape of the page and the first letters, nothing else. */
    compact?: boolean;
  } = $props();

  // US Letter, which is what the PDF exporter lays out.
  let height = $derived(Math.round(width * (11 / 8.5)));
</script>

{#if compact}
  <!-- At this size nothing can be read, so nothing pretends to be: the shape of
       a page and the initial, which is enough to tell two novels apart. -->
  <span
    aria-hidden="true"
    class="flex flex-shrink-0 items-center justify-center"
    style="
      width: {width}px; height: {height}px;
      background: var(--bg-elev); color: var(--accent);
      border: 1px solid var(--border); border-radius: 2px;
      font-size: {Math.round(width * 0.5)}px; font-weight: 600; line-height: 1;
      opacity: {dimmed ? 0.45 : 1};
    "
  >
    {title.trim().charAt(0).toUpperCase()}
  </span>
{:else}
<div
  class="flex flex-col items-center"
  style="
    width: {width}px; height: {height}px;
    background: var(--bg-elev); color: var(--text);
    border: 1px solid var(--border); border-radius: var(--radius-control);
    padding: 12px 14px; overflow: hidden; text-align: center;
    justify-content: center; gap: 10px;
    opacity: {dimmed ? 0.4 : 1}; transition: opacity 150ms;
  "
>
  <div style="font-size: 13px; font-weight: 600; line-height: 1.3;">{title}</div>
  {#if author}
    <div style="font-size: 11px;">{author}</div>
  {/if}
  {#if organization}
    <div class="v-muted" style="font-size: 9.5px;">{organization}</div>
  {/if}
  {#if rights}
    <div class="v-muted" style="font-size: 9.5px;">{rights}</div>
  {/if}
</div>
{/if}
