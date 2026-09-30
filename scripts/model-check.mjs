#!/usr/bin/env node
// Model-fit monitor. Flags when our model tier map (lib/content/generation-tuning.ts)
// may be out of date, so a model review happens on evidence instead of by accident.
// See CLAUDE.md → "Model review cadence". Flags:
//   1. a model on Anthropic's Models API that isn't in .audit/model-review.json knownModels (new release)
//   2. a model we use that the Models API no longer lists (retired)
//   3. a model we use whose registry `watch` entry has a date that is now < 30 days away
//   4. lastReview older than reviewEveryDays
//   5. a model constant with no PRICING entry in lib/content/token-pricing.ts (spend records as $0)
//
//   node scripts/model-check.mjs              # human-readable status (exit 0)
//   node scripts/model-check.mjs --hook       # SessionStart hook: prints only when something is flagged
//   node scripts/model-check.mjs --check      # exit 1 when flagged (CI / scripts)
//   node scripts/model-check.mjs --mark "note"  # record a completed review (refreshes knownModels)
//
// Never throws in --hook mode: a broken check must not break session start.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REGISTRY = join(ROOT, '.audit', 'model-review.json')
const TUNING = join(ROOT, 'lib', 'content', 'generation-tuning.ts')
const PRICING = join(ROOT, 'lib', 'content', 'token-pricing.ts')
const WATCH_WARN_DAYS = 30

function apiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  const envPath = join(ROOT, '.env.local')
  if (!existsSync(envPath)) return null
  const m = readFileSync(envPath, 'utf8').match(/^ANTHROPIC_API_KEY=(.*)$/m)
  return m ? m[1].replace(/^"|"$/g, '').trim() : null
}

// Model ids assigned to exported constants: { PUBLISHED_CONTENT_MODEL: 'claude-sonnet-5', ... }
function modelConstants(src) {
  const out = {}
  for (const m of src.matchAll(/export const ([A-Z0-9_]+) = '(claude-[a-z0-9.-]+)'/g)) out[m[1]] = m[2]
  return out
}

function pricedModels(src) {
  return new Set([...src.matchAll(/^\s*'(claude-[a-z0-9.-]+)':\s*\{/gm)].map((m) => m[1]))
}

async function listApiModels(timeoutMs) {
  const key = apiKey()
  if (!key) return null
  const ids = []
  let after = null
  for (let page = 0; page < 10; page++) {
    const url = `https://api.anthropic.com/v1/models?limit=100${after ? `&after_id=${after}` : ''}`
    const res = await fetch(url, {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    const body = await res.json()
    ids.push(...body.data.map((m) => m.id))
    if (!body.has_more) break
    after = body.last_id
  }
  return ids
}

function readRegistry() {
  return existsSync(REGISTRY) ? JSON.parse(readFileSync(REGISTRY, 'utf8')) : null
}

async function status(timeoutMs) {
  const registry = readRegistry()
  const inUse = modelConstants(readFileSync(TUNING, 'utf8'))
  const priced = pricedModels(readFileSync(PRICING, 'utf8'))
  const apiModels = await listApiModels(timeoutMs).catch(() => null)
  const reasons = []

  if (!registry) reasons.push('no model review has been recorded (.audit/model-review.json missing)')
  else {
    const days = Math.floor((Date.now() - Date.parse(registry.lastReview)) / 86_400_000)
    if (days >= registry.reviewEveryDays) reasons.push(`${days} days since the last model review (every ${registry.reviewEveryDays})`)
    for (const w of registry.watch ?? []) {
      if (!w.date || !Object.values(inUse).includes(w.model)) continue
      const left = Math.floor((Date.parse(w.date) - Date.now()) / 86_400_000)
      if (left < WATCH_WARN_DAYS) reasons.push(`${w.model} retires ${w.date} (${left} days)${w.fallback ? ` — fallback: ${w.fallback}` : ''}`)
    }
  }
  if (apiModels && registry) {
    const fresh = apiModels.filter((id) => !registry.knownModels.includes(id))
    if (fresh.length) reasons.push(`new model(s) on the API: ${fresh.join(', ')}`)
  }
  if (apiModels) {
    const gone = [...new Set(Object.values(inUse))].filter((id) => !apiModels.includes(id))
    if (gone.length) reasons.push(`in-use model(s) no longer listed by the API: ${gone.join(', ')}`)
  }
  const unpriced = Object.entries(inUse).filter(([, id]) => !priced.has(id))
  if (unpriced.length) reasons.push(`no PRICING entry (spend records as $0): ${unpriced.map(([k, id]) => `${k}=${id}`).join(', ')}`)

  return { flagged: reasons.length > 0, reasons, registry, inUse, apiModels }
}

const args = process.argv.slice(2)

if (args[0] === '--mark') {
  const prev = readRegistry()
  const apiModels = await listApiModels(10_000).catch(() => null)
  if (!apiModels) console.warn('Models API unreachable — keeping the previous knownModels list.')
  const registry = {
    lastReview: new Date().toISOString().slice(0, 10),
    note: args[1] ?? 'Model review completed',
    reviewEveryDays: prev?.reviewEveryDays ?? 45,
    knownModels: (apiModels ?? prev?.knownModels ?? []).slice().sort(),
    inUse: modelConstants(readFileSync(TUNING, 'utf8')),
    watch: prev?.watch ?? [],
  }
  writeFileSync(REGISTRY, JSON.stringify(registry, null, 2) + '\n')
  console.warn(`Recorded model review (${registry.lastReview}, ${registry.knownModels.length} known models). Commit .audit/model-review.json.`)
  process.exit(0)
}

if (args[0] === '--hook') {
  try {
    const s = await status(3_000)
    if (s.flagged) {
      const why = s.reasons.join('; ')
      process.stdout.write(
        JSON.stringify({
          systemMessage: `Model review suggested: ${why}.`,
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext:
              `A model-fit review is suggested per CLAUDE.md "Model review cadence" (${why}). ` +
              'At the start of this session, tell the user and offer to run it before other large work; do not start it unprompted. ' +
              'After a review, run `node scripts/model-check.mjs --mark "<summary>"` and commit .audit/model-review.json.',
          },
        })
      )
    }
  } catch {
    // Silent: never block session start.
  }
  process.exit(0)
}

const s = await status(10_000)
if (s.registry) console.warn(`Last model review: ${s.registry.lastReview} — ${s.registry.note ?? ''}`)
console.warn('In use:')
for (const [k, id] of Object.entries(s.inUse)) console.warn(`  ${k.padEnd(28)} ${id}`)
if (!s.apiModels) console.warn('Models API: unreachable (no ANTHROPIC_API_KEY or request failed) — new/retired checks skipped.')
console.warn(s.flagged ? `FLAGGED: ${s.reasons.join('; ')}` : 'Nothing flagged.')
process.exit(args[0] === '--check' && s.flagged ? 1 : 0)
