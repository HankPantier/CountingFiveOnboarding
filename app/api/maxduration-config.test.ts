import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// vercel.json `functions` and a route's `export const maxDuration` are two
// sources of truth for the same number, and they had silently diverged:
// outlines/generate was 120 in vercel.json but 300 in the route, while its
// runner carried a 240s soft deadline — a deadline that could therefore never
// fire, so the function was killed every single run. This test makes that class
// of drift impossible to merge.
const ROOT = path.join(__dirname, '..', '..')

function declaredMaxDuration(routePath: string): number | null {
  const full = path.join(ROOT, routePath)
  if (!fs.existsSync(full)) return null
  const m = fs.readFileSync(full, 'utf-8').match(/export const maxDuration\s*=\s*(\d+)/)
  return m ? Number(m[1]) : null
}

describe('maxDuration config', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf-8')) as {
    functions?: Record<string, { maxDuration?: number }>
  }
  const entries = Object.entries(cfg.functions ?? {})

  it('has functions configured', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  it.each(entries)('vercel.json %s agrees with its route export', (routePath, conf) => {
    const exported = declaredMaxDuration(routePath)
    expect(exported, `${routePath} is listed in vercel.json but has no maxDuration export`).not.toBeNull()
    expect(exported, `${routePath}: vercel.json says ${conf.maxDuration}, route exports ${exported}`).toBe(
      conf.maxDuration
    )
  })

  it('every vercel.json-listed route file exists', () => {
    for (const [routePath] of entries) {
      expect(fs.existsSync(path.join(ROOT, routePath)), `${routePath} not found`).toBe(true)
    }
  })

  it('the generation runner budgets against the route it actually runs in', async () => {
    const { GENERATE_ROUTE_MAX_DURATION_MS } = await import('@/lib/content/content-generator')
    const configured = cfg.functions?.['app/api/content-jobs/[id]/generate/route.ts']?.maxDuration
    expect(GENERATE_ROUTE_MAX_DURATION_MS).toBe((configured ?? 0) * 1000)
  })
})
