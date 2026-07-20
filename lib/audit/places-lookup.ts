// Google Places API (Text Search, New) client for authoritative Google Business
// Profile data — rating, review count, categories, hours, business status. Reuses
// the auth/timeout/degrade-gracefully pattern of serper-search.ts: returns null
// (never throws) when no key is set, the request fails, or nothing matches, so
// the social-presence pass can fall back to Serper discovery. Server-only —
// GOOGLE_PLACES_API_KEY must never be exposed client-side.
import type { PlaceDetails } from './types'

const PLACES_API = 'https://places.googleapis.com/v1/places:searchText'
const PLACES_TIMEOUT_MS = 15_000
// A single Text Search call returns place details inline via the field mask —
// no follow-up Details call, which keeps GBP lookups to one billable request.
const FIELD_MASK = [
  'places.displayName',
  'places.rating',
  'places.userRatingCount',
  'places.businessStatus',
  'places.types',
  'places.primaryTypeDisplayName',
  'places.regularOpeningHours',
  'places.googleMapsUri',
].join(',')

export function placesEnabled(): boolean {
  return !!process.env.GOOGLE_PLACES_API_KEY
}

interface PlacesResponse {
  places?: Array<{
    displayName?: { text?: string }
    rating?: number
    userRatingCount?: number
    businessStatus?: string
    types?: string[]
    primaryTypeDisplayName?: { text?: string }
    regularOpeningHours?: { periods?: unknown[]; weekdayDescriptions?: string[] }
    googleMapsUri?: string
  }>
}

/** Look up the best-matching place for a free-text query (e.g. "Acme CPA,
 * Austin TX"). Returns the top result's details, or null when no key / non-200 /
 * timeout / zero matches. `location` biases the search geographically. */
export async function lookupPlace(
  query: string,
  opts: { location?: string } = {},
): Promise<PlaceDetails | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key || !query.trim()) return null
  try {
    const body: Record<string, unknown> = { textQuery: query, maxResultCount: 1 }
    if (opts.location) body.textQuery = `${query} ${opts.location}`
    const res = await fetch(PLACES_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PLACES_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const data = (await res.json()) as PlacesResponse
    const place = data.places?.[0]
    if (!place) return null

    const categories = [
      place.primaryTypeDisplayName?.text,
      ...(place.types ?? []).map(humanizeType),
    ].filter((c): c is string => !!c)

    return {
      name: place.displayName?.text ?? null,
      rating: typeof place.rating === 'number' ? place.rating : null,
      reviewCount: typeof place.userRatingCount === 'number' ? place.userRatingCount : null,
      businessStatus: place.businessStatus ?? null,
      categories: dedup(categories).slice(0, 6),
      hoursListed: !!place.regularOpeningHours?.periods?.length,
      mapsUri: place.googleMapsUri ?? null,
    }
  } catch {
    return null
  }
}

// Places `types` are snake_case tokens (e.g. "accounting", "tax_consultant").
function humanizeType(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function dedup(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    const k = v.trim().toLowerCase()
    if (!v.trim() || seen.has(k)) continue
    seen.add(k)
    out.push(v.trim())
  }
  return out
}
