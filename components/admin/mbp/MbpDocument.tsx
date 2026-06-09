import type { MbpDocument, MbpDocumentField } from '@/types/mbp'

function FieldRow({ field, overridden }: { field: MbpDocumentField; overridden: boolean }) {
  return (
    <div className="flex items-start gap-3 py-1.5 border-b border-border-default last:border-0">
      <span className="text-text-secondary text-xs font-body w-40 flex-shrink-0 pt-0.5">
        {field.label}
        {overridden && (
          <span className="ml-1 text-brand-cyan" title="Admin override">●</span>
        )}
      </span>
      <div className="flex-1 min-w-0 text-sm font-body">
        {field.empty
          ? <span className="text-text-muted italic">—</span>
          : <span className="text-text-primary break-words">{String(field.value)}</span>}
      </div>
    </div>
  )
}

export default function MbpDocument({
  doc,
  overrides,
}: {
  doc: MbpDocument
  overrides: Record<string, boolean>
}) {
  return (
    <div className="space-y-3">
      {doc.sections.map(section => (
        <div key={section.key} className="border border-border-default rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 bg-surface-subtle">
            <span className="text-sm font-heading font-semibold text-text-primary">{section.title}</span>
          </div>
          <div className="px-4 py-1">
            {section.fields && section.fields.length > 0 && (
              section.fields.map(f => (
                <FieldRow key={f.fieldPath} field={f} overridden={!!overrides[f.fieldPath]} />
              ))
            )}
            {section.items && (
              section.items.length === 0
                ? <p className="text-text-muted font-body text-sm italic py-2">None.</p>
                : section.items.map((item, i) => (
                    <div key={i} className="py-2 border-b border-border-default last:border-0">
                      <p className="text-xs font-heading font-semibold text-text-primary mb-1">{item.heading}</p>
                      {item.fields.map(f => (
                        <FieldRow key={f.fieldPath} field={f} overridden={!!overrides[f.fieldPath]} />
                      ))}
                    </div>
                  ))
            )}
            {(!section.fields || section.fields.length === 0) && !section.items && (
              <p className="text-text-muted font-body text-sm italic py-2">No data collected yet.</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
