<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { fetchAlertAudio } from '@/api/client'
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

onUnmounted(() => {
  if (audioUrl.value) {
    URL.revokeObjectURL(audioUrl.value)
  }
})
</script>

<template>
  <div class="alert-card">
    <div class="alert-header">
      <span class="alert-timestamp">{{ formatTimestamp(alert.timestamp) }}</span>
    </div>
    <div class="alert-body">
      <p>{{ alert.nature }}</p>
      <p>{{ alert.address }}</p>
      <p>{{  alert.city }}</p>
    </div>
    <div v-if="audioUrl" class="alert-audio">
      <audio controls :src="audioUrl">
        Your browser does not support the audio element.
      </audio>
    </div>
  </div>
</template>

<style scoped>
.alert-card {
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 1.5rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  transition: box-shadow 0.3s ease;
}

.alert-card:hover {
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}

.alert-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--color-border);
}

.alert-timestamp {
  font-size: 0.875rem;
  color: var(--color-text-muted, #666);
  font-weight: 600;
}

.alert-body {
  font-size: 1rem;
  line-height: 1.6;
  color: var(--color-text);
  margin-bottom: 1rem;
  white-space: pre-wrap;
}

.alert-audio {
  margin-top: 1rem;
}

.alert-audio audio {
  width: 100%;
  max-width: 400px;
}
</style>
