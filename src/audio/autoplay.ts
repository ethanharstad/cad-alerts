import { ref } from 'vue'

/**
 * Whether the browser is refusing to play sound until someone interacts with
 * the page. Browsers apply this to every freshly loaded page, so a dashboard
 * that reloads itself (src/update/reload.ts) can come back looking normal but
 * unable to speak — the dashboard shows a banner while this is true so a silent
 * kiosk is obvious from across the room.
 */
export const audioBlocked = ref(false)

/** Minimal surface of an `HTMLAudioElement`, injectable for tests. */
export interface PlayableAudio {
  play(): Promise<void>
}

export type AudioFactory = (url: string) => PlayableAudio

const defaultFactory: AudioFactory = (url) => new Audio(url)

/**
 * Record how a `play()` call went. A refusal is told apart from other failures
 * (a missing file, a decode error) by its `NotAllowedError` name — only that one
 * means "needs a tap".
 */
export function notePlayResult(error?: unknown): void {
  if (error === undefined) {
    audioBlocked.value = false
  } else if (error instanceof Error && error.name === 'NotAllowedError') {
    audioBlocked.value = true
  }
}

/**
 * Ask the browser whether it will play sound right now, by playing a short
 * silent clip. Resolves true if it played. Run on load, so a blocked dashboard
 * shows its banner before the next alert rather than by missing it; and again
 * from a tap, which is what lifts the block.
 */
export async function probeAudio(createAudio: AudioFactory = defaultFactory): Promise<boolean> {
  try {
    await createAudio(silentClipUrl()).play()
    notePlayResult()
    return true
  } catch (err) {
    notePlayResult(err)
    return false
  }
}

let silentClip: string | null = null

/** A tenth of a second of silence as a WAV data URL (8 kHz, 8-bit mono). */
function silentClipUrl(): string {
  if (silentClip) return silentClip
  const samples = 800
  const bytes = new Uint8Array(44 + samples)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i)
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + samples, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, 8000, true) // sample rate
  view.setUint32(28, 8000, true) // byte rate
  view.setUint16(32, 1, true) // block align
  view.setUint16(34, 8, true) // bits per sample
  ascii(36, 'data')
  view.setUint32(40, samples, true)
  bytes.fill(128, 44) // 8-bit PCM is unsigned; 128 is silence
  silentClip = `data:audio/wav;base64,${btoa(String.fromCharCode(...bytes))}`
  return silentClip
}
