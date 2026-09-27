import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { DiffEntry } from './types'

// Thin wrappers over the local git CLI. The fleet tool works on local clones
// (like the rollouts it replaces) so every write is inspectable before push.

export function git(dir: string, args: string[], input?: string): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] })
}

export function gitBuffer(dir: string, args: string[]): Buffer {
  return execFileSync('git', args, { cwd: dir, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
}

export function tryGit(dir: string, args: string[]): { ok: boolean; code: number | null; out: string; err: string } {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return { ok: r.status === 0, code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' }
}

export function revParse(dir: string, rev: string): string {
  return git(dir, ['rev-parse', '--verify', '-q', `${rev}^{commit}`]).trim()
}

export function isAncestor(dir: string, a: string, b: string): boolean {
  return tryGit(dir, ['merge-base', '--is-ancestor', a, b]).ok
}

export function diffNameStatus(dir: string, from: string, to: string): DiffEntry[] {
  const out = git(dir, ['diff', '--no-renames', '--name-status', '-z', from, to])
  const parts = out.split('\0').filter((x) => x !== '')
  const entries: DiffEntry[] = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const st = parts[i][0]
    if (st === 'A' || st === 'M' || st === 'D') entries.push({ status: st, path: parts[i + 1] })
    else entries.push({ status: 'M', path: parts[i + 1] }) // T (type change) → treat as modified
  }
  return entries
}

// Blob shas of many `rev:path` specs in ONE git process. Missing → null.
export function blobShas(dir: string, rev: string, paths: string[]): Map<string, string | null> {
  const out = new Map<string, string | null>()
  if (paths.length === 0) return out
  const res = git(dir, ['cat-file', '--batch-check=%(objectname) %(objecttype)'], paths.map((p) => `${rev}:${p}`).join('\n') + '\n')
  const lines = res.split('\n')
  paths.forEach((p, i) => {
    const line = lines[i] ?? ''
    const m = line.match(/^([0-9a-f]{40}) blob$/)
    out.set(p, m ? m[1] : null)
  })
  return out
}

export function show(dir: string, rev: string, p: string): Buffer {
  return gitBuffer(dir, ['show', `${rev}:${p}`])
}

export function showText(dir: string, rev: string, p: string): string | null {
  const r = tryGit(dir, ['show', `${rev}:${p}`])
  return r.ok ? r.out : null
}

// Newest template commit (reachable from `upTo`) whose blob of `p` equals
// `blob` — i.e. the client is simply BEHIND on this file. null = customised.
export function findHistoricalMatch(templateDir: string, upTo: string, p: string, blob: string): string | null {
  const commits = git(templateDir, ['rev-list', upTo, '--', p]).split('\n').filter(Boolean)
  if (commits.length === 0) return null
  const specs = commits.map((c) => `${c}:${p}`)
  const res = git(templateDir, ['cat-file', '--batch-check=%(objectname)'], specs.join('\n') + '\n').split('\n')
  for (let i = 0; i < commits.length; i++) if (res[i]?.trim() === blob) return commits[i]
  return null
}

export interface MergeResult {
  text: string
  conflicts: number
}

// 3-way merge of text blobs (git merge-file). conflicts > 0 → markers in text.
export function mergeFile(ours: string, base: string, theirs: string): MergeResult {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'fleet-merge-'))
  try {
    const [o, b, t] = ['ours', 'base', 'theirs'].map((n) => path.join(tmp, n))
    writeFileSync(o, ours)
    writeFileSync(b, base)
    writeFileSync(t, theirs)
    const r = spawnSync('git', ['merge-file', '-p', '-L', 'client', '-L', 'template@OLD', '-L', 'template@NEW', o, b, t], { encoding: 'utf8' })
    if (r.status === null || r.status < 0 || r.status > 127) throw new Error(`git merge-file failed: ${r.stderr}`)
    return { text: r.stdout, conflicts: r.status }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

// Working-tree changes (tracked + untracked), repo-relative.
export function changedPaths(dir: string): string[] {
  const out = git(dir, ['status', '--porcelain', '-uall', '-z'])
  const parts = out.split('\0').filter(Boolean)
  const paths: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].slice(0, 2)
    paths.push(parts[i].slice(3))
    if (code[0] === 'R' || code[0] === 'C') i++ // skip the rename source
  }
  return paths
}

export function trackedUnder(dir: string, rev: string, p: string): string[] {
  return git(dir, ['ls-tree', '-r', '--name-only', rev, '--', p]).split('\n').filter(Boolean)
}

export function pathExists(dir: string, rev: string, p: string): boolean {
  return tryGit(dir, ['cat-file', '-e', `${rev}:${p}`]).ok
}
