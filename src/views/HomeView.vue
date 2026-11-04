<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import {
  BellOff,
  CircleAlert,
  Info,
  Pause,
  Play,
  Radio,
  RefreshCw,
  TriangleAlert,
  VolumeX,
} from '@lucide/vue'
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
import { resolveOutputDevice } from '@/audio/outputDevice'
import { notifyPagerPreempt } from '@/audio/pagerPreempt'
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

type PagerState = PagerMonitorStatus | 'off' | 'no-sets'

let pagerMonitor: PagerMonitor | null = null
const pagerState = ref<PagerState>('off')
const pagerDetail = ref<string>('')
// The page last heard, shown while its hold lasts.
const pagerHeard = ref<string | null>(null)
let pagerHeardTimer: ReturnType<typeof setTimeout> | null = null

const onPagerMatch = (set: PagerToneSet) => {
  announcer.preempt(DEFAULT_PREEMPT_HOLD_MS)
  // Manual replays (alert cards) stop too.
  notifyPagerPreempt()
  pagerHeard.value = describePagerToneSet(set)
  if (pagerHeardTimer) clearTimeout(pagerHeardTimer)
  pagerHeardTimer = setTimeout(() => {
    pagerHeard.value = null
  }, DEFAULT_PREEMPT_HOLD_MS)
}

const stopPager = () => {
  pagerMonitor?.stop()
  pagerMonitor = null
  pagerState.value = 'off'
}

const startPager = () => {
  stopPager()
  // Preempting only matters on a dashboard that speaks.
  if (!settingsStore.pagerMonitorEnabled || !settingsStore.autoPlayNewAlerts || !supportsPagerMonitor()) {
    return
  }
  const { sets } = parsePagerToneSets(organization.value?.pager_tone_sets)
  if (sets.length === 0) {
    pagerState.value = 'no-sets'
    return
  }
  // The handle comes back at once, so stopPager can always release it — even
  // while the input is still opening.
  pagerMonitor = startPagerMonitor({
    deviceId: settingsStore.pagerInputDeviceId,
    deviceLabel: settingsStore.pagerInputDeviceLabel,
    onDeviceIdChange: (id) => {
      settingsStore.pagerInputDeviceId = id
    },
    sets,
    onMatch: onPagerMatch,
    onStatus: (status, detail) => {
      // Stopping is reported as 'off' by stopPager itself.
      if (status === 'stopped') return
      pagerState.value = status
      pagerDetail.value = detail ?? ''
    },
  })
  pagerState.value = pagerMonitor.status
}

// An unplugged input comes back as a device change; try again then.
const onDeviceChange = () => {
  void checkOutputDevice()
  if (pagerState.value === 'unavailable') startPager()
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

// Badge colors (BRANDING.md › Badges): semantic status only, never brand colors.
const streamBadgeClass = computed(() => {
  if (streamStatus.value === 'connected') return 'badge-success'
  if (streamStatus.value === 'reconnecting') return 'badge-warning'
  return 'badge-danger'
})

const pagerBadgeClass = computed(() => {
  switch (pagerState.value) {
    case 'listening':
      return 'badge-success'
    case 'starting':
      return ''
    default:
      return 'badge-warning'
  }
})

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
      startPager()
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
  <main class="page">
    <button
      v-if="showAudioBlocked"
      type="button"
      class="audio-blocked"
      role="alert"
      @click="unlockAudio"
    >
      <span class="audio-blocked-title">
        <VolumeX aria-hidden="true" />
        Audio blocked — alerts will not be heard
      </span>
      <span class="audio-blocked-detail">Tap anywhere to enable sound</span>
    </button>

    <div v-if="loading" class="notice" role="status">
      <Info aria-hidden="true" />
      <div class="notice-body"><p>Loading organization…</p></div>
    </div>

    <div v-else-if="error" class="notice notice-danger" role="alert">
      <CircleAlert aria-hidden="true" />
      <div class="notice-body">
        <p><strong>Error:</strong> {{ error }}</p>
        <button type="button" class="btn btn-primary btn-sm" @click="fetchOrganization">Retry</button>
      </div>
    </div>

    <section v-if="organization" class="alerts-section" aria-labelledby="alerts-heading">
      <div class="alerts-header">
        <h1 id="alerts-heading">{{ organization.name }} — Alerts</h1>
        <div class="refresh-controls">
          <span v-if="isPaused" class="badge badge-warning">
            <span class="badge-dot" aria-hidden="true"></span>
            Live updates paused
          </span>
          <span v-else class="badge stream-status" :class="[streamBadgeClass, streamStatus]">
            <span class="badge-dot" aria-hidden="true"></span>
            {{ streamStatusLabel }}
          </span>
          <span
            v-if="pagerLabel"
            class="badge"
            :class="pagerBadgeClass"
            :title="pagerDetail || 'Cuts pre-alerts off when the department\'s pager tones are heard'"
          >
            <span class="badge-dot" aria-hidden="true"></span>
            {{ pagerLabel }}
          </span>
          <button
            type="button"
            class="btn btn-outline btn-sm"
            title="Refresh now"
            @click="manualRefresh"
          >
            <RefreshCw aria-hidden="true" />
            Refresh
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            :title="isPaused ? 'Resume live updates' : 'Pause live updates'"
            @click="togglePause"
          >
            <component :is="isPaused ? Play : Pause" aria-hidden="true" />
            {{ isPaused ? 'Resume' : 'Pause' }}
          </button>
        </div>
      </div>

      <div v-if="outputDeviceMissing" class="notice notice-warning">
        <TriangleAlert aria-hidden="true" />
        <div class="notice-body">
          <p>
            The alert audio output
            <strong>{{ settingsStore.audioOutputDeviceLabel || 'chosen in Settings' }}</strong>
            isn't available, so alerts are playing on the system default. Reconnect it or
            choose another in <RouterLink to="/settings">Settings</RouterLink>.
          </p>
        </div>
      </div>

      <div v-if="pagerHeard" class="notice notice-info" role="status">
        <Radio aria-hidden="true" />
        <div class="notice-body">
          <p>
            Pager tones heard — <strong>{{ pagerHeard }}</strong>. Pre-alerts are held
            while dispatch is on the air.
          </p>
        </div>
      </div>

      <div v-if="pagerState === 'unavailable'" class="notice notice-warning">
        <TriangleAlert aria-hidden="true" />
        <div class="notice-body">
          <p>
            {{ pagerDetail || 'The pager audio input is unavailable' }}, so pre-alerts will
            not be cut off when the pager tones out. Check the input in
            <RouterLink to="/settings">Settings</RouterLink>.
          </p>
        </div>
      </div>
      <div v-else-if="pagerState === 'suspended'" class="notice notice-warning">
        <TriangleAlert aria-hidden="true" />
        <div class="notice-body">
          <p>The pager monitor is waiting for the browser — tap anywhere to start listening.</p>
        </div>
      </div>
      <div v-else-if="pagerState === 'no-sets'" class="notice notice-warning">
        <TriangleAlert aria-hidden="true" />
        <div class="notice-body">
          <p>
            Pager monitoring is on for this browser, but the organization has no pager tone
            sets. Add them in <RouterLink to="/settings">Settings</RouterLink>.
          </p>
        </div>
      </div>

      <div v-if="alertsError" class="notice notice-danger" role="alert">
        <CircleAlert aria-hidden="true" />
        <div class="notice-body">
          <p><strong>Error:</strong> {{ alertsError }}</p>
          <button type="button" class="btn btn-primary btn-sm" @click="fetchAlerts">Retry</button>
        </div>
      </div>

      <div v-else-if="alerts.length === 0" class="card empty-state">
        <BellOff class="empty-icon" aria-hidden="true" />
        <h2 class="empty-heading">No alerts yet</h2>
        <p class="empty-detail">
          Pre-alerts for {{ organization.name }} appear here as soon as CAD sends them.
        </p>
      </div>

      <div v-else class="alerts-list">
        <AlertCard v-for="alert in alerts" :key="alert.alert_id" :alert="alert" />
      </div>
    </section>
  </main>
</template>

<style scoped>
.page > * + * {
  margin-top: var(--space-4);
}

/*
 * The one deliberately loud element: a dashboard that can't make sound must be
 * noticed from across the room. Danger (status) red, not brand red. The pulse is
 * an opacity-only overlay, and stops under prefers-reduced-motion.
 */
.audio-blocked {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-8) var(--space-4);
  overflow: hidden;
  background: var(--danger);
  color: var(--white);
  border: none;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  font-family: var(--font-sans);
  cursor: pointer;
}

.audio-blocked::after {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--gray-900);
  opacity: 0;
  animation: audio-blocked-pulse 2s var(--ease-in-out) infinite;
  pointer-events: none;
}

.audio-blocked-title {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--text-3xl);
  font-weight: 600;
  line-height: 1.25;
  text-align: center;
}

.audio-blocked-title svg {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
}

.audio-blocked-detail {
  font-size: var(--text-xl);
}

@keyframes audio-blocked-pulse {
  50% {
    opacity: 0.2;
  }
}

.alerts-section > * + * {
  margin-top: var(--space-4);
}

.alerts-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}

.refresh-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

/* Reconnecting is transient, so its dot pulses; "unavailable" is a resting
   (degraded but working) state and stays steady. */
.stream-status.reconnecting .badge-dot {
  animation: stream-pulse 1s var(--ease-in-out) infinite;
}

@keyframes stream-pulse {
  50% {
    opacity: 0.3;
  }
}

.alerts-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* Empty state per BRANDING.md › Empty States. */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-12) var(--space-6);
  text-align: center;
}

.empty-icon {
  width: 48px;
  height: 48px;
  color: var(--text-tertiary);
}

.empty-heading {
  font-size: var(--text-lg);
}

.empty-detail {
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

@media (max-width: 640px) {
  .refresh-controls {
    width: 100%;
  }

  .refresh-controls .btn {
    flex: 1;
  }
}
</style>
