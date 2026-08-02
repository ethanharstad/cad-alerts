import { defineStore } from 'pinia'
import { persisted } from './persisted'
import { DEFAULT_ACTIONABLE_WINDOW_MS } from '@/audio/announcer'

const DEFAULT_REFRESH_INTERVAL = 30 // seconds
// Held in minutes, the unit the settings screen asks for; derived from the
// announcer's own default so the two cannot drift apart.
const DEFAULT_ACTIONABLE_WINDOW_MINUTES = DEFAULT_ACTIONABLE_WINDOW_MS / 60_000

export const useSettingsStore = defineStore('settings', () => {
  // Each field is a localStorage-backed ref; the key and the read/write plumbing
  // live once in `persisted`. Pinia exposes these as writable, so callers can
  // bind them with `v-model` directly.
  const organizationKey = persisted('organizationKey', '')
  const organizationSecret = persisted('organizationSecret', '')
  const refreshInterval = persisted('refreshInterval', DEFAULT_REFRESH_INTERVAL)
  const autoPlayNewAlerts = persisted('autoPlayNewAlerts', false)
  const actionableWindowMinutes = persisted(
    'actionableWindowMinutes',
    DEFAULT_ACTIONABLE_WINDOW_MINUTES,
  )

  // Reset to defaults; the persistence watch writes the defaults back, so a
  // reload reads them again.
  const clearSettings = () => {
    organizationKey.value = ''
    organizationSecret.value = ''
    refreshInterval.value = DEFAULT_REFRESH_INTERVAL
    autoPlayNewAlerts.value = false
    actionableWindowMinutes.value = DEFAULT_ACTIONABLE_WINDOW_MINUTES
  }

  return {
    organizationKey,
    organizationSecret,
    refreshInterval,
    autoPlayNewAlerts,
    actionableWindowMinutes,
    clearSettings,
  }
})
