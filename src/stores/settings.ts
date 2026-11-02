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
  // Optional output-device override; '' plays on the system default. The label
  // is kept so a device that is unplugged can still be named in the UI.
  const audioOutputDeviceId = persisted('audioOutputDeviceId', '')
  const audioOutputDeviceLabel = persisted('audioOutputDeviceLabel', '')
  // Listen to the pager audio on this computer and cut a pre-alert off when the
  // department's tones are heard. The input is per browser, like the output;
  // '' is the system default input.
  const pagerMonitorEnabled = persisted('pagerMonitorEnabled', false)
  const pagerInputDeviceId = persisted('pagerInputDeviceId', '')
  const pagerInputDeviceLabel = persisted('pagerInputDeviceLabel', '')

  // Reset to defaults; the persistence watch writes the defaults back, so a
  // reload reads them again.
  const clearSettings = () => {
    organizationKey.value = ''
    organizationSecret.value = ''
    refreshInterval.value = DEFAULT_REFRESH_INTERVAL
    autoPlayNewAlerts.value = false
    audioOutputDeviceId.value = ''
    audioOutputDeviceLabel.value = ''
    pagerMonitorEnabled.value = false
    pagerInputDeviceId.value = ''
    pagerInputDeviceLabel.value = ''
  }

  return {
    organizationKey,
    organizationSecret,
    refreshInterval,
    autoPlayNewAlerts,
    audioOutputDeviceId,
    audioOutputDeviceLabel,
    pagerMonitorEnabled,
    pagerInputDeviceId,
    pagerInputDeviceLabel,
    clearSettings,
  }
})
