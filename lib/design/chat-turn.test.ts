import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test'
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import { asJson } from '@/lib/supabase/json-typed'
import { SID, makeChatRow, makeVersionRow } from './__fixtures__/rows'
import { BRAND_TEXT, DESIGN_TEXT, DRAFT_FILES } from './__fixtures__/theme-texts'
import { DEFAULT_CAPABILITIES } from './run-types'

const m = vi.hoisted(() => ({
  snapshot: vi.fn(),
  latest: vi.fn(),
  schema: vi.fn(),
  list: vi.fn(),
  insert: vi.fn(),
  download: vi.fn(),
  effective: vi.fn(),
  readOptional: vi.fn(),
  turnContextThrows: false,
  convertThrows: false,
}))
vi.mock('ai', async (orig) => {
  const a = (await orig()) as typeof import('ai')
  return {
    ...a,
    convertToModelMessages: (...args: Parameters<typeof a.convertToModelMessages>) => {
      if (m.convertThrows) throw new Error('unsupported part')
      return a.convertToModelMessages(...args)
    },
  }
})
vi.mock('./brief/chat-prompt', async (orig) => {
  const a = (await orig()) as typeof import('./brief/chat-prompt')
  return {
    ...a,
    buildChatTurnContext: (...args: Parameters<typeof a.buildChatTurnContext>) => {
      if (m.turnContextThrows) throw new Error('prompt build failed')
      return a.buildChatTurnContext(...args)
    },
  }
})
vi.mock('./theme-snapshot', async (orig) => ({ ...((await orig()) as object), readDraftThemeSnapshot: (r: string) => m.snapshot(r) }))
vi.mock('./store', async (orig) => ({ ...((await orig()) as object), latestVersion: (...a: unknown[]) => m.latest(...a), readSessionSchema: (...a: unknown[]) => m.schema(...a) }))
vi.mock('./chat-store', () => ({ listChatMessages: (...a: unknown[]) => m.list(...a), insertChatMessage: (...a: unknown[]) => m.insert(...a) }))
vi.mock('./storage', async (orig) => ({ ...((await orig()) as object), downloadDesignImage: (...a: unknown[]) => m.download(...a) }))
vi.mock('./capabilities-read', () => ({ readEffectiveCapabilities: (a: unknown) => m.effective(a) }))
vi.mock('./apply-bundle', async (orig) => ({ ...((await orig()) as object), readOptional: (...a: unknown[]) => m.readOptional(...a) }))

import { bundleFromRepoFiles } from './bundle-files'
import { ChatWorkspace } from './chat-workspace'
import { composedThemeFromFiles } from './composed-theme'
import { CHAT_WRAP_UP_MS, prepareChatTurn, streamChatTurn, type PreparedTurn, type TurnIo } from './chat-turn'
import { CHAT_COMMIT_RESERVE_MS } from './chat-preview'
import { TURN_BUDGET_MS } from './chat-types'
import type { DesignChatMessage } from './chat-types'

const A1 = '0b6f1c2e-5d4a-4e8b-9c1d-2f3a4b5c6d7e'
const A2 = '1c7a2d3f-6e5b-4f9c-8d2e-3a4b5c6d7e8f'
const DB = {} as never
const ACTOR = { sessionId: SID, jobId: 'job-1', githubRepo: 'o/r', adminId: 'admin-1', adminEmail: 'a@x.com' }
const SHAS = { 'content/brand.json': 'a'.repeat(40), 'content/design.json': 'b'.repeat(40) }
const SNAP = { shas: SHAS, texts: { 'content/brand.json': BRAND_TEXT, 'content/design.json': DESIGN_TEXT } }

beforeEach(() => {
  vi.resetAllMocks()
  m.turnContextThrows = false
  m.convertThrows = false
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  m.snapshot.mockResolvedValue(SNAP)
  m.latest.mockResolvedValue(makeVersionRow({ version_no: 3, bundle: asJson({ name: 'Harbor v3' }), applied_blobs: asJson(SHAS) }))
  m.schema.mockResolvedValue({ business: { name: 'Acme CPA' } })
  m.list.mockResolvedValue([])
  m.insert.mockImplementation(async (_db: unknown, row: { role: string }) => makeChatRow({ id: 'user-row-1', role: row.role }))
  m.download.mockResolvedValue(new Uint8Array([1, 2, 3]))
  m.effective.mockResolvedValue({ draft: DEFAULT_CAPABILITIES, effective: DEFAULT_CAPABILITIES })
  m.readOptional.mockResolvedValue(null)
})

describe('prepareChatTurn', () => {
  const req = (over = {}) => ({ text: 'Make these cards calmer', attachmentIds: [A1], page: null, ...over })

  it('409s a draft without theme files, and saves nothing', async () => {
    m.snapshot.mockResolvedValue({ shas: {}, texts: {} })
    expect(await prepareChatTurn(DB, ACTOR, req(), Date.now())).toMatchObject({ ok: false, status: 409 })
    expect(m.insert).not.toHaveBeenCalled()
  })
  it('409s malformed override markers', async () => {
    m.snapshot.mockResolvedValue({ ...SNAP, texts: { ...SNAP.texts, 'content/design-overrides.css': '/* design-studio:end */' } })
    expect(await prepareChatTurn(DB, ACTOR, req(), Date.now())).toMatchObject({ ok: false, status: 409 })
  })
  it('400s an attachment that is not in this session’s folder, and saves nothing', async () => {
    m.download.mockRejectedValue(new Error('not found'))
    expect(await prepareChatTurn(DB, ACTOR, req(), Date.now())).toEqual({ ok: false, status: 400, error: 'An attached image could not be found — attach it again.' })
    expect(m.download).toHaveBeenCalledWith(DB, `design/${SID}/attachments/${A1}.webp`)
    expect(m.insert).not.toHaveBeenCalled()
  })
  it('saves the user message, inlines this turn’s image, and builds the prompt blocks', async () => {
    const r = await prepareChatTurn(DB, ACTOR, req(), 1000)
    if (!r.ok) throw new Error(r.error)
    const last = r.turn.history[r.turn.history.length - 1]
    expect(m.insert.mock.calls[0][1]).toMatchObject({ id: last.id, sessionId: SID, role: 'user', content: 'Make these cards calmer', attachmentIds: [A1], createdBy: 'admin-1' })
    expect(last.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(r.turn.userMessage.id).toBe(last.id)
    expect(last.parts).toContainEqual({ type: 'file', mediaType: 'image/webp', url: `data:image/webp;base64,${Buffer.from([1, 2, 3]).toString('base64')}` })
    expect(r.turn.workspace.bundle().name).toBe('Harbor v3')
    expect(r.turn.turnContext).toContain('the latest is v3')
    expect(r.turn.staticSystem).toContain('YOUR TOOLS')
    expect(r.turn.page).toBe('/')
    expect(r.turn.startedAt).toBe(1000)
    expect(r.turn.assistantId).toMatch(/^[0-9a-f-]{36}$/)
  })
  it('builds the whole turn BEFORE storing the user message — a failure stores nothing (no orphan user row)', async () => {
    m.turnContextThrows = true
    await expect(prepareChatTurn(DB, ACTOR, req(), 0)).rejects.toThrow('prompt build failed')
    expect(m.insert).not.toHaveBeenCalled()
  })
  it('re-sends the previous user turn’s images, notes older ones, and carries a blocked last turn', async () => {
    m.list.mockResolvedValue([
      makeChatRow({ id: 'u0', attachment_ids: [A2], created_at: '2026-09-25T10:00:00Z' }),
      makeChatRow({ id: 'a0', role: 'assistant', parts: asJson([{ type: 'text', text: 'ok' }]), created_at: '2026-09-25T10:01:00Z' }),
      makeChatRow({ id: 'u1', attachment_ids: [A2], created_at: '2026-09-25T11:00:00Z' }),
      makeChatRow({ id: 'a1', role: 'assistant', parts: asJson([{ type: 'data-design-commit', data: { status: 'blocked', error: 'Contrast fails.', failures: [] } }]), created_at: '2026-09-25T11:01:00Z' }),
    ])
    const r = await prepareChatTurn(DB, ACTOR, req({ attachmentIds: [] }), 0)
    if (!r.ok) throw new Error(r.error)
    const byId = Object.fromEntries(r.turn.history.map((msg) => [msg.id, msg]))
    expect(byId.u0.parts.some((p) => p.type === 'text' && p.text.includes('no longer shown'))).toBe(true)
    expect(byId.u1.parts.some((p) => p.type === 'file')).toBe(true)
    expect(r.turn.turnContext).toMatch(/NOT saved \(Contrast fails\.\)/)
  })
  it('never puts a signed url into the model’s history (null preview signer)', async () => {
    const shot = { viewport: 'desktop', path: `design/${SID}/renders/chat/t-p1-desktop.webp`, width: 1440, height: 900 }
    m.list.mockResolvedValue([
      makeChatRow({ id: 'u0', created_at: '2026-09-25T10:00:00Z' }),
      makeChatRow({
        id: 'a0',
        role: 'assistant',
        parts: asJson([{ type: 'tool-render_preview', toolCallId: 'c', state: 'output-available', input: {}, output: { ok: true, shots: [shot] } }]),
        created_at: '2026-09-25T10:01:00Z',
      }),
    ])
    const r = await prepareChatTurn(DB, ACTOR, req({ attachmentIds: [] }), 0)
    if (!r.ok) throw new Error(r.error)
    expect(JSON.stringify(r.turn.history)).not.toContain('https://')
    const a0 = r.turn.history.find((msg) => msg.id === 'a0')
    expect(JSON.stringify(a0?.parts)).toContain('"url":null')
  })
})

describe('streamChatTurn', () => {
  const USAGE = { inputTokens: { total: 900, noCache: 100, cacheRead: 800, cacheWrite: 0 }, outputTokens: { total: 40, text: 40, reasoning: 0 } }
  const TOOL_STEP: LanguageModelV3StreamPart[] = [
    { type: 'stream-start', warnings: [] },
    { type: 'tool-call', toolCallId: 'call-1', toolName: 'set_palette', input: JSON.stringify({ primary: '#123a5c' }) },
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_use' }, usage: USAGE },
  ]
  const TEXT_STEP: LanguageModelV3StreamPart[] = [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 't1' },
    { type: 'text-delta', id: 't1', delta: 'Done — a calmer navy.' },
    { type: 'text-end', id: 't1' },
    { type: 'finish', finishReason: { unified: 'stop', raw: 'end_turn' }, usage: USAGE },
  ]
  const ERROR_STEP: LanguageModelV3StreamPart[] = [{ type: 'stream-start', warnings: [] }, { type: 'error', error: new Error('overloaded') }]

  // One scripted stream per model step (step 1, step 2, …; the last repeats).
  function model(steps: LanguageModelV3StreamPart[][], onStep?: (i: number) => void) {
    let i = 0
    return new MockLanguageModelV3({
      doStream: async () => {
        onStep?.(i)
        return { stream: simulateReadableStream({ chunks: steps[Math.min(i++, steps.length - 1)] }) }
      },
    })
  }
  function turn(): PreparedTurn {
    const current = bundleFromRepoFiles(DRAFT_FILES, { name: 'Harbor v3', source: 'chat' })
    if (!current.ok) throw new Error('fixture')
    const user: DesignChatMessage = { id: 'user-row-1', role: 'user', parts: [{ type: 'text', text: 'calmer' }] }
    return {
      assistantId: '9e0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b',
      userMessage: user,
      history: [user],
      workspace: new ChatWorkspace({ current: current.bundle, draftFiles: DRAFT_FILES, draftShas: SHAS, caps: DEFAULT_CAPABILITIES, model: 'claude-sonnet-5' }),
      staticSystem: 'STATIC',
      turnContext: 'TURN',
      page: '/',
      target: ACTOR,
      baselineTheme: composedThemeFromFiles({ designText: DESIGN_TEXT, themeCss: '', overridesCss: '' }),
      baselineShas: SHAS,
      startedAt: Date.now(),
    }
  }
  function io(steps: LanguageModelV3StreamPart[][]) {
    return {
      model: model(steps),
      commitVersion: vi.fn<TurnIo['commitVersion']>(async () => ({
        ok: true as const,
        version: makeVersionRow({ id: 'ver-9', version_no: 9, source: 'chat' }),
        commitSha: '1'.repeat(40),
        changedPaths: ['content/brand.json'],
        appliedBlobs: SHAS,
        css: { blocks: {} },
      })),
      preview: vi.fn<TurnIo['preview']>(),
      previewFits: vi.fn<TurnIo['previewFits']>(() => true),
      persistAssistant: vi.fn<TurnIo['persistAssistant']>(async () => {}),
      recordUsage: vi.fn<TurnIo['recordUsage']>(async () => {}),
    }
  }

  it('runs the tool loop, auto-commits what is staged, streams the commit, persists the assistant turn and records usage', async () => {
    const t = turn()
    const deps = io([TOOL_STEP, TEXT_STEP])
    const body = await (await streamChatTurn(t, deps)).text()
    expect(body).toContain('"type":"data-design-commit"')
    expect(body).toContain('"status":"committed"')
    expect(body).toContain('"versionNo":9')
    expect(deps.commitVersion).toHaveBeenCalledTimes(1)
    const commitArgs = deps.commitVersion.mock.calls[0][0]
    expect(commitArgs).toMatchObject({ source: 'chat', expectedShas: SHAS })
    expect(commitArgs.bundle.palette.primary).toBe('#123a5c')
    await vi.waitFor(() => expect(deps.persistAssistant).toHaveBeenCalled())
    const saved = deps.persistAssistant.mock.calls[0][0]
    expect(saved).toMatchObject({ id: t.assistantId, content: 'Done — a calmer navy.', versionId: 'ver-9' })
    expect((saved.parts as { type: string }[]).map((p) => p.type)).toEqual(expect.arrayContaining(['tool-set_palette', 'text', 'data-design-commit']))
    expect(deps.recordUsage).toHaveBeenCalledTimes(1)
  })
  it('commits nothing when the model only talks', async () => {
    const deps = io([TEXT_STEP])
    const body = await (await streamChatTurn(turn(), deps)).text()
    expect(body).not.toContain('data-design-commit')
    expect(deps.commitVersion).not.toHaveBeenCalled()
  })
  it('discards staged edits when the stream fails, and says so', async () => {
    const deps = io([TOOL_STEP, ERROR_STEP])
    const body = await (await streamChatTurn(turn(), deps)).text()
    expect(body).toContain('"status":"blocked"')
    expect(deps.commitVersion).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(deps.persistAssistant).toHaveBeenCalled())
    // PF5: the finished tool step's spend is still recorded.
    expect(deps.recordUsage).toHaveBeenCalledTimes(1)
    expect(deps.recordUsage.mock.calls[0][0]).toMatchObject({ inputTokens: 900, outputTokens: 40 })
  })
  it('sums usage over every step into one record', async () => {
    const deps = io([TOOL_STEP, TEXT_STEP])
    await (await streamChatTurn(turn(), deps)).text()
    expect(deps.recordUsage).toHaveBeenCalledTimes(1)
    expect(deps.recordUsage.mock.calls[0][0]).toMatchObject({ inputTokens: 1800, outputTokens: 80, inputTokenDetails: { cacheReadTokens: 1600 } })
  })
  it('streams a preview with its signed url but persists it without one, and passes the time check through', async () => {
    const t = turn()
    const deps = io([
      [
        { type: 'stream-start', warnings: [] },
        { type: 'tool-call', toolCallId: 'call-p', toolName: 'set_palette', input: JSON.stringify({ primary: '#123a5c' }) },
        { type: 'tool-call', toolCallId: 'call-r', toolName: 'render_preview', input: JSON.stringify({ page: '/services' }) },
        { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_use' }, usage: USAGE },
      ],
      TEXT_STEP,
    ])
    const path = `design/${SID}/renders/chat/${t.assistantId}-p1-desktop.webp`
    deps.preview.mockResolvedValue({
      shots: [{ viewport: 'desktop', path, width: 1440, height: 900, url: 'https://signed/secret-token' }],
      images: [{ viewport: 'desktop', webp: Buffer.from('webp') }],
      metrics: null,
      baseline: null,
      error: null,
    })
    const previewFits = vi.fn(() => true)
    const body = await (await streamChatTurn(t, { ...deps, previewFits })).text()
    expect(body).toContain('https://signed/secret-token')
    expect(previewFits).toHaveBeenCalledWith('/services')
    expect(deps.preview.mock.calls[0].slice(0, 2)).toEqual(['/services', 1])
    await vi.waitFor(() => expect(deps.persistAssistant).toHaveBeenCalled())
    const saved = JSON.stringify(deps.persistAssistant.mock.calls[0][0].parts)
    expect(saved).toContain(path)
    expect(saved).not.toContain('https://signed')
    expect(saved).not.toContain('base64')
    expect(deps.commitVersion).toHaveBeenCalledTimes(1)
  })
  it('a preview the time check refuses renders nothing', async () => {
    const deps = io([
      [
        { type: 'stream-start', warnings: [] },
        { type: 'tool-call', toolCallId: 'call-r', toolName: 'render_preview', input: '{}' },
        { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_use' }, usage: USAGE },
      ],
      TEXT_STEP,
    ])
    await (await streamChatTurn(turn(), { ...deps, previewFits: () => false })).text()
    expect(deps.preview).not.toHaveBeenCalled()
  })
  it('orphan guard: a history that can’t be converted gets a short stored reply and a 500, never a lone user message', async () => {
    m.convertThrows = true
    const t = turn()
    const deps = io([TEXT_STEP])
    const res = await streamChatTurn(t, deps)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: expect.stringMatching(/could not be prepared/) })
    expect(deps.persistAssistant).toHaveBeenCalledWith(expect.objectContaining({ id: t.assistantId, versionId: null, content: expect.stringMatching(/could not be prepared/) }))
    expect(deps.model.doStreamCalls).toHaveLength(0)
  })

  describe('time limits (injected clock)', () => {
    it('starts no model step once only the commit reserve is left — the staged edit is still auto-committed, persisted and billed', async () => {
      const t = turn()
      let clock = t.startedAt
      const deps = io([TOOL_STEP, TEXT_STEP])
      // Step 1 "takes" until the commit reserve is all that is left.
      const timed = { ...deps, model: model([TOOL_STEP, TEXT_STEP], (i) => { if (i === 0) clock = t.startedAt + TURN_BUDGET_MS - CHAT_COMMIT_RESERVE_MS }), now: () => clock }
      const body = await (await streamChatTurn(t, timed)).text()
      expect(timed.model.doStreamCalls).toHaveLength(1)
      expect(body).toContain('"status":"committed"')
      expect(deps.commitVersion).toHaveBeenCalledTimes(1)
      await vi.waitFor(() => expect(deps.persistAssistant).toHaveBeenCalled())
      expect(deps.recordUsage).toHaveBeenCalledTimes(1)
    })
    it('keeps looping while there is time', async () => {
      const t = turn()
      const deps = io([TOOL_STEP, TEXT_STEP])
      await (await streamChatTurn(t, { ...deps, now: () => t.startedAt })).text()
      expect(deps.model.doStreamCalls).toHaveLength(2)
    })
    it('offers no tools in the wrap-up window, so the last step is the reply', async () => {
      const t = turn()
      const deps = io([TEXT_STEP])
      const clock = t.startedAt + TURN_BUDGET_MS - CHAT_COMMIT_RESERVE_MS - CHAT_WRAP_UP_MS + 1
      await (await streamChatTurn(t, { ...deps, now: () => clock })).text()
      expect(deps.model.doStreamCalls[0].tools ?? []).toEqual([])
      const early = io([TEXT_STEP])
      await (await streamChatTurn(turn(), { ...early, now: () => t.startedAt })).text()
      expect((early.model.doStreamCalls[0].tools ?? []).length).toBeGreaterThan(0)
    })
    it('aborts a step still running at the deadline; the turn still finishes and is persisted', async () => {
      const t = { ...turn(), startedAt: Date.now() + 50 - TURN_BUDGET_MS }
      const hanging = new MockLanguageModelV3({
        doStream: async (opts) => ({
          stream: new ReadableStream<LanguageModelV3StreamPart>({
            start(c) {
              c.enqueue({ type: 'stream-start', warnings: [] })
              opts.abortSignal?.addEventListener('abort', () => c.error(opts.abortSignal?.reason))
            },
          }),
        }),
      })
      const deps = io([TEXT_STEP])
      const body = await (await streamChatTurn(t, { ...deps, model: hanging })).text()
      expect(body).toMatch(/"type":"(error|abort)"/)
      expect(deps.commitVersion).not.toHaveBeenCalled()
      await vi.waitFor(() => expect(deps.persistAssistant).toHaveBeenCalled())
    })
  })
})
