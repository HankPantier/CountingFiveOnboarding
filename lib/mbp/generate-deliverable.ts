import type { createServerClient } from '@/lib/supabase/server'
import { buildMbpDocument, mbpDocumentToMarkdown } from './build-document'
import { generateMbpPdf } from '@/lib/pdf/generate-mbp-pdf'
import type { SessionSchema } from '@/types/session-schema'
import type { MbpDocumentSection } from '@/types/mbp'

type Supabase = ReturnType<typeof createServerClient>

export interface MbpDeliverablePaths {
  pdfStoragePath: string
  mdStoragePath: string
}

// Generates and persists the single canonical Master Business Profile (PDF + MD)
// for a session, from the same buildMbpDocument projection the admin page renders
// — so screen, .md, and .pdf are one document. Throws on any failure so callers
// can decide whether to surface it (the deliverable must not silently no-op).
export async function generateAndStoreMbp(
  supabase: Supabase,
  sessionId: string,
): Promise<MbpDeliverablePaths> {
  const [{ data: session }, { data: uploadedAssets }] = await Promise.all([
    supabase.from('sessions').select('*').eq('id', sessionId).single(),
    supabase.from('assets').select('file_name, storage_path, asset_category').eq('session_id', sessionId),
  ])
  if (!session) throw new Error('Session not found')

  const schema = (session.schema_data as SessionSchema) ?? {}
  const doc = buildMbpDocument(schema)

  // Append the actual uploaded files (assets table) — these live outside
  // schema_data, so the schema projection alone would omit them.
  const uploads = uploadedAssets ?? []
  if (uploads.length > 0) {
    const section: MbpDocumentSection = {
      key: 'uploaded_files',
      title: 'Uploaded Files',
      items: uploads.map((a) => ({
        heading: a.file_name,
        fields: [
          { label: 'Category', fieldPath: '', value: a.asset_category ?? 'file', empty: false },
          { label: 'Path', fieldPath: '', value: a.storage_path, empty: !a.storage_path },
        ],
      })),
    }
    doc.sections.push(section)
  }

  const md = mbpDocumentToMarkdown(doc)
  const pdf = await generateMbpPdf(doc, schema as Record<string, unknown>, session.approved_at)

  const pdfStoragePath = `pdfs/${sessionId}/mbp.pdf`
  const mdStoragePath = `pdfs/${sessionId}/mbp.md`

  const [pdfUpload, mdUpload] = await Promise.all([
    supabase.storage.from('session-assets').upload(pdfStoragePath, pdf, {
      contentType: 'application/pdf',
      upsert: true,
    }),
    supabase.storage.from('session-assets').upload(mdStoragePath, Buffer.from(md, 'utf-8'), {
      contentType: 'text/markdown',
      upsert: true,
    }),
  ])
  if (pdfUpload.error) throw pdfUpload.error
  if (mdUpload.error) throw mdUpload.error

  await supabase.from('sessions').update({ pdf_url: pdfStoragePath }).eq('id', sessionId)

  return { pdfStoragePath, mdStoragePath }
}
