import { NextResponse } from 'next/server'
import { internalError } from '@/lib/api/errors'
import { createServerClient } from '@/lib/supabase/server'
import { isAttachmentReferenced } from '@/lib/design/chat-store'
import { isUuid } from '@/lib/design/input-validation'
import { attachmentStoragePath, removeDesignPaths } from '@/lib/design/storage'
import { requireDesignAdmin } from '../../_design'

export const runtime = 'nodejs'
export const maxDuration = 30

// DELETE — remove an attachment the admin attached but has not sent yet (the
// composer's ✕). A sent attachment is part of the chat history and stays.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  const { id, attachmentId } = await params
  const ctx = await requireDesignAdmin(id)
  if (ctx instanceof NextResponse) return ctx
  if (!isUuid(attachmentId)) return NextResponse.json({ error: 'Invalid attachment id' }, { status: 400 })
  const aid = attachmentId.toLowerCase()

  try {
    const db = createServerClient()
    if (await isAttachmentReferenced(db, ctx.sessionId, aid)) {
      return NextResponse.json({ error: 'This image is part of a sent message and can’t be removed.' }, { status: 409 })
    }
    await removeDesignPaths(db, [attachmentStoragePath(ctx.sessionId, aid)])
    return NextResponse.json({ ok: true })
  } catch (err) {
    return internalError('design:attachments:delete', err, 'Failed to remove the image')
  }
}
