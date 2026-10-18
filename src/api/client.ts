import type { Alert, PublicOrganization, OrgSettings } from '../../shared/types'
import { BUILD_ID_HEADER } from '../../shared/build'
import { noteServerBuild } from '../update/reload'

const API_BASE = '/api'

/** Error thrown when the API responds with a non-2xx status. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Build the auth headers for an organization request. The organization secret
 * (its `access_key`) is sent as a Bearer token so it stays out of URLs and logs.
 */
function authHeaders(secret: string): HeadersInit {
  return { Authorization: `Bearer ${secret}` }
}

/**
 * Pass on which build served a response, so a dashboard can tell when a deploy
 * has shipped (src/update/reload.ts). Called for every response, success or not.
 */
function noteBuild(response: Response) {
  noteServerBuild(response.headers?.get(BUILD_ID_HEADER))
}

async function getJson<T>(path: string, secret: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { headers: authHeaders(secret) })
  noteBuild(response)
  if (!response.ok) {
    throw new ApiError(response.status, `Request failed with status ${response.status}`)
  }
  return (await response.json()) as T
}

/** PUT a JSON body to an authenticated endpoint and parse the JSON response. */
async function putJson<T>(path: string, secret: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: { ...authHeaders(secret), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  noteBuild(response)
  if (!response.ok) {
    throw new ApiError(response.status, `Request failed with status ${response.status}`)
  }
  return (await response.json()) as T
}

/** Fetch a single organization by its public key. */
export function getOrganization(
  organizationKey: string,
  secret: string,
): Promise<PublicOrganization> {
  return getJson<PublicOrganization>(`/org/${encodeURIComponent(organizationKey)}`, secret)
}

/** Update an organization's editable settings, returning the updated org. */
export function updateOrganizationSettings(
  organizationKey: string,
  secret: string,
  settings: OrgSettings,
): Promise<PublicOrganization> {
  return putJson<PublicOrganization>(
    `/org/${encodeURIComponent(organizationKey)}`,
    secret,
    settings,
  )
}

/** Fetch the most recent alerts for an organization. */
export function getAlerts(organizationKey: string, secret: string): Promise<Alert[]> {
  return getJson<Alert[]>(`/org/${encodeURIComponent(organizationKey)}/alerts`, secret)
}

/** A single parsed Server-Sent Event. */
export interface SSEEvent {
  id?: string
  event?: string
  data?: string
}

/**
 * Incremental SSE frame parser. SSE frames are separated by a blank line and
 * each frame is a set of `field: value` lines. Bytes arrive in arbitrary
 * chunks, so `feed` buffers across calls and emits a parsed event for every
 * complete frame it can carve off. Split out from the network code so the
 * (fiddly) framing logic can be unit-tested against chunk boundaries.
 */
export function createSSEParser(onEvent: (event: SSEEvent) => void) {
  let buffer = ''

  const parseFrame = (raw: string): SSEEvent | null => {
    const event: SSEEvent = {}
    let hasField = false
    for (const line of raw.split('\n')) {
      // Blank lines can't occur inside a frame here; comment lines (`:` prefix,
      // e.g. a bare heartbeat) carry no field.
      if (line === '' || line.startsWith(':')) continue
      const colon = line.indexOf(':')
      const field = colon === -1 ? line : line.slice(0, colon)
      let value = colon === -1 ? '' : line.slice(colon + 1)
      // Per spec a single leading space after the colon is stripped.
      if (value.startsWith(' ')) value = value.slice(1)
      if (field === 'id') {
        event.id = value
        hasField = true
      } else if (field === 'event') {
        event.event = value
        hasField = true
      } else if (field === 'data') {
        // Multiple data lines join with newlines.
        event.data = event.data === undefined ? value : `${event.data}\n${value}`
        hasField = true
      }
    }
    return hasField ? event : null
  }

  return {
    feed(chunk: string) {
      // Normalize CRLF so frame splitting on "\n\n" works regardless of encoding.
      buffer += chunk.replace(/\r\n/g, '\n')
      let sep: number
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        const event = parseFrame(raw)
        if (event) onEvent(event)
      }
    },
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Handle returned by {@link streamAlerts}; call `close` to stop the stream. */
export interface AlertStreamHandle {
  close(): void
}

/**
 * `reconnecting` is a blip — the connection dropped and will be retried within
 * seconds. `unavailable` means enough attempts have failed in a row that the
 * stream should be treated as blocked (a proxy that strips `text/event-stream`,
 * say) and the caller should degrade to polling. The stream keeps retrying
 * either way, so `unavailable` can return to `connected` on its own.
 */
export type StreamStatus = 'connected' | 'reconnecting' | 'unavailable'

export interface StreamCallbacks {
  /** Fires for each streamed alert (already JSON-parsed). */
  onAlert: (alert: Alert) => void
  /** Fires on connection state changes, for a UI indicator. */
  onStatus?: (status: StreamStatus) => void
}

/**
 * Reconnect tuning. Production uses the defaults; tests pass small values so the
 * retry loop runs without real waiting.
 */
export interface StreamOptions {
  /** Consecutive failed attempts before the status turns `unavailable`. */
  failureThreshold?: number
  /** First reconnect delay in ms; doubles per failure up to a 30s ceiling. */
  backoffMs?: number
}

const DEFAULT_STREAM_OPTIONS = { failureThreshold: 3, backoffMs: 1000 }
const MAX_BACKOFF_MS = 30000

/**
 * Subscribe to an organization's live alert stream.
 *
 * Uses `fetch` + a `ReadableStream` reader rather than the browser's
 * `EventSource`, because `EventSource` cannot send an `Authorization` header and
 * the API auths with a Bearer `access_key` that must stay out of URLs and logs
 * (see docs/adr/0001). Reconnection and `Last-Event-ID` resume are therefore
 * implemented here: the last event id seen is replayed on reconnect so an alert
 * that lands during a brief disconnect is not missed, and reconnect backoff is
 * capped exponential. After `failureThreshold` consecutive failures the status
 * turns `unavailable`, the caller's cue to fall back to polling; retrying
 * continues underneath, so a stream that recovers reports `connected` again.
 * Returns immediately; call `close()` to stop.
 */
export function streamAlerts(
  organizationKey: string,
  secret: string,
  callbacks: StreamCallbacks,
  options: StreamOptions = {},
): AlertStreamHandle {
  const { failureThreshold, backoffMs } = { ...DEFAULT_STREAM_OPTIONS, ...options }
  const controller = new AbortController()
  let closed = false
  let lastEventId: string | null = null

  const run = async () => {
    let backoff = backoffMs
    let failures = 0
    const path = `/org/${encodeURIComponent(organizationKey)}/alerts/stream`

    while (!closed) {
      try {
        const headers: Record<string, string> = { ...(authHeaders(secret) as Record<string, string>) }
        if (lastEventId !== null) headers['Last-Event-ID'] = lastEventId

        const response = await fetch(`${API_BASE}${path}`, {
          headers,
          signal: controller.signal,
        })
        // The server caps each connection, so a reconnect lands on a new deploy
        // within minutes of it shipping — this is how a dashboard on the stream
        // finds out.
        noteBuild(response)
        if (!response.ok || !response.body) {
          throw new ApiError(response.status, `Stream failed with status ${response.status}`)
        }

        let sawFrame = false
        const parser = createSSEParser((event) => {
          if (!sawFrame) {
            sawFrame = true
            // Connected means frames are flowing, not that the request returned
            // 200 — an intermediary can accept the request and deliver nothing.
            // Resetting the failure count here rather than above is what stops
            // that case from looking healthy on every attempt.
            callbacks.onStatus?.('connected')
            failures = 0
            backoff = backoffMs
          }
          if (event.id) lastEventId = event.id
          if (event.event === 'alert' && event.data) {
            try {
              callbacks.onAlert(JSON.parse(event.data) as Alert)
            } catch {
              // Ignore a malformed frame rather than tearing down the stream.
            }
          }
        })

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          parser.feed(decoder.decode(value, { stream: true }))
        }
        // Clean end. The server caps a healthy connection, but only after it has
        // sent heartbeats — one that closes without a single frame is something
        // between us and the Worker refusing the stream. Reconnecting promptly
        // there would spin at full speed and never trip the threshold, so it is
        // routed through the failure path instead.
        if (!sawFrame) throw new Error('stream closed before delivering any events')
      } catch {
        if (closed || controller.signal.aborted) return
        failures += 1
        callbacks.onStatus?.(failures >= failureThreshold ? 'unavailable' : 'reconnecting')
        await sleep(backoff)
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
      }
    }
  }

  void run()

  return {
    close() {
      closed = true
      controller.abort()
    },
  }
}

/**
 * Fetch an alert's audio and return an object URL suitable for an `<audio>`
 * element. The audio endpoint is authenticated, and a media element cannot send
 * an Authorization header on its own, so the bytes are fetched here (with the
 * header) and wrapped in a blob URL. Callers must `URL.revokeObjectURL` the
 * result when it is no longer needed.
 */
export async function fetchAlertAudio(
  organizationKey: string,
  alertId: string,
  secret: string,
): Promise<string> {
  const path = `/org/${encodeURIComponent(organizationKey)}/alerts/${encodeURIComponent(alertId)}/audio`
  const response = await fetch(`${API_BASE}${path}`, { headers: authHeaders(secret) })
  noteBuild(response)
  if (!response.ok) {
    throw new ApiError(response.status, `Request failed with status ${response.status}`)
  }
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}
