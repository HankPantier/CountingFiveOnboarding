import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { render } from '@react-email/render'
import { createServerClient } from '@/lib/supabase/server'
import ClientReminderEmail from '@/emails/ClientReminderEmail'
import AdminReminderEmail from '@/emails/AdminReminderEmail'

const INACTIVITY_THRESHOLD_DAYS = 3
// Stop nagging after this many reminders — a session dormant through three
// nudges needs a human follow-up, not a fourth email.
const MAX_REMINDERS = 3

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    // Fail closed: an unset secret would otherwise compare against
    // "Bearer undefined", which an attacker could match.
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Guard the email config up front — a missing from-address used to surface
  // only at the second send, after the client email had already gone out.
  const FROM_EMAIL = process.env.RESEND_FROM_EMAIL
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? ''
  if (!process.env.RESEND_API_KEY || !FROM_EMAIL) {
    return NextResponse.json({ error: 'Email not configured' }, { status: 500 })
  }
  const resend = new Resend(process.env.RESEND_API_KEY)

  const supabase = createServerClient()

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - INACTIVITY_THRESHOLD_DAYS)

  const { data: candidates } = await supabase
    .from('sessions')
    .select('id, website_url, client_email, schema_data, reminder_count, last_activity_at')
    .in('status', ['pending', 'in_progress'])
    .lt('last_activity_at', cutoff.toISOString())
    .lt('reminder_count', MAX_REMINDERS)

  if (!candidates?.length) {
    return NextResponse.json({ checked: 0, reminded: 0 })
  }

  // Dedup: last_activity_at never moves while a session sits idle, so
  // without this every cron run re-reminds the same sessions. Skip any
  // session already reminded within the inactivity window.
  const { data: recentReminders } = await supabase
    .from('reminders')
    .select('session_id')
    .in('session_id', candidates.map((s) => s.id))
    .gte('sent_at', cutoff.toISOString())
  const recentlyReminded = new Set((recentReminders ?? []).map((r) => r.session_id))
  const inactiveSessions = candidates.filter((s) => !recentlyReminded.has(s.id))

  if (!inactiveSessions.length) {
    return NextResponse.json({ checked: candidates.length, reminded: 0 })
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

      // Record the reminder BEFORE sending. If a send fails afterwards, we
      // lose one nudge cycle — the safe failure. The old order (send → record)
      // meant a failure between the two emails re-emailed the client on every
      // subsequent cron run because no dedup row existed.
      const { error: reminderErr } = await supabase.from('reminders').insert({
        session_id: session.id,
        days_inactive: daysInactive,
      })
      if (reminderErr) {
        console.error(`[cron] reminder record failed for ${session.id}:`, reminderErr)
        continue
      }
      await supabase
        .from('sessions')
        .update({ reminder_count: newReminderCount })
        .eq('id', session.id)

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
          from: FROM_EMAIL,
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
        from: FROM_EMAIL,
        to: ADMIN_EMAIL,
        subject: `[Revaltus] Inactive session — ${session.website_url} (${daysInactive}d)`,
        html: adminHtml,
      })

      reminded++
    } catch (err) {
      console.error(`[cron] Failed to remind session ${session.id}:`, err)
    }
  }

  return NextResponse.json({ checked: inactiveSessions.length, reminded })
}
