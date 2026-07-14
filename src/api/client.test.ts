import { describe, it, expect, vi, afterEach } from 'vitest'
import { getOrganization, getAlerts, alertAudioUrl, ApiError } from './client'

function mockFetch(response: Partial<Response> & { ok: boolean }) {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('alertAudioUrl', () => {
  it('builds the audio stream path', () => {
    expect(alertAudioUrl('boone', 'abc-123')).toBe(
      '/api/org/boone/alerts/abc-123/audio',
    )
  })

  it('url-encodes the org key and alert id', () => {
    expect(alertAudioUrl('a b/c', 'id#1')).toBe(
      '/api/org/a%20b%2Fc/alerts/id%231/audio',
    )
  })
})

describe('getOrganization', () => {
  it('requests the org endpoint and returns the parsed body', async () => {
    const org = { org_id: '1', org_key: 'boone', access_key: 'x', name: 'Boone FD' }
    const fetchMock = mockFetch({ ok: true, json: async () => org } as Response)

    const result = await getOrganization('boone')

    expect(fetchMock).toHaveBeenCalledWith('/api/org/boone')
    expect(result).toEqual(org)
  })

  it('throws ApiError carrying the status on failure', async () => {
    mockFetch({ ok: false, status: 404 } as Response)

    await expect(getOrganization('missing')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
    })
    await expect(getOrganization('missing')).rejects.toBeInstanceOf(ApiError)
  })
})

describe('getAlerts', () => {
  it('requests the alerts endpoint and returns the parsed list', async () => {
    const alerts = [{ alert_id: 'a1' }]
    const fetchMock = mockFetch({ ok: true, json: async () => alerts } as Response)

    const result = await getAlerts('boone')

    expect(fetchMock).toHaveBeenCalledWith('/api/org/boone/alerts')
    expect(result).toEqual(alerts)
  })
})
