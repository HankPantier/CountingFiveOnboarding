// One-shot content fix: remove generator notes that render on live client sites.
//
// buildPageMarkdown appends a review trailer to every page file
// ("## SEO & AIO Metadata" with **Answer Block:** / **E-E-A-T Signals:** /
// **Internal Links:** / **FAQ Block:** / **LLM Citation Note:**, then
// "## Structured Data — paste into `<head>`" with the JSON-LD). The template's
// PAGE renderer trims it; the POST renderer does not. Pages moved into
// content/posts/ via the editor therefore render the whole trailer. The source
// is fixed (lib/editor/relocate.ts, lib/content/post-markdown.ts); this repairs
// the files already written. Same pure functions as the app:
// lib/content/strip-generator-notes.ts.
//
//   content/posts/*.md  → trailer stripped. Frontmatter stays byte-identical,
//                         except an EMPTY/missing answer_block / eeat_signals /
//                         internal_links / faq_block / llm_citation_note is
//                         filled from the trailer so no data is lost.
//   content/pages/*.md  → trailer KEPT (the template trims it and reuses the
//                         JSON-LD). Only a page whose SEO marker was edited away
//                         (its Structured Data block renders live) gets the
//                         marker restored.
//
// Runs on a LOCAL clone's content/ directory. Dry run by default; idempotent.
//
// Usage:
//   npx tsx scripts/strip-leaked-generator-notes.ts <clone>/content [<clone2>/content ...]
//   npx tsx scripts/strip-leaked-generator-notes.ts <clone>/content --apply
//   add --quiet to print only the per-directory totals

import * as fs from 'fs'
import * as path from 'path'
import { repairPageTrailer, stripGeneratorNotesFromFile } from '../lib/content/strip-generator-notes'

const apply = process.argv.includes('--apply')
const quiet = process.argv.includes('--quiet')
const dirs = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (dirs.length === 0) {
  console.error('Provide one or more content/ directories of a local client clone')
  process.exit(1)
}

function mdFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) return mdFiles(p)
      return e.isFile() && e.name.endsWith('.md') ? [p] : []
    })
    .sort()
}

interface Totals {
  skipped: number
  postsStripped: number
  pagesRepaired: number
  pagesWithTrailerKept: number
  charsRemoved: number
  backfilled: number
  labels: Record<string, number>
}

const grand: Totals = { skipped: 0, postsStripped: 0, pagesRepaired: 0, pagesWithTrailerKept: 0, charsRemoved: 0, backfilled: 0, labels: {} }

for (const dir of dirs) {
  const root = path.resolve(dir)
  const t: Totals = { skipped: 0, postsStripped: 0, pagesRepaired: 0, pagesWithTrailerKept: 0, charsRemoved: 0, backfilled: 0, labels: {} }

  for (const file of mdFiles(path.join(root, 'posts'))) {
    const before = fs.readFileSync(file, 'utf-8')
    const res = stripGeneratorNotesFromFile(before)
    if (res.warning) {
      // Content follows the trailer: never cut blind. Report for a human.
      t.skipped++
      console.log(`  SKIP   ${path.relative(root, file)}  ${res.warning}`)
      continue
    }
    if (!res.changed) continue
    t.postsStripped++
    t.charsRemoved += before.length - res.content.length
    t.backfilled += res.backfilled.length
    for (const l of res.removed) t.labels[l] = (t.labels[l] ?? 0) + 1
    if (!quiet) {
      const fill = res.backfilled.length ? `; backfilled ${res.backfilled.join(', ')}` : ''
      console.log(`  strip  ${path.relative(root, file)}  −${before.length - res.content.length} chars  [${res.removed.join(', ')}]${fill}`)
    }
    if (apply) fs.writeFileSync(file, res.content)
  }

  for (const file of mdFiles(path.join(root, 'pages'))) {
    const before = fs.readFileSync(file, 'utf-8')
    if (/\n---\n##\s+SEO\s*&(?:amp;)?\s*AIO Metadata\b/i.test(before)) t.pagesWithTrailerKept++
    const res = repairPageTrailer(before)
    if (!res.changed) continue
    t.pagesRepaired++
    if (!quiet) console.log(`  repair ${path.relative(root, file)}  restored "## SEO & AIO Metadata" marker above a live Structured Data block`)
    if (apply) fs.writeFileSync(file, res.content)
  }

  console.log(
    `${apply ? 'APPLIED' : 'DRY RUN'} ${root}: ${t.postsStripped} post(s) stripped (−${t.charsRemoved} chars, ${t.backfilled} field(s) backfilled), ` +
      `${t.pagesRepaired} page(s) repaired, ${t.pagesWithTrailerKept} page trailer(s) kept (template-trimmed), ` +
      `${t.skipped} skipped (content after trailer). ` +
      `Labels: ${Object.entries(t.labels).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`
  )
  grand.skipped += t.skipped
  grand.postsStripped += t.postsStripped
  grand.pagesRepaired += t.pagesRepaired
  grand.pagesWithTrailerKept += t.pagesWithTrailerKept
  grand.charsRemoved += t.charsRemoved
  grand.backfilled += t.backfilled
  for (const [k, v] of Object.entries(t.labels)) grand.labels[k] = (grand.labels[k] ?? 0) + v
}

if (dirs.length > 1) {
  console.log(
    `\nTOTAL: ${grand.postsStripped} post(s) stripped (−${grand.charsRemoved} chars, ${grand.backfilled} field(s) backfilled), ` +
      `${grand.pagesRepaired} page(s) repaired, ${grand.pagesWithTrailerKept} page trailer(s) kept, ${grand.skipped} skipped. ` +
      `Labels: ${Object.entries(grand.labels).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`
  )
}
if (!apply) console.log('\nDry run — re-run with --apply to write. Commit + republish each repo to go live.')
