import { describe, expect, it } from 'vitest'
import { resolveTheme, startTheme } from './theme'

function fakeMedia(matches: boolean) {
  const listeners = new Set<() => void>()
  return {
    matches,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    flip(next: boolean) {
      this.matches = next
      listeners.forEach((fn) => fn())
    },
    get listenerCount() {
      return listeners.size
    },
  }
}

const fakeRoot = () => ({ dataset: {} as Record<string, string> }) as unknown as HTMLElement

describe('resolveTheme', () => {
  it('honours an explicit choice regardless of the system', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('follows the system for "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})

describe('startTheme', () => {
  it('applies the theme to the root immediately', () => {
    const root = fakeRoot()
    startTheme('dark', root, fakeMedia(false) as unknown as MediaQueryList)
    expect(root.dataset.theme).toBe('dark')
  })

  it('tracks the system setting live only while on "system"', () => {
    const root = fakeRoot()
    const media = fakeMedia(false)
    const theme = startTheme('system', root, media as unknown as MediaQueryList)
    expect(root.dataset.theme).toBe('light')

    media.flip(true)
    expect(root.dataset.theme).toBe('dark')

    theme.set('light')
    media.flip(false)
    media.flip(true)
    expect(root.dataset.theme).toBe('light')
  })

  it('stops listening on stop()', () => {
    const media = fakeMedia(false)
    const theme = startTheme('system', fakeRoot(), media as unknown as MediaQueryList)
    expect(media.listenerCount).toBe(1)
    theme.stop()
    expect(media.listenerCount).toBe(0)
  })

  it('falls back to light without matchMedia', () => {
    const root = fakeRoot()
    startTheme('system', root, undefined)
    expect(root.dataset.theme).toBe('light')
  })
})
