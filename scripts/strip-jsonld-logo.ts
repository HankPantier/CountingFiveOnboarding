// One-shot content fix: drop the broken `"logo": "<origin>/logo.png"` from the
// Organization JSON-LD baked into client page files. The builder is fixed
// (lib/content/json-ld-builder.ts, 2818616); this repairs the files already in
// client repos, with the pure function lib/content/strip-jsonld-logo.ts.
//
// Runs on LOCAL clones' content/ directories. Dry run by default; idempotent.
//
//   npx tsx scripts/strip-jsonld-logo.ts <clone>/content [<clone2>/content ...]
//   npx tsx scripts/strip-jsonld-logo.ts <clone>/content --apply

import * as fs from 'fs'
import * as path from 'path'
import { stripBrokenJsonLdLogo } from '../lib/content/strip-jsonld-logo'

const apply = process.argv.includes('--apply')
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

let grandFiles = 0
let grandRemoved = 0
let grandSkipped = 0
for (const dir of dirs) {
  const root = path.resolve(dir)
  let files = 0
  let removed = 0
  let skipped = 0
  for (const file of mdFiles(root)) {
    const before = fs.readFileSync(file, 'utf-8')
    const res = stripBrokenJsonLdLogo(before)
    if (res.skipped) {
      skipped += res.skipped
      console.log(`  SKIP   ${path.relative(root, file)}  ${res.skipped} block(s) couldn't be edited safely`)
    }
    if (res.removed === 0) continue
    files++
    removed += res.removed
    if (apply) fs.writeFileSync(file, res.content)
  }
  console.log(`${apply ? 'APPLIED' : 'DRY RUN'} ${root}: ${files} file(s), ${removed} logo line(s) removed, ${skipped} block(s) skipped`)
  grandFiles += files
  grandRemoved += removed
  grandSkipped += skipped
}
if (dirs.length > 1) console.log(`\nTOTAL: ${grandFiles} file(s), ${grandRemoved} removed, ${grandSkipped} skipped`)
if (!apply) console.log('\nDry run — re-run with --apply to write.')
