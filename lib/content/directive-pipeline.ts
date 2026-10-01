import type { SessionSchema } from '@/types/session-schema'
import { isResolved, needsSnapshot, normPath } from '@/lib/onboarding/directives'
import { slugify } from './sitemap-utils'

export interface PagePipelineTreatment {
  generation_mode: 'generate' | 'verbatim'
  source_snapshot_path: string | null
  merge_source_urls: string[]
}

// What the operator directives say about one confirmed sitemap page, derived
// from the session's stored directives (never from the client-posted sitemap,
// which the sitemap editor could strip). A resolved verbatim bring_page makes the
// page 'verbatim'; a "keep all links" one stays 'generate' but carries its
// snapshot, whose links are appended to the written page if the writer dropped
// any (appendMissingSourceLinks). Resolved merge_page directives targeting the
// page list the pages whose content it absorbs.
export function pipelineTreatmentFor(schema: SessionSchema, pageUrl: string): PagePipelineTreatment {
  const key = normPath(pageUrl)
  const directives = (Array.isArray(schema.operator_directives) ? schema.operator_directives : []).filter(isResolved)
  const source = directives.find(
    (d) => d.kind === 'bring_page' && needsSnapshot(d) && d.snapshot && d.sourceUrl && normPath(d.sourceUrl) === key,
  )
  const merges = directives
    .filter((d) => d.kind === 'merge_page' && d.targetUrl && d.sourceUrl && normPath(d.targetUrl) === key)
    .map((d) => d.sourceUrl as string)
  return {
    generation_mode: source?.verbatim ? 'verbatim' : 'generate',
    source_snapshot_path: source?.snapshot?.path ?? null,
    merge_source_urls: [...new Set(merges)],
  }
}

// The directive that drives a page, for sitemap/outline badges.
export interface PageDirectiveBadge {
  kind: 'verbatim' | 'merged' | 'brought' | 'added'
  label: string
  sourceText: string
}

export function directiveBadgesFor(schema: SessionSchema, pageUrl: string): PageDirectiveBadge[] {
  const key = normPath(pageUrl)
  const badges: PageDirectiveBadge[] = []
  for (const d of (Array.isArray(schema.operator_directives) ? schema.operator_directives : []).filter(isResolved)) {
    if (d.kind === 'bring_page' && d.sourceUrl && normPath(d.sourceUrl) === key) {
      badges.push(
        d.verbatim
          ? { kind: 'verbatim', label: d.keepLinks ? 'Verbatim · all links' : 'Verbatim', sourceText: d.sourceText }
          : { kind: 'brought', label: 'Kept by instruction', sourceText: d.sourceText },
      )
    } else if (d.kind === 'merge_page' && d.targetUrl && normPath(d.targetUrl) === key && d.sourceUrl) {
      badges.push({ kind: 'merged', label: `Merged from ${d.sourceUrl}`, sourceText: d.sourceText })
    } else if (d.kind === 'add_offering' && d.offering) {
      const slug = slugify(d.offering.name)
      const hub = d.offering.type === 'service' ? '/services' : '/industries'
      if (d.offering.treatment === 'page' && key === `${hub}/${slug}`) {
        badges.push({ kind: 'added', label: 'Added by instruction', sourceText: d.sourceText })
      }
    }
  }
  return badges
}
