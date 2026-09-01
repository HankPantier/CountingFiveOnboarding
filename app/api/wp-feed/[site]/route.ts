import { NextResponse } from 'next/server'
import { resolveSite, verifyBearer } from '@/lib/wordpress/sites'
import { resolveOrigin } from '@/lib/wordpress/origin'
import { buildFeed } from '@/lib/wordpress/feed-builder'

// GitHub reads require the Node.js runtime; a site with many posts takes dozens
// of reads, so allow more than the 60s default.
export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(req: Request, { params }: { params: Promise<{ site: string }> }) {
  const { site: siteKey } = await params
  const site = await resolveSite(siteKey)
  // 404 for unknown AND disabled sites — don't reveal which.
  if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!verifyBearer(req.headers.get('authorization'), site)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const posts = await buildFeed(site.github_repo, site.key, resolveOrigin(req))
    return NextResponse.json(
      { site: site.key, generated_at: new Date().toISOString(), posts },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
