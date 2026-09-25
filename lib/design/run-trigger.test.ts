import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RID, SID } from './__fixtures__/rows'

const m = vi.hoisted(() => ({ transitionRun: vi.fn(async (..._a: unknown[]) => null) }))
vi.mock('./run-store', () => ({ transitionRun: (...a: unknown[]) => m.transitionRun(...a) }))

import { STEP_CHAIN_ERROR, chainOrFail, designStepUrl, triggerDesignStep } from './run-trigger'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  m.transitionRun.mockClear()
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
  })
})

describe('triggerDesignStep', () => {
  it('returns false without calling anything when CRON_SECRET is missing', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    vi.stubEnv('CRON_SECRET', '')
    expect(await triggerDesignStep(SID, RID)).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('POSTs the step route with the cron bearer', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    vi.stubEnv('CRON_SECRET', 's3cret')
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }))
    expect(await triggerDesignStep(SID, RID)).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`http://localhost:3000/api/edit/${SID}/design/runs/${RID}/step`)
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer s3cret')
  })
  it('returns false on a non-2xx', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    vi.stubEnv('CRON_SECRET', 's3cret')
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }))
    expect(await triggerDesignStep(SID, RID)).toBe(false)
  })
})

describe('chainOrFail', () => {
  it('errors the still-active run when the chain cannot start', async () => {
    vi.stubEnv('CRON_SECRET', '')
    await chainOrFail({} as never, SID, RID)
    expect(m.transitionRun).toHaveBeenCalledWith({}, RID, ['queued', 'capturing', 'generating', 'refining'], { status: 'error', error: STEP_CHAIN_ERROR })
  })
})
