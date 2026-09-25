import { describe, it, expect, vi, afterEach } from 'vitest'
import type { DesignConceptDto } from './run-types'
import type { DesignInputDto } from './studio-types'
import {
  PREVIEW_VIEWPORTS,
  apiFailureInfo,
  applicableConcepts,
  applyErrorMessage,
  defaultRunInputIds,
  formatUsd,
  reconcileRunInputIds,
  runIsActive,
  runStatusLabel,
  startSequentialPoll,
  syncedScrollTop,
  viewportScale,
} from './studio-ui'

const input = (id: string, over: Partial<DesignInputDto> = {}): DesignInputDto => ({
  id,
  kind: 'competitor_url',
  url: 'https://a.test/',
  label: null,
  notes: null,
  captureStatus: 'ok',
  captureError: null,
  capturedAt: null,
  archived: false,
  thumbnailUrl: null,
  createdAt: '2026-09-25T10:00:00.000Z',
  ...over,
})
const concept = (status: DesignConceptDto['status'], hasPalette = true) =>
  ({ id: status, status, palette: hasPalette ? { primary: '#000000' } : null }) as unknown as DesignConceptDto

describe('studio-ui helpers', () => {
  it('offers the three spec viewports', () => {
    expect(PREVIEW_VIEWPORTS.map((v) => v.width)).toEqual([1440, 768, 390])
  })
  it('scales an iframe down to its container, never up, never to zero', () => {
    expect(viewportScale(720, 1440)).toBe(0.5)
    expect(viewportScale(2000, 390)).toBe(1)
    expect(viewportScale(10, 1440)).toBe(0.1)
    expect(viewportScale(0, 1440)).toBe(1)
  })
  it('maps scroll position proportionally between panes', () => {
    expect(syncedScrollTop(50, 100, 400)).toBe(200)
    expect(syncedScrollTop(500, 100, 400)).toBe(400)
    expect(syncedScrollTop(10, 0, 400)).toBe(0)
  })
  it('knows which runs are active', () => {
    expect(runIsActive({ status: 'generating' })).toBe(true)
    expect(runIsActive({ status: 'ready' })).toBe(false)
    expect(runIsActive(null)).toBe(false)
  })
  it('labels a rendering run with its progress', () => {
    expect(runStatusLabel({ status: 'refining', concepts: [concept('ready'), concept('pending'), concept('rejected', false)] })).toBe('Rendering previews… (1 of 2)')
    expect(runStatusLabel({ status: 'generating', concepts: [] })).toContain('Designing concepts')
  })
  it('pre-selects captured, unarchived inputs (max 5)', () => {
    const inputs = [input('a'), input('b', { archived: true }), input('c', { captureStatus: 'error' }), ...['d', 'e', 'f', 'g', 'h'].map((id) => input(id))]
    expect(defaultRunInputIds(inputs)).toEqual(['a', 'd', 'e', 'f', 'g'])
  })
  it('only ready concepts with a design can be previewed / applied', () => {
    expect(applicableConcepts({ concepts: [concept('ready'), concept('refining'), concept('rejected', false)] }).map((c) => c.status)).toEqual(['ready'])
  })
  it('formats dollars', () => {
    expect(formatUsd(1.234)).toBe('$1.23')
  })
})

describe('reconcileRunInputIds', () => {
  it('keeps selected ids that are still eligible, in selection order', () => {
    expect(reconcileRunInputIds(['c', 'a'], [input('a'), input('b'), input('c')])).toEqual(['c', 'a'])
  })
  it('drops deleted, archived and no-longer-captured inputs', () => {
    const inputs = [input('a', { archived: true }), input('b', { captureStatus: 'pending' }), input('c')]
    expect(reconcileRunInputIds(['a', 'b', 'c', 'gone'], inputs)).toEqual(['c'])
  })
  it('never adds ids the admin did not select', () => {
    expect(reconcileRunInputIds([], [input('a'), input('b')])).toEqual([])
  })
  it('dedupes and caps at MAX_RUN_INPUTS', () => {
    const inputs = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => input(id))
    expect(reconcileRunInputIds(['a', 'a', 'b', 'c', 'd', 'e', 'f'], inputs)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

describe('apiFailureInfo', () => {
  it('reads the error text and stale flag from a JSON body', () => {
    expect(apiFailureInfo(409, { error: 'Theme changed', stale: true })).toEqual({ status: 409, error: 'Theme changed', stale: true })
  })
  it('tolerates non-object and malformed bodies', () => {
    expect(apiFailureInfo(500, null)).toEqual({ status: 500, error: null, stale: false })
    expect(apiFailureInfo(422, { error: 42, stale: 'yes' })).toEqual({ status: 422, error: null, stale: false })
  })
})

describe('applyErrorMessage', () => {
  const generic = 'Request failed (500)'
  it('explains a stale draft and keeps the server text', () => {
    const msg = applyErrorMessage({ status: 409, error: 'The theme changed while applying — refresh the Studio and try again.', stale: true }, generic)
    expect(msg).toContain('The draft changed since this run — refresh and try again.')
    expect(msg).toContain('The theme changed while applying')
  })
  it('shows a stale explanation even without server text', () => {
    expect(applyErrorMessage({ status: 409, error: null, stale: true }, generic)).toBe('The draft changed since this run — refresh and try again.')
  })
  it('shows the server message for other 4xx refusals', () => {
    expect(applyErrorMessage({ status: 409, error: 'The draft has no content/brand.json.', stale: false }, generic)).toBe('The draft has no content/brand.json.')
    expect(applyErrorMessage({ status: 422, error: 'Fonts are locked on this site.', stale: false }, generic)).toBe('Fonts are locked on this site.')
  })
  it('falls back to the generic message for 5xx or a missing 4xx message', () => {
    expect(applyErrorMessage({ status: 500, error: 'db exploded', stale: false }, generic)).toBe(generic)
    expect(applyErrorMessage({ status: 400, error: null, stale: false }, generic)).toBe(generic)
  })
})

describe('startSequentialPoll', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits for each tick to settle before scheduling the next', async () => {
    vi.useFakeTimers()
    const resolvers: ((v: boolean) => void)[] = []
    const tick = vi.fn(() => new Promise<boolean>((r) => resolvers.push(r)))
    const stop = startSequentialPoll(tick, 1000)
    expect(tick).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(tick).toHaveBeenCalledTimes(1)
    // A slow request: no new tick while it is in flight, however long it takes.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(tick).toHaveBeenCalledTimes(1)
    resolvers[0](true)
    await vi.advanceTimersByTimeAsync(999)
    expect(tick).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(tick).toHaveBeenCalledTimes(2)
    stop()
  })

  it('stops when a tick resolves false', async () => {
    vi.useFakeTimers()
    const tick = vi.fn(async () => false)
    startSequentialPoll(tick, 1000)
    await vi.advanceTimersByTimeAsync(5000)
    expect(tick).toHaveBeenCalledTimes(1)
  })

  it('keeps polling after a rejected (transient) tick', async () => {
    vi.useFakeTimers()
    const tick = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(true)
    const stop = startSequentialPoll(tick, 1000)
    await vi.advanceTimersByTimeAsync(3000)
    expect(tick).toHaveBeenCalledTimes(3)
    stop()
  })

  it('stop() clears the pending timer and suppresses scheduling after an in-flight tick', async () => {
    vi.useFakeTimers()
    let release: (v: boolean) => void = () => {}
    const tick = vi.fn(() => new Promise<boolean>((r) => (release = r)))
    const stop = startSequentialPoll(tick, 1000)
    await vi.advanceTimersByTimeAsync(1000)
    stop()
    release(true)
    await vi.advanceTimersByTimeAsync(5000)
    expect(tick).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)

    const idle = vi.fn(async () => true)
    startSequentialPoll(idle, 1000)()
    await vi.advanceTimersByTimeAsync(5000)
    expect(idle).not.toHaveBeenCalled()
  })
})
