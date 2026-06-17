import {
  Html, Head, Body, Container, Heading, Text, Button, Hr,
} from '@react-email/components'

type Props = {
  resetUrl: string
}

export default function ResetPasswordEmail({ resetUrl }: Props) {
  return (
    <Html>
      <Head />
      <Body style={{ backgroundColor: '#F8FAFC', fontFamily: 'Open Sans, Helvetica, Arial, sans-serif' }}>
        <Container style={{ maxWidth: 600, margin: '40px auto', backgroundColor: '#ffffff', padding: 32, borderRadius: 8, border: '1px solid #E2E8F0' }}>
          <Heading style={{ fontSize: 20, color: '#231f20', fontFamily: 'Inter, Helvetica, Arial, sans-serif', marginBottom: 4 }}>
            Reset your Revaltus password
          </Heading>
          <Text style={{ color: '#1E293B', fontSize: 15, lineHeight: 1.6 }}>
            We received a request to reset the password for your Revaltus admin account.
            Click below to choose a new password. This link expires shortly.
          </Text>
          <Button
            href={resetUrl}
            style={{
              backgroundColor: '#098195',
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
            Reset your password
          </Button>
          <Hr style={{ margin: '28px 0', borderColor: '#E2E8F0' }} />
          <Text style={{ color: '#94A3B8', fontSize: 12, lineHeight: 1.6 }}>
            If you didn&rsquo;t request a password reset, you can safely ignore this email — your
            password won&rsquo;t change.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}
