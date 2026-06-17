import { Resend } from 'resend'
import { render } from '@react-email/render'
import ResetPasswordEmail from '@/emails/ResetPasswordEmail'

interface SendPasswordResetArgs {
  to: string
  resetUrl: string
}

// Sends the password-reset email for the self-service forgot-password flow.
// Mirrors the Resend pattern in lib/email/send-invite.ts.
export async function sendPasswordResetEmail({ to, resetUrl }: SendPasswordResetArgs): Promise<void> {
  const resend = new Resend(process.env.RESEND_API_KEY)
  const html = await render(ResetPasswordEmail({ resetUrl }))
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to,
    subject: 'Reset your Revaltus password',
    html,
  })
}
