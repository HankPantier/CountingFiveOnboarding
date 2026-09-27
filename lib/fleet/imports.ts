import path from 'node:path'

// Import-closure check for a sync (pure). Every file the release writes must
// resolve each of its relative / "@/" imports to a file the client will have
// AFTER the sync. Catches a helper the new code imports that the release's
// file set forgot (or that the gate skipped), before a client build breaks.

const CODE_FILE = /\.(tsx?|jsx?|mjs|cjs)$/

export function isCodeFile(p: string): boolean {
  return CODE_FILE.test(p)
}

// import x from '…' / import '…' / export … from '…' / import('…') / require('…')
const SPEC_RES = [
  /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
]

export function extractImportSpecifiers(src: string): string[] {
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const out = new Set<string>()
  for (const re of SPEC_RES) for (const m of noComments.matchAll(re)) out.add(m[1])
  return [...out]
}

const EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '/index.ts', '/index.tsx', '/index.js']

/**
 * Local target of a specifier: 'external' for packages, else the candidate
 * repo paths (extension/index variants) in resolution order.
 */
export function importCandidates(fromFile: string, spec: string, alias: Record<string, string> = { '@/': 'src/' }): 'external' | string[] {
  let base: string | null = null
  if (spec.startsWith('./') || spec.startsWith('../')) base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec))
  else {
    for (const [prefix, target] of Object.entries(alias)) if (spec.startsWith(prefix)) base = target + spec.slice(prefix.length)
  }
  if (base === null) return 'external'
  return EXTS.map((e) => base + e)
}

export interface ImportProblem {
  file: string
  spec: string
  reason: string
}

export function checkImportClosure(input: {
  /** Files the sync writes → their new text. */
  written: Map<string, string>
  /** Is the path present in the client tree after the sync? */
  postSyncHas: (p: string) => boolean
  /** Is the path present in template@NEW? */
  templateHas: (p: string) => boolean
  /** Changed OLD..NEW in the template but NOT synced to this client (skipped / ruled) with the client's copy ≠ NEW. */
  staleOnClient: (p: string) => boolean
}): ImportProblem[] {
  const problems: ImportProblem[] = []
  for (const [file, text] of input.written) {
    if (!isCodeFile(file)) continue
    for (const spec of extractImportSpecifiers(text)) {
      const cands = importCandidates(file, spec)
      if (cands === 'external') continue
      const hit = cands.find((c) => input.postSyncHas(c))
      if (!hit) {
        const inTemplate = cands.find((c) => input.templateHas(c))
        problems.push({
          file,
          spec,
          reason: inTemplate
            ? `imports ${inTemplate}, which the client won't have after the sync (not in the release's file set, or skipped)`
            : `import "${spec}" resolves to no file in the client or template@NEW`,
        })
      } else if (input.staleOnClient(hit)) {
        problems.push({ file, spec, reason: `imports ${hit}, which changed in this release but is not being synced to this client` })
      }
    }
  }
  return problems
}
