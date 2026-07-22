<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import AlertCard from '@/components/AlertCard.vue'
import {
  getOrganization,
  getAlerts,
  fetchAlertAudio,
  streamAlerts,
  ApiError,
  type AlertStreamHandle,
  type StreamStatus,
} from '@/api/client'
import type { Alert, PublicOrganization } from '../../shared/types'

const MAX_ALERTS = 5

const settingsStore = useSettingsStore()
const organization = ref<PublicOrganization | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

const alerts = ref<Alert[]>([])
const alertsError = ref<string | null>(null)
const previousAlertIds = ref<Set<string>>(new Set())
// Gate auto-play until the initial list has loaded, so opening the dashboard
// never replays the current alerts as audio.
const initialized = ref(false)

const streamStatus = ref<StreamStatus>('reconnecting')
const isPaused = ref(false)
let streamHandle: AlertStreamHandle | null = null

const fetchOrganization = async () => {
  loading.value = true
  error.value = null

  try {
    organization.value = await getOrganization(
      settingsStore.organizationKey,
      settingsStore.organizationSecret,
    )

    // Fetch alerts after successfully fetching organization
    await fetchAlerts()
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 404) {
        error.value = 'Organization not found'
      } else if (err.status === 401) {
        error.value = 'Authentication failed — check your Organization Secret'
      } else {
        error.value = 'Failed to fetch organization'
      }
    } else {
      error.value = err instanceof Error ? err.message : 'An error occurred'
    }
  } finally {
    loading.value = false
  }
}

const fetchAlerts = async () => {
  alertsError.value = null

  try {
    const newAlerts: Alert[] = await getAlerts(
      settingsStore.organizationKey,
      settingsStore.organizationSecret,
    )

    // Replace the current list. This is the initial load and the manual-refresh
    // path; live updates arrive over the stream (see onStreamAlert), which owns
    // auto-play. No auto-play here, so a refresh never re-speaks existing alerts.
    alerts.value = newAlerts
    previousAlertIds.value = new Set(newAlerts.map(alert => alert.alert_id))
  } catch (err) {
    if (err instanceof ApiError) {
      alertsError.value =
        err.status === 401
          ? 'Authentication failed — check your Organization Secret'
          : 'Failed to fetch alerts'
    } else {
      alertsError.value = err instanceof Error ? err.message : 'An error occurred'
    }
  }
}

/**
 * Merge one streamed alert into the list: dedup by id (the stream can replay a
 * boundary alert on reconnect), keep newest-first, cap the list, and auto-play
 * genuinely-new alerts once the initial load is done.
 */
const onStreamAlert = (alert: Alert) => {
  const isNew = !previousAlertIds.value.has(alert.alert_id)

  alerts.value = [alert, ...alerts.value.filter(a => a.alert_id !== alert.alert_id)]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_ALERTS)
  previousAlertIds.value = new Set(alerts.value.map(a => a.alert_id))

  if (isNew && initialized.value && settingsStore.autoPlayNewAlerts && alert.audio_url) {
    playAlert(alert)
  }
}

const playAlert = async (alert: Alert) => {
  try {
    const audioUrl = await fetchAlertAudio(
      settingsStore.organizationKey,
      alert.alert_id,
      settingsStore.organizationSecret,
    )
    const audio = new Audio(audioUrl)
    // Release the object URL once playback finishes (or fails to start).
    audio.addEventListener('ended', () => URL.revokeObjectURL(audioUrl))
    await audio.play().catch(err => {
      URL.revokeObjectURL(audioUrl)
      console.error('Failed to auto-play alert:', err)
    })
  } catch (err) {
    console.error('Failed to load alert audio:', err)
  }
}

const startStream = () => {
  // Idempotent: never run two streams at once.
  stopStream()
  streamStatus.value = 'reconnecting'
  streamHandle = streamAlerts(
    settingsStore.organizationKey,
    settingsStore.organizationSecret,
    {
      onAlert: onStreamAlert,
      onStatus: (status) => {
        streamStatus.value = status
      },
    },
  )
}

const stopStream = () => {
  if (streamHandle) {
    streamHandle.close()
    streamHandle = null
  }
}

const togglePause = () => {
  isPaused.value = !isPaused.value

  if (isPaused.value) {
    // Pause: drop the live connection.
    stopStream()
  } else {
    // Resume: reconnect and pull a fresh snapshot to cover the paused gap.
    fetchAlerts()
    startStream()
  }
}

const manualRefresh = async () => {
  await fetchAlerts()
}

onMounted(() => {
  fetchOrganization().then(() => {
    // Everything the initial load will show is now in `alerts`; from here on,
    // stream arrivals are genuinely new and may auto-play.
    initialized.value = true
    if (organization.value) {
      startStream()
    }
  })
})

onUnmounted(() => {
  stopStream()
})
</script>

<template>
  <main class="home">
    <div class="home-container">
      <div v-if="loading" class="status-message loading">
        <p>Loading organization...</p>
      </div>

      <div v-else-if="error" class="status-message error">
        <p><strong>Error:</strong> {{ error }}</p>
        <button @click="fetchOrganization" class="btn-retry">Retry</button>
      </div>

      <div v-if="organization" class="alerts-section">
        <div class="alerts-header">
          <h2>{{ organization.name }} - Alerts</h2>
          <div class="refresh-controls">
            <div v-if="isPaused" class="paused-indicator">
              Live updates paused
            </div>
            <div v-else class="stream-status" :class="streamStatus">
              <span class="stream-dot" aria-hidden="true"></span>
              {{ streamStatus === 'connected' ? 'Live' : 'Reconnecting…' }}
            </div>
            <button
              @click="manualRefresh"
              class="btn-refresh"
              title="Refresh now"
            >
              ↻ Refresh
            </button>
            <button
              @click="togglePause"
              class="btn-pause"
              :title="isPaused ? 'Resume live updates' : 'Pause live updates'"
            >
              {{ isPaused ? '▶ Resume' : '⏸ Pause' }}
            </button>
          </div>
        </div>

        <div v-if="alertsError" class="status-message error">
          <p><strong>Error:</strong> {{ alertsError }}</p>
          <button @click="fetchAlerts" class="btn-retry">Retry</button>
        </div>

        <div v-else-if="alerts.length === 0" class="status-message info">
          <p>No alerts found for this organization.</p>
        </div>

        <div v-else class="alerts-list">
          <AlertCard v-for="alert in alerts" :key="alert.alert_id" :alert="alert" />
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.home {
  min-height: 100vh;
  padding: 2rem 1rem;
}

.home-container {
  /* max-width: 800px; */
  margin: 0 auto;
}

h1 {
  margin-bottom: 2rem;
  color: var(--color-heading);
}

.status-message {
  padding: 1.5rem;
  border-radius: 8px;
  text-align: center;
}

.status-message.loading {
  background: var(--color-background-soft);
  color: var(--color-text);
}

.status-message.error {
  background: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
}

.status-message p {
  margin: 0 0 1rem 0;
}

.btn-retry {
  background: hsla(160, 100%, 37%, 1);
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  font-size: 1rem;
  cursor: pointer;
  transition: background 0.3s ease;
}

.btn-retry:hover {
  background: hsla(160, 100%, 32%, 1);
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.detail-item .label {
  font-size: 0.875rem;
  color: var(--color-text-muted, #666);
  font-weight: 600;
}

.detail-item .value {
  font-size: 1rem;
  color: var(--color-text);
  font-family: monospace;
  background: var(--color-background);
  padding: 0.5rem;
  border-radius: 4px;
  border: 1px solid var(--color-border);
}

.alerts-section {
  margin-top: 2rem;
}

.alerts-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.alerts-header h2 {
  margin: 0;
  color: var(--color-heading);
  font-size: 1.5rem;
}

.refresh-controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.stream-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--color-text-muted, #666);
  background: var(--color-background-soft);
  padding: 0.5rem 1rem;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  font-weight: 500;
}

.stream-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: #adb5bd;
}

.stream-status.connected .stream-dot {
  background: hsla(160, 100%, 37%, 1);
}

.stream-status.reconnecting .stream-dot {
  background: #e0a800;
  animation: stream-pulse 1s ease-in-out infinite;
}

@keyframes stream-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.3;
  }
}

.paused-indicator {
  font-size: 0.875rem;
  color: #856404;
  background: #fff3cd;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  border: 1px solid #ffeaa7;
  font-weight: 500;
}

.btn-refresh,
.btn-pause {
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  background: var(--color-background);
  color: var(--color-text);
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s ease;
}

.btn-refresh:hover:not(:disabled),
.btn-pause:hover {
  background: var(--color-background-soft);
  border-color: hsla(160, 100%, 37%, 1);
}

.btn-refresh:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-refresh {
  background: hsla(160, 100%, 37%, 1);
  color: white;
  border-color: hsla(160, 100%, 37%, 1);
}

.btn-refresh:hover:not(:disabled) {
  background: hsla(160, 100%, 32%, 1);
}

.alerts-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.status-message.info {
  background: #e7f3ff;
  color: #004085;
  border: 1px solid #b3d9ff;
}

@media (max-width: 640px) {
  .alerts-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .refresh-controls {
    width: 100%;
    flex-direction: column;
  }

  .stream-status,
  .paused-indicator {
    width: 100%;
    text-align: center;
    justify-content: center;
  }

  .btn-refresh,
  .btn-pause {
    width: 100%;
    justify-content: center;
  }
}

@media (min-width: 1024px) {
  .home {
    padding: 2rem;
  }

  .home-container {
    /* max-width: 1000px; */
  }
}
</style>
