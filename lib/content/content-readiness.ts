import type { SessionSchema } from '@/types/session-schema'
import { assessThinness } from '@/lib/mbp/provenance'
import { activeNiches } from './active-niches'
import { activeServices } from './active-services'

// A pre-generation sanity check on the content-critical MBP fields the generators
// lean on hardest. When these are empty or placeholder-thin, the copy comes out
// generic no matter how good the prompts are — so we surface the gap to the
// operator BEFORE a whole site is generated from a hollow profile. Advisory only:
// it never blocks generation (the sitemap-confirm route returns it as a warning),
// it just makes the "thin MBP → generic copy" failure visible instead of silent.

export interface ReadinessReport {
  ready: boolean
  // Human-readable labels for the fields that are empty or too thin to write from.
  missing: string[]
}

// Empty, or a tracked prose field short enough that provenance flags it 'thin'.
function isThinOrEmpty(path: string, value: unknown): boolean {
  if (value == null) return true
  if (typeof value === 'string') return value.trim().length === 0 || assessThinness(path, value)
  if (Array.isArray(value)) return value.length === 0
  return false
}

export function assessContentReadiness(schema: SessionSchema): ReadinessReport {
  const missing: string[] = []
  const b = schema.business

  if (isThinOrEmpty('positioningStatement', b?.positioningStatement)) {
    missing.push('Positioning statement (what makes this firm the right choice)')
  }
  if (isThinOrEmpty('differentiators', b?.differentiators)) {
    missing.push('Differentiators (why this firm over a generic competitor)')
  }

  // Brand voice: at least a stated tone or a set of tone adjectives to write in.
  const brand = schema.brand
  const hasTone =
    (typeof brand?.currentTone === 'string' && brand.currentTone.trim().length > 0) ||
    (Array.isArray(brand?.toneAdjectives) && brand.toneAdjectives.length > 0)
  if (!hasTone) missing.push('Brand voice (tone or tone adjectives)')

  // At least one active niche fleshed out enough to write a niche page from.
  const niches = activeNiches(schema)
  const hasUsableNiche = niches.some(
    (n) => !isThinOrEmpty('painPoints', n.painPoints) && !isThinOrEmpty('valueProp', n.valueProp),
  )
  if (!hasUsableNiche) {
    missing.push('At least one industry/niche with its pain points and value proposition')
  }

  // At least one active service with a real name + description — service pages are
  // the firm's money pages and go generic without a description to write from.
  const services = activeServices(schema)
  const hasUsableService = services.some(
    (s) => !isThinOrEmpty('name', s.name) && !isThinOrEmpty('description', s.description),
  )
  if (!hasUsableService) {
    missing.push('At least one service with a description (what it is, who it is for)')
  }

  // A geographic decision: an explicit national scope, OR a confirmed service area,
  // OR a non-thin free-text geographic scope. Without one, local pages and
  // "areas served" language come out empty or generic.
  const hasGeoDecision =
    b?.serviceScope === 'national' ||
    (Array.isArray(b?.serviceAreas) && b.serviceAreas.some((a) => (a?.city ?? '').trim().length > 0)) ||
    !isThinOrEmpty('geographicScope', b?.geographicScope)
  if (!hasGeoDecision) {
    missing.push('A geographic scope (service areas, or a national scope)')
  }

  return { ready: missing.length === 0, missing }
}
