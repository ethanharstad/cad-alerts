import type { Alert, Organization } from '../../shared/types'

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

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`)
  if (!response.ok) {
    throw new ApiError(response.status, `Request failed with status ${response.status}`)
  }
  return (await response.json()) as T
}

/** Fetch a single organization by its public key. */
export function getOrganization(organizationKey: string): Promise<Organization> {
  return getJson<Organization>(`/org/${encodeURIComponent(organizationKey)}`)
}

/** Fetch the most recent alerts for an organization. */
export function getAlerts(organizationKey: string): Promise<Alert[]> {
  return getJson<Alert[]>(`/org/${encodeURIComponent(organizationKey)}/alerts`)
}

/** Build the audio stream URL for a given alert. */
export function alertAudioUrl(organizationKey: string, alertId: string): string {
  return `${API_BASE}/org/${encodeURIComponent(organizationKey)}/alerts/${encodeURIComponent(alertId)}/audio`
}
