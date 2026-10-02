import { createHash, randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { DEFAULT_COMMIT_AUTHOR } from '@/lib/github/commit-identity'
import { resolveEditContext } from '../../_helpers'
import { safeAssetPath } from '../../_path'
import { createServerClient } from '@/lib/supabase/server'
import {
  AssetExistsError,
  DRAFT_BRANCH,
  FileNotFoundError,
  StaleShaError,
  ensureDraftBranch,
  readFile,
  writeBinaryFileWithCompanions,
  writeFiles,
} from '@/lib/github/repo-files'
import { validateLogoUpload } from '@/lib/assets/logo-upload'
import { replaceSessionLogoRow } from '@/lib/assets/replace-session-logo'
import { LIGHT_LOGO_NOTE, preflightLogo } from '@/lib/content/logo-preflight'
import { patchBrandLogo, type LogoPatch } from '@/lib/editor/theme-edit'
import type { BrandJson } from '@/types/brand-json'
import { BRAND_PATH } from '../_theme'

export const runtime = 'nodejs'
export const maxDuration = 60

type Slot = 'primary' | 'footer'

const BLOB_SHA_RE = /^[0-9a-f]{40}$/i

export interface LogoUploadResponse {
  ok: true
  path: string
  notices: string[]
  warning?: string
}

function staleResponse() {
  return NextResponse.json(
    { error: 'The theme changed in another window. Reload the Theme Studio and try again.', stale: true },
    { status: 409 }
  )
}

async function readBrand(githubRepo: string): Promise<{ content: string; sha: string } | null> {
  try {
    return await readFile(githubRepo, BRAND_PATH, DRAFT_BRANCH)
  } catch (err) {
    if (err instanceof FileNotFoundError) return null
    throw err
  }
}

// POST multipart { file, slot: 'primary'|'footer', brandSha } — Theme Studio
// logo upload. Commits the new image under a content-hashed name plus
// brand.json pointing at it (one guarded commit on draft). A primary upload
// also replaces the session's onboarding `logo` asset so the palette step,
// re-packaging and the Divi export use the same file. Admin-only, like the
// rest of the Theme Studio.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.user.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { githubRepo, sessionId, adminEmail, adminName } = ctx

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  const slot = form?.get('slot')
  const brandSha = form?.get('brandSha')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 })
  if (slot !== 'primary' && slot !== 'footer') {
    return NextResponse.json({ error: "slot must be 'primary' or 'footer'" }, { status: 400 })
  }
  if (typeof brandSha !== 'string' || !BLOB_SHA_RE.test(brandSha)) {
    return NextResponse.json({ error: 'brandSha is required' }, { status: 400 })
  }

  const checked = await validateLogoUpload(Buffer.from(await file.arrayBuffer()))
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: checked.status })
  const { logo } = checked

  // Trim transparent padding (rasters) and read the tone, as packaging does.
  const pre = await preflightLogo(logo.buffer, `logo.${logo.ext}`)
  const bytes = pre.buffer
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 10)
  const fileName = `${slot === 'primary' ? 'logo' : 'logo-footer'}-${hash}.${logo.ext}`
  const path = safeAssetPath(`public/content-assets/${fileName}`)
  if (!path) return NextResponse.json({ error: 'Invalid logo path' }, { status: 400 })

  try {
    await ensureDraftBranch(githubRepo)
    const brandFile = await readBrand(githubRepo)
    if (!brandFile) {
      return NextResponse.json(
        { error: 'This site has no brand.json yet — the logo can’t be changed here.' },
        { status: 409 }
      )
    }
    if (brandFile.sha !== brandSha) return staleResponse()

    const patch: LogoPatch = slot === 'primary' ? { primary: fileName } : { footer: fileName }
    const notices: string[] = []
    if (slot === 'primary' && pre.toneConclusive) {
      const currentTone = (JSON.parse(brandFile.content) as BrandJson).logo?.tone
      // An explicit "dark" is the operator's choice; only a conclusively light
      // logo overrides it (same rule as the media-library retone).
      if (pre.lightLogo) patch.tone = 'light'
      else if (currentTone === 'light') patch.tone = null
    }
    if (slot === 'primary' && pre.lightLogo) notices.push(LIGHT_LOGO_NOTE)
    if (pre.trimmed) notices.push(`Trimmed transparent padding (${pre.trimmed.from} → ${pre.trimmed.to} px).`)
    if (pre.plate) {
      notices.push(`The logo has an opaque ${pre.plate.hex} background box — ask the client for a transparent PNG or an SVG.`)
    }

    const patched = patchBrandLogo(brandFile.content, patch)
    if (!patched.ok) return NextResponse.json({ error: patched.reason }, { status: 422 })

    const author = {
      authorName: adminName ?? DEFAULT_COMMIT_AUTHOR.name,
      authorEmail: adminEmail ?? DEFAULT_COMMIT_AUTHOR.email,
    }
    const message = `Theme: ${slot === 'primary' ? 'logo' : 'footer logo'} → ${fileName} (${adminEmail ?? 'admin'})`
    try {
      await writeBinaryFileWithCompanions(githubRepo, path, bytes, DRAFT_BRANCH, message, {
        mode: 'create',
        ...author,
        companions: [{ path: BRAND_PATH, content: patched.next, expectedSha: brandSha }],
      })
    } catch (err) {
      // The same bytes are already on draft (content-hashed name): only
      // brand.json needs to point at them.
      if (!(err instanceof AssetExistsError)) throw err
      if (patched.changed) {
        await writeFiles(githubRepo, [{ path: BRAND_PATH, content: patched.next, expectedSha: brandSha }], DRAFT_BRANCH, message, author)
      }
    }

    let warning: string | undefined
    if (slot === 'primary') {
      warning = await syncSessionLogo(sessionId, fileName, logo.mime, bytes)
    }
    const body: LogoUploadResponse = { ok: true, path, notices, ...(warning ? { warning } : {}) }
    return NextResponse.json(body)
  } catch (err) {
    if (err instanceof StaleShaError) return staleResponse()
    return internalError('theme:logo:post', err, 'Failed to save the logo')
  }
}

// Best-effort: the site already has the new logo; a failure here only leaves
// the onboarding copy behind, so it is reported, not fatal.
async function syncSessionLogo(sessionId: string, fileName: string, mime: string, bytes: Buffer): Promise<string | undefined> {
  const failed = 'The site logo was updated, but the onboarding copy (used by the Divi export and palette step) was not — upload it again to retry.'
  try {
    const supabase = createServerClient()
    const storagePath = `sessions/${sessionId}/${randomUUID()}-${fileName}`
    const { error: upErr } = await supabase.storage
      .from('session-assets')
      .upload(storagePath, bytes, { contentType: mime, upsert: false })
    if (upErr) {
      console.warn('[theme:logo] session-assets upload failed:', upErr)
      return failed
    }
    const replaced = await replaceSessionLogoRow(supabase, sessionId, { storagePath, fileName, mime, size: bytes.length })
    if (!replaced.ok) {
      console.warn('[theme:logo] logo asset row replace failed:', replaced.error)
      await supabase.storage.from('session-assets').remove([storagePath])
      return failed
    }
    return undefined
  } catch (err) {
    console.warn('[theme:logo] onboarding logo sync failed:', err)
    return failed
  }
}

// DELETE ?slot=footer&brandSha=… — drop brand.json logo.footer so the footer
// falls back to the (inverted) primary logo. The image file stays on draft.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await resolveEditContext(id)
  if (ctx instanceof NextResponse) return ctx
  if (!ctx.user.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { githubRepo, adminEmail, adminName } = ctx

  const url = new URL(req.url)
  const slot = url.searchParams.get('slot') as Slot | null
  const brandSha = url.searchParams.get('brandSha')
  if (slot !== 'footer') return NextResponse.json({ error: "Only the footer logo can be removed" }, { status: 400 })
  if (!brandSha || !BLOB_SHA_RE.test(brandSha)) return NextResponse.json({ error: 'brandSha is required' }, { status: 400 })

  try {
    await ensureDraftBranch(githubRepo)
    const brandFile = await readBrand(githubRepo)
    if (!brandFile) return NextResponse.json({ error: 'This site has no brand.json yet.' }, { status: 409 })
    if (brandFile.sha !== brandSha) return staleResponse()
    const patched = patchBrandLogo(brandFile.content, { footer: null })
    if (!patched.ok) return NextResponse.json({ error: patched.reason }, { status: 422 })
    if (patched.changed) {
      await writeFiles(
        githubRepo,
        [{ path: BRAND_PATH, content: patched.next, expectedSha: brandSha }],
        DRAFT_BRANCH,
        `Theme: remove footer logo (${adminEmail ?? 'admin'})`,
        { authorName: adminName ?? DEFAULT_COMMIT_AUTHOR.name, authorEmail: adminEmail ?? DEFAULT_COMMIT_AUTHOR.email }
      )
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof StaleShaError) return staleResponse()
    return internalError('theme:logo:delete', err, 'Failed to remove the footer logo')
  }
}
