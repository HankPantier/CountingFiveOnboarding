import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RID, SID } from './__fixtures__/rows'

const m = vi.hoisted(() => ({
  transitionRun: vi.fn(async (..._a: unknown[]) => null),
  markRunChainStalled: vi.fn(async (..._a: unknown[]) => true),
}))
vi.mock('./run-store', () => ({
  transitionRun: (...a: unknown[]) => m.transitionRun(...a),
  markRunChainStalled: (...a: unknown[]) => m.markRunChainStalled(...a),
}))

import { DESIGN_HOP_HEADER, MAX_CHAIN_HOPS, STEP_CHAIN_ERROR, chainOrFail, designStepUrl, parseDesignHop, triggerDesignStep } from './run-trigger'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  m.transitionRun.mockClear()
  m.markRunChainStalled.mockReset()
  m.markRunChainStalled.mockResolvedValue(true)
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('designStepUrl', () => {
  it('builds the step route URL (adds https:// for a bare VERCEL_URL)', () => {
    expect(designStepUrl('http://localhost:3000/', SID, RID)).toBe(`http://localhost:3000/api/edit/${SID}/design/runs/${RID}/step`)
    expect(designStepUrl('x.vercel.app', SID, RID)).toBe(`https://x.vercel.app/api/edit/${SID}/design/runs/${RID}/step`)
    expect(designStepUrl('http://localhost:3000', SID, RID, { nudge: true })).toBe(`http://localhost:3000/api/edit/${SID}/design/runs/${RID}/step?nudge=1`)
  })
})

describe('triggerDesignStep', () => {
  it('is misconfigured (no call) when CRON_SECRET is missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    vi.stubEnv('CRON_SECRET', '')
    expect(await triggerDesignStep(SID, RID, { hop: 1 })).toBe('misconfigured')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('POSTs the step route with the cron bearer', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    vi.stubEnv('CRON_SECRET', 's3cret')
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }))
    expect(await triggerDesignStep(SID, RID, { hop: 1 })).toBe('started')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`http://localhost:3000/api/edit/${SID}/design/runs/${RID}/step`)
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer s3cret')
    expect(new Headers(init.headers).get(DESIGN_HOP_HEADER)).toBe('1')
  })
  it('flags a nudge on the URL (the step route then 409s a run that is no longer active)', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    vi.stubEnv('CRON_SECRET', 's3cret')
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }))
    await triggerDesignStep(SID, RID, { nudge: true, hop: 1 })
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(`http://localhost:3000/api/edit/${SID}/design/runs/${RID}/step?nudge=1`)
  })
  it('adds the Vercel protection-bypass header only when the secret is set', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    vi.stubEnv('CRON_SECRET', 's3cret')
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }))

    vi.stubEnv('VERCEL_AUTOMATION_BYPASS_SECRET', '')
    await triggerDesignStep(SID, RID, { hop: 1 })
    expect(new Headers((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers).has('x-vercel-protection-bypass')).toBe(false)

    vi.stubEnv('VERCEL_AUTOMATION_BYPASS_SECRET', 'byp4ss')
    await triggerDesignStep(SID, RID, { hop: 1 })
    const headers = new Headers((fetchMock.mock.calls[1] as [string, RequestInit])[1].headers)
    expect(headers.get('x-vercel-protection-bypass')).toBe('byp4ss')
    expect(headers.get('authorization')).toBe('Bearer s3cret')
  })
  it('never logs the bypass secret when the chain fails', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    vi.stubEnv('CRON_SECRET', 's3cret')
    vi.stubEnv('VERCEL_AUTOMATION_BYPASS_SECRET', 'byp4ss')
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }))
    expect(await triggerDesignStep(SID, RID, { hop: 1 })).toBe('refused')
    const logged = [...vi.mocked(console.warn).mock.calls, ...vi.mocked(console.error).mock.calls].flat().map(String).join(' ')
    expect(logged).not.toContain('byp4ss')
  })
  it('is refused on a non-2xx (incl. Vercel 508 recursion protection) and on a network error', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    vi.stubEnv('CRON_SECRET', 's3cret')
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }))
    expect(await triggerDesignStep(SID, RID, { hop: 1 })).toBe('refused')
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 508 }))
    expect(await triggerDesignStep(SID, RID, { hop: 1 })).toBe('refused')
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    expect(await triggerDesignStep(SID, RID, { hop: 1 })).toBe('refused')
  })
})

describe('chainOrFail', () => {
  const ACTIVE = ['queued', 'capturing', 'generating', 'refining']

  it('errors the still-active run when the chain is misconfigured (no nudge can fix it)', async () => {
    vi.stubEnv('CRON_SECRET', '')
    await chainOrFail({} as never, SID, RID, 0)
    expect(m.transitionRun).toHaveBeenCalledWith({}, RID, ACTIVE, { status: 'error', error: STEP_CHAIN_ERROR })
    expect(m.markRunChainStalled).not.toHaveBeenCalled()
  })

  it('also errors the run when no app URL is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    vi.stubEnv('VERCEL_URL', '')
    vi.stubEnv('CRON_SECRET', 's3cret')
    await chainOrFail({} as never, SID, RID, 0)
    expect(m.transitionRun).toHaveBeenCalledWith({}, RID, ACTIVE, { status: 'error', error: STEP_CHAIN_ERROR })
  })

  it.each([
    ['a 508 (Vercel recursion protection)', () => fetchMock.mockResolvedValue(new Response(null, { status: 508 }))],
    ['another non-2xx', () => fetchMock.mockResolvedValue(new Response(null, { status: 502 }))],
    ['a network error / timeout', () => fetchMock.mockRejectedValue(new DOMException('timed out', 'TimeoutError'))],
  ])('leaves the run active and marks it stalled on %s', async (_label, arrange) => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    vi.stubEnv('CRON_SECRET', 's3cret')
    arrange()
    await chainOrFail({} as never, SID, RID, 0)
    expect(m.transitionRun).not.toHaveBeenCalled()
    expect(m.markRunChainStalled).toHaveBeenCalledWith({}, SID, RID)
    expect(console.error).not.toHaveBeenCalled()
  })

  it('does nothing else when the next step started', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    vi.stubEnv('CRON_SECRET', 's3cret')
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }))
    await chainOrFail({} as never, SID, RID, 0)
    expect(m.transitionRun).not.toHaveBeenCalled()
    expect(m.markRunChainStalled).not.toHaveBeenCalled()
  })

  it('never errors the run when the stalled marker cannot be written (the idle threshold still nudges it)', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    vi.stubEnv('CRON_SECRET', 's3cret')
    fetchMock.mockResolvedValue(new Response(null, { status: 508 }))
    m.markRunChainStalled.mockRejectedValue(new Error('db down'))
    await expect(chainOrFail({} as never, SID, RID, 0)).resolves.toBeUndefined()
    expect(m.transitionRun).not.toHaveBeenCalled()
  })
})

describe('parseDesignHop (untrusted header, Bearer path only)', () => {
  it('absent ⇒ hop 0 (an external caller starts a fresh chain)', () => {
    expect(parseDesignHop(null)).toBe(0)
  })
  it('a small integer ⇒ that hop, capped at the budget', () => {
    expect(parseDesignHop('0')).toBe(0)
    expect(parseDesignHop('1')).toBe(1)
    expect(parseDesignHop(' 2 ')).toBe(2)
    expect(parseDesignHop('7')).toBe(MAX_CHAIN_HOPS)
    expect(parseDesignHop('999')).toBe(MAX_CHAIN_HOPS)
  })
  it.each(['', '-1', '1.5', 'abc', '1e1', '0x1', '1000', '1;2'])('malformed %j ⇒ the budget (never a longer chain)', (raw) => {
    expect(parseDesignHop(raw)).toBe(MAX_CHAIN_HOPS)
  })
})

describe('chainOrFail — hop budget', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    vi.stubEnv('CRON_SECRET', 's3cret')
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }))
  })

  it('a step below the budget chains to the next hop (the header carries it)', async () => {
    await chainOrFail({} as never, SID, RID, 0)
    expect(new Headers((fetchMock.mock.calls[0] as [string, RequestInit])[1].headers).get(DESIGN_HOP_HEADER)).toBe('1')
    await chainOrFail({} as never, SID, RID, MAX_CHAIN_HOPS - 1)
    expect(new Headers((fetchMock.mock.calls[1] as [string, RequestInit])[1].headers).get(DESIGN_HOP_HEADER)).toBe(String(MAX_CHAIN_HOPS))
    expect(m.markRunChainStalled).not.toHaveBeenCalled()
  })

  it('a step AT the budget makes no call: the run stays active, marked stalled, warn-level only', async () => {
    await chainOrFail({} as never, SID, RID, MAX_CHAIN_HOPS)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(m.markRunChainStalled).toHaveBeenCalledWith({}, SID, RID)
    expect(m.transitionRun).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
    expect(vi.mocked(console.warn).mock.calls.flat().map(String).join(' ')).toContain('hop budget')
  })

  it('the budget is checked before the env: a budget stall never errors a misconfigured run either', async () => {
    vi.stubEnv('CRON_SECRET', '')
    await chainOrFail({} as never, SID, RID, MAX_CHAIN_HOPS)
    expect(m.transitionRun).not.toHaveBeenCalled()
    expect(m.markRunChainStalled).toHaveBeenCalled()
  })
})
