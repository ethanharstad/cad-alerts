<script setup lang="ts">
import brandmark from '@scene-ready/design-system/assets/scene-ready-brandmark.svg'
import brandmarkReversed from '@scene-ready/design-system/assets/scene-ready-brandmark-reversed.svg'
</script>

<template>
  <main class="page page-narrow">
    <div class="card about">
      <img class="mark mark-light" :src="brandmark" alt="Scene Ready" width="200" />
      <img class="mark mark-dark" :src="brandmarkReversed" alt="Scene Ready" width="200" />
      <h1>CAD Pre-Alerts</h1>
      <p>
        Speaks each CAD pre-alert in the station as soon as it arrives, so the crew can start
        moving before the pager tones out.
      </p>
      <p class="help-text">Part of Scene Ready — software for Fire, EMS, and Search &amp; Rescue.</p>
    </div>
  </main>
</template>

<style scoped>
.about > * + * {
  margin-top: var(--space-4);
}

.mark {
  display: block;
  height: auto;
}

.mark-dark,
[data-theme='dark'] .mark-light {
  display: none;
}

[data-theme='dark'] .mark-dark {
  display: block;
}
</style>
