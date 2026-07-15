// Team-member bio photos ride inside a team-grid block as a `photo: <filename>`
// line immediately under each `### Name` H3 heading:
//
//   <!-- block: team-grid | variant: 3-col -->
//   ## Our Team
//
//   ### Ron Lague, CPA, PFS
//   photo: ron.jpg
//   Ron holds a CPA license...
//
//   ### Jackie Estes, MBA
//   Jackie brings...
//
// The deliverable builder's injectTeamPhotos() writes those lines at build time
// from uploaded team-photo assets; this module lets the content editor read and
// rewrite them after the fact (set/replace/remove a photo, reorder or remove a
// member card). Parsing mirrors injectTeamPhotos exactly — a photo line only
// counts when it sits directly under the heading. All functions are pure and
// never throw; a member is addressed by (blockIndex, memberIndex) position, not
// by name, so duplicate names edit independently.

export type TeamMemberRef = {
  /** Stable identity for React keys. */
  key: string
  /** Full heading text after `### ` (name + any credentials). */
  name: string
  /** Current `photo:` filename, or null when none is set. */
  photo: string | null
  /** Which team-grid block on the page (0-based among team-grid blocks). */
  blockIndex: number
  /** Which `### ` heading within that block (0-based) — the rewrite target. */
  memberIndex: number
}

const HEADING_RE = /^### (.+)$/
// A photo line only when it's the line immediately below the heading. Capture
// the value loosely so an empty `photo:` line is still recognized (and thus
// replaceable/removable), matching injectTeamPhotos' `photo:[^\n]*`.
const PHOTO_LINE_RE = /^photo:\s*(.*)$/
const TEAM_GRID_RE = /^<!-- block: team-grid\b/

// Split on block-annotation boundaries, preserving each delimiter at the start
// of its chunk. Joining with '' reconstructs the body verbatim. Same split
// injectTeamPhotos uses.
function splitBlocks(body: string): string[] {
  return body.split(/(?=<!-- block:)/g)
}

type ParsedMember = {
  name: string
  photo: string | null
  headingLine: number
  photoLine: number | null
  /** Card span within the chunk's lines: [startLine, endLine). */
  startLine: number
  endLine: number
}

// Parse the member cards out of a single team-grid chunk's lines. A card spans
// from its `### ` heading to just before the next heading (or chunk end), so
// trailing blank separators travel with the card during move/remove.
function parseMembers(lines: string[]): ParsedMember[] {
  const headings: number[] = []
  lines.forEach((line, i) => {
    if (HEADING_RE.test(line)) headings.push(i)
  })
  return headings.map((h, idx) => {
    const endLine = idx + 1 < headings.length ? headings[idx + 1] : lines.length
    const name = lines[h].match(HEADING_RE)![1].trim()
    let photo: string | null = null
    let photoLine: number | null = null
    if (h + 1 < endLine) {
      const m = lines[h + 1].match(PHOTO_LINE_RE)
      if (m) {
        photoLine = h + 1
        const value = m[1].trim()
        photo = value.length > 0 ? value : null
      }
    }
    return { name, photo, headingLine: h, photoLine, startLine: h, endLine }
  })
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Every team member across every team-grid block on the page. */
export function extractTeamMembers(body: string): TeamMemberRef[] {
  const refs: TeamMemberRef[] = []
  let blockIndex = -1
  for (const part of splitBlocks(body)) {
    if (!TEAM_GRID_RE.test(part)) continue
    blockIndex++
    const members = parseMembers(part.split('\n'))
    members.forEach((m, memberIndex) => {
      refs.push({
        key: `team:${blockIndex}:${memberIndex}:${slug(m.name)}`,
        name: m.name,
        photo: m.photo,
        blockIndex,
        memberIndex,
      })
    })
  }
  return refs
}

// Run `fn` against the single team-grid chunk identified by blockIndex, leaving
// every other chunk (and the body's join structure) untouched.
function rewriteBlock(
  body: string,
  targetBlockIndex: number,
  fn: (lines: string[], members: ParsedMember[]) => string[] | null
): string {
  let blockIndex = -1
  return splitBlocks(body)
    .map((part) => {
      if (!TEAM_GRID_RE.test(part)) return part
      blockIndex++
      if (blockIndex !== targetBlockIndex) return part
      const lines = part.split('\n')
      const next = fn(lines, parseMembers(lines))
      return next === null ? part : next.join('\n')
    })
    .join('')
}

/**
 * Insert, replace, or remove (`filename === null`) the `photo:` line under the
 * ref'd member's heading. Idempotent; only touches the targeted member.
 */
export function setTeamMemberPhoto(
  body: string,
  ref: TeamMemberRef,
  filename: string | null
): string {
  return rewriteBlock(body, ref.blockIndex, (lines, members) => {
    const m = members[ref.memberIndex]
    if (!m) return null
    const next = [...lines]
    if (filename) {
      const photoLine = `photo: ${filename}`
      if (m.photoLine !== null) next[m.photoLine] = photoLine
      else next.splice(m.headingLine + 1, 0, photoLine)
    } else if (m.photoLine !== null) {
      next.splice(m.photoLine, 1)
    }
    return next
  })
}

/**
 * Swap the ref'd member card with its neighbor within the same team-grid block.
 * No-op at the block's first/last member. The whole card span (heading + photo +
 * bio + trailing blanks) moves together.
 */
export function moveTeamMember(
  body: string,
  ref: TeamMemberRef,
  dir: 'up' | 'down'
): string {
  return rewriteBlock(body, ref.blockIndex, (lines, members) => {
    const i = ref.memberIndex
    const j = dir === 'up' ? i - 1 : i + 1
    if (!members[i] || !members[j]) return null
    const a = members[Math.min(i, j)]
    const b = members[Math.max(i, j)]
    // Adjacent cards share a boundary (a.endLine === b.startLine), so there's
    // nothing between the two spans to preserve.
    return [
      ...lines.slice(0, a.startLine),
      ...lines.slice(b.startLine, b.endLine),
      ...lines.slice(a.startLine, a.endLine),
      ...lines.slice(b.endLine),
    ]
  })
}

/**
 * Delete the ref'd member card entirely (heading + photo + bio). Never removes
 * the block annotation or the block's `## …` heading, even when the last member
 * is removed.
 */
export function removeTeamMember(body: string, ref: TeamMemberRef): string {
  return rewriteBlock(body, ref.blockIndex, (lines, members) => {
    const m = members[ref.memberIndex]
    if (!m) return null
    const next = [...lines]
    next.splice(m.startLine, m.endLine - m.startLine)
    return next
  })
}
