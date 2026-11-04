<script setup lang="ts">
import { ref, watchEffect, onMounted, onUnmounted } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { fetchAlertAudio } from '@/api/client'
import { applyOutputDevice } from '@/audio/outputDevice'
import { onPagerPreempt } from '@/audio/pagerPreempt'
import type { Alert } from '../../shared/types'

interface Props {
  alert: Alert
}

const props = defineProps<Props>()
const settingsStore = useSettingsStore()

const formatTimestamp = (timestamp: number): string => {
  const date = new Date(timestamp)
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// The audio endpoint is authenticated, so we fetch the bytes (with the Bearer
// header) and expose them as an object URL rather than pointing <audio> at the
// endpoint directly.
const audioUrl = ref<string | null>(null)

onMounted(async () => {
  if (!props.alert.audio_url) return
  try {
    audioUrl.value = await fetchAlertAudio(
      settingsStore.organizationKey,
      props.alert.alert_id,
      settingsStore.organizationSecret,
    )
  } catch (err) {
    console.error('Failed to load alert audio:', err)
  }
})

// Manual replays go to the same output as announced alerts.
const audioEl = ref<HTMLAudioElement | null>(null)
watchEffect(() => {
  if (audioEl.value) void applyOutputDevice(audioEl.value, settingsStore.audioOutputDeviceId)
})

// A manual replay is cut off by the pager tones just like an announced alert.
const stopListening = onPagerPreempt(() => audioEl.value?.pause())

onUnmounted(() => {
  stopListening()
  if (audioUrl.value) {
    URL.revokeObjectURL(audioUrl.value)
  }
})
</script>

<template>
  <article class="card alert-card">
    <header class="alert-header">
      <h3 class="alert-nature">{{ alert.nature }}</h3>
      <time class="alert-timestamp" :datetime="new Date(alert.timestamp).toISOString()">
        {{ formatTimestamp(alert.timestamp) }}
      </time>
    </header>
    <div class="alert-body">
      <p class="alert-address">{{ alert.address }}</p>
      <p class="alert-city">{{ alert.city }}</p>
    </div>
    <div v-if="audioUrl" class="alert-audio">
      <audio ref="audioEl" controls :src="audioUrl">
        This browser can't play the alert audio.
      </audio>
    </div>
  </article>
</template>

<style scoped>
.alert-card {
  padding: 0;
  overflow: hidden;
}

/* Card header: the call nature, readable from across the bay. */
.alert-header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2) var(--space-4);
  padding: var(--space-4) var(--space-6);
  border-bottom: 1px solid var(--border);
}

.alert-nature {
  font-size: var(--text-xl);
  white-space: pre-wrap;
}

.alert-timestamp {
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  white-space: nowrap;
}

.alert-body {
  padding: var(--space-4) var(--space-6);
  white-space: pre-wrap;
}

.alert-address {
  font-size: var(--text-lg);
  font-weight: 600;
}

.alert-city {
  color: var(--text-secondary);
}

.alert-audio {
  padding: 0 var(--space-6) var(--space-4);
}

.alert-audio audio {
  display: block;
  width: 100%;
  max-width: 400px;
}
</style>
