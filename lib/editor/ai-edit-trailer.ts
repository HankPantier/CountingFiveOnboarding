// The AI page editor (/api/edit/[id]/chat) never sees or writes the generator
// trailer (`## SEO & AIO Metadata` + `## Structured Data — paste into <head>`).
// The model edits a VIEW of the file with the trailer split off; on commit the
// trailer is re-attached verbatim, the same way PageEditor does for the manual
// editor. Before this, apply_edit(s)/remove_text ran over the whole file, and a
// deleted SEO heading plus a dash-scrubbed "Structured Data, paste into" made
// Accord's /services render its JSON-LD as a live code block.

import { repairPageTrailer, stripGeneratorNotesFromFile } from '@/lib/content/strip-generator-notes'
import { applyBulkRemovals } from './bulk-remove'
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

/**
 * remove_text's phrase removals, applied to the hidden trailer so a firm-wide
 * rename also reaches the JSON-LD that the template lifts into <head>. Dashes
 * are never scrubbed here, and the result is discarded (trailer kept as-is)
 * if the removals would alter any heading, rule or label line.
 */
export function applyRemovalsToTrailer(
  trailer: string,
  removals: Array<{ find: string; replace?: string }>,
  caseInsensitive: boolean
): string {
  if (!trailer || removals.length === 0) return trailer
  const next = applyBulkRemovals(trailer, removals, { caseInsensitive }).next
  const before = trailerSkeleton(trailer)
  const after = trailerSkeleton(next)
  const intact = before.length === after.length && before.every((l, i) => l === after[i])
  return intact ? next : trailer
}
