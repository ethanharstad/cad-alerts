import { notePlayResult } from './autoplay'
import { applyOutputDevice } from './outputDevice'

export interface PlayClipOptions {
  /** Output device id; `''` or omitted plays on the system default. */
  deviceId?: string
  /** Called when `deviceId` could not be used and the clip fell back to the default. */
  onDeviceUnavailable?: () => void
}

/**
 * Play one clip, resolving when it has finished. A clip that fails to load or
 * that the browser refuses to play resolves too, so a caller chaining clips (a
 * tone, then the alert) is never wedged by one bad one. Each attempt also
 * updates whether the browser is blocking sound (see `audioBlocked`).
 */
export async function playClip(url: string, options: PlayClipOptions = {}): Promise<void> {
  const audio = new Audio(url)
  // Route before playing; a device that has gone away still plays the clip, on
  // the system default, rather than staying silent.
  if (!(await applyOutputDevice(audio, options.deviceId ?? ''))) {
    options.onDeviceUnavailable?.()
  }
  return new Promise<void>(resolve => {
    audio.addEventListener('ended', () => resolve())
    audio.addEventListener('error', () => resolve())
    audio.play().then(
      () => notePlayResult(),
      err => {
        notePlayResult(err)
        console.error('Failed to play audio:', err)
        resolve()
      },
    )
  })
}
