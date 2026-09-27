import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { GENERATOR_TRAILER_ANCHORS, stripGeneratorNotesFromBody } from './strip-generator-notes'

// Byte-mirrored with the client template's src/lib/content/strip-generator-notes
// fixture. If this fails, the platform's anchors drifted from the fixture:
// update the fixture deliberately and copy it (don't retype) to the template.
const FIXTURE_PATH = path.join(__dirname, '__fixtures__', 'generator-trailer.template.json')
const raw = readFileSync(FIXTURE_PATH, 'utf8')

interface Vector {
  name: string
  body: string
  expected: string
  removed: string[]
  refused: boolean
}
const fixture = JSON.parse(raw) as { anchors: unknown; vectors: Vector[] }

describe('generator-trailer.template.json parity', () => {
  it('is canonical JSON (2-space, trailing newline) so both repos can byte-compare it', () => {
    expect(raw).toBe(JSON.stringify(fixture, null, 2) + '\n')
  })

  it('anchors equal the ones the platform strip actually uses', () => {
    expect(fixture.anchors).toEqual(GENERATOR_TRAILER_ANCHORS)
  })

  it('every anchor compiles', () => {
    const a = fixture.anchors as Record<string, { source: string; flags: string } | unknown>
    for (const [k, v] of Object.entries(a)) {
      if (v && typeof v === 'object' && 'source' in v) {
        const { source, flags } = v as { source: string; flags: string }
        expect(() => new RegExp(source, flags), k).not.toThrow()
      }
    }
  })

  for (const v of fixture.vectors) {
    it(`vector: ${v.name}`, () => {
      const r = stripGeneratorNotesFromBody(v.body)
      expect(r.body).toBe(v.expected)
      expect(r.removed).toEqual(v.removed)
      expect(Boolean(r.warning)).toBe(v.refused)
    })
  }

  it('covers cut, keep and refuse outcomes', () => {
    expect(fixture.vectors.some((v) => v.removed.length > 0)).toBe(true)
    expect(fixture.vectors.some((v) => v.name.startsWith('NEGATIVE') && v.expected === v.body)).toBe(true)
    expect(fixture.vectors.some((v) => v.refused)).toBe(true)
  })
})
