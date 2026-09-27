import type { ReleaseManifest } from './types'

// Surgical edits for the files a release never overwrites wholesale. All pure,
// all formatting-preserving (text edits, validated by re-parsing).

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// package.json: add/remove "scripts" entries as text so the client's
// formatting, key order and other scripts survive untouched.
export function editPackageJson(text: string, ops: NonNullable<ReleaseManifest['packageJson']>): { text: string; changes: string[] } {
  let s = text
  const changes: string[] = []
  const json = JSON.parse(s) as { scripts?: Record<string, string> }
  for (const k of ops.removeScripts ?? []) {
    if (!json.scripts || !(k in json.scripts)) continue
    const before = s
    s = s.replace(new RegExp(`\\n[ \\t]*"${escapeRe(k)}":\\s*"(?:[^"\\\\]|\\\\.)*",?`), '')
    if (s === before) throw new Error(`package.json: could not remove script "${k}"`)
    changes.push(`-script ${k}`)
  }
  // Removing the last entry of an object leaves a dangling comma.
  s = s.replace(/,(\s*\n\s*\})/g, '$1')

  const anchorKey = ops.anchorBefore ?? 'validate'
  for (const [k, v] of Object.entries(ops.addScripts ?? {})) {
    const cur = (JSON.parse(s) as { scripts?: Record<string, string> }).scripts ?? {}
    if (k in cur) {
      if (cur[k] !== v) changes.push(`=script ${k} (kept client value)`)
      continue
    }
    const entry = (indent: string) => `\n${indent}"${k}": ${JSON.stringify(v)},`
    const anchor = s.match(new RegExp(`\\n([ \\t]*)"${escapeRe(anchorKey)}":`))
    if (anchor) {
      s = s.replace(anchor[0], `${entry(anchor[1])}${anchor[0]}`)
    } else {
      // Fall back to the top of the scripts object.
      const open = s.match(/"scripts":\s*\{\n([ \t]*)/)
      if (!open) throw new Error(`package.json: no "${anchorKey}" script and no multi-line "scripts" object to insert into`)
      s = s.replace(open[0], `"scripts": {\n${open[1]}"${k}": ${JSON.stringify(v)},\n${open[1]}`)
    }
    changes.push(`+script ${k}`)
  }

  for (const [section, deps] of Object.entries(ops.setDependencies ?? {})) {
    for (const [name, version] of Object.entries(deps)) {
      const cur = (JSON.parse(s) as Record<string, Record<string, string> | undefined>)[section]
      if (cur?.[name] === version) continue
      const open = s.match(new RegExp(`"${escapeRe(section)}":\\s*\\{`))
      if (open && open.index !== undefined) {
        const start = open.index + open[0].length
        const end = s.indexOf('}', start)
        const body = s.slice(start, end)
        const keyRe = new RegExp(`("${escapeRe(name)}":\\s*)"[^"]*"`)
        let nextBody: string
        if (keyRe.test(body)) {
          nextBody = body.replace(keyRe, `$1${JSON.stringify(version)}`)
        } else {
          const indent = body.match(/\n([ \t]+)"/)?.[1] ?? '    '
          const closeIndent = body.match(/\n([ \t]*)$/)?.[1] ?? '  '
          nextBody = body.trim() ? `${body.replace(/\s*$/, '')},\n${indent}"${name}": ${JSON.stringify(version)}\n${closeIndent}` : `\n${indent}"${name}": ${JSON.stringify(version)}\n${closeIndent}`
        }
        s = s.slice(0, start) + nextBody + s.slice(end)
      } else {
        const indent = s.match(/^\{\n([ \t]+)"/)?.[1] ?? '  '
        const close = s.lastIndexOf('\n}')
        if (close < 0) throw new Error('package.json: cannot find the closing brace')
        s = `${s.slice(0, close)},\n${indent}"${section}": {\n${indent}${indent}"${name}": ${JSON.stringify(version)}\n${indent}}${s.slice(close)}`
      }
      changes.push(`${section}.${name}=${version}`)
    }
  }
  JSON.parse(s)
  return { text: s, changes }
}

// .gitignore: exact-line removes and appends. Remove lines match with or
// without a leading "/" and trailing "/" (design-kit, /design-kit/…).
export function editGitignore(text: string, ops: NonNullable<ReleaseManifest['gitignore']>): { text: string; changes: string[] } {
  const norm = (l: string) => l.trim().replace(/^\//, '').replace(/\/$/, '')
  const remove = new Set((ops.remove ?? []).map(norm))
  const changes: string[] = []
  const lines = text.split('\n')
  const kept = lines.filter((l) => {
    if (l.trim() && remove.has(norm(l))) {
      changes.push(`-${l}`)
      return false
    }
    return true
  })
  let out = kept.join('\n')
  const have = new Set(kept.map((l) => l.trim()))
  for (const add of ops.add ?? []) {
    if (have.has(add.trim())) continue
    if (out.length && !out.endsWith('\n')) out += '\n'
    out += `${add}\n`
    changes.push(`+${add}`)
  }
  return { text: out, changes }
}

// .gitattributes: append every template line the client doesn't already have.
export function mergeLines(clientText: string | null, templateText: string): { text: string; changes: string[] } {
  let out = clientText ?? ''
  const have = new Set(out.split('\n'))
  const changes: string[] = []
  for (const line of templateText.split('\n')) {
    if (!line || have.has(line)) continue
    if (out.length && !out.endsWith('\n')) out += '\n'
    out += `${line}\n`
    have.add(line)
    changes.push(`+${line}`)
  }
  return { text: out, changes }
}

// c5-template.json: the template's marker plus `syncedFrom` = the exact
// template commit this repo was synced to (the next release's OLD).
export function stampMarker(templateMarkerText: string, syncedFrom: string): string {
  if (!/^[0-9a-f]{40}$/.test(syncedFrom)) throw new Error(`syncedFrom must be a full 40-char sha, got "${syncedFrom}"`)
  const marker = JSON.parse(templateMarkerText) as Record<string, unknown>
  return `${JSON.stringify({ ...marker, syncedFrom }, null, 2)}\n`
}

// Template versions are dotted numbers (2026.09.4). <0 / 0 / >0 like a comparator.
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => Number.parseInt(x, 10) || 0)
  const pb = b.split('.').map((x) => Number.parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export interface MarkerInfo {
  templateVersion: string | null
  syncedFrom: string | null
  capabilities: string[]
}

export function readMarker(text: string | null): MarkerInfo {
  if (!text) return { templateVersion: null, syncedFrom: null, capabilities: [] }
  try {
    const m = JSON.parse(text) as Record<string, unknown>
    return {
      templateVersion: typeof m.templateVersion === 'string' ? m.templateVersion : null,
      syncedFrom: typeof m.syncedFrom === 'string' && /^[0-9a-f]{7,40}$/.test(m.syncedFrom) ? m.syncedFrom : null,
      capabilities: Array.isArray(m.capabilities) ? m.capabilities.filter((c): c is string => typeof c === 'string') : [],
    }
  } catch {
    return { templateVersion: null, syncedFrom: null, capabilities: [] }
  }
}
