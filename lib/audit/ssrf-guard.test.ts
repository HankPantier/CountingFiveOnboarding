import { describe, expect, it } from 'vitest'
import { isPrivateIp, isUrlPubliclyFetchable } from './ssrf-guard'

describe('isPrivateIp', () => {
  it('flags internal IPv4 ranges', () => {
    for (const ip of [
      '127.0.0.1',
      '10.0.0.5',
      '169.254.169.254', // cloud metadata
      '192.168.1.1',
      '172.16.0.1',
      '172.31.255.255',
      '100.64.0.1', // CGNAT
      '0.0.0.0',
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
  })

  it('allows public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(false)
    }
  })

  it('flags internal IPv6 ranges incl. IPv4-mapped and the full fe80::/10', () => {
    for (const ip of [
      '::1',
      'fe80::1',
      'fe90::1', // still link-local — fe80::/10 spans fe80–febf
      'fea0::1',
      'febf::1',
      'fc00::1',
      'fd12::3',
      '::ffff:127.0.0.1',
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
    expect(isPrivateIp('2606:4700:4700::1111')).toBe(false)
    expect(isPrivateIp('fec0::1')).toBe(false) // fec0 is outside fe80::/10
  })
})

describe('isUrlPubliclyFetchable', () => {
  it('blocks internal IP literals', async () => {
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'http://127.0.0.1:8080/',
      'http://[::1]/',
      'http://10.0.0.5/admin',
      'https://192.168.0.1/',
    ]) {
      expect(await isUrlPubliclyFetchable(url), url).toBe(false)
    }
  })

  it('blocks non-http schemes and userinfo', async () => {
    expect(await isUrlPubliclyFetchable('ftp://example.com')).toBe(false)
    expect(await isUrlPubliclyFetchable('file:///etc/passwd')).toBe(false)
    expect(await isUrlPubliclyFetchable('gopher://127.0.0.1/')).toBe(false)
    expect(await isUrlPubliclyFetchable('http://user:pass@example.com/')).toBe(false)
    expect(await isUrlPubliclyFetchable('not a url')).toBe(false)
  })

  it('blocks hostnames that resolve to loopback', async () => {
    expect(await isUrlPubliclyFetchable('http://localhost/')).toBe(false)
  })

  it('allows a public IP literal', async () => {
    expect(await isUrlPubliclyFetchable('https://8.8.8.8/')).toBe(true)
  })
})
