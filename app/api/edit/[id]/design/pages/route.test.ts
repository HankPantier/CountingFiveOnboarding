import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const SID = '7ce3c00a-f6ad-41f3-86cc-6bdfc3af7184'

const m = vi.hoisted(() => ({
  gate: vi.fn(),
  listTree: vi.fn(),
  effective: vi.fn(),
}))

vi.mock('../_design', () => ({ requireDesignAdmin: (id: string) => m.gate(id) }))
vi.mock('@/lib/github/repo-files', async (orig) => ({ ...((await orig()) as object), listTree: (...a: unknown[]) => m.listTree(...a) }))
vi.mock('@/lib/design/capabilities-read', () => ({ readEffectiveCapabilities: (a: unknown) => m.effective(a) }))

import { DEFAULT_CAPABILITIES } from '@/lib/design/run-types'
import { GET } from './route'

const params = { params: Promise.resolve({ id: SID }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.gate.mockResolvedValue({ sessionId: SID, jobId: 'job-1', githubRepo: 'o/r', adminId: 'admin-1', user: { isAdmin: true } })
  m.listTree.mockResolvedValue([{ type: 'blob', path: 'content/pages/home.md' }])
  m.effective.mockResolvedValue({ draft: DEFAULT_CAPABILITIES, effective: DEFAULT_CAPABILITIES })
})

describe('GET /design/pages', () => {
  it('passes the gate response through for non-admins', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await GET(new Request('http://x/api'), params)
    expect(res.status).toBe(403)
    expect(m.listTree).not.toHaveBeenCalled()
  })

  it('omits the specimen pick when the effective tier is below L4', async () => {
    const res = await GET(new Request('http://x/api'), params)
    const body = await res.json()
    expect(body.picks.map((p: { key: string }) => p.key)).not.toContain('specimen')
    expect(m.effective).toHaveBeenCalledWith({ githubRepo: 'o/r', jobId: 'job-1' })
  })

  it('offers the specimen pick when the effective tier is L4', async () => {
    m.effective.mockResolvedValue({
      draft: { ...DEFAULT_CAPABILITIES, level: 4, capabilities: ['fonts', 'style-axes', 'specimen'] },
      effective: { ...DEFAULT_CAPABILITIES, level: 4, capabilities: ['fonts', 'style-axes', 'specimen'] },
    })
    const res = await GET(new Request('http://x/api'), params)
    const body = await res.json()
    expect(body.picks.at(-1)).toEqual({ key: 'specimen', path: '/design-specimen' })
  })

  it('hides raw errors behind a generic 500', async () => {
    m.listTree.mockRejectedValue(new Error('GitHub 502 secret detail'))
    const res = await GET(new Request('http://x/api'), params)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to list the site pages' })
  })
})
