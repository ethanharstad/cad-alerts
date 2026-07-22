import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  getOrganization,
  getAlerts,
  fetchAlertAudio,
  updateOrganizationSettings,
  ApiError,
} from './client'

function mockFetch(response: Partial<Response> & { ok: boolean }) {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getOrganization', () => {
  it('requests the org endpoint with the bearer secret and returns the parsed body', async () => {
    const org = { org_id: '1', org_key: 'boone', name: 'Boone FD' }
    const fetchMock = mockFetch({ ok: true, json: async () => org } as Response)

    const result = await getOrganization('boone', 's3cret')

    expect(fetchMock).toHaveBeenCalledWith('/api/org/boone', {
      headers: { Authorization: 'Bearer s3cret' },
    })
    expect(result).toEqual(org)
  })

  it('url-encodes the org key', async () => {
    const fetchMock = mockFetch({ ok: true, json: async () => ({}) } as Response)

    await getOrganization('a b/c', 's3cret')

    expect(fetchMock).toHaveBeenCalledWith('/api/org/a%20b%2Fc', {
      headers: { Authorization: 'Bearer s3cret' },
    })
  })

  it('throws ApiError carrying the status on failure', async () => {
    mockFetch({ ok: false, status: 401 } as Response)

    await expect(getOrganization('boone', 'wrong')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
    })
    await expect(getOrganization('boone', 'wrong')).rejects.toBeInstanceOf(ApiError)
  })
})

describe('updateOrganizationSettings', () => {
  it('PUTs the settings with the bearer secret and JSON content type', async () => {
    const settings = { default_city: 'Boone', default_state: 'IA', tts_template: '{nature}.' }
    const org = { org_id: '1', org_key: 'boone', name: 'Boone FD', ...settings }
    const fetchMock = mockFetch({ ok: true, json: async () => org } as Response)

    const result = await updateOrganizationSettings('boone', 's3cret', settings)

    expect(fetchMock).toHaveBeenCalledWith('/api/org/boone', {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer s3cret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(settings),
    })
    expect(result).toEqual(org)
  })

  it('url-encodes the org key', async () => {
    const fetchMock = mockFetch({ ok: true, json: async () => ({}) } as Response)

    await updateOrganizationSettings('a b/c', 's3cret', {
      default_city: null,
      default_state: null,
      tts_template: null,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/org/a%20b%2Fc',
      expect.objectContaining({ method: 'PUT' }),
    )
  })

  it('throws ApiError carrying the status on failure', async () => {
    mockFetch({ ok: false, status: 400 } as Response)

    await expect(
      updateOrganizationSettings('boone', 's3cret', {
        default_city: null,
        default_state: null,
        tts_template: '{bogus}',
      }),
    ).rejects.toMatchObject({ name: 'ApiError', status: 400 })
  })
})

describe('getAlerts', () => {
  it('requests the alerts endpoint with the bearer secret and returns the parsed list', async () => {
    const alerts = [{ alert_id: 'a1' }]
    const fetchMock = mockFetch({ ok: true, json: async () => alerts } as Response)

    const result = await getAlerts('boone', 's3cret')

    expect(fetchMock).toHaveBeenCalledWith('/api/org/boone/alerts', {
      headers: { Authorization: 'Bearer s3cret' },
    })
    expect(result).toEqual(alerts)
  })
})

describe('fetchAlertAudio', () => {
  it('fetches the audio endpoint with the bearer secret and returns an object URL', async () => {
    const blob = new Blob(['audio'], { type: 'audio/mpeg' })
    const fetchMock = mockFetch({ ok: true, blob: async () => blob } as Response)
    const createObjectURL = vi.fn().mockReturnValue('blob:mock-url')
    vi.stubGlobal('URL', { createObjectURL })

    const result = await fetchAlertAudio('boone', 'abc-123', 's3cret')

    expect(fetchMock).toHaveBeenCalledWith('/api/org/boone/alerts/abc-123/audio', {
      headers: { Authorization: 'Bearer s3cret' },
    })
    expect(createObjectURL).toHaveBeenCalledWith(blob)
    expect(result).toBe('blob:mock-url')
  })

  it('url-encodes the org key and alert id', async () => {
    const blob = new Blob(['audio'], { type: 'audio/mpeg' })
    const fetchMock = mockFetch({ ok: true, blob: async () => blob } as Response)
    vi.stubGlobal('URL', { createObjectURL: vi.fn().mockReturnValue('blob:mock-url') })

    await fetchAlertAudio('a b/c', 'id#1', 's3cret')

    expect(fetchMock).toHaveBeenCalledWith('/api/org/a%20b%2Fc/alerts/id%231/audio', {
      headers: { Authorization: 'Bearer s3cret' },
    })
  })

  it('throws ApiError carrying the status on failure', async () => {
    mockFetch({ ok: false, status: 401 } as Response)

    await expect(fetchAlertAudio('boone', 'abc-123', 'wrong')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
    })
  })
})
