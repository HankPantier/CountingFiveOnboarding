import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lookupPlace, placesEnabled } from './places-lookup'

const OLD_KEY = process.env.GOOGLE_PLACES_API_KEY

beforeEach(() => {
  process.env.GOOGLE_PLACES_API_KEY = 'test-key'
  vi.restoreAllMocks()
})

afterEach(() => {
  if (OLD_KEY === undefined) delete process.env.GOOGLE_PLACES_API_KEY
  else process.env.GOOGLE_PLACES_API_KEY = OLD_KEY
  vi.restoreAllMocks()
})

describe('placesEnabled', () => {
  it('reflects the presence of the key', () => {
    expect(placesEnabled()).toBe(true)
    delete process.env.GOOGLE_PLACES_API_KEY
    expect(placesEnabled()).toBe(false)
  })
})

describe('lookupPlace', () => {
  it('returns null without a key and never calls fetch', async () => {
    delete process.env.GOOGLE_PLACES_API_KEY
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    expect(await lookupPlace('Acme CPA')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns null for an empty query', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    expect(await lookupPlace('   ')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('sends the api key + field mask and maps the top result', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          places: [
            {
              displayName: { text: 'Acme CPA' },
              rating: 4.8,
              userRatingCount: 57,
              businessStatus: 'OPERATIONAL',
              types: ['accounting', 'point_of_interest'],
              primaryTypeDisplayName: { text: 'Accountant' },
              regularOpeningHours: { periods: [{}], weekdayDescriptions: ['Mon: 9–5'] },
              googleMapsUri: 'https://maps.google.com/?cid=1',
            },
          ],
        }),
        { status: 200 },
      ),
    )

    const details = await lookupPlace('Acme CPA', { location: 'Austin, TX' })
    expect(details).not.toBeNull()
    expect(details!.rating).toBe(4.8)
    expect(details!.reviewCount).toBe(57)
    expect(details!.hoursListed).toBe(true)
    expect(details!.mapsUri).toBe('https://maps.google.com/?cid=1')
    expect(details!.categories).toContain('Accountant')

    const [, init] = fetchSpy.mock.calls[0]
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers['X-Goog-Api-Key']).toBe('test-key')
    expect(headers['X-Goog-FieldMask']).toContain('places.rating')
  })

  it('returns null on a non-200 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 429 }))
    expect(await lookupPlace('Acme CPA')).toBeNull()
  })

  it('returns null when the request throws (timeout)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('aborted'))
    expect(await lookupPlace('Acme CPA')).toBeNull()
  })

  it('returns null when no places match', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ places: [] }), { status: 200 }),
    )
    expect(await lookupPlace('Acme CPA')).toBeNull()
  })
})
