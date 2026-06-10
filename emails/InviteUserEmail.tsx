import {
  Html, Head, Body, Container, Heading, Text, Button, Hr,
} from '@react-email/components'

type Props = {
  name: string
  inviteUrl: string
  role: 'admin' | 'manager'
}

export default function InviteUserEmail({ name, inviteUrl, role }: Props) {
  const roleLabel = role === 'admin' ? 'an administrator' : 'a manager'
  return (
    <Html>
      <Head />
      <Body style={{ backgroundColor: '#F8FAFC', fontFamily: 'Open Sans, Helvetica, Arial, sans-serif' }}>
        <Container style={{ maxWidth: 600, margin: '40px auto', backgroundColor: '#ffffff', padding: 32, borderRadius: 8, border: '1px solid #E2E8F0' }}>
          <Heading style={{ fontSize: 20, color: '#231f20', fontFamily: 'Inter, Helvetica, Arial, sans-serif', marginBottom: 4 }}>
            You&rsquo;ve been invited to Revaltus
          </Heading>
          <Text style={{ color: '#1E293B', fontSize: 15, lineHeight: 1.6 }}>
            Hi {name}, you&rsquo;ve been added to the Revaltus admin as {roleLabel}.
            Click below to set your password and sign in.
          </Text>
          <Button
            href={inviteUrl}
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
            Set your password
          </Button>
          <Hr style={{ margin: '28px 0', borderColor: '#E2E8F0' }} />
          <Text style={{ color: '#94A3B8', fontSize: 12, lineHeight: 1.6 }}>
            If you weren&rsquo;t expecting this invitation, you can safely ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}
