// One-off repair: strip trailing slashes from the SOURCE column of a client
// clone's content/redirects.csv.
//
// The template runs with trailingSlash: false, so Next 308s `/a/` to `/a`
// before custom redirects run and then matches sources strictly: a `/a/` row
// never fires and the old url 404s. The builder and every editor/deploy write
// now normalize sources (lib/editor/redirects.ts normalizeRedirectSource); this
// fixes files already written. Destinations, comments, the header and every
// other row keep their bytes. Loops are not touched here (the next deploy's
// sanitize breaks those).
//
// Dry run by default; idempotent.
//
// Usage:
//   npx tsx scripts/repair-redirect-trailing-slash.ts <clone> [<clone2> ...]
//   npx tsx scripts/repair-redirect-trailing-slash.ts <clone> --apply

import * as fs from 'fs'
import * as path from 'path'
import { normalizeRedirectSource, normalizeRedirectSources, parseRedirectRows } from '../lib/editor/redirects'

const apply = process.argv.includes('--apply')
const clones = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (clones.length === 0) {
  console.error('Provide one or more local client clone directories')
  process.exit(1)
}

let changedFiles = 0
for (const clone of clones) {
  const file = path.join(path.resolve(clone), 'content', 'redirects.csv')
  if (!fs.existsSync(file)) {
    console.log(`${clone}: no content/redirects.csv`)
    continue
  }
  const before = fs.readFileSync(file, 'utf-8')
  const after = normalizeRedirectSources(before)
  if (after === before) {
    console.log(`${clone}: ok (no trailing-slash sources)`)
    continue
  }
  changedFiles++
  const fixed = parseRedirectRows(before).filter((r) => normalizeRedirectSource(r.from) !== r.from)
  console.log(`${clone}: ${fixed.length} source(s) ${apply ? 'fixed' : 'would be fixed'}`)
  for (const r of fixed) console.log(`  ${r.from} -> ${normalizeRedirectSource(r.from)}  (to ${r.to})`)
  if (apply) fs.writeFileSync(file, after)
}

console.log(
  apply
    ? `\n${changedFiles} file(s) written`
    : `\n${changedFiles} file(s) would change. Re-run with --apply to write.`
)
