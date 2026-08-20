import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadClients, resolveTargets } from './registry'
import type { ClientEntry } from './types'

function client(slug: string, over: Partial<ClientEntry> = {}): ClientEntry {
  return {
    slug,
    displayName: slug,
    liveUrl: null,
    themeGroup: 'ink',
    managed: true,
    paused: false,
    ...over,
  }
}

const A = client('HankPantier/bblcpa')
const B = client('HankPantier/korbey-lague-site')
const CUnmanaged = client('HankPantier/foo', { managed: false })
const DOther = client('HankPantier/bar', { themeGroup: 'other' })
const EPaused = client('HankPantier/paused', { paused: true })
const FUnassigned = client('HankPantier/unassigned', { themeGroup: null })
const ALL = [A, B, CUnmanaged, DOther, EPaused, FUnassigned]

describe('resolveTargets — group', () => {
  it('selects managed, non-paused clients in the group', () => {
    expect(resolveTargets(ALL, { group: 'ink' }).targets).toEqual([A, B])
  })
  it('excludes unmanaged, paused, and other-group clients', () => {
    const t = resolveTargets(ALL, { group: 'ink' }).targets
    expect(t).not.toContain(CUnmanaged)
    expect(t).not.toContain(DOther)
    expect(t).not.toContain(EPaused)
  })
})

describe('resolveTargets — all', () => {
  it('sweeps every managed, non-paused, group-assigned client', () => {
    expect(resolveTargets(ALL, { all: true }).targets).toEqual([A, B, DOther])
  })
  it('never sweeps an unassigned (null group) client', () => {
    expect(resolveTargets(ALL, { all: true }).targets).not.toContain(FUnassigned)
  })
})

describe('resolveTargets — slugs', () => {
  it('resolves a bare repo name to its full slug', () => {
    expect(resolveTargets(ALL, { slugs: ['bblcpa'] }).targets).toEqual([A])
  })
  it('includes an explicitly-named paused client and reports it', () => {
    const r = resolveTargets(ALL, { slugs: ['HankPantier/paused'] })
    expect(r.targets).toEqual([EPaused])
    expect(r.includedPaused).toEqual([EPaused])
  })
  it('throws on an unknown slug', () => {
    expect(() => resolveTargets(ALL, { slugs: ['nope'] })).toThrow(/Unknown client/)
  })
  it('dedupes repeated names', () => {
    expect(resolveTargets(ALL, { slugs: ['bblcpa', 'HankPantier/bblcpa'] }).targets).toEqual([A])
  })
})

describe('resolveTargets — selector arity', () => {
  it('requires exactly one selector', () => {
    expect(() => resolveTargets(ALL, {})).toThrow(/exactly one/)
    expect(() => resolveTargets(ALL, { all: true, group: 'ink' })).toThrow(/exactly one/)
  })
})

describe('loadClients', () => {
  function writeConfig(obj: unknown): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'fleet-'))
    const p = path.join(dir, 'clients.json')
    writeFileSync(p, JSON.stringify(obj))
    return p
  }

  it('loads and normalizes entries', () => {
    const p = writeConfig({ clients: [{ slug: 'HankPantier/bblcpa', managed: true, themeGroup: 'ink' }] })
    const clients = loadClients(p)
    expect(clients).toHaveLength(1)
    expect(clients[0]).toMatchObject({ slug: 'HankPantier/bblcpa', managed: true, themeGroup: 'ink', paused: false })
  })

  it('rejects duplicate slugs', () => {
    const p = writeConfig({ clients: [{ slug: 'x/y' }, { slug: 'x/y' }] })
    expect(() => loadClients(p)).toThrow(/duplicate/)
  })

  it('rejects a missing clients array', () => {
    const p = writeConfig({ nope: [] })
    expect(() => loadClients(p)).toThrow(/clients/)
  })
})
