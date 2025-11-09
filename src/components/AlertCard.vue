<script setup lang="ts">
import { computed } from 'vue'
import { useSettingsStore } from '@/stores/settings'

interface Alert {
  alert_id: string
  organization: string
  body: string
  audio_url: string
  timestamp: number
  source: string
}

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

const audioUrl = computed(() => {
  if (!props.alert.audio_url) return null
  return `/api/org/${settingsStore.organizationKey}/alerts/${props.alert.alert_id}/audio`
})
</script>

<template>
  <div class="alert-card">
    <div class="alert-header">
      <span class="alert-timestamp">{{ formatTimestamp(alert.timestamp) }}</span>
    </div>
    <div class="alert-body">
      {{ alert.source }}
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
