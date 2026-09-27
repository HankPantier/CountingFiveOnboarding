import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { dropLockPackages, lockVersionChanges, missingLockPackages, regenerateLock } from './lockfile'
import { loadManifest } from './release-manifest'

const LOCK = JSON.stringify({
  name: 'site',
  lockfileVersion: 3,
  packages: {
    '': { name: 'site' },
    'node_modules/next': { version: '16.2.7' },
    'node_modules/rolldown': { version: '1.0.0' },
    'node_modules/@rolldown/binding-darwin-arm64': { version: '1.0.0' },
    'node_modules/@img/sharp-darwin-arm64': { version: '0.34.1' },
    'node_modules/next/node_modules/sharp': { version: '0.34.1' },
    'node_modules/react': { version: '19.0.0' },
    'node_modules/esbuild': { version: '0.28.0' },
  },
})

describe('lockfile recipe', () => {
  it('the 2026.09.5 manifest drops exactly the native-binding families (+ next), never the root or react', () => {
    const m = loadManifest('2026.09.5')
    if (typeof m.lockfile !== 'object') throw new Error('2026.09.5 must carry a lockfile recipe')
    const { dropped } = dropLockPackages(LOCK, m.lockfile.dropPackages)
    expect(dropped.sort()).toEqual(
      [
        'node_modules/next',
        'node_modules/rolldown',
        'node_modules/@rolldown/binding-darwin-arm64',
        'node_modules/@img/sharp-darwin-arm64',
        'node_modules/next/node_modules/sharp',
        'node_modules/esbuild',
      ].sort()
    )
    expect(m.lockfile.expectPackages).toEqual(['node_modules/@rolldown/binding-linux-x64-gnu', 'node_modules/@img/sharp-linux-x64'])
  })

  it('reports missing expected keys and version changes (patch vs not)', () => {
    expect(missingLockPackages(LOCK, ['node_modules/react', 'node_modules/@img/sharp-linux-x64'])).toEqual(['node_modules/@img/sharp-linux-x64'])
    const after = LOCK.replace('"0.28.0"', '"0.28.2"').replace('"19.0.0"', '"20.0.0"')
    expect(lockVersionChanges(LOCK, after)).toEqual([
      { key: 'node_modules/react', from: '19.0.0', to: '20.0.0', nonPatch: true },
      { key: 'node_modules/esbuild', from: '0.28.0', to: '0.28.2', nonPatch: false },
    ])
  })

  it('regenerateLock re-resolves in a temp dir with the dropped lock and checks the expected keys', () => {
    let seenPkg = ''
    let seenLock = ''
    const fakeNpm = (cwd: string) => {
      seenPkg = readFileSync(path.join(cwd, 'package.json'), 'utf8')
      seenLock = readFileSync(path.join(cwd, 'package-lock.json'), 'utf8')
      const lock = JSON.parse(seenLock) as { packages: Record<string, unknown> }
      lock.packages['node_modules/@rolldown/binding-linux-x64-gnu'] = { version: '1.0.0' }
      writeFileSync(path.join(cwd, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n')
      return { ok: true, err: '' }
    }
    const r = regenerateLock('{"name":"site"}', LOCK, { dropPackages: '(^|/)node_modules/(rolldown|@rolldown/binding-)', expectPackages: ['node_modules/@rolldown/binding-linux-x64-gnu', 'node_modules/@img/sharp-linux-x64'] }, fakeNpm)
    expect(seenPkg).toBe('{"name":"site"}')
    expect(seenLock).not.toContain('binding-darwin-arm64')
    expect(r.dropped).toHaveLength(2)
    expect(r.missing).toEqual(['node_modules/@img/sharp-linux-x64'])
    expect(() => regenerateLock('{}', LOCK, null, () => ({ ok: false, err: 'E404' }))).toThrow(/E404/)
  })
})
