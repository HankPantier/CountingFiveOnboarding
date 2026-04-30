import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { render } from '@react-email/render'
import { createServerClient } from '@/lib/supabase/server'
import ClientReminderEmail from '@/emails/ClientReminderEmail'
import AdminReminderEmail from '@/emails/AdminReminderEmail'

const resend = new Resend(process.env.RESEND_API_KEY)
const INACTIVITY_THRESHOLD_DAYS = 3
const ADMIN_EMAIL = 'webhank@gmail.com'

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - INACTIVITY_THRESHOLD_DAYS)

  const { data: inactiveSessions } = await supabase
    .from('sessions')
    .select('id, website_url, client_email, schema_data, reminder_count, last_activity_at')
    .in('status', ['pending', 'in_progress'])
    .lt('last_activity_at', cutoff.toISOString())

  if (!inactiveSessions?.length) {
    return NextResponse.json({ checked: 0, reminded: 0 })
  }

  let reminded = 0

  for (const session of inactiveSessions) {
    try {
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
        subject: `[CountingFive] Inactive session — ${session.website_url} (${daysInactive}d)`,
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

      reminded++
    } catch (err) {
      console.error(`[cron] Failed to remind session ${session.id}:`, err)
    }
  }

  return NextResponse.json({ checked: inactiveSessions.length, reminded })
}
