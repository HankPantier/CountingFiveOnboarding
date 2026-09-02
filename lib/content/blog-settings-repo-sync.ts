// ---------------------------------------------------------------------------
// Blog-landing settings ⇄ client repo sync. The blog section's name + path live
// in the repo's content/blog.json (read at build time by the client-site
// template). This is repo-only — there's no DB mirror — so the editor seeds
// from the repo file and pushes edits to the draft branch on save, the same
// shape as site-settings-repo-sync.ts but without a DB row.
// ---------------------------------------------------------------------------
import { createServerClient } from '@/lib/supabase/server'
import {
  DRAFT_BRANCH,
  MAIN_BRANCH,
  ensureDraftBranch,
  readFile,
  writeFile,
  FileNotFoundError,
} from '@/lib/github/repo-files'
import {
  DEFAULT_BLOG_CONFIG,
  resolveBlogConfig,
  serializeBlogConfig,
  type BlogConfig,
} from './blog-config'

type Actor = { name?: string | null; email?: string | null }
function authorOf(actor: Actor): { authorName: string; authorEmail: string } {
  return { authorName: actor.name ?? 'Revaltus Admin', authorEmail: actor.email ?? 'admin@revaltus.com' }
}

export type LoadedBlogSettings = BlogConfig & {
  githubRepo: string | null
  published: boolean
}

// Read content/blog.json from the repo (draft wins over main); fall back to the
// Resources defaults when there's no repo or no file yet.
export async function loadBlogSettingsForSession(sessionId: string): Promise<LoadedBlogSettings> {
  const supabase = createServerClient()
  const { data: job } = await supabase
    .from('content_jobs')
    .select('github_repo, phase')
    .eq('session_id', sessionId)
    .maybeSingle()
  const githubRepo = job?.github_repo ?? null
  const published = !!githubRepo && (job?.phase ?? 0) >= 6

  if (githubRepo) {
    for (const branch of [DRAFT_BRANCH, MAIN_BRANCH]) {
      try {
        const blob = await readFile(githubRepo, 'content/blog.json', branch)
        return { ...resolveBlogConfig(JSON.parse(blob.content)), githubRepo, published }
      } catch (err) {
        if (err instanceof FileNotFoundError) continue
        // Malformed JSON or a transient read error — fall through to defaults
        // rather than 500 the settings page.
        console.warn('[blog-settings] blog.json read/parse failed:', err)
        break
      }
    }
  }
  return { ...DEFAULT_BLOG_CONFIG, githubRepo, published }
}

// Push blog config to the repo draft branch so "Publish to live" deploys it.
// Non-throwing: a GitHub hiccup must never surface as a save failure.
export async function syncBlogConfigToRepo(args: {
  githubRepo: string
  config: BlogConfig
  actor: Actor
}): Promise<{ ok: boolean; error?: string }> {
  const { githubRepo, config, actor } = args
  const { authorName, authorEmail } = authorOf(actor)
  try {
    await ensureDraftBranch(githubRepo)
    let expectedSha: string | undefined
    try {
      const existing = await readFile(githubRepo, 'content/blog.json', DRAFT_BRANCH)
      expectedSha = existing.sha
    } catch (err) {
      if (!(err instanceof FileNotFoundError)) throw err
    }
    await writeFile(
      githubRepo,
      'content/blog.json',
      serializeBlogConfig(config),
      DRAFT_BRANCH,
      'Update blog landing config',
      { expectedSha, authorName, authorEmail }
    )
    return { ok: true }
  } catch (err) {
    console.error('[blog-settings] repo sync failed:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Repo sync failed' }
  }
}
