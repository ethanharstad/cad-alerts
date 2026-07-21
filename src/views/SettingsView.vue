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

        <div class="form-group">
          <label for="refreshInterval">Refresh Interval (seconds)</label>
          <input
            id="refreshInterval"
            v-model.number="settingsStore.refreshInterval"
            type="number"
            min="5"
            max="300"
            placeholder="Enter refresh interval"
            required
          />
          <p class="help-text">How often to check for new alerts (minimum 5 seconds, maximum 300 seconds)</p>
        </div>

        <div class="form-group checkbox-group">
          <label class="checkbox-label">
            <input
              id="autoPlayNewAlerts"
              v-model="settingsStore.autoPlayNewAlerts"
              type="checkbox"
            />
            <span>Auto-play new alerts</span>
          </label>
          <p class="help-text">Automatically play audio for the newest alert when it arrives</p>
        </div>

        <div class="button-group">
          <button type="submit" class="btn-primary" :disabled="saving">
            {{ saving ? 'Verifying…' : 'Save Settings' }}
          </button>
          <button type="button" @click="clearSettings" class="btn-secondary">Clear Settings</button>
        </div>
      </form>

      <div v-if="message" class="message" :class="messageType">
        {{ message }}
      </div>

      <div class="org-settings">
        <h2>Organization Settings</h2>
        <p class="section-note">
          These settings are stored on the organization and shared by everyone using it.
        </p>

        <p v-if="!hasCredentials" class="help-text">
          Save a valid Organization Key and Secret above to load and edit these settings.
        </p>
        <p v-else-if="orgLoading" class="help-text">Loading organization settings…</p>

        <form v-if="hasCredentials" @submit.prevent="saveOrgSettings" class="settings-form">
          <div class="form-group">
            <label for="defaultCity">Default City</label>
            <input
              id="defaultCity"
              v-model="defaultCity"
              type="text"
              placeholder="e.g. Boone"
            />
            <p class="help-text">
              Used to disambiguate addresses when mapping is added later.
            </p>
          </div>

          <div class="form-group">
            <label for="defaultState">Default State</label>
            <input
              id="defaultState"
              v-model="defaultState"
              type="text"
              placeholder="e.g. IA"
            />
            <p class="help-text">Paired with the default city for address disambiguation.</p>
          </div>

          <div class="form-group">
            <label for="ttsTemplate">Text-to-Speech Template</label>
            <p class="help-text">
              Click a token to insert it, and add your own text around it. Write
              <code v-pre>{address}</code> twice to have the address spoken twice. Periods
              separate spoken sentences.
            </p>

            <div class="token-palette">
              <button
                v-for="token in TTS_TOKENS"
                :key="token.name"
                type="button"
                class="token-chip"
                :title="token.description"
                @click="insertToken(token.name)"
              >
                {{ '{' + token.name + '}' }}
              </button>
            </div>

            <textarea
              id="ttsTemplate"
              ref="templateEditor"
              v-model="ttsTemplate"
              rows="3"
              class="template-input"
              placeholder="e.g. {nature}. {address}. {address}. in {city}."
            ></textarea>

            <div class="template-preview" aria-hidden="true">
              <template v-for="(segment, i) in templateSegments" :key="i">
                <span v-if="segment.type === 'text'" class="seg-text">{{ segment.value }}</span>
                <span
                  v-else
                  class="seg-token"
                  :class="segment.known ? 'seg-known' : 'seg-unknown'"
                  :title="segment.known ? 'Recognized token' : 'Unknown token'"
                  >{{ '{' + segment.name + '}' }}</span
                >
              </template>
            </div>

            <p v-if="!templateValidation.valid" class="help-text template-error">
              Unknown token(s): {{ templateValidation.unknownTokens.join(', ') }}
            </p>

            <button type="button" class="link-button" @click="resetTemplate">
              Reset to default template
            </button>
          </div>

          <div class="button-group">
            <button
              type="submit"
              class="btn-primary"
              :disabled="orgSaving || !templateValidation.valid"
            >
              {{ orgSaving ? 'Saving…' : 'Save Organization Settings' }}
            </button>
          </div>
        </form>

        <div v-if="orgMessage" class="message" :class="orgMessageType">
          {{ orgMessage }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { getOrganization, updateOrganizationSettings, ApiError } from '@/api/client'
import {
  TTS_TOKENS,
  DEFAULT_TTS_TEMPLATE,
  parseTemplate,
  validateTemplate,
} from '../../shared/ttsTemplate'

const settingsStore = useSettingsStore()
const message = ref<string>('')
const messageType = ref<'success' | 'error'>('success')
const saving = ref<boolean>(false)

const hasCredentials = computed(
  () => !!settingsStore.organizationKey && !!settingsStore.organizationSecret,
)

const saveSettings = async () => {
  if (!settingsStore.organizationKey || !settingsStore.organizationSecret) {
    message.value = 'Please fill in all required fields'
    messageType.value = 'error'
    return
  }
  if (settingsStore.refreshInterval < 5 || settingsStore.refreshInterval > 300) {
    message.value = 'Refresh interval must be between 5 and 300 seconds'
    messageType.value = 'error'
    return
  }

  // Verify the credentials against the server before treating them as saved.
  saving.value = true
  message.value = ''
  try {
    await getOrganization(settingsStore.organizationKey, settingsStore.organizationSecret)
    message.value = 'Settings verified and saved successfully!'
    messageType.value = 'success'
    setTimeout(() => {
      message.value = ''
    }, 3000)
    // Credentials are good — pull this org's server-side settings so the
    // Organization Settings section below reflects what is stored.
    void loadOrgSettings()
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      message.value = 'Invalid Organization Secret for this key'
    } else if (err instanceof ApiError && err.status === 404) {
      message.value = 'Organization not found for this key'
    } else {
      message.value = 'Could not verify settings — please try again'
    }
    messageType.value = 'error'
  } finally {
    saving.value = false
  }
}

// ---- Organization Settings (server-side, per-organization) ----
// These live on the organization row, unlike the device settings above which
// are local to this browser. They are loaded from and saved to the API.

const defaultCity = ref<string>('')
const defaultState = ref<string>('')
const ttsTemplate = ref<string>('')

const orgLoading = ref<boolean>(false)
const orgLoaded = ref<boolean>(false)
const orgSaving = ref<boolean>(false)
const orgMessage = ref<string>('')
const orgMessageType = ref<'success' | 'error'>('success')

const templateEditor = ref<HTMLTextAreaElement | null>(null)

// Live segmentation of the template for token highlighting in the editor.
const templateSegments = computed(() => parseTemplate(ttsTemplate.value))
const templateValidation = computed(() => validateTemplate(ttsTemplate.value))

const loadOrgSettings = async () => {
  if (!hasCredentials.value) return
  orgLoading.value = true
  orgMessage.value = ''
  try {
    const org = await getOrganization(
      settingsStore.organizationKey,
      settingsStore.organizationSecret,
    )
    defaultCity.value = org.default_city ?? ''
    defaultState.value = org.default_state ?? ''
    ttsTemplate.value = org.tts_template ?? ''
    orgLoaded.value = true
  } catch {
    // Leave orgLoaded false; the section shows a hint to configure credentials.
    orgLoaded.value = false
  } finally {
    orgLoading.value = false
  }
}

// Insert a token at the cursor (or append) and keep focus in the editor.
const insertToken = (name: string) => {
  const token = `{${name}}`
  const el = templateEditor.value
  if (!el) {
    ttsTemplate.value += token
    return
  }
  const start = el.selectionStart ?? ttsTemplate.value.length
  const end = el.selectionEnd ?? ttsTemplate.value.length
  ttsTemplate.value = ttsTemplate.value.slice(0, start) + token + ttsTemplate.value.slice(end)
  // Restore the caret after the inserted token on the next tick.
  requestAnimationFrame(() => {
    el.focus()
    const caret = start + token.length
    el.setSelectionRange(caret, caret)
  })
}

const resetTemplate = () => {
  ttsTemplate.value = DEFAULT_TTS_TEMPLATE
}

const saveOrgSettings = async () => {
  if (!hasCredentials.value) {
    orgMessage.value = 'Configure and save your organization credentials first'
    orgMessageType.value = 'error'
    return
  }
  const trimmedTemplate = ttsTemplate.value.trim()
  if (trimmedTemplate) {
    const { valid, unknownTokens } = validateTemplate(trimmedTemplate)
    if (!valid) {
      orgMessage.value = `Unknown token(s): ${unknownTokens.join(', ')}`
      orgMessageType.value = 'error'
      return
    }
  }

  orgSaving.value = true
  orgMessage.value = ''
  try {
    const org = await updateOrganizationSettings(
      settingsStore.organizationKey,
      settingsStore.organizationSecret,
      {
        default_city: defaultCity.value.trim() || null,
        default_state: defaultState.value.trim() || null,
        tts_template: trimmedTemplate || null,
      },
    )
    defaultCity.value = org.default_city ?? ''
    defaultState.value = org.default_state ?? ''
    ttsTemplate.value = org.tts_template ?? ''
    orgMessage.value = 'Organization settings saved!'
    orgMessageType.value = 'success'
    setTimeout(() => {
      orgMessage.value = ''
    }, 3000)
  } catch (err) {
    if (err instanceof ApiError && err.status === 400) {
      orgMessage.value = 'The server rejected the template — check the tokens'
    } else if (err instanceof ApiError && (err.status === 401 || err.status === 404)) {
      orgMessage.value = 'Could not authenticate — check your organization credentials'
    } else {
      orgMessage.value = 'Could not save organization settings — please try again'
    }
    orgMessageType.value = 'error'
  } finally {
    orgSaving.value = false
  }
}

onMounted(() => {
  void loadOrgSettings()
})

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

.checkbox-group {
  margin-bottom: 1.5rem;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-weight: 600;
  color: var(--color-text);
}

.checkbox-label input[type="checkbox"] {
  width: auto;
  height: 1.25rem;
  cursor: pointer;
  margin: 0;
}

.checkbox-label span {
  user-select: none;
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

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
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

.org-settings {
  margin-top: 2.5rem;
}

.org-settings h2 {
  margin-bottom: 0.25rem;
  color: var(--color-heading);
}

.section-note {
  margin: 0 0 1.5rem;
  font-size: 0.9rem;
  color: var(--color-text-muted, #666);
}

textarea.template-input {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-family: inherit;
  font-size: 1rem;
  background: var(--color-background);
  color: var(--color-text);
  box-sizing: border-box;
  resize: vertical;
}

textarea.template-input:focus {
  outline: none;
  border-color: var(--color-border-hover);
  box-shadow: 0 0 0 3px rgba(64, 158, 255, 0.1);
}

.token-palette {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.token-chip {
  padding: 0.35rem 0.6rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-background-mute);
  color: var(--color-text);
  font-family: monospace;
  font-size: 0.85rem;
  cursor: pointer;
}

.token-chip:hover {
  border-color: var(--color-border-hover);
}

.template-preview {
  margin-top: 0.5rem;
  padding: 0.6rem 0.75rem;
  border: 1px dashed var(--color-border);
  border-radius: 4px;
  background: var(--color-background);
  font-family: monospace;
  font-size: 0.9rem;
  white-space: pre-wrap;
  word-break: break-word;
  min-height: 1.5rem;
}

.seg-text {
  color: var(--color-text);
}

.seg-token {
  border-radius: 3px;
  padding: 0 0.15rem;
  font-weight: 600;
}

.seg-known {
  background: #d4edda;
  color: #155724;
}

.seg-unknown {
  background: #f8d7da;
  color: #721c24;
}

.template-error {
  color: #721c24;
}

.link-button {
  margin-top: 0.75rem;
  padding: 0;
  background: none;
  border: none;
  color: hsla(160, 100%, 37%, 1);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  text-decoration: underline;
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
