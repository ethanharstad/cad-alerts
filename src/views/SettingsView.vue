<template>
  <main class="page page-narrow settings">
      <h1>Settings</h1>

      <div class="notice notice-info">
        <Info aria-hidden="true" />
        <div class="notice-body">
          <p>
            <strong>Required:</strong> enter the Organization Key and Organization Secret to use
            the dashboard.
          </p>
        </div>
      </div>

      <form @submit.prevent="saveSettings" class="card settings-form">
        <div class="form-group">
          <label class="field-label" for="organizationKey">Organization Key</label>
          <input
            class="input"
            id="organizationKey"
            v-model="settingsStore.organizationKey"
            type="text"
            placeholder="Enter organization key"
            required
          />
          <p class="help-text">The unique identifier for your organization (e.g., "boone")</p>
        </div>

        <div class="form-group">
          <label class="field-label" for="organizationSecret">Organization Secret</label>
          <input
            class="input"
            id="organizationSecret"
            v-model="settingsStore.organizationSecret"
            type="password"
            placeholder="Enter organization secret"
            required
          />
          <p class="help-text">The access key for your organization</p>
        </div>

        <div class="form-group">
          <label class="field-label" for="refreshInterval">Fallback Poll Interval (seconds)</label>
          <input
            class="input"
            id="refreshInterval"
            v-model.number="settingsStore.refreshInterval"
            type="number"
            min="5"
            max="300"
            placeholder="Enter fallback poll interval"
            required
          />
          <p class="help-text">
            Alerts normally arrive over a live connection. If that connection can't be
            established, the dashboard checks for new alerts this often instead
            (minimum 5 seconds, maximum 300 seconds).
          </p>
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

        <div class="form-group">
          <label class="field-label" for="audioOutputDevice">Audio Output</label>
          <template v-if="outputSelectionSupported">
            <div class="tone-row">
              <select
                id="audioOutputDevice"
                class="input"
                :value="settingsStore.audioOutputDeviceId"
                @change="selectOutputDevice(($event.target as HTMLSelectElement).value)"
              >
                <option value="">System default</option>
                <option v-for="device in outputDevices" :key="device.deviceId" :value="device.deviceId">
                  {{ device.label }}
                </option>
                <option v-if="savedDeviceMissing" :value="settingsStore.audioOutputDeviceId">
                  {{ settingsStore.audioOutputDeviceLabel || 'Saved device' }} (not found)
                </option>
              </select>
              <button type="button" class="btn btn-outline" @click="testOutputDevice">
                <Play aria-hidden="true" />
                Test
              </button>
            </div>
            <button
              v-if="outputDevices.length === 0"
              type="button"
              class="link-button"
              @click="findOutputDevices"
            >
              Find output devices
            </button>
            <p v-if="outputDeviceMessage" class="field-error">
              {{ outputDeviceMessage }}
            </p>
            <p class="help-text">
              Optional. Leave on System default to follow this computer's sound settings,
              or pick a device to send alerts there regardless of the system default.
              This applies to this browser only. To list devices, the browser asks for
              microphone access; nothing is recorded. If the device is missing, alerts
              play on the system default.
            </p>
          </template>
          <p v-else class="help-text">
            This browser can't choose an audio output, so alerts play on the system default.
            Change it in this computer's sound settings.
          </p>
        </div>

        <div class="form-group checkbox-group">
          <label class="checkbox-label">
            <input
              id="pagerMonitorEnabled"
              v-model="settingsStore.pagerMonitorEnabled"
              type="checkbox"
              :disabled="!pagerMonitorSupported"
            />
            <span>Cut off pre-alerts when the pager tones out</span>
          </label>
          <p class="help-text">
            Listens to the pager audio wired into this computer (the pager's or receiver's
            audio out, into a line-in or USB sound card). When one of the organization's
            pager tone sets is heard, a pre-alert that is playing stops, and no pre-alert is
            read out for a minute while dispatch is on the air. Needs auto-play on, and tone
            sets in Organization Settings below.
            <template v-if="!pagerMonitorSupported">
              This browser can't listen to an audio input.
            </template>
          </p>
        </div>

        <div v-if="settingsStore.pagerMonitorEnabled" class="form-group">
          <label class="field-label" for="pagerInputDevice">Pager Audio Input</label>
          <select
            id="pagerInputDevice"
            class="input"
            :value="settingsStore.pagerInputDeviceId"
            @change="selectInputDevice(($event.target as HTMLSelectElement).value)"
          >
            <option value="">System default input</option>
            <option v-for="device in inputDevices" :key="device.deviceId" :value="device.deviceId">
              {{ device.label }}
            </option>
            <option v-if="savedInputMissing" :value="settingsStore.pagerInputDeviceId">
              {{ settingsStore.pagerInputDeviceLabel || 'Saved input' }} (not found)
            </option>
          </select>
          <button
            v-if="inputDevices.length === 0"
            type="button"
            class="link-button"
            @click="findInputDevices"
          >
            Find input devices
          </button>
          <p v-if="inputDeviceMessage" class="field-error">
            {{ inputDeviceMessage }}
          </p>
          <p class="help-text">
            The input the pager audio is plugged into. Use a direct line feed rather than a
            microphone near the PA, so the dashboard's own alerts never reach it. To check
            it, use Test Listening under Pager Tone Sets below.
          </p>
        </div>

        <div class="form-group">
          <label class="field-label" for="theme">Display Theme</label>
          <select id="theme" v-model="settingsStore.theme" class="input">
            <option v-for="option in THEME_OPTIONS" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
          <p class="help-text">
            Dark is easier on the eyes in a dim bay or at night. Applies to this browser only.
          </p>
        </div>

        <div class="button-group">
          <button type="submit" class="btn btn-primary" :disabled="saving">
            {{ saving ? 'Verifying…' : 'Save Settings' }}
          </button>
          <button type="button" @click="clearSettings" class="btn btn-outline">Clear Settings</button>
        </div>
      </form>

      <div
        v-if="message"
        class="notice"
        :class="messageType === 'error' ? 'notice-danger' : 'notice-success'"
        role="status"
      >
        <component :is="messageType === 'error' ? CircleAlert : CircleCheck" aria-hidden="true" />
        <div class="notice-body"><p>{{ message }}</p></div>
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

        <form v-if="hasCredentials" @submit.prevent="saveOrgSettings" class="card settings-form">
          <div class="form-group">
            <label class="field-label" for="defaultCity">Default City</label>
            <input
              class="input"
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
            <label class="field-label" for="defaultState">Default State</label>
            <input
              class="input"
              id="defaultState"
              v-model="defaultState"
              type="text"
              placeholder="e.g. IA"
            />
            <p class="help-text">Paired with the default city for address disambiguation.</p>
          </div>

          <div class="form-group">
            <label class="field-label" for="actionableWindow">Actionable Window (minutes)</label>
            <input
              class="input"
              id="actionableWindow"
              v-model="actionableWindow"
              type="number"
              :min="MIN_ACTIONABLE_WINDOW_MINUTES"
              :max="MAX_ACTIONABLE_WINDOW_MINUTES"
              :placeholder="`Default: ${DEFAULT_ACTIONABLE_WINDOW_MINUTES}`"
            />
            <p class="help-text">
              How recent a call must be for a dashboard to read it out loud. Older
              alerts still appear in the list but are not announced — the crew has
              already responded, and speaking them talks over whatever is happening
              now. Leave blank to use the default of
              {{ DEFAULT_ACTIONABLE_WINDOW_MINUTES }} minutes
              ({{ MIN_ACTIONABLE_WINDOW_MINUTES }}–{{ MAX_ACTIONABLE_WINDOW_MINUTES }}
              minutes).
            </p>
          </div>

          <div class="form-group">
            <label class="field-label" for="alertTone">Alert Tone</label>
            <div class="tone-row">
              <select id="alertTone" v-model="alertTone" class="input">
                <option value="">None</option>
                <option v-for="tone in ALERT_TONES" :key="tone.id" :value="tone.id">
                  {{ tone.label }}
                </option>
              </select>
              <button
                type="button"
                class="btn btn-outline"
                :disabled="!alertTone"
                @click="previewTone(alertTone)"
              >
                <Play aria-hidden="true" />
                Preview
              </button>
            </div>
            <p class="help-text">Played before each alert is read out.</p>
          </div>

          <fieldset class="form-group quiet-hours">
            <legend class="field-label">Quiet Hours</legend>
            <div class="time-row">
              <div>
                <label class="field-label" for="quietStart">Start</label>
                <input id="quietStart" v-model="quietStart" class="input" type="time" />
              </div>
              <div>
                <label class="field-label" for="quietEnd">End</label>
                <input id="quietEnd" v-model="quietEnd" class="input" type="time" />
              </div>
            </div>

            <label class="field-label" for="quietAlertTone">Quiet Hours Tone</label>
            <div class="tone-row">
              <select id="quietAlertTone" v-model="quietAlertTone" class="input" :disabled="!quietHoursSet">
                <option value="">None</option>
                <option v-for="tone in ALERT_TONES" :key="tone.id" :value="tone.id">
                  {{ tone.label }}
                </option>
              </select>
              <button
                type="button"
                class="btn btn-outline"
                :disabled="!quietAlertTone || !quietHoursSet"
                @click="previewTone(quietAlertTone)"
              >
                <Play aria-hidden="true" />
                Preview
              </button>
            </div>
            <p class="help-text">
              During quiet hours this tone plays instead of the alert tone above;
              choose None to play no tone at all. Times follow each dashboard's own
              clock, and a window that ends before it starts (e.g. 22:00–06:00)
              runs overnight. Leave both times blank for no quiet hours.
            </p>
            <button
              v-if="quietStart || quietEnd"
              type="button"
              class="link-button"
              @click="clearQuietHours"
            >
              Clear quiet hours
            </button>
          </fieldset>

          <div class="form-group">
            <label class="field-label" for="allowedSenders">Allowed Pre-Alert Senders</label>
            <textarea
              id="allowedSenders"
              v-model="allowedSenders"
              rows="3"
              class="input template-input"
              :aria-invalid="invalidSenders.length > 0"
              placeholder="e.g. cad@county.gov&#10;@dispatch.county.gov"
            ></textarea>
            <p v-if="invalidSenders.length > 0" class="field-error">
              Not an address or @domain: {{ invalidSenders.join(', ') }}
            </p>
            <div v-else-if="senderCount === 0" class="notice notice-warning sender-warning" role="alert">
              <TriangleAlert aria-hidden="true" />
              <div class="notice-body">
                <p>
                  No senders configured — anyone who learns this organization's intake
                  address can trigger an alert on its dashboards. Add your CAD system's
                  sending address or domain.
                </p>
              </div>
            </div>
            <p class="help-text">
              One per line: an exact address (<code>cad@county.gov</code>) or a whole
              domain (<code>@county.gov</code>; subdomains must be listed separately).
              Pre-alerts from anyone else are rejected. Leave blank to accept all
              senders.
            </p>
          </div>

          <div class="form-group">
            <label class="field-label" for="pagerToneSets">Pager Tone Sets</label>
            <textarea
              id="pagerToneSets"
              v-model="pagerToneSets"
              rows="3"
              class="input template-input"
              :aria-invalid="pagerToneErrors.length > 0"
              placeholder="e.g. 330.5 569.1 Station 1&#10;1092.4 832.5 All call"
            ></textarea>
            <p v-for="err in pagerToneErrors" :key="err" class="field-error">
              {{ err }}
            </p>
            <p class="help-text">
              The two-tone pages dispatch sends this department, one per line: tone A and
              tone B in Hz, then an optional name (<code>330.5 569.1 Station 1</code>). List
              each page that should cut a pre-alert off — your own, all-calls, mutual-aid
              groups. Other agencies' tones on the same channel are ignored. Tones must match
              within about 1.5%. Leave blank to turn the cut-off off.
            </p>

            <div class="pager-test">
              <button
                type="button"
                class="btn btn-outline"
                :disabled="!pagerMonitorSupported || (!pagerTest && parsedPagerTones.sets.length === 0)"
                @click="togglePagerTest"
              >
                <component :is="pagerTest ? Square : Headphones" aria-hidden="true" />
                {{ pagerTest ? 'Stop listening' : 'Test listening' }}
              </button>
              <template v-if="pagerTest">
                <span class="pager-test-status">{{ pagerTestStatus }}</span>
                <meter
                  class="pager-level"
                  min="-60"
                  max="0"
                  low="-40"
                  high="-6"
                  optimum="-20"
                  :value="pagerLevel"
                  :title="`${Math.round(pagerLevel)} dBFS`"
                ></meter>
              </template>
            </div>
            <ul v-if="pagerTestLog.length > 0" class="pager-test-log">
              <li v-for="(entry, i) in pagerTestLog" :key="i">{{ entry }}</li>
            </ul>
            <p class="help-text">
              Test listening uses this browser's pager audio input and the tone sets as typed
              above (saved or not). Have dispatch send a test page, or play the tones into the
              input: each configured tone heard is listed, and a full page shows as a match.
              Aim for a level mostly in the green while audio is playing.
            </p>
          </div>

          <div class="form-group">
            <label class="field-label" for="ttsTemplate">Text-to-Speech Template</label>
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
              class="input template-input"
              :aria-invalid="!templateValidation.valid"
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

            <p v-if="!templateValidation.valid" class="field-error">
              Unknown token(s): {{ templateValidation.unknownTokens.join(', ') }}
            </p>

            <button type="button" class="link-button" @click="resetTemplate">
              Reset to default template
            </button>
          </div>

          <div class="button-group">
            <button
              type="submit"
              class="btn btn-primary"
              :disabled="orgSaving || !templateValidation.valid || invalidSenders.length > 0 || pagerToneErrors.length > 0"
            >
              {{ orgSaving ? 'Saving…' : 'Save Organization Settings' }}
            </button>
          </div>
        </form>

        <div
          v-if="orgMessage"
          class="notice"
          :class="orgMessageType === 'error' ? 'notice-danger' : 'notice-success'"
          role="status"
        >
          <component :is="orgMessageType === 'error' ? CircleAlert : CircleCheck" aria-hidden="true" />
          <div class="notice-body"><p>{{ orgMessage }}</p></div>
        </div>
      </div>
  </main>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import {
  CircleAlert,
  CircleCheck,
  Headphones,
  Info,
  Play,
  Square,
  TriangleAlert,
} from 'lucide-vue-next'
import { THEME_OPTIONS } from '@/theme/theme'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '@/stores/settings'
import { getOrganization, updateOrganizationSettings, ApiError } from '@/api/client'
import type { PublicOrganization } from '../../shared/types'
import {
  TTS_TOKENS,
  DEFAULT_TTS_TEMPLATE,
  parseTemplate,
  validateTemplate,
} from '../../shared/ttsTemplate'
import {
  isValidActionableWindow,
  DEFAULT_ACTIONABLE_WINDOW_MINUTES,
  MIN_ACTIONABLE_WINDOW_MINUTES,
  MAX_ACTIONABLE_WINDOW_MINUTES,
} from '../../shared/actionableWindow'
import {
  ALERT_TONES,
  findTone,
  parseTimeOfDay,
  formatTimeOfDay,
} from '../../shared/alertTones'
import {
  parseAllowedSenders,
  invalidSenderEntries,
  formatAllowedSenders,
  MAX_ALLOWED_SENDERS,
} from '../../shared/senders'
import {
  parsePagerToneSets,
  formatPagerToneSets,
  describePagerToneSet,
  MAX_PAGER_TONE_SETS,
} from '../../shared/pagerTones'
import { playClip } from '@/audio/play'
import {
  startPagerMonitor,
  supportsPagerMonitor,
  type PagerMonitor,
  type PagerMonitorStatus,
} from '@/audio/pagerMonitor'
import {
  supportsOutputSelection,
  listOutputDevices,
  listDevices,
} from '@/audio/outputDevice'
import { useDevicePicker } from '@/audio/useDevicePicker'

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
    message.value = 'Fallback poll interval must be between 5 and 300 seconds'
    messageType.value = 'error'
    return
  }

  // Verify the credentials against the server before treating them as saved.
  saving.value = true
  message.value = ''
  try {
    const org = await getOrganization(
      settingsStore.organizationKey,
      settingsStore.organizationSecret,
    )
    message.value = 'Settings verified and saved successfully!'
    messageType.value = 'success'
    setTimeout(() => {
      message.value = ''
    }, 3000)
    // Credentials are good — reuse this verification response to populate the
    // Organization Settings section, but only when it belongs to a different org
    // than the one already shown, so unsaved edits are not overwritten.
    if (loadedKey.value !== org.org_key) {
      applyOrg(org)
    }
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

// ---- Audio output (this browser only) ----

const outputSelectionSupported = supportsOutputSelection()
const {
  audioOutputDeviceId,
  audioOutputDeviceLabel,
  pagerInputDeviceId,
  pagerInputDeviceLabel,
} = storeToRefs(settingsStore)

const {
  devices: outputDevices,
  message: outputDeviceMessage,
  savedMissing: savedDeviceMissing,
  refresh: refreshOutputDevices,
  find: findOutputDevices,
  select: selectOutputDevice,
} = useDevicePicker({
  list: listOutputDevices,
  deviceId: audioOutputDeviceId,
  label: audioOutputDeviceLabel,
  deniedMessage:
    'The browser did not allow access, so devices cannot be listed. Alerts will use the system default.',
  emptyMessage: 'No selectable output devices were found.',
})

const testOutputDevice = () => {
  outputDeviceMessage.value = ''
  void playClip(ALERT_TONES[0]!.url, {
    deviceId: settingsStore.audioOutputDeviceId,
    onDeviceUnavailable: () => {
      outputDeviceMessage.value =
        'The chosen device is unavailable, so the test played on the system default.'
    },
  })
}

// ---- Pager audio input (this browser only) ----

const pagerMonitorSupported = supportsPagerMonitor()
const {
  devices: inputDevices,
  message: inputDeviceMessage,
  savedMissing: savedInputMissing,
  refresh: refreshInputDevices,
  find: findInputDevices,
  select: selectInputDevice,
} = useDevicePicker({
  list: () => listDevices('audioinput', 'Input'),
  deviceId: pagerInputDeviceId,
  label: pagerInputDeviceLabel,
  deniedMessage:
    'The browser did not allow microphone access, so the pager audio cannot be heard.',
  emptyMessage: 'No audio inputs were found.',
})

// ---- Organization Settings (server-side, per-organization) ----
// These live on the organization row, unlike the device settings above which
// are local to this browser. They are loaded from and saved to the API.

const defaultCity = ref<string>('')
const defaultState = ref<string>('')
const ttsTemplate = ref<string>('')
// Held as the raw input string so blank stays distinguishable from a number —
// blank means "no organization value, use the default".
const actionableWindow = ref<string>('')
// Tone ids, with '' standing for "no tone" so they bind straight to a <select>.
const alertTone = ref<string>('')
const quietAlertTone = ref<string>('')
// Quiet hours as `HH:MM` strings from <input type="time">; '' is unset.
const quietStart = ref<string>('')
const quietEnd = ref<string>('')

// The sender allowlist as typed, one entry per line.
const allowedSenders = ref<string>('')
const parsedSenders = computed(() => parseAllowedSenders(allowedSenders.value))
const invalidSenders = computed(() => invalidSenderEntries(parsedSenders.value))
const senderCount = computed(() => parsedSenders.value.length)

const quietHoursSet = computed(() => !!quietStart.value && !!quietEnd.value)

// Pager tone sets as typed, one `A B [name]` per line.
const pagerToneSets = ref<string>('')
const parsedPagerTones = computed(() => parsePagerToneSets(pagerToneSets.value))
const pagerToneErrors = computed(() => {
  const { sets, errors } = parsedPagerTones.value
  return sets.length > MAX_PAGER_TONE_SETS
    ? [...errors, `List at most ${MAX_PAGER_TONE_SETS} tone sets`]
    : errors
})

// ---- Test listening: run the pager monitor here, against the typed sets ----

const pagerTest = ref<PagerMonitor | null>(null)
const pagerTestState = ref<PagerMonitorStatus>('starting')
const pagerTestDetail = ref<string>('')
const pagerLevel = ref<number>(-60)
const pagerTestLog = ref<string[]>([])

const pagerTestStatus = computed(() => {
  switch (pagerTestState.value) {
    case 'listening':
      return 'Listening…'
    case 'suspended':
      return 'Waiting for the browser — click anywhere'
    case 'unavailable':
      return pagerTestDetail.value || 'Input unavailable'
    case 'starting':
      return 'Starting…'
    default:
      return ''
  }
})

const logPagerTest = (entry: string) => {
  const time = new Date().toLocaleTimeString()
  pagerTestLog.value = [`${time} — ${entry}`, ...pagerTestLog.value].slice(0, 12)
}

const stopPagerTest = () => {
  pagerTest.value?.stop()
  pagerTest.value = null
}

const togglePagerTest = () => {
  if (pagerTest.value) {
    stopPagerTest()
    return
  }
  pagerTestLog.value = []
  pagerLevel.value = -60
  // The handle comes back at once, so a second click or leaving the page always
  // stops it — even while the input is still opening.
  pagerTest.value = startPagerMonitor({
    deviceId: settingsStore.pagerInputDeviceId,
    deviceLabel: settingsStore.pagerInputDeviceLabel,
    onDeviceIdChange: id => {
      settingsStore.pagerInputDeviceId = id
    },
    sets: parsedPagerTones.value.sets,
    onMatch: set => logPagerTest(`Page matched: ${describePagerToneSet(set)}`),
    onTone: hz => logPagerTest(`Tone heard: ${hz} Hz`),
    onStatus: (status, detail) => {
      pagerTestState.value = status
      pagerTestDetail.value = detail ?? ''
      // Opening the input is what reveals device labels; refresh the list now.
      if (status === 'listening' || status === 'suspended') void refreshInputDevices()
    },
    onLevel: dbfs => {
      pagerLevel.value = Math.max(-60, dbfs)
    },
  })
  pagerTestState.value = pagerTest.value.status
}

// The test's audio processing may wait for a gesture, like any page audio.
const resumePagerTest = () => {
  if (pagerTestState.value === 'suspended') void pagerTest.value?.resume()
}

const previewTone = (id: string) => {
  const tone = findTone(id)
  if (tone) void playClip(tone.url)
}

const clearQuietHours = () => {
  quietStart.value = ''
  quietEnd.value = ''
}

const orgLoading = ref<boolean>(false)
// The organization key whose settings currently populate the fields below, so we
// only pull fresh values on first load or when the key changes — never clobbering
// the user's unsaved edits on a same-org refresh.
const loadedKey = ref<string | null>(null)
const orgSaving = ref<boolean>(false)
const orgMessage = ref<string>('')
const orgMessageType = ref<'success' | 'error'>('success')

const templateEditor = ref<HTMLTextAreaElement | null>(null)

// Live segmentation of the template for token highlighting in the editor.
const templateSegments = computed(() => parseTemplate(ttsTemplate.value))
const templateValidation = computed(() => validateTemplate(ttsTemplate.value))

// Populate the editable fields from a fetched org and record which key they
// belong to. Callers decide *when* to apply so unsaved edits are not clobbered.
const applyOrg = (org: PublicOrganization) => {
  defaultCity.value = org.default_city ?? ''
  defaultState.value = org.default_state ?? ''
  ttsTemplate.value = org.tts_template ?? ''
  actionableWindow.value =
    org.actionable_window_minutes == null ? '' : String(org.actionable_window_minutes)
  alertTone.value = org.alert_tone ?? ''
  quietAlertTone.value = org.quiet_alert_tone ?? ''
  quietStart.value = org.quiet_hours_start == null ? '' : formatTimeOfDay(org.quiet_hours_start)
  quietEnd.value = org.quiet_hours_end == null ? '' : formatTimeOfDay(org.quiet_hours_end)
  allowedSenders.value = org.allowed_senders ?? ''
  pagerToneSets.value = org.pager_tone_sets ?? ''
  loadedKey.value = org.org_key
}

const loadOrgSettings = async () => {
  if (!hasCredentials.value) return
  orgLoading.value = true
  orgMessage.value = ''
  try {
    applyOrg(
      await getOrganization(settingsStore.organizationKey, settingsStore.organizationSecret),
    )
  } catch {
    // Leave loadedKey unset; the section still renders empty fields to edit.
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

  // Blank clears the organization's window; anything else must pass the same
  // check the API applies, so a bad value is caught before the round trip.
  const trimmedWindow = actionableWindow.value.trim()
  const windowMinutes = trimmedWindow === '' ? null : Number(trimmedWindow)
  if (windowMinutes !== null && !isValidActionableWindow(windowMinutes)) {
    orgMessage.value = `Actionable window must be a whole number between ${MIN_ACTIONABLE_WINDOW_MINUTES} and ${MAX_ACTIONABLE_WINDOW_MINUTES} minutes`
    orgMessageType.value = 'error'
    return
  }

  // Quiet hours are both-or-neither, and a zero-length window would never apply.
  const quietStartMinutes = quietStart.value ? parseTimeOfDay(quietStart.value) : null
  const quietEndMinutes = quietEnd.value ? parseTimeOfDay(quietEnd.value) : null
  if ((quietStartMinutes === null) !== (quietEndMinutes === null)) {
    orgMessage.value = 'Set both a start and an end for quiet hours, or leave both blank'
    orgMessageType.value = 'error'
    return
  }
  if (quietStartMinutes !== null && quietStartMinutes === quietEndMinutes) {
    orgMessage.value = 'Quiet hours must start and end at different times'
    orgMessageType.value = 'error'
    return
  }
  const quietHoursOn = quietStartMinutes !== null

  if (invalidSenders.value.length > 0) {
    orgMessage.value = `Not an address or @domain: ${invalidSenders.value.join(', ')}`
    orgMessageType.value = 'error'
    return
  }
  if (parsedSenders.value.length > MAX_ALLOWED_SENDERS) {
    orgMessage.value = `List at most ${MAX_ALLOWED_SENDERS} allowed senders`
    orgMessageType.value = 'error'
    return
  }

  if (pagerToneErrors.value.length > 0) {
    orgMessage.value = `Pager tone sets: ${pagerToneErrors.value.join('; ')}`
    orgMessageType.value = 'error'
    return
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
        actionable_window_minutes: windowMinutes,
        alert_tone: alertTone.value || null,
        // A quiet tone without quiet hours would never play, so drop it.
        quiet_alert_tone: quietHoursOn ? quietAlertTone.value || null : null,
        quiet_hours_start: quietStartMinutes,
        quiet_hours_end: quietEndMinutes,
        allowed_senders: formatAllowedSenders(parsedSenders.value),
        pager_tone_sets: formatPagerToneSets(parsedPagerTones.value.sets),
      },
    )
    applyOrg(org)
    orgMessage.value = 'Organization settings saved!'
    orgMessageType.value = 'success'
    setTimeout(() => {
      orgMessage.value = ''
    }, 3000)
  } catch (err) {
    if (err instanceof ApiError && err.status === 400) {
      orgMessage.value = 'The server rejected these settings — check the values'
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
  if (outputSelectionSupported) void refreshOutputDevices()
  if (pagerMonitorSupported) void refreshInputDevices()
  document.addEventListener('pointerdown', resumePagerTest)
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', resumePagerTest)
  stopPagerTest()
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
.settings > * + * {
  margin-top: var(--space-6);
}

.settings-form > .form-group + .form-group,
.settings-form > .form-group + .button-group {
  margin-top: var(--space-6);
}

.org-settings > * + * {
  margin-top: var(--space-4);
}

.section-note {
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.org-settings h2 + .section-note {
  margin-top: var(--space-1);
}

.tone-row {
  display: flex;
  gap: var(--space-2);
}

.tone-row select {
  flex: 1;
  min-width: 0;
}

.quiet-hours {
  padding: var(--space-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}

.quiet-hours legend {
  padding: 0 var(--space-1);
}

.time-row {
  display: flex;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
}

.time-row > div {
  flex: 1;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  color: var(--text-primary);
  font-weight: 600;
  cursor: pointer;
  user-select: none;
}

.checkbox-label:has(input:disabled) {
  color: var(--text-tertiary);
  cursor: default;
}

.button-group {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.form-group > .link-button {
  margin-top: var(--space-3);
}

.sender-warning {
  margin-top: var(--space-2);
}

.token-palette {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: var(--space-2) 0 var(--space-3);
}

.token-chip {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border-input);
  border-radius: var(--radius-full);
  background: var(--bg-page);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-out);
}

.token-chip:hover {
  border-color: var(--focus-ring);
}

.template-preview {
  min-height: 2.5rem;
  margin-top: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: 1px dashed var(--border-input);
  border-radius: var(--radius-md);
  background: var(--bg-page);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  white-space: pre-wrap;
  word-break: break-word;
}

.seg-token {
  padding: 0 2px;
  border-radius: var(--radius-sm);
  font-weight: 500;
}

.seg-known {
  background: var(--success-surface);
  color: var(--success-fg);
}

.seg-unknown {
  background: var(--danger-surface);
  color: var(--danger-fg);
  text-decoration: underline wavy;
}

.pager-test {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-3);
}

.pager-test-status {
  font-size: var(--text-sm);
}

.pager-level {
  flex: 1;
  min-width: 8rem;
  height: var(--space-4);
}

.pager-test-log {
  margin-top: var(--space-2);
  padding-left: var(--space-5);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

@media (max-width: 640px) {
  .button-group .btn {
    width: 100%;
  }
}
</style>
