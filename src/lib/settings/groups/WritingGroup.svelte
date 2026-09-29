<script lang="ts">
  import TypographySection from "$lib/settings/TypographySection.svelte";
</script>

<!-- Only typography. Focus mode and the typewriter line are writing settings
     too and are already persisted, but they are modes reachable as TopBar
     toggles with visible state, not preferences. -->
<TypographySection />
