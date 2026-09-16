import type { SessionSchema } from '@/types/session-schema'
import type {
  MbpDocument,
  MbpDocumentField,
  MbpDocumentItem,
  MbpDocumentSection,
} from '@/types/mbp'
import { OBJECT_SECTION_TEMPLATES } from '@/lib/mbp/section-templates'

// Builds a complete, human-readable projection of the MBP (schema_data) for
// the admin/manager MBP page and export. Unlike serializeSchema (which trims
// for the onboarding token budget) this covers EVERY field, including the
// sections SchemaViewer omits today: reputation, content_gaps, sitemaps, and
// the deep niche/team/service subfields. Empty fields are KEPT and flagged so
// the completeness panel can surface them.

// Clearer labels than humanize() would produce for a few fields where the raw
// key name doesn't read well in the Review UI / export.
const LABEL_OVERRIDES: Record<string, string> = {
  contentEmphasis: 'Content to emphasize',
  contentExclusions: 'Content to exclude',
  generalDirection: 'General direction',
  preferredPhrases: 'Use these phrases',
  avoidPhrases: 'Do not use these phrases',
}

function humanize(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .replace(/^./, s => s.toUpperCase())
    .trim()
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return true
  if (Array.isArray(v)) return v.length === 0 || v.every(isEmpty)
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).every(isEmpty)
  return false
}

// Render a leaf value for display. Arrays of primitives join; nested
// objects/arrays render as compact JSON. Exported so the read-only view and
// the markdown export format values identically. (Fields carry the RAW value
// so the inline editor can edit structured values; display happens here.)
export function formatFieldValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  if (Array.isArray(v) && v.every(x => typeof x === 'string' || typeof x === 'number')) {
    return v.join(', ')
  }
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

type ProvenanceMap = Record<string, 'audit' | 'notes' | 'confirmed' | 'thin'>

function fieldsFromObject(
  obj: Record<string, unknown> | undefined,
  basePath: string,
  provenance?: ProvenanceMap
): MbpDocumentField[] {
  if (!obj) return []
  return Object.entries(obj).map(([key, value]) => {
    const fieldPath = `${basePath}.${key}`
    return {
      label: LABEL_OVERRIDES[key] ?? humanize(key),
      fieldPath,
      value,
      empty: isEmpty(value),
      ...(provenance?.[fieldPath] ? { provenance: provenance[fieldPath] } : {}),
    }
  })
}

// The content-scope directives are optional and often absent from the raw
// schema, but the Review UI needs them ALWAYS editable — so an operator can add
// "don't cover real estate" even when the call notes never mentioned scope.
// Defaulting to [] (a primitive array) makes MbpEditableField edit them as a
// comma list that saves back as an array. Existing values are preserved.
function withContentScopeDefaults(
  business: Record<string, unknown> | undefined
): Record<string, unknown> {
  const out = { ...(business ?? {}) }
  if (!('contentEmphasis' in out)) out.contentEmphasis = []
  if (!('contentExclusions' in out)) out.contentExclusions = []
  return out
}

function objectSection(
  key: string,
  title: string,
  data: Record<string, unknown> | undefined,
  provenance?: ProvenanceMap
): MbpDocumentSection {
  return { key, title, fields: fieldsFromObject(data, key, provenance) }
}

function arraySection<T extends Record<string, unknown>>(
  key: string,
  title: string,
  rows: T[] | undefined,
  heading: (row: T, i: number) => string,
  provenance?: ProvenanceMap
): MbpDocumentSection {
  const items: MbpDocumentItem[] = (rows ?? []).map((row, i) => ({
    heading: heading(row, i) || `${title} ${i + 1}`,
    fields: fieldsFromObject(row, `${key}.${i}`, provenance),
  }))
  return { key, title, items }
}

// The live site structure comes from the content job's confirmed_sitemap (what
// the generated content was actually built from) — NOT schema.current_sitemap /
// proposed_sitemap, which are stale onboarding-audit artifacts.
type SitemapEntry = NonNullable<SessionSchema['proposed_sitemap']>[number]

// When `scaffold` is on (the admin MBP page only), merge the section's canonical
// template UNDER the real data so every known field renders as an editable blank
// even when schema_data omits it. Off everywhere else (export, completeness,
// enrichment, backfill) so those paths keep seeing only real data.
function withSectionDefaults(
  key: string,
  data: Record<string, unknown> | undefined,
  scaffold: boolean
): Record<string, unknown> | undefined {
  const template = OBJECT_SECTION_TEMPLATES[key]
  if (!scaffold || !template) return data
  return { ...template, ...(data ?? {}) }
}

export function buildMbpDocument(
  schema: SessionSchema,
  confirmedSitemap?: SitemapEntry[] | null,
  options: { scaffold?: boolean } = {}
): MbpDocument {
  const scaffold = options.scaffold ?? false
  // Read-back of the Phase-3 industry review: annotate the section title with a
  // kept/dropped count so the operator can see the decision at a glance.
  const droppedNicheCount = (schema.niches ?? []).filter(n => n.status === 'dropped').length
  const nicheTitle =
    droppedNicheCount > 0
      ? `Niches (${(schema.niches ?? []).length - droppedNicheCount} kept · ${droppedNicheCount} dropped)`
      : 'Niches'

  const prov = schema._meta?.field_provenance as ProvenanceMap | undefined

  // business keeps its content-scope defaults in every mode; scaffolding adds
  // the remaining known fields on top when enabled.
  const obj = (key: string, title: string, data: Record<string, unknown> | undefined) =>
    objectSection(key, title, withSectionDefaults(key, data, scaffold), prov)

  const sections: MbpDocumentSection[] = [
    obj('contact', 'Contact', schema.contact as Record<string, unknown> | undefined),
    obj('business', 'Business', withContentScopeDefaults(schema.business as Record<string, unknown> | undefined)),
    obj('brand', 'Brand & Tone', schema.brand as Record<string, unknown> | undefined),
    obj('content_direction', 'Content Direction', schema.content_direction as Record<string, unknown> | undefined),
    obj('culture', 'Culture', schema.culture as Record<string, unknown> | undefined),
    obj('technical', 'Technical', schema.technical as Record<string, unknown> | undefined),
    arraySection('locations', 'Locations', schema.locations, l => l.name || l.city || '', prov),
    arraySection('team', 'Team', schema.team, t => t.name || '', prov),
    arraySection('services', 'Services', schema.services, s => s.name || '', prov),
    arraySection('niches', nicheTitle, schema.niches, n => (n.status === 'dropped' ? `${n.name || ''} (DROPPED)` : n.name || ''), prov),
    arraySection('clientPortals', 'Client Portals', schema.clientPortals, p => p.label || p.url || '', prov),
    obj('reputation', 'Reputation', schema.reputation as Record<string, unknown> | undefined),
    obj('content_gaps', 'Content Gaps', schema.content_gaps as Record<string, unknown> | undefined),
    obj('assets', 'Assets', schema.assets as Record<string, unknown> | undefined),
    obj('additional', 'Additional', schema.additional as Record<string, unknown> | undefined),
  ]
  if (confirmedSitemap && confirmedSitemap.length > 0) {
    sections.push(arraySection('site_map', 'Site Map', confirmedSitemap, p => p.title || p.url || ''))
  }
  return { sections }
}

// Flat markdown rendering for export / repo records.
export function mbpDocumentToMarkdown(doc: MbpDocument): string {
  const lines: string[] = ['# Master Business Profile', '']
  for (const section of doc.sections) {
    lines.push(`## ${section.title}`, '')
    if (section.fields) {
      for (const f of section.fields) {
        lines.push(`- **${f.label}:** ${f.empty ? '_(empty)_' : formatFieldValue(f.value)}`)
      }
      lines.push('')
    }
    if (section.items) {
      if (section.items.length === 0) lines.push('_(none)_', '')
      for (const item of section.items) {
        lines.push(`### ${item.heading}`)
        for (const f of item.fields) {
          lines.push(`- **${f.label}:** ${f.empty ? '_(empty)_' : formatFieldValue(f.value)}`)
        }
        lines.push('')
      }
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}
