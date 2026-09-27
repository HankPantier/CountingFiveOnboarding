import { describe, it, expect } from 'vitest'
import { designMdRewrite } from '@/lib/content/design-md-builder'
import { BRAND_TEXT, DESIGN_TEXT } from './__fixtures__/theme-texts'
import { designMdState, diffLines, directionFromVersionBundle, generateDesignMd, hashDesignMd, previewDesignMd } from './design-md-adopt'
import { diffHunks } from './design-md-ui'

const gen = () => {
  const g = generateDesignMd({ brandText: BRAND_TEXT, designText: DESIGN_TEXT, schema: { business: { name: 'Acme CPA' } } })
  if (!g.ok) throw new Error(g.error)
  return g.text
}
// A pre-hash fleet file: same builder output, marker without the body hash.
const legacy = (text: string) => text.replace(/ · body-sha256:[0-9a-f]{64} -->/, ' -->')

describe('designMdState', () => {
  it('classifies absent / hand-written / legacy / edited / untouched', () => {
    const fresh = gen()
    expect(designMdState(null)).toBe('absent')
    expect(designMdState('# Our brand\n\nNavy and gold.\n')).toBe('hand-written')
    expect(designMdState(legacy(fresh))).toBe('legacy')
    expect(designMdState(fresh)).toBe('untouched')
    expect(designMdState(fresh.replace('## Overview\n', '## Overview\n\nHand note.\n'))).toBe('edited')
  })
  it('a legacy fleet file that no longer equals a rebuild is never rewritten by a Studio commit — hence this adoption path', () => {
    const stale = legacy(gen()).replace('## Overview\n', '## Overview\n\nOlder wording.\n')
    expect(designMdRewrite(stale, { before: gen, after: gen })).toBeNull()
  })
})

describe('generateDesignMd', () => {
  it('builds a hashed, platform-generated file that later Studio commits keep up to date', () => {
    const text = gen()
    expect(designMdState(text)).toBe('untouched')
  })
  it('refuses unreadable theme files', () => {
    expect(generateDesignMd({ brandText: '{', designText: DESIGN_TEXT, schema: null }).ok).toBe(false)
    expect(generateDesignMd({ brandText: '{}', designText: '{}', schema: null }).ok).toBe(false)
  })
})

describe('directionFromVersionBundle', () => {
  it('only concept / chat versions carry a direction', () => {
    const b = { name: 'Harbor', tagline: 'Calm', moves: ['navy', 1] }
    expect(directionFromVersionBundle('concept', b)).toEqual({ name: 'Harbor', tagline: 'Calm', moves: ['navy'] })
    expect(directionFromVersionBundle('chat', b)?.name).toBe('Harbor')
    expect(directionFromVersionBundle('baseline', b)).toBeUndefined()
    expect(directionFromVersionBundle('revert', b)).toBeUndefined()
    expect(directionFromVersionBundle(null, b)).toBeUndefined()
    expect(directionFromVersionBundle('concept', null)).toBeUndefined()
  })
})

describe('diffLines / previewDesignMd', () => {
  it('diffs by line', () => {
    expect(diffLines('a\nb\nc\n', 'a\nx\nc\n')).toEqual([
      { op: 'same', text: 'a' },
      { op: 'del', text: 'b' },
      { op: 'add', text: 'x' },
      { op: 'same', text: 'c' },
    ])
    expect(diffLines('', 'a\n')).toEqual([{ op: 'add', text: 'a' }])
  })
  it('previews an adoption with the guard sha and the hash of exactly the text to commit', () => {
    const next = gen()
    const p = previewDesignMd({ content: legacy(next), sha: 'a'.repeat(40) }, next)
    expect(p).toMatchObject({ state: 'legacy', currentSha: 'a'.repeat(40), unchanged: false, nextHash: hashDesignMd(next), next })
    expect(p.added).toBe(1)
    expect(p.removed).toBe(1)
    expect(previewDesignMd({ content: next, sha: 'b'.repeat(40) }, next).unchanged).toBe(true)
    expect(previewDesignMd(null, next)).toMatchObject({ state: 'absent', currentSha: null, unchanged: false })
  })
})

describe('diffHunks', () => {
  it('collapses unchanged runs around changes', () => {
    const diff = diffLines('1\n2\n3\n4\n5\n6\n7\n8\n', '1\n2\n3\n4\nX\n6\n7\n8\n')
    const { rows, truncated } = diffHunks(diff, 1)
    expect(truncated).toBe(false)
    expect(rows).toEqual([
      { op: 'gap', skipped: 3 },
      { op: 'same', text: '4' },
      { op: 'del', text: '5' },
      { op: 'add', text: 'X' },
      { op: 'same', text: '6' },
      { op: 'gap', skipped: 2 },
    ])
  })
  it('caps the rows', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ op: 'add' as const, text: String(i) }))
    expect(diffHunks(many, 2, 10)).toMatchObject({ truncated: true })
    expect(diffHunks(many, 2, 10).rows).toHaveLength(10)
  })
})
