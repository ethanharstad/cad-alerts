<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import AlertCard from '@/components/AlertCard.vue'
import {
  createAlertAnnouncer,
  DEFAULT_ACTIONABLE_WINDOW_MS,
  DEFAULT_PREEMPT_HOLD_MS,
} from '@/audio/announcer'
import { playClip } from '@/audio/play'
import { audioBlocked, probeAudio } from '@/audio/autoplay'
import { createReloadScheduler } from '@/update/reload'
import { resolveOutputDevice, listDevices, matchSavedDevice } from '@/audio/outputDevice'
import {
  startPagerMonitor,
  supportsPagerMonitor,
  type PagerMonitor,
  type PagerMonitorStatus,
} from '@/audio/pagerMonitor'
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
import { selectTone } from '../../shared/alertTones'
import {
  parsePagerToneSets,
  describePagerToneSet,
  type PagerToneSet,
} from '../../shared/pagerTones'

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
// The degraded path: only runs while the stream reports itself unavailable.
let fallbackTimer: ReturnType<typeof setInterval> | null = null

// Set when the chosen output device is known to be missing, so the dashboard
// says alerts are on the system default instead of failing quietly.
const outputDeviceMissing = ref(false)

const checkOutputDevice = async () => {
  const resolved = await resolveOutputDevice(
    settingsStore.audioOutputDeviceId,
    settingsStore.audioOutputDeviceLabel,
  )
  // Re-issued id for the same device: keep following it.
  if (resolved) settingsStore.audioOutputDeviceId = resolved
  outputDeviceMissing.value = resolved === null
}

const playOptions = () => ({
  deviceId: settingsStore.audioOutputDeviceId,
  onDeviceUnavailable: () => {
    outputDeviceMissing.value = true
  },
})

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
    // path — both are "show me what is there now", so neither speaks. Anything
    // that should be announced comes through onAlertArrived instead.
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
 * Merge one arriving alert into the list: dedup by id (the stream can replay a
 * boundary alert on reconnect, and a revised incident arrives again under its
 * existing id), keep newest-first, cap the list, and offer genuinely-new alerts
 * to the announcer once the initial load is done. Every live path goes through
 * here — the stream, the fallback poll, and the catch-up after a pause — so an
 * alert is offered exactly once no matter which one delivered it. Whether it is
 * actually spoken is the announcer's call.
 */
const onAlertArrived = (alert: Alert) => {
  const isNew = !previousAlertIds.value.has(alert.alert_id)

  alerts.value = [alert, ...alerts.value.filter(a => a.alert_id !== alert.alert_id)]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_ALERTS)
  previousAlertIds.value = new Set(alerts.value.map(a => a.alert_id))

  if (isNew && initialized.value && settingsStore.autoPlayNewAlerts && alert.audio_url) {
    announcer.announce(alert)
  }
}

/**
 * Play one alert's audio, preceded by the organization's alert tone for the
 * current time of day, resolving when it has finished — the announcer relies on
 * that to know when it may start another. A failure resolves too: a clip that
 * won't play must not wedge the next one.
 */
const playAlert = async (alert: Alert, signal: AbortSignal) => {
  try {
    // Load the speech before sounding the tone, so the tone is never followed
    // by a gap — or by nothing, if the audio cannot be fetched.
    const audioUrl = await fetchAlertAudio(
      settingsStore.organizationKey,
      alert.alert_id,
      settingsStore.organizationSecret,
    )
    try {
      // The signal aborts when the department's pager tones are heard (see
      // onPagerMatch) — possibly while the audio was still loading, in which
      // case nothing plays at all.
      const tone = organization.value ? selectTone(organization.value, new Date()) : undefined
      if (tone) await playClip(tone.url, { ...playOptions(), signal })
      await playClip(audioUrl, { ...playOptions(), signal })
    } finally {
      URL.revokeObjectURL(audioUrl)
    }
  } catch (err) {
    console.error('Failed to load alert audio:', err)
  }
}

// Only the latest alert is ever read out, and only while it is still actionable
// — a pause that ends with three missed calls announces the most recent one, not
// a recital of calls that have already been handled. The window is the
// organization's, read per alert so a change picked up by a later org fetch
// applies without a reload; null means the department never set one.
const announcer = createAlertAnnouncer(playAlert, {
  windowMs: () => {
    const minutes = organization.value?.actionable_window_minutes
    return minutes == null ? DEFAULT_ACTIONABLE_WINDOW_MS : minutes * 60_000
  },
})

/**
 * Pull the current list and treat anything unseen as an arrival, rather than
 * silently replacing what is on screen. Used wherever the live connection has a
 * hole in it: the fallback poll's tick (docs/adr/0001 graceful degradation), and
 * the moment a pause ends. Alerts that landed while nothing was listening are
 * still news to the room, so they go through the arrival path — a kiosk that has
 * quietly stopped speaking is not "still working". The announcer decides what a
 * backlog actually sounds like: the newest call, and only if it is still live.
 */
const catchUp = async () => {
  try {
    const latest = await getAlerts(
      settingsStore.organizationKey,
      settingsStore.organizationSecret,
    )
    // Oldest first, so the newest is the last one offered to the announcer.
    for (const alert of [...latest].sort((a, b) => a.timestamp - b.timestamp)) {
      onAlertArrived(alert)
    }
  } catch {
    // Leave the last-known list up; the next tick (or reconnect) tries again.
  }
}

const startFallbackPoll = () => {
  if (fallbackTimer) return
  fallbackTimer = setInterval(catchUp, settingsStore.refreshInterval * 1000)
  catchUp()
}

const stopFallbackPoll = () => {
  if (fallbackTimer) {
    clearInterval(fallbackTimer)
    fallbackTimer = null
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
      onAlert: onAlertArrived,
      onStatus: (status) => {
        streamStatus.value = status
        // The stream keeps retrying underneath, so this flips back off by itself
        // once it recovers.
        if (status === 'unavailable') startFallbackPoll()
        else stopFallbackPoll()
      },
    },
  )
}

// Reload onto a new deploy when one ships, but never mid-announcement, and
// never out from under an operator's pause — a reload would resume the stream
// they deliberately stopped. A paused dashboard picks the update up on resume.
const reloadScheduler = createReloadScheduler({
  isBusy: () => announcer.isBusy || announcer.isHolding || isPaused.value,
})

// ---- Pager monitor ----
// With a pager audio feed wired into this computer, hearing one of the
// department's tone sets means the real dispatch has started: cut the pre-alert
// off and hold further ones while the dispatcher talks. Only the department's
// own sets count — county-wide dispatch shares the channel with other agencies.

type PagerState = PagerMonitorStatus | 'off' | 'no-sets' | 'starting'

let pagerMonitor: PagerMonitor | null = null
// Bumped on every start/stop, so a slow start that has been superseded knows to
// shut itself down.
let pagerGeneration = 0
const pagerState = ref<PagerState>('off')
const pagerDetail = ref<string>('')
// The page last heard, shown while its hold lasts.
const pagerHeard = ref<string | null>(null)
let pagerHeardTimer: ReturnType<typeof setTimeout> | null = null

const onPagerMatch = (set: PagerToneSet) => {
  announcer.preempt(DEFAULT_PREEMPT_HOLD_MS)
  pagerHeard.value = describePagerToneSet(set)
  if (pagerHeardTimer) clearTimeout(pagerHeardTimer)
  pagerHeardTimer = setTimeout(() => {
    pagerHeard.value = null
  }, DEFAULT_PREEMPT_HOLD_MS)
}

const stopPager = () => {
  pagerGeneration++
  pagerMonitor?.stop()
  pagerMonitor = null
  pagerState.value = 'off'
}

const startPager = async () => {
  stopPager()
  const generation = pagerGeneration
  // Preempting only matters on a dashboard that speaks.
  if (!settingsStore.pagerMonitorEnabled || !settingsStore.autoPlayNewAlerts || !supportsPagerMonitor()) {
    return
  }
  const { sets } = parsePagerToneSets(organization.value?.pager_tone_sets)
  if (sets.length === 0) {
    pagerState.value = 'no-sets'
    return
  }
  pagerState.value = 'starting'
  // Follow the saved input if the browser has re-issued its id.
  const resolved = await matchSavedDevice(
    () => listDevices('audioinput', 'Input'),
    settingsStore.pagerInputDeviceId,
    settingsStore.pagerInputDeviceLabel,
  )
  if (resolved) settingsStore.pagerInputDeviceId = resolved
  const monitor = await startPagerMonitor({
    deviceId: settingsStore.pagerInputDeviceId,
    sets,
    onMatch: onPagerMatch,
    onStatus: (status, detail) => {
      if (generation !== pagerGeneration) return
      pagerState.value = status
      pagerDetail.value = detail ?? ''
    },
  })
  if (generation !== pagerGeneration) {
    monitor.stop()
    return
  }
  pagerMonitor = monitor
  pagerState.value = monitor.status
}

// An unplugged input comes back as a device change; try again then.
const onDeviceChange = () => {
  void checkOutputDevice()
  if (pagerState.value === 'unavailable') void startPager()
}

const pagerLabel = computed(() => {
  switch (pagerState.value) {
    case 'listening':
      return 'Pager: listening'
    case 'starting':
      return 'Pager: starting…'
    case 'suspended':
      return 'Pager: tap to start'
    case 'no-sets':
      return 'Pager: no tones set'
    case 'unavailable':
      return 'Pager: no input'
    default:
      return ''
  }
})

// The block lifts on the first tap or keypress, wherever it lands — the banner
// is just the obvious place to tap. Playing inside that gesture is what unlocks
// sound, so the probe runs from the listener itself.
const unlockAudio = () => {
  if (audioBlocked.value) void probeAudio()
  // The pager monitor's audio processing waits for a gesture the same way.
  if (pagerState.value === 'suspended') void pagerMonitor?.resume()
}

// Only a dashboard that is meant to speak can be "blocked"; with auto-play off
// there is nothing to warn about.
const showAudioBlocked = computed(() => audioBlocked.value && settingsStore.autoPlayNewAlerts)

const stopStream = () => {
  if (streamHandle) {
    streamHandle.close()
    streamHandle = null
  }
  stopFallbackPoll()
}

const togglePause = () => {
  isPaused.value = !isPaused.value

  if (isPaused.value) {
    // Pause: drop the live connection (and the fallback poll with it), and let
    // go of anything still queued to be spoken — the operator asked for quiet.
    stopStream()
    announcer.clear()
  } else {
    // Resume: reconnect first so the new stream's cursor is already running,
    // then catch up on the gap. Anything that arrives in between reaches both,
    // and the id dedup in onAlertArrived means it is still only spoken once.
    startStream()
    catchUp()
  }
}

const streamStatusLabel = computed(() => {
  if (streamStatus.value === 'connected') return 'Live'
  if (streamStatus.value === 'reconnecting') return 'Reconnecting…'
  // Name the degraded mode rather than showing a permanent "Reconnecting…" —
  // the dashboard is still updating, just on a slower clock.
  return `Live updates unavailable — polling every ${settingsStore.refreshInterval}s`
})

const manualRefresh = async () => {
  await fetchAlerts()
}

onMounted(() => {
  document.addEventListener('pointerdown', unlockAudio)
  document.addEventListener('keydown', unlockAudio)
  // Find out now whether sound is blocked, rather than by missing the next call.
  if (settingsStore.autoPlayNewAlerts) void probeAudio()

  void checkOutputDevice()
  navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange)
  fetchOrganization().then(() => {
    // Everything the initial load will show is now in `alerts`; from here on,
    // stream arrivals are genuinely new and may auto-play.
    initialized.value = true
    if (organization.value) {
      startStream()
      void startPager()
    }
  })
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', unlockAudio)
  document.removeEventListener('keydown', unlockAudio)
  reloadScheduler.stop()
  navigator.mediaDevices?.removeEventListener('devicechange', onDeviceChange)
  stopStream()
  announcer.clear()
  stopPager()
  if (pagerHeardTimer) clearTimeout(pagerHeardTimer)
})
</script>

<template>
  <main class="home">
    <div class="home-container">
      <button
        v-if="showAudioBlocked"
        type="button"
        class="audio-blocked"
        role="alert"
        @click="unlockAudio"
      >
        <span class="audio-blocked-title">🔇 Audio blocked — alerts will not be heard</span>
        <span class="audio-blocked-detail">Tap anywhere to enable sound</span>
      </button>

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
              {{ streamStatusLabel }}
            </div>
            <div
              v-if="pagerLabel"
              class="pager-status"
              :class="pagerState"
              :title="pagerDetail || 'Cuts pre-alerts off when the department\'s pager tones are heard'"
            >
              {{ pagerLabel }}
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

        <div v-if="outputDeviceMissing" class="status-message warning">
          <p>
            The alert audio output
            <strong>{{ settingsStore.audioOutputDeviceLabel || 'chosen in Settings' }}</strong>
            isn't available, so alerts are playing on the system default. Reconnect it or
            choose another in <RouterLink to="/settings">Settings</RouterLink>.
          </p>
        </div>

        <div v-if="pagerHeard" class="status-message pager-heard" role="status">
          <p>
            📟 Pager tones heard — <strong>{{ pagerHeard }}</strong>. Pre-alerts are held
            while dispatch is on the air.
          </p>
        </div>

        <div v-if="pagerState === 'unavailable'" class="status-message warning">
          <p>
            {{ pagerDetail || 'The pager audio input is unavailable' }}, so pre-alerts will
            not be cut off when the pager tones out. Check the input in
            <RouterLink to="/settings">Settings</RouterLink>.
          </p>
        </div>
        <div v-else-if="pagerState === 'suspended'" class="status-message warning">
          <p>The pager monitor is waiting for the browser — tap anywhere to start listening.</p>
        </div>
        <div v-else-if="pagerState === 'no-sets'" class="status-message warning">
          <p>
            Pager monitoring is on for this browser, but the organization has no pager tone
            sets. Add them in <RouterLink to="/settings">Settings</RouterLink>.
          </p>
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

.audio-blocked {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  margin-bottom: 1.5rem;
  padding: 2rem 1rem;
  border: 3px solid #a71d2a;
  border-radius: 8px;
  background: #dc3545;
  color: white;
  cursor: pointer;
  font: inherit;
  animation: audio-blocked-pulse 2s ease-in-out infinite;
}

.audio-blocked-title {
  font-size: 2rem;
  font-weight: 700;
}

.audio-blocked-detail {
  font-size: 1.25rem;
}

/* Movement catches the eye from across a room in a way a static box does not. */
@keyframes audio-blocked-pulse {
  0%,
  100% {
    background: #dc3545;
  }
  50% {
    background: #a71d2a;
  }
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

.status-message.warning {
  background: #fff3cd;
  color: #856404;
  border: 1px solid #ffeeba;
  margin-bottom: 1rem;
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

/* Degraded but functioning: steady, not pulsing — this is a resting state, not
   a transient one. */
.stream-status.unavailable .stream-dot {
  background: #d9534f;
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

.pager-status {
  font-size: 0.875rem;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
  color: var(--color-text-muted, #666);
  font-weight: 500;
}

.pager-status.unavailable,
.pager-status.suspended,
.pager-status.no-sets {
  color: #856404;
  background: #fff3cd;
  border-color: #ffeeba;
}

.status-message.pager-heard {
  background: #e7f3ff;
  color: #004085;
  border: 1px solid #b3d9ff;
  margin-bottom: 1rem;
}

.status-message.pager-heard p {
  margin: 0;
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
