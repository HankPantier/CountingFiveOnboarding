import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { asJson } from '@/lib/supabase/json-typed'
import { SID, makeChatRow } from '@/lib/design/__fixtures__/rows'

const A1 = '0b6f1c2e-5d4a-4e8b-9c1d-2f3a4b5c6d7e'
const PREVIEW = `design/${SID}/renders/chat/t-p1-desktop.webp`
const m = vi.hoisted(() => ({ gate: vi.fn(), list: vi.fn(), clear: vi.fn(), sign: vi.fn(), remove: vi.fn(), run: vi.fn() }))
vi.mock('../_design', () => ({ requireDesignAdmin: (id: string) => m.gate(id) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/design/chat-store', () => ({ listChatMessages: (...a: unknown[]) => m.list(...a), clearChatHistory: (...a: unknown[]) => m.clear(...a) }))
vi.mock('@/lib/design/storage', async (orig) => ({
  ...((await orig()) as object),
  signDesignPaths: (...a: unknown[]) => m.sign(...a),
  removeDesignPaths: (...a: unknown[]) => m.remove(...a),
}))
vi.mock('@/lib/design/chat-turn', () => ({ runDesignChatTurn: (...a: unknown[]) => m.run(...a) }))

import { DELETE, GET, POST } from './route'

const params = { params: Promise.resolve({ id: SID }) }
const CTX = { sessionId: SID, jobId: 'job-1', githubRepo: 'o/r', adminId: 'admin-1', adminEmail: 'a@x.com', user: { isAdmin: true } }
const post = (body: unknown) => POST(new Request('http://x/api', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' } }), params)

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  m.gate.mockResolvedValue(CTX)
  m.list.mockResolvedValue([
    makeChatRow({ attachment_ids: [A1] }),
    makeChatRow({ id: 'a1', role: 'assistant', version_id: 'ver-3', parts: asJson([{ type: 'tool-render_preview', toolCallId: 'c', state: 'output-available', input: {}, output: { ok: true, shots: [{ viewport: 'desktop', path: PREVIEW, width: 1440, height: 900 }] } }]) }),
  ])
  m.sign.mockImplementation(async (_db: unknown, paths: string[]) => Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`])))
  m.run.mockResolvedValue(new Response('stream'))
})

describe('design/chat route', () => {
  it('every method passes the gate response through', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await GET(new Request('http://x'), params)).status).toBe(403)
    expect((await post({ text: 'x' })).status).toBe(403)
    expect((await DELETE(new Request('http://x', { method: 'DELETE' }), params)).status).toBe(403)
  })
  it('GET returns the history with freshly signed attachment + preview urls', async () => {
    const res = await GET(new Request('http://x'), params)
    const { messages } = (await res.json()) as { messages: { metadata: { attachments: { url: string }[] }; parts: { output?: { shots: { url: string }[] } }[] }[] }
    expect(messages[0].metadata.attachments[0].url).toBe(`https://signed/design/${SID}/attachments/${A1}.webp`)
    expect(messages[1].parts[0].output?.shots[0].url).toBe(`https://signed/${PREVIEW}`)
  })
  it('GET signs only this session’s chat preview renders (PF6)', async () => {
    const foreign = ['design/11111111-2222-4333-8444-555555555555/renders/chat/x-p1-desktop.webp', `design/${SID}/runs/r/concept.webp`, `design/${SID}/renders/chat/../../x.webp`]
    m.list.mockResolvedValue([
      makeChatRow({
        id: 'a2',
        role: 'assistant',
        parts: asJson([{ type: 'tool-render_preview', toolCallId: 'c', state: 'output-available', input: {}, output: { ok: true, shots: [...foreign, PREVIEW].map((p) => ({ viewport: 'desktop', path: p, width: 1, height: 1 })) } }]),
      }),
    ])
    const res = await GET(new Request('http://x'), params)
    const { messages } = (await res.json()) as { messages: { parts: { output: { shots: { url: string | null }[] } }[] }[] }
    expect(m.sign.mock.calls[0][1]).toEqual([PREVIEW])
    expect(messages[0].parts[0].output.shots.map((s) => s.url)).toEqual([null, null, null, `https://signed/${PREVIEW}`])
  })
  it('GET still loads when signing fails (urls null)', async () => {
    m.sign.mockRejectedValue(new Error('down'))
    const res = await GET(new Request('http://x'), params)
    expect(res.status).toBe(200)
  })
  it('POST 400s a bad body and never starts a turn', async () => {
    expect((await post({ text: '  ' })).status).toBe(400)
    expect((await post('{nope')).status).toBe(400)
    expect((await post({ text: 'x', attachmentIds: ['../y'] })).status).toBe(400)
    expect(m.run).not.toHaveBeenCalled()
  })
  it('POST hands the parsed request to the (lazily loaded) turn and returns its stream', async () => {
    const res = await post({ text: ' calmer ', attachmentIds: [A1], page: '/services' })
    expect(await res.text()).toBe('stream')
    const [, actor, request, startedAt] = m.run.mock.calls[0] as [unknown, { sessionId: string }, unknown, number]
    expect(actor.sessionId).toBe(SID)
    expect(request).toEqual({ text: 'calmer', attachmentIds: [A1], page: '/services' })
    expect(typeof startedAt).toBe('number')
  })
  it('POST hides a thrown error behind a 500', async () => {
    m.run.mockRejectedValue(new Error('supabase secret'))
    const res = await post({ text: 'x' })
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret')
  })
  it('DELETE clears the history and removes the sent attachments (best-effort)', async () => {
    m.clear.mockResolvedValue([makeChatRow({ attachment_ids: [A1] }), makeChatRow({ id: 'x' })])
    m.remove.mockRejectedValue(new Error('storage down'))
    const res = await DELETE(new Request('http://x', { method: 'DELETE' }), params)
    expect(await res.json()).toEqual({ ok: true, deleted: 2 })
    expect(m.remove).toHaveBeenCalledWith({}, [`design/${SID}/attachments/${A1}.webp`])
  })
})
