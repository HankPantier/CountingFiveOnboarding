// Pure. Command-line parsing + usage text for scripts/compare-design-models.ts.
import { isUuid } from '../input-validation'
import { PALETTE_FREEDOMS } from '../studio-types'
import { ADMIN_BRIEF_MAX, CONCEPT_COUNT_MAX, DEFAULT_PALETTE_FREEDOM, MAX_RUN_INPUTS, type PaletteFreedom } from '../run-types'

export const DEFAULT_AB_CONCEPTS = 2
export const DEFAULT_AB_CAP_USD = 15
export const MAX_AB_CAP_USD = 100
export const MAX_AB_PAGES = 5

export type AbInputsChoice = { kind: 'all' } | { kind: 'none' } | { kind: 'ids'; ids: string[] }

export type AbArgs = {
  sessionId: string
  concepts: number
  models: string[]
  pages: string[] | null // null ⇒ the representative pages (pickRepresentativePages)
  capUsd: number
  critic: boolean
  criticModel: string // the judge (used only when critic is true)
  out: string | null // null ⇒ tmp/design-ab/<sessionId>-<timestamp>/
  brief: string | null
  palette: PaletteFreedom
  inputs: AbInputsChoice
}

export type ParsedAbArgs = { kind: 'help' } | { kind: 'error'; error: string } | { kind: 'ok'; args: AbArgs }

export type AbDefaults = { models: string[]; critic: string }

export function abUsage(defaults: AbDefaults): string {
  return `Design Studio model A/B — generate concepts for one client with each model from the SAME
prompt, render them, judge them with the same critic, and write a side-by-side report.

Usage:
  npx tsx scripts/compare-design-models.ts <sessionId> [options]

Options:
  --concepts <n>        concepts per model, 1-${CONCEPT_COUNT_MAX} (default ${DEFAULT_AB_CONCEPTS})
  --models <a,b,...>    model ids to compare (default ${defaults.models.join(',')})
  --pages </,/x,...>    pages to render, at most ${MAX_AB_PAGES}; the FIRST is the page whose markup
                        goes into the prompt and whose renders the critic judges
                        (default: the Studio's representative pages, home first)
  --cap <usd>           hard spend cap for the whole run, critic included (default ${DEFAULT_AB_CAP_USD}, max ${MAX_AB_CAP_USD});
                        every call, its retry and its repair are bounded by it
  --critic <modelId>    the judge for every concept (default ${defaults.critic} — not a contender;
                        a judge that is also a compared model is warned about and flagged)
  --no-critic           skip the critic (renders + metrics only)
  --brief "<text>"      admin brief (default: none), at most ${ADMIN_BRIEF_MAX} chars
  --palette <mode>      palette freedom: ${PALETTE_FREEDOMS.join(' | ')} (default ${DEFAULT_PALETTE_FREEDOM})
  --inputs <choice>     reference images: all | none | <inputId,...> (default all — the
                        session's captured, non-archived Design Studio inputs, first ${MAX_RUN_INPUTS})
  --out <dir>           output directory (default <repo>/tmp/design-ab/<sessionId>-<timestamp>/)
  --help                show this help and exit (no model is called)

Environment (.env.local is loaded): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
ANTHROPIC_API_KEY, the GitHub App credentials, and CHROMIUM_EXECUTABLE_PATH (a local
Chrome/Chromium binary, e.g. "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
— without it nothing renders and the critic is skipped.

Read-only: no design run, concept, version or chat row is written, nothing is committed to
GitHub or uploaded to Storage. The ONLY writes are token_usage rows (real spend) under the
normal design_concept / design_critique stages, attributed to the session's content job and
its creator — on the Token Usage dashboard A/B spend shows up as ordinary Design Studio spend.
The session's draft branch must already exist (open the Design Studio once).`
}

const PATH_RE = /^\/[a-z0-9\-/]*$/i

function splitList(v: string): string[] {
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function parseAbArgs(argv: string[], defaults: AbDefaults): ParsedAbArgs {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) return { kind: 'help' }
  const err = (error: string): ParsedAbArgs => ({ kind: 'error', error })
  const out: Omit<AbArgs, 'sessionId'> & { sessionId: string | null } = {
    sessionId: null,
    concepts: DEFAULT_AB_CONCEPTS,
    models: [...defaults.models],
    pages: null,
    capUsd: DEFAULT_AB_CAP_USD,
    critic: true,
    criticModel: defaults.critic,
    out: null,
    brief: null,
    palette: DEFAULT_PALETTE_FREEDOM,
    inputs: { kind: 'all' },
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--no-critic') {
      out.critic = false
      continue
    }
    if (!a.startsWith('--')) {
      if (out.sessionId !== null) return err(`Unexpected argument "${a}"`)
      out.sessionId = a
      continue
    }
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) return err(`${a} needs a value`)
    i++
    switch (a) {
      case '--concepts': {
        const n = Number(value)
        if (!Number.isInteger(n) || n < 1 || n > CONCEPT_COUNT_MAX) return err(`--concepts must be an integer 1-${CONCEPT_COUNT_MAX}`)
        out.concepts = n
        break
      }
      case '--models': {
        const models = [...new Set(splitList(value))]
        if (models.length === 0) return err('--models needs at least one model id')
        out.models = models
        break
      }
      case '--pages': {
        const pages = [...new Set(splitList(value))]
        if (pages.length === 0 || pages.length > MAX_AB_PAGES) return err(`--pages needs 1-${MAX_AB_PAGES} paths`)
        const bad = pages.find((p) => !PATH_RE.test(p) || p.includes('//'))
        if (bad) return err(`--pages: "${bad}" is not a site path like /services`)
        out.pages = pages
        break
      }
      case '--cap': {
        const n = Number(value)
        if (!Number.isFinite(n) || n <= 0 || n > MAX_AB_CAP_USD) return err(`--cap must be a number of USD in (0, ${MAX_AB_CAP_USD}]`)
        out.capUsd = n
        break
      }
      case '--critic': {
        const model = value.trim()
        if (!model || model.includes(',')) return err('--critic takes exactly one model id')
        out.criticModel = model
        break
      }
      case '--out':
        out.out = value
        break
      case '--brief': {
        const brief = value.trim()
        if (brief.length > ADMIN_BRIEF_MAX) return err(`--brief is longer than ${ADMIN_BRIEF_MAX} characters`)
        out.brief = brief || null
        break
      }
      case '--palette':
        if (!(PALETTE_FREEDOMS as readonly string[]).includes(value)) return err(`--palette must be one of ${PALETTE_FREEDOMS.join(', ')}`)
        out.palette = value as PaletteFreedom
        break
      case '--inputs': {
        if (value === 'all' || value === 'none') {
          out.inputs = { kind: value }
          break
        }
        const ids = [...new Set(splitList(value))]
        if (ids.length === 0 || ids.some((id) => !isUuid(id))) return err('--inputs must be all, none, or a comma-separated list of input ids')
        out.inputs = { kind: 'ids', ids }
        break
      }
      default:
        return err(`Unknown option ${a}`)
    }
  }
  if (out.sessionId === null) return err('Missing <sessionId>')
  if (!isUuid(out.sessionId)) return err('<sessionId> must be a session UUID')
  return { kind: 'ok', args: { ...out, sessionId: out.sessionId } }
}

// A judge that is also one of the compared models grades its own work.
export function criticIsContender(args: Pick<AbArgs, 'critic' | 'criticModel' | 'models'>): boolean {
  return args.critic && args.models.includes(args.criticModel)
}
