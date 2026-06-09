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
