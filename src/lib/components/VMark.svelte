<script lang="ts">
  /**
   * The app's mark: the letter it is named for, written.
   *
   * One component rather than the same SVG pasted into every surface, because
   * that is how the old compass ended up in three places and got corrected in
   * one. The paths are generated from the same geometry as the app icon
   * (tests/icons/generate.py), so the mark in the window and the mark in the
   * Dock cannot drift apart.
   *
   * `detail` follows the icon's own rule: below about 40px the nib is a few
   * grey pixels and only muddies the letter, so the letter goes alone.
   */
  let {
    size = 20,
    detail = size >= 40 ? "nib" : "letter",
    title,
  }: {
    size?: number;
    detail?: "nib" | "letter";
    /** Given only where the mark is the sole label; decorative otherwise. */
    title?: string;
  } = $props();

  // A shade pulled downward and a hairline pushed back up: the pressure of a
  // pointed nib is what makes the letter read as written rather than typed.
  const SHADE =
    "M23.6 21.0L25.2 26.0L26.8 31.0L28.4 36.0L30.1 41.1L31.9 46.2L33.7 51.3L35.5 56.5L38.3 61.3L41.1 66.1L44.0 71.0L46.9 75.9L49.9 80.8L51.7 80.0L49.9 74.5L48.2 69.1L46.5 63.8L44.8 58.4L43.2 53.2L40.7 48.3L38.3 43.5L35.9 38.7L33.6 33.9L31.3 29.2L29.0 24.5L26.8 19.8Z";
  const HAIR_FULL =
    "M52.5 81.4L55.4 76.4L58.1 71.3L60.8 66.2L63.5 61.1L66.0 55.9L68.5 50.7L71.0 45.4L73.4 40.1L75.7 34.7L77.9 29.3L80.1 23.9L82.2 18.4L80.2 17.6L78.0 23.0L75.7 28.4L73.3 33.7L70.9 38.9L68.4 44.2L65.9 49.3L63.2 54.5L60.5 59.5L57.8 64.6L54.9 69.6L52.0 74.5L49.1 79.4Z";
  // Stopped short, so the nib caps the stroke instead of being threaded onto it.
  const HAIR_CUT =
    "M52.5 81.4L54.7 77.7L56.8 73.9L58.8 70.1L60.8 66.2L62.8 62.4L64.8 58.5L66.7 54.6L68.5 50.7L70.4 46.7L72.2 42.7L74.0 38.7L74.5 37.4L72.1 36.3L71.5 37.6L69.7 41.6L67.8 45.5L65.9 49.3L63.9 53.2L61.9 57.0L59.8 60.8L57.8 64.6L55.6 68.3L53.5 72.0L51.3 75.7L49.1 79.4Z";
  const NIB = "M72.0 40.1L79.5 33.5L82.4 23.3L76.6 20.9L71.4 30.2Z";
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 100 100"
  role={title ? "img" : "presentation"}
  aria-hidden={title ? undefined : "true"}
  aria-label={title}
>
  {#if title}<title>{title}</title>{/if}
  <path d={SHADE} fill="var(--accent)" />
  <path d={detail === "nib" ? HAIR_CUT : HAIR_FULL} fill="var(--accent)" opacity="0.78" />
  {#if detail === "nib"}
    <path d={NIB} fill="var(--accent)" />
    <!-- The slit and the breather hole cut back to the page: without them the
         nib is an arrowhead. -->
    <path d="M73.5 36.6L77.2 27.7" stroke="var(--bg-app)" stroke-width="2.4" stroke-linecap="round" />
    <circle cx="77.2" cy="27.7" r="1.7" fill="var(--bg-app)" />
  {/if}
</svg>
