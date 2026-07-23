import type { Alert, PublicOrganization, OrgSettings } from '../../shared/types'

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

async function getJson<T>(path: string, secret: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { headers: authHeaders(secret) })
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

export type StreamStatus = 'connected' | 'reconnecting'

export interface StreamCallbacks {
  /** Fires for each streamed alert (already JSON-parsed). */
  onAlert: (alert: Alert) => void
  /** Fires on connection state changes, for a UI indicator. */
  onStatus?: (status: StreamStatus) => void
}

/**
 * Subscribe to an organization's live alert stream.
 *
 * Uses `fetch` + a `ReadableStream` reader rather than the browser's
 * `EventSource`, because `EventSource` cannot send an `Authorization` header and
 * the API auths with a Bearer `access_key` that must stay out of URLs and logs
 * (see docs/adr/0001). Reconnection and `Last-Event-ID` resume are therefore
 * implemented here: the last event id seen is replayed on reconnect so an alert
 * that lands during a brief disconnect is not missed, and reconnect backoff is
 * capped exponential. Returns immediately; call `close()` to stop.
 */
export function streamAlerts(
  organizationKey: string,
  secret: string,
  callbacks: StreamCallbacks,
): AlertStreamHandle {
  const controller = new AbortController()
  let closed = false
  let lastEventId: string | null = null

  const run = async () => {
    let backoff = 1000
    const path = `/org/${encodeURIComponent(organizationKey)}/alerts/stream`

    while (!closed) {
      try {
        const headers: Record<string, string> = { ...(authHeaders(secret) as Record<string, string>) }
        if (lastEventId !== null) headers['Last-Event-ID'] = lastEventId

        const response = await fetch(`${API_BASE}${path}`, {
          headers,
          signal: controller.signal,
        })
        if (!response.ok || !response.body) {
          throw new ApiError(response.status, `Stream failed with status ${response.status}`)
        }

        callbacks.onStatus?.('connected')
        backoff = 1000

        const parser = createSSEParser((event) => {
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
        // Clean end (server capped the connection) — reconnect promptly.
      } catch {
        if (closed || controller.signal.aborted) return
        callbacks.onStatus?.('reconnecting')
        await sleep(backoff)
        backoff = Math.min(backoff * 2, 30000)
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
  if (!response.ok) {
    throw new ApiError(response.status, `Request failed with status ${response.status}`)
  }
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}
