import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { paletteSummary, typographySummary, toPaletteData, syncMbpTheme } from './sync-mbp-theme'

vi.mock('@/lib/session/schema-cas', () => ({ updateSessionWithCas: vi.fn(async () => null) }))

const palette = {
  primary: '#003b71',
  secondary: '#e8eef5',
  complementary: '#c46a2b',
  action: '#00c1de',
  nearBlack: '#101820',
  nearWhite: '#fafaf7',
}

describe('MBP theme summaries', () => {
  it('summarises the palette in role order', () => {
    expect(paletteSummary(palette)).toBe(
      'primary: #003b71, secondary: #e8eef5, complementary: #c46a2b, action: #00c1de, nearBlack: #101820, nearWhite: #fafaf7'
    )
  })

  it('summarises typography', () => {
    expect(typographySummary({ headingFont: 'Fraunces', bodyFont: 'Public Sans', accentFont: 'Fraunces', googleFontsUrl: 'x' })).toBe(
      'Headings: Fraunces · Body: Public Sans · Accent: Fraunces'
    )
  })

  it('keeps existing swatch names and falls back to the role', () => {
    const out = toPaletteData(palette, { primary: { hex: '#000000', name: 'Harbor Navy' } } as never)
    expect(out.primary).toEqual({ hex: '#003b71', name: 'Harbor Navy' })
    expect(out.action).toEqual({ hex: '#00c1de', name: 'action' })
  })
})

describe('syncMbpTheme palette read failure', () => {
  function fakeSupabase(readResult: { data: unknown; error: { message: string } | null }) {
    const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }))
    const client = {
      from: vi.fn(() => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => readResult }) }),
        update,
      })),
    }
    return { client: client as unknown as SupabaseClient<Database>, update }
  }
  const brand = { palette } as never

  it('does not overwrite swatch names when the palette read errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client, update } = fakeSupabase({ data: null, error: { message: 'blip' } })
    await syncMbpTheme(client, { sessionId: 's', jobId: 'j', brand })
    expect(update).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('re-keys and writes the palette on a clean read', async () => {
    const { client, update } = fakeSupabase({
      data: { palette: { primary: { hex: '#000000', name: 'Harbor Navy' } } },
      error: null,
    })
    await syncMbpTheme(client, { sessionId: 's', jobId: 'j', brand })
    expect(update).toHaveBeenCalledTimes(1)
    const written = (update.mock.calls[0] as unknown as [{ palette: Record<string, { name: string }> }])[0]
    expect(written.palette.primary.name).toBe('Harbor Navy')
  })
})
