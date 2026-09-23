#!/usr/bin/env node
// Tracks when the codebase last had a FULL multi-area audit and whether another
// one is due. The rule (see CLAUDE.md → "Full re-audit cadence"): re-audit when
// ANY threshold in .audit/last-full-audit.json is crossed — days elapsed,
// commits since, or lines changed since the audited commit.
//
//   node scripts/audit-due.mjs            # human-readable status (exit 0)
//   node scripts/audit-due.mjs --hook     # SessionStart hook: prints a reminder only when due
//   node scripts/audit-due.mjs --check    # exit 1 when due (CI / scripts)
//   node scripts/audit-due.mjs --mark "note"  # record a completed full audit at HEAD
//
// Never throws in --hook mode: a broken check must not break session start.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MARKER = join(ROOT, '.audit', 'last-full-audit.json')
const DEFAULT_THRESHOLDS = { days: 30, commits: 150, lines: 15000 }
// Churn that isn't reviewable code: lockfile, generated DB types.
const EXCLUDES = [':(exclude)package-lock.json', ':(exclude)types/database.ts']

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

function readMarker() {
  if (!existsSync(MARKER)) return null
  return JSON.parse(readFileSync(MARKER, 'utf8'))
}

function status() {
  const marker = readMarker()
  if (!marker) return { due: true, reasons: ['no full audit has been recorded'], marker: null }
  const t = { ...DEFAULT_THRESHOLDS, ...(marker.thresholds ?? {}) }
  const days = Math.floor((Date.now() - Date.parse(marker.date)) / 86_400_000)
  const commits = Number(git(['rev-list', '--count', `${marker.commit}..HEAD`]))
  let lines = 0
  for (const row of git(['diff', '--numstat', `${marker.commit}..HEAD`, '--', '.', ...EXCLUDES]).split('\n')) {
    const [a, d] = row.split('\t')
    if (a && a !== '-') lines += Number(a) + Number(d)
  }
  const reasons = []
  if (days >= t.days) reasons.push(`${days} days since the last full audit (threshold ${t.days})`)
  if (commits >= t.commits) reasons.push(`${commits} commits since (threshold ${t.commits})`)
  if (lines >= t.lines) reasons.push(`${lines.toLocaleString()} lines changed since (threshold ${t.lines.toLocaleString()})`)
  return { due: reasons.length > 0, reasons, marker, days, commits, lines, thresholds: t }
}

const args = process.argv.slice(2)

if (args[0] === '--mark') {
  const prev = readMarker()
  const marker = {
    date: new Date().toISOString().slice(0, 10),
    commit: git(['rev-parse', 'HEAD']),
    note: args[1] ?? 'Full multi-area audit completed',
    thresholds: prev?.thresholds ?? DEFAULT_THRESHOLDS,
  }
  mkdirSync(dirname(MARKER), { recursive: true })
  writeFileSync(MARKER, JSON.stringify(marker, null, 2) + '\n')
  console.log(`Recorded full audit at ${marker.commit.slice(0, 7)} (${marker.date}). Commit .audit/last-full-audit.json.`)
  process.exit(0)
}

if (args[0] === '--hook') {
  try {
    const s = status()
    if (s.due) {
      const why = s.reasons.join('; ')
      process.stdout.write(
        JSON.stringify({
          systemMessage: `Full codebase re-audit is due: ${why}.`,
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext:
              `A FULL codebase re-audit is due per CLAUDE.md "Full re-audit cadence" (${why}). ` +
              'At the start of this session, tell the user and offer to run it before other large work. ' +
              'After a completed audit, run `node scripts/audit-due.mjs --mark "<summary>"` and commit the marker.',
          },
        })
      )
    }
  } catch {
    // Silent: never block session start.
  }
  process.exit(0)
}

const s = status()
if (!s.marker) {
  console.log('No full audit recorded yet — one is due. Record one with --mark after it completes.')
} else {
  console.log(`Last full audit: ${s.marker.date} at ${s.marker.commit.slice(0, 7)} — ${s.marker.note ?? ''}`)
  console.log(`Since then: ${s.days} days, ${s.commits} commits, ${s.lines.toLocaleString()} lines changed`)
  console.log(`Thresholds: ${s.thresholds.days} days / ${s.thresholds.commits} commits / ${s.thresholds.lines.toLocaleString()} lines`)
  console.log(s.due ? `DUE: ${s.reasons.join('; ')}` : 'Not due.')
}
process.exit(args[0] === '--check' && s.due ? 1 : 0)
