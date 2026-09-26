import { describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

// CLAUDE.md: "All model ids live in lib/content/generation-tuning.ts — import the
// constant, never hardcode an id." Nine generators had drifted to a literal
// 'claude-sonnet-5' (and brand-doc recorded usage under a literal while calling
// the constant), so a tier swap would have left most of the pipeline behind.
const ROOT = path.join(__dirname, '..', '..')
const SCAN_DIRS = ['lib', 'app', 'components', 'scripts']
// The two files whose job is to name model ids.
const ALLOWED = new Set(['lib/content/generation-tuning.ts', 'lib/content/token-pricing.ts'])
const MODEL_ID_LITERAL = /['"`]claude-(?:sonnet|opus|haiku|fable)-[\w.-]+['"`]/

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__fixtures__' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|mjs|js)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
}

describe('model ids', () => {
  it('are never hardcoded outside generation-tuning.ts / token-pricing.ts', () => {
    const files: string[] = []
    for (const d of SCAN_DIRS) {
      const full = path.join(ROOT, d)
      if (fs.existsSync(full)) walk(full, files)
    }
    const offenders = files
      .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) =>
        fs
          .readFileSync(path.join(ROOT, rel), 'utf-8')
          .split('\n')
          // Comments may name a model (usage docs, history notes).
          .some((line) => !/^\s*(\/\/|\*)/.test(line) && MODEL_ID_LITERAL.test(line))
      )
    expect(offenders).toEqual([])
  })
})
