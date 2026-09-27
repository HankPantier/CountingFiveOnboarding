// Server-only. The client site's stable Vercel address (https://<project>.vercel.app/),
// derived from what GitHub knows about the repo's Vercel deploys, for use as
// the default preview URL when content_jobs.preview_url is null. Before DNS
// cutover the only other fallback, site.config siteUrl, is the client's OLD site.
//
// Why not strip the deployment URL: GitHub's deployment environment_url is
// per-deployment, `<prefix>-<hash>-<team>.vercel.app`, and Vercel TRUNCATES the
// project name in that prefix (observed 2026-09-27):
//   buss-cpa              → buss-mfarg47hv-hankpantiers-projects.vercel.app
//   tru-count-cpa         → tru-count-cdgyg2bn6-hankpantiers-projects.vercel.app
//   stephen-p-pryor-cpa   → stephen-p-pryor-r2grmxxjw-hankpantiers-projects.vercel.app
//   kinexus-cp-as-advisors→ kinexus-cp-as-advisors-cabtscfv8-hankpantiers-projects.vercel.app
// so stripping the hash + team yields the project name for only 1 of those 4.
// Vercel's commit status on the same sha carries the exact project name in
// its target_url (https://vercel.com/<team>/<project>/<deploymentId>); that
// is the source here, with the deployment prefix used only to pick the right
// project when a repo is linked to more than one. The team-suffixed alias
// (<project>-<team>.vercel.app) sits behind Vercel deployment protection
// (302 to login), so only <project>.vercel.app is a candidate. Every candidate
// is verified by fetching it and finding the Revaltus template marker.
import { getOctokit, resolveRepo } from '@/lib/github/app-client'
import { safeGet } from '@/lib/audit/crawl'
import { hasRevaltusMarker } from './revaltus-marker'

export type VercelProject = { team: string; project: string }

// A DNS label: what <project>.vercel.app can hold.
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/

// https://vercel.com/<team>/<project>/<deploymentId> → { team, project }.
export function vercelProjectFromTargetUrl(targetUrl: string | null | undefined): VercelProject | null {
  if (!targetUrl) return null
  let u: URL
  try {
    u = new URL(targetUrl)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.hostname !== 'vercel.com') return null
  const [team, project] = u.pathname.split('/').filter(Boolean)
  if (!team || !project) return null
  const t = team.toLowerCase()
  const p = project.toLowerCase()
  if (!SLUG_RE.test(t) || !LABEL_RE.test(p)) return null
  return { team: t, project: p }
}

// https://<prefix>-<hash>-<team>.vercel.app → <prefix> (a possibly TRUNCATED
// project name — see the header; never use it as the alias on its own).
export function deploymentUrlPrefix(environmentUrl: string | null | undefined, team: string): string | null {
  if (!environmentUrl) return null
  let host: string
  try {
    host = new URL(environmentUrl).hostname.toLowerCase()
  } catch {
    return null
  }
  if (!host.endsWith('.vercel.app')) return null
  const label = host.slice(0, -'.vercel.app'.length)
  const suffix = `-${team}`
  if (!label.endsWith(suffix)) return null
  const m = /^(.+)-[a-z0-9]+$/.exec(label.slice(0, -suffix.length))
  return m ? m[1] : null
}

// The project a production deployment belongs to: the Vercel commit status
// whose project name starts with the deployment URL's prefix, else the first
// Vercel status (verification by marker still gates it).
export function pickVercelProject(args: { environmentUrl: string | null; targetUrls: string[] }): VercelProject | null {
  const projects = args.targetUrls.map(vercelProjectFromTargetUrl).filter((p): p is VercelProject => p !== null)
  if (projects.length === 0) return null
  const matched = projects.find((p) => {
    const prefix = deploymentUrlPrefix(args.environmentUrl, p.team)
    return prefix !== null && p.project.startsWith(prefix)
  })
  return matched ?? projects[0]
}

export const vercelAlias = (p: VercelProject): string => `https://${p.project}.vercel.app/`

// A reachable 2xx HTML page carrying the Revaltus marker.
export async function isRevaltusSite(url: string): Promise<boolean> {
  const res = await safeGet(url).catch(() => null)
  if (!res || res.status < 200 || res.status >= 300) return false
  if (res.contentType && !res.contentType.toLowerCase().includes('html')) return false
  return hasRevaltusMarker(res.body)
}

const MAX_DEPLOYMENTS = 3

// Latest Production deployments → their sha's Vercel commit status → the
// project → https://<project>.vercel.app/, returned only once verified (the
// page has the Revaltus marker). Null when GitHub has no Vercel deploys for
// the repo (no Vercel project yet, or the App lacks Deployments / Commit
// statuses read access) or nothing verifies. Never throws.
export async function deriveVercelPreviewUrl(githubRepo: string): Promise<string | null> {
  try {
    const octokit = getOctokit()
    const { owner, repo } = resolveRepo(githubRepo)
    const { data: deployments } = await octokit.repos.listDeployments({ owner, repo, environment: 'Production', per_page: MAX_DEPLOYMENTS })
    const tried = new Set<string>()
    for (const d of deployments.slice(0, MAX_DEPLOYMENTS)) {
      const [statuses, combined] = await Promise.all([
        octokit.repos.listDeploymentStatuses({ owner, repo, deployment_id: d.id, per_page: 10 }),
        octokit.repos.getCombinedStatusForRef({ owner, repo, ref: d.sha }),
      ])
      const environmentUrl = statuses.data.find((s) => s.state === 'success' && s.environment_url)?.environment_url ?? null
      const targetUrls = combined.data.statuses
        .filter((s) => /^vercel/i.test(s.context) && typeof s.target_url === 'string')
        .map((s) => s.target_url as string)
      const project = pickVercelProject({ environmentUrl, targetUrls })
      if (!project) continue
      const url = vercelAlias(project)
      if (tried.has(url)) continue
      tried.add(url)
      if (await isRevaltusSite(url)) return url
    }
    return null
  } catch (err) {
    console.warn(`[preview-url] Could not derive the Vercel address for ${githubRepo}:`, err instanceof Error ? err.message : err)
    return null
  }
}
