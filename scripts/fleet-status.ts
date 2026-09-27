// Fleet status — read-only health of every managed client repo (R4 quick win 7).
//
//   npx tsx scripts/fleet-status.ts                 # the managed roster
//   npx tsx scripts/fleet-status.ts --slugs bblcpa  # one repo, with findings
//   npx tsx scripts/fleet-status.ts --json out.json
//
// Per repo: template version on main/draft (vs the template checkout's latest)
// + syncedFrom, theme.css state (in-sync | additive | palette | other) vs
// brand.json + design.json, fonts module kind/staleness, unpublished draft
// files, Vercel status (main/draft), last CI run, and design-overrides.css
// rules that shadow template-owned tokens. Uses the operator's `gh` auth.
// Writes nothing (except the optional --json report file).
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { loadClients, repoName, resolveTargets } from '../lib/fleet/registry'
import { clientHealth, type ClientHealth } from '../lib/fleet/status'
import { pool } from '../lib/fleet/verify'
import { readMarker } from '../lib/fleet/special-files'
import { showText } from '../lib/fleet/git-local'
import type { TargetSelection } from '../lib/fleet/types'

function parseArgs(argv: string[]) {
  const selection: TargetSelection = {}
  let json: string | null = null
  let templateDir = process.env.FLEET_TEMPLATE_DIR ?? path.resolve(process.cwd(), '..', 'counting-five-client-template')
  let verbose = false
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i]
    if (f === '--all') selection.all = true
    else if (f === '--group') selection.group = argv[++i]
    else if (f === '--slugs') selection.slugs = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    else if (f === '--json') json = path.resolve(argv[++i] ?? 'fleet-status.json')
    else if (f === '--template') templateDir = path.resolve(argv[++i] ?? '')
    else if (f === '-v' || f === '--verbose') verbose = true
    else throw new Error(`Unknown argument: ${f}`)
  }
  if (!selection.all && !selection.group && !selection.slugs?.length) selection.all = true
  if (selection.slugs?.length) verbose = true
  return { selection, json, templateDir, verbose }
}

function latestTemplateVersion(dir: string): string | null {
  if (!existsSync(path.join(dir, 'c5-template.json'))) return null
  return readMarker(showText(dir, 'main', 'c5-template.json')).templateVersion
}

const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n))

function row(h: ClientHealth): string {
  const m = h.main
  const ver = m ? `${m.templateVersion ?? '?'}${h.draft && h.draft.templateVersion !== m.templateVersion ? `/${h.draft.templateVersion ?? '?'}` : ''}` : 'unreadable'
  const synced = m?.syncedFrom ? m.syncedFrom.slice(0, 7) : '-'
  const theme = m ? `${m.theme}${m.theme === 'palette' ? `(${m.committedAction ?? '?'})` : ''}` : '?'
  const fonts = m ? `${m.fontsKind ?? 'none'}${m.fontsStale ? '*' : ''}` : '?'
  const draft = h.draftAhead ? `${h.draftAhead.files}f` : '?'
  const ov = `${h.overrides.ownedShadows}o/${h.overrides.tailwindSelectors}t/${h.overrides.colorLiterals}c/${h.overrides.important}!`
  return [pad(repoName(h.slug), 24), pad(ver, 12), pad(synced, 8), pad(theme, 20), pad(fonts, 9), pad(draft, 6), pad(`${h.vercelMain}/${h.vercelDraft}`, 16), pad(h.ci, 9), ov].join(' ')
}

async function main(): Promise<void> {
  const { selection, json, templateDir, verbose } = parseArgs(process.argv.slice(2))
  const { targets } = resolveTargets(loadClients(), selection)
  const latest = latestTemplateVersion(templateDir)
  console.log(`Fleet status — ${targets.length} repo(s); latest template ${latest ?? 'unknown (no template checkout)'}\n`)
  console.log(['repo'.padEnd(24), 'template'.padEnd(12), 'synced'.padEnd(8), 'theme.css (main)'.padEnd(20), 'fonts'.padEnd(9), 'draft+'.padEnd(6), 'vercel main/draft'.padEnd(16), 'CI'.padEnd(9), 'overrides o/t/c/!'].join(' '))
  const rows = await pool(targets, 4, (t) => clientHealth(t, latest))
  for (const h of rows) console.log(row(h))
  console.log('\nfonts * = stale vs design.json · overrides: o=owned-token shadows t=tailwind-keyed selectors c=colour literals !=!important')
  for (const h of rows) {
    if (!h.problems.length && !verbose) continue
    console.log(`\n${h.displayName} (${h.slug})`)
    for (const p of h.problems) console.log(`  • ${p}`)
    if (verbose) for (const f of h.overrides.findings) console.log(`    - [${f.kind}] ${f.selector ? `${f.selector} → ` : ''}${f.detail}`)
  }
  if (json) {
    writeFileSync(json, JSON.stringify({ latest, generatedAt: new Date().toISOString(), repos: rows }, null, 2))
    console.log(`\nwrote ${json}`)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
