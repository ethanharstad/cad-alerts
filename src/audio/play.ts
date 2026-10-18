/**
 * Play one clip, resolving when it has finished. A clip that fails to load or
 * that the browser refuses to play resolves too, so a caller chaining clips (a
 * tone, then the alert) is never wedged by one bad one.
 */
export function playClip(url: string): Promise<void> {
  const audio = new Audio(url)
  return new Promise<void>(resolve => {
    audio.addEventListener('ended', () => resolve())
    audio.addEventListener('error', () => resolve())
    audio.play().catch(err => {
      console.error('Failed to play audio:', err)
      resolve()
    })
  })
}
