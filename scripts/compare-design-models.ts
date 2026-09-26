// Design Studio P7: A/B the concept-generation model. For ONE client it builds
// the concept brief exactly as a real design run does (run-gather's
// gatherBriefBasics + sharedPromptArgs + buildConceptPrompt, the effective
// capability tier, the current-site "before" render, the session's captured
// inputs), then generates N concepts per model through the production
// generateConcept path (validation, one repair turn, distinctness vs that
// model's own earlier concepts), renders every valid concept on each page at
// desktop + mobile, measures the render checks, and — unless --no-critic —
// scores each concept with the SAME judge via critiqueConcept: --critic, by
// default PUBLISHED_CONTENT_MODEL (Sonnet 5), which is not a contender (the
// production critic, DESIGN_MODEL, is Opus 5.5 — one of the compared models).
// A judge that IS a compared model is warned about and flagged in the report.
// No revise loop: this compares first drafts.
// Output: report.html (self-contained; images by relative path) + report.json
// + the WebP renders, in <repo>/tmp/design-ab/<sessionId>-<timestamp>/ by default.
//
// Read-only against app data: never writes design_runs / design_concepts /
// design_versions / design_chat_messages, never commits to GitHub, never
// uploads to Storage. The only DB writes are token_usage rows (real spend) via
// the normal recordTokenUsage path, under the ordinary design_concept /
// design_critique stages, attributed to the content job and (createdBy null ⇒
// resolved) its creator — the dashboard shows it as normal Studio spend.
// A USD cap (default $15, critic included) is checked before EVERY model call
// against that call's projected worst attempt; once a call would exceed it,
// that call and all later ones are reported as "skipped (cap)". The call itself
// gets the cap minus that projection, so its retry / repair can't overshoot.
//
// Usage (run with --help for every option):
//   npx tsx scripts/compare-design-models.ts <sessionId> [--concepts 2] [--models claude-opus-5-5,claude-fable-5-1]
//     [--pages /,/services] [--cap 15] [--critic claude-sonnet-5] [--no-critic] [--brief "<text>"] [--palette evolve] [--inputs all] [--out <dir>]
// Rendering needs a local Chrome/Chromium: set CHROMIUM_EXECUTABLE_PATH, e.g.
//   CHROMIUM_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

import * as fs from 'fs'
import * as path from 'path'

const envPath = path.join(__dirname, '..', '.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
}

type Viewport = 'desktop' | 'mobile'
const VIEWPORTS: Viewport[] = ['desktop', 'mobile']
// Generous per-call deadline: the script has no function timeout, so only
// each call's own cap (FIRST_ATTEMPT_CAP_MS etc.) bounds it.
const CALL_DEADLINE_MS = 30 * 60_000

const slug = (s: string): string => s.replace(/[^a-z0-9.-]+/gi, '_').replace(/^_+|_+$/g, '') || 'x'
const pageSlug = (p: string): string => (p === '/' ? 'home' : slug(p.replace(/^\//, '')))
const errText = (err: unknown): string => (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 300)

async function main() {
  const tuning = await import('../lib/content/generation-tuning')
  const { abUsage, criticIsContender, parseAbArgs } = await import('../lib/design/ab/args')
  // Default judge: the Sonnet 5 writing tier — not a contender. critiqueConcept
  // sends it adaptive thinking + effort (GENERATION_PROVIDER_OPTIONS), both
  // supported on Sonnet 5; nothing Opus-only.
  const defaults = { models: [tuning.DESIGN_MODEL, tuning.DESIGN_AB_CHALLENGER_MODEL], critic: tuning.PUBLISHED_CONTENT_MODEL }
  const parsed = parseAbArgs(process.argv.slice(2), defaults)
  if (parsed.kind === 'help') {
    console.log(abUsage(defaults))
    return
  }
  if (parsed.kind === 'error') {
    console.error(`${parsed.error}\n\n${abUsage(defaults)}`)
    process.exit(2)
  }
  const args = parsed.args

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.ANTHROPIC_API_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or ANTHROPIC_API_KEY')
    process.exit(1)
  }

  const { estimateCostUsd } = await import('../lib/content/token-pricing')
  const criticModel = args.critic ? args.criticModel : null
  const judgeIsContender = criticIsContender(args)
  if (criticModel && tuning.FAST_MODEL === criticModel) {
    // critiqueConcept always sends effort, which errors on Haiku 4.5.
    console.error(`--critic ${criticModel}: the design critic sends effort/thinking options, which Haiku rejects — pick another judge.`)
    process.exit(2)
  }
  if (judgeIsContender) console.warn(`WARNING: the judge ${criticModel} is also a compared model — its scores may favour its own concepts. The report flags this.`)
  // A model missing from PRICING prices at $0 — the cap could not protect it.
  for (const model of [...args.models, ...(criticModel ? [criticModel] : [])]) {
    if (estimateCostUsd(model, 1_000_000, 1_000_000) <= 0) {
      console.error(`Model "${model}" has no entry in lib/content/token-pricing.ts PRICING — refusing to run uncapped.`)
      process.exit(1)
    }
  }

  const { createServerClient } = await import('../lib/supabase/server')
  const { DRAFT_BRANCH, getDraftHeadSha, listTree } = await import('../lib/github/repo-files')
  const { asJson } = await import('../lib/supabase/json-typed')
  const { buildCachedPartsMessages } = await import('../lib/content/cache-control')
  const { DESIGN_SYSTEM_PROMPT, buildConceptPrompt } = await import('../lib/design/brief')
  type PriorConcept = import('../lib/design/brief').PriorConcept
  type PromptImage = import('../lib/design/brief').PromptImage
  const { CRITIC_SYSTEM_PROMPT, buildCritiquePrompt } = await import('../lib/design/brief/critique-prompt')
  const { specimenUnlocked } = await import('../lib/design/capabilities')
  const { readEffectiveCapabilities } = await import('../lib/design/capabilities-read')
  const { CONCEPT_OUTPUT_TOKENS, REPAIR_OUTPUT_TOKENS, generateConcept } = await import('../lib/design/concept-generator')
  const { CRITIQUE_OUTPUT_TOKENS, CRITIQUE_RETRY_OUTPUT_TOKENS, critiqueConcept } = await import('../lib/design/critic')
  const { estimateInputUsd } = await import('../lib/design/model-call')
  const { bundleToRepoFiles } = await import('../lib/design/bundle-files')
  type DesignBundle = import('../lib/design/bundle').DesignBundle
  const { composeThemeDoc, composedThemeFromFiles } = await import('../lib/design/composed-theme')
  type ComposedTheme = import('../lib/design/composed-theme').ComposedTheme
  const { distinctnessReport } = await import('../lib/design/distinctness')
  const { combineMetrics, evaluatePageSample, metricGateFailures } = await import('../lib/design/metrics')
  type RenderMetrics = import('../lib/design/metrics').RenderMetrics
  type ViewportMetrics = import('../lib/design/metrics').ViewportMetrics
  const { pickRepresentativePages } = await import('../lib/design/pages')
  const { gatherBriefBasics, sharedPromptArgs } = await import('../lib/design/run-gather')
  const { currentSiteCaption, inputAdminText, inputCaption, inputLabel, selectRunInputs } = await import('../lib/design/run-state')
  const { MAX_PROMPT_IMAGES } = await import('../lib/design/run-types')
  const { listInputs } = await import('../lib/design/store')
  const { downloadDesignImage, toWebp } = await import('../lib/design/storage')
  const { loadRenderShell } = await import('../lib/design/render/render-folds')
  type RenderShell = import('../lib/design/render/render-folds').RenderShell
  const { callerCapUsd, createAbBudget, projectCallUsd } = await import('../lib/design/ab/budget')
  // The worst single attempt of each call (first try / larger retry / repair).
  const conceptAttemptTokens = Math.max(CONCEPT_OUTPUT_TOKENS, REPAIR_OUTPUT_TOKENS)
  const critiqueAttemptTokens = Math.max(CRITIQUE_OUTPUT_TOKENS, CRITIQUE_RETRY_OUTPUT_TOKENS)
  const { ZERO_USAGE, addUsage, apiErrorSummary, parseAnthropicUsage } = await import('../lib/design/ab/api-tap')
  type ApiUsage = import('../lib/design/ab/api-tap').ApiUsage
  const { buildReportHtml, summarize, summaryText } = await import('../lib/design/ab/report')
  type AbConcept = import('../lib/design/ab/report').AbConcept
  type AbReport = import('../lib/design/ab/report').AbReport
  type AbShot = import('../lib/design/ab/report').AbShot
  type AbPageCheck = import('../lib/design/ab/report').AbPageCheck
  type AbCallStats = import('../lib/design/ab/report').AbCallStats

  // ── fetch tap: per-call usage + API errors (generateJson swallows provider
  // errors, so e.g. a 400 on an unsupported provider option is only visible here).
  type TapSlot = { calls: number; usage: ApiUsage; apiErrors: string[] }
  let tapSlot: TapSlot | null = null
  const realFetch = globalThis.fetch
  const tappedFetch: typeof fetch = async (input, init) => {
    const res = await realFetch(input, init)
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const slot = tapSlot
    if (slot && /\/v1\/messages(\?|$)/.test(url)) {
      slot.calls++
      try {
        const text = await res.clone().text()
        if (res.ok) {
          const usage = parseAnthropicUsage(JSON.parse(text))
          if (usage) slot.usage = addUsage(slot.usage, usage)
        } else {
          slot.apiErrors.push(apiErrorSummary(res.status, text))
        }
      } catch {
        // observation only — never affects the call
      }
    }
    return res
  }
  globalThis.fetch = tappedFetch
  const tapped = async <T>(fn: () => Promise<T>): Promise<{ value: T | null; error: string | null; latencyMs: number; slot: TapSlot }> => {
    const slot: TapSlot = { calls: 0, usage: ZERO_USAGE, apiErrors: [] }
    tapSlot = slot
    const t0 = Date.now()
    try {
      return { value: await fn(), error: null, latencyMs: Date.now() - t0, slot }
    } catch (err) {
      return { value: null, error: errText(err), latencyMs: Date.now() - t0, slot }
    } finally {
      tapSlot = null
    }
  }
  const callStats = (t: { latencyMs: number; slot: TapSlot }, costUsd: number, estimatedUsd: number): AbCallStats => ({
    latencyMs: t.latencyMs,
    calls: t.slot.calls,
    usage: t.slot.usage,
    costUsd,
    estimatedUsd,
    apiErrors: t.slot.apiErrors,
  })

  // ── the client
  const db = createServerClient()
  const { data: job, error: jobError } = await db.from('content_jobs').select('id, phase, github_repo').eq('session_id', args.sessionId).maybeSingle()
  if (jobError) throw new Error(`content_jobs read failed: ${jobError.message}`)
  if (!job) throw new Error('No content job for this session.')
  if (job.phase < 6 || !job.github_repo) throw new Error('This session is not content-ready (phase ≥ 6 with a repo) — the Design Studio is unavailable for it.')
  const target = { sessionId: args.sessionId, jobId: job.id, githubRepo: job.github_repo }
  // gatherBriefBasics reads the draft theme through ensureDraftBranch, which
  // CREATES a missing draft branch. Stay read-only: require it to exist.
  try {
    await getDraftHeadSha(target.githubRepo)
  } catch (err) {
    throw new Error(`The draft branch could not be read (${errText(err)}) — open the Design Studio once, then re-run.`)
  }

  const caps = (await readEffectiveCapabilities({ githubRepo: target.githubRepo, jobId: target.jobId })).effective
  let pages = args.pages
  if (!pages) {
    const tree = await listTree(target.githubRepo, DRAFT_BRANCH, 'content/pages/')
    pages = pickRepresentativePages(
      tree.filter((e) => e.type === 'blob').map((e) => e.path),
      { specimen: specimenUnlocked(caps) }
    ).picks.map((p) => p.path)
  }
  const primaryPage = pages[0]
  const runLike = { capabilities: asJson(caps), palette_freedom: args.palette, admin_brief: args.brief }
  const gathered = await gatherBriefBasics(db, target, runLike, primaryPage, { markup: true })
  if (!gathered.ok) throw new Error(gathered.error)
  const b = gathered.basics
  const notes: string[] = [...b.notes]

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  // The default lives under the repo root (git-ignored /tmp/), whatever the cwd.
  const outDir = path.resolve(args.out ?? path.join(__dirname, '..', 'tmp', 'design-ab', `${args.sessionId}-${stamp}`))
  fs.mkdirSync(outDir, { recursive: true })
  const writeImage = (rel: string, bytes: Buffer): string => {
    const abs = path.join(outDir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, bytes)
    return rel
  }
  console.log(`Design model A/B for ${b.firmName} (${args.sessionId}) → ${outDir}`)
  console.log(`models ${args.models.join(' vs ')} · ${args.concepts} concept(s) each · critic ${criticModel ?? 'off'} · pages ${pages.join(', ')} · cap $${args.capUsd.toFixed(2)}`)

  // ── renderer (lazy; absent Chromium ⇒ no renders, no critic)
  const canRender = !!process.env.CHROMIUM_EXECUTABLE_PATH
  if (!canRender) notes.push('CHROMIUM_EXECUTABLE_PATH is not set — nothing was rendered, so no render checks and no critique ran.')
  const shells = new Map<string, RenderShell | string>()
  if (b.shell) shells.set(primaryPage, b.shell)
  const shellFor = async (page: string): Promise<RenderShell | string> => {
    const cached = shells.get(page)
    if (cached !== undefined) return cached
    const loaded = await loadRenderShell(target, page)
    const value = loaded.ok ? loaded.shell : loaded.reason
    shells.set(page, value)
    return value
  }
  type PageRender = { shots: AbShot[]; webp: Partial<Record<Viewport, Buffer>>; metrics: RenderMetrics | null; error: string | null }
  const renderPage = async (page: string, theme: ComposedTheme, fileBase: string): Promise<PageRender> => {
    const shell = await shellFor(page)
    if (typeof shell === 'string') return { shots: [], webp: {}, metrics: null, error: shell }
    if (!shell.origin.startsWith('https://')) return { shots: [], webp: {}, metrics: null, error: 'The preview URL must use https to render.' }
    const { renderComposed } = await import('../lib/design/render/render-composed')
    const html = composeThemeDoc(shell.shellHtml, theme)
    const out: PageRender = { shots: [], webp: {}, metrics: null, error: null }
    const measured: ViewportMetrics[] = []
    for (const viewport of VIEWPORTS) {
      try {
        const r = await renderComposed({ html, shellOrigin: shell.origin, viewport, crops: false, metrics: true })
        if (r.sample) measured.push(evaluatePageSample(viewport, r.sample))
        const fold = r.shots.find((s) => s.kind === 'fold')
        if (!fold) continue
        const { webp } = await toWebp(fold.png)
        out.webp[viewport] = webp
        out.shots.push({ page, viewport, file: writeImage(`${fileBase}-${pageSlug(page)}-${viewport}.webp`, webp) })
      } catch (err) {
        out.error = errText(err)
        break
      }
    }
    out.metrics = combineMetrics(measured)
    return out
  }
  const checkOf = (page: string, r: PageRender, baseline: RenderMetrics | null): AbPageCheck => ({
    page,
    measured: (r.metrics?.viewports ?? []).map((v) => v.viewport),
    gateFailures: r.metrics ? metricGateFailures(r.metrics, baseline).map((f) => f.message) : [],
    renderError: r.error,
  })

  // ── the current site: the prompt's "before" image + each page's metrics baseline
  const baselines = new Map<string, RenderMetrics | null>()
  const current: AbReport['current'] = { shots: [], checks: [] }
  let currentDesktop: Buffer | null = null
  if (canRender) {
    const currentTheme = composedThemeFromFiles(b.theme)
    for (const page of pages) {
      const r = await renderPage(page, currentTheme, 'current/current')
      baselines.set(page, r.metrics)
      current.shots.push(...r.shots)
      current.checks.push(checkOf(page, r, null))
      if (page === primaryPage) currentDesktop = r.webp.desktop ?? null
    }
  }

  // ── prompt images, exactly as the orchestrator assembles them
  const images: PromptImage[] = []
  if (currentDesktop) images.push({ caption: currentSiteCaption(primaryPage), adminText: null, bytes: new Uint8Array(currentDesktop), mediaType: 'image/webp' })
  else notes.push(`No current-site render of ${primaryPage} — concepts were designed without the "before" image.`)
  const allInputs = await listInputs(db, args.sessionId)
  const inputIds = args.inputs.kind === 'none' ? [] : args.inputs.kind === 'ids' ? args.inputs.ids : allInputs.filter((r) => !r.archived && r.capture_status === 'ok').map((r) => r.id)
  const { usable, skipped } = selectRunInputs(allInputs, inputIds)
  for (const s of skipped) notes.push(`Input skipped — ${s.label}: ${s.reason}`)
  for (const row of usable) {
    if (images.length >= MAX_PROMPT_IMAGES) {
      notes.push(`Input skipped — ${inputLabel(row)}: the image limit was reached`)
      continue
    }
    try {
      images.push({ caption: inputCaption(row), adminText: inputAdminText(row), bytes: await downloadDesignImage(db, row.storage_path), mediaType: 'image/webp' })
    } catch (err) {
      notes.push(`Input skipped — ${inputLabel(row)}: its image could not be read (${errText(err)})`)
    }
  }
  const shared = sharedPromptArgs(b, runLike, primaryPage, images)

  // ── generation: interleaved by position so a cap hit treats models alike
  const budget = createAbBudget(args.capUsd)
  const attribution = { sessionId: target.sessionId, contentJobId: target.jobId, createdBy: null }
  const concepts: AbConcept[] = []
  const priors = new Map<string, PriorConcept[]>(args.models.map((m) => [m, []]))
  const bundles = new Map<AbConcept, DesignBundle>()
  const blank = (model: string, position: number): AbConcept => ({
    model,
    position,
    status: 'failed',
    bundle: null,
    errors: [],
    notes: [],
    generation: null,
    shots: [],
    checks: [],
    distinctness: [],
    critiqueStatus: args.critic ? 'not_valid' : 'disabled',
    critique: null,
    critiqueStats: null,
    critiqueErrors: [],
  })

  for (let position = 0; position < args.concepts; position++) {
    for (const model of args.models) {
      const row = blank(model, position)
      concepts.push(row)
      const modelPriors = priors.get(model) ?? []
      const prompt = buildConceptPrompt({ ...shared, conceptCount: args.concepts, position, priors: modelPriors })
      const shared0 = prompt.sharedPartCount
      const messages = buildCachedPartsMessages(prompt.staticPrefix, prompt.parts, { ttl: '5m', cacheDynamic: true, ...(shared0 > 0 ? { breakAt: shared0 - 1 } : {}) })
      const projected = projectCallUsd({ model, inputUsd: estimateInputUsd(DESIGN_SYSTEM_PROMPT, messages, model), maxOutputTokens: conceptAttemptTokens })
      if (!budget.admit(projected)) {
        row.status = 'skipped_cap'
        row.critiqueStatus = args.critic ? 'skipped_cap' : 'disabled'
        console.log(`  ${model} concept ${position + 1}: skipped (cap)`)
        continue
      }
      console.log(`  ${model} concept ${position + 1}: generating (projected ≤ $${projected.toFixed(2)})…`)
      let spend = 0
      const t = await tapped(() =>
        generateConcept({
          prompt,
          context: {
            current: b.current,
            caps: b.caps,
            paletteFreedom: b.paletteFreedom,
            draftFiles: { brandText: b.theme.brandText, designText: b.theme.designText, overridesCss: b.theme.overridesCss },
            model,
          },
          priors: modelPriors,
          costSoFarUsd: budget.spentUsd(),
          costCapUsd: callerCapUsd(budget, projected),
          deadline: Date.now() + CALL_DEADLINE_MS,
          attribution,
          model,
          onSpend: (usd) => {
            spend = usd
          },
        })
      )
      const result = t.value
      budget.charge(result ? result.costUsd : spend)
      row.generation = callStats(t, result ? result.costUsd : spend, result?.estimatedUsd ?? 0)
      if (t.error) row.errors.push(`Generation threw: ${t.error}`)
      if (result) {
        row.notes.push(...result.notes)
        if (result.concept) {
          const bundle = result.concept.bundle
          row.status = 'valid'
          row.bundle = {
            name: bundle.name,
            tagline: bundle.tagline,
            rationale: bundle.rationale,
            moves: bundle.moves,
            palette: bundle.palette,
            typography: bundle.typography,
            treatments: bundle.treatments,
            style: bundle.style,
            tokens: { roundness: bundle.tokens.roundness, density: bundle.tokens.density, visualFeel: bundle.tokens.visualFeel },
          }
          row.critiqueStatus = args.critic ? 'not_rendered' : 'disabled'
          bundles.set(row, bundle)
          modelPriors.push({ position, bundle })
        } else if (result.errors.length > 0) {
          row.status = 'invalid'
          row.errors.push(...result.errors)
        } else if (result.stoppedReason === 'cost_cap') {
          row.status = 'skipped_cap'
          row.errors.push('The cap stopped this call before it produced a concept.')
        } else {
          row.status = 'failed'
          row.errors.push(`No usable answer (${result.stoppedReason ?? 'no_output'}).`)
        }
      }
      if (row.status !== 'valid' && t.slot.apiErrors.length > 0) row.errors.push('The API rejected the call — see API errors below.')
      console.log(`    → ${row.status}${row.bundle ? ` "${row.bundle.name}"` : ''} in ${(t.latencyMs / 1000).toFixed(1)}s, $${(row.generation.costUsd).toFixed(3)}`)
    }
  }

  // ── renders + render checks + distinctness
  const primaryWebp = new Map<AbConcept, Partial<Record<Viewport, Buffer>>>()
  for (const row of concepts) {
    const bundle = bundles.get(row)
    if (!bundle) continue
    const others = concepts.filter((c) => c !== row && c.model === row.model && bundles.has(c))
    row.distinctness = distinctnessReport(bundle, [
      { label: 'the current site', bundle: b.current },
      ...others.map((o) => ({ label: `concept ${o.position + 1}`, bundle: bundles.get(o) as DesignBundle })),
    ])
    if (!canRender) continue
    const files = bundleToRepoFiles(bundle, { brandText: b.theme.brandText, designText: b.theme.designText, overridesCss: b.theme.overridesCss }, { removeLegacy: true })
    if (!files.ok) {
      row.notes.push('The concept could not be prepared for rendering.')
      continue
    }
    const theme = composedThemeFromFiles(files.files)
    console.log(`  rendering ${row.model} concept ${row.position + 1}…`)
    for (const page of pages) {
      const r = await renderPage(page, theme, `concepts/${slug(row.model)}/c${row.position + 1}`)
      row.shots.push(...r.shots)
      row.checks.push(checkOf(page, r, baselines.get(page) ?? null))
      if (page === primaryPage) primaryWebp.set(row, r.webp)
    }
  }

  // ── critic: the same judge for every model, first drafts only
  if (criticModel) {
    const maxPosition = Math.max(0, ...concepts.map((c) => c.position))
    for (let position = 0; position <= maxPosition; position++) {
      for (const row of concepts.filter((c) => c.position === position)) {
        const bundle = bundles.get(row)
        const webp = primaryWebp.get(row)
        if (!bundle || !webp?.desktop) continue
        const others = concepts
          .filter((c) => c !== row && c.model === row.model && bundles.has(c))
          .map((c) => ({ position: c.position, bundle: bundles.get(c) as DesignBundle }))
        const check = row.checks.find((c) => c.page === primaryPage)
        const prompt = buildCritiquePrompt({
          firmName: b.firmName,
          schema: b.schema,
          designMd: b.designMd,
          currentImage: currentDesktop ? new Uint8Array(currentDesktop) : null,
          concept: { position: row.position, iteration: 0, bundle },
          conceptCount: args.concepts,
          others,
          distinctness: row.distinctness,
          gateFailures: check?.gateFailures ?? [],
          desktop: new Uint8Array(webp.desktop),
          mobile: webp.mobile ? new Uint8Array(webp.mobile) : null,
        })
        const messages = buildCachedPartsMessages(prompt.staticPrefix, prompt.parts, { ttl: '5m', ...(prompt.sharedPartCount > 0 ? { breakAt: prompt.sharedPartCount - 1 } : {}) })
        const projected = projectCallUsd({ model: criticModel, inputUsd: estimateInputUsd(CRITIC_SYSTEM_PROMPT, messages, criticModel), maxOutputTokens: critiqueAttemptTokens })
        if (!budget.admit(projected)) {
          row.critiqueStatus = 'skipped_cap'
          continue
        }
        console.log(`  critiquing ${row.model} concept ${row.position + 1}…`)
        let spend = 0
        const t = await tapped(() =>
          critiqueConcept({
            prompt,
            iteration: 0,
            costSoFarUsd: budget.spentUsd(),
            costCapUsd: callerCapUsd(budget, projected),
            deadline: Date.now() + CALL_DEADLINE_MS,
            attribution,
            model: criticModel,
            onSpend: (usd) => {
              spend = usd
            },
          })
        )
        const result = t.value
        budget.charge(result ? result.costUsd : spend)
        row.critiqueStats = callStats(t, result ? result.costUsd : spend, result?.estimatedUsd ?? 0)
        if (t.error) row.critiqueErrors.push(`Critique threw: ${t.error}`)
        if (result?.critique) {
          const k = result.critique
          row.critique = { scores: k.scores, mean: k.mean, passed: k.passed, summary: k.summary, issues: k.issues }
          row.critiqueStatus = 'done'
        } else {
          row.critiqueStatus = result?.stoppedReason === 'cost_cap' ? 'skipped_cap' : 'failed'
          if (result) row.critiqueErrors.push(...result.errors)
        }
      }
    }
  }

  // ── report
  if (judgeIsContender) notes.push(`The judge (${criticModel}) is also a compared model — weigh its scores accordingly.`)
  if (budget.tripped()) notes.push(`The $${args.capUsd.toFixed(2)} cap was reached — later calls were skipped.`)
  const report: AbReport = {
    sessionId: args.sessionId,
    firmName: b.firmName,
    generatedAt: new Date().toISOString(),
    models: args.models,
    criticModel,
    criticIsContender: judgeIsContender,
    pages,
    primaryPage,
    conceptsPerModel: args.concepts,
    capUsd: args.capUsd,
    spentUsd: Math.round(budget.spentUsd() * 10_000) / 10_000,
    capHit: budget.tripped(),
    paletteFreedom: b.paletteFreedom,
    capabilityLevel: b.caps.level,
    adminBrief: args.brief,
    referenceImages: images.length,
    notes: [...new Set(notes)],
    current,
    concepts,
  }
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ ...report, summary: summarize(report) }, null, 2))
  const htmlPath = path.join(outDir, 'report.html')
  fs.writeFileSync(htmlPath, buildReportHtml(report))
  console.log(`\n${summaryText(summarize(report))}\n`)
  console.log(`Spent $${report.spentUsd.toFixed(2)} of the $${args.capUsd.toFixed(2)} cap${report.capHit ? ' (cap reached)' : ''}.`)
  console.log(`Report: ${htmlPath}`)
}

main()
  .then(() => process.exit(0)) // the cached renderer browser would keep the process alive
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
