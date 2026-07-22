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
