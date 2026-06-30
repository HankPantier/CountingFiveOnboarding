import { Document, renderToBuffer } from '@react-pdf/renderer'
import { CoverPage } from './components/CoverPage'
import { DataPage, Field, Subheading } from './components/DataPage'
import { formatFieldValue } from '@/lib/mbp/build-document'
import type { MbpDocument } from '@/types/mbp'

type Schema = Record<string, unknown>

// Renders the canonical Master Business Profile (the SAME MbpDocument the admin
// page and the markdown export use) to PDF, so the on-screen MBP, the .md, and
// the .pdf are one document. Sections with no non-empty content are skipped.
export async function generateMbpPdf(
  doc: MbpDocument,
  schema: Schema,
  approvedAt: string | null,
): Promise<Buffer> {
  const business = schema.business as Record<string, unknown> | undefined
  const title = `Master Business Profile — ${(business?.name as string) || (schema.websiteUrl as string) || 'Firm'}`

  const pages = doc.sections
    .map((section) => {
      const fieldNodes = (section.fields ?? [])
        .filter((f) => !f.empty)
        .map((f, i) => <Field key={`f-${i}`} label={f.label} value={formatFieldValue(f.value)} />)

      const itemNodes = (section.items ?? []).flatMap((item, idx) => {
        const nonEmpty = item.fields.filter((f) => !f.empty)
        if (nonEmpty.length === 0) return []
        return [
          <Subheading key={`h-${idx}`}>{item.heading}</Subheading>,
          ...nonEmpty.map((f, i) => <Field key={`i-${idx}-${i}`} label={f.label} value={formatFieldValue(f.value)} />),
        ]
      })

      const body = [...fieldNodes, ...itemNodes]
      if (body.length === 0) return null
      return (
        <DataPage key={section.key} title={section.title}>
          {body}
        </DataPage>
      )
    })
    .filter((p): p is React.ReactElement => p !== null)

  const docEl = (
    <Document title={title}>
      <CoverPage schema={schema} approvedAt={approvedAt} />
      {pages}
    </Document>
  )

  return renderToBuffer(docEl)
}
