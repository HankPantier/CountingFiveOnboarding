// SSL/cert expiry check via node:tls. Ported from audit.py check_ssl.
// Connects, reads the peer certificate, computes days-to-expiry. Mirrors
// audit.py's "don't penalise when undeterminable" behaviour: a genuine cert
// verification failure → valid:false + error; any other connect failure →
// valid:true + error (so a flaky probe doesn't tank the technical score).
import tls from 'node:tls'
import { isUrlPubliclyFetchable } from './ssrf-guard'
import type { SslResult } from './types'

const CONNECT_TIMEOUT_MS = 8_000

// Node TLS error codes that indicate the certificate itself is untrusted/invalid.
const CERT_ERROR_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_NOT_YET_VALID',
])

export async function checkSsl(baseUrl: string): Promise<SslResult> {
  const result: SslResult = { valid: false, expiry_days: null, error: null }

  let hostname: string
  try {
    const parsed = new URL(baseUrl)
    if (parsed.protocol !== 'https:') {
      return { valid: false, expiry_days: null, error: 'Not using HTTPS' }
    }
    hostname = parsed.hostname
  } catch {
    return { valid: false, expiry_days: null, error: 'Invalid URL' }
  }

  // SSRF guard: never open a TLS socket to an internal address.
  if (!(await isUrlPubliclyFetchable(baseUrl))) {
    return { valid: false, expiry_days: null, error: 'Host is not publicly resolvable' }
  }

  return new Promise<SslResult>((resolve) => {
    let settled = false
    const finish = (r: SslResult) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(r)
    }

    const socket = tls.connect(
      { host: hostname, port: 443, servername: hostname, timeout: CONNECT_TIMEOUT_MS },
      () => {
        const cert = socket.getPeerCertificate()
        if (!cert || !cert.valid_to) {
          finish({ valid: true, expiry_days: null, error: null })
          return
        }
        const expiry = new Date(cert.valid_to).getTime()
        const days = Math.floor((expiry - Date.now()) / 86_400_000)
        finish({ valid: days > 0, expiry_days: days, error: null })
      },
    )

    socket.on('timeout', () => finish({ ...result, valid: true, error: 'Connection timed out' }))
    socket.on('error', (err: NodeJS.ErrnoException) => {
      const code = err.code ?? ''
      if (CERT_ERROR_CODES.has(code)) {
        finish({ valid: false, expiry_days: null, error: err.message })
      } else {
        // Can't determine — don't penalise (audit.py parity).
        finish({ valid: true, expiry_days: null, error: err.message.slice(0, 100) })
      }
    })
  })
}
