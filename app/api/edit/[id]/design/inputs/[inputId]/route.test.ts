import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { IID, SID, makeInputRow } from '@/lib/design/__fixtures__/rows'

const m = vi.hoisted(() => ({
  gate: vi.fn(),
  updateInput: vi.fn(),
  deleteInput: vi.fn(),
  sign: vi.fn(async (_s: unknown, paths: string[]) => Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`]))),
}))

vi.mock('../../_design', () => ({ requireDesignAdmin: (id: string) => m.gate(id) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/design/store', () => ({
  updateInput: (...a: unknown[]) => m.updateInput(...a),
  deleteInput: (...a: unknown[]) => m.deleteInput(...a),
}))
vi.mock('@/lib/design/storage', () => ({ signDesignPaths: (s: unknown, p: string[]) => m.sign(s, p) }))

import { DELETE, PATCH } from './route'

const ctxFor = (inputId: string) => ({ params: Promise.resolve({ id: SID, inputId }) })
const patch = (body: unknown, inputId = IID) =>
  PATCH(new Request('http://x/api', { method: 'PATCH', body: JSON.stringify(body) }), ctxFor(inputId))
const del = (inputId = IID) => DELETE(new Request('http://x/api', { method: 'DELETE' }), ctxFor(inputId))

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.gate.mockReset().mockResolvedValue({ sessionId: SID, githubRepo: 'o/r', adminId: 'admin-1', user: { isAdmin: true } })
  m.updateInput.mockReset().mockResolvedValue(makeInputRow({ label: 'New', archived: true }))
  m.deleteInput.mockReset().mockResolvedValue(true)
})

describe('PATCH /design/inputs/[inputId]', () => {
  it('returns the gate response for non-admins', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await patch({ label: 'x' })).status).toBe(403)
    expect(m.updateInput).not.toHaveBeenCalled()
  })

  it.each([
    ['a non-uuid id', { label: 'x' }, 'upload'],
    ['an empty body', {}, IID],
    ['archived not boolean', { archived: 'yes' }, IID],
    ['over-long notes', { notes: 'x'.repeat(2001) }, IID],
    ['non-text label', { label: 42 }, IID],
  ])('rejects %s with 400', async (_l, body, inputId) => {
    expect((await patch(body, inputId)).status).toBe(400)
    expect(m.updateInput).not.toHaveBeenCalled()
  })

  it('404s for an input outside this session', async () => {
    m.updateInput.mockResolvedValue(null)
    const res = await patch({ label: 'x' })
    expect(res.status).toBe(404)
    expect(m.updateInput).toHaveBeenCalledWith({}, SID, IID, { label: 'x' })
  })

  it('updates label, notes and archived', async () => {
    const res = await patch({ label: ' New ', notes: '', archived: true })
    expect(res.status).toBe(200)
    expect(m.updateInput).toHaveBeenCalledWith({}, SID, IID, { label: 'New', notes: null, archived: true })
    expect((await res.json()).input).toMatchObject({ label: 'New', archived: true })
  })

  it('hides raw errors behind a generic 500', async () => {
    m.updateInput.mockRejectedValue(new Error('boom'))
    const res = await patch({ archived: false })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to update the input' })
  })
})

describe('DELETE /design/inputs/[inputId]', () => {
  it('returns the gate response for non-admins', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await del()).status).toBe(403)
    expect(m.deleteInput).not.toHaveBeenCalled()
  })

  it('rejects a non-uuid id with 400', async () => {
    expect((await del('nope')).status).toBe(400)
  })

  it('404s for an input outside this session', async () => {
    m.deleteInput.mockResolvedValue(false)
    expect((await del()).status).toBe(404)
    expect(m.deleteInput).toHaveBeenCalledWith({}, SID, IID)
  })

  it('deletes', async () => {
    const res = await del()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
