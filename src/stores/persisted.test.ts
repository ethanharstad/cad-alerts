import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { persisted } from './persisted'

// Minimal in-memory localStorage stand-in — Vitest runs in a Node environment,
// so there is no DOM `localStorage` global to use.
function fakeLocalStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      map.set(k, v)
    },
    removeItem: (k: string) => {
      map.delete(k)
    },
    clear: () => {
      map.clear()
    },
  }
}

let storage: ReturnType<typeof fakeLocalStorage>

beforeEach(() => {
  storage = fakeLocalStorage()
  vi.stubGlobal('localStorage', storage)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('persisted', () => {
  it('returns the default when the key is absent', () => {
    const value = persisted('missing', 'fallback')
    expect(value.value).toBe('fallback')
  })

  it('reads and parses an existing stored value', () => {
    storage.setItem('refreshInterval', '45')
    const value = persisted('refreshInterval', 30)
    expect(value.value).toBe(45)
  })

  it('persists to localStorage when the value changes', async () => {
    const value = persisted('organizationKey', '')
    value.value = 'boone'
    await nextTick()
    expect(storage.getItem('organizationKey')).toBe(JSON.stringify('boone'))
  })

  it('round-trips numbers and booleans through JSON', async () => {
    const flag = persisted('autoPlayNewAlerts', false)
    flag.value = true
    await nextTick()
    expect(storage.getItem('autoPlayNewAlerts')).toBe('true')
    // A fresh ref reads the stored value back as the correct type.
    expect(persisted('autoPlayNewAlerts', false).value).toBe(true)
  })

  it('falls back to the default when the stored value is unparseable', () => {
    storage.setItem('organizationKey', '{ not json')
    const value = persisted('organizationKey', 'default')
    expect(value.value).toBe('default')
  })
})
