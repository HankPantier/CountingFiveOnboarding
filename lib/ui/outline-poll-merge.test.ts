import { describe, it, expect } from 'vitest'
import { mergePolledOutlines } from './outline-poll-merge'

type Row = { id: string; h1: string | null; approved: boolean }

describe('mergePolledOutlines', () => {
  const local: Row[] = [
    { id: 'a', h1: 'Edited locally', approved: false },
    { id: 'b', h1: null, approved: false },
  ]

  it('adopts server rows when nothing is dirty', () => {
    const server: Row[] = [
      { id: 'a', h1: 'Server A', approved: false },
      { id: 'b', h1: 'Server B', approved: false },
    ]
    expect(mergePolledOutlines(local, server, new Set())).toEqual(server)
  })

  it('keeps the local copy of a dirty row and adopts the rest', () => {
    const server: Row[] = [
      { id: 'a', h1: 'Server A', approved: false },
      { id: 'b', h1: 'Generated B', approved: false },
    ]
    const merged = mergePolledOutlines(local, server, new Set(['a']))
    expect(merged[0].h1).toBe('Edited locally')
    expect(merged[1].h1).toBe('Generated B')
  })

  it('follows server membership and order (new rows added, removed rows dropped)', () => {
    const server: Row[] = [
      { id: 'c', h1: 'New', approved: false },
      { id: 'a', h1: 'Server A', approved: true },
    ]
    const merged = mergePolledOutlines(local, server, new Set(['a', 'b']))
    expect(merged.map((r) => r.id)).toEqual(['c', 'a'])
    expect(merged[1].h1).toBe('Edited locally')
  })

  it('falls back to the server row when a dirty id has no local copy', () => {
    const server: Row[] = [{ id: 'z', h1: 'Z', approved: false }]
    expect(mergePolledOutlines(local, server, new Set(['z']))).toEqual(server)
  })

  it('takes server-owned status keys even on a dirty row', () => {
    const server: Row[] = [{ id: 'a', h1: 'Server A', approved: true }]
    const merged = mergePolledOutlines(local, server, new Set(['a']), ['approved'])
    expect(merged[0]).toEqual({ id: 'a', h1: 'Edited locally', approved: true })
  })
})
