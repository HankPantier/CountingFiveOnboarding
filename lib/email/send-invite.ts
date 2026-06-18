import { Resend } from 'resend'
import { render } from '@react-email/render'
import InviteUserEmail, { roleLabel } from '@/emails/InviteUserEmail'
import type { Role, Capability } from '@/lib/auth/access'

interface SendInviteArgs {
  to: string
  name: string
  role: Role
  capabilities: Capability[]
  inviteUrl: string
}

// Sends the set-password invite. Shared by the create-user and resend-invite
// routes. Mirrors the Resend pattern used by app/api/sessions/[id]/remind.
export async function sendInviteEmail({ to, name, role, capabilities, inviteUrl }: SendInviteArgs): Promise<void> {
  const resend = new Resend(process.env.RESEND_API_KEY)
  const html = await render(
    InviteUserEmail({ name, label: roleLabel(role, capabilities), inviteUrl })
  )
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to,
    subject: 'Your Revaltus admin invitation',
    html,
  })
}
