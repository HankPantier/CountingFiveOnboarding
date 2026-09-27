import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

// Local verify of an applied clone: npm ci → tsc → vitest → build →
// generate-fonts --check. Run at concurrency ≤ 2 with ONE automatic retry per
// repo — at concurrency 11 the Google-Fonts fetch in `next build` flaked ~25%
// of the time in the last two rollouts.

export interface VerifyStep {
  name: string
  cmd: string
  args: string[]
}

export function verifySteps(dir: string): VerifyStep[] {
  const steps: VerifyStep[] = [
    { name: 'ci', cmd: 'npm', args: ['ci', '--no-audit', '--no-fund'] },
    { name: 'tsc', cmd: 'npx', args: ['tsc', '--noEmit'] },
    { name: 'test', cmd: 'npx', args: ['vitest', 'run'] },
    { name: 'build', cmd: 'npm', args: ['run', 'build'] },
  ]
  if (existsSync(path.join(dir, 'scripts', 'generate-fonts.ts'))) {
    steps.push({ name: 'fonts-check', cmd: 'npx', args: ['tsx', 'scripts/generate-fonts.ts', '--check'] })
  }
  return steps
}

export interface VerifyResult {
  ok: boolean
  attempts: number
  passed: string[]
  failedStep: string | null
  tail: string
}

type Runner = (step: VerifyStep, dir: string) => Promise<{ code: number; output: string }>

const spawnRunner: Runner = (step, dir) =>
  new Promise((resolve) => {
    const child = spawn(step.cmd, step.args, { cwd: dir, env: { ...process.env, CI: '1', NEXT_TELEMETRY_DISABLED: '1' } })
    let output = ''
    const add = (b: Buffer) => {
      output += b.toString()
      if (output.length > 200_000) output = output.slice(-100_000)
    }
    child.stdout.on('data', add)
    child.stderr.on('data', add)
    child.on('close', (code) => resolve({ code: code ?? 1, output }))
    child.on('error', (err) => resolve({ code: 1, output: String(err) }))
  })

async function verifyOnce(dir: string, run: Runner): Promise<Omit<VerifyResult, 'attempts'>> {
  const passed: string[] = []
  for (const step of verifySteps(dir)) {
    const r = await run(step, dir)
    if (r.code !== 0) return { ok: false, passed, failedStep: step.name, tail: r.output.split('\n').slice(-25).join('\n') }
    passed.push(step.name)
  }
  return { ok: true, passed, failedStep: null, tail: '' }
}

export async function verifyRepo(dir: string, opts: { retries?: number; runner?: Runner } = {}): Promise<VerifyResult> {
  const retries = opts.retries ?? 1
  const runner = opts.runner ?? spawnRunner
  let last: Omit<VerifyResult, 'attempts'> = { ok: false, passed: [], failedStep: null, tail: '' }
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    last = await verifyOnce(dir, runner)
    if (last.ok) return { ...last, attempts: attempt }
  }
  return { ...last, attempts: retries + 1 }
}

// Bounded-concurrency map (default 2), preserving input order.
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}
