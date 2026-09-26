import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { readJsonBody } from '@/app/api/_json'
import { createServerClient } from '@/lib/supabase/server'
import { parseChatRequest, previewPathsInParts, rowToChatMessage } from '@/lib/design/chat-history'
import { clearChatHistory, listChatMessages, versionScreenshotPathSet } from '@/lib/design/chat-store'
import type { DesignChatMessage, DesignChatRequestBody } from '@/lib/design/chat-types'
import { CHAT_ENGINE_UNAVAILABLE_ERROR } from '@/lib/design/chat-ui'
import { attachmentStoragePath, removeDesignPaths, signDesignPaths } from '@/lib/design/storage'
import { requireDesignAdmin } from '../_design'

export const runtime = 'nodejs'
// PF1: a turn plans within TURN_BUDGET_MS (540 s): ≤ 2 previews (each up to 4
// serialized 45 s renders when the baseline is uncached) + the commit reserve
// + the tool loop, with a 60 s margin for the last step, persistence and close.
export const maxDuration = 600

interface ChatHistoryResponse {
  messages: DesignChatMessage[]
}
interface ClearChatResponse {
  ok: true
  deleted: number
}

type Params = { params: Promise<{ id: string }> }

function safeAttachmentPath(sessionId: string, id: string): string | null {
  try {
    return attachmentStoragePath(sessionId, id)
  } catch {
    return null
  }
}

// PF6: only this session's chat preview renders are ever signed.
function isOwnChatPreviewPath(sessionId: string, p: string): boolean {
  return p.startsWith(`design/${sessionId}/renders/chat/`) && !p.includes('..')
}

// The Design Studio revision chat (P5). Admin-only.
//   GET    — the persisted history, attachment + preview images freshly signed.
//   POST   — one turn: { text, attachmentIds?, page? } → a UI message stream.
//            The heavy turn module (sanitizer + renderer) is lazy-loaded.
//   DELETE — clear the history, its sent attachments and its preview renders
//            — except renders a version still uses as its thumbnail.
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx
  try {
    const db = createServerClient()
    const rows = await listChatMessages(db, ctx.sessionId)
    const paths = rows.flatMap((r) => [
      ...r.attachment_ids.flatMap((a) => {
        const p = safeAttachmentPath(ctx.sessionId, a)
        return p ? [p] : []
      }),
      ...previewPathsInParts(r.parts).filter((p) => isOwnChatPreviewPath(ctx.sessionId, p)),
    ])
    let signed: Record<string, string> = {}
    if (paths.length > 0) {
      try {
        signed = await signDesignPaths(db, [...new Set(paths)])
      } catch (err) {
        console.warn('[design:chat] signing failed, loading the history without images:', err)
      }
    }
    const response: ChatHistoryResponse = {
      messages: rows.map((r) =>
        rowToChatMessage(r, {
          preview: (p) => (isOwnChatPreviewPath(ctx.sessionId, p) ? (signed[p] ?? null) : null),
          attachment: (a) => {
            const p = safeAttachmentPath(ctx.sessionId, a)
            return p ? (signed[p] ?? null) : null
          },
        })
      ),
    }
    return NextResponse.json(response)
  } catch (err) {
    return internalError('design:chat:history', err, 'Failed to load the chat')
  }
}

export async function POST(req: Request, { params }: Params) {
  const startedAt = Date.now()
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx

  const raw = await readJsonBody<DesignChatRequestBody>(req)
  if (raw instanceof NextResponse) return raw
  const parsed = parseChatRequest(raw)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  let runDesignChatTurn: (typeof import('@/lib/design/chat-turn'))['runDesignChatTurn']
  try {
    ;({ runDesignChatTurn } = await import('@/lib/design/chat-turn')) // lightningcss + chromium — lazy, traced
  } catch (err) {
    console.error('[design:chat] failed to load the chat engine', err)
    return NextResponse.json({ error: CHAT_ENGINE_UNAVAILABLE_ERROR }, { status: 503 })
  }

  try {
    return await runDesignChatTurn(
      createServerClient(),
      { sessionId: ctx.sessionId, jobId: ctx.jobId, githubRepo: ctx.githubRepo, adminId: ctx.adminId, adminEmail: ctx.adminEmail, adminName: ctx.adminName },
      parsed.request,
      startedAt
    )
  } catch (err) {
    return internalError('design:chat', err, 'Failed to start the chat turn')
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx
  try {
    const db = createServerClient()
    const rows = await clearChatHistory(db, ctx.sessionId)
    const attachmentPaths = rows.flatMap((r) =>
      r.attachment_ids.flatMap((a) => {
        const p = safeAttachmentPath(ctx.sessionId, a)
        return p ? [p] : []
      })
    )
    let previewPaths: string[] = []
    try {
      const keep = await versionScreenshotPathSet(db, ctx.sessionId)
      previewPaths = rows.flatMap((r) => previewPathsInParts(r.parts).filter((p) => isOwnChatPreviewPath(ctx.sessionId, p) && !keep.has(p)))
    } catch (err) {
      // Unknown which renders versions use — keep them all rather than guess.
      console.warn('[design:chat] version screenshot lookup failed; preview renders kept:', err)
    }
    const paths = [...new Set([...attachmentPaths, ...previewPaths])]
    if (paths.length > 0) {
      try {
        await removeDesignPaths(db, paths)
      } catch (err) {
        console.warn('[design:chat] attachment cleanup failed (history cleared):', err)
      }
    }
    const response: ClearChatResponse = { ok: true, deleted: rows.length }
    return NextResponse.json(response)
  } catch (err) {
    return internalError('design:chat:clear', err, 'Failed to clear the chat')
  }
}
