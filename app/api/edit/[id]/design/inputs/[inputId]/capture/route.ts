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
    const row = await claimCapture(supabase, ctx.sessionId, inputId)
    if (!row) return NextResponse.json({ error: 'A capture is already running for this input.' }, { status: 409 })
    claimed = row
  } catch (err) {
    return internalError('design:inputs:capture', err, 'Failed to start the capture')
  }

  let storedPath: string | null = null
  try {
    const shot = await captureExternalScreenshot(claimed.url ?? '')
    if (!shot.ok) {
      // shot.reason is our own message from capture/external.ts — never provider text.
      const row = await updateInput(supabase, ctx.sessionId, inputId, { captureStatus: 'error', captureError: shot.reason })
      if (!row) return NextResponse.json({ error: 'Input not found.' }, { status: 404 })
      return NextResponse.json({ input: toInputDto(row, await signedFor(supabase, row)) })
    }

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

    const previous = claimed.storage_path
    if (previous && previous !== path) {
      await removeDesignPaths(supabase, [previous]).catch((e) => console.warn('[design-capture] old capture cleanup failed:', e))
    }
    return NextResponse.json({ input: toInputDto(row, await signedFor(supabase, row)) })
  } catch (err) {
    if (storedPath) {
      await removeDesignPaths(supabase, [storedPath]).catch((e) => console.warn('[design-capture] cleanup failed:', e))
    }
    await updateInput(supabase, ctx.sessionId, inputId, { captureStatus: 'error', captureError: GENERIC_CAPTURE_ERROR }).catch(() => null)
    return internalError('design:inputs:capture', err, 'Failed to capture the screenshot')
  }
}
