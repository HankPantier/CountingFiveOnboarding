// ---------------------------------------------------------------------------
// Pricing-plans ⇄ client repo sync.
//
// For already-published clients (github_repo set, phase ≥ 6) the live plans
// config lives as content/pricing-plans.json in the repo — the site reads it at
// build time. So the admin config editor must (a) SEED from that file when
// there's no DB row yet, and (b) PUSH edits back to the draft branch on save, so
// "Publish to live" in the content editor deploys them. Onboarding (pre-publish)
// sessions keep using the DB row + package-time emission.
// ---------------------------------------------------------------------------
import { createServerClient } from '@/lib/supabase/server'
import {
  DRAFT_BRANCH,
  MAIN_BRANCH,
  FileNotFoundError,
  StaleShaError,
  ensureDraftBranch,
  readFile,
  writeFile,
  deleteFile,
} from '@/lib/github/repo-files'
import { parseNavJson, serializeNavJson } from '@/lib/editor/nav-config'
import {
  normalizePricingPlansConfig,
  getPricingPlans,
  type PricingPlansRecord,
} from './pricing-plans-config'
import {
  buildPricingPlansPageMd,
  PRICING_PLANS_JSON_PATH,
  PRICING_PLANS_PAGE_PATH,
  PRICING_PLANS_URL,
  PRICING_PLANS_NAV_LABEL,
} from './pricing-plans-json-builder'
import { buildPlansConfigFromAudit } from './pricing-from-audit'
import { DEFAULT_PLANS_CONFIG, type PricingPlansConfig } from '@/types/pricing-plans'
import type { SessionSchema } from '@/types/session-schema'

const NAV_PATH = 'content/nav.json'

type Actor = { name?: string | null; email?: string | null }
type Author = { authorName: string; authorEmail: string }
function authorOf(actor: Actor): Author {
  return { authorName: actor.name ?? 'Revaltus Admin', authorEmail: actor.email ?? 'admin@revaltus.com' }
}

// Read the live plans config from the repo (draft branch preferred, then main).
export async function readPricingPlansFromRepo(
  githubRepo: string
): Promise<PricingPlansConfig | null> {
  for (const branch of [DRAFT_BRANCH, MAIN_BRANCH]) {
    try {
      const file = await readFile(githubRepo, PRICING_PLANS_JSON_PATH, branch)
      return normalizePricingPlansConfig(JSON.parse(file.content))
    } catch (err) {
      if (err instanceof FileNotFoundError) continue
      // Parse error / other — treat as absent on this branch and try the next.
    }
  }
  return null
}

export type LoadedPricingPlans = PricingPlansRecord & {
  githubRepo: string | null
  published: boolean
}

// Loader used by both the config editor page and the GET route. DB row wins;
// otherwise seed from the repo (already-published, hand-authored); else default.
export async function loadPricingPlansForSession(
  sessionId: string
): Promise<LoadedPricingPlans> {
  const supabase = createServerClient()
  const { data: job } = await supabase
    .from('content_jobs')
    .select('github_repo, phase')
    .eq('session_id', sessionId)
    .maybeSingle()
  const githubRepo = job?.github_repo ?? null
  const published = !!githubRepo && (job?.phase ?? 0) >= 6

  const db = await getPricingPlans(sessionId)
  if (db.exists) return { ...db, githubRepo, published }

  if (githubRepo) {
    const fromRepo = await readPricingPlansFromRepo(githubRepo)
    if (fromRepo) return { config: fromRepo, enabled: true, exists: false, githubRepo, published }
  }

  // No saved row and no repo file — open the editor pre-populated with the base
  // built from pricing the audit captured on the client's current site (the
  // operator can still override/edit); fall back to the generic default.
  const { data: session } = await supabase
    .from('sessions')
    .select('schema_data')
    .eq('id', sessionId)
    .maybeSingle()
  const auditBase = session?.schema_data
    ? buildPlansConfigFromAudit(session.schema_data as SessionSchema)
    : null
  return { config: auditBase ?? DEFAULT_PLANS_CONFIG, enabled: true, exists: false, githubRepo, published }
}

// Overwrite (or create) a file on the draft branch, resolving the current sha.
async function upsertFile(repo: string, path: string, content: string, message: string, author: Author): Promise<void> {
  let expectedSha: string | undefined
  try {
    expectedSha = (await readFile(repo, path, DRAFT_BRANCH)).sha
  } catch (err) {
    if (!(err instanceof FileNotFoundError)) throw err
  }
  try {
    await writeFile(repo, path, content, DRAFT_BRANCH, message, { expectedSha, ...author })
  } catch (err) {
    if (err instanceof StaleShaError) {
      const cur = (await readFile(repo, path, DRAFT_BRANCH)).sha
      await writeFile(repo, path, content, DRAFT_BRANCH, message, { expectedSha: cur, ...author })
    } else throw err
  }
}

async function removeIfExists(repo: string, path: string, message: string, author: Author): Promise<void> {
  try {
    const f = await readFile(repo, path, DRAFT_BRANCH)
    await deleteFile(repo, path, DRAFT_BRANCH, f.sha, message, author)
  } catch (err) {
    if (!(err instanceof FileNotFoundError)) throw err
  }
}

async function setNavEntry(repo: string, present: boolean, author: Author): Promise<void> {
  let nav
  try {
    nav = await readFile(repo, NAV_PATH, DRAFT_BRANCH)
  } catch (err) {
    if (err instanceof FileNotFoundError) return
    throw err
  }
  const parsed = parseNavJson(nav.content)
  const has = parsed.primary.some(i => i.url === PRICING_PLANS_URL)
  if (present && !has) parsed.primary.push({ label: PRICING_PLANS_NAV_LABEL, url: PRICING_PLANS_URL })
  else if (!present && has) parsed.primary = parsed.primary.filter(i => i.url !== PRICING_PLANS_URL)
  else return
  await writeFile(repo, NAV_PATH, serializeNavJson(parsed), DRAFT_BRANCH, present ? 'Add pricing page to nav' : 'Remove pricing page from nav', { expectedSha: nav.sha, ...author })
}

// Push the plans page to the repo draft branch so it reaches the site. When
// enabled: write JSON, create the page if missing (never clobber prose edits),
// ensure the nav link. When disabled: remove all three. Non-throwing.
export async function syncPricingPlansToRepo(args: {
  githubRepo: string
  config: PricingPlansConfig
  enabled: boolean
  firmName: string
  actor: Actor
}): Promise<{ ok: boolean; error?: string }> {
  const { githubRepo, config, enabled, firmName, actor } = args
  const author = authorOf(actor)
  try {
    await ensureDraftBranch(githubRepo)
    if (enabled) {
      await upsertFile(githubRepo, PRICING_PLANS_JSON_PATH, JSON.stringify(config, null, 2), 'Update pricing plans config', author)
      try {
        await readFile(githubRepo, PRICING_PLANS_PAGE_PATH, DRAFT_BRANCH)
      } catch (err) {
        if (err instanceof FileNotFoundError) {
          await writeFile(githubRepo, PRICING_PLANS_PAGE_PATH, buildPricingPlansPageMd(firmName, config), DRAFT_BRANCH, 'Add pricing page', author)
        } else throw err
      }
      await setNavEntry(githubRepo, true, author)
    } else {
      await removeIfExists(githubRepo, PRICING_PLANS_JSON_PATH, 'Remove pricing plans config', author)
      await removeIfExists(githubRepo, PRICING_PLANS_PAGE_PATH, 'Remove pricing page', author)
      await setNavEntry(githubRepo, false, author)
    }
    return { ok: true }
  } catch (err) {
    console.error('[plans-sync] repo sync failed:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Repo sync failed' }
  }
}
