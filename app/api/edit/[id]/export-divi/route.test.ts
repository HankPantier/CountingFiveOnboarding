import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  job: null as Record<string, unknown> | null,
  user: { isAdmin: true, capabilities: [] as string[] },
  brandJson: null as string | null,
}))

vi.mock('../_helpers', () => ({
  resolveEditContext: vi.fn(async () => ({ sessionId: 'sess-1', jobId: 'job-1', githubRepo: 'o/r', user: h.user })),
}))
vi.mock('@/lib/github/repo-files', () => ({
  DRAFT_BRANCH: 'draft',
  ensureDraftBranch: vi.fn(async () => {
    throw new Error('must not reach GitHub')
  }),
  listTree: vi.fn(),
  readFile: vi.fn(async (_repo: string, path: string) => {
    if (path === 'content/brand.json' && h.brandJson) return { content: h.brandJson, sha: 'b' }
    throw new Error('not found')
  }),
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
import { DESIGN_SYSTEM_REQUIRED_FOR_EXPORT, DESIGN_SYSTEM_REQUIRED_FOR_EXPORT_MEMBER } from '@/lib/content/brand-gate'

describe('GET /api/edit/[id]/export-divi — no silent house-colour fallback', () => {
  it('refuses (409) when the job has no locked palette', async () => {
    h.job = { palette: null }
    const res = await GET(new Request('http://test'), { params: Promise.resolve({ id: 'sess-1' }) })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe(DESIGN_SYSTEM_REQUIRED_FOR_EXPORT)
  })

  it('tells an editor member to ask an admin or manager (they cannot open the job)', async () => {
    h.job = { palette: null }
    h.user = { isAdmin: false, capabilities: ['editor'] }
    const res = await GET(new Request('http://test'), { params: Promise.resolve({ id: 'sess-1' }) })
    expect(((await res.json()) as { error: string }).error).toBe(DESIGN_SYSTEM_REQUIRED_FOR_EXPORT_MEMBER)
    h.user = { isAdmin: true, capabilities: [] }
  })

  it('passes the gate on the live brand.json palette even when the job has none (PIPE-4)', async () => {
    h.job = { palette: null }
    const hex = '#123456'
    h.brandJson = JSON.stringify({
      palette: { primary: hex, secondary: hex, complementary: hex, action: hex, nearBlack: hex, nearWhite: hex },
    })
    // Past the gate the route hits the thin mocks and fails there — anything but the 409.
    const outcome = await GET(new Request('http://test'), { params: Promise.resolve({ id: 'sess-1' }) }).then(
      (r) => r.status,
      () => 'past the gate'
    )
    expect(outcome).not.toBe(409)
    h.brandJson = null
  })
})
