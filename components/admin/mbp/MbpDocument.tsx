import { formatFieldValue } from '@/lib/mbp/build-document'
import MbpEditableField from '@/components/admin/mbp/MbpEditableField'
import type { MbpDocument, MbpDocumentField, MbpDocumentItem } from '@/types/mbp'

// Sitemap sections are uniformly tabular and otherwise render as tall
// label/value stacks — show them as a compact one-row-per-page table instead.
const SITEMAP_KEYS = new Set(['site_map'])
const COL_ORDER = ['Title', 'Url', 'Action', 'Status', 'New Url', 'Live', 'Parent', 'Notes']

function FieldRow({
  field,
  overridden,
  sessionId,
  editable,
}: {
  field: MbpDocumentField
  overridden: boolean
  sessionId: string
  editable: boolean
}) {
  const display = formatFieldValue(field.value)
  return (
    <div className="flex items-start gap-3 py-1.5 border-b border-border-default last:border-0">
      <span className="text-text-secondary text-xs font-body w-40 flex-shrink-0 pt-0.5">
        {field.label}
        {overridden && <span className="ml-1 text-brand-cyan" title="Admin override">●</span>}
      </span>
      <div className="flex-1 min-w-0">
        {editable ? (
          <MbpEditableField sessionId={sessionId} fieldPath={field.fieldPath} value={field.value} />
        ) : display ? (
          <span className="text-sm font-body text-text-primary break-words">{display}</span>
        ) : (
          <span className="text-sm font-body text-text-muted italic">—</span>
        )}
      </div>
    </div>
  )
}

function SitemapTable({ items }: { items: MbpDocumentItem[] }) {
  if (items.length === 0) {
    return <p className="text-text-muted font-body text-sm italic py-2">None.</p>
  }
  const seen: string[] = []
  for (const it of items) for (const f of it.fields) if (!seen.includes(f.label)) seen.push(f.label)
  const cols = [...seen].sort((a, b) => {
    const ia = COL_ORDER.indexOf(a)
    const ib = COL_ORDER.indexOf(b)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
  })
  return (
    <div className="overflow-x-auto py-2">
      <table className="w-full text-xs font-body border-collapse">
        <thead>
          <tr className="border-b border-border-default">
            {cols.map(c => (
              <th key={c} className="text-left px-2 py-1.5 text-text-secondary font-heading font-semibold uppercase tracking-wide whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => {
            const byLabel = new Map(it.fields.map(f => [f.label, f.value]))
            return (
              <tr key={i} className="border-b border-border-default last:border-0">
                {cols.map(c => {
                  const v = formatFieldValue(byLabel.get(c))
                  return (
                    <td key={c} className="px-2 py-1.5 text-text-primary align-top break-words max-w-[280px]">
                      {v || <span className="text-text-muted">—</span>}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SectionCard({
  section,
  overrides,
  sessionId,
  editable,
}: {
  section: MbpDocument['sections'][number]
  overrides: Record<string, boolean>
  sessionId: string
  editable: boolean
}) {
  return (
    <div className="border border-border-default rounded-lg overflow-hidden bg-surface-card">
      <div className="px-4 py-2.5 bg-surface-subtle">
        <span className="text-sm font-heading font-semibold text-text-primary">{section.title}</span>
      </div>
      <div className="px-4 py-1">
        {section.fields && section.fields.length > 0 &&
          section.fields.map(f => (
            <FieldRow key={f.fieldPath} field={f} overridden={!!overrides[f.fieldPath]} sessionId={sessionId} editable={editable} />
          ))}
        {section.items && (
          SITEMAP_KEYS.has(section.key) ? (
            <SitemapTable items={section.items} />
          ) : section.items.length === 0 ? (
            <p className="text-text-muted font-body text-sm italic py-2">None.</p>
          ) : (
            section.items.map((item, i) => (
              <div key={i} className="py-2 border-b border-border-default last:border-0">
                <p className="text-xs font-heading font-semibold text-text-primary mb-1">{item.heading}</p>
                {item.fields.map(f => (
                  <FieldRow key={f.fieldPath} field={f} overridden={!!overrides[f.fieldPath]} sessionId={sessionId} editable={editable} />
                ))}
              </div>
            ))
          ))}
        {(!section.fields || section.fields.length === 0) && !section.items && (
          <p className="text-text-muted font-body text-sm italic py-2">No data collected yet.</p>
        )}
      </div>
    </div>
  )
}

export default function MbpDocument({
  doc,
  overrides,
  sessionId,
  editable = false,
}: {
  doc: MbpDocument
  overrides: Record<string, boolean>
  sessionId: string
  editable?: boolean
}) {
  // Sitemap sections are wide tables → full width. Everything else tiles into
  // a masonry of cards so the page fills horizontal space instead of one tall
  // column. break-inside-avoid keeps each card intact across columns.
  const wide = doc.sections.filter(s => SITEMAP_KEYS.has(s.key))
  const tiled = doc.sections.filter(s => !SITEMAP_KEYS.has(s.key))

  return (
    <div className="space-y-3">
      <div className="lg:columns-2 xl:columns-3 gap-3">
        {tiled.map(section => (
          <div key={section.key} className="mb-3 break-inside-avoid">
            <SectionCard section={section} overrides={overrides} sessionId={sessionId} editable={editable} />
          </div>
        ))}
      </div>
      {wide.map(section => (
        <SectionCard key={section.key} section={section} overrides={overrides} sessionId={sessionId} editable={editable} />
      ))}
    </div>
  )
}
