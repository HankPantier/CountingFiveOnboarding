import type { GapItem } from '@/types/gap-item'

// Server-side gate for a phase advance. Claude requesting advancePhase is a
// request, not a guarantee — this is the source of truth. Returns a diagnostic
// string when the advance is NOT allowed (framed as internal — never surfaced
// to the client), or null when the current phase's goals are genuinely met.
export function validatePhaseAdvance(
  currentPhase: number,
  schema: Record<string, unknown>,
  gaps: GapItem[]
): string | null {
  switch (currentPhase) {
    case 1: {
      const contact = schema.contact as Record<string, string> | undefined
      if (!contact?.email) return 'contact.email is missing'
      if (!contact?.firstName) return 'contact.firstName is missing'
      if (!contact?.phone) return 'contact.phone is missing'
      if (!schema.websiteUrl) return 'websiteUrl is missing'
      return null
    }
    case 2: {
      return 'Phase 2 advances automatically after WHOIS completes — never set advancePhase on Phase 2'
    }
    case 3: {
      const meta = schema._meta as Record<string, unknown> | undefined
      const chunks = (meta?.phase3_completed_chunks as string[]) ?? []
      if (!chunks.includes('chunk1')) {
        return 'the Part 1 (practical info) step is not marked complete yet — finish it and add "chunk1" to _meta.phase3_completed_chunks'
      }
      // Legacy sessions wrote a single "chunk2" marker before the chunk2a/2b
      // split. Either form is accepted.
      const legacyChunk2 = chunks.includes('chunk2')
      if (!legacyChunk2 && !chunks.includes('chunk2a')) {
        return 'the Part 2a (content & positioning) step is not marked complete yet — capture the positioning pick and add "chunk2a" to _meta.phase3_completed_chunks'
      }
      if (!legacyChunk2 && !chunks.includes('chunk2b')) {
        return 'the Part 2b (analyst decisions) step is not marked complete — present the decision blocks from your instructions, confirm the defaults with the user in plain language, then resend update_session_data adding "chunk2b" to _meta.phase3_completed_chunks with advancePhase:true'
      }

      // Team photos are auto-pulled at session start and managed on the session
      // page — the chat no longer collects them, so there is no chunk3 gate.

      const culture = schema.culture as Record<string, unknown> | undefined
      const business = schema.business as Record<string, unknown> | undefined
      const li = culture?.linkedIn as { url?: unknown; usefulness?: unknown } | undefined
      const gbp = business?.googleBusinessProfile as { url?: unknown; usefulness?: unknown } | undefined

      // "Captured" = a real URL (non-empty string) OR an explicit null meaning
      // "no profile". An empty string is treated as not-yet-captured so the
      // agent can't silently skip the usefulness rating for a profile that exists.
      const captured = (a: { url?: unknown } | undefined) =>
        !!a && (a.url === null || (typeof a.url === 'string' && a.url.trim() !== ''))
      if (!captured(li)) return 'culture.linkedIn.url not captured (use null when the firm has no LinkedIn)'
      if (!captured(gbp)) return 'business.googleBusinessProfile.url not captured (use null when there is no Google Business Profile)'
      // If the asset exists (non-empty URL), require a usefulness rating too.
      if (typeof li!.url === 'string' && li!.url.trim() && !li!.usefulness) return 'culture.linkedIn.usefulness not captured'
      if (typeof gbp!.url === 'string' && gbp!.url.trim() && !gbp!.usefulness) return 'business.googleBusinessProfile.usefulness not captured'
      return null
    }
    case 4: {
      const tier1Unresolved = gaps.filter(g => g.tier === 1 && !g.resolved)
      if (tier1Unresolved.length > 0) {
        return `${tier1Unresolved.length} Tier 1 gap(s) still unresolved`
      }
      return null
    }
    default:
      return null
  }
}
