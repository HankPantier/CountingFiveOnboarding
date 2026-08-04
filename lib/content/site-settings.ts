// ---------------------------------------------------------------------------
// Per-client site settings (currently the booking/scheduling config that powers
// the contact drawer's "Book a call"). DB row is the pre-publish source of
// truth; for published clients the repo's site.config.ts is authoritative and
// we seed-from-repo / push-to-draft (see site-settings-repo-sync.ts).
// ---------------------------------------------------------------------------
import { createServerClient } from '@/lib/supabase/server'

export type BookingProvider = 'none' | 'calendly' | 'iframe'

export interface SiteSettings {
  bookingProvider: BookingProvider
  bookingUrl: string
}

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  bookingProvider: 'none',
  bookingUrl: '',
}

const PROVIDERS: BookingProvider[] = ['none', 'calendly', 'iframe']

// Coerce arbitrary input to a valid SiteSettings. A non-https url or a blank
// url downgrades the provider to 'none' so we never ship a broken widget.
export function normalizeSiteSettings(raw: unknown): SiteSettings {
  const obj = (raw ?? {}) as Record<string, unknown>
  let provider: BookingProvider = PROVIDERS.includes(obj.bookingProvider as BookingProvider)
    ? (obj.bookingProvider as BookingProvider)
    : 'none'
  let url = typeof obj.bookingUrl === 'string' ? obj.bookingUrl.trim().slice(0, 500) : ''
  if (provider !== 'none' && !/^https:\/\/[^\s'"]+$/.test(url)) {
    provider = 'none'
    url = ''
  }
  if (provider === 'none') url = ''
  return { bookingProvider: provider, bookingUrl: url }
}

export type SiteSettingsRecord = SiteSettings & { exists: boolean }

// Service-role read — callers MUST gate with requireSessionAccess first.
export async function getSiteSettings(sessionId: string): Promise<SiteSettingsRecord> {
  const supabase = createServerClient()
  const { data } = await supabase
    .from('site_settings')
    .select('booking_provider, booking_url')
    .eq('session_id', sessionId)
    .maybeSingle()
  if (!data) return { ...DEFAULT_SITE_SETTINGS, exists: false }
  return {
    ...normalizeSiteSettings({ bookingProvider: data.booking_provider, bookingUrl: data.booking_url }),
    exists: true,
  }
}

export async function saveSiteSettings(
  sessionId: string,
  raw: unknown,
  updatedBy: string | null
): Promise<SiteSettings> {
  const settings = normalizeSiteSettings(raw)
  const supabase = createServerClient()
  const { error } = await supabase.from('site_settings').upsert(
    {
      session_id: sessionId,
      booking_provider: settings.bookingProvider,
      booking_url: settings.bookingUrl,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'session_id' }
  )
  if (error) throw new Error(error.message)
  return settings
}
