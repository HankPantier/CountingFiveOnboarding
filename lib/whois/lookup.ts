import { whoisDomain, firstResult } from 'whoiser'
import { createServerClient } from '@/lib/supabase/server'
import { asJson } from '@/lib/supabase/json-typed'
import { updateSessionWithCas } from '@/lib/session/schema-cas'

export async function runWhoisLookup(sessionId: string, domain: string): Promise<void> {
  const supabase = createServerClient()
  let technicalData: Record<string, unknown> = {}

  try {
    const cleanDomain = domain
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '')
      .split('/')[0]

    const result = await whoisDomain(cleanDomain, { timeout: 8000 })
    const first = firstResult(result)

    technicalData = {
      registrar: (first?.['Registrar'] as string) ?? '',
      registrationDate:
        (first?.['Created Date'] as string) ??
        (first?.['Creation Date'] as string) ?? '',
      expiryDate:
        (first?.['Expiry Date'] as string) ??
        (first?.['Registry Expiry Date'] as string) ?? '',
      nameservers: Array.isArray(first?.['Name Server'])
        ? (first['Name Server'] as string[])
        : [],
    }
  } catch (err) {
    console.warn('[WHOIS] Lookup failed for domain:', domain, err)
    // Non-fatal — advance to Phase 3 with empty technical fields
  }

  // Compare-and-swap onto the fresh row. Only a session still on Phase 2 is
  // advanced: if it has moved on (a concurrent run, a manual advance), this
  // lookup is stale — don't clobber the phase or overwrite newer schema_data.
  let advanced: boolean
  try {
    advanced = await updateSessionWithCas(supabase, sessionId, session => {
      if (session.current_phase !== 2) return { skip: true, result: false }

      const currentSchema = (session.schema_data as Record<string, unknown>) ?? {}
      const currentTechnical = (currentSchema.technical as Record<string, unknown>) ?? {}

      // Only fill WHOIS fields that came back non-empty so an empty lookup doesn't
      // wipe values the audit draft already seeded (registrationDate, hosting).
      const mergedTechnical = { ...currentTechnical }
      for (const [k, v] of Object.entries(technicalData)) {
        if (Array.isArray(v) ? v.length > 0 : v) mergedTechnical[k] = v
      }

      return {
        update: { schema_data: asJson({ ...currentSchema, technical: mergedTechnical }), current_phase: 3 },
        result: true,
      }
    })
  } catch (err) {
    // CLAUDE.md requires WHOIS to advance to Phase 3 regardless. We couldn't
    // safely merge the schema, so advance the phase alone (the phase guard keeps
    // it a no-op if the row already moved on).
    console.warn('[WHOIS] Schema write failed — advancing phase without schema write:', err)
    await supabase
      .from('sessions')
      .update({ current_phase: 3 })
      .eq('id', sessionId)
      .eq('current_phase', 2)
    return
  }

  if (!advanced) {
    console.warn('[WHOIS] Session', sessionId, 'no longer on Phase 2 — skipping write')
    return
  }
  console.warn('[WHOIS] Done for session', sessionId, '— advanced to Phase 3')
}
