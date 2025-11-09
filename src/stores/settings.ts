import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export const useSettingsStore = defineStore('settings', () => {
  // State
  const organizationKey = ref<string>('')
  const organizationSecret = ref<string>('')
  const refreshInterval = ref<number>(30) // Default to 30 seconds

  // Initialize from localStorage
  const initializeFromLocalStorage = () => {
    const savedKey = localStorage.getItem('organizationKey')
    const savedSecret = localStorage.getItem('organizationSecret')
    const savedInterval = localStorage.getItem('refreshInterval')

    if (savedKey) {
      organizationKey.value = savedKey
    }
    if (savedSecret) {
      organizationSecret.value = savedSecret
    }
    if (savedInterval) {
      refreshInterval.value = parseInt(savedInterval, 10)
    }
  }

  // Watch for changes and persist to localStorage
  watch(organizationKey, (newValue) => {
    localStorage.setItem('organizationKey', newValue)
  })

  watch(organizationSecret, (newValue) => {
    localStorage.setItem('organizationSecret', newValue)
  })

  watch(refreshInterval, (newValue) => {
    localStorage.setItem('refreshInterval', newValue.toString())
  })

  // Actions
  const setOrganizationKey = (key: string) => {
    organizationKey.value = key
  }

  const setOrganizationSecret = (secret: string) => {
    organizationSecret.value = secret
  }

  const setRefreshInterval = (interval: number) => {
    refreshInterval.value = interval
  }

  const clearSettings = () => {
    organizationKey.value = ''
    organizationSecret.value = ''
    refreshInterval.value = 30
    localStorage.removeItem('organizationKey')
    localStorage.removeItem('organizationSecret')
    localStorage.removeItem('refreshInterval')
  }

  // Initialize on store creation
  initializeFromLocalStorage()

  return {
    organizationKey,
    organizationSecret,
    refreshInterval,
    setOrganizationKey,
    setOrganizationSecret,
    setRefreshInterval,
    clearSettings
  }
})
