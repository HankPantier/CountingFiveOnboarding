import {
  Html, Head, Body, Container, Heading, Text, Button, Hr,
} from '@react-email/components'

type Props = {
  clientName: string
  sessionUrl: string
  firmName: string
  daysInactive: number
}

export default function ClientReminderEmail({ clientName, sessionUrl, firmName, daysInactive }: Props) {
  return (
    <Html>
      <Head />
      <Body style={{ backgroundColor: '#F8FAFC', fontFamily: 'Open Sans, Helvetica, Arial, sans-serif' }}>
        <Container style={{ maxWidth: 600, margin: '40px auto', backgroundColor: '#ffffff', padding: 32, borderRadius: 8, border: '1px solid #E2E8F0' }}>
          <Heading style={{ fontSize: 22, color: '#003B71', fontFamily: 'Inter, Helvetica, Arial, sans-serif', marginBottom: 16 }}>
            Your website intake is waiting
          </Heading>
          <Text style={{ color: '#1E293B', fontSize: 15, lineHeight: 1.6 }}>
            Hi {clientName} — you started your website intake for <strong>{firmName}</strong> {daysInactive} {daysInactive === 1 ? 'day' : 'days'} ago.
            Your progress is saved and it should only take a few more minutes to finish.
          </Text>
          <Button
            href={sessionUrl}
            style={{
              backgroundColor: '#00C1DE',
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
            Continue your intake
          </Button>
          <Hr style={{ margin: '28px 0', borderColor: '#E2E8F0' }} />
          <Text style={{ color: '#94A3B8', fontSize: 12, lineHeight: 1.6 }}>
            This is an automated reminder from CountingFive. If you have already completed this, please disregard.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}
