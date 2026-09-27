import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ job: null as Record<string, unknown> | null }))

vi.mock('../_helpers', () => ({
  resolveEditContext: vi.fn(async () => ({ sessionId: 'sess-1', jobId: 'job-1', githubRepo: 'o/r' })),
}))
vi.mock('@/lib/github/repo-files', () => ({
  DRAFT_BRANCH: 'draft',
  ensureDraftBranch: vi.fn(async () => {
    throw new Error('must not reach GitHub')
  }),
  listTree: vi.fn(),
  readFile: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { website_url: 'https://x.com', schema_data: {} } }),
          maybeSingle: async () => ({ data: table === 'content_jobs' ? h.job : null }),
        }),
      }),
    }),
  }),
}))

import { GET } from './route'
import { DESIGN_SYSTEM_REQUIRED_FOR_EXPORT } from '@/lib/content/brand-gate'

describe('GET /api/edit/[id]/export-divi — no silent house-colour fallback', () => {
  it('refuses (409) when the job has no locked palette', async () => {
    h.job = { palette: null }
    const res = await GET(new Request('http://test'), { params: Promise.resolve({ id: 'sess-1' }) })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe(DESIGN_SYSTEM_REQUIRED_FOR_EXPORT)
  })
})
