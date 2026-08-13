import dotenv from 'dotenv'

// Next.js keeps secrets in .env.local; fall back to .env if present.
dotenv.config({ path: '.env' })
dotenv.config({ path: '.env.local', override: true })

// Usage: node scripts/check-email-health.mjs [--send you@example.com]
//
// Preflight for the transactional-email path (invite + password reset). Both
// flows send via Resend from RESEND_FROM_EMAIL. Resend 403-rejects any send
// from an UNVERIFIED domain, and the app routes swallow that error fail-soft —
// so a misconfigured domain silently drops every invite/reset with no user-
// facing signal. This check surfaces that state:
//   - exits non-zero if the RESEND_FROM_EMAIL domain isn't `verified`
//   - with --send, does one live send and prints the id or the API error verbatim
const apiKey = process.env.RESEND_API_KEY
const from = process.env.RESEND_FROM_EMAIL
if (!apiKey) { console.error('Missing RESEND_API_KEY'); process.exit(1) }
if (!from) { console.error('Missing RESEND_FROM_EMAIL'); process.exit(1) }

// RESEND_FROM_EMAIL may be "Name <addr@domain>" or a bare "addr@domain".
const addr = (from.match(/<([^>]+)>/)?.[1] ?? from).trim()
const domain = addr.split('@')[1]?.toLowerCase()
if (!domain) { console.error(`Could not parse a domain from RESEND_FROM_EMAIL="${from}"`); process.exit(1) }

console.log(`From:   ${from}`)
console.log(`Domain: ${domain}`)

const res = await fetch('https://api.resend.com/domains', {
  headers: { Authorization: `Bearer ${apiKey}` },
})
if (!res.ok) {
  console.error(`Resend /domains returned HTTP ${res.status} — check RESEND_API_KEY`)
  process.exit(2)
}
const { data: domains = [] } = await res.json()
const match = domains.find((d) => d.name?.toLowerCase() === domain)

if (!match) {
  console.error(`FAIL: "${domain}" is not registered in this Resend account. Add it in the Resend dashboard and verify DNS.`)
  console.error(`Known domains: ${domains.map((d) => `${d.name} (${d.status})`).join(', ') || 'none'}`)
  process.exit(3)
}

console.log(`Status: ${match.status}`)
if (match.status !== 'verified') {
  console.error(`FAIL: "${domain}" is "${match.status}", not "verified". Sends from this domain are 403-rejected by Resend.`)
  console.error('Add the DKIM/SPF records shown in the Resend dashboard for this domain, then click Verify.')
  process.exit(4)
}
console.log(`OK: "${domain}" is verified — sends are allowed.`)

// Optional live send.
const sendFlag = process.argv.indexOf('--send')
if (sendFlag !== -1) {
  const to = process.argv[sendFlag + 1]
  if (!to || !to.includes('@')) { console.error('--send requires a recipient email'); process.exit(1) }
  console.log(`\nSending a live test email to ${to} …`)
  const sendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to,
      subject: 'Revaltus email health check',
      html: '<p>This is a test send from <code>scripts/check-email-health.mjs</code>. If you received it, transactional email is working.</p>',
    }),
  })
  const body = await sendRes.json().catch(() => ({}))
  if (!sendRes.ok) {
    console.error(`FAIL: test send rejected (HTTP ${sendRes.status}):`, JSON.stringify(body))
    process.exit(5)
  }
  console.log(`OK: test send accepted — Resend id ${body.id}. Check the inbox (and spam).`)
}
