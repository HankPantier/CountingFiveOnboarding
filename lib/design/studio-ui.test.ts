import { describe, it, expect, vi, afterEach } from 'vitest'
import type { DesignConceptDto } from './run-types'
import type { DesignInputDto } from './studio-types'
import {
  PREVIEW_VIEWPORTS,
  apiFailureInfo,
  applicableConcepts,
  applyErrorMessage,
  applyGateFailures,
  defaultRunInputIds,
  formatUsd,
  runCostCopy,
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
    expect(runStatusLabel({ status: 'refining', conceptCount: 3, concepts: [concept('ready'), concept('pending'), concept('rejected', false)] })).toBe(
      'Rendering previews… (1 of 2)'
    )
  })
  it('labels a generating run with the concept being designed (accepted + rejected + 1, capped at N)', () => {
    expect(runStatusLabel({ status: 'generating', conceptCount: 3, concepts: [] })).toMatch(/^Designing concept 1 of 3…/)
    expect(runStatusLabel({ status: 'generating', conceptCount: 3, concepts: [concept('pending'), concept('generating', false)] })).toMatch(
      /^Designing concept 2 of 3…/
    )
    expect(runStatusLabel({ status: 'generating', conceptCount: 3, concepts: [concept('pending'), concept('rejected', false)] })).toMatch(
      /^Designing concept 3 of 3…/
    )
    expect(
      runStatusLabel({ status: 'generating', conceptCount: 2, concepts: [concept('pending'), concept('rejected', false), concept('pending')] })
    ).toMatch(/^Designing concept 2 of 2…/)
    expect(runStatusLabel({ status: 'queued', conceptCount: 3, concepts: [] })).toBe('Queued…')
  })
  it('runStatusLabel reports the critique loop while refining', () => {
    const looping = { id: 'b', position: 1, status: 'refining', iterations: 1, review: { next: 'revise', activeUnit: 'revise' } } as unknown as DesignConceptDto
    expect(runStatusLabel({ status: 'refining', conceptCount: 2, maxRevisions: 2, concepts: [concept('ready'), looping] })).toBe('Revising concept 2 (round 2 of 2)…')
  })
  it('runCostCopy states the typical range and the hard cap', () => {
    expect(runCostCopy(6)).toBe('A run usually costs about $2–5 including the critique-and-revise loop (hard cap $6).')
    expect(runCostCopy(4.5)).toMatch(/hard cap \$4\.50\)\.$/)
  })
  it('applyGateFailures reads the 422 body’s failures list', () => {
    expect(applyGateFailures({ error: 'x', failures: ['a', 1, 'b'] })).toEqual(['a', 'b'])
    expect(applyGateFailures(null)).toEqual([])
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

describe('Studio UI helpers (audit UI fixes)', () => {
  it('trapFocusIndex wraps Tab at both ends and enters from outside', async () => {
    const { trapFocusIndex } = await import('./studio-ui')
    expect(trapFocusIndex(2, 3, false)).toBe(0)
    expect(trapFocusIndex(0, 3, true)).toBe(2)
    expect(trapFocusIndex(1, 3, false)).toBeNull()
    expect(trapFocusIndex(-1, 3, false)).toBe(0)
    expect(trapFocusIndex(-1, 3, true)).toBe(2)
    expect(trapFocusIndex(-1, 0, false)).toBeNull()
  })

  it('isNearBottom pins only when the reader is at the end', async () => {
    const { isNearBottom } = await import('./studio-ui')
    expect(isNearBottom(560, 440, 1000)).toBe(true)
    expect(isNearBottom(530, 440, 1000)).toBe(true)
    expect(isNearBottom(100, 440, 1000)).toBe(false)
  })

  it('stabilizeSignedUrls keeps the first URL per object until it ages out', async () => {
    const { stabilizeSignedUrls, SIGNED_URL_REUSE_MS } = await import('./studio-ui')
    const cache = new Map()
    const u = (tok: string) => `https://x.supabase.co/storage/v1/object/sign/session-assets/design/s/a.webp?token=${tok}`
    const first = stabilizeSignedUrls({ run: { shots: [{ url: u('1') }] }, other: 'https://elsewhere/x?token=9' }, cache, 0)
    const second = stabilizeSignedUrls({ run: { shots: [{ url: u('2') }] }, other: 'https://elsewhere/x?token=10' }, cache, 60_000)
    expect(second.run.shots[0].url).toBe(u('1'))
    expect(second.other).toBe('https://elsewhere/x?token=10')
    expect(first.run.shots[0].url).toBe(u('1'))
    const later = stabilizeSignedUrls({ url: u('3') }, cache, SIGNED_URL_REUSE_MS + 1)
    expect(later.url).toBe(u('3'))
    expect(stabilizeSignedUrls(null, cache, 0)).toBeNull()
  })
})
