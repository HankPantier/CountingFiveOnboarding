import type { SessionSchema } from '@/types/session-schema'
import type {
  MbpDocument,
  MbpDocumentField,
  MbpDocumentItem,
  MbpDocumentSection,
} from '@/types/mbp'

// Builds a complete, human-readable projection of the MBP (schema_data) for
// the admin/manager MBP page and export. Unlike serializeSchema (which trims
// for the onboarding token budget) this covers EVERY field, including the
// sections SchemaViewer omits today: reputation, content_gaps, sitemaps, and
// the deep niche/team/service subfields. Empty fields are KEPT and flagged so
// the completeness panel can surface them.

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
// objects/arrays render as compact JSON (the field editor / chat handle
// structured edits — this view is for reading).
function displayValue(v: unknown): unknown {
  if (Array.isArray(v) && v.every(x => typeof x === 'string' || typeof x === 'number')) {
    return v.join(', ')
  }
  if (v !== null && typeof v === 'object') return JSON.stringify(v)
  return v
}

function fieldsFromObject(
  obj: Record<string, unknown> | undefined,
  basePath: string
): MbpDocumentField[] {
  if (!obj) return []
  return Object.entries(obj).map(([key, value]) => ({
    label: humanize(key),
    fieldPath: `${basePath}.${key}`,
    value: displayValue(value),
    empty: isEmpty(value),
  }))
}

function objectSection(
  key: string,
  title: string,
  data: Record<string, unknown> | undefined
): MbpDocumentSection {
  return { key, title, fields: fieldsFromObject(data, key) }
}

function arraySection<T extends Record<string, unknown>>(
  key: string,
  title: string,
  rows: T[] | undefined,
  heading: (row: T, i: number) => string
): MbpDocumentSection {
  const items: MbpDocumentItem[] = (rows ?? []).map((row, i) => ({
    heading: heading(row, i) || `${title} ${i + 1}`,
    fields: fieldsFromObject(row, `${key}.${i}`),
  }))
  return { key, title, items }
}

export function buildMbpDocument(schema: SessionSchema): MbpDocument {
  const sections: MbpDocumentSection[] = [
    objectSection('contact', 'Contact', schema.contact as Record<string, unknown> | undefined),
    objectSection('business', 'Business', schema.business as Record<string, unknown> | undefined),
    objectSection('brand', 'Brand & Tone', schema.brand as Record<string, unknown> | undefined),
    objectSection('culture', 'Culture', schema.culture as Record<string, unknown> | undefined),
    objectSection('technical', 'Technical', schema.technical as Record<string, unknown> | undefined),
    arraySection('locations', 'Locations', schema.locations, l => l.name || l.city || ''),
    arraySection('team', 'Team', schema.team, t => t.name || ''),
    arraySection('services', 'Services', schema.services, s => s.name || ''),
    arraySection('niches', 'Niches', schema.niches, n => n.name || ''),
    objectSection('reputation', 'Reputation', schema.reputation as Record<string, unknown> | undefined),
    objectSection('content_gaps', 'Content Gaps', schema.content_gaps as Record<string, unknown> | undefined),
    objectSection('assets', 'Assets', schema.assets as Record<string, unknown> | undefined),
    objectSection('additional', 'Additional', schema.additional as Record<string, unknown> | undefined),
    arraySection('current_sitemap', 'Current Sitemap', schema.current_sitemap, p => p.title || p.url || ''),
    arraySection('proposed_sitemap', 'Proposed Sitemap', schema.proposed_sitemap, p => p.title || p.url || ''),
  ]
  return { sections }
}

// Flat markdown rendering for export / repo records.
export function mbpDocumentToMarkdown(doc: MbpDocument): string {
  const lines: string[] = ['# Master Business Profile', '']
  for (const section of doc.sections) {
    lines.push(`## ${section.title}`, '')
    if (section.fields) {
      for (const f of section.fields) {
        lines.push(`- **${f.label}:** ${f.empty ? '_(empty)_' : String(f.value)}`)
      }
      lines.push('')
    }
    if (section.items) {
      if (section.items.length === 0) lines.push('_(none)_', '')
      for (const item of section.items) {
        lines.push(`### ${item.heading}`)
        for (const f of item.fields) {
          lines.push(`- **${f.label}:** ${f.empty ? '_(empty)_' : String(f.value)}`)
        }
        lines.push('')
      }
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}
