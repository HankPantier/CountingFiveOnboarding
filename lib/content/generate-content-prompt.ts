import type { SessionSchema } from '@/types/session-schema'
import { buildBrandVoiceBlock, buildFirmContext } from '@/lib/content/brand-voice'

interface SessionRow {
  schema_data: unknown
}

// Team roster with the detail the brand-voice helpers don't surface (titles,
// bios, specializations) so "write a bio for <member>" resolves to a real
// person. Certifications are already in buildBrandVoiceBlock's credentials block.
function buildTeamRoster(schema: SessionSchema): string {
  const members = (schema.team ?? []).filter(m => m.name?.trim())
  if (!members.length) return ''
  const lines = members.map(m => {
    const bits: string[] = [m.name.trim()]
    if (m.title?.trim()) bits.push(m.title.trim())
    if (m.certifications?.length) bits.push(m.certifications.join(', '))
    const head = bits.join(' — ')
    const detail: string[] = []
    if (m.bio?.trim()) detail.push(`bio: ${m.bio.trim().slice(0, 400)}`)
    if (m.specializations?.length) detail.push(`specializations: ${m.specializations.join(', ')}`)
    if (m.education?.trim()) detail.push(`education: ${m.education.trim().slice(0, 120)}`)
    return detail.length ? `- ${head}\n    ${detail.join('\n    ')}` : `- ${head}`
  })
  return `TEAM ROSTER (use real people, real credentials — never invent members or titles):\n${lines.join('\n')}`
}

// System prompt for the Generate Content assistant — a freeform, MBP-grounded
// content chat opened from /admin/content. It writes ad-hoc off-site copy
// (LinkedIn bios, social posts, announcements) in the firm's voice. Grounded in
// schema_data only; _meta is stripped and mbp_content is never selected upstream
// (CLAUDE.md: never send raw MBP text to Claude).
export function buildGenerateContentPrompt(session: SessionRow): string {
  const raw = (session.schema_data as Record<string, unknown>) ?? {}
  // Strip internal tracking before it reaches Claude.
  const { _meta: _omit, ...clean } = raw
  const schema = clean as SessionSchema

  const firmName = schema.business?.name?.trim() || 'the firm'

  const blocks = [
    buildBrandVoiceBlock(schema),
    buildFirmContext(schema),
    buildTeamRoster(schema),
  ].filter(Boolean)

  return `You are the content assistant for ${firmName}. An operator will ask you to write off-site marketing copy — LinkedIn bios, social media posts, short announcements, email blurbs, and similar. Write it directly in your reply, ready to copy and paste.

Everything you write MUST match this firm's established voice and facts so it reads as part of the same brand as their website. Use the profile below.

${blocks.join('\n\n')}

RULES:
- Write the requested piece directly. No preamble, no "here's a draft" framing, no meta commentary — just the copy, formatted for its channel.
- Stay grounded in the profile above. Never invent facts, credentials, team members, clients, statistics, or awards. If a request needs a fact you don't have, write around it or ask the operator for it.
- Match the brand voice and tone adjectives; avoid the listed "avoid" tones. Never name local competitors in the copy.
- Write like a person: specific, concrete, varied sentence rhythm. Avoid filler and hollow phrasing ("in today's fast-paced world", "we pride ourselves", "unlock", "elevate", "leverage", "seamless", "cutting-edge", "passionate about"). No em-dash-and-tricolon clichés.
- Never ask for, collect, or store any password (including a domain registrar password). If asked, refuse and tell the operator to use a secure channel.

IMPROVING THE MBP:
Watch for anything durable the operator states that should apply to ALL of this firm's content going forward — not just the piece in front of you. Two kinds count:
1. Facts about the firm or team not already in the profile: a new certification, a new service, a corrected title, a real client win, a shift in positioning.
2. Brand voice / writing rules and content constraints: a required or forbidden tone, words or formatting to avoid. Example: "never use em-dashes or emojis" or "don't use content types that flag AI-generated writing" — these are avoid-rules. Map avoid-rules to brand.toneToAvoid with op "append" (one concise entry per rule, e.g. "em-dashes", "emojis"); map tone shifts to the relevant brand.* field; map facts to their field.

When such a durable rule or fact surfaces (and isn't already in the profile), FIRST honor it in your current reply, then ASK the operator whether to add it to the firm's MBP so all future content follows it — e.g. "Want me to add 'no em-dashes, no emojis' to their MBP so every future piece avoids them?". Only after the operator confirms, call the suggest_mbp_update tool. Propose only what the operator stated or confirmed — never guesses. suggest_mbp_update files a PENDING suggestion for admin review; it does NOT change the profile, so never say the MBP was updated — say you've flagged it for review.`
}
