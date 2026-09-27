// Rollout helper for template 2026.09.4: add ONLY the small-text action-colour
// tokens (--color-action-text / -text-canvas / -text-tint / -on-primary /
// -on-ink, + the .dark overrides) to a client's EXISTING theme.css, computed
// from the surfaces that file already renders. Does not regenerate anything
// else (see lib/content/add-action-text-vars.ts). Idempotent.
//
// DRY RUN by default (like fleet-sync and strip-leaked-generator-notes):
//
//   npx tsx scripts/add-action-text-vars.ts <client-repo>/src/styles/theme.css            # report only
//   npx tsx scripts/add-action-text-vars.ts <client-repo>/src/styles/theme.css --apply    # add missing tokens
//   ... --apply --refresh-tint   # ALSO rewrite stale --color-action-text-tint values in a file
//                                # that already has the tokens (the fleet leaves those alone)
//
// Exit code: 1 when the file needs a change that was not written, else 0 (2 on error).
import { readFileSync, writeFileSync } from 'node:fs'
import { addActionTextVars } from '../lib/content/add-action-text-vars'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
const apply = args.includes('--apply')
const refreshTint = args.includes('--refresh-tint')
if (!file) {
  console.error('usage: npx tsx scripts/add-action-text-vars.ts <path/to/theme.css> [--apply [--refresh-tint]]')
  process.exit(2)
}

const css = readFileSync(file, 'utf-8')
const r = addActionTextVars(css)
if (r.status === 'error') {
  console.error(`${file}: ${r.error}`)
  process.exit(2)
}
if (r.status === 'unchanged') {
  console.warn(`${file}: already has the action-text tokens — nothing to do`)
  process.exit(0)
}
if (r.status === 'updated') {
  console.warn(`${file}: stale --color-action-text-tint: ${r.changed.join('; ')}`)
  if (!apply || !refreshTint) {
    console.warn(`${file}: left as is (the fleet does not refresh tints). Pass --apply --refresh-tint to rewrite them.`)
    process.exit(1)
  }
  writeFileSync(file, r.css, 'utf-8')
  console.warn(`${file}: tint refreshed`)
  process.exit(0)
}
const action = css.match(/^\s*--color-action:\s*([^;]+);/m)?.[1].trim() ?? ''
console.warn(
  `${file}: --color-action ${action} → -text ${r.light.actionText}, -text-tint ${r.light.actionTextTint}, ` +
    `-on-primary ${r.light.actionOnPrimary}, -on-ink ${r.light.actionOnInk}; ` +
    (r.dark ? `.dark -text ${r.dark.actionText}, -text-tint ${r.dark.actionTextTint}` : '(no .dark block)')
)
if (!apply) {
  console.warn(`${file}: DRY RUN — nothing written. Re-run with --apply.`)
  process.exit(1)
}
writeFileSync(file, r.css, 'utf-8')
console.warn(`${file}: tokens added`)
