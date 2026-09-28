// Block annotation scan — read-only survey of every managed client's page
// bodies against the block catalog contract (lib/content/block-catalog.ts).
//
//   # 1. fresh checkouts of each managed repo's draft branch under one root:
//   #    for s in $(jq -r '.clients[]|select(.managed).slug' config/clients.json); do
//   #      git clone -q --depth 1 --branch draft "https://github.com/$s.git" "$ROOT/${s#*/}"; done
//   # 2. scan them:
//   npx tsx scripts/scan-block-annotations.ts --root $ROOT
//   npx tsx scripts/scan-block-annotations.ts --root $ROOT --slugs bblcpa -v --json out.json
//
// Per repo: unknown block ids, inline page openers, invalid variants/themes,
// mangled + stray (heading-less) annotations, themes in use, and the page
// opener (hero, hero_variant) pairs. Scans content/pages/**.md (posts strip
// annotations at render). Writes nothing except the optional --json report.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { loadClients, repoName, resolveTargets } from '../lib/fleet/registry'
import type { TargetSelection } from '../lib/fleet/types'
import { scanPageFile, summarizeScans, type RepoScanSummary } from '../lib/content/block-annotation-scan'

function parseArgs(argv: string[]) {
  const selection: TargetSelection = {}
  let root: string | null = null
  let json: string | null = null
  let verbose = false
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i]
    if (f === '--root') root = path.resolve(argv[++i] ?? '')
    else if (f === '--all') selection.all = true
    else if (f === '--group') selection.group = argv[++i]
    else if (f === '--slugs') selection.slugs = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    else if (f === '--json') json = path.resolve(argv[++i] ?? 'block-scan.json')
    else if (f === '-v' || f === '--verbose') verbose = true
    else throw new Error(`Unknown argument: ${f}`)
  }
  if (!root) throw new Error('--root <dir with one checkout per managed repo> is required')
  if (!selection.all && !selection.group && !selection.slugs?.length) selection.all = true
  return { selection, root, json, verbose }
}

function walkMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walkMarkdown(full))
    else if (name.endsWith('.md')) out.push(full)
  }
  return out
}

const fmt = (rec: Record<string, number> | undefined) =>
  Object.entries(rec ?? {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, n]) => `${k} ×${n}`)
    .join(', ') || '—'

function main(): void {
  const { selection, root, json, verbose } = parseArgs(process.argv.slice(2))
  const { targets } = resolveTargets(loadClients(), selection)
  const report: Record<string, RepoScanSummary | { error: string }> = {}
  for (const client of targets) {
    const name = repoName(client.slug)
    const pagesDir = path.join(root, name, 'content', 'pages')
    if (!existsSync(pagesDir)) {
      report[name] = { error: `no checkout at ${pagesDir}` }
      console.log(`\n## ${name}: no checkout at ${pagesDir}`)
      continue
    }
    const scans = walkMarkdown(pagesDir).map((file) => scanPageFile(path.relative(pagesDir, file), readFileSync(file, 'utf-8')))
    const s = summarizeScans(scans)
    report[name] = s
    const count = (k: keyof RepoScanSummary['issues']) => Object.values(s.issues[k] ?? {}).reduce((a, b) => a + b, 0)
    console.log(`\n## ${name} — ${s.pages} pages, ${Object.keys(s.pagesWithIssues).length} with issues`)
    console.log(`  invalid variants (${count('invalid-variant')}): ${fmt(s.issues['invalid-variant'])}`)
    console.log(`  invalid themes (${count('invalid-theme')}): ${fmt(s.issues['invalid-theme'])}`)
    console.log(`  unknown ids (${count('unknown-block')}): ${fmt(s.issues['unknown-block'])}`)
    console.log(`  inline page openers (${count('frontmatter-inline')}): ${fmt(s.issues['frontmatter-inline'])}`)
    console.log(`  stray heading-less (${count('stray')}): ${fmt(s.issues.stray)}`)
    console.log(`  unparseable (${count('unparseable')}): ${fmt(s.issues.unparseable)}`)
    console.log(`  themes in use: ${fmt(s.themes)}`)
    console.log(`  hero pairs: ${fmt(s.heroPairs)}`)
    if (verbose) for (const [p, n] of Object.entries(s.pagesWithIssues)) console.log(`    ${p}: ${n}`)
  }
  if (json) {
    writeFileSync(json, JSON.stringify(report, null, 2) + '\n')
    console.log(`\nWrote ${json}`)
  }
}

main()
