import '@scene-ready/design-system/tokens.css'
import './assets/main.css'

import { createApp, watch } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useSettingsStore } from './stores/settings'
import { startTheme } from './theme/theme'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)

// Set the theme before the first render so the page never flashes the wrong one.
const settingsStore = useSettingsStore(pinia)
const theme = startTheme(settingsStore.theme)
watch(() => settingsStore.theme, (preference) => theme.set(preference))

app.mount('#app')
