import { NextResponse } from 'next/server'
import { fileTypeFromBuffer } from 'file-type'
import { resolveEditContext } from '../_helpers'
import { safeAssetPath } from '../_path'
import {
  AssetExistsError,
  DRAFT_BRANCH,
  FileNotFoundError,
  StaleShaError,
  deleteFile,
  ensureDraftBranch,
  readBinaryFile,
  writeBinaryFile,
} from '@/lib/github/repo-files'

export const runtime = 'nodejs'

// Magic-byte-verifiable raster types only. SVG is excluded on upload: file-type
// cannot detect it (no magic bytes) and SVG can carry embedded scripts.
const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
const MAX_BYTES = 10 * 1024 * 1024

// Used only to validate that an upload's extension matches its sniffed magic
// bytes. SVG is intentionally absent — SVG uploads are rejected.
const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

// Hardening applied to every asset response. `nosniff` stops MIME confusion;
// the sandbox CSP neutralizes scripts in an SVG (or any misidentified payload)
// if the asset URL is opened as a top-level document. <img> thumbnails are
// unaffected — a subresource's CSP does not gate its embedding context.
const ASSET_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
} as const

// GET ?path=public/content-assets/foo.png — streams raw image bytes so the
// admin <img> tags can render them (the bucket/repo isn't public).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  const rawPath = new URL(req.url).searchParams.get('path')
  if (!rawPath) {
    return NextResponse.json({ error: 'path query param required' }, { status: 400 })
  }
  const path = safeAssetPath(rawPath)
  if (!path) {
    return NextResponse.json({ error: 'path must be under public/content-assets/' }, { status: 400 })
  }

  try {
    await ensureDraftBranch(ctx.githubRepo)
    const blob = await readBinaryFile(ctx.githubRepo, path, DRAFT_BRANCH)
    const sniffed = await fileTypeFromBuffer(blob.content)

    // Only serve a content type we can stand behind. Verified raster bytes get
    // their sniffed mime; SVG (unsniffable) is served as svg but sandboxed by
    // the security headers below. Anything else is refused rather than guessed.
    let contentType: string
    if (sniffed && (ALLOWED_MIMES as readonly string[]).includes(sniffed.mime)) {
      contentType = sniffed.mime
    } else if (path.toLowerCase().endsWith('.svg')) {
      contentType = 'image/svg+xml'
    } else {
      return NextResponse.json(
        { error: 'Unsupported or unverifiable image type' },
        { status: 415 }
      )
    }

    return new NextResponse(new Uint8Array(blob.content), {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(blob.size),
        // Private to the admin; never cache across the draft→publish reset.
        'Cache-Control': 'private, no-store',
        ...ASSET_SECURITY_HEADERS,
      },
    })
  } catch (err) {
    if (err instanceof FileNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// PUT multipart/form-data { file, path, mode: 'create'|'replace', expectedSha? }
// — validates magic bytes, then commits to draft.
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const file = form.get('file')
  const rawPath = form.get('path')
  const mode = form.get('mode')
  const expectedSha = form.get('expectedSha')

  if (!(file instanceof Blob) || typeof rawPath !== 'string') {
    return NextResponse.json({ error: 'file and path are required' }, { status: 400 })
  }
  if (mode !== 'create' && mode !== 'replace') {
    return NextResponse.json({ error: "mode must be 'create' or 'replace'" }, { status: 400 })
  }
  const path = safeAssetPath(rawPath)
  if (!path) {
    return NextResponse.json({ error: 'path must be under public/content-assets/' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  if (buffer.byteLength === 0) {
    return NextResponse.json({ error: 'Empty file' }, { status: 400 })
  }
  if (buffer.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'Image exceeds 10MB limit' }, { status: 413 })
  }

  const detected = await fileTypeFromBuffer(buffer)
  if (!detected || !ALLOWED_MIMES.includes(detected.mime as (typeof ALLOWED_MIMES)[number])) {
    return NextResponse.json(
      { error: 'File is not a supported image (PNG, JPEG, WebP, or GIF)' },
      { status: 415 }
    )
  }
  // Reject extension/content mismatch so the committed filename is honest.
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (EXT_MIME[ext] !== detected.mime) {
    return NextResponse.json(
      { error: `Filename .${ext} does not match image type ${detected.mime}` },
      { status: 415 }
    )
  }

  try {
    await ensureDraftBranch(ctx.githubRepo)
    const result = await writeBinaryFile(
      ctx.githubRepo,
      path,
      buffer,
      DRAFT_BRANCH,
      `${mode === 'create' ? 'Add' : 'Replace'} ${path.split('/').pop()} via admin${
        ctx.adminEmail ? ` (${ctx.adminEmail})` : ''
      }`,
      {
        mode,
        expectedSha: typeof expectedSha === 'string' ? expectedSha : undefined,
        authorName: 'CountingFive Admin',
        authorEmail: ctx.adminEmail ?? 'admin@countingfive.com',
      }
    )
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof AssetExistsError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    if (err instanceof FileNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof StaleShaError) {
      return NextResponse.json(
        { error: 'This image changed on the server. Reload to continue.', currentSha: err.currentSha },
        { status: 409 }
      )
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// DELETE ?path=...&sha=... — removes an asset from draft (media library only).
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx

  const url = new URL(req.url)
  const rawPath = url.searchParams.get('path')
  const sha = url.searchParams.get('sha')
  if (!rawPath || !sha) {
    return NextResponse.json({ error: 'path and sha query params required' }, { status: 400 })
  }
  const path = safeAssetPath(rawPath)
  if (!path) {
    return NextResponse.json({ error: 'path must be under public/content-assets/' }, { status: 400 })
  }

  try {
    await ensureDraftBranch(ctx.githubRepo)
    const result = await deleteFile(
      ctx.githubRepo,
      path,
      DRAFT_BRANCH,
      sha,
      `Delete ${path.split('/').pop()} via admin${ctx.adminEmail ? ` (${ctx.adminEmail})` : ''}`,
      { authorName: 'CountingFive Admin', authorEmail: ctx.adminEmail ?? 'admin@countingfive.com' }
    )
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof FileNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof StaleShaError) {
      return NextResponse.json(
        { error: 'This image changed on the server. Reload to continue.' },
        { status: 409 }
      )
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
