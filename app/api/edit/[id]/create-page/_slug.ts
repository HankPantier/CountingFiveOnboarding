import { safePath } from '../_path'

// Normalize a user-supplied slug into a traversal-safe { url, path } pair, or
// null if it can't be made into a valid page slug. Segments are lowercased and
// restricted to [a-z0-9-]; '/' nests, encoded as '--' in the filename to match
// the template's [...slug] routing convention. 'home' is reserved (it is the
// template's index page). Runs the final path through safePath so decode/
// traversal tricks in the raw input are rejected the same way as every other
// content route (CLAUDE.md security rule 8).
export function normalizeSlug(raw: string): { url: string; path: string } | null {
  const segments = raw
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .map((s) => s.trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
  if (segments.length === 0) return null
  if (segments.length === 1 && segments[0] === 'home') return null
  const url = '/' + segments.join('/')
  const path = safePath('content/pages/' + segments.join('--') + '.md')
  if (!path) return null
  return { url, path }
}
