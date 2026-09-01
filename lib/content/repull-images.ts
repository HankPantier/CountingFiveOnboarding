// ---------------------------------------------------------------------------
// Whole-site image re-pull — re-resolves every hero/inline stock photo for a
// content job and commits any that aren't already in the repo to the draft
// branch. The recovery path for a site whose images failed to resolve at
// assembly (missing PEXELS_API_KEY, Pexels outage, rate-limit) and now renders
// "Image not found" on every page. Pushes to DRAFT only — the operator reviews
// and Publishes. Generalizes the per-page resolveAndPushImages() in
// new-page-generator.ts to loop over all of a job's completed pages.
// ---------------------------------------------------------------------------
import { createServerClient } from '@/lib/supabase/server'
import { DEFAULT_COMMIT_AUTHOR } from '@/lib/github/commit-identity'
import { deriveImageStyleSuffix } from './visual-style-derivation'
import { collectPageImageRefs, computeImageCoverage } from './image-coverage'
import { resolveStockPhotos } from './stock-photo-resolver'
import { makeProgressWriter, type ProgressWriter } from './task-progress'
import {
  DRAFT_BRANCH,
  ensureDraftBranch,
  listTree,
  pushEntriesToBranch,
} from '@/lib/github/repo-files'
import type { SessionSchema } from '@/types/session-schema'
import type { PaletteData } from '@/types/palette'

export type RepullResult =
  | { ok: false; status: 400 | 404; error: string }
  | {
      ok: true
      // Distinct image filenames referenced across all completed pages.
      expected: number
      // Stock photos newly resolved from Pexels this run.
      resolved: number
      // Files actually committed to the draft branch this run.
      pushed: number
      // Referenced filenames still absent from the repo after the push.
      stillMissing: string[]
    }

// Server-side image-coverage check against the DRAFT branch. The one-click
// Deliverables flow gates on coverage client-side, but a direct editor Publish
// bypassed it — this lets the publish route block a merge that would render
// "Image not found" live. Same refs + pure diff the assembler and re-pull use.
export async function getDraftImageCoverage(
  contentJobId: string
): Promise<{ ok: boolean; missing: string[] }> {
  const supabase = createServerClient()
  const { data: job } = await supabase
    .from('content_jobs')
    .select('github_repo')
    .eq('id', contentJobId)
    .single()
  if (!job?.github_repo) return { ok: true, missing: [] }

  const { data: pages } = await supabase
    .from('generated_pages')
    .select('page_url, hero_image, hero_image_query, content_markdown, generation_status')
    .eq('content_job_id', contentJobId)
  const completed = (pages ?? []).filter(
    p => p.generation_status === 'complete' && p.content_markdown
  )
  const imageRefs = collectPageImageRefs(completed)
  if (imageRefs.length === 0) return { ok: true, missing: [] }

  let repoAssets = new Set<string>()
  try {
    const tree = await listTree(job.github_repo, DRAFT_BRANCH, 'public/content-assets/')
    repoAssets = new Set(tree.filter(e => e.type === 'blob').map(e => e.path.split('/').pop() ?? ''))
  } catch {
    repoAssets = new Set()
  }
  const coverage = computeImageCoverage(imageRefs, repoAssets)
  return { ok: coverage.missing.length === 0, missing: coverage.missing }
}

export async function repullJobImages(
  contentJobId: string,
  actor: { name: string; email: string | null; id?: string | null },
  opts: { force?: boolean; taskId?: string } = {}
): Promise<RepullResult> {
  const supabase = createServerClient()

  const { data: job } = await supabase
    .from('content_jobs')
    .select('session_id, palette, github_repo')
    .eq('id', contentJobId)
    .single()
  if (!job) return { ok: false, status: 404, error: 'Content job not found' }
  if (!job.github_repo) {
    return { ok: false, status: 400, error: 'No GitHub repo linked — publish the site before re-pulling images.' }
  }

  const { data: session } = await supabase
    .from('sessions')
    .select('schema_data')
    .eq('id', job.session_id)
    .single()
  if (!session) return { ok: false, status: 404, error: 'Session not found' }

  // Progress row (optional) — keyed by the client-generated taskId so a polling
  // client sees ticks while this request runs. Only created once we have a
  // session to scope it to; best-effort throughout.
  const progress: ProgressWriter | null = opts.taskId
    ? makeProgressWriter(supabase, opts.taskId, {
        kind: 'repull-images',
        sessionId: job.session_id,
        contentJobId,
        createdBy: actor.id ?? null,
      })
    : null
  await progress?.start('Scanning pages')

  const schema = (session.schema_data ?? {}) as SessionSchema
  const palette = (job.palette ?? null) as PaletteData | null

  const { data: pages } = await supabase
    .from('generated_pages')
    .select('page_url, hero_image, hero_image_query, content_markdown, generation_status')
    .eq('content_job_id', contentJobId)

  const completed = (pages ?? []).filter(
    p => p.generation_status === 'complete' && p.content_markdown
  )

  // Flat list of every image reference across all completed pages (hero +
  // inline), the same collection the assembler uses.
  const imageRefs = collectPageImageRefs(completed)
  const referenced = new Set(imageRefs.map(r => r.filename))
  if (referenced.size === 0) {
    await progress?.finish('No images referenced on any page.')
    return { ok: true, expected: 0, resolved: 0, pushed: 0, stillMissing: [] }
  }

  // What's already committed to the draft branch under public/content-assets/.
  let repoAssets = new Set<string>()
  try {
    const tree = await listTree(job.github_repo, DRAFT_BRANCH, 'public/content-assets/')
    repoAssets = new Set(tree.filter(e => e.type === 'blob').map(e => e.path.split('/').pop() ?? ''))
  } catch {
    repoAssets = new Set()
  }

  // Force mode: for referenced files missing from the repo that DO have an
  // asset row (a prior run resolved the row but never committed the file),
  // resolveStockPhotos would short-circuit on the existing row and never
  // re-pull. Delete those stale rows + storage objects so resolution runs fresh.
  if (opts.force) {
    const { data: staleAssets } = await supabase
      .from('assets')
      .select('id, file_name, storage_path')
      .eq('session_id', job.session_id)
      .eq('asset_category', 'stock-photo')
    const stale = (staleAssets ?? []).filter(a => referenced.has(a.file_name) && !repoAssets.has(a.file_name))
    if (stale.length > 0) {
      await supabase.storage.from('session-assets').remove(stale.map(a => a.storage_path))
      await supabase.from('assets').delete().in('id', stale.map(a => a.id))
    }
  }

  const { data: existingAssets } = await supabase
    .from('assets')
    .select('*')
    .eq('session_id', job.session_id)

  try {
    const resolved = await resolveStockPhotos(
      {
        sessionId: job.session_id,
        apiKey: process.env.PEXELS_API_KEY ?? '',
        styleSuffix: deriveImageStyleSuffix(palette, schema.brand),
        existingAssets: existingAssets ?? [],
        imageRefs,
        onProgress: progress ? (p) => progress.tick(p) : undefined,
      },
      supabase
    )

    // Re-query so newly-inserted stock-photo rows are visible, then push the
    // referenced files that aren't already committed to the repo.
    const { data: assetRows } = await supabase
      .from('assets')
      .select('file_name, storage_path')
      .eq('session_id', job.session_id)

    const toPush = (assetRows ?? []).filter(a => referenced.has(a.file_name) && !repoAssets.has(a.file_name))
    // Download in bounded-concurrency batches rather than strictly one-at-a-time
    // — the package assembler uses the same guard (a prior unbounded Promise.all
    // exhausted the Supabase connection pool; a serial loop blew the maxDuration
    // budget on large sites). 8 balances throughput against pool pressure.
    const DOWNLOAD_CONCURRENCY = 8
    const entries: { path: string; content: Buffer }[] = []
    for (let i = 0; i < toPush.length; i += DOWNLOAD_CONCURRENCY) {
      const batch = toPush.slice(i, i + DOWNLOAD_CONCURRENCY)
      const downloaded = await Promise.all(
        batch.map(async (asset) => {
          const { data, error } = await supabase.storage.from('session-assets').download(asset.storage_path)
          if (error || !data) {
            console.warn(`[repull] Failed to download asset ${asset.storage_path}: ${error?.message}`)
            return null
          }
          return { path: `public/content-assets/${asset.file_name}`, content: Buffer.from(await data.arrayBuffer()) }
        })
      )
      entries.push(...downloaded.filter((e): e is NonNullable<typeof e> => e !== null))
    }

    if (entries.length > 0) {
      await progress?.tick({ phase: 'Committing to draft', current: 0, total: 0 })
      const author = { authorName: actor.name, authorEmail: actor.email ?? DEFAULT_COMMIT_AUTHOR.email }
      await ensureDraftBranch(job.github_repo)
      await pushEntriesToBranch(
        job.github_repo,
        DRAFT_BRANCH,
        entries,
        `Re-pull ${entries.length} image(s) via admin`,
        author
      )
    }

    const committedNow = new Set<string>([
      ...repoAssets,
      ...entries.map(e => e.path.split('/').pop() ?? ''),
    ])
    const stillMissing = Array.from(referenced).filter(f => !committedNow.has(f))
    if (stillMissing.length > 0) {
      console.error(`[repull] ${stillMissing.length} image(s) still unresolved after re-pull: ${stillMissing.join(', ')}`)
    }

    await progress?.finish(
      entries.length > 0
        ? `Pushed ${entries.length} image(s) to draft${stillMissing.length ? ` · ${stillMissing.length} still missing` : ''}.`
        : stillMissing.length
          ? `No images resolved · ${stillMissing.length} still missing.`
          : 'All images already present.'
    )

    return { ok: true, expected: referenced.size, resolved: resolved.length, pushed: entries.length, stillMissing }
  } catch (err) {
    await progress?.error(err instanceof Error ? err.message : 'Image re-pull failed')
    throw err
  }
}
