import type { SessionSchema } from '@/types/session-schema'

// Shared brand-voice prompt fragments. Extracted from content-generator.ts so
// the page generator and the Resources blog generators describe the firm's
// voice identically — one source of truth for "on-brand."

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

  const services = (schema.services ?? [])
    .filter(s => s.name)
    .map(s => (s.description ? `${s.name} (${s.description.slice(0, 80)})` : s.name))
  if (services.length) lines.push(`Services: ${services.join('; ')}`)

  const niches = (schema.niches ?? []).map(n => n.name).filter(Boolean)
  if (niches.length) lines.push(`Niches served: ${niches.join(', ')}`)

  return lines.length
    ? `FIRM PROFILE (ground all copy in these specifics — never contradict or generalize away from them):\n${lines.join('\n')}`
    : ''
}

export function buildBrandVoiceBlock(schema: SessionSchema): string {
  const personality = schema.brand?.brandPersonality?.trim()
  const example = schema.brand?.voiceExample?.trim()
  return `BRAND VOICE:
${schema.brand?.currentTone ?? 'Professional and approachable'} | Aspirational: ${schema.brand?.aspirationalTone ?? ''}
Tone adjectives: ${schema.brand?.toneAdjectives?.join(', ') ?? ''}
Avoid: ${schema.brand?.toneToAvoid?.join(', ') ?? ''}
${personality ? `Personality: ${personality}\n` : ''}Positioning: ${schema.business?.positioningOption ?? ''} — ${schema.business?.positioningStatement?.slice(0, 300) ?? ''}
${example ? `\nVOICE EXAMPLE (match this writing style, do not copy it verbatim):\n${example.slice(0, 600)}\n` : ''}
DIFFERENTIATORS (use these specifically, do not generalize):
${schema.business?.differentiators ?? 'Not specified'}

CREDENTIALS TO FEATURE:
${buildCredentials(schema)}`
}
