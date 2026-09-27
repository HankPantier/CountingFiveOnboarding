import { describe, expect, it } from 'vitest'
import { loadClients, parseClients, repoName, resolveTargets } from './registry'

const ROSTER = JSON.stringify({
  clients: [
    { slug: 'HankPantier/bblcpa', displayName: 'BBL', themeGroup: 'revaltus-template', managed: true },
    { slug: 'HankPantier/korbey-lague-site', displayName: 'Korbey', themeGroup: 'revaltus-template', managed: true, paused: true },
    { slug: 'HankPantier/old-site', displayName: 'Old', themeGroup: null, managed: false },
  ],
})

describe('registry', () => {
  it('parses and validates the roster', () => {
    expect(parseClients(ROSTER).map((c) => repoName(c.slug))).toEqual(['bblcpa', 'korbey-lague-site', 'old-site'])
    expect(() => parseClients('{"clients":[{"slug":"nope"}]}')).toThrow(/owner\/repo/)
    expect(() => parseClients('{"clients":[{"slug":"a/b"},{"slug":"A/B"}]}')).toThrow(/duplicate/)
  })

  it('--all / --group take only managed, un-paused, grouped repos', () => {
    const c = parseClients(ROSTER)
    expect(resolveTargets(c, { all: true }).targets.map((t) => repoName(t.slug))).toEqual(['bblcpa'])
    expect(resolveTargets(c, { group: 'revaltus-template' }).targets.map((t) => repoName(t.slug))).toEqual(['bblcpa'])
  })

  it('--slugs includes paused/unmanaged but reports them; unknown names throw', () => {
    const c = parseClients(ROSTER)
    const r = resolveTargets(c, { slugs: ['korbey-lague-site', 'HankPantier/old-site'] })
    expect(r.targets).toHaveLength(2)
    expect(r.includedExplicitly).toHaveLength(2)
    expect(() => resolveTargets(c, { slugs: ['ghost'] })).toThrow(/Unknown client/)
    expect(() => resolveTargets(c, { all: true, group: 'x' })).toThrow(/exactly one/)
  })

  it('the committed config/clients.json has the 11 managed revaltus-template repos', () => {
    const managed = resolveTargets(loadClients(), { all: true }).targets
    expect(managed).toHaveLength(11)
    expect(new Set(managed.map((m) => m.themeGroup))).toEqual(new Set(['revaltus-template']))
  })
})
