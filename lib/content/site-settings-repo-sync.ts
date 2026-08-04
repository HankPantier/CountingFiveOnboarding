// ---------------------------------------------------------------------------
// Site-settings ⇄ client repo sync. For published clients (github_repo set,
// phase ≥ 6) the booking config lives in the repo's site.config.ts — the
// template reads it at build time. So the admin editor seeds from that file
// when there's no DB row, and pushes edits to the draft branch on save.
// ---------------------------------------------------------------------------
import { createServerClient } from '@/lib/supabase/server'
import {
  DRAFT_BRANCH,
  MAIN_BRANCH,
  ensureDraftBranch,
  readSiteConfigBooking,
  patchSiteConfigBooking,
} from '@/lib/github/repo-files'
import {
  getSiteSettings,
  normalizeSiteSettings,
  DEFAULT_SITE_SETTINGS,
  type SiteSettings,
} from './site-settings'

type Actor = { name?: string | null; email?: string | null }
function authorOf(actor: Actor): { authorName: string; authorEmail: string } {
  return { authorName: actor.name ?? 'Revaltus Admin', authorEmail: actor.email ?? 'admin@revaltus.com' }
}

export type LoadedSiteSettings = SiteSettings & {
  exists: boolean
  githubRepo: string | null
  published: boolean
}

// DB row wins; otherwise seed from the repo site.config.ts (published client);
// else the default. Used by both the editor page and the GET route.
export async function loadSiteSettingsForSession(sessionId: string): Promise<LoadedSiteSettings> {
  const supabase = createServerClient()
  const { data: job } = await supabase
    .from('content_jobs')
    .select('github_repo, phase')
    .eq('session_id', sessionId)
    .maybeSingle()
  const githubRepo = job?.github_repo ?? null
  const published = !!githubRepo && (job?.phase ?? 0) >= 6

  const db = await getSiteSettings(sessionId)
  if (db.exists) return { ...db, githubRepo, published }

  if (githubRepo) {
    for (const branch of [DRAFT_BRANCH, MAIN_BRANCH]) {
      const fromRepo = await readSiteConfigBooking(githubRepo, branch).catch(() => null)
      if (fromRepo) {
        return {
          ...normalizeSiteSettings({ bookingProvider: fromRepo.provider, bookingUrl: fromRepo.url }),
          exists: false,
          githubRepo,
          published,
        }
      }
    }
  }
  return { ...DEFAULT_SITE_SETTINGS, exists: false, githubRepo, published }
}

// Push booking config to the repo draft branch so "Publish to live" deploys it.
// Non-throwing: a GitHub hiccup must never surface as a save failure.
export async function syncSiteSettingsToRepo(args: {
  githubRepo: string
  settings: SiteSettings
  actor: Actor
}): Promise<{ ok: boolean; error?: string }> {
  const { githubRepo, settings, actor } = args
  try {
    await ensureDraftBranch(githubRepo)
    await patchSiteConfigBooking(
      githubRepo,
      DRAFT_BRANCH,
      { provider: settings.bookingProvider, url: settings.bookingUrl },
      authorOf(actor)
    )
    return { ok: true }
  } catch (err) {
    console.error('[site-settings-sync] repo sync failed:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Repo sync failed' }
  }
}
