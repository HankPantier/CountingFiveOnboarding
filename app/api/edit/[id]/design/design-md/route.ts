import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { readJsonBody } from '@/app/api/_json'
import { createServerClient } from '@/lib/supabase/server'
import { DEFAULT_COMMIT_AUTHOR } from '@/lib/github/commit-identity'
import { DRAFT_BRANCH, FileNotFoundError, StaleShaError, readFile, writeFiles } from '@/lib/github/repo-files'
import { DESIGN_MD_PATH } from '@/lib/design/brief/brand'
import {
  directionFromVersionBundle,
  generateDesignMd,
  hashDesignMd,
  previewDesignMd,
  type DesignMdPreview,
} from '@/lib/design/design-md-adopt'
import { latestVersion, readSessionSchema } from '@/lib/design/store'
import { readDraftThemeSnapshot, themeTextsFromSnapshot } from '@/lib/design/theme-snapshot'
import { BRAND_PATH, DESIGN_PATH } from '../../theme/_theme'
import type { EditContext } from '../../_helpers'
import { requireDesignAdmin } from '../_design'

export const runtime = 'nodejs'
export const maxDuration = 30

type DesignMdPreviewResponse = DesignMdPreview & { path: string }
interface AdoptDesignMdBody {
  expectedSha?: unknown
  nextHash?: unknown
}
interface AdoptDesignMdResponse {
  ok: true
  commitSha: string
}

// The draft's design.md, or null. Not apply-bundle's readOptional: that module
// statically reaches lightningcss, which this light route must not load.
async function readDesignMd(repo: string): Promise<{ content: string; sha: string } | null> {
  try {
    const f = await readFile(repo, DESIGN_MD_PATH, DRAFT_BRANCH)
    return { content: f.content, sha: f.sha }
  } catch (err) {
    if (err instanceof FileNotFoundError) return null
    throw err
  }
}

const CHANGED_SINCE_PREVIEW = 'The draft changed since you reviewed it — review the new design.md and try again.'
const SHA_RE = /^[0-9a-f]{40}$/i
const HASH_RE = /^[0-9a-f]{64}$/i

type SourceGuard = { path: string; content: string; expectedSha: string }

// The generated design.md for the draft's CURRENT theme, plus the file it
// would replace and the brand.json + design.json it was built from (as
// unchanged-content guards for the commit).
async function build(
  ctx: EditContext
): Promise<{ ok: true; preview: DesignMdPreview; sources: SourceGuard[] } | { ok: false; status: 409; error: string }> {
  const db = createServerClient()
  const [snapshot, current, schema, latest] = await Promise.all([
    readDraftThemeSnapshot(ctx.githubRepo),
    readDesignMd(ctx.githubRepo),
    readSessionSchema(db, ctx.sessionId),
    latestVersion(db, ctx.sessionId),
  ])
  const draft = themeTextsFromSnapshot(snapshot)
  if (!draft.ok) return { ok: false, status: 409, error: draft.error }
  const direction = directionFromVersionBundle(latest?.source ?? null, latest?.bundle)
  const generated = generateDesignMd({ brandText: draft.files.brandText, designText: draft.files.designText, schema, ...(direction ? { direction } : {}) })
  if (!generated.ok) return { ok: false, status: 409, error: generated.error }
  const sources: SourceGuard[] = []
  for (const [path, content] of [
    [BRAND_PATH, draft.files.brandText],
    [DESIGN_PATH, draft.files.designText],
  ] as const) {
    const sha = snapshot.shas[path]
    if (!sha) return { ok: false, status: 409, error: 'The draft’s theme files could not be read — refresh and try again.' }
    sources.push({ path, content, expectedSha: sha })
  }
  return { ok: true, preview: previewDesignMd(current, generated.text), sources }
}

// "Regenerate design.md" (Design Studio → Versions). Admin-only.
//   GET  — what adopting the generated content/design.md would change: the
//          current file's state (absent / hand-written / legacy / edited /
//          untouched), a line diff, and the hash of the text to commit.
//   POST — { expectedSha, nextHash } commit exactly that text to the draft,
//          guarded by the current file's blob sha (null = must not exist).
//          Nothing ever calls this without the admin's click.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx
  try {
    const built = await build(ctx)
    if (!built.ok) return NextResponse.json({ error: built.error }, { status: built.status })
    const response: DesignMdPreviewResponse = { path: DESIGN_MD_PATH, ...built.preview }
    return NextResponse.json(response)
  } catch (err) {
    return internalError('design:design-md:preview', err, 'Failed to build design.md')
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx

  const body = await readJsonBody<AdoptDesignMdBody>(req)
  if (body instanceof NextResponse) return body
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const expectedSha = body.expectedSha
  if (!(expectedSha === null || (typeof expectedSha === 'string' && SHA_RE.test(expectedSha)))) {
    return NextResponse.json({ error: 'expectedSha must be the current design.md blob sha, or null when there is none.' }, { status: 400 })
  }
  if (typeof body.nextHash !== 'string' || !HASH_RE.test(body.nextHash)) {
    return NextResponse.json({ error: 'nextHash is required — review the generated design.md first.' }, { status: 400 })
  }

  try {
    const built = await build(ctx)
    if (!built.ok) return NextResponse.json({ error: built.error }, { status: built.status })
    const { preview } = built
    // The admin approved THIS text over THIS file: anything else is a re-review.
    if (hashDesignMd(preview.next) !== body.nextHash.toLowerCase() || preview.currentSha !== expectedSha) {
      return NextResponse.json({ error: CHANGED_SINCE_PREVIEW }, { status: 409 })
    }
    if (preview.unchanged) return NextResponse.json({ error: 'design.md already matches the generated file.' }, { status: 409 })

    // brand.json + design.json ride along UNCHANGED (same content ⇒ same
    // blob, so the tree doesn't change for them) purely as guards: a theme
    // edit landing after this build makes the commit a 409 instead of writing
    // notes that describe the previous theme.
    const written = await writeFiles(
      ctx.githubRepo,
      [{ path: DESIGN_MD_PATH, content: preview.next, expectedSha }, ...built.sources],
      DRAFT_BRANCH,
      `Regenerate design.md from the current theme via Design Studio${ctx.adminEmail ? ` (${ctx.adminEmail})` : ''}`,
      { authorName: ctx.adminName ?? DEFAULT_COMMIT_AUTHOR.name, authorEmail: ctx.adminEmail ?? DEFAULT_COMMIT_AUTHOR.email }
    )
    const response: AdoptDesignMdResponse = { ok: true, commitSha: written.commitSha }
    return NextResponse.json(response)
  } catch (err) {
    if (err instanceof StaleShaError) return NextResponse.json({ error: CHANGED_SINCE_PREVIEW }, { status: 409 })
    return internalError('design:design-md:adopt', err, 'Failed to regenerate design.md')
  }
}
