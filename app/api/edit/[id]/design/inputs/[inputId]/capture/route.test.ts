import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { IID, SID, makeInputRow } from '@/lib/design/__fixtures__/rows'

const m = vi.hoisted(() => ({
  gate: vi.fn(),
  capture: vi.fn(),
  getInput: vi.fn(),
  claimCapture: vi.fn(),
  updateInput: vi.fn(),
  store: vi.fn(),
  remove: vi.fn(),
  sign: vi.fn(async (_s: unknown, paths: string[]) => Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`]))),
}))

vi.mock('../../../_design', () => ({ requireDesignAdmin: (id: string) => m.gate(id) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }))
vi.mock('@/lib/design/capture/external', () => ({ captureExternalScreenshot: (url: string) => m.capture(url) }))
vi.mock('@/lib/design/store', () => ({
  getInput: (...a: unknown[]) => m.getInput(...a),
  claimCapture: (...a: unknown[]) => m.claimCapture(...a),
  updateInput: (...a: unknown[]) => m.updateInput(...a),
}))
vi.mock('@/lib/design/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/design/storage')>()
  return {
    ...actual,
    storeDesignImage: (s: unknown, p: string, w: Buffer) => m.store(s, p, w),
    removeDesignPaths: (s: unknown, p: string[]) => m.remove(s, p),
    signDesignPaths: (s: unknown, p: string[]) => m.sign(s, p),
  }
})

import { POST } from './route'

const OLD = `design/${SID}/inputs/${IID}-old.webp`
const call = (inputId = IID) => POST(new Request('http://x/api', { method: 'POST' }), { params: Promise.resolve({ id: SID, inputId }) })

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  m.gate.mockReset().mockResolvedValue({ sessionId: SID, githubRepo: 'o/r', adminId: 'admin-1', user: { isAdmin: true } })
  m.getInput.mockReset().mockResolvedValue(makeInputRow({ storage_path: OLD, capture_status: 'ok' }))
  m.claimCapture.mockReset().mockResolvedValue(makeInputRow({ storage_path: OLD, capture_status: 'pending' }))
  m.updateInput.mockReset().mockImplementation(async (_db: unknown, _sid: string, _iid: string, patch: { captureStatus?: string; storagePath?: string; captureError?: string }) =>
    makeInputRow({ capture_status: patch.captureStatus ?? 'ok', storage_path: patch.storagePath ?? OLD, capture_error: patch.captureError ?? null })
  )
  m.store.mockReset().mockResolvedValue(undefined)
  m.remove.mockReset().mockResolvedValue(undefined)
  m.capture.mockReset().mockResolvedValue({ ok: true, webp: Buffer.from('w'), width: 1440, height: 900 })
})

describe('POST /design/inputs/[inputId]/capture', () => {
  it('returns the gate response for non-admins', async () => {
    m.gate.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await call()).status).toBe(403)
    expect(m.capture).not.toHaveBeenCalled()
  })

  it('rejects a non-uuid id with 400', async () => {
    expect((await call('nope')).status).toBe(400)
    expect(m.getInput).not.toHaveBeenCalled()
  })

  it('404s for an input outside this session', async () => {
    m.getInput.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
    expect(m.getInput).toHaveBeenCalledWith({}, SID, IID)
    expect(m.claimCapture).not.toHaveBeenCalled()
  })

  it('refuses to capture an uploaded image (400)', async () => {
    m.getInput.mockResolvedValue(makeInputRow({ kind: 'inspiration_image', url: null }))
    expect((await call()).status).toBe(400)
    expect(m.claimCapture).not.toHaveBeenCalled()
  })

  it('409s when a capture is already running', async () => {
    m.claimCapture.mockResolvedValue(null)
    expect((await call()).status).toBe(409)
    expect(m.capture).not.toHaveBeenCalled()
  })

  it('409s for an archived input, before claiming', async () => {
    m.getInput.mockResolvedValue(makeInputRow({ archived: true }))
    const res = await call()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Unarchive this input before capturing it.' })
    expect(m.claimCapture).not.toHaveBeenCalled()
  })

  it('stores a new WebP, points the row at it and deletes the previous object', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(m.capture).toHaveBeenCalledWith('https://acme.example.com/')
    const storedPath = m.store.mock.calls[0][1] as string
    expect(storedPath).toMatch(new RegExp(`^design/${SID}/inputs/${IID}-[0-9a-f-]{36}\\.webp$`))
    expect(m.updateInput).toHaveBeenCalledWith({}, SID, IID, expect.objectContaining({ captureStatus: 'ok', captureError: null, storagePath: storedPath }))
    expect(m.remove).toHaveBeenCalledWith({}, [OLD])
    const body = await res.json()
    expect(body.input.captureStatus).toBe('ok')
    expect(body.input.thumbnailUrl).toBe(`https://signed/${storedPath}`)
  })

  it('records a clean capture failure with our own reason and keeps the old image', async () => {
    m.capture.mockResolvedValue({ ok: false, reason: 'That URL is not publicly reachable.' })
    const res = await call()
    expect(res.status).toBe(200)
    expect(m.store).not.toHaveBeenCalled()
    expect(m.updateInput).toHaveBeenCalledWith({}, SID, IID, { captureStatus: 'error', captureError: 'That URL is not publicly reachable.' })
    const body = await res.json()
    expect(body.input.captureStatus).toBe('error')
    expect(body.input.thumbnailUrl).toBe(`https://signed/${OLD}`)
  })

  it('404s when the row is deleted mid-capture, on a clean capture failure', async () => {
    m.capture.mockResolvedValue({ ok: false, reason: 'That URL is not publicly reachable.' })
    m.updateInput.mockResolvedValueOnce(null)
    const res = await call()
    expect(res.status).toBe(404)
  })

  it('resets the row to error and cleans up on an unexpected failure', async () => {
    m.updateInput.mockImplementationOnce(async () => {
      throw new Error('db down')
    })
    const res = await call()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to capture the screenshot' })
    const storedPath = m.store.mock.calls[0][1] as string
    expect(m.remove).toHaveBeenCalledWith({}, [storedPath])
    expect(m.updateInput).toHaveBeenLastCalledWith({}, SID, IID, { captureStatus: 'error', captureError: 'Capture failed. Try again.' })
  })

  it('resets the row to error when storing the new image throws, without removing anything (nothing was stored yet)', async () => {
    m.store.mockRejectedValueOnce(new Error('storage down'))
    const res = await call()
    expect(res.status).toBe(500)
    expect(m.remove).not.toHaveBeenCalled()
    expect(m.updateInput).toHaveBeenCalledWith({}, SID, IID, { captureStatus: 'error', captureError: 'Capture failed. Try again.' })
  })

  it('logs (and does not throw) when the reset-to-error write itself fails', async () => {
    m.store.mockRejectedValueOnce(new Error('storage down'))
    m.updateInput.mockImplementationOnce(async () => {
      throw new Error('db down again')
    })
    const res = await call()
    expect(res.status).toBe(500)
    expect(console.warn).toHaveBeenCalledWith(
      '[design-capture] failed to reset row to error after a capture failure:',
      expect.any(Error)
    )
  })

  it('does not roll back a committed capture when signing fails afterward', async () => {
    m.sign.mockRejectedValueOnce(new Error('sign down'))
    const res = await call()
    expect(res.status).toBe(200)
    const storedPath = m.store.mock.calls[0][1] as string
    expect(m.remove).toHaveBeenCalledTimes(1)
    expect(m.remove).toHaveBeenCalledWith({}, [OLD])
    expect(m.remove).not.toHaveBeenCalledWith({}, [storedPath])
    expect(m.updateInput).toHaveBeenCalledTimes(1)
    const body = await res.json()
    expect(body.input.captureStatus).toBe('ok')
    expect(body.input.thumbnailUrl).toBeNull()
  })
})
