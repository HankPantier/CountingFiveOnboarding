// SSRF guard for the audit engine. The crawler fetches attacker-influenced
// URLs (links, redirect targets, robots/sitemap-declared URLs from the audited
// site), so every outbound fetch must be validated against internal address
// ranges. A malicious audited site could otherwise point the server at cloud
// metadata (169.254.169.254), localhost, or RFC1918 hosts and have the body
// stored in the report.
//
// Applied at the single HTTP choke point (safeGet, re-checked per redirect hop)
// and the TLS check. Residual risk: DNS-rebinding TOCTOU between lookup and
// connect — acceptable for an admin-only tool; the denylist blocks the realistic
// metadata/localhost/RFC1918 vectors.
import { lookup } from 'node:dns/promises'
import net from 'node:net'

/** True if an IP literal is in a loopback / private / link-local / CGNAT /
 * unique-local range that must never be fetched server-side. */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 0) return true // 0.0.0.0/8
    if (a === 10) return true // RFC1918
    if (a === 127) return true // loopback
    if (a === 169 && b === 254) return true // link-local (incl. cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true // RFC1918
    if (a === 192 && b === 168) return true // RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT 100.64/10
    if (a >= 224) return true // multicast / reserved
    return false
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase()
    if (lower === '::1' || lower === '::') return true // loopback / unspecified
    if (/^fe[89ab]/.test(lower)) return true // link-local fe80::/10 (fe80–febf)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true // unique-local fc00::/7
    const mapped = lower.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
    if (mapped) return isPrivateIp(mapped[1]) // IPv4-mapped
    return false
  }
  return true // not a recognizable IP → treat as unsafe
}

/** Validate a URL is safe to fetch: http(s) only, no userinfo, and every IP it
 * resolves to is public. Returns false (never throws) so callers can degrade. */
export async function isUrlPubliclyFetchable(urlStr: string): Promise<boolean> {
  let u: URL
  try {
    u = new URL(urlStr)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  if (u.username || u.password) return false

  const host = u.hostname
    .replace(/^\[|\]$/g, '') // strip IPv6 brackets
    .replace(/\.$/, '') // strip trailing dot
    .toLowerCase()
  if (!host) return false

  if (net.isIP(host)) return !isPrivateIp(host)

  try {
    const addrs = await lookup(host, { all: true })
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address))
  } catch {
    return false
  }
}
