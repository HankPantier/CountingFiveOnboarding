import { describe, expect, it } from 'vitest'
import { sessionStoragePrefixes } from './storage-prefixes'

describe('sessionStoragePrefixes', () => {
  it('covers every per-session prefix, including Design Studio objects', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e'
    expect(sessionStoragePrefixes(id)).toEqual([
      `sessions/${id}`,
      `pdfs/${id}`,
      `content-packages/${id}`,
      `design/${id}`,
    ])
  })
})
