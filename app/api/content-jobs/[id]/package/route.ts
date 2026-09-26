import { after, NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { DEFAULT_COMMIT_AUTHOR } from '@/lib/github/commit-identity'
import { requireContentJobAccess } from '@/lib/auth/access'
import { createServerClient } from '@/lib/supabase/server'
import {
  assembleContentPackage,
  planDeliverablePush,
  previewRedeploy,
  pushAssembledDeliverable,
} from '@/lib/content/package-assembler'
import type { DeployPlan } from '@/lib/content/deploy-plan'

export const runtime = 'nodejs'
// Assembly (asset downloads + LLM brand doc + docx + ~45MB resumable upload) is
// what the response waits on. The git push of the full deliverable (hundreds of
// blobs) is decoupled into an after() background task, but it still shares this
// invocation's budget. The dominant cost on a large FRESH site — the sequential
// Pexels resolution — is now pre-resolved out-of-band by the one-click flow
// (via the repull route) so assemble skips it, but 600 gives the residual
// docx/zip/upload headroom on big sites. Mirror this value in vercel.json.
export const maxDuration = 600

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: _jobId } = await params
  const auth = await requireContentJobAccess(_jobId)
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  // Surface real failures. Without this, a thrown exception becomes a bodyless
  // 500 and the client can only show its generic "Failed to assemble package"
  // — undiagnosable. The real error is logged server-side ([package] in the
  // logs); the client gets a JSON body with a safe message. (A hard Vercel maxDuration timeout still can't be caught
  // here — that's addressed by bounding the assembler's I/O.)
  let result
  try {
    result = await assembleContentPackage(id, {
      name: DEFAULT_COMMIT_AUTHOR.name,
      email: auth.user.email ?? null,
    })
  } catch (err) {
    return internalError('package', err, 'Package assembly failed')
  }

  if (!result.ok) {
    const { ok: _ok, status, ...body } = result
    return NextResponse.json(body, { status })
  }

  // Decouple the push: the response returns as soon as the zip is uploaded, and
  // the (slow, rate-limit-prone) git push runs in the background. `deploy` holds
  // file Buffers and must never be JSON-serialized — strip it here and pass it
  // to after(). Its outcome shows up via the deploy-status endpoint, not this
  // response.
  const { ok: _ok, deploy, ...body } = result
  // Plan the push now (cheap GitHub reads) so the response can tell the
  // operator which draft files a re-deploy keeps instead of overwriting. A
  // planning hiccup is non-fatal: the background push plans for itself.
  let plan: DeployPlan | undefined
  if (deploy) {
    try {
      plan = await planDeliverablePush(deploy)
    } catch (err) {
      console.warn(`[package] Push planning failed for ${deploy.githubRepo}; the push will re-plan:`, err)
    }
    after(async () => {
      await pushAssembledDeliverable(deploy, plan)
    })
  }
  return NextResponse.json({
    success: true,
    ...body,
    pushScheduled: deploy !== null,
    firstDeploy: plan?.firstDeploy ?? null,
    preservedFiles: plan ? plan.skipped : null,
  })
}

// "Before" view for the Deliverables panel: has this site been deployed, and
// which draft files would a re-package keep as they are (site settings, pages
// edited or moved since the last package)?
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await requireContentJobAccess(id)
  if (auth instanceof NextResponse) return auth

  const supabase = createServerClient()
  const { data: job } = await supabase
    .from('content_jobs')
    .select('github_repo')
    .eq('id', id)
    .single()
  if (!job?.github_repo) {
    return NextResponse.json({ previouslyDeployed: false, preserved: [] })
  }
  try {
    return NextResponse.json(await previewRedeploy(job.github_repo))
  } catch (err) {
    return internalError('package-preview', err, 'Could not read the site repo')
  }
}
