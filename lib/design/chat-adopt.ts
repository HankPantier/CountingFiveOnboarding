// Server-only. The "Fix in chat" concept a Design Studio chat keeps in context
// across turns (design_chat_state, migration 081) until a turn commits a
// version, the admin clears it, or the chat is cleared.
//
// Every use re-validates it exactly like the per-message id always was: the
// concept must be a READY concept of THIS session (getConcept scopes by the
// gated session id) with a parseable bundle.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { parseDesignBundle, type DesignBundle } from './bundle'
import { getAdoptedConceptId, setAdoptedConceptId } from './chat-store'
import { getConcept } from './run-store'

type Db = SupabaseClient<Database>

export type AdoptedConcept = { id: string; bundle: DesignBundle }

/** The concept, when it is a ready concept of this session; else null. */
export async function loadAdoptableConcept(db: Db, sessionId: string, conceptId: string): Promise<AdoptedConcept | null> {
  const row = await getConcept(db, sessionId, conceptId)
  const parsed = row && row.status === 'ready' && row.bundle !== null ? parseDesignBundle(row.bundle) : null
  return parsed?.ok ? { id: conceptId, bundle: parsed.bundle } : null
}

/**
 * The chat's persisted concept, validated. One that is no longer adoptable
 * (its run was deleted or re-run, or it failed) is cleared and reads as none —
 * a follow-up turn never fails over a concept the admin didn't just pick.
 */
export async function readPersistedAdoption(db: Db, sessionId: string): Promise<AdoptedConcept | null> {
  const id = await getAdoptedConceptId(db, sessionId)
  if (!id) return null
  let concept: AdoptedConcept | null
  try {
    concept = await loadAdoptableConcept(db, sessionId, id)
  } catch (err) {
    // A read blip is not "gone": keep it stored, just skip it this time.
    console.warn('[design-chat] adopted concept could not be loaded:', err)
    return null
  }
  if (!concept) await setAdoptedConceptId(db, sessionId, null)
  return concept
}

/** What the chat UI shows for the persisted concept. */
export type ChatAdoptionDto = { conceptId: string; name: string }

export function toAdoptionDto(concept: AdoptedConcept | null): ChatAdoptionDto | null {
  return concept ? { conceptId: concept.id, name: concept.bundle.name } : null
}
