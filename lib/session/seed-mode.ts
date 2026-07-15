import type { SessionSchema } from '@/types/session-schema'

// Onboarding is rep-driven: every new session runs in staff mode so the agent
// addresses the Revaltus rep on the call, not the client. Returns a shallow
// copy with _meta.mode = 'staff', preserving any _meta the seed already carries
// (e.g. audit_context on an audit→session draft). Used by both session-creation
// routes so the mode is seeded in exactly one place.
export function withStaffMode(schema: SessionSchema): SessionSchema {
  // _meta's type marks several fields required that are optional in practice
  // (they're written lazily as the session progresses), so merge through a loose
  // record — same approach as the staff-mode route.
  const meta = { ...(schema._meta as Record<string, unknown> | undefined), mode: 'staff' as const }
  return { ...schema, _meta: meta as SessionSchema['_meta'] }
}
