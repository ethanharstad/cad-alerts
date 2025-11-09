<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import AlertCard from '@/components/AlertCard.vue'

interface Organization {
  org_id: string
  org_key: string
  access_key: string
  name: string
}

interface Alert {
  alert_id: string
  organization: string
  body: string
  audio_url: string
  timestamp: number
  source: string
}

const settingsStore = useSettingsStore()
const organization = ref<Organization | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

const alerts = ref<Alert[]>([])
const alertsLoading = ref(false)
const alertsError = ref<string | null>(null)
const previousAlertIds = ref<Set<string>>(new Set())

const countdown = ref<number>(0)
const isPaused = ref(false)
let refreshTimer: ReturnType<typeof setInterval> | null = null
let countdownTimer: ReturnType<typeof setInterval> | null = null

const fetchOrganization = async () => {
  loading.value = true
  error.value = null

  try {
    const response = await fetch(`/api/org/${settingsStore.organizationKey}`)

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Organization not found')
      }
      throw new Error('Failed to fetch organization')
    }

    organization.value = await response.json()

    // Fetch alerts after successfully fetching organization
    await fetchAlerts()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'An error occurred'
  } finally {
    loading.value = false
  }
}

const fetchAlerts = async () => {
  alertsLoading.value = true
  alertsError.value = null

  try {
    const response = await fetch(`/api/org/${settingsStore.organizationKey}/alerts`)

    if (!response.ok) {
      throw new Error('Failed to fetch alerts')
    }

    const newAlerts: Alert[] = await response.json()

    // Check for new alerts and auto-play if enabled
    if (settingsStore.autoPlayNewAlerts && previousAlertIds.value.size > 0 && newAlerts.length > 0) {
      // Find alerts that weren't in the previous list
      const newestAlert = newAlerts.find(alert => !previousAlertIds.value.has(alert.alert_id))

      if (newestAlert && newestAlert.audio_url) {
        // Play the newest alert
        playAlert(newestAlert)
      }
    }

    // Update alerts and track IDs
    alerts.value = newAlerts
    previousAlertIds.value = new Set(newAlerts.map(alert => alert.alert_id))

    // Reset countdown after successful fetch
    resetCountdown()
  } catch (err) {
    alertsError.value = err instanceof Error ? err.message : 'An error occurred'
  } finally {
    alertsLoading.value = false
  }
}

const playAlert = (alert: Alert) => {
  const audioUrl = `/api/org/${settingsStore.organizationKey}/alerts/${alert.alert_id}/audio`
  const audio = new Audio(audioUrl)
  audio.play().catch(err => {
    console.error('Failed to auto-play alert:', err)
  })
}

const resetCountdown = () => {
  countdown.value = settingsStore.refreshInterval
}

const startRefreshTimer = () => {
  // Clear any existing timers
  stopRefreshTimer()

  // Set initial countdown
  resetCountdown()

  // Start countdown timer (updates every second)
  countdownTimer = setInterval(() => {
    if (countdown.value > 0) {
      countdown.value--
    }
  }, 1000)

  // Start refresh timer
  refreshTimer = setInterval(() => {
    fetchAlerts()
  }, settingsStore.refreshInterval * 1000)
}

const stopRefreshTimer = () => {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
}

const togglePause = () => {
  isPaused.value = !isPaused.value

  if (isPaused.value) {
    // Pause: stop the timers
    stopRefreshTimer()
  } else {
    // Unpause: restart the timers
    startRefreshTimer()
  }
}

const manualRefresh = async () => {
  await fetchAlerts()
  // If not paused, restart the timer to reset the interval
  if (!isPaused.value) {
    startRefreshTimer()
  }
}

onMounted(() => {
  fetchOrganization().then(() => {
    // Start auto-refresh after initial load
    if (organization.value) {
      startRefreshTimer()
    }
  })
})

onUnmounted(() => {
  stopRefreshTimer()
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
            <div v-if="countdown > 0 && !alertsLoading && !isPaused" class="countdown">
              Next refresh in {{ countdown }}s
            </div>
            <div v-if="isPaused" class="paused-indicator">
              Auto-refresh paused
            </div>
            <button
              @click="manualRefresh"
              class="btn-refresh"
              :disabled="alertsLoading"
              title="Refresh now"
            >
              ↻ Refresh
            </button>
            <button
              @click="togglePause"
              class="btn-pause"
              :title="isPaused ? 'Resume auto-refresh' : 'Pause auto-refresh'"
            >
              {{ isPaused ? '▶ Resume' : '⏸ Pause' }}
            </button>
          </div>
        </div>

        <div v-if="alertsLoading" class="status-message loading">
          <p>Loading alerts...</p>
        </div>

        <div v-else-if="alertsError" class="status-message error">
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
  max-width: 800px;
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

.countdown {
  font-size: 0.875rem;
  color: var(--color-text-muted, #666);
  background: var(--color-background-soft);
  padding: 0.5rem 1rem;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  font-weight: 500;
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

  .countdown,
  .paused-indicator {
    width: 100%;
    text-align: center;
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
    max-width: 1000px;
  }
}
</style>
