// Pure. Read-only survey of the block annotations in client page files, for
// scripts/scan-block-annotations.ts: unknown ids, inline page openers, invalid
// variants/themes, mangled or stray (heading-less) annotations, themes in use
// and the page-opener (hero, hero_variant) pairs. Informs layout decisions
// before anything changes the grammar or the variant set.

import { annotationSyntaxIssues, type AnnotationIssueKind } from './block-annotation-validator'
import { parseBlockComment } from '@/lib/editor/block-annotation'
import { splitFile } from '@/lib/editor/frontmatter'

export type PageScan = {
  path: string
  issues: { kind: AnnotationIssueKind; blockId: string; value?: string }[]
  /** Every parsed annotation's `blockId|theme` (themes in use, valid or not). */
  themes: string[]
  /** `hero|hero_variant` as the template reads it (hero defaults to page-header). */
  heroPair: string
}

const ANNOTATION_LINE_RE = /^<!--\s*block:[^\n]*$/gm
const bare = (raw: string | undefined) => raw?.trim().replace(/^(["'])(.*)\1$/, '$2') || undefined

export function scanPageFile(path: string, text: string): PageScan {
  const { frontmatter, body } = splitFile(text)
  const f = frontmatter?.fields ?? {}
  const hero = bare(f.hero) ?? bare(f.hero_block) ?? 'page-header'
  const themes: string[] = []
  for (const m of body.matchAll(ANNOTATION_LINE_RE)) {
    const c = parseBlockComment(m[0].replace(/\r$/, ''))
    if (c?.theme) themes.push(`${c.blockId}|${c.theme}`)
  }
  return {
    path,
    issues: annotationSyntaxIssues(body).map(({ kind, blockId, value }) => ({ kind, blockId, ...(value !== undefined ? { value } : {}) })),
    themes,
    heroPair: `${hero}|${bare(f.hero_variant) ?? ''}`,
  }
}

export type RepoScanSummary = {
  pages: number
  /** kind → `blockId|value` → count */
  issues: Partial<Record<AnnotationIssueKind, Record<string, number>>>
  themes: Record<string, number>
  heroPairs: Record<string, number>
  /** Pages carrying any issue, with their issue count. */
  pagesWithIssues: Record<string, number>
}

const bump = (rec: Record<string, number>, key: string) => {
  rec[key] = (rec[key] ?? 0) + 1
}

export function summarizeScans(scans: PageScan[]): RepoScanSummary {
  const out: RepoScanSummary = { pages: scans.length, issues: {}, themes: {}, heroPairs: {}, pagesWithIssues: {} }
  for (const s of scans) {
    for (const i of s.issues) bump((out.issues[i.kind] ??= {}), i.value !== undefined ? `${i.blockId}|${i.value}` : i.blockId)
    for (const t of s.themes) bump(out.themes, t)
    bump(out.heroPairs, s.heroPair)
    if (s.issues.length) out.pagesWithIssues[s.path] = s.issues.length
  }
  return out
}
