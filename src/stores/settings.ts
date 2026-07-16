import { defineStore } from 'pinia'
import { persisted } from './persisted'

const DEFAULT_REFRESH_INTERVAL = 30 // seconds

export const useSettingsStore = defineStore('settings', () => {
  // Each field is a localStorage-backed ref; the key and the read/write plumbing
  // live once in `persisted`. Pinia exposes these as writable, so callers can
  // bind them with `v-model` directly.
  const organizationKey = persisted('organizationKey', '')
  const organizationSecret = persisted('organizationSecret', '')
  const refreshInterval = persisted('refreshInterval', DEFAULT_REFRESH_INTERVAL)
  const autoPlayNewAlerts = persisted('autoPlayNewAlerts', false)

  // Reset to defaults; the persistence watch writes the defaults back, so a
  // reload reads them again.
  const clearSettings = () => {
    organizationKey.value = ''
    organizationSecret.value = ''
    refreshInterval.value = DEFAULT_REFRESH_INTERVAL
    autoPlayNewAlerts.value = false
  }

  return {
    organizationKey,
    organizationSecret,
    refreshInterval,
    autoPlayNewAlerts,
    clearSettings,
  }
})
