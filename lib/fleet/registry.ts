import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { ClientEntry, ClientsConfig, TargetSelection } from './types'

// Fleet roster: config/clients.json. Carried over from the (superseded)
// feat/fleet-rollout branch.

export const DEFAULT_CLIENTS_PATH = path.join(process.cwd(), 'config', 'clients.json')

function validateEntry(e: unknown, i: number): ClientEntry {
  const o = (e ?? {}) as Record<string, unknown>
  if (typeof o.slug !== 'string' || !o.slug.trim()) {
    throw new Error(`clients.json: entry ${i} is missing a string "slug"`)
  }
  const slug = o.slug.trim()
  if (!/^[\w.-]+\/[\w.-]+$/.test(slug)) throw new Error(`clients.json: entry ${i} slug "${slug}" is not owner/repo`)
  return {
    slug,
    displayName: typeof o.displayName === 'string' ? o.displayName : slug,
    liveUrl: typeof o.liveUrl === 'string' ? o.liveUrl : null,
    themeGroup: typeof o.themeGroup === 'string' && o.themeGroup.trim() ? o.themeGroup.trim() : null,
    managed: o.managed === true,
    paused: o.paused === true,
    noDeploy: o.noDeploy === true,
  }
}

export function parseClients(text: string): ClientEntry[] {
  const parsed = JSON.parse(text) as ClientsConfig
  if (!Array.isArray(parsed?.clients)) throw new Error('clients.json: expected a top-level "clients" array')
  const clients = parsed.clients.map(validateEntry)
  const seen = new Set<string>()
  for (const c of clients) {
    const key = c.slug.toLowerCase()
    if (seen.has(key)) throw new Error(`clients.json: duplicate slug "${c.slug}"`)
    seen.add(key)
  }
  return clients
}

export function loadClients(clientsPath: string = DEFAULT_CLIENTS_PATH): ClientEntry[] {
  return parseClients(readFileSync(clientsPath, 'utf-8'))
}

export function repoName(slug: string): string {
  return slug.includes('/') ? slug.split('/')[1] : slug
}

// "bblcpa" resolves "Revaltus/bblcpa" too.
function slugMatches(entry: ClientEntry, wanted: string): boolean {
  const w = wanted.trim().toLowerCase()
  return entry.slug.toLowerCase() === w || repoName(entry.slug).toLowerCase() === w
}

export interface ResolveResult {
  targets: ClientEntry[]
  /** Named-but-paused/unmanaged entries that were still included (explicit intent). */
  includedExplicitly: ClientEntry[]
}

// Exactly one selector. --slugs: every name must resolve (paused/unmanaged are
// included but reported). --group / --all: managed, non-paused, grouped only.
export function resolveTargets(clients: ClientEntry[], selection: TargetSelection): ResolveResult {
  const selectors = [selection.slugs?.length ? 'slugs' : null, selection.group ? 'group' : null, selection.all ? 'all' : null].filter(Boolean)
  if (selectors.length !== 1) throw new Error('Select exactly one of: --slugs <a,b>, --group <name>, or --all')

  if (selection.slugs?.length) {
    const targets: ClientEntry[] = []
    for (const wanted of selection.slugs) {
      const found = clients.find((c) => slugMatches(c, wanted))
      if (!found) throw new Error(`Unknown client "${wanted}" — not in config/clients.json`)
      if (!targets.includes(found)) targets.push(found)
    }
    return { targets, includedExplicitly: targets.filter((t) => t.paused || !t.managed) }
  }
  if (selection.group) {
    return { targets: clients.filter((c) => c.managed && !c.paused && c.themeGroup === selection.group), includedExplicitly: [] }
  }
  return { targets: clients.filter((c) => c.managed && !c.paused && c.themeGroup !== null), includedExplicitly: [] }
}
