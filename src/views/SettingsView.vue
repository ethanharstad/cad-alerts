<template>
  <div class="settings">
    <div class="settings-container">
      <h1>Settings</h1>

      <div class="info-banner">
        <p>
          <strong>Required Configuration:</strong> Both Organization Key and Organization Secret
          must be configured to use the application.
        </p>
      </div>

      <form @submit.prevent="saveSettings" class="settings-form">
        <div class="form-group">
          <label for="organizationKey">Organization Key</label>
          <input
            id="organizationKey"
            v-model="settingsStore.organizationKey"
            type="text"
            placeholder="Enter organization key"
            required
          />
          <p class="help-text">The unique identifier for your organization (e.g., "boone")</p>
        </div>

        <div class="form-group">
          <label for="organizationSecret">Organization Secret</label>
          <input
            id="organizationSecret"
            v-model="settingsStore.organizationSecret"
            type="password"
            placeholder="Enter organization secret"
            required
          />
          <p class="help-text">The access key for your organization</p>
        </div>

        <div class="button-group">
          <button type="submit" class="btn-primary">Save Settings</button>
          <button type="button" @click="clearSettings" class="btn-secondary">Clear Settings</button>
        </div>
      </form>

      <div v-if="message" class="message" :class="messageType">
        {{ message }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'

const settingsStore = useSettingsStore()
const message = ref<string>('')
const messageType = ref<'success' | 'error'>('success')

const saveSettings = () => {
  if (settingsStore.organizationKey && settingsStore.organizationSecret) {
    message.value = 'Settings saved successfully!'
    messageType.value = 'success'
    setTimeout(() => {
      message.value = ''
    }, 3000)
  } else {
    message.value = 'Please fill in all fields'
    messageType.value = 'error'
  }
}

const clearSettings = () => {
  if (confirm('Are you sure you want to clear all settings?')) {
    settingsStore.clearSettings()
    message.value = 'Settings cleared'
    messageType.value = 'success'
    setTimeout(() => {
      message.value = ''
    }, 3000)
  }
}
</script>

<style scoped>
.settings {
  min-height: 100vh;
  padding: 2rem 1rem;
}

.settings-container {
  max-width: 600px;
  margin: 0 auto;
}

h1 {
  margin-bottom: 1rem;
  color: var(--color-heading);
}

.info-banner {
  background: #e7f3ff;
  border: 1px solid #b3d9ff;
  border-radius: 4px;
  padding: 1rem;
  margin-bottom: 1.5rem;
}

.info-banner p {
  margin: 0;
  color: #004085;
  font-size: 0.9rem;
}

.settings-form {
  background: var(--color-background-soft);
  padding: 2rem;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.form-group {
  margin-bottom: 1.5rem;
}

label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 600;
  color: var(--color-text);
}

input {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 1rem;
  background: var(--color-background);
  color: var(--color-text);
  box-sizing: border-box;
}

input:focus {
  outline: none;
  border-color: var(--color-border-hover);
  box-shadow: 0 0 0 3px rgba(64, 158, 255, 0.1);
}

.help-text {
  margin-top: 0.25rem;
  font-size: 0.875rem;
  color: var(--color-text-muted, #666);
}

.button-group {
  display: flex;
  gap: 1rem;
  margin-top: 2rem;
}

button {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
}

.btn-primary {
  background: hsla(160, 100%, 37%, 1);
  color: white;
}

.btn-primary:hover {
  background: hsla(160, 100%, 32%, 1);
}

.btn-secondary {
  background: var(--color-background-mute);
  color: var(--color-text);
  border: 1px solid var(--color-border);
}

.btn-secondary:hover {
  background: var(--color-background-soft);
}

.message {
  margin-top: 1.5rem;
  padding: 1rem;
  border-radius: 4px;
  font-weight: 500;
}

.message.success {
  background: #d4edda;
  color: #155724;
  border: 1px solid #c3e6cb;
}

.message.error {
  background: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
}

@media (min-width: 1024px) {
  .settings {
    display: flex;
    align-items: center;
  }
}

@media (max-width: 640px) {
  .button-group {
    flex-direction: column;
  }

  button {
    width: 100%;
  }
}
</style>
