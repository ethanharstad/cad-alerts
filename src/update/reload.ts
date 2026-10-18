import { BUILD_ID } from '../../shared/build'

/**
 * Self-update for dashboards nobody is standing next to.
 *
 * Every API response names the build that served it (`X-Build-Id`, see
 * server/api.ts). The client passes each one to {@link noteServerBuild}; a
 * dashboard running {@link createReloadScheduler} reloads once the server's
 * build differs from its own. The SPA and the Worker come out of one build, so a
 * different id means a deploy has shipped and a reload picks up both halves.
 */

type Listener = (buildId: string) => void
const listeners = new Set<Listener>()

/** Record the build a response came from. A missing header is ignored. */
export function noteServerBuild(buildId: string | null | undefined): void {
  if (!buildId) return
  for (const listener of listeners) listener(buildId)
}

/** Hear every build id a response reports. Returns an unsubscribe function. */
export function onServerBuild(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** sessionStorage key recording the last reload attempt (see the loop guard). */
export const RELOAD_ATTEMPT_KEY = 'buildReloadAttempt'

export interface ReloadSchedulerOptions {
  /**
   * True while a reload would interrupt something — an alert being read out,
   * or an operator's pause. The reload waits until this turns false.
   */
  isBusy: () => boolean
  reload?: () => void
  /** This page's own build. */
  currentBuild?: string
  /** Where the loop guard lives; null if storage is unavailable. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  now?: () => number
  /**
   * Delay before the first reload after a deploy is seen, so a room full of
   * dashboards does not reload in the same instant.
   */
  jitterMs?: () => number
  /** How often to re-check whether the reload may go ahead. */
  checkMs?: number
  /**
   * After a reload that came back on the old build — a stale cache, a proxy —
   * how long to wait before trying again, so the page never reload-loops.
   */
  retryAfterMs?: number
}

interface ReloadAttempt {
  target: string
  at: number
}

const DEFAULTS = {
  checkMs: 5_000,
  retryAfterMs: 60 * 60_000,
  jitterMs: () => Math.random() * 30_000,
}

function readAttempt(storage: ReloadSchedulerOptions['storage']): ReloadAttempt | null {
  try {
    const raw = storage?.getItem(RELOAD_ATTEMPT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ReloadAttempt
    return typeof parsed.target === 'string' && typeof parsed.at === 'number' ? parsed : null
  } catch {
    return null
  }
}

function writeAttempt(storage: ReloadSchedulerOptions['storage'], attempt: ReloadAttempt) {
  try {
    storage?.setItem(RELOAD_ATTEMPT_KEY, JSON.stringify(attempt))
  } catch {
    // No storage means no loop guard across the reload; the reload still goes.
  }
}

function sessionStorageOrNull(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

/**
 * Reload the page onto a newer build once one is reported, at a moment that
 * interrupts nothing. Returns `stop`, which cancels a pending reload.
 */
export function createReloadScheduler(options: ReloadSchedulerOptions) {
  const currentBuild = options.currentBuild ?? BUILD_ID
  const reload = options.reload ?? (() => window.location.reload())
  const storage = options.storage === undefined ? sessionStorageOrNull() : options.storage
  const now = options.now ?? (() => Date.now())
  const jitterMs = options.jitterMs ?? DEFAULTS.jitterMs
  const checkMs = options.checkMs ?? DEFAULTS.checkMs
  const retryAfterMs = options.retryAfterMs ?? DEFAULTS.retryAfterMs

  let target: string | null = null
  let dueAt = 0
  let timer: ReturnType<typeof setInterval> | null = null

  const tick = () => {
    if (target === null || now() < dueAt || options.isBusy()) return
    writeAttempt(storage, { target, at: now() })
    stop()
    reload()
  }

  const onBuild = (buildId: string) => {
    if (buildId === currentBuild) return
    // A later deploy just retargets a reload that is already waiting.
    const firstSighting = target === null
    target = buildId
    if (!firstSighting) return

    // Already reloaded for this very build and still came back on the old one:
    // reloading again now would only repeat that, so wait out the retry delay.
    const previous = readAttempt(storage)
    dueAt =
      previous && previous.target === buildId
        ? Math.max(now(), previous.at + retryAfterMs)
        : now() + jitterMs()
    timer = setInterval(tick, checkMs)
  }

  const unsubscribe = onServerBuild(onBuild)

  const stop = () => {
    unsubscribe()
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  return { stop }
}
