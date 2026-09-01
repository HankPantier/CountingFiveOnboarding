import { NextResponse } from 'next/server'
import { resolveSite, verifyBearer } from '@/lib/wordpress/sites'
import { isAllowedAssetPath, readRepoAsset } from '@/lib/wordpress/assets'
import { FileNotFoundError } from '@/lib/github/repo-files'

// Reads binary blobs from the private repo through the GitHub App and streams
// them to the WP plugin (which sends the same bearer). Node.js runtime required.
export const runtime = 'nodejs'
export const maxDuration = 60

// A hero image should never be this large; guard so a bad path can't pin memory.
const MAX_ASSET_BYTES = 15 * 1024 * 1024

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
}

function contentTypeFor(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return CONTENT_TYPES[ext] ?? 'application/octet-stream'
}

export async function GET(req: Request, { params }: { params: Promise<{ site: string }> }) {
  const { site: siteKey } = await params
  const site = await resolveSite(siteKey)
  if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!verifyBearer(req.headers.get('authorization'), site)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rawPath = new URL(req.url).searchParams.get('path')
  if (!rawPath) return NextResponse.json({ error: 'Missing path' }, { status: 400 })
  const safePath = isAllowedAssetPath(rawPath)
  if (!safePath) return NextResponse.json({ error: 'Invalid path' }, { status: 400 })

  try {
    const blob = await readRepoAsset(site.github_repo, safePath)
    if (blob.size > MAX_ASSET_BYTES) {
      return NextResponse.json({ error: 'Asset too large' }, { status: 413 })
    }
    return new Response(new Uint8Array(blob.content), {
      status: 200,
      headers: {
        'Content-Type': contentTypeFor(safePath),
        'Content-Length': String(blob.size),
        // Content-addressed by filename; safe for the plugin/edge to cache.
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (err) {
    if (err instanceof FileNotFoundError) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
