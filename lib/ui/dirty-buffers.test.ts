import { describe, it, expect } from 'vitest'
import { reconcileDirtyAfterSave } from './dirty-buffers'

describe('reconcileDirtyAfterSave', () => {
  it('clears the entry when it still equals the sent content', () => {
    const dirty = new Map([['a.md', 'v1'], ['b.md', 'x']])
    const next = reconcileDirtyAfterSave(dirty, 'a.md', 'v1')
    expect(next.has('a.md')).toBe(false)
    expect(next.get('b.md')).toBe('x')
  })

  it('keeps newer typing made while the save was in flight', () => {
    const dirty = new Map([['a.md', 'v2 newer']])
    const next = reconcileDirtyAfterSave(dirty, 'a.md', 'v1')
    expect(next.get('a.md')).toBe('v2 newer')
    expect(next).toBe(dirty)
  })

  it('is a no-op when the path is not dirty', () => {
    const dirty = new Map<string, string>()
    expect(reconcileDirtyAfterSave(dirty, 'a.md', 'v1')).toBe(dirty)
  })
})
