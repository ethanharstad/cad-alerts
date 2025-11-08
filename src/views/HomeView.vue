<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSettingsStore } from '@/stores/settings'

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

    alerts.value = await response.json()
  } catch (err) {
    alertsError.value = err instanceof Error ? err.message : 'An error occurred'
  } finally {
    alertsLoading.value = false
  }
}

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

onMounted(() => {
  fetchOrganization()
})
</script>

<template>
  <main class="home">
    <div class="home-container">
      <h1>Home</h1>

      <div v-if="loading" class="status-message loading">
        <p>Loading organization...</p>
      </div>

      <div v-else-if="error" class="status-message error">
        <p><strong>Error:</strong> {{ error }}</p>
        <button @click="fetchOrganization" class="btn-retry">Retry</button>
      </div>

      <div v-else-if="organization" class="organization-info">
        <h2>{{ organization.name }}</h2>
        <div class="organization-details">
          <div class="detail-item">
            <span class="label">Organization ID:</span>
            <span class="value">{{ organization.org_id }}</span>
          </div>
          <div class="detail-item">
            <span class="label">Organization Key:</span>
            <span class="value">{{ organization.org_key }}</span>
          </div>
        </div>
      </div>

      <div v-if="organization" class="alerts-section">
        <h2>Alerts</h2>

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
          <div v-for="alert in alerts" :key="alert.alert_id" class="alert-card">
            <div class="alert-header">
              <span class="alert-timestamp">{{ formatTimestamp(alert.timestamp) }}</span>
            </div>
            <div class="alert-body">
              {{ alert.body }}
            </div>
            <div v-if="alert.audio_url" class="alert-audio">
              <audio controls :src="`/audio/${alert.audio_url}`">
                Your browser does not support the audio element.
              </audio>
            </div>
          </div>
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

.organization-info {
  background: var(--color-background-soft);
  padding: 2rem;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.organization-info h2 {
  margin: 0 0 1.5rem 0;
  color: var(--color-heading);
  font-size: 2rem;
}

.organization-details {
  display: flex;
  flex-direction: column;
  gap: 1rem;
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

.alerts-section h2 {
  margin-bottom: 1.5rem;
  color: var(--color-heading);
  font-size: 1.5rem;
}

.alerts-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

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

.status-message.info {
  background: #e7f3ff;
  color: #004085;
  border: 1px solid #b3d9ff;
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
