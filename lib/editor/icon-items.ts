// Extracts the icon-bearing items on a page (feature-grid / industry-cards
// sections) so the editor can show a picker per item, and rewrites a chosen
// icon back into the markdown. Two content syntaxes are handled, mirroring
// the template's parseIconTitleDescriptionList:
//   1. icon bullets:  - IconName: **Title** — Description
//   2. ### Title chunks with an optional `icon: Name` first line
// Line-index based so rewrites are exact, not regex-replace guesses.

const ICON_BLOCKS = new Set(['feature-grid', 'industry-cards'])

const ANNOTATION_RE = /^<!--\s*block:\s*([a-z0-9][a-z0-9-]*)/
const BULLET_RE = /^(\s*[-*]\s+)(?:([A-Za-z][A-Za-z0-9]*):\s+)?\*\*(.+?)\*\*\s*(?:—|–|--)/
const HEADING_RE = /^###\s+(.+?)\s*$/
const BOLD_LINE_RE = /^\*\*([^*\n][^*\n]*[^*\n\s])\*\*\s*$/
const ICON_LINE_RE = /^icon:\s*([A-Za-z][A-Za-z0-9]*)\s*$/

export type IconItemRef =
  | {
      kind: 'bullet'
      blockId: string
      title: string
      /** Explicit icon name, or null when the bullet has no icon prefix (renders CheckCircle). */
      icon: string | null
      lineIndex: number
    }
  | {
      kind: 'chunk'
      blockId: string
      title: string
      icon: string | null
      headingLineIndex: number
      /** Set when an `icon:` line already exists for this chunk. */
      iconLineIndex: number | null
    }

export function extractIconItems(body: string): IconItemRef[] {
  const lines = body.split('\n')
  const items: IconItemRef[] = []
  let currentBlock: string | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const annotation = line.match(ANNOTATION_RE)
    if (annotation) {
      currentBlock = annotation[1]
      continue
    }
    if (!currentBlock || !ICON_BLOCKS.has(currentBlock)) continue

    const bullet = line.match(BULLET_RE)
    if (bullet) {
      items.push({
        kind: 'bullet',
        blockId: currentBlock,
        title: bullet[3].trim(),
        icon: bullet[2] ?? null,
        lineIndex: i,
      })
      continue
    }

    const heading = line.match(HEADING_RE) ?? line.match(BOLD_LINE_RE)
    if (heading) {
      // First non-empty line after the heading may be an icon: line.
      let iconLineIndex: number | null = null
      let icon: string | null = null
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === '') continue
        const iconMatch = lines[j].match(ICON_LINE_RE)
        if (iconMatch) {
          iconLineIndex = j
          icon = iconMatch[1]
        }
        break
      }
      items.push({
        kind: 'chunk',
        blockId: currentBlock,
        title: heading[1].trim(),
        icon,
        headingLineIndex: i,
        iconLineIndex,
      })
    }
  }

  return items
}

// Write `newIcon` into the markdown for the given item. Refs must come from
// extractIconItems on the SAME body string — the editor recomputes refs after
// every change, so sequential picks stay consistent.
export function setItemIcon(body: string, ref: IconItemRef, newIcon: string): string {
  const lines = body.split('\n')

  if (ref.kind === 'bullet') {
    const line = lines[ref.lineIndex]
    const m = line.match(BULLET_RE)
    if (!m) return body // body drifted from ref — refuse rather than corrupt
    const prefix = m[1]
    const rest = line.slice(prefix.length + (m[2] ? `${m[2]}: `.length : 0))
    lines[ref.lineIndex] = `${prefix}${newIcon}: ${rest}`
    return lines.join('\n')
  }

  if (ref.iconLineIndex !== null) {
    if (!ICON_LINE_RE.test(lines[ref.iconLineIndex])) return body
    lines[ref.iconLineIndex] = `icon: ${newIcon}`
    return lines.join('\n')
  }
  lines.splice(ref.headingLineIndex + 1, 0, `icon: ${newIcon}`)
  return lines.join('\n')
}
