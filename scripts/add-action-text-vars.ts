// Rollout helper for template 2026.09.4: add ONLY the small-text action-colour
// tokens (--color-action-text / --color-action-on-primary, + the .dark
// override) to a client's EXISTING theme.css, computed from the palette values
// already in that file. Does not regenerate anything else (see
// lib/content/add-action-text-vars.ts). Idempotent.
//
//   npx tsx scripts/add-action-text-vars.ts <client-repo>/src/styles/theme.css [--check]
//
// --check: print what would be added and exit 1 if the file needs it (no write).
import { readFileSync, writeFileSync } from 'node:fs'
import chroma from 'chroma-js'
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
const action = css.match(/^\s*--color-action:\s*([^;]+);/m)?.[1].trim() ?? ''
const nearWhite = css.match(/^\s*--color-near-white:\s*([^;]+);/m)?.[1].trim() ?? ''
console.warn(
  `${file}: --color-action ${action} → --color-action-text ${r.colors.actionText} ` +
    `(${chroma.contrast(action, nearWhite).toFixed(2)} → ${chroma.contrast(r.colors.actionText, nearWhite).toFixed(2)} on ${nearWhite}), ` +
    `--color-action-on-primary ${r.colors.actionOnPrimary}, .dark ${r.darkBlock ? r.colors.darkActionText : '(no .dark block)'}`
)
if (check) process.exit(1)
writeFileSync(file, r.css, 'utf-8')
