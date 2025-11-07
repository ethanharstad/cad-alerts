import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export const useSettingsStore = defineStore('settings', () => {
  // State
  const organizationKey = ref<string>('')
  const organizationSecret = ref<string>('')

  // Initialize from localStorage
  const initializeFromLocalStorage = () => {
    const savedKey = localStorage.getItem('organizationKey')
    const savedSecret = localStorage.getItem('organizationSecret')

    if (savedKey) {
      organizationKey.value = savedKey
    }
    if (savedSecret) {
      organizationSecret.value = savedSecret
    }
  }

  // Watch for changes and persist to localStorage
  watch(organizationKey, (newValue) => {
    localStorage.setItem('organizationKey', newValue)
  })

  watch(organizationSecret, (newValue) => {
    localStorage.setItem('organizationSecret', newValue)
  })

  // Actions
  const setOrganizationKey = (key: string) => {
    organizationKey.value = key
  }

  const setOrganizationSecret = (secret: string) => {
    organizationSecret.value = secret
  }

  const clearSettings = () => {
    organizationKey.value = ''
    organizationSecret.value = ''
    localStorage.removeItem('organizationKey')
    localStorage.removeItem('organizationSecret')
  }

  // Initialize on store creation
  initializeFromLocalStorage()

  return {
    organizationKey,
    organizationSecret,
    setOrganizationKey,
    setOrganizationSecret,
    clearSettings
  }
})
