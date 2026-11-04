/**
 * Light/dark theme for the Scene Ready tokens, which flip their semantic aliases
 * when `data-theme="dark"` is set on an ancestor. The preference is per browser
 * (a dashboard in a dark apparatus bay wants dark regardless of the computer's
 * setting); 'system' follows `prefers-color-scheme` and tracks it live.
 */

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'Match this computer' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

const DARK_QUERY = '(prefers-color-scheme: dark)'

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') return preference
  return systemDark ? 'dark' : 'light'
}

export interface ThemeController {
  set(preference: ThemePreference): void
  stop(): void
}

/**
 * Apply `preference` to `root` now, and keep a 'system' preference in step with
 * the OS setting until `stop()`.
 */
export function startTheme(
  preference: ThemePreference,
  root: HTMLElement = document.documentElement,
  media: MediaQueryList | undefined = globalThis.matchMedia?.(DARK_QUERY),
): ThemeController {
  let current = preference
  const apply = () => {
    root.dataset.theme = resolveTheme(current, media?.matches ?? false)
  }
  const onChange = () => {
    if (current === 'system') apply()
  }
  media?.addEventListener('change', onChange)
  apply()
  return {
    set(next) {
      current = next
      apply()
    },
    stop() {
      media?.removeEventListener('change', onChange)
    },
  }
}
