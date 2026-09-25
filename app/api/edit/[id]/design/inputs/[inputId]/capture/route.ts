import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { createServerClient } from '@/lib/supabase/server'
import { captureExternalScreenshot } from '@/lib/design/capture/external'
import { claimCapture, getInput, updateInput, type DesignInputRow } from '@/lib/design/store'
import { designStoragePath, removeDesignPaths, signDesignPaths, storeDesignImage } from '@/lib/design/storage'
import { isUuid } from '@/lib/design/input-validation'
import { toInputDto } from '@/lib/design/studio-dto'
import { requireDesignAdmin } from '../../../_design'

export const runtime = 'nodejs'
// ScrapingBee: up to two 45 s attempts, plus sharp + storage.
export const maxDuration = 120

const GENERIC_CAPTURE_ERROR = 'Capture failed. Try again.'

async function signedFor(supabase: ReturnType<typeof createServerClient>, row: DesignInputRow): Promise<Record<string, string>> {
  return row.storage_path ? signDesignPaths(supabase, [row.storage_path]) : {}
}

// POST — (re-)capture a URL input's screenshot through ScrapingBee (never our
// own browser; SSRF-checked inside captureExternalScreenshot). The row is
// claimed atomically ('pending'); every exit leaves it 'ok' or 'error' — the
// sweep cron errors anything still pending after 10 minutes.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; inputId: string }> }) {
  const { id, inputId } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx
  if (!isUuid(inputId)) return NextResponse.json({ error: 'Invalid input id.' }, { status: 400 })

  const supabase = createServerClient()
  let claimed: DesignInputRow
  try {
    const input = await getInput(supabase, ctx.sessionId, inputId)
    if (!input) return NextResponse.json({ error: 'Input not found.' }, { status: 404 })
    if (input.kind === 'inspiration_image' || !input.url) {
      return NextResponse.json({ error: 'Uploaded images don’t need capturing.' }, { status: 400 })
    }
    if (input.archived) {
      return NextResponse.json({ error: 'Unarchive this input before capturing it.' }, { status: 409 })
    }
    const row = await claimCapture(supabase, ctx.sessionId, inputId)
    if (!row) return NextResponse.json({ error: 'A capture is already running for this input.' }, { status: 409 })
    claimed = row
  } catch (err) {
    return internalError('design:inputs:capture', err, 'Failed to start the capture')
  }

  // From here, `storedPath` tracks a new object that can still be rolled
  // back if something fails BEFORE the row is committed to point at it. Once
  // the commit succeeds we clear it — nothing past that point (including a
  // signing failure below) may delete the new object or reset the row.
  let storedPath: string | null = null
  let resultRow: DesignInputRow
  try {
    const shot = await captureExternalScreenshot(claimed.url ?? '')
    if (!shot.ok) {
      // shot.reason is our own message from capture/external.ts — never provider text.
      const row = await updateInput(supabase, ctx.sessionId, inputId, { captureStatus: 'error', captureError: shot.reason })
      if (!row) return NextResponse.json({ error: 'Input not found.' }, { status: 404 })
      resultRow = row
    } else {
      const path = designStoragePath(ctx.sessionId, 'inputs', `${inputId}-${randomUUID()}.webp`)
      await storeDesignImage(supabase, path, shot.webp)
      storedPath = path

      const row = await updateInput(supabase, ctx.sessionId, inputId, {
        captureStatus: 'ok',
        captureError: null,
        storagePath: path,
        capturedAt: new Date().toISOString(),
      })
      if (!row) {
        // Deleted while we were capturing — drop the orphaned object.
        await removeDesignPaths(supabase, [path]).catch((e) => console.warn('[design-capture] orphan cleanup failed:', e))
        return NextResponse.json({ error: 'Input not found.' }, { status: 404 })
      }

      // Commit point: the row now points at `path`. This capture is no
      // longer eligible for rollback.
      storedPath = null

      const previous = claimed.storage_path
      if (previous && previous !== path) {
        await removeDesignPaths(supabase, [previous]).catch((e) => console.warn('[design-capture] old capture cleanup failed:', e))
      }
      resultRow = row
    }
  } catch (err) {
    if (storedPath) {
      await removeDesignPaths(supabase, [storedPath]).catch((e) => console.warn('[design-capture] cleanup failed:', e))
    }
    try {
      await updateInput(supabase, ctx.sessionId, inputId, { captureStatus: 'error', captureError: GENERIC_CAPTURE_ERROR })
    } catch (resetErr) {
      console.warn('[design-capture] failed to reset row to error after a capture failure:', resetErr)
    }
    return internalError('design:inputs:capture', err, 'Failed to capture the screenshot')
  }

  // Signing is best-effort and deliberately outside the rollback above: a
  // signing failure must not undo an already-committed row — it only means
  // the client gets a null thumbnail for now (the next GET will retry it).
  try {
    return NextResponse.json({ input: toInputDto(resultRow, await signedFor(supabase, resultRow)) })
  } catch (err) {
    console.warn('[design-capture] signing failed after capture:', err)
    return NextResponse.json({ input: toInputDto(resultRow, {}) })
  }
}
