import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { compareVersions } from './special-files'
import type { ReleaseManifest, Ruling } from './types'

// Release manifests live at config/fleet-releases/<templateVersion>.json (one
// per template release; the NEW commit's c5-template.json names the version).

export const RELEASES_DIR = path.join(process.cwd(), 'config', 'fleet-releases')
const RULINGS: Ruling[] = ['overwrite', '3way', 'skip']

function strArray(v: unknown, field: string): string[] | undefined {
  if (v === undefined) return undefined
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new Error(`manifest: "${field}" must be a string array`)
  return v as string[]
}

export function parseManifest(text: string, source = 'manifest'): ReleaseManifest {
  const o = JSON.parse(text) as Record<string, unknown>
  if (typeof o.templateVersion !== 'string') throw new Error(`${source}: missing "templateVersion"`)
  const known = new Set(['_note', 'templateVersion', 'notes', 'exclude', 'packageJson', 'gitignore', 'gitattributes', 'themeCss', 'lockfile', 'actionTextVars', 'expectFiles', 'seedIfAbsent', 'deleteTracked', 'rulings'])
  for (const k of Object.keys(o)) if (!known.has(k)) throw new Error(`${source}: unknown field "${k}"`)

  const m: ReleaseManifest = { templateVersion: o.templateVersion }
  if (typeof o.notes === 'string') m.notes = o.notes
  m.exclude = strArray(o.exclude, 'exclude')
  for (const re of m.exclude ?? []) new RegExp(re)
  if (o.packageJson !== undefined) {
    const p = o.packageJson as Record<string, unknown>
    if (!p || typeof p !== 'object') throw new Error(`${source}: "packageJson" must be an object`)
    const add = p.addScripts as Record<string, unknown> | undefined
    if (add !== undefined && (typeof add !== 'object' || Object.values(add).some((v) => typeof v !== 'string'))) {
      throw new Error(`${source}: "packageJson.addScripts" must map names to strings`)
    }
    const deps = p.setDependencies as Record<string, Record<string, unknown>> | undefined
    if (deps !== undefined) {
      const okSections = ['dependencies', 'devDependencies', 'optionalDependencies', 'overrides']
      for (const [sec, map] of Object.entries(deps)) {
        if (!okSections.includes(sec)) throw new Error(`${source}: packageJson.setDependencies section "${sec}" not allowed`)
        if (!map || typeof map !== 'object' || Object.values(map).some((v) => typeof v !== 'string')) {
          throw new Error(`${source}: packageJson.setDependencies.${sec} must map names to version strings`)
        }
      }
    }
    m.packageJson = {
      addScripts: add as Record<string, string> | undefined,
      removeScripts: strArray(p.removeScripts, 'packageJson.removeScripts'),
      anchorBefore: typeof p.anchorBefore === 'string' ? p.anchorBefore : undefined,
      setDependencies: deps as Record<string, Record<string, string>> | undefined,
    }
  }
  if (o.gitignore !== undefined) {
    const g = o.gitignore as Record<string, unknown>
    m.gitignore = { add: strArray(g?.add, 'gitignore.add'), remove: strArray(g?.remove, 'gitignore.remove') }
  }
  if (o.gitattributes !== undefined) {
    if (o.gitattributes !== 'merge-lines') throw new Error(`${source}: "gitattributes" must be "merge-lines"`)
    m.gitattributes = 'merge-lines'
  }
  if (o.themeCss !== undefined) {
    if (o.themeCss !== 'additive-helper' && o.themeCss !== 'none') throw new Error(`${source}: "themeCss" must be "additive-helper" or "none"`)
    m.themeCss = o.themeCss
  }
  if (o.lockfile !== undefined) {
    if (o.lockfile === 'ignore' || o.lockfile === 'regenerate') {
      m.lockfile = o.lockfile
    } else if (o.lockfile && typeof o.lockfile === 'object' && typeof (o.lockfile as Record<string, unknown>).dropPackages === 'string') {
      const l = o.lockfile as Record<string, unknown>
      new RegExp(l.dropPackages as string)
      const known2 = new Set(['dropPackages', 'expectPackages'])
      for (const k of Object.keys(l)) if (!known2.has(k)) throw new Error(`${source}: unknown field "lockfile.${k}"`)
      m.lockfile = { dropPackages: l.dropPackages as string, expectPackages: strArray(l.expectPackages, 'lockfile.expectPackages') }
    } else {
      throw new Error(`${source}: "lockfile" must be "ignore", "regenerate" or { "dropPackages": "<regex>", "expectPackages": [...] }`)
    }
  }
  if (o.actionTextVars !== undefined) {
    if (o.actionTextVars !== 'ensure') throw new Error(`${source}: "actionTextVars" must be "ensure"`)
    m.actionTextVars = 'ensure'
  }
  if (o.expectFiles !== undefined) {
    const e = o.expectFiles as Record<string, unknown>
    if (!e || typeof e !== 'object') throw new Error(`${source}: "expectFiles" must be an object`)
    for (const k of Object.keys(e)) if (!['overwrite', 'add', 'delete'].includes(k)) throw new Error(`${source}: unknown field "expectFiles.${k}"`)
    m.expectFiles = {
      overwrite: strArray(e.overwrite, 'expectFiles.overwrite'),
      add: strArray(e.add, 'expectFiles.add'),
      delete: strArray(e.delete, 'expectFiles.delete'),
    }
  }
  m.seedIfAbsent = strArray(o.seedIfAbsent, 'seedIfAbsent')
  m.deleteTracked = strArray(o.deleteTracked, 'deleteTracked')
  if (o.rulings !== undefined) {
    const r = o.rulings as Record<string, Record<string, unknown>>
    for (const [repo, paths] of Object.entries(r)) {
      for (const [p, v] of Object.entries(paths ?? {})) {
        if (!RULINGS.includes(v as Ruling)) throw new Error(`${source}: rulings.${repo}["${p}"] must be one of ${RULINGS.join('|')}`)
      }
    }
    m.rulings = r as Record<string, Record<string, Ruling>>
  }
  return m
}

export function manifestPathFor(version: string, dir = RELEASES_DIR): string {
  if (!/^[\w.-]+$/.test(version)) throw new Error(`bad template version "${version}"`)
  return path.join(dir, `${version}.json`)
}

const uniq = (xs: (string[] | undefined)[]): string[] | undefined => {
  const all = xs.flatMap((x) => x ?? [])
  return all.length ? [...new Set(all)] : undefined
}

// Combine consecutive releases' manifests (oldest first) for a client that
// skipped one. Later releases win on scalar/keyed values; lists union.
export function mergeManifests(ms: ReleaseManifest[]): ReleaseManifest {
  if (ms.length === 0) throw new Error('mergeManifests: nothing to merge')
  if (ms.length === 1) return ms[0]
  const last = ms[ms.length - 1]
  const out: ReleaseManifest = { templateVersion: last.templateVersion }
  const notes = ms.map((m) => m.notes).filter(Boolean)
  if (notes.length) out.notes = notes.join('\n\n')
  out.exclude = uniq(ms.map((m) => m.exclude))
  if (ms.some((m) => m.packageJson)) {
    const addScripts: Record<string, string> = {}
    const setDependencies: Record<string, Record<string, string>> = {}
    let anchorBefore: string | undefined
    for (const m of ms) {
      Object.assign(addScripts, m.packageJson?.addScripts ?? {})
      for (const [sec, deps] of Object.entries(m.packageJson?.setDependencies ?? {})) setDependencies[sec] = { ...setDependencies[sec], ...deps }
      anchorBefore = m.packageJson?.anchorBefore ?? anchorBefore
    }
    const removeScripts = uniq(ms.map((m) => m.packageJson?.removeScripts))?.filter((k) => !(k in addScripts))
    out.packageJson = {
      ...(Object.keys(addScripts).length ? { addScripts } : {}),
      ...(removeScripts?.length ? { removeScripts } : {}),
      ...(anchorBefore ? { anchorBefore } : {}),
      ...(Object.keys(setDependencies).length ? { setDependencies } : {}),
    }
  }
  if (ms.some((m) => m.gitignore)) out.gitignore = { add: uniq(ms.map((m) => m.gitignore?.add)), remove: uniq(ms.map((m) => m.gitignore?.remove)) }
  if (ms.some((m) => m.gitattributes)) out.gitattributes = 'merge-lines'
  if (ms.some((m) => m.themeCss === 'additive-helper')) out.themeCss = 'additive-helper'
  else if (ms.some((m) => m.themeCss === 'none')) out.themeCss = 'none'
  const recipe = [...ms].reverse().find((m) => typeof m.lockfile === 'object')?.lockfile
  if (recipe) out.lockfile = recipe
  else if (ms.some((m) => m.lockfile === 'regenerate')) out.lockfile = 'regenerate'
  else if (ms.some((m) => m.lockfile === 'ignore')) out.lockfile = 'ignore'
  if (ms.some((m) => m.actionTextVars === 'ensure')) out.actionTextVars = 'ensure'
  if (ms.some((m) => m.expectFiles)) {
    out.expectFiles = {
      overwrite: uniq(ms.map((m) => m.expectFiles?.overwrite)),
      add: uniq(ms.map((m) => m.expectFiles?.add)),
      delete: uniq(ms.map((m) => m.expectFiles?.delete)),
    }
  }
  out.seedIfAbsent = uniq(ms.map((m) => m.seedIfAbsent))
  out.deleteTracked = uniq(ms.map((m) => m.deleteTracked))
  const rulings: Record<string, Record<string, Ruling>> = {}
  for (const m of ms) for (const [repo, r] of Object.entries(m.rulings ?? {})) rulings[repo] = { ...rulings[repo], ...r }
  if (Object.keys(rulings).length) out.rulings = rulings
  return out
}

/**
 * Manifest for a client moving OLD's version → NEW's version: NEW's manifest,
 * merged with every committed manifest strictly between the two (a skipped
 * release still gets its migration). `explicitPath` (--manifest) is used as-is.
 */
export function manifestForRange(oldVersion: string | null, toVersion: string, opts: { dir?: string; explicitPath?: string } = {}): ReleaseManifest {
  const newest = loadManifest(toVersion, opts.explicitPath, opts.dir)
  if (opts.explicitPath || !oldVersion || oldVersion === toVersion) return newest
  const dir = opts.dir ?? RELEASES_DIR
  const between = (existsSync(dir) ? readdirSync(dir) : [])
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .filter((v) => compareVersions(v, oldVersion) > 0 && compareVersions(v, toVersion) < 0)
    .sort(compareVersions)
  return mergeManifests([...between.map((v) => loadManifest(v, undefined, dir)), newest])
}

export function loadManifest(version: string, explicitPath?: string, dir?: string): ReleaseManifest {
  if (!explicitPath && dir) explicitPath = manifestPathFor(version, dir)
  const p = explicitPath ?? manifestPathFor(version)
  if (!existsSync(p)) {
    throw new Error(`No release manifest for template ${version} (${p}). Write one — see lib/fleet/README.md — or pass --manifest <file>.`)
  }
  const m = parseManifest(readFileSync(p, 'utf-8'), p)
  if (m.templateVersion !== version) throw new Error(`${p} declares templateVersion ${m.templateVersion}, but template@NEW is ${version}`)
  return m
}
