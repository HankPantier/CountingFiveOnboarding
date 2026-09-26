import { describe, it, expect, afterEach } from 'vitest'
import { checkCronBearer, isCronBearer, requireCronBearer, timingSafeEqualString } from './cron-bearer'

const ORIGINAL = process.env.CRON_SECRET

function req(auth?: string): Request {
  return new Request('https://x.test/api/cron/y', { headers: auth === undefined ? {} : { authorization: auth } })
}

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = ORIGINAL
})

describe('timingSafeEqualString', () => {
  it('matches equal strings only', () => {
    expect(timingSafeEqualString('Bearer abc', 'Bearer abc')).toBe(true)
    expect(timingSafeEqualString('Bearer abd', 'Bearer abc')).toBe(false)
    expect(timingSafeEqualString('Bearer ab', 'Bearer abc')).toBe(false)
    expect(timingSafeEqualString('', '')).toBe(true)
  })
})

describe('checkCronBearer', () => {
  it('fails closed when the secret is empty or unset', () => {
    expect(checkCronBearer('Bearer undefined', undefined)).toBe('misconfigured')
    expect(checkCronBearer('Bearer ', '')).toBe('misconfigured')
  })
  it('accepts only the exact bearer', () => {
    expect(checkCronBearer('Bearer s3cret', 's3cret')).toBe('ok')
    expect(checkCronBearer('bearer s3cret', 's3cret')).toBe('unauthorized')
    expect(checkCronBearer('Bearer s3cret ', 's3cret')).toBe('unauthorized')
    expect(checkCronBearer(null, 's3cret')).toBe('unauthorized')
  })
})

describe('request helpers', () => {
  it('isCronBearer is false with no secret configured (never a bypass)', () => {
    delete process.env.CRON_SECRET
    expect(isCronBearer(req('Bearer undefined'))).toBe(false)
    expect(isCronBearer(req('Bearer '))).toBe(false)
  })
  it('requireCronBearer returns 500 / 401 / null', async () => {
    delete process.env.CRON_SECRET
    expect(requireCronBearer(req('Bearer x'))?.status).toBe(500)
    process.env.CRON_SECRET = 'x'
    expect(requireCronBearer(req('Bearer y'))?.status).toBe(401)
    expect(requireCronBearer(req())?.status).toBe(401)
    expect(requireCronBearer(req('Bearer x'))).toBeNull()
    expect(isCronBearer(req('Bearer x'))).toBe(true)
  })
})
