// Server-only. The session's latest run as a DTO with signed screenshots.
// Signing is best-effort (thumbnails just go missing), DB errors throw.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { latestRun, listConcepts } from './run-store'
import { signDesignPaths } from './storage'
import { runScreenshotPaths, toRunDto } from './run-dto'
import type { DesignRunDto } from './run-types'

export async function loadLatestRunDto(db: SupabaseClient<Database>, sessionId: string): Promise<DesignRunDto | null> {
  const run = await latestRun(db, sessionId)
  if (!run) return null
  const concepts = await listConcepts(db, run.id)
  let signed: Record<string, string> = {}
  try {
    signed = await signDesignPaths(db, runScreenshotPaths(run, concepts))
  } catch (err) {
    console.warn('[design:runs] signing run screenshots failed, continuing without them:', err)
  }
  return toRunDto(run, concepts, signed)
}
