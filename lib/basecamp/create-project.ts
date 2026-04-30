import { basecampFetch } from './client'
import { createServerClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

type Session = Database['public']['Tables']['sessions']['Row']
type Asset = Database['public']['Tables']['assets']['Row']

type BcProject = { id: number; dock: { name: string; id: number }[] }
type BcMessage = { id: number; subject: string }
type BcAttachment = { attachable_sgid: string }

export async function createBasecampProject(
  session: Session,
  pdfStoragePath: string | null
): Promise<string> {
  const schema = (session.schema_data as Record<string, unknown>) ?? {}
  const business = schema.business as Record<string, unknown> | undefined
  const firmName = (business?.name as string) ?? session.website_url
  const projectName = `${firmName} — Website Build`

  const project = await basecampFetch('/projects.json', {
    method: 'POST',
    body: JSON.stringify({
      name: projectName,
      description: 'Website build project — intake completed via onboarding agent.',
    }),
  }) as BcProject

  const projectId = project.id

  const projectDetail = await basecampFetch(`/projects/${projectId}.json`) as BcProject
  const messageDock = projectDetail.dock.find(d => d.name === 'message_board')
  if (!messageDock) throw new Error('Could not find message board in Basecamp project')

  const summaryHtml = buildIntakeSummaryHtml(schema)

  const message = await basecampFetch(
    `/buckets/${projectId}/message_boards/${messageDock.id}/messages.json`,
    {
      method: 'POST',
      body: JSON.stringify({
        subject: `Intake Summary — ${firmName}`,
        content: summaryHtml,
        status: 'active',
      }),
    }
  ) as BcMessage

  const supabase = createServerClient()
  const { data: assets } = await supabase
    .from('assets')
    .select('*')
    .eq('session_id', session.id)

  const attachmentSgids: string[] = []

  if (pdfStoragePath) {
    try {
      await new Promise(r => setTimeout(r, 200))
      const sgid = await uploadStorageFileToBasecamp(pdfStoragePath, 'application/pdf')
      attachmentSgids.push(sgid)
    } catch (err) {
      console.error('[Basecamp] Failed to upload PDF:', err)
    }
  }

  for (const asset of (assets ?? []) as Asset[]) {
    await new Promise(r => setTimeout(r, 200))
    try {
      const sgid = await uploadStorageFileToBasecamp(asset.storage_path, asset.mime_type)
      attachmentSgids.push(sgid)
    } catch (err) {
      console.error(`[Basecamp] Failed to upload asset ${asset.file_name}:`, err)
    }
  }

  if (attachmentSgids.length > 0) {
    const attachmentTags = attachmentSgids
      .map(sgid => `<bc-attachment sgid="${sgid}"></bc-attachment>`)
      .join('\n')
    await basecampFetch(`/buckets/${projectId}/messages/${message.id}.json`, {
      method: 'PUT',
      body: JSON.stringify({
        subject: message.subject,
        content: summaryHtml + '\n\n' + attachmentTags,
      }),
    })
  }

  return String(projectId)
}

async function uploadStorageFileToBasecamp(
  storagePath: string,
  mimeType: string
): Promise<string> {
  const supabase = createServerClient()
  const { data: fileData, error } = await supabase.storage
    .from('session-assets')
    .download(storagePath)

  if (error || !fileData) throw new Error(`Could not download ${storagePath}: ${error?.message}`)

  const buffer = await fileData.arrayBuffer()

  const attachment = await basecampFetch('/attachments.json', {
    method: 'POST',
    headers: { 'Content-Type': mimeType } as Record<string, string>,
    body: buffer,
  }) as BcAttachment

  return attachment.attachable_sgid
}

function buildIntakeSummaryHtml(schema: Record<string, unknown>): string {
  const contact = schema.contact as Record<string, unknown> | undefined
  const business = schema.business as Record<string, unknown> | undefined
  const team = schema.team as Record<string, unknown>[] | undefined
  const services = schema.services as Record<string, unknown>[] | undefined

  const lines: string[] = [
    `<h1>Website Intake Summary — ${(business?.name as string) ?? 'Unknown Firm'}</h1>`,
    '<h2>Contact</h2>',
    `<p>${contact?.firstName ?? ''} ${contact?.lastName ?? ''}<br>`,
    `${contact?.email ?? ''}<br>`,
    `${(contact?.phone as string) ?? ''}</p>`,
    '<h2>Business</h2>',
    `<p><strong>Website:</strong> ${(schema.websiteUrl as string) ?? ''}<br>`,
    `<strong>Founded:</strong> ${(business?.foundingYear as string) ?? ''}<br>`,
    `<strong>Positioning:</strong> ${(business?.positioningStatement as string) ?? ''}</p>`,
  ]

  if (business?.differentiators) {
    lines.push('<h2>Differentiators</h2>', `<p>${business.differentiators}</p>`)
  }

  if (business?.firmHistory) {
    lines.push('<h2>Firm History</h2>', `<p>${business.firmHistory}</p>`)
  }

  if (team?.length) {
    lines.push(`<h2>Team (${team.length} members)</h2>`)
    for (const t of team) {
      const certs = Array.isArray(t.certifications) ? (t.certifications as string[]).join(', ') : ''
      lines.push(`<p><strong>${t.name as string}</strong> — ${t.title as string}${certs ? `<br>${certs}` : ''}</p>`)
    }
  }

  if (services?.length) {
    lines.push(`<h2>Services (${services.length})</h2>`)
    for (const sv of services) {
      lines.push(`<p><strong>${sv.name as string}:</strong> ${(sv.description as string) ?? ''}</p>`)
    }
  }

  lines.push('<h2>Assets Uploaded</h2>', '<p>See attachments below.</p>')

  return lines.join('\n')
}
