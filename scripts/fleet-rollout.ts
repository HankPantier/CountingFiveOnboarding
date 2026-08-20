// Fleet rollout CLI — propagate template/theme updates (the shared,
// template-owned files) across the selected client repos, safely.
//
//   npx tsx scripts/fleet-rollout.ts plan     --group ink-and-clay
//   npx tsx scripts/fleet-rollout.ts stage    --group ink-and-clay
//   npx tsx scripts/fleet-rollout.ts status   --group ink-and-clay
//   npx tsx scripts/fleet-rollout.ts promote  --group ink-and-clay --confirm-green
//   npx tsx scripts/fleet-rollout.ts rollback --slugs bblcpa
//
// Selection (exactly one): --group <name> | --slugs <a,b,c> | --all
// Flags: --yes (skip the confirm prompt), --confirm-green (required for promote:
//        attests you verified each staged branch's Vercel preview build is green).
//
// Flow: stage → (Vercel builds template-sync preview + CI) → verify green →
//       promote (merge to live). Never writes to main until promote. rollback
//       undoes the last promote per repo.
import { loadEnvConfig } from '@next/env'
import { createInterface } from 'node:readline/promises'
import { loadClients, resolveTargets } from '../lib/fleet/registry'
import { loadManifest } from '../lib/fleet/manifest'
import {
  collectTemplatePayload,
  planRollout,
  stageClient,
  rolloutStatus,
  promoteClient,
  rollbackClient,
} from '../lib/fleet/rollout'
import type { ClientEntry, TargetSelection } from '../lib/fleet/types'

loadEnvConfig(process.cwd())

type Command = 'plan' | 'stage' | 'status' | 'promote' | 'rollback'
const COMMANDS: Command[] = ['plan', 'stage', 'status', 'promote', 'rollback']

interface Flags {
  selection: TargetSelection
  yes: boolean
  confirmGreen: boolean
}

function parseFlags(argv: string[]): Flags {
  const selection: TargetSelection = {}
  let yes = false
  let confirmGreen = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--all') selection.all = true
    else if (a === '--yes' || a === '-y') yes = true
    else if (a === '--confirm-green') confirmGreen = true
    else if (a === '--group') selection.group = argv[++i]
    else if (a === '--slugs') selection.slugs = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    else throw new Error(`Unknown argument: ${a}`)
  }
  return { selection, yes, confirmGreen }
}

async function confirm(question: string, skip: boolean): Promise<boolean> {
  if (skip) return true
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase()
    return answer === 'y' || answer === 'yes'
  } finally {
    rl.close()
  }
}

function printTargets(targets: ClientEntry[]): void {
  console.log(`\nResolved ${targets.length} target repo(s):`)
  for (const t of targets) {
    console.log(`  • ${t.displayName.padEnd(18)} ${t.slug}${t.themeGroup ? `  [${t.themeGroup}]` : ''}`)
  }
  console.log('')
}

const AUTHOR = {
  name: 'CountingFive Fleet (CLI)',
  email: process.env.ADMIN_EMAIL ?? 'fleet@countingfive.local',
}

const GITHUB_ENV = ['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_INSTALLATION_ID', 'GITHUB_ORG']

// Every command reaches GitHub via the App. These creds live in Vercel prod, not
// .env.local — fail fast with the exact fix rather than a deep octokit error.
function assertGithubEnv(): void {
  const missing = GITHUB_ENV.filter((k) => !process.env[k])
  if (missing.length === 0) return
  console.error(`GitHub App creds missing: ${missing.join(', ')}`)
  console.error('They live in Vercel prod, not .env.local. Pull them:')
  console.error('  npx vercel env pull .env.local')
  console.error('(or copy the four values from the Vercel project settings), then re-run.')
  process.exit(1)
}

async function runPerTarget<T>(
  targets: ClientEntry[],
  fn: (t: ClientEntry) => Promise<T>,
  onOk: (t: ClientEntry, r: T) => void
): Promise<number> {
  let failures = 0
  for (const t of targets) {
    try {
      onOk(t, await fn(t))
    } catch (err) {
      failures++
      console.error(`  ✗ ${t.slug}: ${(err as Error).message}`)
    }
  }
  return failures
}

async function main(): Promise<void> {
  const [, , commandArg, ...rest] = process.argv
  const command = commandArg as Command
  if (!COMMANDS.includes(command)) {
    console.error(`Usage: fleet-rollout <${COMMANDS.join('|')}> [--group X | --slugs a,b | --all] [--yes] [--confirm-green]`)
    process.exit(1)
  }

  const { selection, yes, confirmGreen } = parseFlags(rest)
  const clients = loadClients()
  const manifest = loadManifest()
  const { targets, includedPaused } = resolveTargets(clients, selection)

  if (targets.length === 0) {
    console.log('No targets matched the selection. (Check managed/themeGroup/paused in config/clients.json.)')
    return
  }
  printTargets(targets)
  if (includedPaused.length > 0) {
    console.log(`⚠ Including PAUSED repo(s) because they were named explicitly: ${includedPaused.map((t) => t.slug).join(', ')}\n`)
  }

  assertGithubEnv()

  let failures = 0

  if (command === 'plan') {
    const payload = await collectTemplatePayload(manifest)
    console.log(`Template ${payload.templateSlug}: ${payload.entries.length} managed file(s).\n`)
    failures = await runPerTarget(
      targets,
      (t) => planRollout(t, manifest, payload),
      (t, p) => {
        console.log(`◆ ${t.displayName} (${t.slug})`)
        if (p.notATemplateSite) console.log('    ⚠ does NOT look like a template site — stage will refuse this repo')
        console.log(`    add ${p.adds.length} · update ${p.updates.length} · unchanged ${p.unchanged.length}`)
        if (p.updates.length) console.log(`    updates: ${p.updates.slice(0, 12).join(', ')}${p.updates.length > 12 ? ' …' : ''}`)
        if (p.flagged.length) console.log(`    ⚠ diverged (not auto-synced — review): ${p.flagged.join(', ')}`)
        console.log('')
      }
    )
  } else if (command === 'stage') {
    if (!(await confirm(`Stage the template rollout onto ${targets.length} repo(s)? (writes to their template-sync branch only)`, yes))) {
      console.log('Aborted.')
      return
    }
    const payload = await collectTemplatePayload(manifest)
    failures = await runPerTarget(
      targets,
      (t) => stageClient(t, payload, AUTHOR),
      (t, r) => {
        console.log(`  ✓ ${t.slug}: staged ${r.fileCount} file(s)${r.themeRegenerated ? ' + theme.css' : ''} → template-sync (${r.commitSha.slice(0, 7)})`)
        for (const w of r.warnings) console.log(`      ⚠ ${w}`)
      }
    )
    console.log('\nNext: verify each repo\'s `template-sync` Vercel preview build is green, then run `promote --confirm-green`.')
  } else if (command === 'status') {
    failures = await runPerTarget(
      targets,
      (t) => rolloutStatus(t),
      (t, s) => {
        const staged = s.compare.ahead > 0
        console.log(`  ${staged ? '●' : '○'} ${t.slug}: ${staged ? `staged (+${s.compare.ahead} ahead)` : 'nothing staged'}${s.compare.behind > 0 ? `, behind ${s.compare.behind}` : ''}`)
        if (staged) console.log(`      preview: ${s.previewHint}`)
      }
    )
  } else if (command === 'promote') {
    if (!confirmGreen) {
      console.error('Refusing to promote without --confirm-green. Verify every staged template-sync preview build is green first, then re-run with --confirm-green.')
      process.exit(1)
    }
    if (!(await confirm(`PROMOTE ${targets.length} repo(s) to LIVE (merge template-sync → main)?`, yes))) {
      console.log('Aborted.')
      return
    }
    failures = await runPerTarget(
      targets,
      (t) => promoteClient(t),
      (t, r) => {
        if (r.merge.merged) {
          console.log(`  ✓ ${t.slug}: ${r.merge.nothingToDo ? 'nothing to promote' : `LIVE (${r.merge.mergeCommitSha.slice(0, 7)})`}${r.draftSynced ? ' · draft synced' : ''}`)
        } else {
          console.log(`  ⚠ ${t.slug}: conflict — resolve PR: ${r.merge.prUrl}`)
        }
        for (const w of r.warnings) console.log(`      ⚠ ${w}`)
      }
    )
  } else if (command === 'rollback') {
    if (!(await confirm(`ROLLBACK the last fleet promote on ${targets.length} repo(s) (force main back to pre-rollout)?`, yes))) {
      console.log('Aborted.')
      return
    }
    failures = await runPerTarget(
      targets,
      (t) => rollbackClient(t),
      (t, r) => {
        if (r.reverted) console.log(`  ✓ ${t.slug}: reverted to ${r.revertedTo.slice(0, 7)}`)
        else console.log(`  – ${t.slug}: ${r.reason}`)
      }
    )
  }

  if (failures > 0) {
    console.error(`\n${failures} repo(s) failed.`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
