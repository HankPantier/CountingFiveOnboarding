import { after, NextResponse } from 'next/server'
import { requireContentJobAccess } from '@/lib/auth/access'
import { assembleContentPackage, pushAssembledDeliverable } from '@/lib/content/package-assembler'

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
  // — undiagnosable. This route is admin-gated, so returning the message is
  // safe and expected. (A hard Vercel maxDuration timeout still can't be caught
  // here — that's addressed by bounding the assembler's I/O.)
  let result
  try {
    result = await assembleContentPackage(id, {
      name: 'CountingFive Admin',
      email: auth.user.email ?? null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Package assembly failed'
    console.error('[package] Unhandled assembly error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
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
  if (deploy) {
    after(async () => {
      await pushAssembledDeliverable(deploy)
    })
  }
  return NextResponse.json({ success: true, ...body, pushScheduled: deploy !== null })
}
