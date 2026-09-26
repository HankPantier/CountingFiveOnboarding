// Keep the MBP profile + content_jobs.palette in step with the site's theme
// after a commit to the draft. Shared by the Theme Studio PATCH route and the
// Design Studio apply path. Best-effort: the repo commit already landed, so a
// sync failure is logged, never thrown.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'
import type { PaletteData } from '@/types/palette'
import { PALETTE_ROLES } from '@/lib/editor/theme-edit'
import { deepSetPath } from '@/lib/mbp/schema-write'
import { asJson } from '@/lib/supabase/json-typed'
import { updateSessionWithCas } from '@/lib/session/schema-cas'
import { normalizeTypography } from '@/app/api/edit/[id]/theme/_theme'

export function paletteSummary(palette: BrandJson['palette']): string {
  return PALETTE_ROLES.map((r) => `${r}: ${palette[r]}`).join(', ')
}

export function typographySummary(t: DesignJson['typography']): string {
  return `Headings: ${t.headingFont} · Body: ${t.bodyFont} · Accent: ${t.accentFont}`
}

// Re-key the structured content_jobs palette from the new hexes, preserving any
// existing swatch names (fall back to the role name).
export function toPaletteData(palette: BrandJson['palette'], existing: PaletteData | null): PaletteData {
  const out = {} as PaletteData
  for (const role of PALETTE_ROLES) {
    out[role] = { hex: palette[role], name: existing?.[role]?.name ?? role }
  }
  return out
}

// The draft's brand.json + design.json texts → what syncMbpTheme needs, or an
// error when the palette can't be read (the human-clicked "Sync to MBP").
export function parseThemeForMbp(
  brandText: string,
  designText: string
): { ok: true; brand: BrandJson; design: DesignJson } | { ok: false; error: string } {
  let brand: BrandJson
  let design: DesignJson
  try {
    brand = JSON.parse(brandText) as BrandJson
    design = JSON.parse(designText) as DesignJson
  } catch {
    return { ok: false, error: 'brand.json / design.json is not valid JSON.' }
  }
  const palette = brand?.palette as Record<string, unknown> | undefined
  if (!palette || !PALETTE_ROLES.every((r) => typeof palette[r] === 'string')) {
    return { ok: false, error: 'brand.json has no complete palette to mirror.' }
  }
  return { ok: true, brand, design: { ...design, typography: normalizeTypography(design?.typography) } }
}

// Pass `brand` only when the palette changed and `design` only when fonts or
// treatments changed — matching what was actually committed. Resolves true
// when every write it attempted landed (best-effort: never throws).
export async function syncMbpTheme(
  supabase: SupabaseClient<Database>,
  args: { sessionId: string; jobId: string; brand?: BrandJson; design?: DesignJson }
): Promise<boolean> {
  const { sessionId, jobId, brand, design } = args
  if (!brand && !design) return true
  let ok = true
  try {
    await updateSessionWithCas(supabase, sessionId, (session) => {
      let schema = (session.schema_data ?? {}) as Record<string, unknown>
      if (brand) schema = deepSetPath(schema, 'brand.primaryColors', paletteSummary(brand.palette))
      if (design) schema = deepSetPath(schema, 'brand.typography', typographySummary(normalizeTypography(design.typography)))
      return { update: { schema_data: asJson(schema) }, result: null }
    })
  } catch (err) {
    ok = false
    console.warn('[theme] MBP sync failed (theme saved):', err)
  }
  if (brand) {
    try {
      const { data: job, error: readErr } = await supabase
        .from('content_jobs')
        .select('palette')
        .eq('id', jobId)
        .maybeSingle()
      // A failed read must not be mistaken for "no palette": re-keying from
      // null would reset every operator swatch name to its role name.
      if (readErr) {
        console.warn('[theme] content_jobs.palette read failed; palette sync skipped (theme saved):', readErr.message)
        return false
      }
      const nextPalette = toPaletteData(brand.palette, (job?.palette as PaletteData | null) ?? null)
      const { error } = await supabase.from('content_jobs').update({ palette: asJson(nextPalette) }).eq('id', jobId)
      if (error) {
        ok = false
        console.warn('[theme] content_jobs.palette sync failed (theme saved):', error.message)
      }
    } catch (err) {
      ok = false
      console.warn('[theme] content_jobs.palette sync failed (theme saved):', err)
    }
  }
  return ok
}
