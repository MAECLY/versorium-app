<script lang="ts">
  import AuthorSection from "$lib/settings/AuthorSection.svelte";
  import TypographySection from "$lib/settings/TypographySection.svelte";
</script>

<!-- Both sections answer the group's question — what the manuscript is, rather
     than what the app is. Focus mode and the typewriter line are writing
     settings too and are already persisted, but they are modes reachable as
     TopBar toggles with visible state, not preferences. -->
<TypographySection />
<AuthorSection />
