import type { SessionSchema } from '@/types/session-schema'

// Shared brand-voice prompt fragments. Extracted from content-generator.ts so
// the page generator and the Resources blog generators describe the firm's
// voice identically — one source of truth for "on-brand."

// Schema string fields are declared `string`, but stored schema_data can carry a
// non-string (array/object) from an AI draft, import, or hand edit. Coerce
// defensively so a dirty value degrades to empty/text instead of throwing:
// calling `.trim()` on a non-string TypeError'd here and took down BOTH the
// outline and page-body generators (they swallow it into a generic "generation
// failed" note). Arrays are flattened to a comma list; anything else → ''.
const str = (v: unknown): string =>
  typeof v === 'string'
    ? v
    : Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string').join(', ')
      : ''

export function buildCredentials(schema: SessionSchema): string {
  const creds: string[] = []
  for (const member of schema.team ?? []) {
    if (member.certifications?.length) {
      creds.push(`${member.name}: ${member.certifications.join(', ')}`)
    }
  }
  for (const aff of schema.business?.affiliations ?? []) {
    creds.push(aff)
  }
  return creds.join('\n') || 'Not specified'
}

export function firmLocation(schema: SessionSchema): string {
  return schema.locations?.[0]
    ? `${schema.locations[0].city}, ${schema.locations[0].state}`
    : ''
}

// The substantive firm-profile facts that should ground every piece of copy —
// the business/audience/services context beyond brand voice. buildBrandVoiceBlock
// covers tone + positioning + differentiators; this covers everything else in the
// MBP that informs what the copy should SAY. Omits empties so blanks add no noise.
export function buildFirmContext(schema: SessionSchema): string {
  const b = schema.business
  const c = schema.culture
  const lines: string[] = []
  const add = (label: string, v: string | undefined | null, cap = 400) => {
    if (typeof v === 'string' && v.trim()) lines.push(`${label}: ${v.trim().slice(0, cap)}`)
  }
  const list = (label: string, v: string[] | undefined) => {
    const items = (v ?? []).filter(Boolean)
    if (items.length) lines.push(`${label}: ${items.join(', ')}`)
  }

  add('Tagline', b?.tagline, 160)
  add('Founded', b?.foundingYear, 40)
  add('Firm history', b?.firmHistory)
  add('Mission / vision / values', c?.missionVisionValues)
  add('Team & culture', c?.teamDescription)
  add('Geographic scope', b?.geographicScope, 160)
  list('Ideal clients', b?.idealClients)
  add('Who they serve', b?.customerDescription)
  add('Client needs / pain points', b?.customerNeeds)
  add('How clients find them', b?.howClientsFind)
  add('Client mix', b?.clientMixBreakdown)
  list('Client age ranges', b?.clientAgeRanges)
  add('Growth goals', b?.growthGoals)

  const services = (schema.services ?? [])
    .filter(s => s.name)
    .map(s => (s.description ? `${s.name} (${s.description.slice(0, 80)})` : s.name))
  if (services.length) lines.push(`Services: ${services.join('; ')}`)

  // Per-niche pain points + value prop (not just names) so niche pages can speak
  // to the specific audience, not generically.
  const niches = (schema.niches ?? []).filter(n => str(n.name).trim())
  if (niches.length) {
    const nicheLines = niches.map(n => {
      const bits = [str(n.name).trim()]
      const pain = str(n.painPoints).trim()
      if (pain) bits.push(`pain: ${pain.slice(0, 120)}`)
      const value = str(n.valueProp).trim()
      if (value) bits.push(`value: ${value.slice(0, 120)}`)
      return bits.join(' — ')
    })
    lines.push(`Niches served:\n  ${nicheLines.join('\n  ')}`)
  }

  // Client success stories — proof/E-E-A-T material for testimonials & stats.
  const stories = (b?.clientSuccessStories ?? []).map(s => str(s).trim()).filter(Boolean).slice(0, 3).map(s => s.slice(0, 200))
  if (stories.length) lines.push(`Client success stories (use as proof, don't fabricate specifics): ${stories.join(' | ')}`)

  // Reputation & trust signals (ratings, review themes, press).
  const rep = schema.reputation
  if (rep) {
    const repBits: string[] = []
    const google = str(rep.googleRating).trim()
    if (google) repBits.push(`Google ${google}`)
    const yelp = str(rep.yelpRating).trim()
    if (yelp) repBits.push(`Yelp ${yelp}`)
    const review = str(rep.reviewSummary).trim()
    if (review) repBits.push(review.slice(0, 160))
    if (rep.pressAndMedia?.length) repBits.push(`Press: ${rep.pressAndMedia.slice(0, 3).join(', ')}`)
    if (repBits.length) lines.push(`Reputation & trust signals: ${repBits.join(' | ')}`)
  }

  // Local competitors — for differentiation only. Never name them in copy.
  const competitors = (b?.competitors ?? [])
    .filter(c2 => str(c2.name).trim())
    .slice(0, 5)
    .map(c2 => {
      const bits = [str(c2.name).trim()]
      const claim = str(c2.nicheClaim).trim()
      if (claim) bits.push(claim.slice(0, 60))
      const notes = str(c2.positioningNotes).trim()
      if (notes) bits.push(notes.slice(0, 80))
      return bits.join(' — ')
    })
  if (competitors.length) {
    lines.push(`Local competitors (differentiate against these — do NOT name them in published copy): ${competitors.join('; ')}`)
  }

  const profile = lines.length
    ? `FIRM PROFILE (ground all copy in these specifics — never contradict or generalize away from them):\n${lines.join('\n')}`
    : ''

  const scope = buildContentScopeBlock(schema)
  return [profile, scope].filter(Boolean).join('\n\n')
}

// Hard client-set scope directives captured from the onboarding call. Emphasis
// steers what to prioritize; exclusions are an absolute prohibition — the client
// explicitly told us to leave these out, so no page, section, or sentence may
// mention them. Rendered as its own block so it survives prompt truncation and
// reads as a rule, not a suggestion.
export function buildContentScopeBlock(schema: SessionSchema): string {
  const emphasis = (schema.business?.contentEmphasis ?? []).filter(Boolean)
  const exclusions = (schema.business?.contentExclusions ?? []).filter(Boolean)
  if (!emphasis.length && !exclusions.length) return ''
  const lines: string[] = ['CONTENT SCOPE (client directives — obey exactly):']
  if (emphasis.length) lines.push(`Emphasize / prioritize: ${emphasis.join(', ')}.`)
  if (exclusions.length) {
    lines.push(
      `DO NOT create any page, section, or copy about, and never mention: ${exclusions.join(', ')}. ` +
        `The client explicitly excluded these — treat them as off-limits.`,
    )
  }
  return lines.join('\n')
}

export function buildBrandVoiceBlock(schema: SessionSchema): string {
  const personality = str(schema.brand?.brandPersonality).trim()
  const example = str(schema.brand?.voiceExample).trim()
  return `BRAND VOICE:
${schema.brand?.currentTone ?? 'Professional and approachable'} | Aspirational: ${schema.brand?.aspirationalTone ?? ''}
Tone adjectives: ${schema.brand?.toneAdjectives?.join(', ') ?? ''}
Avoid: ${schema.brand?.toneToAvoid?.join(', ') ?? ''}
${personality ? `Personality: ${personality}\n` : ''}Positioning: ${schema.business?.positioningOption ?? ''} — ${str(schema.business?.positioningStatement).slice(0, 300)}
${example ? `\nVOICE EXAMPLE (match this writing style, do not copy it verbatim):\n${example.slice(0, 600)}\n` : ''}
DIFFERENTIATORS (use these specifically, do not generalize):
${schema.business?.differentiators ?? 'Not specified'}

CREDENTIALS TO FEATURE:
${buildCredentials(schema)}`
}
