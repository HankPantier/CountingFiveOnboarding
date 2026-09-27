import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  listDeployments: vi.fn(),
  listDeploymentStatuses: vi.fn(),
  getCombinedStatusForRef: vi.fn(),
  get: vi.fn(),
}))
vi.mock('@/lib/github/app-client', () => ({
  getOctokit: () => ({
    repos: {
      listDeployments: (a: unknown) => m.listDeployments(a),
      listDeploymentStatuses: (a: unknown) => m.listDeploymentStatuses(a),
      getCombinedStatusForRef: (a: unknown) => m.getCombinedStatusForRef(a),
    },
  }),
  resolveRepo: (slug: string) => {
    const [owner, repo] = slug.split('/')
    return { owner, repo }
  },
}))
vi.mock('@/lib/audit/crawl', () => ({ safeGet: (u: string) => m.get(u) }))

import { deploymentUrlPrefix, deriveVercelPreviewUrl, pickVercelProject, vercelAlias, vercelProjectFromTargetUrl } from './vercel-alias'

const TEAM = 'hankpantiers-projects'
// Real samples read from GitHub on 2026-09-27: the latest Production
// deployment's environment_url and the Vercel commit status target_url on the
// same sha, for the four repos named in the bug report.
const SAMPLES = [
  {
    repo: 'Kinexus-CPAs-Advisors',
    environmentUrl: 'https://kinexus-cp-as-advisors-cabtscfv8-hankpantiers-projects.vercel.app',
    targetUrl: 'https://vercel.com/hankpantiers-projects/kinexus-cp-as-advisors/8odG3pqUyNpR9SREsqd2nder8owS',
    prefix: 'kinexus-cp-as-advisors',
    alias: 'https://kinexus-cp-as-advisors.vercel.app/',
  },
  {
    repo: 'TruCount-CPA',
    environmentUrl: 'https://tru-count-cdgyg2bn6-hankpantiers-projects.vercel.app',
    targetUrl: 'https://vercel.com/hankpantiers-projects/tru-count-cpa/ELu2tf8o6DKNNUL2yt6nSC2wsSLk',
    prefix: 'tru-count',
    alias: 'https://tru-count-cpa.vercel.app/',
  },
  {
    repo: 'BussCPA',
    environmentUrl: 'https://buss-mfarg47hv-hankpantiers-projects.vercel.app',
    targetUrl: 'https://vercel.com/hankpantiers-projects/buss-cpa/HeWgH7cBaede4pNx18gaypWtXrsY',
    prefix: 'buss',
    alias: 'https://buss-cpa.vercel.app/',
  },
  {
    repo: 'Stephen-P.-Pryor-CPA',
    environmentUrl: 'https://stephen-p-pryor-r2grmxxjw-hankpantiers-projects.vercel.app',
    targetUrl: 'https://vercel.com/hankpantiers-projects/stephen-p-pryor-cpa/8uEP1LYfc6crpr5Up5zXdWJfgY89',
    prefix: 'stephen-p-pryor',
    alias: 'https://stephen-p-pryor-cpa.vercel.app/',
  },
]

describe('alias derivation from real deployment samples', () => {
  it.each(SAMPLES)('$repo: stripping hash + team from environment_url gives only the (truncated) prefix $prefix', (s) => {
    expect(deploymentUrlPrefix(s.environmentUrl, TEAM)).toBe(s.prefix)
  })

  it('the stripped prefix equals the project name for only 1 of the 4 — so it is never used as the alias', () => {
    const exact = SAMPLES.filter((s) => `https://${deploymentUrlPrefix(s.environmentUrl, TEAM)}.vercel.app/` === s.alias)
    expect(exact.map((s) => s.repo)).toEqual(['Kinexus-CPAs-Advisors'])
  })

  it.each(SAMPLES)('$repo → $alias via the commit status target_url, matched to the deployment', (s) => {
    const project = pickVercelProject({ environmentUrl: s.environmentUrl, targetUrls: [s.targetUrl] })
    expect(project?.team).toBe(TEAM)
    expect(project && vercelAlias(project)).toBe(s.alias)
  })

  it('picks the project matching the deployment prefix when a repo reports several Vercel projects', () => {
    const buss = SAMPLES[2]
    const project = pickVercelProject({
      environmentUrl: buss.environmentUrl,
      targetUrls: ['https://vercel.com/hankpantiers-projects/other-site/abc', buss.targetUrl],
    })
    expect(project?.project).toBe('buss-cpa')
  })

  it.each([
    ['not vercel.com', 'https://evil.test/hankpantiers-projects/buss-cpa/x'],
    ['http', 'http://vercel.com/hankpantiers-projects/buss-cpa/x'],
    ['no project segment', 'https://vercel.com/hankpantiers-projects'],
    ['not a DNS label', 'https://vercel.com/team/bad_name.x/abc'],
    ['empty', ''],
  ])('rejects a target_url that is %s', (_n, url) => {
    expect(vercelProjectFromTargetUrl(url)).toBeNull()
  })

  it('rejects an environment_url that is not <prefix>-<hash>-<team>.vercel.app', () => {
    expect(deploymentUrlPrefix('https://buss-cpa.example.com', TEAM)).toBeNull()
    expect(deploymentUrlPrefix('https://buss-mfarg47hv-someone-else.vercel.app', TEAM)).toBeNull()
    expect(deploymentUrlPrefix(null, TEAM)).toBeNull()
  })
})

describe('deriveVercelPreviewUrl', () => {
  const tru = SAMPLES[1]
  const marked = { status: 200, contentType: 'text/html', finalUrl: tru.alias, body: '<html><head><meta name="c5-capabilities" content="fonts"/></head></html>' }

  beforeEach(() => {
    m.listDeployments.mockReset().mockResolvedValue({ data: [{ id: 1, sha: 'e723a50' }] })
    m.listDeploymentStatuses.mockReset().mockResolvedValue({ data: [{ state: 'success', environment_url: tru.environmentUrl }] })
    m.getCombinedStatusForRef.mockReset().mockResolvedValue({ data: { statuses: [{ context: 'Vercel', state: 'success', target_url: tru.targetUrl }] } })
    m.get.mockReset().mockResolvedValue(marked)
  })

  it('reads the latest Production deployment and returns the verified <project>.vercel.app', async () => {
    expect(await deriveVercelPreviewUrl('hankpantier/TruCount-CPA')).toBe('https://tru-count-cpa.vercel.app/')
    expect(m.listDeployments).toHaveBeenCalledWith(expect.objectContaining({ owner: 'hankpantier', repo: 'TruCount-CPA', environment: 'Production' }))
    expect(m.getCombinedStatusForRef).toHaveBeenCalledWith(expect.objectContaining({ ref: 'e723a50' }))
    expect(m.get).toHaveBeenCalledWith('https://tru-count-cpa.vercel.app/')
  })

  it('returns null when the alias is not a Revaltus site (no marker)', async () => {
    m.get.mockResolvedValue({ ...marked, body: '<html><head></head></html>' })
    expect(await deriveVercelPreviewUrl('hankpantier/TruCount-CPA')).toBeNull()
  })

  it('returns null with no Production deployments or no Vercel status', async () => {
    m.listDeployments.mockResolvedValue({ data: [] })
    expect(await deriveVercelPreviewUrl('o/r')).toBeNull()
    m.listDeployments.mockResolvedValue({ data: [{ id: 1, sha: 'a' }] })
    m.getCombinedStatusForRef.mockResolvedValue({ data: { statuses: [{ context: 'ci/build', state: 'success', target_url: 'https://ci.test' }] } })
    expect(await deriveVercelPreviewUrl('o/r')).toBeNull()
    expect(m.get).not.toHaveBeenCalled()
  })

  it('never throws (e.g. the App lacks Deployments read access)', async () => {
    m.listDeployments.mockRejectedValue(Object.assign(new Error('Resource not accessible by integration'), { status: 403 }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await deriveVercelPreviewUrl('o/r')).toBeNull()
    warn.mockRestore()
  })
})
