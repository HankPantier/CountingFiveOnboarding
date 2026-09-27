import { beforeEach, describe, expect, it, vi } from 'vitest'

// The brand gate is the FIRST check after the job loads: a job without a locked
// Design System never reaches pages, stock photos, docx or storage.
const h = vi.hoisted(() => ({
  job: null as Record<string, unknown> | null,
  tablesRead: [] as string[],
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => {
      h.tablesRead.push(table)
      return {
        select: () => ({
          eq: () => ({
            single: async () => (table === 'content_jobs' ? { data: h.job } : { data: null }),
          }),
        }),
      }
    },
  }),
}))

import { assembleContentPackage } from './package-assembler'
import { DESIGN_SYSTEM_REQUIRED_FOR_PACKAGE } from './brand-gate'

const PALETTE = Object.fromEntries(
  ['primary', 'secondary', 'complementary', 'action', 'nearBlack', 'nearWhite'].map((r) => [r, { hex: '#123456', name: r }]),
)
const TOKENS = { typePairing: { id: 'x', headingFont: 'Inter', bodyFont: 'Inter', label: 'Inter' } }
const baseJob = { session_id: 's', confirmed_sitemap: [], nav_config: null, github_repo: null }

beforeEach(() => {
  h.tablesRead = []
})

describe('assembleContentPackage — brand gate', () => {
  it.each([
    ['no palette', { palette: null, design_tokens: TOKENS }],
    ['no tokens', { palette: PALETTE, design_tokens: null }],
  ])('refuses (409) a job with %s, before touching anything else', async (_label, brand) => {
    h.job = { ...baseJob, ...brand }
    const res = await assembleContentPackage('job-1', { name: 'op', email: null })
    expect(res).toEqual({ ok: false, status: 409, error: DESIGN_SYSTEM_REQUIRED_FOR_PACKAGE })
    expect(h.tablesRead).toEqual(['content_jobs'])
  })

  it('lets a locked job past the gate (fails later on the missing session, not the brand)', async () => {
    h.job = { ...baseJob, palette: PALETTE, design_tokens: TOKENS }
    const res = await assembleContentPackage('job-1', { name: 'op', email: null })
    expect(res).toMatchObject({ ok: false, status: 404, error: 'Session not found' })
  })
})
