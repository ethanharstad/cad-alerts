import { ref, watch, type Ref } from 'vue'

/**
 * A reactive value backed by localStorage. Reads the stored value when the ref
 * is created — falling back to `defaultValue` when the key is absent or the
 * stored JSON is unparseable — and writes it back whenever it changes.
 *
 * All persistence lives here, so a store declares a field in one line and never
 * repeats the key or the read/watch plumbing. Values are stored as JSON, so any
 * serialisable type works.
 */
export function persisted<T>(key: string, defaultValue: T): Ref<T> {
  const state = ref(read(key, defaultValue)) as Ref<T>

  watch(state, (value) => {
    localStorage.setItem(key, JSON.stringify(value))
  })

  return state
}

function read<T>(key: string, defaultValue: T): T {
  const raw = localStorage.getItem(key)
  if (raw === null) {
    return defaultValue
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return defaultValue
  }
}
