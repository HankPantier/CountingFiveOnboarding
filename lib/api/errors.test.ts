import { describe, it, expect, vi, afterEach } from 'vitest'
import { internalError, DEFAULT_PUBLIC_ERROR } from './errors'

describe('internalError', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('hides the raw error message from the response body and logs it', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const raw = new Error('duplicate key value violates unique constraint "sessions_pkey"')
    const res = internalError('sessions', raw)
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe(DEFAULT_PUBLIC_ERROR)
    expect(JSON.stringify(body)).not.toContain('sessions_pkey')
    expect(spy).toHaveBeenCalledWith('[sessions]', raw)
  })

  it('honors a custom public message and status', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = internalError('outlines', { message: 'relation "page_outlines" does not exist' }, "Couldn't load outlines", 502)
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: string }
    expect(body).toEqual({ error: "Couldn't load outlines" })
  })
})
