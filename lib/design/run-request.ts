// Pure + client-safe. Validation for POST design/runs. The page path is
// DECODED before any check (CLAUDE.md security rule 8); the renderer's
// resolvePreviewPageUrl re-validates it against the preview origin later.
// A decoded path that still contains a '%' is rejected too, so a downstream
// single decode (e.g. inside the renderer) stays idempotent.
import { isPlainObject, isUuid, parseOptionalText } from './input-validation'
import { PALETTE_FREEDOMS } from './studio-types'
import {
  ADMIN_BRIEF_MAX,
  CONCEPT_COUNT_MAX,
  CONCEPT_COUNT_MIN,
  DEFAULT_CONCEPT_COUNT,
  DEFAULT_PALETTE_FREEDOM,
  DEFAULT_RUN_PAGE,
  MAX_RUN_INPUTS,
  type PaletteFreedom,
} from './run-types'

const PAGE_PATH_MAX = 200

export type CreateRunRequest = {
  paletteFreedom: PaletteFreedom
  adminBrief: string | null
  inputIds: string[]
  conceptCount: number
  pagePath: string
}

export function normalizeRunPagePath(raw: unknown): { ok: true; path: string } | { ok: false; reason: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, path: DEFAULT_RUN_PAGE }
  if (typeof raw !== 'string') return { ok: false, reason: 'pagePath must be text.' }
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    return { ok: false, reason: 'pagePath is not valid URL encoding.' }
  }
  if (decoded.length > PAGE_PATH_MAX) return { ok: false, reason: 'pagePath is too long.' }
  if (!decoded.startsWith('/') || decoded.startsWith('//')) return { ok: false, reason: 'pagePath must start with a single "/".' }
  if (/[\s\\?#%]/.test(decoded)) return { ok: false, reason: 'pagePath must be a plain path.' }
  if (decoded.split('/').some((seg) => seg === '..' || seg === '.')) return { ok: false, reason: 'pagePath must not contain "." or ".." segments.' }
  return { ok: true, path: decoded }
}

export function parseCreateRunBody(raw: unknown): { ok: true; value: CreateRunRequest } | { ok: false; reason: string } {
  if (!isPlainObject(raw)) return { ok: false, reason: 'Invalid JSON body.' }

  const freedom = raw.paletteFreedom ?? DEFAULT_PALETTE_FREEDOM
  if (typeof freedom !== 'string' || !(PALETTE_FREEDOMS as readonly string[]).includes(freedom)) {
    return { ok: false, reason: 'paletteFreedom must be keep, evolve or free.' }
  }

  const count = raw.conceptCount ?? DEFAULT_CONCEPT_COUNT
  if (typeof count !== 'number' || !Number.isInteger(count) || count < CONCEPT_COUNT_MIN || count > CONCEPT_COUNT_MAX) {
    return { ok: false, reason: 'conceptCount must be 2 or 3.' }
  }

  const ids = raw.inputIds ?? []
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !isUuid(id))) {
    return { ok: false, reason: 'inputIds must be a list of input ids.' }
  }
  const inputIds = Array.from(new Set(ids as string[]))
  if (inputIds.length > MAX_RUN_INPUTS) return { ok: false, reason: `Pick at most ${MAX_RUN_INPUTS} inputs.` }

  const brief = parseOptionalText(raw.adminBrief, ADMIN_BRIEF_MAX, 'The brief')
  if (!brief.ok) return { ok: false, reason: brief.reason }

  const page = normalizeRunPagePath(raw.pagePath)
  if (!page.ok) return { ok: false, reason: page.reason }

  return {
    ok: true,
    value: { paletteFreedom: freedom as PaletteFreedom, adminBrief: brief.value, inputIds, conceptCount: count, pagePath: page.path },
  }
}
