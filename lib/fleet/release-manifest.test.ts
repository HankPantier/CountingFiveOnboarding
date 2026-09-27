import { describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RELEASES_DIR, loadManifest, manifestForRange, mergeManifests, parseManifest } from './release-manifest'

describe('parseManifest', () => {
  it('rejects unknown fields, bad rulings and bad enums', () => {
    expect(() => parseManifest('{"templateVersion":"1","themeCSS":"none"}')).toThrow(/unknown field "themeCSS"/)
    expect(() => parseManifest('{"templateVersion":"1","themeCss":"regen"}')).toThrow(/themeCss/)
    expect(() => parseManifest('{"templateVersion":"1","rulings":{"bblcpa":{"a.ts":"force"}}}')).toThrow(/rulings/)
    expect(() => parseManifest('{"templateVersion":"1","packageJson":{"setDependencies":{"peerDependencies":{}}}}')).toThrow(/not allowed/)
    expect(() => parseManifest('{"themeCss":"none"}')).toThrow(/templateVersion/)
  })

  it('every committed release manifest parses and names its own version', () => {
    const files = readdirSync(RELEASES_DIR).filter((f) => f.endsWith('.json'))
    expect(files.length).toBeGreaterThanOrEqual(3)
    for (const f of files) {
      const m = parseManifest(readFileSync(path.join(RELEASES_DIR, f), 'utf-8'), f)
      expect(`${m.templateVersion}.json`).toBe(f)
    }
  })

  it('2026.09.4 routes theme.css through the additive helper (never a wholesale copy)', () => {
    expect(loadManifest('2026.09.4').themeCss).toBe('additive-helper')
  })
})

describe('mergeManifests / manifestForRange', () => {
  it('a client that skipped a release gets both migrations', () => {
    const m = mergeManifests([loadManifest('2026.09.2'), loadManifest('2026.09.3'), loadManifest('2026.09.4')])
    expect(m.templateVersion).toBe('2026.09.4')
    expect(m.packageJson?.addScripts).toHaveProperty('generate-fonts')
    expect(m.packageJson?.removeScripts).toEqual(['export-brief', 'export-kit', 'design-preview'])
    expect(m.gitattributes).toBe('merge-lines')
    expect(m.themeCss).toBe('additive-helper')
    expect(m.deleteTracked).toEqual(['design-kit', 'design-brief.md'])
  })

  it('picks the manifests strictly after OLD up to NEW, oldest first', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'fleet-manifests-'))
    for (const [v, extra] of [
      ['2026.09.4', { themeCss: 'additive-helper' }],
      ['2026.09.5', { packageJson: { removeScripts: ['a'] } }],
      ['2026.09.10', { packageJson: { addScripts: { a: 'x' } } }],
    ] as const) {
      writeFileSync(path.join(dir, `${v}.json`), JSON.stringify({ templateVersion: v, ...extra }))
    }
    const m = manifestForRange('2026.09.4', '2026.09.10', { dir })
    expect(m.themeCss).toBeUndefined() // 2026.09.4 is OLD — already applied
    expect(m.packageJson).toEqual({ addScripts: { a: 'x' } }) // later add wins over earlier remove
    expect(() => manifestForRange('2026.09.4', '2026.09.11', { dir })).toThrow(/No release manifest for template 2026.09.11/)
  })
})
