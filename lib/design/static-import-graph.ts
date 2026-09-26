// Test-only helper (Node, not bundled): the STATIC runtime import graph of a
// source file — every local module and bare package reachable through
// `import … from` / `export … from` / side-effect imports, skipping
// type-only imports (erased at build) and dynamic `import()` (lazy, which is
// exactly what native-backed modules must be reached through). Used by
// vercel-packaging.test.ts to prove no design route statically reaches
// lightningcss / playwright-core / @sparticuz/chromium through a chain of
// light modules.
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const STATEMENT = /^\s*(import|export)\s+(type\s+)?((?:[\w$]+\s*,\s*)?(?:\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?|[\w$]+))\s+from\s+['"]([^'"]+)['"]/gm
const SIDE_EFFECT = /^\s*import\s+['"]([^'"]+)['"]/gm
const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx']

function allTypeOnly(clause: string): boolean {
  const braces = /^\{([^}]*)\}$/.exec(clause.trim())
  if (!braces) return false
  const names = braces[1].split(',').map((s) => s.trim()).filter(Boolean)
  return names.length > 0 && names.every((n) => n.startsWith('type '))
}

export function staticSpecifiers(source: string): string[] {
  const out: string[] = []
  for (const m of source.matchAll(STATEMENT)) {
    const [, , typeKw, clause, spec] = m
    if (typeKw || allTypeOnly(clause)) continue
    out.push(spec)
  }
  for (const m of source.matchAll(SIDE_EFFECT)) out.push(m[1])
  return out
}

function resolveLocal(root: string, fromFile: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? path.join(root, spec.slice(2)) : path.resolve(path.dirname(fromFile), spec)
  if (existsSync(base) && statSync(base).isFile()) return base
  for (const ext of EXTENSIONS) if (existsSync(base + ext)) return base + ext
  return null
}

export function staticImportGraph(root: string, entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>()
  const packages = new Set<string>()
  const queue = [path.resolve(root, entry)]
  while (queue.length) {
    const file = queue.pop() as string
    if (files.has(file)) continue
    files.add(file)
    for (const spec of staticSpecifiers(readFileSync(file, 'utf-8'))) {
      if (spec.startsWith('.') || spec.startsWith('@/')) {
        const resolved = resolveLocal(root, file, spec)
        if (resolved) queue.push(resolved)
      } else {
        packages.add(spec)
      }
    }
  }
  return { files, packages }
}
