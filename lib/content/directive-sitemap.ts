import type { OperatorDirective, SessionSchema } from '@/types/session-schema'
import { crawledPages, isResolved, normPath } from '@/lib/onboarding/directives'

type ProposedSitemap = NonNullable<SessionSchema['proposed_sitemap']>
type CurrentSitemap = NonNullable<SessionSchema['current_sitemap']>

const parentPath = (path: string): string => {
  const segs = path.split('/').filter(Boolean)
  return segs.length > 1 ? `/${segs.slice(0, -1).join('/')}` : '/'
}

// Applies the resolved bring/merge/drop page directives to current_sitemap and
// proposed_sitemap. Pure and deterministic, and a full recompute of every field
// it owns (current_sitemap.directiveId + the action/new_url it set, and
// proposed_sitemap directiveId/mode/mergeFrom), so re-running it with the same
// directives is a no-op and removing a directive reverts its effect. Runs on
// Audit Review submit and after every sitemap (re)proposal, so the AI proposer
// can never silently undo an operator instruction.
export function applyDirectivesToSitemap(schema: SessionSchema): SessionSchema {
  const directives = (Array.isArray(schema.operator_directives) ? schema.operator_directives : []).filter(isResolved)
  const titleOf = new Map(crawledPages(schema).map((p) => [normPath(p.url), p.title]))

  const current: CurrentSitemap = (Array.isArray(schema.current_sitemap) ? schema.current_sitemap : []).map((r) => {
    if (!r?.directiveId) return { ...r }
    const { directiveId: _d, new_url: _n, ...rest } = r
    void _d
    void _n
    return { ...rest, action: 'keep' as const }
  })
  let proposed: ProposedSitemap = (Array.isArray(schema.proposed_sitemap) ? schema.proposed_sitemap : []).map((p) => {
    const { directiveId: _d, mode: _m, mergeFrom: _f, ...rest } = p
    void _d
    void _m
    void _f
    return rest
  })
  // Pages a prior merge/drop removed from proposed_sitemap come back when that
  // directive is gone (their current row was just reverted to 'keep' above).
  const revertedKeys = new Set(
    (schema.current_sitemap ?? []).filter((r) => r?.directiveId).map((r) => normPath(r.url)),
  )

  const findCurrent = (url: string) => current.find((r) => normPath(r.url) === normPath(url))
  const findProposedIdx = (url: string) => proposed.findIndex((p) => normPath(p.url) === normPath(url))
  const ensureProposed = (url: string): ProposedSitemap[number] => {
    const i = findProposedIdx(url)
    if (i >= 0) return proposed[i]
    const page: ProposedSitemap[number] = { url, title: titleOf.get(normPath(url)) ?? url, status: 'update', parent: parentPath(url) }
    proposed.push(page)
    return page
  }

  const removed = new Set<string>()
  for (const d of directives) {
    if ((d.kind === 'merge_page' || d.kind === 'drop_page') && d.sourceUrl) removed.add(normPath(d.sourceUrl))
  }
  for (const key of revertedKeys) {
    if (removed.has(key)) continue
    const row = current.find((r) => normPath(r.url) === key)
    if (row?.live && findProposedIdx(row.url) < 0) ensureProposed(row.url)
  }

  for (const d of directives) applyOne(d)

  function applyOne(d: OperatorDirective) {
    if (!d.sourceUrl) return
    if (d.kind === 'bring_page') {
      if (removed.has(normPath(d.sourceUrl))) return
      const page = ensureProposed(d.sourceUrl)
      page.directiveId = d.id
      if (d.verbatim) page.mode = 'verbatim'
      return
    }
    if (d.kind === 'merge_page' && d.targetUrl) {
      const row = findCurrent(d.sourceUrl)
      if (row) Object.assign(row, { action: 'consolidate' as const, new_url: d.targetUrl, directiveId: d.id })
      proposed = proposed.filter((p) => normPath(p.url) !== normPath(d.sourceUrl!))
      const target = ensureProposed(d.targetUrl)
      const from = target.mergeFrom ?? []
      if (!from.some((u) => normPath(u) === normPath(d.sourceUrl!))) target.mergeFrom = [...from, d.sourceUrl]
      return
    }
    if (d.kind === 'drop_page') {
      const row = findCurrent(d.sourceUrl)
      if (row) Object.assign(row, { action: 'redirect' as const, new_url: parentPath(d.sourceUrl), directiveId: d.id })
      proposed = proposed.filter((p) => normPath(p.url) !== normPath(d.sourceUrl!))
    }
  }

  return { ...schema, current_sitemap: current, proposed_sitemap: proposed }
}
