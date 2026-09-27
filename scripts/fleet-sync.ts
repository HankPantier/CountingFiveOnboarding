// Fleet sync — roll a template release out to the managed client repos.
// DRY-RUN BY DEFAULT: nothing is written, committed or pushed without --apply.
//
//   npx tsx scripts/fleet-sync.ts --all                         # dry-run report for the roster
//   npx tsx scripts/fleet-sync.ts --slugs bblcpa,BussCPA -v     # per-path detail
//   npx tsx scripts/fleet-sync.ts --all --to <sha> --from <sha> # explicit OLD (client lacks syncedFrom)
//   npx tsx scripts/fleet-sync.ts --all --apply                 # gate → apply → verify → push main → merge draft → Vercel
//   npx tsx scripts/fleet-sync.ts rollback --slugs bblcpa [--apply]
//
// Selection (exactly one): --all | --group <name> | --slugs a,b
// Options: --to <rev> (template@NEW, default main) · --from <rev> (template@OLD;
//   default = each client's c5-template.json "syncedFrom") · --template <dir>
//   (default $FLEET_TEMPLATE_DIR or ../counting-five-client-template) · --work <dir>
//   (local clones, default $TMPDIR/revaltus-fleet) · --manifest <file> (default
//   config/fleet-releases/<version>.json) · --three-way (3-way merge unruled DRIFT-M)
//   · --no-fetch · --concurrency <n> (verify, default 2) · --no-deploy-wait ·
//   --json <file> (machine-readable report) · -v/--verbose · --yes (skip prompt)
//   · --client-rev <rev> (dry-run replay against an older client commit; never applies)
//
// See lib/fleet/README.md for the gate rules and the release-manifest format.
import { existsSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { loadClients, repoName, resolveTargets } from '../lib/fleet/registry'
import { loadManifest, manifestForRange } from '../lib/fleet/release-manifest'
import { MARKER, summarize } from '../lib/fleet/classify'
import { readMarker } from '../lib/fleet/special-files'
import { git, revParse, showText, tryGit } from '../lib/fleet/git-local'
import { FLEET_TRAILER, applyChanges, ensureClone, gateRepo, prepareForApply, type RepoRun, type SyncContext } from '../lib/fleet/sync'
import { pool, verifyRepo } from '../lib/fleet/verify'
import { findLastFleetCommit, mergeMainIntoDraft, pushMain, waitForVercel } from '../lib/fleet/remote'
import type { ClientEntry, TargetSelection } from '../lib/fleet/types'

interface Args {
  command: 'sync' | 'rollback'
  selection: TargetSelection
  apply: boolean
  yes: boolean
  to: string
  from: string | null
  templateDir: string
  workDir: string
  manifest: string | null
  threeWay: boolean
  fetch: boolean
  concurrency: number
  deployWait: boolean
  json: string | null
  verbose: boolean
  clientRev: string | null
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    command: 'sync',
    selection: {},
    apply: false,
    yes: false,
    to: 'main',
    from: null,
    templateDir: process.env.FLEET_TEMPLATE_DIR ?? path.resolve(process.cwd(), '..', 'counting-five-client-template'),
    workDir: path.join(os.tmpdir(), 'revaltus-fleet'),
    manifest: null,
    threeWay: false,
    fetch: true,
    concurrency: 2,
    deployWait: true,
    json: null,
    verbose: false,
    clientRev: null,
  }
  const val = (i: number, flag: string) => {
    const v = argv[i]
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`)
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i]
    if (f === 'rollback' && i === 0) a.command = 'rollback'
    else if (f === '--all') a.selection.all = true
    else if (f === '--group') a.selection.group = val(++i, f)
    else if (f === '--slugs') a.selection.slugs = val(++i, f).split(',').map((s) => s.trim()).filter(Boolean)
    else if (f === '--apply') a.apply = true
    else if (f === '--yes' || f === '-y') a.yes = true
    else if (f === '--to') a.to = val(++i, f)
    else if (f === '--from') a.from = val(++i, f)
    else if (f === '--template') a.templateDir = path.resolve(val(++i, f))
    else if (f === '--work') a.workDir = path.resolve(val(++i, f))
    else if (f === '--manifest') a.manifest = path.resolve(val(++i, f))
    else if (f === '--three-way') a.threeWay = true
    else if (f === '--no-fetch') a.fetch = false
    else if (f === '--concurrency') a.concurrency = Math.max(1, Math.min(4, Number(val(++i, f)) || 2))
    else if (f === '--no-deploy-wait') a.deployWait = false
    else if (f === '--json') a.json = path.resolve(val(++i, f))
    else if (f === '-v' || f === '--verbose') a.verbose = true
    else if (f === '--client-rev') a.clientRev = val(++i, f)
    else throw new Error(`Unknown argument: ${f}`)
  }
  return a
}

async function confirm(question: string, skip: boolean): Promise<boolean> {
  if (skip) return true
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim())
  } finally {
    rl.close()
  }
}

function printRoster(targets: ClientEntry[], explicit: ClientEntry[]): void {
  console.log(`\nRoster (config/clients.json) → ${targets.length} target repo(s):`)
  for (const t of targets) console.log(`  • ${t.displayName.padEnd(26)} ${t.slug}${t.paused ? '  [PAUSED]' : ''}${t.managed ? '' : '  [unmanaged]'}`)
  if (explicit.length) console.log(`  ⚠ paused/unmanaged repo(s) included because they were named explicitly: ${explicit.map((t) => repoName(t.slug)).join(', ')}`)
  console.log('')
}

function printRun(run: RepoRun, verbose: boolean): void {
  const { plan } = run
  const head = `${repoName(run.client.slug).padEnd(26)}`
  if (run.upToDate) return console.log(`${head} up to date (syncedFrom = NEW)`)
  const state = plan.blockers.length ? 'BLOCKED' : run.changes.length ? 'READY' : 'NO-OP'
  console.log(`${head} ${state.padEnd(8)} OLD=${plan.from.slice(0, 7) || '???????'} ${summarize(plan)} files=${run.changes.length}`)
  for (const b of plan.blockers) console.log(`    ✗ ${b}`)
  for (const w of plan.warnings) console.log(`    ⚠ ${w}`)
  if (verbose) {
    for (const d of plan.decisions) if (d.action !== 'WRITE' && d.action !== 'SAME') console.log(`    · ${d.action.padEnd(13)} ${d.path}${d.note ? ` (${d.note})` : ''}`)
    for (const c of run.changes) console.log(`    ${c.content === null ? '-' : '+'} ${c.path}  — ${c.why}`)
  }
}

function resolveTemplate(a: Args): { to: string; toVersion: string } {
  if (!existsSync(path.join(a.templateDir, 'c5-template.json'))) {
    throw new Error(`Template checkout not found at ${a.templateDir} — pass --template <dir> or set FLEET_TEMPLATE_DIR`)
  }
  const to = revParse(a.templateDir, a.to)
  const toVersion = readMarker(showText(a.templateDir, to, MARKER)).templateVersion
  if (!toVersion) throw new Error(`template@${to.slice(0, 7)} has no c5-template.json templateVersion`)
  if (tryGit(a.templateDir, ['status', '--porcelain']).out.trim()) {
    console.warn(`⚠ template checkout has uncommitted changes — ignored (the tool reads committed blobs at ${to.slice(0, 7)} only)`)
  }
  return { to, toVersion }
}

async function runSync(a: Args, targets: ClientEntry[]): Promise<number> {
  const { to, toVersion } = resolveTemplate(a)
  loadManifest(toVersion, a.manifest ?? undefined) // fail fast when NEW has no manifest
  const ctx: SyncContext = {
    templateDir: a.templateDir,
    to,
    toVersion,
    manifestFor: (oldVersion) => manifestForRange(oldVersion, toVersion, { explicitPath: a.manifest ?? undefined }),
    threeWay: a.threeWay,
    clientRevOverride: a.clientRev ?? undefined,
  }
  if (a.clientRev && a.apply) throw new Error('--client-rev is a dry-run replay option; it cannot be combined with --apply')
  console.log(`Template ${a.templateDir}\n  NEW = ${to.slice(0, 7)} (${toVersion})   OLD = ${a.from ?? 'per-client syncedFrom'}   manifest = ${a.manifest ?? `config/fleet-releases/${toVersion}.json`}`)
  console.log(`  clones in ${a.workDir}${a.fetch ? '' : ' (no fetch)'}\n`)

  const runs: RepoRun[] = []
  for (const t of targets) {
    try {
      const dir = ensureClone(a.workDir, t.slug, { fetch: a.fetch })
      const run = gateRepo(ctx, t, dir, a.from)
      runs.push(run)
      printRun(run, a.verbose)
    } catch (err) {
      console.log(`${repoName(t.slug).padEnd(26)} ERROR    ${(err as Error).message.split('\n')[0]}`)
    }
  }
  const ready = runs.filter((r) => !r.upToDate && r.plan.blockers.length === 0 && r.changes.length > 0)
  const blocked = runs.filter((r) => r.plan.blockers.length > 0)
  console.log(`\n${ready.length} ready · ${blocked.length} blocked · ${runs.filter((r) => r.upToDate).length} up to date · ${targets.length - runs.length} errored`)

  const report: Record<string, unknown> = {
    template: { dir: a.templateDir, to, toVersion },
    mode: a.apply ? 'apply' : 'dry-run',
    repos: runs.map((r) => ({
      slug: r.client.slug,
      from: r.plan.from,
      clientHead: r.clientHead,
      upToDate: r.upToDate,
      blockers: r.plan.blockers,
      warnings: r.plan.warnings,
      decisions: r.plan.decisions,
      changes: r.changes.map((c) => ({ path: c.path, delete: c.content === null, why: c.why })),
    })),
  }
  const writeReport = () => a.json && writeFileSync(a.json, JSON.stringify(report, null, 2))

  if (!a.apply) {
    writeReport()
    console.log('\nDRY RUN — nothing was written, committed or pushed. Re-run with --apply to roll out the READY repos.')
    return 0
  }
  if (ready.length === 0) {
    writeReport()
    console.log('Nothing to apply.')
    return blocked.length ? 1 : 0
  }
  if (!(await confirm(`APPLY template ${toVersion} to ${ready.length} repo(s) and push to their LIVE main branch?`, a.yes))) {
    console.log('Aborted.')
    return 1
  }

  // 1) local commit per repo (unexpected-change abort inside)
  const committed: { run: RepoRun; sha: string }[] = []
  for (const run of ready) {
    try {
      const sha = applyChanges(ctx, run)
      committed.push({ run, sha })
      console.log(`  ✓ ${repoName(run.client.slug)}: committed ${sha.slice(0, 7)} (local)`)
    } catch (err) {
      console.log(`  ✗ ${repoName(run.client.slug)}: ${(err as Error).message}`)
    }
  }
  // 2) local verify, concurrency ≤ 2, one retry
  console.log(`\nVerifying ${committed.length} repo(s) locally (concurrency ${a.concurrency}, 1 retry)…`)
  const verified = await pool(committed, a.concurrency, async (c) => {
    const v = await verifyRepo(c.run.dir)
    console.log(`  ${v.ok ? '✓' : '✗'} ${repoName(c.run.client.slug)}: ${v.ok ? `${v.passed.join(' ')} (attempt ${v.attempts})` : `FAILED at ${v.failedStep} after ${v.attempts} attempt(s)`}`)
    if (!v.ok) console.log(v.tail.replace(/^/gm, '      '))
    return { ...c, verify: v }
  })
  // 3) push main → merge main→draft → Vercel, one repo at a time
  const results: Record<string, unknown>[] = []
  let failures = committed.length < ready.length ? ready.length - committed.length : 0
  for (const v of verified) {
    const repo = repoName(v.run.client.slug)
    if (!v.verify.ok) {
      failures++
      git(v.run.dir, ['reset', '-q', '--hard', 'refs/remotes/origin/main'])
      results.push({ slug: v.run.client.slug, pushed: false, reason: `verify failed at ${v.verify.failedStep}` })
      continue
    }
    const push = pushMain(v.run.dir)
    if (!push.ok) {
      failures++
      console.log(`  ✗ ${repo}: push failed — ${push.err}`)
      results.push({ slug: v.run.client.slug, pushed: false, reason: push.err })
      continue
    }
    const draft = mergeMainIntoDraft(v.run.client.slug, `Merge main into draft (template ${toVersion} sync)`)
    let deploy: { state: string; url: string | null } = { state: 'not-checked', url: null }
    if (a.deployWait) deploy = await waitForVercel(v.run.client.slug, push.sha)
    if (draft.result === 'conflict' || draft.result === 'failed' || deploy.state === 'failure' || deploy.state === 'error' || deploy.state === 'timeout') failures++
    console.log(`  ${repo}: main=${push.sha.slice(0, 7)} draft=${draft.result}${draft.detail ? ` ${draft.detail}` : ''} vercel=${deploy.state}${deploy.url ? ` ${deploy.url}` : ''}`)
    results.push({ slug: v.run.client.slug, pushed: true, main: push.sha, draft, deploy })
  }
  report.results = results
  writeReport()
  return failures ? 1 : 0
}

async function runRollback(a: Args, targets: ClientEntry[]): Promise<number> {
  if (!a.selection.slugs?.length) throw new Error('rollback needs an explicit --slugs list')
  let failures = 0
  const plans: { t: ClientEntry; dir: string; sha: string }[] = []
  for (const t of targets) {
    const repo = repoName(t.slug)
    try {
      const dir = ensureClone(a.workDir, t.slug, { fetch: true })
      const hit = findLastFleetCommit(dir, FLEET_TRAILER)
      if (!hit) console.log(`${repo.padEnd(26)} no ${FLEET_TRAILER} commit in the last 60 on main — nothing to roll back`)
      else if (hit.reverted) console.log(`${repo.padEnd(26)} ${hit.sha.slice(0, 7)} "${hit.subject}" is already reverted`)
      else {
        const files = git(dir, ['show', '--name-status', '--format=', hit.sha]).trim()
        console.log(`${repo.padEnd(26)} would revert ${hit.sha.slice(0, 7)} "${hit.subject}" (${hit.trailer})`)
        if (a.verbose) console.log(files.replace(/^/gm, '    '))
        plans.push({ t, dir, sha: hit.sha })
      }
    } catch (err) {
      failures++
      console.log(`${repo.padEnd(26)} ERROR ${(err as Error).message.split('\n')[0]}`)
    }
  }
  if (!a.apply) {
    console.log('\nDRY RUN — nothing reverted. Re-run with --apply.')
    return failures ? 1 : 0
  }
  if (plans.length === 0 || !(await confirm(`REVERT the last fleet sync on ${plans.length} repo(s) and push to LIVE main?`, a.yes))) return failures ? 1 : 0
  for (const p of plans) {
    const repo = repoName(p.t.slug)
    try {
      prepareForApply(p.dir)
      const rv = tryGit(p.dir, ['revert', '--no-commit', p.sha])
      if (!rv.ok) {
        tryGit(p.dir, ['revert', '--abort'])
        throw new Error(`revert conflicts — roll back by hand (${rv.err.trim().split('\n')[0]})`)
      }
      git(p.dir, ['commit', '-q', '-F', '-'], `revert: fleet sync ${p.sha.slice(0, 7)}\n\nReverts the fleet template sync; the site returns to its previous template files.\n\nFleet-Rollback: ${p.sha}\n`)
      const v = await verifyRepo(p.dir)
      if (!v.ok) {
        git(p.dir, ['reset', '-q', '--hard', 'refs/remotes/origin/main'])
        throw new Error(`verify failed at ${v.failedStep} — not pushed`)
      }
      const push = pushMain(p.dir)
      if (!push.ok) throw new Error(`push failed — ${push.err}`)
      const draft = mergeMainIntoDraft(p.t.slug, 'Merge main into draft (fleet rollback)')
      const deploy = a.deployWait ? await waitForVercel(p.t.slug, push.sha) : { state: 'not-checked', url: null }
      console.log(`  ✓ ${repo}: main=${push.sha.slice(0, 7)} draft=${draft.result} vercel=${deploy.state}`)
    } catch (err) {
      failures++
      console.log(`  ✗ ${repo}: ${(err as Error).message}`)
    }
  }
  return failures ? 1 : 0
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2))
  const { targets, includedExplicitly } = resolveTargets(loadClients(), a.selection)
  if (targets.length === 0) {
    console.log('No targets matched (check managed/themeGroup/paused in config/clients.json).')
    return
  }
  printRoster(targets, includedExplicitly)
  const code = a.command === 'rollback' ? await runRollback(a, targets) : await runSync(a, targets)
  process.exit(code)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
