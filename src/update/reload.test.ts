import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { createReloadScheduler, noteServerBuild, RELOAD_ATTEMPT_KEY } from './reload'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  }
}

const JITTER = 10_000
const CHECK = 1_000

describe('createReloadScheduler', () => {
  let schedulers: { stop(): void }[] = []

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
  })

  afterEach(() => {
    for (const s of schedulers) s.stop()
    schedulers = []
    vi.useRealTimers()
  })

  function setup(opts: { busy?: () => boolean; storage?: ReturnType<typeof memoryStorage> } = {}) {
    const reload = vi.fn()
    const storage = opts.storage ?? memoryStorage()
    const scheduler = createReloadScheduler({
      currentBuild: 'old',
      isBusy: opts.busy ?? (() => false),
      reload,
      storage,
      jitterMs: () => JITTER,
      checkMs: CHECK,
      retryAfterMs: 60_000,
    })
    schedulers.push(scheduler)
    return { reload, storage, scheduler }
  }

  it('does nothing while the server reports this same build', () => {
    const { reload } = setup()
    noteServerBuild('old')
    vi.advanceTimersByTime(JITTER * 10)
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads after the jitter delay once a different build is reported', () => {
    const { reload, storage } = setup()
    noteServerBuild('new')

    vi.advanceTimersByTime(JITTER - CHECK)
    expect(reload).not.toHaveBeenCalled()
    vi.advanceTimersByTime(CHECK)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(JSON.parse(storage.data.get(RELOAD_ATTEMPT_KEY)!)).toEqual({
      target: 'new',
      at: 1_000_000 + JITTER,
    })

    // Fires once, not on every later tick.
    vi.advanceTimersByTime(JITTER)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('ignores a missing build header', () => {
    const { reload } = setup()
    noteServerBuild(null)
    noteServerBuild('')
    vi.advanceTimersByTime(JITTER * 2)
    expect(reload).not.toHaveBeenCalled()
  })

  it('waits until nothing is busy', () => {
    let busy = true
    const { reload } = setup({ busy: () => busy })
    noteServerBuild('new')

    vi.advanceTimersByTime(JITTER * 5)
    expect(reload).not.toHaveBeenCalled()

    busy = false
    vi.advanceTimersByTime(CHECK)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('backs off instead of looping when a reload came back on the old build', () => {
    // A reload for 'new' was attempted 5s ago, yet this page is still 'old'.
    const storage = memoryStorage({
      [RELOAD_ATTEMPT_KEY]: JSON.stringify({ target: 'new', at: 1_000_000 - 5_000 }),
    })
    const { reload } = setup({ storage })
    noteServerBuild('new')

    vi.advanceTimersByTime(JITTER * 2)
    expect(reload).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60_000 - 5_000 - JITTER * 2)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('treats an earlier attempt for a different build as no attempt', () => {
    const storage = memoryStorage({
      [RELOAD_ATTEMPT_KEY]: JSON.stringify({ target: 'older', at: 1_000_000 - 5_000 }),
    })
    const { reload } = setup({ storage })
    noteServerBuild('new')
    vi.advanceTimersByTime(JITTER)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('stop cancels a pending reload', () => {
    const { reload, scheduler } = setup()
    noteServerBuild('new')
    scheduler.stop()
    vi.advanceTimersByTime(JITTER * 2)
    expect(reload).not.toHaveBeenCalled()
  })
})
