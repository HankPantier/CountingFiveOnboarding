import { describe, it, expect, vi, beforeEach } from 'vitest'
import { asJson } from '@/lib/supabase/json-typed'
import { SID, makeConceptRow } from './__fixtures__/rows'
import { VALID } from './__fixtures__/valid-bundle'

const m = vi.hoisted(() => ({ getAdopted: vi.fn(), setAdopted: vi.fn(), getConcept: vi.fn() }))
vi.mock('./chat-store', () => ({
  getAdoptedConceptId: (...a: unknown[]) => m.getAdopted(...a),
  setAdoptedConceptId: (...a: unknown[]) => m.setAdopted(...a),
}))
vi.mock('./run-store', () => ({ getConcept: (...a: unknown[]) => m.getConcept(...a) }))

import { readPersistedAdoption, toAdoptionDto } from './chat-adopt'

const DB = {} as never
const C = '2d8b3e4f-7a6c-4a0d-9e3f-4b5c6d7e8f90'

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('readPersistedAdoption', () => {
  it('none stored → null, no concept read', async () => {
    m.getAdopted.mockResolvedValue(null)
    expect(await readPersistedAdoption(DB, SID)).toBeNull()
    expect(m.getConcept).not.toHaveBeenCalled()
  })
  it('a ready concept of this session is returned (looked up by the session id)', async () => {
    m.getAdopted.mockResolvedValue(C)
    m.getConcept.mockResolvedValue(makeConceptRow({ id: C, status: 'ready', bundle: asJson({ ...VALID, name: 'Sabine' }) }))
    const got = await readPersistedAdoption(DB, SID)
    expect(m.getConcept).toHaveBeenCalledWith(DB, SID, C)
    expect(toAdoptionDto(got)).toEqual({ conceptId: C, name: 'Sabine' })
  })
  it('a concept that is gone or not ready is cleared', async () => {
    m.getAdopted.mockResolvedValue(C)
    m.getConcept.mockResolvedValue(makeConceptRow({ id: C, status: 'refining' }))
    expect(await readPersistedAdoption(DB, SID)).toBeNull()
    expect(m.setAdopted).toHaveBeenCalledWith(DB, SID, null)
  })
  it('a read error is skipped this time but NOT cleared', async () => {
    m.getAdopted.mockResolvedValue(C)
    m.getConcept.mockRejectedValue(new Error('blip'))
    expect(await readPersistedAdoption(DB, SID)).toBeNull()
    expect(m.setAdopted).not.toHaveBeenCalled()
  })
})
