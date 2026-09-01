// Pure aggregation of git commit history into per-page/resource edit stats.
// Dependency-free (no git/DB) so it's unit-testable and safe to import anywhere.
// Fed by walkCommitFileStats (lib/github/repo-files.ts) and enriched with AI
// token spend (from token_usage) in the edit-stats API route.

export type EditStatRow = {
  // content/pages/*.md or content/posts/*.md
  path: string
  editCount: number
  aiCount: number
  manualCount: number
  // Churn: additions/deletions summed across every edit to this file.
  additions: number
  deletions: number
  lastAuthorName: string | null
  lastEditAt: string | null
  // Enriched from token_usage (AI edits only); absent from the pure aggregate.
  aiTokens?: number
  aiCostUsd?: number
  // Display helpers filled by the route.
  url?: string | null
  title?: string | null
}

// Keyed by file path. This is what the content_edit_stats cache stores.
export type EditStatsAggregate = Record<string, EditStatRow>

// Shape returned by GET /api/edit/[id]/edit-stats and consumed by the panel.
export type EditStatsResponse = { rows: EditStatRow[]; truncated: boolean }

export type EditCommit = {
  message: string
  authorName: string
  date: string | null
  parentCount: number
  files: { path: string; additions: number; deletions: number }[]
}

// Only page/resource markdown counts as an editable "page".
function isContentFile(path: string): boolean {
  return /^content\/(pages|posts)\/.+\.md$/.test(path)
}

// Deploy/publish/merge commits touch every file at once — they're bulk site
// operations, not per-page edits, and counting them would inflate every page
// equally. A merge has ≥2 parents; deploy/publish carry known message prefixes.
const BULK_MESSAGE_RE = /^(Deploy packaged content|Publish draft to live)/i
function isBulkCommit(c: { message: string; parentCount: number }): boolean {
  return c.parentCount >= 2 || BULK_MESSAGE_RE.test(c.message.trim())
}

// The editor's write paths stamp AI-assisted commits with "via AI" and manual
// edits with "via admin" (see app/api/edit/[id]/chat vs /files).
function isAiCommit(message: string): boolean {
  return /\bvia AI\b/i.test(message)
}

// Fold commits into per-file stats. Order-independent: last-edit attribution is
// resolved by comparing commit dates, so callers may pass any order. Bulk/merge
// commits and non-content files are skipped.
export function aggregateEditStats(commits: EditCommit[]): EditStatsAggregate {
  const agg: EditStatsAggregate = {}

  for (const c of commits) {
    if (isBulkCommit(c)) continue
    const ai = isAiCommit(c.message)
    for (const f of c.files) {
      if (!isContentFile(f.path)) continue
      let row = agg[f.path]
      if (!row) {
        row = {
          path: f.path,
          editCount: 0,
          aiCount: 0,
          manualCount: 0,
          additions: 0,
          deletions: 0,
          lastAuthorName: null,
          lastEditAt: null,
        }
        agg[f.path] = row
      }
      row.editCount += 1
      if (ai) row.aiCount += 1
      else row.manualCount += 1
      row.additions += f.additions
      row.deletions += f.deletions
      if (c.date && (!row.lastEditAt || c.date > row.lastEditAt)) {
        row.lastEditAt = c.date
        row.lastAuthorName = c.authorName || null
      }
    }
  }

  return agg
}
