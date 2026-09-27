// The AI page editor (/api/edit/[id]/chat) never sees or writes the generator
// trailer (`## SEO & AIO Metadata` + `## Structured Data — paste into <head>`).
// The model edits a VIEW of the file with the trailer split off; on commit the
// trailer is re-attached verbatim, the same way PageEditor does for the manual
// editor. Before this, apply_edit(s)/remove_text ran over the whole file, and a
// deleted SEO heading plus a dash-scrubbed "Structured Data, paste into" made
// Accord's /services render its JSON-LD as a live code block.

import { repairPageTrailer, stripGeneratorNotesFromFile } from '@/lib/content/strip-generator-notes'
import { applyBulkRemovals, countPhrase, type RemovalCount, type ResidualCount } from './bulk-remove'
import { splitFile } from './frontmatter'
import { humanizeBodyDashes, splitTrailers } from './page-body'

export interface ModelView {
  /** Frontmatter + editable body — what the model is shown and edits. */
  visible: string
  /** The hidden generator trailer ('' when the file has none). */
  trailer: string
}

// visible + trailer === file.
export function splitForModel(file: string): ModelView {
  const { body } = splitFile(file)
  const { trailer } = splitTrailers(body)
  return { visible: file.slice(0, file.length - trailer.length), trailer }
}

/**
 * The full file to commit from the model's edited view: re-attach the trailer,
 * dash-scrub the prose, then per content root — a post has no trimming
 * renderer, so any trailer is dropped; a page keeps it with its SEO marker
 * restored if missing.
 */
export function composeAiEditCommit(nextVisible: string, trailer: string, path: string): string {
  const full = humanizeBodyDashes(nextVisible + trailer)
  return path.startsWith('content/posts/')
    ? stripGeneratorNotesFromFile(full).content
    : repairPageTrailer(full).content
}

// Heading, rule and label lines: the trailer's structure. Phrase removals may
// change the values between them (e.g. a firm rename inside the JSON-LD), never
// these lines.
function trailerSkeleton(trailer: string): string[] {
  return trailer
    .split(/\r?\n/)
    .filter((l) => /^(?:#{1,6}[ \t]|-{3,}[ \t]*$|\*\*[^*]+:\*\*[ \t]*$|```)/.test(l))
}

const LD_JSON_RE = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi

// Every key path in a JSON value ("a.b[].c"), sorted — the block's shape.
function keyPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v) => keyPaths(v, `${prefix}[]`))
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
      `${prefix}.${k}`,
      ...keyPaths(v, `${prefix}.${k}`),
    ])
  }
  return []
}

// Shape of every ld+json block (null when any block fails to parse). The
// template JSON.parses these into <head>; a block that stops parsing is
// silently dropped there, so a removal must never break or reshape one.
function jsonLdShapes(trailer: string): string[] | null {
  const shapes: string[] = []
  for (const m of trailer.matchAll(LD_JSON_RE)) {
    try {
      shapes.push([...new Set(keyPaths(JSON.parse(m[1].trim())))].sort().join('|'))
    } catch {
      return null
    }
  }
  return shapes
}

export interface TrailerRemovalResult {
  trailer: string
  /** Per-removal hits that actually landed in the trailer (0 for a refused removal). */
  applied: RemovalCount[]
  /** Phrases still present in the hidden trailer afterwards (refused or partial). */
  residual: ResidualCount[]
}

// True when `next` keeps the trailer's skeleton lines and every ld+json block
// still parses with the same key set as `original`.
function trailerShapeKept(original: string, next: string): boolean {
  const before = trailerSkeleton(original)
  const after = trailerSkeleton(next)
  if (before.length !== after.length || !before.every((l, i) => l === after[i])) return false
  const ldBefore = jsonLdShapes(original)
  const ldAfter = jsonLdShapes(next)
  if (ldAfter === null) return false
  if (ldBefore !== null && (ldBefore.length !== ldAfter.length || !ldBefore.every((s, i) => s === ldAfter[i]))) {
    return false
  }
  return true
}

/**
 * remove_text's phrase removals, applied to the hidden trailer so a firm-wide
 * rename also reaches the JSON-LD that the template lifts into <head>. Dashes
 * are never scrubbed here. Removals are applied ONE AT A TIME: a removal that
 * would alter any heading, rule, label or fence line, or make an ld+json block
 * stop parsing or change its key set, is refused on its own (e.g. a "—"
 * removal hitting the Structured Data heading), and the others still land.
 */
export function applyRemovalsToTrailer(
  trailer: string,
  removals: Array<{ find: string; replace?: string }>,
  caseInsensitive: boolean
): TrailerRemovalResult {
  const applied: RemovalCount[] = []
  let current = trailer
  for (const removal of removals) {
    if (!current) {
      applied.push({ find: removal.find, removed: 0 })
      continue
    }
    const res = applyBulkRemovals(current, [removal], { caseInsensitive })
    if (res.next !== current && trailerShapeKept(trailer, res.next)) {
      current = res.next
      applied.push(res.applied[0])
    } else {
      applied.push({ find: removal.find, removed: 0 })
    }
  }
  // Counted outside the skeleton lines (a heading's "—" is structure, not
  // copy). Dash-only finds are skipped: dashes are never scrubbed here by
  // design. A replacement that itself contains the find term would always count.
  const skeleton = new Set(trailerSkeleton(trailer))
  const values = current
    .split(/\r?\n/)
    .filter((l) => !skeleton.has(l))
    .join('\n')
  const residual: ResidualCount[] = removals
    .filter(
      (r) =>
        r.find &&
        r.find.trim() !== '' &&
        !/^[\s—–-]+$/.test(r.find) &&
        countPhrase(r.replace ?? '', r.find, caseInsensitive) === 0
    )
    .map((r) => ({ find: r.find, remaining: countPhrase(values, r.find, caseInsensitive) }))
    .filter((r) => r.remaining > 0)
  return { trailer: current, applied, residual }
}
