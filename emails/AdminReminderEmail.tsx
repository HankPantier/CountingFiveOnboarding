import {
  Html, Head, Body, Container, Heading, Text, Button, Hr,
} from '@react-email/components'

type Props = {
  websiteUrl: string
  adminSessionUrl: string
  daysInactive: number
  sessionId: string
  reminderCount: number
}

export default function AdminReminderEmail({ websiteUrl, adminSessionUrl, daysInactive, sessionId, reminderCount }: Props) {
  return (
    <Html>
      <Head />
      <Body style={{ backgroundColor: '#F8FAFC', fontFamily: 'Open Sans, Helvetica, Arial, sans-serif' }}>
        <Container style={{ maxWidth: 600, margin: '40px auto', backgroundColor: '#ffffff', padding: 32, borderRadius: 8, border: '1px solid #E2E8F0' }}>
          <Heading style={{ fontSize: 20, color: '#003B71', fontFamily: 'Inter, Helvetica, Arial, sans-serif', marginBottom: 4 }}>
            Inactive session — {websiteUrl}
          </Heading>
          <Text style={{ color: '#64748B', fontSize: 13, marginTop: 0 }}>
            Reminder #{reminderCount}
          </Text>
          <Text style={{ color: '#1E293B', fontSize: 15, lineHeight: 1.6 }}>
            The onboarding session for <strong>{websiteUrl}</strong> has been inactive for <strong>{daysInactive} {daysInactive === 1 ? 'day' : 'days'}</strong>.
          </Text>
          <Text style={{ color: '#64748B', fontSize: 13 }}>
            Session ID: <code style={{ fontFamily: 'monospace', backgroundColor: '#F1F5F9', padding: '2px 6px', borderRadius: 4 }}>{sessionId}</code>
          </Text>
          <Button
            href={adminSessionUrl}
            style={{
              backgroundColor: '#003B71',
              color: '#ffffff',
              padding: '12px 28px',
              borderRadius: 40,
              display: 'inline-block',
              textDecoration: 'none',
              fontFamily: 'Inter, Helvetica, Arial, sans-serif',
              fontSize: 14,
              fontWeight: 600,
              marginTop: 8,
            }}
          >
            View session in admin
          </Button>
          <Hr style={{ margin: '28px 0', borderColor: '#E2E8F0' }} />
          <Text style={{ color: '#94A3B8', fontSize: 12, lineHeight: 1.6 }}>
            A client reminder email has also been sent if their email address was collected.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}
