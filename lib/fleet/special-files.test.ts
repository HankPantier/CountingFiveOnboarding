import { describe, expect, it } from 'vitest'
import { compareVersions, editGitignore, editPackageJson, mergeLines, readMarker, stampMarker } from './special-files'

const PKG = `{
  "name": "site",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "export-brief": "tsx scripts/export-design-brief.ts",
    "export-kit": "tsx scripts/export-kit.ts",
    "validate": "tsx scripts/validate.ts",
    "design-preview": "tsx scripts/design-preview.ts"
  },
  "dependencies": {
    "next": "16.0.0"
  }
}
`

describe('editPackageJson', () => {
  it('adds scripts before the anchor and removes retired ones without reformatting', () => {
    const r = editPackageJson(PKG, {
      addScripts: { 'generate-fonts': 'tsx scripts/generate-fonts.ts' },
      removeScripts: ['export-brief', 'export-kit', 'design-preview'],
    })
    expect(r.text).toBe(`{
  "name": "site",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "generate-fonts": "tsx scripts/generate-fonts.ts",
    "validate": "tsx scripts/validate.ts"
  },
  "dependencies": {
    "next": "16.0.0"
  }
}
`)
    expect(r.changes).toEqual(['-script export-brief', '-script export-kit', '-script design-preview', '+script generate-fonts'])
  })

  it('is idempotent and keeps a client-customised value', () => {
    const once = editPackageJson(PKG, { addScripts: { dev: 'next dev --turbo' } })
    expect(once.text).toBe(PKG)
    expect(once.changes).toEqual(['=script dev (kept client value)'])
  })

  it('pins dependencies surgically: new section, new key, changed value', () => {
    const r = editPackageJson(PKG, {
      setDependencies: { optionalDependencies: { '@rolldown/binding-linux-x64-gnu': '1.0.0' }, dependencies: { next: '16.1.0', zod: '4.0.0' } },
    })
    const j = JSON.parse(r.text) as Record<string, Record<string, string>>
    expect(j.optionalDependencies).toEqual({ '@rolldown/binding-linux-x64-gnu': '1.0.0' })
    expect(j.dependencies).toEqual({ next: '16.1.0', zod: '4.0.0' })
    expect(r.text).toContain('  "optionalDependencies": {\n    "@rolldown/binding-linux-x64-gnu": "1.0.0"\n  }\n}')
    expect(r.text).toContain('"scripts": {\n    "dev": "next dev",') // untouched
  })
})

describe('editGitignore / mergeLines', () => {
  it('removes retired lines in any /x or x/ spelling and appends new ones once', () => {
    const r = editGitignore('node_modules\n/design-kit/\ndesign-brief.md\n.env', { remove: ['design-kit/', 'design-brief.md'], add: ['.fleet/'] })
    expect(r.text).toBe('node_modules\n.env\n.fleet/\n')
    expect(editGitignore(r.text, { add: ['.fleet/'] }).changes).toEqual([])
  })
  it('.gitattributes: appends only lines the client lacks', () => {
    const r = mergeLines('* text=auto\n', '* text=auto\n*.png binary\n')
    expect(r.text).toBe('* text=auto\n*.png binary\n')
    expect(mergeLines(null, 'a\n').text).toBe('a\n')
  })
})

describe('marker', () => {
  it('stamps syncedFrom (full sha) on the template marker', () => {
    const sha = 'a'.repeat(40)
    const out = stampMarker('{"templateVersion":"2026.09.5","capabilities":["fonts"]}', sha)
    expect(JSON.parse(out)).toEqual({ templateVersion: '2026.09.5', capabilities: ['fonts'], syncedFrom: sha })
    expect(out.endsWith('}\n')).toBe(true)
    expect(() => stampMarker('{}', 'abc')).toThrow(/40-char/)
    expect(readMarker(out)).toEqual({ templateVersion: '2026.09.5', syncedFrom: sha, capabilities: ['fonts'] })
    expect(readMarker('not json').templateVersion).toBeNull()
  })
  it('compareVersions orders dotted versions numerically', () => {
    expect(compareVersions('2026.09.10', '2026.09.9')).toBeGreaterThan(0)
    expect(compareVersions('2026.09.4', '2026.09.4')).toBe(0)
    expect(['2026.10.1', '2026.09.4', '2026.09.10'].sort(compareVersions)).toEqual(['2026.09.4', '2026.09.10', '2026.10.1'])
  })
})
