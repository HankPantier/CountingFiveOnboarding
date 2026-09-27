// Client-safe helpers for the "Regenerate design.md" review (VersionsPanel).
// No node imports — the server side lives in design-md-adopt.ts.

export type DiffLine = { op: 'same' | 'add' | 'del'; text: string }
export type DesignMdState = 'absent' | 'hand-written' | 'legacy' | 'edited' | 'untouched'

export type DesignMdPreviewDto = {
  path: string
  state: DesignMdState
  currentSha: string | null
  unchanged: boolean
  nextHash: string
  next: string
  diff: DiffLine[]
  added: number
  removed: number
}

// What the admin is told about the file the generated one would replace.
export const DESIGN_MD_STATE_COPY: Record<DesignMdState, string> = {
  absent: 'This site has no design.md yet. Regenerating creates one from the current theme.',
  'hand-written':
    'This design.md was not written by the platform (or was reshaped by hand), so Studio commits never touch it. Regenerating REPLACES it — any hand-written notes below are lost.',
  legacy:
    'This design.md was generated before edit detection existed, so Studio commits treat it as hand-written and leave it stale. Regenerating adopts the current generated file; from then on Studio commits keep it up to date.',
  edited:
    'This design.md was generated, then edited by hand, so Studio commits leave it alone. Regenerating REPLACES the hand edits below.',
  untouched: 'This design.md is the platform’s own and Studio commits already keep it up to date.',
}

export type DiffRow = DiffLine | { op: 'gap'; skipped: number }

/**
 * The diff with unchanged runs collapsed to `context` lines around each change
 * (a gap row stands for the rest). Capped at `maxRows` rows.
 */
export function diffHunks(diff: DiffLine[], context = 2, maxRows = 400): { rows: DiffRow[]; truncated: boolean } {
  const keep = new Array<boolean>(diff.length).fill(false)
  diff.forEach((d, i) => {
    if (d.op === 'same') return
    for (let k = Math.max(0, i - context); k <= Math.min(diff.length - 1, i + context); k++) keep[k] = true
  })
  const rows: DiffRow[] = []
  let skipped = 0
  for (let i = 0; i < diff.length; i++) {
    if (!keep[i]) {
      skipped++
      continue
    }
    if (skipped > 0) {
      rows.push({ op: 'gap', skipped })
      skipped = 0
    }
    rows.push(diff[i])
  }
  if (skipped > 0 && rows.length > 0) rows.push({ op: 'gap', skipped })
  return rows.length > maxRows ? { rows: rows.slice(0, maxRows), truncated: true } : { rows, truncated: false }
}
