import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { SID } from '@/lib/design/__fixtures__/rows'
import { BRAND_TEXT, DESIGN_TEXT } from '@/lib/design/__fixtures__/theme-texts'
import { generateDesignMd, hashDesignMd } from '@/lib/design/design-md-adopt'

const m = vi.hoisted(() => ({
  gate: vi.fn(),
  snapshot: vi.fn(),
  readOptional: vi.fn(),
  schema: vi.fn(),
  latest: vi.fn(),
  writeFiles: vi.fn(),
}))

vi.mock('../_design', () => ({ requireDesignAdmin: (id: string) => m.gate(id) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/design/theme-snapshot', async (orig) => ({ ...((await orig()) as object), readDraftThemeSnapshot: (...a: unknown[]) => m.snapshot(...a) }))
vi.mock('@/lib/design/store', () => ({ readSessionSchema: (...a: unknown[]) => m.schema(...a), latestVersion: (...a: unknown[]) => m.latest(...a) }))
vi.mock('@/lib/github/repo-files', async (orig) => {
  const real = (await orig()) as typeof import('@/lib/github/repo-files')
  return {
    ...real,
    writeFiles: (...a: unknown[]) => m.writeFiles(...a),
    // readOptional-style fake: null content ⇒ the file is absent.
    readFile: async (_repo: string, path: string) => {
      const f = (await m.readOptional()) as { content: string; sha: string } | null
      if (!f) throw new real.FileNotFoundError(path)
      return { path, ...f }
    },
  }
})

import { StaleShaError } from '@/lib/github/repo-files'
import { GET, POST } from './route'

const params = { params: Promise.resolve({ id: SID }) }
const CTX = { sessionId: SID, jobId: 'job-1', githubRepo: 'o/r', adminId: 'admin-1', adminEmail: 'a@x.com', user: { isAdmin: true } }
const BRAND_SHA = 'a'.repeat(40)
const DESIGN_SHA = 'b'.repeat(40)
const SNAP = {
  shas: { 'content/brand.json': BRAND_SHA, 'content/design.json': DESIGN_SHA },
  texts: { 'content/brand.json': BRAND_TEXT, 'content/design.json': DESIGN_TEXT },
}
const GUARDS = [
  { path: 'content/brand.json', content: BRAND_TEXT, expectedSha: BRAND_SHA },
  { path: 'content/design.json', content: DESIGN_TEXT, expectedSha: DESIGN_SHA },
]
const SHA = 'c'.repeat(40)
const HAND = '# Our brand\n\nNavy and gold.\n'
const NEXT = (() => {
  const g = generateDesignMd({ brandText: BRAND_TEXT, designText: DESIGN_TEXT, schema: { business: { name: 'Acme CPA' } } })
  if (!g.ok) throw new Error(g.error)
  return g.text
})()
const post = (body: unknown) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), params)

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.gate.mockResolvedValue(CTX)
  m.snapshot.mockResolvedValue(SNAP)
  m.readOptional.mockResolvedValue({ content: HAND, sha: SHA })
  m.schema.mockResolvedValue({ business: { name: 'Acme CPA' } })
  m.latest.mockResolvedValue(null)
  m.writeFiles.mockResolvedValue({ commitSha: 'commit-1', blobs: {} })
})

describe('design/design-md route', () => {
  it('both methods pass the admin gate through (members, editors, owners never reach it)', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await GET(new Request('http://x'), params)).status).toBe(403)
    expect((await post({ expectedSha: SHA, nextHash: hashDesignMd(NEXT) })).status).toBe(403)
    expect(m.writeFiles).not.toHaveBeenCalled()
  })

  it('GET previews the change and never writes', async () => {
    const res = await GET(new Request('http://x'), params)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { path: string; state: string; currentSha: string; nextHash: string; next: string; added: number; removed: number }
    expect(body).toMatchObject({ path: 'content/design.md', state: 'hand-written', currentSha: SHA, nextHash: hashDesignMd(NEXT), next: NEXT })
    expect(body.removed).toBeGreaterThan(0)
    expect(body.added).toBeGreaterThan(0)
    expect(m.writeFiles).not.toHaveBeenCalled()
  })

  it('POST commits exactly the reviewed text, guarded by the reviewed blob sha + brand.json/design.json unchanged', async () => {
    const res = await post({ expectedSha: SHA, nextHash: hashDesignMd(NEXT) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, commitSha: 'commit-1' })
    const [repo, files, branch] = m.writeFiles.mock.calls[0] as [string, { path: string; content: string; expectedSha: string | null }[], string]
    expect(repo).toBe('o/r')
    expect(branch).toBe('draft')
    expect(files).toEqual([{ path: 'content/design.md', content: NEXT, expectedSha: SHA }, ...GUARDS])
  })

  it('POST creates a missing file with a must-not-exist guard', async () => {
    m.readOptional.mockResolvedValue(null)
    expect((await post({ expectedSha: null, nextHash: hashDesignMd(NEXT) })).status).toBe(200)
    expect((m.writeFiles.mock.calls[0] as unknown[])[1]).toEqual([{ path: 'content/design.md', content: NEXT, expectedSha: null }, ...GUARDS])
  })

  it('POST refuses when the theme or the file changed since the preview (409, nothing written)', async () => {
    expect((await post({ expectedSha: SHA, nextHash: 'd'.repeat(64) })).status).toBe(409)
    expect((await post({ expectedSha: 'e'.repeat(40), nextHash: hashDesignMd(NEXT) })).status).toBe(409)
    expect(m.writeFiles).not.toHaveBeenCalled()
  })

  it('POST maps a concurrent edit (stale guard) to 409 — design.md, or a theme change to brand.json / design.json', async () => {
    m.writeFiles.mockRejectedValueOnce(new StaleShaError('content/design.md', 'f'.repeat(40), 'x'))
    expect((await post({ expectedSha: SHA, nextHash: hashDesignMd(NEXT) })).status).toBe(409)
    m.writeFiles.mockRejectedValueOnce(new StaleShaError('content/brand.json', 'f'.repeat(40), '{}'))
    expect((await post({ expectedSha: SHA, nextHash: hashDesignMd(NEXT) })).status).toBe(409)
  })

  it('POST refuses when design.md already matches', async () => {
    m.readOptional.mockResolvedValue({ content: NEXT, sha: SHA })
    expect((await post({ expectedSha: SHA, nextHash: hashDesignMd(NEXT) })).status).toBe(409)
    expect(m.writeFiles).not.toHaveBeenCalled()
  })

  it('POST validates its body', async () => {
    expect((await post({ expectedSha: 'nope', nextHash: hashDesignMd(NEXT) })).status).toBe(400)
    expect((await post({ expectedSha: SHA })).status).toBe(400)
    expect((await post(null)).status).toBe(400)
  })
})
