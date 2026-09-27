import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { LockfileRecipe } from './types'

// package-lock.json handling for a release. The client's lock is re-resolved
// in a TEMP directory (package.json + package-lock.json only), never in the
// clone, so a dry-run computes the exact bytes the apply will commit and the
// usual unexpected-change abort covers it.

interface Lock {
  packages?: Record<string, { version?: string }>
}

/** Drop every `packages` entry whose key matches (the 2026.09.5 client CI recipe's node step). Pure. */
export function dropLockPackages(lockText: string, pattern: string): { text: string; dropped: string[] } {
  const lock = JSON.parse(lockText) as Lock
  const re = new RegExp(pattern)
  const dropped: string[] = []
  for (const k of Object.keys(lock.packages ?? {})) {
    if (k !== '' && re.test(k)) {
      delete lock.packages![k]
      dropped.push(k)
    }
  }
  return { text: `${JSON.stringify(lock, null, 2)}\n`, dropped }
}

export function missingLockPackages(lockText: string, expect: string[]): string[] {
  const pk = (JSON.parse(lockText) as Lock).packages ?? {}
  return expect.filter((k) => !(k in pk))
}

/** Version changes between two locks for keys present in both (for the "patch bumps only" check). Pure. */
export function lockVersionChanges(before: string, after: string): { key: string; from: string; to: string; nonPatch: boolean }[] {
  const a = (JSON.parse(before) as Lock).packages ?? {}
  const b = (JSON.parse(after) as Lock).packages ?? {}
  const out: { key: string; from: string; to: string; nonPatch: boolean }[] = []
  for (const [k, v] of Object.entries(a)) {
    const w = b[k]
    if (!k || !w || !v.version || !w.version || v.version === w.version) continue
    const [ma, mi] = v.version.split('.')
    const [mb, mj] = w.version.split('.')
    out.push({ key: k, from: v.version, to: w.version, nonPatch: ma !== mb || mi !== mj })
  }
  return out
}

export interface RegenerateResult {
  text: string
  dropped: string[]
  missing: string[]
  versionChanges: { key: string; from: string; to: string; nonPatch: boolean }[]
}

export type NpmRunner = (cwd: string) => { ok: boolean; err: string }

const npmLockOnly: NpmRunner = (cwd) => {
  const r = spawnSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, npm_config_update_notifier: 'false' },
  })
  return { ok: r.status === 0, err: (r.stderr ?? '').trim().split('\n').slice(-3).join(' ') }
}

/**
 * Re-resolve a client lock: optional recipe drop, then
 * `npm install --package-lock-only --ignore-scripts` in a temp dir holding
 * only package.json + package-lock.json. Throws when npm fails.
 */
export function regenerateLock(pkgJson: string, lockText: string, recipe: LockfileRecipe | null, run: NpmRunner = npmLockOnly): RegenerateResult {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'fleet-lock-'))
  try {
    const d = recipe ? dropLockPackages(lockText, recipe.dropPackages) : { text: lockText, dropped: [] }
    writeFileSync(path.join(tmp, 'package.json'), pkgJson)
    writeFileSync(path.join(tmp, 'package-lock.json'), d.text)
    const r = run(tmp)
    if (!r.ok) throw new Error(`npm install --package-lock-only failed: ${r.err}`)
    const text = readFileSync(path.join(tmp, 'package-lock.json'), 'utf8')
    return {
      text,
      dropped: d.dropped,
      missing: missingLockPackages(text, recipe?.expectPackages ?? []),
      versionChanges: lockVersionChanges(lockText, text),
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
