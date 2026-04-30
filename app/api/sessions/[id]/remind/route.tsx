import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { render } from '@react-email/render'
import { createAuthClient, createServerClient } from '@/lib/supabase/server'
import ClientReminderEmail from '@/emails/ClientReminderEmail'
import AdminReminderEmail from '@/emails/AdminReminderEmail'

const resend = new Resend(process.env.RESEND_API_KEY)
const ADMIN_EMAIL = 'webhank@gmail.com'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await createAuthClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const supabase = createServerClient()

  const { data: session } = await supabase
    .from('sessions')
    .select('id, website_url, client_email, schema_data, reminder_count, last_activity_at, status')
    .eq('id', id)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (!['pending', 'in_progress'].includes(session.status)) {
    return NextResponse.json({ error: 'Session is not active' }, { status: 400 })
  }

  const daysInactive = Math.floor(
    (Date.now() - new Date(session.last_activity_at).getTime()) / 86400000
  )
  const newReminderCount = (session.reminder_count ?? 0) + 1

  const sessionUrl = `${process.env.NEXT_PUBLIC_APP_URL}/session/${session.id}`
  const adminSessionUrl = `${process.env.NEXT_PUBLIC_APP_URL}/admin/sessions/${session.id}`

  const schema = session.schema_data as Record<string, unknown>
  const business = schema?.business as Record<string, unknown> | undefined
  const contact = schema?.contact as Record<string, unknown> | undefined
  const firmName = (business?.name as string) ?? session.website_url
  const clientName = (contact?.firstName as string) ?? 'there'

  if (session.client_email) {
    const clientHtml = await render(
      <ClientReminderEmail
        clientName={clientName}
        sessionUrl={sessionUrl}
        firmName={firmName}
        daysInactive={daysInactive}
      />
    )
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL!,
      to: session.client_email,
      subject: `Your website intake for ${firmName} is still waiting`,
      html: clientHtml,
    })
  }

  const adminHtml = await render(
    <AdminReminderEmail
      websiteUrl={session.website_url}
      adminSessionUrl={adminSessionUrl}
      daysInactive={daysInactive}
      sessionId={session.id}
      reminderCount={newReminderCount}
    />
  )
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: ADMIN_EMAIL,
    subject: `[CountingFive] Manual reminder — ${session.website_url}`,
    html: adminHtml,
  })

  await supabase.from('reminders').insert({
    session_id: session.id,
    days_inactive: daysInactive,
  })
  await supabase
    .from('sessions')
    .update({ reminder_count: newReminderCount })
    .eq('id', session.id)

  return NextResponse.json({ success: true, reminderCount: newReminderCount })
}
