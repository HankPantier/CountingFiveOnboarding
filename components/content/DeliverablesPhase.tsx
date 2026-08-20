'use client'

import { useEffect, useState } from 'react'
import NavCurationPhase from './NavCurationPhase'
import PackageDownloadBar from './PackageDownloadBar'
import ProgressBar from '@/components/ui/ProgressBar'
import { useTaskProgress } from '@/components/ui/use-task-progress'
import type { NavJson } from '@/types/nav-json'

type SitemapEntry = { url: string; title: string; parent?: string; status?: string }

type ApprovalSnapshot = {
  total: number
  complete: number
  error: number
  approved: number
  unapproved: Array<{ id: string; title: string; url: string }>
}

type Unapproved = { id?: string; page_title?: string; page_url?: string }

// The four sequential steps of the one-click "Publish site live" orchestrator.
// Each maps to an existing route; the client sequences them so every call stays
// within its own maxDuration (no single-invocation timeout risk).
const DEPLOY_STEPS = [
  { key: 'seeding', label: 'Seed template' },
  { key: 'assembling', label: 'Assemble & push to draft' },
  { key: 'confirming', label: 'Confirm draft push' },
  { key: 'publishing', label: 'Publish to live' },
] as const

type DeployStep = 'idle' | 'seeding' | 'assembling' | 'confirming' | 'publishing' | 'live'

export default function DeliverablesPhase({
  sessionId,
  contentJobId,
  githubRepo,
  pageCount,
  initialNavConfig,
  confirmedSitemap,
}: {
  sessionId: string
  contentJobId: string
  githubRepo: string | null
  pageCount: number
  initialNavConfig: NavJson | null
  confirmedSitemap: SitemapEntry[]
}) {
  const [packaging, setPackaging] = useState(false)
  const [packaged, setPackaged] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unapprovedFromGate, setUnapprovedFromGate] = useState<Unapproved[] | null>(null)
  const [packageInfo, setPackageInfo] = useState<{ pageCount: number; sizeKB: number } | null>(null)
  const [deployState, setDeployState] = useState<'idle' | 'deploying' | 'deployed' | 'unknown'>('idle')
  const [linkWarnings, setLinkWarnings] = useState<string[]>([])
  const [redirectIssues, setRedirectIssues] = useState<Array<{ severity: string; oldUrl: string; reason: string }>>([])
  const [approval, setApproval] = useState<ApprovalSnapshot | null>(null)
  // One-click "Publish site live" orchestration state. deployStep holds the
  // step currently running (or 'live' when finished); deployErr is set on the
  // step that failed (deployStep stays put so the stepper can mark it). prUrl is
  // populated only on the not-expected first-deploy merge-conflict path.
  const [deployStep, setDeployStep] = useState<DeployStep>('idle')
  const [deployErr, setDeployErr] = useState<string | null>(null)
  const [conflictPrUrl, setConflictPrUrl] = useState<string | null>(null)
  // Referenced images that didn't ship (assembler coverage guard) and the
  // Re-pull-all-images recovery action state.
  const [imageMissing, setImageMissing] = useState<string[]>([])
  const [repullState, setRepullState] = useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const [repullMsg, setRepullMsg] = useState<string | null>(null)
  const [repullTaskId, setRepullTaskId] = useState<string | null>(null)
  const [repullStartedAt, setRepullStartedAt] = useState<number | null>(null)
  const repullProgress = useTaskProgress(repullTaskId, repullState === 'working')
  // Start timestamps for the indeterminate (elapsed-timer) bars on the opaque
  // assemble + one-click publish flows, which have no determinate count.
  const [assembleStartedAt, setAssembleStartedAt] = useState<number | null>(null)
  const [deployStartedAt, setDeployStartedAt] = useState<number | null>(null)

  // Poll the approval state so the assemble button knows whether the gate
  // would reject. Stops polling once everything's approved.
  useEffect(() => {
    let cancelled = false

    const poll = async () => {
      try {
        const res = await fetch(`/api/content-jobs/${contentJobId}/generation-status`)
        if (cancelled || !res.ok) return
        const data = await res.json()
        const unapproved = (data.pages ?? [])
          .filter((p: { status: string; approved: boolean }) => p.status === 'complete' && !p.approved)
          .map((p: { id: string; title: string; url: string }) => ({ id: p.id, title: p.title, url: p.url }))
        const snap: ApprovalSnapshot = {
          total: data.total ?? 0,
          complete: data.complete ?? 0,
          error: data.error ?? 0,
          approved: data.approved ?? 0,
          unapproved,
        }
        setApproval(snap)
        if (snap.complete > 0 && snap.complete === snap.approved) {
          clearInterval(intervalId)
        }
      } catch {
        // retry on next tick
      }
    }

    const intervalId = setInterval(poll, 5000)
    poll()
    return () => { cancelled = true; clearInterval(intervalId) }
  }, [contentJobId])

  // Poll the linked repo's draft HEAD until a new "Deploy packaged content"
  // commit appears (the background push landed) or we give up. `baselineSha` is
  // the pre-push HEAD captured before assembly, so a fresh deploy commit is a
  // sha change — no clock comparison needed.
  const trackDeploy = async (baselineSha: string | null): Promise<boolean> => {
    setDeployState('deploying')
    const MAX_POLLS = 40 // ~3.3 min at 5s
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, 5000))
      try {
        const res = await fetch(`/api/content-jobs/${contentJobId}/deploy-status`)
        if (!res.ok) continue
        const data = await res.json()
        if (data.repo == null) { setDeployState('idle'); return false }
        if (data.reachable && data.isDeployCommit && data.lastCommitSha && data.lastCommitSha !== baselineSha) {
          setDeployState('deployed')
          return true
        }
      } catch {
        // keep polling
      }
    }
    setDeployState('unknown')
    return false
  }

  const assemblePackage = async () => {
    setPackaging(true)
    setAssembleStartedAt(Date.now())
    setError(null)
    setUnapprovedFromGate(null)
    setDeployState('idle')
    // Capture the repo's current HEAD before the push runs so trackDeploy can
    // detect the new deploy commit.
    let baselineSha: string | null = null
    try {
      const b = await fetch(`/api/content-jobs/${contentJobId}/deploy-status`)
      if (b.ok) baselineSha = (await b.json()).lastCommitSha ?? null
    } catch {
      // baseline is best-effort
    }
    try {
      const res = await fetch(`/api/content-jobs/${contentJobId}/package`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (Array.isArray(data?.unapproved)) setUnapprovedFromGate(data.unapproved)
        throw new Error(data?.error ?? 'Failed to assemble package')
      }
      setPackageInfo({ pageCount: data.pageCount, sizeKB: data.sizeKB })
      setLinkWarnings(Array.isArray(data.linkWarnings) ? data.linkWarnings : [])
      setRedirectIssues(Array.isArray(data.redirectIssues) ? data.redirectIssues : [])
      setImageMissing(Array.isArray(data.imageCoverage?.missing) ? data.imageCoverage.missing : [])
      setPackaged(true)
      if (data.pushScheduled) void trackDeploy(baselineSha)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assemble')
    } finally {
      setPackaging(false)
    }
  }

  // One-click deploy: seed (idempotent) → assemble + push to draft → confirm the
  // push landed → publish draft→main (Vercel deploys main). Reuses the same
  // building blocks as the standalone assemble/track path; only publish is new.
  const runFullDeploy = async () => {
    setError(null)
    setDeployErr(null)
    setConflictPrUrl(null)
    setUnapprovedFromGate(null)
    setDeployStartedAt(Date.now())
    try {
      // Step 1 — seed the repo from the template (skips if already seeded).
      setDeployStep('seeding')
      const seedRes = await fetch(`/api/content-jobs/${contentJobId}/seed-repo`, { method: 'POST' })
      const seedData = await seedRes.json().catch(() => ({}))
      if (!seedRes.ok) throw new Error(seedData?.error ?? 'Repo seeding failed')

      // Step 2 — assemble the package and background-push it to the draft branch.
      setDeployStep('assembling')
      let baselineSha: string | null = null
      try {
        const b = await fetch(`/api/content-jobs/${contentJobId}/deploy-status`)
        if (b.ok) baselineSha = (await b.json()).lastCommitSha ?? null
      } catch {
        // baseline is best-effort
      }
      const pkgRes = await fetch(`/api/content-jobs/${contentJobId}/package`, { method: 'POST' })
      const pkgData = await pkgRes.json().catch(() => ({}))
      if (!pkgRes.ok) {
        if (Array.isArray(pkgData?.unapproved)) setUnapprovedFromGate(pkgData.unapproved)
        throw new Error(pkgData?.error ?? 'Failed to assemble package')
      }
      setPackageInfo({ pageCount: pkgData.pageCount, sizeKB: pkgData.sizeKB })
      setLinkWarnings(Array.isArray(pkgData.linkWarnings) ? pkgData.linkWarnings : [])
      setRedirectIssues(Array.isArray(pkgData.redirectIssues) ? pkgData.redirectIssues : [])
      setImageMissing(Array.isArray(pkgData.imageCoverage?.missing) ? pkgData.imageCoverage.missing : [])
      setPackaged(true)
      if (!pkgData.pushScheduled) {
        throw new Error('No repo push was scheduled — confirm a GitHub repo is linked above.')
      }

      // Step 3 — wait for the background push to land on draft.
      setDeployStep('confirming')
      const confirmed = await trackDeploy(baselineSha)
      if (!confirmed) {
        throw new Error('Timed out confirming the draft push. The package still shipped — publish from the content editor once the draft commit appears.')
      }

      // Step 4 — publish draft→main. First deploy is a clean fast-forward; a
      // conflict (not expected here) opens a PR instead of merging.
      setDeployStep('publishing')
      const pubRes = await fetch(`/api/edit/${sessionId}/publish`, { method: 'POST' })
      const pubData = await pubRes.json().catch(() => ({}))
      if (!pubRes.ok) throw new Error(pubData?.error ?? 'Publish to live failed')
      if (pubData?.merged === false && pubData?.prUrl) {
        setConflictPrUrl(pubData.prUrl)
        setDeployErr('Publish needs a manual merge — a pull request was opened to resolve it.')
        return
      }
      setDeployStep('live')
    } catch (err) {
      setDeployErr(err instanceof Error ? err.message : 'Deploy failed')
    }
  }

  // Re-pull all stock/hero images for this job and commit any missing ones to
  // the draft branch. Recovery for a site whose images failed to resolve at
  // assembly (missing PEXELS_API_KEY, Pexels outage) so its live pages render
  // "Image not found". Pushes to draft only — Publish afterwards to go live.
  const repullImages = async () => {
    const taskId = crypto.randomUUID()
    setRepullTaskId(taskId)
    setRepullStartedAt(Date.now())
    setRepullState('working')
    setRepullMsg(null)
    try {
      const res = await fetch(`/api/content-jobs/${contentJobId}/images/repull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Image re-pull failed')
      const pushed: number = data.pushed ?? 0
      const stillMissing: string[] = Array.isArray(data.stillMissing) ? data.stillMissing : []
      setImageMissing(stillMissing)
      setRepullState('done')
      setRepullMsg(
        pushed > 0
          ? `Pushed ${pushed} image(s) to the draft branch${stillMissing.length ? ` — ${stillMissing.length} still unresolved` : ''}. Publish to push them live.`
          : stillMissing.length
            ? `No images could be resolved — ${stillMissing.length} still missing. Confirm PEXELS_API_KEY is set in production.`
            : 'All images already present — nothing to re-pull.'
      )
    } catch (err) {
      setRepullState('error')
      setRepullMsg(err instanceof Error ? err.message : 'Image re-pull failed')
    } finally {
      setRepullTaskId(null)
    }
  }

  // Active while any of the four steps is running and no error has surfaced.
  const deploying =
    deployStep !== 'idle' && deployStep !== 'live' && deployErr === null && conflictPrUrl === null
  const deployStepIndex =
    deployStep === 'live' ? DEPLOY_STEPS.length : DEPLOY_STEPS.findIndex((s) => s.key === deployStep)

  // Only a fully-qualified owner/name slug yields a usable GitHub URL; a bare
  // slug's org is only known server-side, so we skip the link for those.
  const repoHref = githubRepo && githubRepo.includes('/') ? `https://github.com/${githubRepo}` : null

  // Error takes precedence: on a failed step deployStep stays put, so the
  // retry label must win over the still-set running label for that step.
  const deployButtonLabel =
    deployErr || conflictPrUrl
      ? 'Retry publish site live'
      : deployStep === 'seeding'
        ? 'Seeding repo…'
        : deployStep === 'assembling'
          ? 'Assembling package…'
          : deployStep === 'confirming'
            ? 'Pushing to draft…'
            : deployStep === 'publishing'
              ? 'Publishing to live…'
              : 'Publish site live'

  const allApproved = approval ? approval.complete > 0 && approval.complete === approval.approved : false
  const hasUnapproved = approval ? approval.complete - approval.approved > 0 : false
  // "Done" means every page has reached a terminal state, not that all succeeded.
  // Failed pages are skipped by the assembler and listed in ERRORS.md, so they
  // must not block assembly forever (they otherwise stall the whole deliverable).
  const generationDone = approval !== null && approval.total > 0 && approval.complete + approval.error >= approval.total

  return (
    <div className="space-y-6">
      {/* Nav Curation */}
      <section className="border border-border-default rounded-lg p-4 space-y-3">
        <h3 className="text-lg font-semibold font-heading">Curate Navigation</h3>
        <NavCurationPhase
          contentJobId={contentJobId}
          initialNavConfig={initialNavConfig}
          confirmedSitemap={confirmedSitemap}
        />
      </section>

      {/* Package Assembly */}
      <div className="space-y-4">
      {generationDone ? (
        approval && approval.error > 0 ? (
          <div className="bg-warning/10 border border-warning/30 text-warning-strong text-sm font-body rounded-lg px-4 py-3">
            Content generation finished — {approval.complete} of {approval.total} pages. {approval.error} failed and will be skipped (listed in ERRORS.md). Retry them in the Content Generation step above if you want them included.
          </div>
        ) : (
          <div className="bg-success/10 border border-success/30 text-success text-sm font-body rounded-lg px-4 py-3">
            Content generation complete.
          </div>
        )
      ) : (
        <div className="bg-info/10 border border-info/20 text-info text-sm font-body rounded-lg px-4 py-3">
          {approval
            ? `Waiting for content generation — ${approval.complete} of ${approval.total} pages ready${approval.error > 0 ? ` (${approval.error} failed)` : ''}.`
            : 'Loading generation status…'}
        </div>
      )}

      {/* One-click deploy — the primary path once a GitHub repo is linked. */}
      {githubRepo ? (
        <div className="space-y-3 border border-brand-cyan/30 bg-brand-cyan/5 rounded-lg p-4">
          <div>
            <h3 className="text-sm font-heading font-semibold text-brand-navy">Publish site live</h3>
            <p className="text-xs font-body text-text-muted mt-0.5">
              One click: seeds <span className="font-mono">{githubRepo}</span> from the template, pushes this package to the <span className="font-mono">draft</span> branch, then publishes to <span className="font-mono">main</span> — Vercel deploys the live site automatically.
            </p>
          </div>

          {deployStep !== 'idle' && (
            <ol className="space-y-1.5">
              {DEPLOY_STEPS.map((step, i) => {
                const done = deployStep === 'live' || i < deployStepIndex
                const failed = (deployErr !== null || conflictPrUrl !== null) && i === deployStepIndex
                const active = !failed && i === deployStepIndex && deployStep !== 'live'
                return (
                  <li key={step.key} className="flex items-center gap-2 text-xs font-body">
                    <span className={done ? 'text-success' : failed ? 'text-error' : active ? 'text-brand-cyan' : 'text-text-muted'}>
                      {done ? '✓' : failed ? '✗' : active ? '●' : '○'}
                    </span>
                    <span className={done ? 'text-text-primary' : failed ? 'text-error' : active ? 'text-brand-navy font-semibold' : 'text-text-muted'}>
                      {step.label}
                    </span>
                  </li>
                )
              })}
            </ol>
          )}

          {deploying && (
            <ProgressBar
              phase={DEPLOY_STEPS[deployStepIndex]?.label ?? 'Working…'}
              current={0}
              total={0}
              startedAt={deployStartedAt}
            />
          )}

          {deployStep === 'live' && (
            <div className="bg-success/10 border border-success/30 text-success text-sm font-body rounded-lg px-4 py-2">
              Published to <span className="font-mono">main</span>. Vercel will deploy the live site automatically.
              {repoHref && (
                <>
                  {' '}
                  <a href={repoHref} target="_blank" rel="noreferrer" className="font-heading font-semibold underline hover:text-success">
                    Open repo ↗
                  </a>
                </>
              )}
            </div>
          )}

          {conflictPrUrl && (
            <div className="bg-warning/10 border border-warning/30 text-warning-strong text-sm font-body rounded-lg px-4 py-2">
              {deployErr}{' '}
              <a href={conflictPrUrl} target="_blank" rel="noreferrer" className="font-heading font-semibold underline">
                Review PR ↗
              </a>
            </div>
          )}

          {deployErr && !conflictPrUrl && (
            <div className="bg-error/10 border border-error/20 text-error text-sm font-body rounded-lg px-4 py-2">
              {deployErr}
            </div>
          )}

          {deployStep !== 'live' && (
            <button
              onClick={runFullDeploy}
              disabled={deploying || hasUnapproved || !generationDone}
              className="bg-brand-cyan text-text-inverse font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-brand-cyan-dark disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {!generationDone
                ? 'Publish site live (waiting on generation)'
                : hasUnapproved
                  ? 'Publish site live (pending approvals)'
                  : deployButtonLabel}
            </button>
          )}

          <div className="border-t border-brand-cyan/20 pt-3 space-y-1.5">
            <p className="text-xs font-body text-text-muted">
              Images missing on the live site (showing “Image not found”)? Re-pull every stock &amp; hero photo and commit them to the <span className="font-mono">draft</span> branch, then Publish.
            </p>
            <button
              onClick={repullImages}
              disabled={repullState === 'working' || deploying}
              className="border border-brand-cyan text-brand-cyan font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-brand-cyan/10 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {repullState === 'working' ? 'Re-pulling images…' : 'Re-pull all images'}
            </button>
            {repullState === 'working' && (
              <ProgressBar
                phase={repullProgress?.phase ?? 'Starting…'}
                current={repullProgress?.current ?? 0}
                total={repullProgress?.total ?? 0}
                startedAt={repullStartedAt}
                className="max-w-sm"
              />
            )}
            {repullState !== 'working' && repullMsg && (
              <p className={`text-xs font-body ${repullState === 'error' ? 'text-error' : 'text-text-secondary'}`}>
                {repullMsg}
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs font-body text-text-muted">
          Link a GitHub repo above to publish this site live in one click. You can still assemble and download the package below.
        </p>
      )}

      {!packaged ? (
        <div className="space-y-3">
          <p className="text-sm font-body text-text-secondary">
            Ready to assemble the deliverable package: {pageCount} pages, Word document, styling-free plain text (.txt) and unstyled Word (.docx), brand.md, llms.txt, llms-full.txt, robots.txt, sitemap.xml, redirects.csv, and an og-images README.
          </p>

          {approval && generationDone && hasUnapproved && (
            <div className="bg-warning/10 border border-warning/30 text-warning-strong text-sm font-body rounded-lg px-4 py-2 space-y-1">
              <div>
                {approval.complete - approval.approved} of {approval.complete} pages still need approval before packaging.
              </div>
              <div className="text-xs font-mono text-warning-strong">
                Approve them in the Content Generation step above.
              </div>
            </div>
          )}

          <button
            onClick={assemblePackage}
            disabled={packaging || deploying || hasUnapproved || !generationDone}
            className={
              githubRepo
                ? 'border border-brand-cyan text-brand-cyan font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-brand-cyan/10 disabled:opacity-50 disabled:cursor-not-allowed'
                : 'bg-brand-cyan text-text-inverse font-heading font-semibold text-xs px-3.5 py-1.5 rounded-pill transition-all hover:bg-brand-cyan-dark disabled:opacity-50 disabled:cursor-not-allowed'
            }
          >
            {packaging
              ? 'Assembling Package...'
              : !generationDone
                ? 'Assemble Package (waiting on generation)'
                : githubRepo
                  ? 'Assemble & download only (skip publish)'
                  : allApproved
                    ? 'Assemble & Download Package'
                    : 'Assemble Package (pending approvals)'}
          </button>
          {packaging && (
            <ProgressBar phase="Assembling package…" current={0} total={0} startedAt={assembleStartedAt} className="max-w-sm" />
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-sm font-body text-text-primary">
            <span className="font-semibold">{packageInfo?.pageCount ?? pageCount} pages</span>
            <span className="text-text-muted"> · 1 Word document · plain text (.txt) · unstyled Word (.docx) · brand.md · llms.txt · llms-full.txt · robots.txt · sitemap.xml · redirects.csv · og-images/README.md</span>
            {packageInfo?.sizeKB && (
              <span className="text-text-muted"> · {packageInfo.sizeKB} KB</span>
            )}
          </div>

          {deployState === 'deploying' && (
            <div className="bg-info/10 border border-info/20 text-info text-sm font-body rounded-lg px-4 py-2">
              Deploying content to the site repo&rsquo;s <span className="font-mono">draft</span> branch in the background… This can take a minute for image-heavy sites. The download below is ready now.
            </div>
          )}
          {deployState === 'deployed' && (
            <div className="bg-success/10 border border-success/30 text-success text-sm font-body rounded-lg px-4 py-2">
              Deployed to the site repo&rsquo;s <span className="font-mono">draft</span> branch. Review in the content editor, then <span className="font-semibold">Publish to live</span> when ready.
            </div>
          )}
          {deployState === 'unknown' && (
            <div className="bg-warning/10 border border-warning/20 text-warning-strong text-sm font-body rounded-lg px-4 py-2">
              Couldn&rsquo;t confirm the repo deploy from here — it may still be finishing. Check the content editor for the latest <span className="font-mono">draft</span> commit; the download below works regardless.
            </div>
          )}

          {redirectIssues.length > 0 && (
            <div className="bg-warning/10 border border-warning/20 text-warning-strong text-sm font-body rounded-lg px-4 py-2 space-y-1">
              <div className="font-heading font-semibold">
                {redirectIssues.length} redirect map issue(s) — fix in redirects.csv before launch:
              </div>
              <ul className="text-xs font-mono space-y-0.5">
                {redirectIssues.map((i) => (
                  <li key={`${i.oldUrl}-${i.reason}`}>[{i.severity}] {i.oldUrl}: {i.reason}</li>
                ))}
              </ul>
            </div>
          )}

          {imageMissing.length > 0 && (
            <div className="bg-warning/10 border border-warning/20 text-warning-strong text-sm font-body rounded-lg px-4 py-2 space-y-1">
              <div className="font-heading font-semibold">
                {imageMissing.length} image(s) didn&rsquo;t resolve — these pages will show “Image not found”:
              </div>
              <ul className="text-xs font-mono space-y-0.5">
                {imageMissing.slice(0, 10).map((f) => (
                  <li key={f}>{f}</li>
                ))}
                {imageMissing.length > 10 && <li>…and {imageMissing.length - 10} more</li>}
              </ul>
              <div className="text-xs">Use “Re-pull all images” above, then Publish. If it stays empty, confirm PEXELS_API_KEY is set in production.</div>
            </div>
          )}

          {linkWarnings.length > 0 && (
            <div className="bg-warning/10 border border-warning/20 text-warning-strong text-sm font-body rounded-lg px-4 py-2 space-y-1">
              <div className="font-heading font-semibold">
                {linkWarnings.length} internal link(s) point outside the confirmed sitemap:
              </div>
              <ul className="text-xs font-mono space-y-0.5">
                {linkWarnings.slice(0, 10).map((w) => (
                  <li key={w}>{w}</li>
                ))}
                {linkWarnings.length > 10 && <li>…and {linkWarnings.length - 10} more</li>}
              </ul>
              <div className="text-xs">Fix them in the editor — the package still shipped.</div>
            </div>
          )}

          <PackageDownloadBar contentJobId={contentJobId} />
        </div>
      )}

      {error && (
        <div className="bg-error/10 border border-error/20 text-error text-sm font-body rounded-lg px-4 py-2 space-y-1">
          <div>{error}</div>
          {unapprovedFromGate && unapprovedFromGate.length > 0 && (
            <ul className="text-xs font-mono space-y-0.5">
              {unapprovedFromGate.map((p, i) => (
                <li key={p.id ?? i}>
                  • {p.page_title ?? p.page_url ?? 'unknown page'}{p.page_url ? ` (${p.page_url})` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      </div>
    </div>
  )
}
