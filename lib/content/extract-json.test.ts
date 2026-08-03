import { describe, it, expect } from 'vitest'
import { extractJson } from './extract-json'

describe('extractJson', () => {
  it('parses a clean JSON array', () => {
    expect(extractJson('[{"label":"A","text":"x"}]')).toEqual([{ label: 'A', text: 'x' }])
  })

  it('strips ```json code fences', () => {
    const out = extractJson('```json\n[{"text":"x"}]\n```')
    expect(out).toEqual([{ text: 'x' }])
  })

  it('tolerates leading and trailing prose around the array', () => {
    const out = extractJson('Here are 3 options:\n[{"text":"x"}]\nHope that helps!')
    expect(out).toEqual([{ text: 'x' }])
  })

  it('throws on a truncated (unbalanced) array so the caller can retry', () => {
    // Model output cut off mid-way through a third object leaves no closing `]`.
    const truncated = '[{"text":"one"},{"text":"two"},{"text":"thr'
    expect(() => extractJson(truncated)).toThrow()
  })

  it('throws when no JSON is present', () => {
    expect(() => extractJson('I could not complete that request.')).toThrow()
  })
})
