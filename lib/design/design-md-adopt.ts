// "Regenerate design.md" (Design Studio → Versions). Every fleet design.md
// predates the body-hash marker, so a Studio commit treats it as hand-written
// and never rewrites it (designMdRewrite). This is the explicit, admin-only way
// to ADOPT the generated file for a site: preview what would change, then
// commit it on a human click — never automatically.
//
// Pure: callers load the draft's design.md, brand.json + design.json and the
// session schema, and commit through the guarded writeFiles path.
import { createHash } from 'node:crypto'
import type { BrandJson } from '@/types/brand-json'
import type { DesignJson } from '@/types/design-json'
import type { SessionSchema } from '@/types/session-schema'
import { buildDesignMdFromTheme, designMdHashState, isGeneratedDesignMd } from '@/lib/content/design-md-builder'
import { isPlainObject } from './input-validation'
import type { DesignMdState, DiffLine } from './design-md-ui'

export type { DesignMdState, DiffLine }

// What the current file is, for the operator (DesignMdState):
//   absent       — no content/design.md on the draft
//   hand-written — not this platform's scaffolding (or reshaped by hand)
//   legacy       — the platform's file from before the hash marker
//   edited       — the platform's file, edited by hand since it was written
//   untouched    — the platform's file, byte-for-byte as generated

export type DesignMdPreview = {
  state: DesignMdState
  // Blob sha of the current file (null when absent) — the commit's guard.
  currentSha: string | null
  unchanged: boolean
  // sha256 of the generated text — POST must echo it, so what is committed is
  // exactly what the admin reviewed.
  nextHash: string
  next: string
  diff: DiffLine[]
  added: number
  removed: number
}

export function designMdState(current: string | null): DesignMdState {
  if (current === null) return 'absent'
  if (!isGeneratedDesignMd(current)) return 'hand-written'
  return designMdHashState(current)
}

export const hashDesignMd = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

// Only concept / chat versions carry a design direction (a baseline or a
// capture is just "the draft as it was"); mirrors commit-version's rule that
// a restore writes no direction.
export function directionFromVersionBundle(source: string | null, bundle: unknown): { name: string; tagline: string; moves: string[] } | undefined {
  if (source !== 'concept' && source !== 'chat') return undefined
  if (!isPlainObject(bundle) || typeof bundle.name !== 'string') return undefined
  const moves = Array.isArray(bundle.moves) ? bundle.moves.filter((m): m is string => typeof m === 'string') : []
  return { name: bundle.name, tagline: typeof bundle.tagline === 'string' ? bundle.tagline : '', moves }
}

/** The generated design.md for the draft's theme, or an error when the theme files can't be read. */
export function generateDesignMd(args: {
  brandText: string
  designText: string
  schema: unknown
  direction?: { name: string; tagline: string; moves: string[] }
}): { ok: true; text: string } | { ok: false; error: string } {
  let brand: BrandJson
  let design: DesignJson
  try {
    brand = JSON.parse(args.brandText) as BrandJson
    design = JSON.parse(args.designText) as DesignJson
  } catch {
    return { ok: false, error: 'brand.json or design.json on the draft is not valid JSON — fix it before regenerating design.md.' }
  }
  if (!isPlainObject(brand.palette) || !isPlainObject(design.typography)) {
    return { ok: false, error: 'The draft’s brand.json / design.json are missing the palette or typography design.md is built from.' }
  }
  const schema = isPlainObject(args.schema) ? (args.schema as SessionSchema) : null
  return { ok: true, text: buildDesignMdFromTheme({ brand, design, schema, ...(args.direction ? { direction: args.direction } : {}) }) }
}

const MAX_DIFF_CELLS = 4_000_000

/**
 * Line diff (LCS) of `before` → `after`. Files beyond the cell budget fall
 * back to "all removed, all added" rather than spending unbounded time.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before === '' ? [] : before.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
  const b = after === '' ? [] : after.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
  if (a.length * b.length > MAX_DIFF_CELLS) {
    return [...a.map((text) => ({ op: 'del' as const, text })), ...b.map((text) => ({ op: 'add' as const, text }))]
  }
  // lcs[i][j] = LCS length of a[i..] and b[j..]
  const lcs: Uint32Array[] = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ op: 'same', text: a[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ op: 'del', text: a[i++] })
    } else {
      out.push({ op: 'add', text: b[j++] })
    }
  }
  while (i < a.length) out.push({ op: 'del', text: a[i++] })
  while (j < b.length) out.push({ op: 'add', text: b[j++] })
  return out
}

export function previewDesignMd(current: { content: string; sha: string } | null, next: string): DesignMdPreview {
  const diff = diffLines(current?.content ?? '', next)
  return {
    state: designMdState(current?.content ?? null),
    currentSha: current?.sha ?? null,
    unchanged: current !== null && current.content === next,
    nextHash: hashDesignMd(next),
    next,
    diff,
    added: diff.filter((d) => d.op === 'add').length,
    removed: diff.filter((d) => d.op === 'del').length,
  }
}
