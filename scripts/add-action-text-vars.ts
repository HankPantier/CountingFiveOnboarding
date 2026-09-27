// Rollout helper for template 2026.09.4: add ONLY the small-text action-colour
// tokens (--color-action-text / -text-canvas / -text-tint / -on-primary /
// -on-ink, + the .dark overrides) to a client's EXISTING theme.css, computed
// from the surfaces that file already renders. A file that already has them
// gets only its stale --color-action-text-tint value(s) refreshed. Does not
// regenerate anything else (see lib/content/add-action-text-vars.ts). Idempotent.
//
//   npx tsx scripts/add-action-text-vars.ts <client-repo>/src/styles/theme.css [--check]
//
// --check: print what would be added / refreshed and exit 1 if the file needs it (no write).
import { readFileSync, writeFileSync } from 'node:fs'
import { addActionTextVars } from '../lib/content/add-action-text-vars'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
const check = args.includes('--check')
if (!file) {
  console.error('usage: npx tsx scripts/add-action-text-vars.ts <path/to/theme.css> [--check]')
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
  console.warn(`${file}: refreshed --color-action-text-tint: ${r.changed.join('; ')}`)
  if (check) process.exit(1)
  writeFileSync(file, r.css, 'utf-8')
  process.exit(0)
}
const action = css.match(/^\s*--color-action:\s*([^;]+);/m)?.[1].trim() ?? ''
console.warn(
  `${file}: --color-action ${action} → -text ${r.light.actionText}, -text-tint ${r.light.actionTextTint}, ` +
    `-on-primary ${r.light.actionOnPrimary}, -on-ink ${r.light.actionOnInk}; ` +
    (r.dark ? `.dark -text ${r.dark.actionText}, -text-tint ${r.dark.actionTextTint}` : '(no .dark block)')
)
if (check) process.exit(1)
writeFileSync(file, r.css, 'utf-8')
