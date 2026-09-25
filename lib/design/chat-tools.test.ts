import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ToolExecutionOptions } from 'ai'
import { SID } from './__fixtures__/rows'
import { DRAFT_FILES } from './__fixtures__/theme-texts'
import { bundleFromRepoFiles } from './bundle-files'
import { DEFAULT_CAPABILITIES } from './run-types'
import { ChatWorkspace, FONTS_LOCKED_TOOL_ERROR } from './chat-workspace'
import type { ComposedTheme } from './composed-theme'

const m = vi.hoisted(() => ({ render: vi.fn(), cached: vi.fn() }))
vi.mock('./chat-preview', async (orig) => ({
  ...((await orig()) as object),
  renderChatPreview: (a: unknown) => m.render(a),
  isChatBaselineCached: (...a: unknown[]) => m.cached(...a),
}))

import { CHAT_COMMIT_RESERVE_MS, CHAT_PREVIEW_FAILED_ERROR, CHAT_PREVIEW_NO_TIME_ERROR, chatPreviewRenderMs, type ChatPreviewResult } from './chat-preview'
import { PREVIEWS_PER_TURN, TURN_BUDGET_MS, type RenderPreviewOutput } from './chat-types'
import { MIN_PREVIEW_TIME_MS, PREVIEW_LIMIT_ERROR, PREVIEW_TIME_ERROR, buildDesignChatTools, chatPreviewDeps, type ChatToolDeps } from './chat-tools'

beforeEach(() => {
  vi.resetAllMocks()
})

const OPTS = (id: string): ToolExecutionOptions => ({ toolCallId: id, messages: [] })
async function exec<I>(t: { execute?: (input: I, o: ToolExecutionOptions) => unknown }, input: I, id = 'c1'): Promise<Record<string, unknown>> {
  if (!t.execute) throw new Error('tool has no execute')
  return (await t.execute(input, OPTS(id))) as Record<string, unknown>
}
function setup(over: Partial<ChatToolDeps> = {}) {
  const r = bundleFromRepoFiles(DRAFT_FILES, { name: 'Harbor v3', source: 'chat' })
  if (!r.ok) throw new Error('fixture')
  const ws = new ChatWorkspace({ current: r.bundle, draftFiles: DRAFT_FILES, draftShas: {}, caps: DEFAULT_CAPABILITIES, model: 'claude-sonnet-5' })
  const shot = { viewport: 'desktop' as const, path: `design/${SID}/renders/chat/t-p1-desktop.webp`, width: 1440, height: 900, url: 'https://signed/p1' }
  const preview: ChatPreviewResult = { shots: [shot], images: [{ viewport: 'desktop', webp: Buffer.from('webp-bytes') }], metrics: null, baseline: null, error: null }
  const deps: ChatToolDeps = {
    defaultPage: '/',
    timeLeftMs: () => 200_000,
    preview: vi.fn(async () => preview),
    commit: vi.fn(async () => ({ ok: true as const, versionId: 'ver-9', versionNo: 9, changedPaths: [], warnings: [] })),
    ...over,
  }
  return { ws, deps, tools: buildDesignChatTools(ws, deps) }
}

describe('edit tools', () => {
  it('stage validated edits and report errors without throwing', async () => {
    const { ws, tools } = setup()
    expect(await exec(tools.set_palette, { primary: '#123a5c' })).toMatchObject({ ok: true, changed: true, staged: true })
    expect(await exec(tools.set_fonts, { headingFont: 'Fraunces' })).toEqual({ ok: false, error: FONTS_LOCKED_TOOL_ERROR })
    const css = await exec(tools.set_block_css, { target: 'service-cards', css: '[data-block="service-cards"] { gap: 2rem; }' })
    expect(css).toMatchObject({ ok: true })
    expect(String(css.cssBudget)).toMatch(/^service-cards: /)
    expect(await exec(tools.remove_block_css, { target: 'service-cards' })).toMatchObject({ ok: true, changed: true })
    expect(await exec(tools.set_tokens, { radius: { lg: 'banana' } })).toMatchObject({ ok: false })
    expect(await exec(tools.set_treatments, { darkSections: true })).toMatchObject({ ok: true })
    expect(ws.isStaged()).toBe(true)
  })
  it('has no style_axes tool (P6b)', () => {
    const { tools } = setup()
    expect(Object.keys(tools).sort()).toEqual(
      ['commit_version', 'remove_block_css', 'render_preview', 'set_block_css', 'set_fonts', 'set_palette', 'set_tokens', 'set_treatments']
    )
  })
})

describe('time budget (PF1: maxDuration 600)', () => {
  it('a preview is only started with room for the worst-case render AND the commit reserve', () => {
    expect(PREVIEW_TIME_ERROR).toBe(CHAT_PREVIEW_NO_TIME_ERROR)
    expect(MIN_PREVIEW_TIME_MS).toBeGreaterThanOrEqual(chatPreviewRenderMs(true) + CHAT_COMMIT_RESERVE_MS)
    expect(TURN_BUDGET_MS).toBeLessThanOrEqual(600_000 - 30_000)
    expect(TURN_BUDGET_MS).toBeGreaterThan(chatPreviewRenderMs(false) * PREVIEWS_PER_TURN + CHAT_COMMIT_RESERVE_MS)
  })
})

describe('render_preview', () => {
  it('renders the working copy on the default page, records it, and sends the image to the model only in-turn', async () => {
    const { ws, deps, tools } = setup()
    await exec(tools.set_palette, { primary: '#123a5c' })
    const out = (await exec(tools.render_preview, {}, 'call-7')) as unknown as RenderPreviewOutput
    expect(out).toMatchObject({ ok: true, previewNo: 1, page: '/', measured: false })
    expect(deps.preview).toHaveBeenCalledWith('/', 1, expect.objectContaining({ themeCss: expect.any(String) }))
    expect(ws.currentPreview()?.shots[0]).not.toHaveProperty('url')
    const toModel = tools.render_preview.toModelOutput
    if (!toModel) throw new Error('no toModelOutput')
    const inTurn = (await toModel({ toolCallId: 'call-7', input: {}, output: out })) as { type: string; value: { type: string; data?: string; text?: string }[] }
    expect(inTurn.value.map((p) => p.type)).toEqual(['text', 'image-data'])
    expect(inTurn.value[1].data).toBe(Buffer.from('webp-bytes').toString('base64'))
    expect(inTurn.value[0].text).not.toContain('https://signed')
    const history = (await toModel({ toolCallId: 'old-call', input: {}, output: out })) as { value: { type: string }[] }
    expect(history.value.map((p) => p.type)).toEqual(['text'])
  })
  it(`allows ${PREVIEWS_PER_TURN} previews per turn, then refuses`, async () => {
    const { tools } = setup()
    for (let i = 0; i < PREVIEWS_PER_TURN; i++) expect((await exec(tools.render_preview, {}, `p${i}`)).ok).toBe(true)
    expect(await exec(tools.render_preview, {}, 'px')).toEqual({ ok: false, error: PREVIEW_LIMIT_ERROR })
  })
  it('refuses when the turn is nearly out of time, without using a slot', async () => {
    const { ws, deps, tools } = setup({ timeLeftMs: () => MIN_PREVIEW_TIME_MS - 1 })
    expect(await exec(tools.render_preview, {})).toEqual({ ok: false, error: PREVIEW_TIME_ERROR })
    expect(ws.previewsUsed()).toBe(0)
    expect(deps.preview).not.toHaveBeenCalled()
  })
  it('refuses (no slot, no render) when previewFits says the preview would eat the commit reserve', async () => {
    const previewFits = vi.fn(() => false)
    const { ws, deps, tools } = setup({ previewFits })
    expect(await exec(tools.render_preview, { page: '/services' })).toEqual({ ok: false, error: PREVIEW_TIME_ERROR })
    expect(previewFits).toHaveBeenCalledWith('/services')
    expect(ws.previewsUsed()).toBe(0)
    expect(deps.preview).not.toHaveBeenCalled()
  })
  it('PF4: a preview that throws becomes a typed error in our words, never a throw', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { ws, tools } = setup({ preview: vi.fn(async () => { throw new Error('chromium: net::ERR_SECRET_DETAIL') }) })
    const out = await exec(tools.render_preview, {})
    expect(out).toEqual({ ok: false, error: CHAT_PREVIEW_FAILED_ERROR })
    expect(JSON.stringify(out)).not.toContain('ERR_SECRET')
    expect(ws.currentPreview()).toBeNull()
  })
  it('a render refused for time after the shell fetch is not recorded and hands its slot back', async () => {
    const { ws, tools } = setup({ preview: vi.fn(async () => ({ shots: [], images: [], metrics: null, baseline: null, error: CHAT_PREVIEW_NO_TIME_ERROR })) })
    expect(await exec(tools.render_preview, {})).toEqual({ ok: false, error: PREVIEW_TIME_ERROR })
    expect(ws.previewsUsed()).toBe(0)
    expect(ws.currentPreview()).toBeNull()
  })
  it('reports a failed render as an error but still records it (unmeasured)', async () => {
    const { ws, tools } = setup({ preview: vi.fn(async () => ({ shots: [], images: [], metrics: null, baseline: null, error: 'The render timed out.' })) })
    expect(await exec(tools.render_preview, { page: '/services' })).toEqual({ ok: false, error: 'The render timed out.' })
    expect(ws.currentPreview()).not.toBeNull()
  })
})

describe('concurrent tool calls (one step runs them in parallel)', () => {
  function deferredPreview() {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const preview = vi.fn(async (): Promise<ChatPreviewResult> => {
      await gate
      return { shots: [{ viewport: 'desktop', path: `design/${SID}/renders/chat/t-p1-desktop.webp`, width: 1440, height: 900 }], images: [], metrics: null, baseline: null, error: null }
    })
    return { preview, release: () => release() }
  }
  it('an edit issued during a render runs after it, so the preview never gates CSS it did not render', async () => {
    const d = deferredPreview()
    const { ws, tools } = setup({ preview: d.preview })
    const p = exec(tools.render_preview, {}, 'r1')
    const e = exec(tools.set_palette, { primary: '#123a5c' }, 'e1')
    await Promise.resolve()
    d.release()
    await Promise.all([p, e])
    expect(ws.isStaged()).toBe(true)
    expect(ws.currentPreview()).toBeNull()
  })
  it('an edit issued during commit_version stays staged', async () => {
    let release: () => void = () => {}
    const { ws, tools } = setup({
      commit: vi.fn(async () => {
        await new Promise<void>((r) => (release = r))
        ws.markCommitted({}, 'ver-9')
        return { ok: true as const, versionId: 'ver-9', versionNo: 9, changedPaths: [], warnings: [] }
      }),
    })
    await exec(tools.set_palette, { primary: '#123a5c' })
    const c = exec(tools.commit_version, { summary: 'x' }, 'c1')
    const e = exec(tools.set_treatments, { darkSections: true }, 'e2')
    await new Promise((r) => setTimeout(r, 0))
    release()
    await Promise.all([c, e])
    expect(ws.isStaged()).toBe(true)
  })
  it('parallel previews respect the per-turn cap', async () => {
    const { tools } = setup()
    const outs = await Promise.all([0, 1, 2].map((i) => exec(tools.render_preview, {}, `p${i}`)))
    expect(outs.filter((o) => o.ok).length).toBe(PREVIEWS_PER_TURN)
    expect(outs[2]).toEqual({ ok: false, error: PREVIEW_LIMIT_ERROR })
  })
  it('parallel previews each check the time left AFTER the previous one finished', async () => {
    let left = MIN_PREVIEW_TIME_MS * 2 - 10_000
    const preview = vi.fn(async (): Promise<ChatPreviewResult> => {
      await new Promise((r) => setTimeout(r, 0))
      left -= MIN_PREVIEW_TIME_MS
      return { shots: [{ viewport: 'desktop', path: 'x.webp', width: 1, height: 1 }], images: [], metrics: null, baseline: null, error: null }
    })
    const { tools } = setup({ preview, timeLeftMs: () => left })
    const outs = await Promise.all([exec(tools.render_preview, {}, 'a'), exec(tools.render_preview, {}, 'b')])
    expect(outs[0].ok).toBe(true)
    expect(outs[1]).toEqual({ ok: false, error: PREVIEW_TIME_ERROR })
    expect(preview).toHaveBeenCalledTimes(1)
  })
})

describe('commit_version', () => {
  it('delegates to deps.commit and never throws', async () => {
    const { deps, tools } = setup()
    expect(await exec(tools.commit_version, { summary: 'Calmer cards' })).toMatchObject({ ok: true, versionNo: 9 })
    expect(deps.commit).toHaveBeenCalledWith('Calmer cards')
    const broken = setup({ commit: vi.fn(async () => { throw new Error('octokit') }) })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await exec(broken.tools.commit_version, { summary: 'x' })).toMatchObject({ ok: false })
  })
})

describe('chatPreviewDeps', () => {
  const THEME: ComposedTheme = { themeCss: 'base', overridesCss: '', typography: { headingFont: 'Public Sans', bodyFont: 'Public Sans', accentFont: 'Fraunces', googleFontsUrl: '' }, htmlAttributes: {} }
  const SHAS = { 'content/brand.json': 'a'.repeat(40) }
  const TURN = '8d9e0f1a-2b3c-4d5e-8f6a-7b8c9d0e1f2a'
  const bind = (turnDeadlineAt: number) =>
    chatPreviewDeps({ db: {} as never, target: { sessionId: SID, jobId: 'job-1', githubRepo: 'o/r' }, turnId: TURN, baselineTheme: THEME, baselineShas: SHAS, turnDeadlineAt })

  it('renders with the server turn id, the turn-start baseline and the turn deadline', async () => {
    m.render.mockResolvedValue({ shots: [], images: [], metrics: null, baseline: null, error: null })
    const deadline = Date.now() + 400_000
    const d = bind(deadline)
    const theme = { ...THEME, themeCss: 'working' }
    await d.preview('/about', 2, theme)
    expect(m.render).toHaveBeenCalledWith(
      expect.objectContaining({ turnId: TURN, previewNo: 2, page: '/about', theme, baselineTheme: THEME, baselineShas: SHAS, turnDeadlineAt: deadline, target: { sessionId: SID, jobId: 'job-1', githubRepo: 'o/r' } })
    )
  })
  it('timeLeftMs counts down to the deadline; previewFits asks the baseline cache for the turn-start shas', () => {
    const d = bind(Date.now() + chatPreviewRenderMs(true) + CHAT_COMMIT_RESERVE_MS + 5_000)
    expect(d.timeLeftMs()).toBeGreaterThan(0)
    m.cached.mockReturnValue(true)
    expect(d.previewFits('/about')).toBe(true)
    expect(m.cached).toHaveBeenCalledWith(SID, SHAS, '/about')
    m.cached.mockReturnValue(false)
    expect(d.previewFits('/about')).toBe(false)
  })
})
