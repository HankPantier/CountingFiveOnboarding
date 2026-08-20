import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { ClientEntry, ClientsConfig, TargetSelection } from './types'

const DEFAULT_CLIENTS_PATH = path.join(process.cwd(), 'config', 'clients.json')

function validateEntry(e: unknown, i: number): ClientEntry {
  const o = e as Record<string, unknown>
  if (typeof o?.slug !== 'string' || !o.slug.trim()) {
    throw new Error(`clients.json: entry ${i} is missing a string "slug"`)
  }
  return {
    slug: o.slug.trim(),
    displayName: typeof o.displayName === 'string' ? o.displayName : o.slug,
    liveUrl: typeof o.liveUrl === 'string' ? o.liveUrl : null,
    themeGroup: typeof o.themeGroup === 'string' && o.themeGroup.trim() ? o.themeGroup.trim() : null,
    managed: o.managed === true,
    paused: o.paused === true,
  }
}

export function loadClients(clientsPath: string = DEFAULT_CLIENTS_PATH): ClientEntry[] {
  const parsed = JSON.parse(readFileSync(clientsPath, 'utf-8')) as ClientsConfig
  if (!Array.isArray(parsed?.clients)) {
    throw new Error('clients.json: expected a top-level "clients" array')
  }
  const clients = parsed.clients.map(validateEntry)
  const seen = new Set<string>()
  for (const c of clients) {
    const key = c.slug.toLowerCase()
    if (seen.has(key)) throw new Error(`clients.json: duplicate slug "${c.slug}"`)
    seen.add(key)
  }
  return clients
}

// Match a selection slug against an entry. Accepts the bare repo name too, so
// "bblcpa" resolves "HankPantier/bblcpa".
function slugMatches(entry: ClientEntry, wanted: string): boolean {
  const w = wanted.trim().toLowerCase()
  const full = entry.slug.toLowerCase()
  const bare = full.includes('/') ? full.split('/')[1] : full
  return full === w || bare === w
}

export interface ResolveResult {
  targets: ClientEntry[]
  /** Named-but-paused entries that were still included (explicit intent). */
  includedPaused: ClientEntry[]
}

// Turn a selection into the concrete target set. Exactly one selector must be set.
// - slugs: explicit; every name must resolve or we throw. Paused entries ARE
//   included (operator named them) but reported so the CLI can warn. Managed is
//   NOT required for explicit names.
// - group: every managed, non-paused client whose themeGroup equals the group.
// - all:   every managed, non-paused client (themeGroup must be set — an
//          unassigned client is never swept).
export function resolveTargets(clients: ClientEntry[], selection: TargetSelection): ResolveResult {
  const selectors = [selection.slugs?.length ? 'slugs' : null, selection.group ? 'group' : null, selection.all ? 'all' : null].filter(Boolean)
  if (selectors.length !== 1) {
    throw new Error('Select exactly one of: --slugs <a,b>, --group <name>, or --all')
  }

  if (selection.slugs?.length) {
    const targets: ClientEntry[] = []
    for (const wanted of selection.slugs) {
      const found = clients.find((c) => slugMatches(c, wanted))
      if (!found) throw new Error(`Unknown client "${wanted}" — not in config/clients.json`)
      if (!targets.includes(found)) targets.push(found)
    }
    return { targets, includedPaused: targets.filter((t) => t.paused) }
  }

  if (selection.group) {
    const group = selection.group
    const targets = clients.filter((c) => c.managed && !c.paused && c.themeGroup === group)
    return { targets, includedPaused: [] }
  }

  // all
  const targets = clients.filter((c) => c.managed && !c.paused && c.themeGroup !== null)
  return { targets, includedPaused: [] }
}
