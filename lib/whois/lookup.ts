import { whoisDomain, firstResult } from 'whoiser'
import { createServerClient } from '@/lib/supabase/server'
import type { Json } from '@/types/database'

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

  const { data: session } = await supabase
    .from('sessions')
    .select('schema_data')
    .eq('id', sessionId)
    .single()

  const currentSchema = (session?.schema_data as Record<string, unknown>) ?? {}
  const currentTechnical = (currentSchema.technical as Record<string, unknown>) ?? {}

  const updatedSchema: Record<string, unknown> = {
    ...currentSchema,
    technical: { ...currentTechnical, ...technicalData },
  }

  await supabase
    .from('sessions')
    .update({ schema_data: updatedSchema as Json, current_phase: 3 })
    .eq('id', sessionId)

  console.log('[WHOIS] Done for session', sessionId, '— advanced to Phase 3')
}
