import { notePlayResult } from './autoplay'
import { applyOutputDevice } from './outputDevice'

export interface PlayClipOptions {
  /** Output device id; `''` or omitted plays on the system default. */
  deviceId?: string
  /** Called when `deviceId` could not be used and the clip fell back to the default. */
  onDeviceUnavailable?: () => void
  /** Aborting stops the clip at once and resolves; an aborted signal plays nothing. */
  signal?: AbortSignal
}

/**
 * Play one clip, resolving when it has finished. A clip that fails to load or
 * that the browser refuses to play resolves too, so a caller chaining clips (a
 * tone, then the alert) is never wedged by one bad one. Each attempt also
 * updates whether the browser is blocking sound (see `audioBlocked`).
 */
export async function playClip(url: string, options: PlayClipOptions = {}): Promise<void> {
  const { signal } = options
  if (signal?.aborted) return
  const audio = new Audio(url)
  // Route before playing; a device that has gone away still plays the clip, on
  // the system default, rather than staying silent.
  if (!(await applyOutputDevice(audio, options.deviceId ?? ''))) {
    options.onDeviceUnavailable?.()
  }
  if (signal?.aborted) return
  return new Promise<void>(resolve => {
    // The signal outlives the clip (it covers the tone and the speech), so the
    // listener is dropped as soon as the clip is done, whichever way it ends.
    const onAbort = () => {
      audio.pause()
      finish()
    }
    const finish = () => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    audio.addEventListener('ended', finish)
    audio.addEventListener('error', finish)
    audio.play().then(
      () => notePlayResult(),
      err => {
        notePlayResult(err)
        console.error('Failed to play audio:', err)
        finish()
      },
    )
  })
}
