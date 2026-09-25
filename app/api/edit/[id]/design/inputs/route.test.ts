import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { OTHER_SID, SID, makeInputRow } from '@/lib/design/__fixtures__/rows'

const m = vi.hoisted(() => ({
  gate: vi.fn(),
  listInputs: vi.fn(),
  createInput: vi.fn(),
  sign: vi.fn(async (_s: unknown, paths: string[]) => Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`]))),
}))

vi.mock('../_design', () => ({ requireDesignAdmin: (id: string) => m.gate(id) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/design/store', () => ({
  listInputs: (...a: unknown[]) => m.listInputs(...a),
  createInput: (...a: unknown[]) => m.createInput(...a),
}))
vi.mock('@/lib/design/storage', () => ({ signDesignPaths: (s: unknown, p: string[]) => m.sign(s, p) }))

import { GET, POST } from './route'

const params = { params: Promise.resolve({ id: SID }) }
const post = (body: string) => POST(new Request('http://x/api', { method: 'POST', body }), params)
const postJson = (body: unknown) => post(JSON.stringify(body))

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.gate.mockReset().mockResolvedValue({ sessionId: SID, githubRepo: 'o/r', adminId: 'admin-1', user: { isAdmin: true } })
  m.listInputs.mockReset().mockResolvedValue([makeInputRow({ storage_path: `design/${SID}/inputs/a.webp` })])
  m.createInput.mockReset().mockImplementation(async (_db: unknown, input: { kind: string; url: string; label: string | null }) =>
    makeInputRow({ kind: input.kind, url: input.url, label: input.label })
  )
})

describe('GET /design/inputs', () => {
  it('returns the gate response for non-admins', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await GET(new Request('http://x/api'), params)).status).toBe(403)
    expect(m.listInputs).not.toHaveBeenCalled()
  })

  it('lists inputs with signed thumbnails', async () => {
    const res = await GET(new Request('http://x/api'), params)
    expect(res.status).toBe(200)
    expect((await res.json()).inputs[0].thumbnailUrl).toBe(`https://signed/design/${SID}/inputs/a.webp`)
    expect(m.listInputs).toHaveBeenCalledWith({}, SID)
  })
})

describe('POST /design/inputs', () => {
  it('returns the gate response for non-admins', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await postJson({ kind: 'competitor_url', url: 'acme.com' })).status).toBe(403)
    expect(m.createInput).not.toHaveBeenCalled()
  })

  it.each([
    ['malformed JSON', 'not json'],
    ['an array body', '[]'],
    ['an upload-only kind', JSON.stringify({ kind: 'inspiration_image', url: 'https://acme.com' })],
    ['an unknown kind', JSON.stringify({ kind: 'blog', url: 'https://acme.com' })],
    ['an ftp url', JSON.stringify({ kind: 'competitor_url', url: 'ftp://acme.com/' })],
    ['credentials', JSON.stringify({ kind: 'competitor_url', url: 'https://u:p@acme.com/' })],
    ['an over-long url', JSON.stringify({ kind: 'competitor_url', url: 'https://acme.com/' + 'a'.repeat(300) })],
    ['an over-long label', JSON.stringify({ kind: 'competitor_url', url: 'acme.com', label: 'x'.repeat(121) })],
    ['non-text notes', JSON.stringify({ kind: 'competitor_url', url: 'acme.com', notes: 5 })],
  ])('rejects %s with 400', async (_label, body) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect(m.createInput).not.toHaveBeenCalled()
  })

  it('creates a normalized URL input in the gated session (ignores a client session id)', async () => {
    const res = await postJson({ kind: 'competitor_url', url: 'acme.example.com', label: ' Acme CPA ', session_id: OTHER_SID })
    expect(res.status).toBe(201)
    expect(m.createInput).toHaveBeenCalledWith(
      {},
      { sessionId: SID, kind: 'competitor_url', url: 'https://acme.example.com/', label: 'Acme CPA', notes: null, createdBy: 'admin-1' }
    )
    expect((await res.json()).input.url).toBe('https://acme.example.com/')
  })

  it('hides raw errors behind a generic 500', async () => {
    m.createInput.mockRejectedValue(new Error('duplicate key value violates constraint'))
    const res = await postJson({ kind: 'current_site', url: 'bblcpa.com' })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to add the input' })
  })
})
